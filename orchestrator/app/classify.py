"""Ask the local model which declared capability an utterance wants (D-0033).

This is the slice that ends keyword-hunting. Stages 0-2 stopped JARVIS lying;
they did nothing for "anything broken?" not matching a regex that wants the
literal words "cluster status".

**The talker still gets no tools.** This is a separate, non-streaming call
that returns a *label*. Every label is checked against the manifest before it
can mean anything, so a model that invents `cluster.nuke` gets `None`. The
7B fake-called tools once and that is why the rule exists (VISION); naming a
verb from a closed list is a different, much smaller act of trust.

Runs on `jarvis-local`, on the rack's own GPU. Routing is on the critical path
of every turn and has to survive the house being sick, so it does not depend
on an internet LLM.
"""

from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass
from typing import Any

import httpx

from .capabilities import MANIFEST
from .config import settings

log = logging.getLogger("jarvis.orchestrator.classify")

CAPABILITY = "capability"
CHAT = "chat"


@dataclass(frozen=True)
class Verdict:
    kind: str  # capability | chat
    verb: str | None
    confidence: float

    @property
    def is_capability(self) -> bool:
        return self.kind == CAPABILITY


def build_prompt() -> str:
    """System prompt, generated from the manifest so it cannot fall behind."""
    lines = []
    for cap in MANIFEST.values():
        ex = "; ".join(cap.examples[:3])
        line = f"- {cap.name}: {cap.summary}"
        if ex:
            line += f'  (e.g. "{ex}")'
        lines.append(line)
    names = ", ".join(MANIFEST)
    return (
        "You route messages for JARVIS, the assistant for Gordon's home server "
        "rack. Decide whether a message asks JARVIS to DO or REPORT something "
        "about this particular lab, and if so which declared capability it "
        "wants.\n\n"
        "Capabilities:\n" + "\n".join(lines) + "\n\n"
        "Reply with JSON and nothing else:\n"
        '{"kind": "capability" | "chat", "verb": <one of the names above, or '
        'null>, "confidence": <0.0 to 1.0>}\n\n'
        "Rules:\n"
        f"- verb must be exactly one of: {names} — or null. Never invent one.\n"
        "- kind is capability when the message is about THIS lab right now, "
        "even if no capability fits; then verb is null.\n"
        "- kind is chat for general knowledge, explanation, opinion or "
        "conversation, EVEN IF it mentions servers, pods, GPUs or Kubernetes.\n"
        '- "what is a GPU?" is chat. "how hot are the GPUs?" is capability '
        "(cluster.gpus). The words overlap; the intent does not.\n"
        '- "explain what a pod is" is chat. "any pods crashing?" is '
        "capability (cluster.health).\n"
        '- "tell me about X" and "what is X" ask for an explanation. They '
        "are chat even when X is flux, a pod or a GPU. Measured: without this "
        'line the model called "tell me about flux" a status request.\n'
        "- confidence is how sure you are. Below 0.6 means unsure.\n"
    )


def parse_verdict(content: str) -> Verdict | None:
    """Tolerant JSON parse, then hard validation against the manifest.

    The model is a 7B and will occasionally wrap JSON in prose or a fence, so
    parsing is forgiving. What is *not* forgiving is the verb check: an
    unknown name becomes None rather than something the shim might run.
    """
    text = (content or "").strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
    obj: Any = None
    try:
        obj = json.loads(text)
    except json.JSONDecodeError:
        m = re.search(r"\{.*\}", text, re.S)
        if m:
            try:
                obj = json.loads(m.group(0))
            except json.JSONDecodeError:
                return None
    if not isinstance(obj, dict):
        return None

    kind = str(obj.get("kind") or "").strip().lower()
    if kind not in (CAPABILITY, CHAT):
        return None

    raw_verb = obj.get("verb")
    verb: str | None = None
    if isinstance(raw_verb, str):
        candidate = raw_verb.strip()
        if candidate and candidate.lower() not in ("null", "none", ""):
            # The closed-list check. Everything downstream trusts this.
            verb = candidate if candidate in MANIFEST else None
            if verb is None:
                log.info("classifier proposed unknown verb %r — dropped", candidate)

    try:
        confidence = float(obj.get("confidence", 0.0))
    except (TypeError, ValueError):
        confidence = 0.0
    confidence = max(0.0, min(1.0, confidence))

    # A named verb is inherently a capability, whatever the model said.
    if verb and kind != CAPABILITY:
        kind = CAPABILITY
    return Verdict(kind=kind, verb=verb, confidence=confidence)


async def classify(text: str) -> Verdict | None:
    """One classify call. Never raises — a failure means "no opinion"."""
    t = " ".join((text or "").strip().split())
    if not t:
        return None
    key = settings.litellm_api_key.strip()
    if settings.mock_llm or not key:
        return None

    payload: dict[str, Any] = {
        "model": settings.classifier_model,
        "messages": [
            {"role": "system", "content": build_prompt()},
            {"role": "user", "content": t[:1000]},
        ],
        "stream": False,
        "temperature": 0,
        "max_tokens": 120,
        # Ollama honours this as format=json; if LiteLLM drops it for some
        # backend the tolerant parse above still copes.
        "response_format": {"type": "json_object"},
    }
    url = settings.litellm_base.rstrip("/") + "/v1/chat/completions"
    try:
        async with httpx.AsyncClient(timeout=settings.classifier_timeout) as client:
            r = await client.post(
                url,
                headers={
                    "Authorization": f"Bearer {key}",
                    "Content-Type": "application/json",
                },
                json=payload,
            )
            if r.status_code >= 400:
                log.warning("classify http %s", r.status_code)
                return None
            body = r.json()
    except Exception as e:  # noqa: BLE001 — a router must not take the turn down
        log.warning("classify failed: %s", type(e).__name__)
        return None

    try:
        content = (
            ((body.get("choices") or [{}])[0].get("message") or {}).get("content") or ""
        )
    except Exception:  # noqa: BLE001
        return None
    return parse_verdict(str(content))
