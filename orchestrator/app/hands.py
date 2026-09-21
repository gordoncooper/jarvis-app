from __future__ import annotations

import logging
import re
import time
import uuid
from dataclasses import dataclass
from typing import Any

import httpx

from .config import settings

log = logging.getLogger("jarvis.orchestrator.hands")

CONFIRM_TTL_SEC = 90.0

# Gordon-named verbs (D-0022 trusted / D-0023 confirm).
CATALOG: dict[str, dict[str, str]] = {
    "cluster.health": {"class": "trusted", "desc": "Node Ready / non-Running pods snapshot."},
    "cluster.gpus": {"class": "trusted", "desc": "GPU temperature and memory from Prometheus."},
    "lab.map": {"class": "trusted", "desc": "Canonical lab URLs plus live node list."},
    "apps.recycle_pod": {"class": "confirm", "desc": "Delete one named pod (recreate via controller)."},
    "apps.restart_deploy": {"class": "confirm", "desc": "Patch Deployment restartedAt to bounce pods."},
}

# Write-verb namespace allowlist (D-0023). Mirrors WRITE_NS in the OpenClaw
# shim, which re-validates server-side — this copy exists so a bad namespace is
# refused before it costs a round-trip. Widening either one is a decision.
ALLOW_NS = frozenset({"apps", "inference", "agents", "monitoring"})

# Speech aliases → real Deployment / short name keys in SHORT_NAMES.
_NAME_ALIASES: dict[str, str] = {
    "orchestrator": "jarvis-orchestrator",
    "glass": "jarvis-glass",
    "home": "jarvis-home",
    "webui": "open-webui",
    "chat": "open-webui",
}

# Bare short name → (namespace, resource kind for default verb).
SHORT_NAMES: dict[str, tuple[str, str]] = {
    "jarvis-glass": ("apps", "deploy"),
    "jarvis-orchestrator": ("apps", "deploy"),
    "jarvis-home": ("apps", "deploy"),
    "homepage": ("apps", "deploy"),
    "open-webui": ("apps", "deploy"),
    "openclaw": ("agents", "deploy"),
    "ollama": ("inference", "deploy"),
    "litellm": ("inference", "deploy"),
    "speaches": ("inference", "deploy"),
    "openedai-speech": ("inference", "deploy"),
    "piper": ("inference", "deploy"),
    "whisper": ("inference", "deploy"),
    "prometheus": ("monitoring", "deploy"),
    "grafana": ("monitoring", "deploy"),
    "nvidia-gpu-exporter": ("monitoring", "deploy"),
}

_AFFIRM = re.compile(
    r"^\s*(yes|yep|yeah|confirm|do\s+it|go\s+ahead|proceed|ok|okay)\s*[.!?]?\s*$",
    re.I,
)
_CANCEL = re.compile(
    r"^\s*(cancel|no|nope|never\s*mind|stop|abort|don'?t)\s*[.!?]?\s*$",
    re.I,
)

# Confirm rules before trusted health so "restart deploy X" does not hit cluster.health.
_RULES: list[tuple[str, re.Pattern[str]]] = [
    (
        "apps.restart_deploy",
        re.compile(
            r"\b("
            r"(restart|bounce|recycle)\s+(the\s+)?(deploy(ment)?|deploy)\b|"
            r"(restart|bounce)\s+(the\s+)?[\w-]+\s+deploy(ment)?\b|"
            r"deploy(ment)?\s+(restart|bounce|recycle)\b|"
            r"(restart|bounce|recycle)\s+(the\s+)?"
            r"(jarvis-)?(orchestrator|glass|home|open-?webui|openclaw|"
            r"ollama|litellm|piper|whisper|prometheus|grafana)\b"
            r")",
            re.I,
        ),
    ),
    (
        "apps.recycle_pod",
        re.compile(
            r"\b("
            r"(recycle|delete|kill|restart)\s+(the\s+)?pod\b|"
            r"pod\s+(recycle|delete|kill|restart)\b|"
            r"recycle\s+(the\s+)?[\w-]+(\s+pod)?\b"
            r")",
            re.I,
        ),
    ),
    (
        # A bare "gpu" used to match, so "what is a GPU?" answered with live
        # temperatures (D-0033). The word alone is not a request for a
        # reading — it needs a metric beside it, or phrasing that asks about
        # *these* cards.
        "cluster.gpus",
        re.compile(
            r"\b("
            r"gpus?\s+(temps?|temperature|memory|status|health|usage|"
            r"utili[sz]ation|load)|"
            r"(gpu|vram|video\s+memory)\s+(used|free|usage|left)|"
            r"(temps?|temperature|usage|utili[sz]ation|load)\s+(on|of)\s+"
            r"(the\s+)?gpus?|"
            r"vram|video\s+memory|nvidia[\s-]?smi|nvidia\s+(gpus?|cards?)|"
            r"how\s+hot\s+(is|are)\s+(the\s+)?(gpus?|cards?|"
            r"graphics\s+cards?)|"
            r"(graphics\s+cards?|gpus?)\s+(running\s+)?(warm|hot)"
            r")\b",
            re.I,
        ),
    ),
    (
        "lab.map",
        re.compile(
            r"\b("
            r"lab\s+map|rack\s+map|"
            r"what\s+(are\s+)?(the\s+)?urls?|"
            r"which\s+(url|site|surface)|"
            r"where\s+(is|do\s+i\s+find)\s+"
            r"(grafana|gitea|git\.lan|noc|chat\.lan|jarvis\.lan|agent)"
            r")\b",
            re.I,
        ),
    ),
    (
        "cluster.health",
        re.compile(
            r"\b("
            r"cluster\s+(health|status)|"
            r"nodes?\s+(ready|status|up)|"
            r"are\s+(the\s+)?nodes?\s+up|"
            r"(is|how'?s?|how\s+is)\s+the\s+(lab|cluster|rack)\b|"
            r"(lab|cluster|rack)\s+(up|healthy|ok|okay|status)|"
            r"pod\s+status|crashing\s+pods?|"
            r"(list|show|get)\s+(the\s+)?pods?\b|"
            r"pods?\s+in\s+(the\s+)?(lab|cluster|rack|apps)\b|"
            r"status\s+of\s+the\s+(lab|cluster|rack)"
            r")\b",
            re.I,
        ),
    ),
]


@dataclass
class VerbHit:
    name: str
    klass: str = "trusted"
    args: dict[str, str] | None = None


def match_verb(text: str) -> VerbHit | None:
    # Normalize curly/smart apostrophes from STT / paste ("how's" vs "how’s").
    t = " ".join((text or "").strip().split())
    t = t.replace("\u2019", "'").replace("\u2018", "'")
    if not t:
        return None
    for name, pat in _RULES:
        if pat.search(t):
            klass = CATALOG.get(name, {}).get("class", "trusted")
            if klass == "confirm":
                args, err = parse_confirm_args(name, t)
                if err or not args:
                    return VerbHit(name=name, klass="confirm", args=None)
                return VerbHit(name=name, klass="confirm", args=args)
            return VerbHit(name=name, klass="trusted")
    return None


def parse_confirm_args(verb: str, text: str) -> tuple[dict[str, str] | None, str | None]:
    """Extract namespace/name from speech. Returns (args, error)."""
    t = " ".join((text or "").strip().split())
    t = t.replace("\u2019", "'").replace("\u2018", "'")
    # Explicit ns/name
    m = re.search(r"\b([a-z0-9-]+)/([a-z0-9]([-a-z0-9]*[a-z0-9])?)\b", t, re.I)
    if m and m.group(1).lower() in ALLOW_NS:
        return {"namespace": m.group(1).lower(), "name": m.group(2).lower()}, None

    # Known short names + speech aliases
    low = t.lower()
    for alias, real in sorted(_NAME_ALIASES.items(), key=lambda x: -len(x[0])):
        if re.search(rf"\b{re.escape(alias)}\b", low):
            ns, _ = SHORT_NAMES[real]
            return {"namespace": ns, "name": real}, None
    for short, (ns, _kind) in sorted(SHORT_NAMES.items(), key=lambda x: -len(x[0])):
        if re.search(rf"\b{re.escape(short)}\b", low):
            return {"namespace": ns, "name": short}, None

    # "pod foo-bar-123" / "deployment foo"
    m = re.search(
        r"\b(?:pod|deploy(?:ment)?)\s+([a-z0-9]([-a-z0-9]*[a-z0-9])?)\b",
        low,
    )
    if m:
        name = m.group(1)
        if name in SHORT_NAMES:
            ns, _ = SHORT_NAMES[name]
            return {"namespace": ns, "name": name}, None
        if name in _NAME_ALIASES:
            real = _NAME_ALIASES[name]
            ns, _ = SHORT_NAMES[real]
            return {"namespace": ns, "name": real}, None
        return None, f"I need a namespace for `{name}` (apps|inference|agents|monitoring)."

    return None, (
        "Name the target, sir — e.g. `recycle pod apps/jarvis-glass-…` "
        "or `restart deploy jarvis-glass`."
    )


def is_affirm(text: str) -> bool:
    return bool(_AFFIRM.match((text or "").strip()))


def is_cancel(text: str) -> bool:
    return bool(_CANCEL.match((text or "").strip()))


async def health_hands() -> tuple[bool, str | None]:
    url = settings.hands_base.rstrip("/") + "/health"
    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            r = await client.get(url)
            try:
                body = r.json()
            except Exception:  # noqa: BLE001
                body = {}
            if r.status_code >= 500 or body.get("ok") is False:
                return False, "Hands unavailable — live rack questions will wait."
            if r.status_code >= 400:
                return False, "Hands unavailable — live rack questions will wait."
            return True, None
    except Exception:  # noqa: BLE001
        return False, "Hands unavailable — live rack questions will wait."


async def execute_verb(
    name: str,
    *,
    args: dict[str, str] | None = None,
    confirmed: bool = False,
) -> dict[str, Any]:
    if name not in CATALOG:
        raise RuntimeError(f"unknown verb {name}")
    url = settings.hands_base.rstrip("/") + "/v1/verbs"
    payload: dict[str, Any] = {"verb": name, "args": args or {}, "confirmed": confirmed}
    async with httpx.AsyncClient(timeout=90.0) as client:
        r = await client.post(url, json=payload)
        try:
            body = r.json()
        except Exception as e:  # noqa: BLE001
            raise RuntimeError(f"hands http {r.status_code}") from e
        if body.get("error") == "confirm required":
            return body
        if r.status_code >= 400 or not body.get("ok"):
            raise RuntimeError(body.get("error") or f"hands http {r.status_code}")
        return body


async def propose_confirm(name: str, args: dict[str, str]) -> dict[str, Any]:
    """Call shim without confirmed to resolve preview (pod name, etc.)."""
    body = await execute_verb(name, args=args, confirmed=False)
    if body.get("error") != "confirm required":
        raise RuntimeError(body.get("error") or "expected confirm required")
    preview = body.get("preview") or {}
    ns = str(preview.get("namespace") or args.get("namespace") or "")
    nm = str(preview.get("name") or args.get("name") or "")
    summary = str(preview.get("summary") or f"{name} {ns}/{nm}")
    text = (body.get("text") or f"Confirm: {summary}? Say yes or cancel.").strip()
    return {
        "verb": name,
        "args": {"namespace": ns, "name": nm},
        "summary": summary,
        "text": text,
    }


def format_verb_reply(
    name: str,
    body: dict[str, Any],
    *,
    temp_unit: str = "C",
) -> str:
    """Prefer shim `text` (already prose). Fall back to structured `data`."""
    text = (body.get("text") or "").strip()
    data = body.get("data") or {}

    if name == "cluster.gpus":
        # Always format locally so promoted °F/°C preference applies (D-0024).
        bits = []
        for g in data.get("gpus") or []:
            part = str(g.get("node") or "?")
            if g.get("temp_c") is not None:
                c = float(g["temp_c"])
                if (temp_unit or "C").upper().startswith("F"):
                    part += f" {int(round(c * 9 / 5 + 32))}°F"
                else:
                    part += f" {int(c)}°C"
            if g.get("mem_used_bytes") is not None:
                mb = float(g["mem_used_bytes"]) / (1024**3)
                part += f", {mb:.1f} GiB used"
            bits.append(part)
        if bits:
            return "GPU status: " + "; ".join(bits) + "."
        if text:
            return text
        return "No GPU samples."

    if text:
        return text

    if name == "cluster.health":
        nodes = data.get("nodes") or []
        ready = sum(1 for n in nodes if n.get("ready"))
        total = len(nodes)
        pod = data.get("pod_summary") or ""
        return f"{ready}/{total} nodes Ready. {pod}".strip()
    if name == "lab.map":
        lines = ["Lab surfaces:"]
        for s in data.get("surfaces") or []:
            lines.append(f"- {s.get('name')}: {s.get('url')}")
        return "\n".join(lines)
    return f"{name}: no result"


def audit_verb(db_path: str, *, verb: str, ok: bool, detail: str, session_id: str | None) -> None:
    """Append-only verb audit beside promoted memory (same sqlite file)."""
    import sqlite3
    from pathlib import Path

    path = Path(db_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(str(path)) as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS verb_audit (
              id TEXT PRIMARY KEY,
              ts REAL NOT NULL,
              verb TEXT NOT NULL,
              ok INTEGER NOT NULL,
              session_id TEXT,
              detail TEXT
            )
            """
        )
        conn.execute(
            "INSERT INTO verb_audit (id, ts, verb, ok, session_id, detail) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (
                str(uuid.uuid4()),
                time.time(),
                verb,
                1 if ok else 0,
                session_id,
                detail[:2000],
            ),
        )


def new_pending(verb: str, args: dict[str, str], summary: str) -> dict[str, Any]:
    return {
        "id": str(uuid.uuid4()),
        "kind": "hands",
        "verb": verb,
        "args": args,
        "summary": summary,
        "expires_at": time.time() + CONFIRM_TTL_SEC,
    }


def pending_alive(pending: dict[str, Any] | None) -> dict[str, Any] | None:
    if not pending:
        return None
    if float(pending.get("expires_at") or 0) < time.time():
        return None
    return pending
