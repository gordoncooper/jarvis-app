"""Jarvis orchestrator — product brain (D-0012, D-0020)."""

from __future__ import annotations

import asyncio
import json
import logging
import re
import uuid
from collections.abc import AsyncIterator
from typing import Any

from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response, StreamingResponse
from pydantic import BaseModel, Field

from .config import settings
from .llm import chat_stream, extract_memory_fact, health_llm
from .memory import (
    PromotedMemory,
    eligible_for_llm_extract,
    fact_already_known,
    format_forget_all_ask,
    format_forget_confirm_ask,
    format_list_reply,
    gpu_temp_unit,
    new_memory_pending,
    parse_memory_candidate,
)
from .capabilities import refusal, spoken_list, talker_note
from .classify import classify
from .local_verbs import HANDLERS as LOCAL_VERBS
from .router import (
    CHAT,
    META_CAPABILITIES,
    MEMORY_CANDIDATE,
    MEMORY_FORGET,
    MEMORY_FORGET_ALL,
    MEMORY_FORGET_REF,
    MEMORY_LIST,
    MEMORY_REMEMBER,
    MEMORY_REMEMBER_REF,
    UNSUPPORTED,
    combine,
    route,
)
from .session_intent import parse_session_intent
from .session_store import SessionStore
from .hands import (
    audit_verb,
    execute_verb,
    format_verb_reply,
    health_hands,
    is_affirm,
    is_cancel,
    new_pending,
    parse_confirm_args,
    pending_alive,
    propose_confirm,
)
from . import __version__
from .briefing_map import assemble_briefing
from .overnight import build_cluster_briefing
from .pulse import get_pulse
from .weather import get_weather_at
from .stt import health_whisper, transcribe
from .tts import health_piper, synthesize

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("jarvis.orchestrator")

# Appended to a reply the operator cut off, so the transcript says what
# actually happened rather than silently losing the answer. Glass appends the
# same marker locally the instant it aborts.
INTERRUPTED_SUFFIX = " \u23f9"

app = FastAPI(title="jarvis-orchestrator", version=__version__)
store = SessionStore(settings.session_db_path, max_history=settings.max_history)
_memory: PromotedMemory | None = None


def mem() -> PromotedMemory:
    global _memory
    if _memory is None:
        _memory = PromotedMemory(settings.memory_db_path)
    return _memory

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)


class TurnIn(BaseModel):
    text: str = Field(min_length=1, max_length=8000)
    session_id: str | None = None


class TtsIn(BaseModel):
    text: str = Field(min_length=1, max_length=4000)


def _load_text(path: str, fallback: str) -> str:
    try:
        with open(path, encoding="utf-8") as f:
            return f.read().strip()
    except OSError:
        return fallback


def system_prompt() -> str:
    persona = _load_text(
        settings.persona_path,
        "You are JARVIS. Dry British wit. Precise. Honest. Address Gordon.",
    )
    briefing = _load_text(settings.briefing_path, "")
    parts = [persona]
    if briefing:
        parts.append("Lab briefing (stable facts):\n" + briefing[:6000])
    facts = mem().active_facts(settings.memory_inject_limit)
    if facts:
        bullet = "\n".join(f"- {f}" for f in facts)
        parts.append("Promoted memory (Gordon asked you to remember):\n" + bullet)
    parts.append(
        "You have no tools in this turn. Do not invent live cluster numbers; "
        "say you do not know if not in the briefing or promoted memory. "
        + talker_note()
        + " "
        "Never say you will remember, have remembered, forgotten, or deleted "
        "a fact — the orchestrator owns confirm and storage. Never list or "
        "enumerate promoted memory (Gordon uses list memories for that). "
        "Never invent dialogue turns like '### User:' or '### Assistant:'."
    )
    return "\n\n".join(parts)


def _memory_reply(kind: str, fact: str, forgotten: list[str] | None = None) -> str:
    if kind == "remember":
        if not fact:
            return (
                "I will not store that — it looks like a secret or it was empty. "
                "Say it again without credentials, sir."
            )
        return f"Noted. I will remember: {fact}"
    if kind == "forget":
        removed = forgotten or []
        if not removed:
            return "I found nothing matching that to forget."
        if len(removed) == 1:
            return f"Forgotten: {removed[0]}"
        preview = "; ".join(removed[:3])
        extra = f" (+{len(removed) - 3} more)" if len(removed) > 3 else ""
        return f"Forgotten {len(removed)} facts: {preview}{extra}"
    if kind == "forget_all":
        removed = forgotten or []
        if not removed:
            return "Promoted memory was already empty."
        return (
            f"Forgotten. All {len(removed)} memories, facts, and preferences are gone."
        )
    return ""


_FORGED_TURN = re.compile(r"^\s*#{0,3}\s*(User|Assistant)\s*:", re.I)
_PREMATURE_REMEMBER = re.compile(
    r"\b(I(?:['’]ll| will) remember|I have remembered|Shall I remember)\b",
    re.I,
)


def _scrub_for_memory_confirm(reply: str) -> str:
    """Drop talker claims of memory / forged transcript before confirm ask."""
    lines: list[str] = []
    for line in (reply or "").splitlines():
        if _FORGED_TURN.match(line):
            continue
        if _PREMATURE_REMEMBER.search(line):
            continue
        lines.append(line)
    out = "\n".join(lines).strip()
    return out or "Understood."


# Set when the classifier was confident the turn is about this lab but named
# no capability. The talker then gets an extra instruction, because that is
# precisely when it invents: asked "anything broken?" with a verbless verdict
# it once replied "the last health check indicated everything was running
# smoothly", about a cluster it cannot see (D-0038).
_UNPLACED_LAB_NOTE = (
    "The router is confident this asks about the live state of Gordon's lab "
    "but matched no capability. You have no live data and no tools. Say you "
    "could not check, and offer to be asked a more specific way. Do not "
    "describe the cluster, and do not refer to an earlier check."
)


async def _apply_classifier(text: str, decision: Any) -> tuple[Any, bool]:
    """Let the local classifier speak when the deterministic pass had no answer.

    Only ever called on a fall-through, so a turn that matched a verb costs
    nothing extra. In `shadow` the verdict is logged and discarded, which is
    how the model gets scored against Gordon's real traffic before it is
    allowed to change a reply (D-0033).
    """
    mode = (settings.router_classifier or "off").strip().lower()
    if mode not in ("shadow", "on"):
        return decision, False
    if decision.label not in (CHAT, UNSUPPORTED):
        return decision, False

    verdict = await classify(text)
    unplaced = bool(
        verdict is not None
        and getattr(verdict, "kind", None) == "capability"
        and not getattr(verdict, "verb", None)
        and float(getattr(verdict, "confidence", 0.0) or 0.0)
        >= settings.classifier_min_confidence
    )
    proposed = combine(
        text,
        decision,
        verdict,
        min_confidence=settings.classifier_min_confidence,
        min_confidence_write=settings.classifier_min_confidence_write,
    )
    log.info(
        "router mode=%s deterministic=%s verdict=%s/%s conf=%.2f applied=%s text=%r",
        mode,
        decision.label,
        getattr(verdict, "kind", None),
        getattr(verdict, "verb", None),
        float(getattr(verdict, "confidence", 0.0) or 0.0),
        proposed.label if mode == "on" else decision.label,
        text[:120],
    )
    if mode != "on":
        return decision, False
    return proposed, (unplaced and proposed.label == CHAT)


def _temp_unit() -> str:
    return gpu_temp_unit(mem().active_facts(40))


@app.get("/readyz")
async def readyz() -> dict[str, bool]:
    """Fast liveness/readiness — does not call LiteLLM."""
    return {"ok": True}


@app.get("/health")
async def health() -> dict[str, Any]:
    llm_ok, llm_reason = await health_llm()
    stt_ok, stt_reason = await health_whisper()
    tts_ok, tts_reason = await health_piper()
    hands_ok, hands_reason = await health_hands()
    degraded = not llm_ok
    reason = None if llm_ok else llm_reason
    if not degraded and not stt_ok:
        reason = stt_reason
    elif not degraded and not tts_ok:
        reason = tts_reason
    elif not degraded and not hands_ok:
        # Soft — talker still works; glass banners Hands separately.
        reason = hands_reason
    return {
        "ok": True,
        "service": "jarvis-orchestrator",
        "version": __version__,
        "degraded": degraded,
        "reason": reason,
        "llm": llm_ok,
        "stt": stt_ok,
        "tts": tts_ok,
        "hands": hands_ok,
        "mock": settings.mock_llm,
        "memory_facts": len(mem().active_facts(500)),
    }


@app.get("/v1/pulse")
async def pulse() -> dict[str, Any]:
    """Rack snapshot for the breath chips + NOC. Unknown fields are null."""
    return await get_pulse()


@app.get("/v1/weather")
async def weather_at(lat: float, lon: float) -> dict[str, Any]:
    """Weather for the caller's point. The house reading on /v1/pulse is unchanged."""
    if not (-90.0 <= lat <= 90.0 and -180.0 <= lon <= 180.0):
        raise HTTPException(status_code=400, detail="lat/lon out of range")
    body = await get_weather_at(lat, lon)
    if body is None:
        raise HTTPException(status_code=502, detail="weather unavailable")
    return body


@app.get("/v1/session")
async def get_session(x_session_id: str | None = Header(default=None, alias="X-Session-Id")) -> dict[str, Any]:
    sid = x_session_id or str(uuid.uuid4())
    sess = store.get_or_create(sid)
    briefing = assemble_briefing(_load_text(settings.briefing_path, ""))
    # briefing.md carries the stable lab facts; the cluster supplies what
    # actually happened overnight. An operator-written Overnight section wins.
    cluster = await build_cluster_briefing()
    if not briefing.get("overnight") and cluster.get("overnight"):
        briefing["overnight"] = cluster["overnight"]
    if not briefing.get("today") and cluster.get("today"):
        briefing["today"] = cluster["today"]
    out: dict[str, Any] = {
        "session_id": sess.id,
        "messages": sess.messages,
        "created_at": sess.created_at,
        "greeting": settings.greeting,
        "briefing_blurb": settings.briefing_blurb,
        "briefing": briefing,
    }
    pending = pending_alive(store.get_pending(sess.id))
    if store.get_pending(sess.id) and not pending:
        store.set_pending(sess.id, None)
    if pending:
        kind = str(pending.get("kind") or "hands")
        confirm: dict[str, Any] = {
            "id": pending["id"],
            "kind": kind,
            "summary": pending.get("summary") or pending.get("fact") or pending.get("verb"),
        }
        if kind == "memory":
            confirm["fact"] = pending.get("fact")
            confirm["facts"] = pending.get("facts") or []
            confirm["verb"] = pending.get("verb") or (
                "memory.forget"
                if pending.get("action") == "forget"
                else "memory.remember"
            )
        else:
            confirm["verb"] = pending.get("verb")
            confirm["args"] = pending.get("args") or {}
        out["confirm"] = confirm
    return out



@app.post("/v1/tts")
async def post_tts(body: TtsIn) -> Response:
    """Proxy Piper speech (D-0014 / D-0020). Glass never talks to Piper directly."""
    try:
        data, ctype = await synthesize(body.text)
    except Exception as e:  # noqa: BLE001
        log.exception("tts failed")
        raise HTTPException(502, "tts error") from e
    return Response(content=data, media_type=ctype)


@app.post("/v1/stt")
async def post_stt(request: Request) -> dict[str, str]:
    """STT only (D-0014 laptop local commands). Does not create a chat turn."""
    form = await request.form()
    upload = form.get("audio") or form.get("file")
    if upload is None:
        raise HTTPException(400, "missing audio")
    data = await upload.read()  # type: ignore[union-attr]
    filename = getattr(upload, "filename", None) or "audio.webm"
    content_type = getattr(upload, "content_type", None) or "audio/webm"
    try:
        text = await transcribe(filename, content_type, data)
    except Exception as e:  # noqa: BLE001
        log.exception("stt failed")
        raise HTTPException(502, "stt error") from e
    if not text:
        raise HTTPException(400, "empty transcript")
    return {"transcript": text}


@app.post("/v1/turns")
async def post_turn(request: Request) -> Response:
    """Text JSON or multipart audio (orchestrator proxies Whisper — D-0016)."""
    ctype = (request.headers.get("content-type") or "").lower()
    text = ""
    sid = request.headers.get("X-Session-Id")

    if "multipart/form-data" in ctype:
        form = await request.form()
        sid = str(form.get("session_id") or sid or "") or None
        upload = form.get("audio") or form.get("file")
        if upload is None:
            raise HTTPException(400, "missing audio")
        data = await upload.read()  # type: ignore[union-attr]
        filename = getattr(upload, "filename", None) or "audio.webm"
        content_type = getattr(upload, "content_type", None) or "audio/webm"
        try:
            text = await transcribe(filename, content_type, data)
        except Exception as e:  # noqa: BLE001
            log.exception("stt failed")
            raise HTTPException(502, "stt error") from e
        if not text:
            raise HTTPException(400, "empty transcript")
    else:
        try:
            body = TurnIn.model_validate(await request.json())
        except Exception as e:  # noqa: BLE001
            raise HTTPException(400, "invalid json") from e
        text = body.text.strip()
        sid = body.session_id or sid

    if not text:
        raise HTTPException(400, "empty text")

    return await _run_turn(text=text, session_id=sid, request=request)


async def _run_turn(*, text: str, session_id: str | None, request: Request) -> Response:
    # A session command is not a turn. It is handled before the utterance is
    # written, so the phrase itself is not kept.
    accept = request.headers.get("accept", "")
    want_sse = "text/event-stream" in accept or request.query_params.get("stream") == "1"
    kind = parse_session_intent(text)
    if kind:
        if kind == "discard" and session_id:
            store.discard(session_id)
        fresh = store.get_or_create(None)
        payload: dict[str, Any] = {
            "session_id": fresh.id,
            "reply_text": "",
            "degraded": False,
            "session_reset": kind,
            "route": f"session.{kind}",
        }

        if want_sse:

            async def gen() -> AsyncIterator[bytes]:
                yield _sse("meta", {"session_id": fresh.id, "session_reset": kind})
                yield _sse("done", payload)

            return StreamingResponse(gen(), media_type="text/event-stream")
        return JSONResponse(payload)

    sid = session_id or str(uuid.uuid4())
    sess = store.get_or_create(sid)
    store.append(sess.id, "user", text)
    # Which route the turn resolved to, surfaced on the response so
    # scripts/ask.py can show it. A hands verb was already visible via
    # `verb`; memory and local capabilities were not, which made "did that
    # reach the talker?" unanswerable without pod logs.
    resolved_label: str | None = None

    def _reply(
        reply: str,
        *,
        verb: str | None = None,
        confirm: dict[str, Any] | None = None,
        extra: dict[str, Any] | None = None,
        candidate: str | None = None,
        fact: str | None = None,
    ) -> Response:
        # Record what the next turn's "that" may point at (D-0035). Passing
        # None clears a key, so last_candidate does not survive a turn that
        # found nothing — otherwise "remember that" could reach back and grab
        # something said five exchanges ago.
        ref: dict[str, Any] = {
            "last_user_text": text,
            "last_candidate": candidate,
            "last_verb": verb,
        }
        if fact:
            ref["last_fact_text"] = fact
        store.set_referents(sess.id, **ref)
        store.append(sess.id, "assistant", reply)
        payload: dict[str, Any] = {
            "session_id": sess.id,
            "reply_text": reply,
            "degraded": False,
            "transcript": text,
        }
        if resolved_label:
            payload["route"] = resolved_label
        if verb:
            payload["verb"] = verb
        if confirm:
            payload["confirm"] = confirm
        if extra:
            payload.update(extra)
        if want_sse:

            async def gen() -> AsyncIterator[bytes]:
                yield _sse("meta", {"session_id": sess.id, "transcript": text})
                yield _sse("token", {"text": reply})
                yield _sse("done", payload)

            return StreamingResponse(gen(), media_type="text/event-stream")
        return JSONResponse(payload)

    deterministic = route(text)
    resolved_label = deterministic.label

    # Resolve pending confirm before memory/verbs (yes/cancel).
    raw_pending = store.get_pending(sess.id)
    pending = pending_alive(raw_pending)
    if raw_pending and not pending:
        store.set_pending(sess.id, None)
    if not pending and (is_affirm(text) or is_cancel(text)):
        return _reply("Nothing pending to confirm or cancel.")
    if pending:
        kind = str(pending.get("kind") or "hands")
        # Report what the confirm resolves to, not the route of the word
        # "yes" — which is `chat`, and says the talker answered when the
        # orchestrator actually wrote a fact or bounced a pod. A diagnostic
        # field that lies is worse than no field.
        resolved_label = str(
            pending.get("verb")
            or (
                "memory.forget"
                if pending.get("action") == "forget"
                else "memory.remember"
            )
        )
        # "remember that" while a remember confirm is open means yes. Without
        # this it fell through to "Still waiting: ... say yes or cancel",
        # which is the exchange that made JARVIS feel obtuse: he had just
        # offered to remember the thing and then refused to take the answer.
        affirmed = is_affirm(text) or (
            kind == "memory"
            and str(pending.get("action") or "remember") == "remember"
            and deterministic.label == MEMORY_REMEMBER_REF
        )
        if affirmed:
            store.set_pending(sess.id, None)
            if kind == "memory":
                action = str(pending.get("action") or "remember")
                if action == "forget_all":
                    removed = mem().forget_all()
                    return _reply(
                        _memory_reply("forget_all", "", forgotten=removed),
                        confirm=None,
                        extra={"memory": "forget_all"},
                    )
                if action == "forget":
                    targets = [
                        str(x)
                        for x in (pending.get("facts") or [])
                        if str(x).strip()
                    ]
                    if not targets and pending.get("fact"):
                        targets = [str(pending["fact"])]
                    removed = mem().forget_texts(targets) if targets else []
                    return _reply(
                        _memory_reply("forget", "", forgotten=removed),
                        confirm=None,
                        extra={"memory": "forget"},
                    )
                fact = str(pending.get("fact") or "").strip()
                if fact:
                    mem().remember(fact, source_turn=sess.id)
                    return _reply(
                        f"Noted. I will remember: {fact}",
                        confirm=None,
                        extra={"memory": "remember"},
                        fact=fact,
                    )
                return _reply("Nothing to remember.")
            try:
                body = await execute_verb(
                    pending["verb"],
                    args=pending.get("args") or {},
                    confirmed=True,
                )
                reply = format_verb_reply(
                    pending["verb"], body, temp_unit=_temp_unit()
                )
                audit_verb(
                    settings.memory_db_path,
                    verb=pending["verb"],
                    ok=True,
                    detail=(body.get("text") or str(body))[:500],
                    session_id=sess.id,
                )
            except Exception as e:  # noqa: BLE001
                log.exception("confirm execute %s failed", pending["verb"])
                reply = (
                    f"I could not complete {pending['verb']} "
                    f"({type(e).__name__}). Try again shortly."
                )
                audit_verb(
                    settings.memory_db_path,
                    verb=pending["verb"],
                    ok=False,
                    detail=str(e)[:500],
                    session_id=sess.id,
                )
            return _reply(reply, verb=pending["verb"])
        if is_cancel(text):
            store.set_pending(sess.id, None)
            if kind == "memory":
                action = str(pending.get("action") or "remember")
                if action == "forget_all":
                    return _reply("Cancelled — I will not wipe your memory.")
                if action == "forget":
                    return _reply("Cancelled — I will not forget that.")
                return _reply("Cancelled — I will not store that.")
            audit_verb(
                settings.memory_db_path,
                verb=pending["verb"],
                ok=False,
                detail="cancelled",
                session_id=sess.id,
            )
            return _reply("Cancelled.", verb=pending["verb"])
        summary = pending.get("summary") or pending.get("fact") or pending.get("verb")
        confirm: dict[str, Any] = {
            "id": pending["id"],
            "kind": kind,
            "summary": summary,
        }
        if kind == "hands":
            confirm["verb"] = pending.get("verb")
            confirm["args"] = pending.get("args") or {}
        else:
            confirm["fact"] = pending.get("fact")
            confirm["facts"] = pending.get("facts") or []
            confirm["verb"] = pending.get("verb") or (
                "memory.forget"
                if pending.get("action") == "forget"
                else "memory.remember"
            )
        return _reply(
            f"Still waiting: {summary}. Say yes or cancel.",
            verb=confirm.get("verb") if kind == "hands" else None,
            confirm=confirm,
        )

    decision, unplaced_lab = await _apply_classifier(text, deterministic)
    resolved_label = decision.label

    if decision.label == MEMORY_LIST:
        facts = mem().active_facts(200)
        return _reply(format_list_reply(facts), extra={"memory": "list"})

    # "remember that" / "forget that" with nothing after the pronoun. The
    # referent is in the previous turn, which this orchestrator does not track
    # yet. Say so — the old behaviour stored the word "that" as a fact, and
    # matched it against every stored fact on the way back out.
    if decision.label == MEMORY_REMEMBER_REF:
        refs = store.get_referents(sess.id)
        candidate = str(refs.get("last_candidate") or "").strip()
        if not candidate:
            # Nothing was spotted at the time, so look again at what he
            # actually said last. Cheap heuristic first, then the D-0025
            # extractor — same order, and the same confirm gate, as a fresh
            # utterance would get.
            previous = str(refs.get("last_user_text") or "").strip()
            if previous:
                candidate = parse_memory_candidate(previous) or ""
                if not candidate and eligible_for_llm_extract(previous):
                    candidate = await extract_memory_fact(previous) or ""
        if not candidate:
            return _reply(
                "I am not sure which part you would like me to keep, sir. "
                "Say it again with the fact in it \u2014 "
                "\u201cremember that I take my coffee black\u201d.",
                extra={"memory": "remember"},
            )
        if fact_already_known(candidate, mem().active_facts(200)):
            return _reply(f"Already noted: {candidate}", extra={"memory": "remember"})
        pending_obj = new_memory_pending(candidate)
        store.set_pending(sess.id, pending_obj)
        return _reply(
            f"Shall I remember: {candidate}? Say yes or cancel.",
            confirm={
                "id": pending_obj["id"],
                "kind": "memory",
                "verb": "memory.remember",
                "fact": candidate,
                "summary": pending_obj["summary"],
            },
        )

    if decision.label == MEMORY_FORGET_REF:
        refs = store.get_referents(sess.id)
        target = str(refs.get("last_fact_text") or "").strip()
        # Only offer it if it is still there — he may have dropped it already.
        if target and target in mem().active_facts(500):
            pending_obj = new_memory_pending(target, action="forget", facts=[target])
            store.set_pending(sess.id, pending_obj)
            return _reply(
                format_forget_confirm_ask([target]),
                confirm={
                    "id": pending_obj["id"],
                    "kind": "memory",
                    "verb": "memory.forget",
                    "fact": target,
                    "facts": [target],
                    "summary": pending_obj["summary"],
                },
            )
        return _reply(
            "I am not sure which memory you mean, sir. "
            "Say \u201clist memories\u201d and name the one to drop.",
            extra={"memory": "forget"},
        )

    if decision.label == MEMORY_REMEMBER:
        if decision.fact and fact_already_known(
            decision.fact, mem().active_facts(200)
        ):
            return _reply(
                f"Already noted: {decision.fact}",
                extra={"memory": "remember"},
            )
        if decision.fact:
            mem().remember(decision.fact, source_turn=sess.id)
        reply = _memory_reply("remember", decision.fact)
        return _reply(
            reply, extra={"memory": "remember"}, fact=decision.fact or None
        )

    if decision.label == MEMORY_FORGET_ALL:
        count = mem().count_active()
        if count == 0:
            return _reply(
                "Promoted memory is already empty — nothing to forget.",
                extra={"memory": "forget_all"},
            )
        preview = mem().active_facts(5)
        pending_obj = new_memory_pending("", action="forget_all", facts=preview)
        confirm = {
            "id": pending_obj["id"],
            "kind": "memory",
            "verb": "memory.forget_all",
            "fact": "",
            "facts": preview,
            "summary": pending_obj["summary"],
        }
        return _reply(format_forget_all_ask(count, preview), confirm=confirm)

    if decision.label == MEMORY_FORGET:
        targets = mem().matching_facts(decision.fact) if decision.fact else []
        if not targets:
            return _reply(
                "I found nothing matching that to forget.",
                extra={"memory": "forget"},
            )
        pending_obj = new_memory_pending(
            targets[0] if len(targets) == 1 else "",
            action="forget",
            facts=targets,
        )
        store.set_pending(sess.id, pending_obj)
        confirm = {
            "id": pending_obj["id"],
            "kind": "memory",
            "verb": "memory.forget",
            "fact": pending_obj.get("fact") or "",
            "facts": targets,
            "summary": pending_obj["summary"],
        }
        return _reply(format_forget_confirm_ask(targets), confirm=confirm)

    # Preference/identity heuristic hit. Skip the talker — it avoids a
    # premature "I will remember" and a free LLM round-trip (D-0024 / D-0026).
    if decision.label == MEMORY_CANDIDATE:
        soft_candidate = decision.fact
        if fact_already_known(soft_candidate, mem().active_facts(200)):
            return _reply(
                f"Already noted: {soft_candidate}",
                extra={"memory": "remember"},
            )
        pending_obj = new_memory_pending(soft_candidate)
        store.set_pending(sess.id, pending_obj)
        confirm = {
            "id": pending_obj["id"],
            "kind": "memory",
            "verb": "memory.remember",
            "fact": soft_candidate,
            "summary": pending_obj["summary"],
        }
        return _reply(
            f"Shall I remember: {soft_candidate}? Say yes or cancel.",
            confirm=confirm,
            candidate=soft_candidate,
        )

    if decision.label == META_CAPABILITIES:
        return _reply(spoken_list(), verb=META_CAPABILITIES)

    # Plainly about this house, and nothing in the manifest serves it. Answer
    # from the manifest rather than handing it to a talker with no data — that
    # path invented "the last update I recall was from yesterday" about a
    # cluster it cannot see (D-0033).
    if decision.label == UNSUPPORTED:
        return _reply(refusal(), extra={"unsupported": True})

    # Capabilities the orchestrator serves itself — Prometheus and local
    # reads (D-0036). No shim round trip, so these still answer when Hands is
    # down, which is exactly when the question gets asked.
    if decision.is_self_served:
        handler = LOCAL_VERBS.get(decision.label)
        if handler is not None:
            try:
                reply, data = await handler(**(decision.args or {}))
                audit_verb(
                    settings.memory_db_path,
                    verb=decision.label,
                    ok=True,
                    detail=reply[:500],
                    session_id=sess.id,
                )
            except Exception as e:  # noqa: BLE001
                log.exception("local verb %s failed", decision.label)
                reply = (
                    f"I could not answer {decision.label} just now "
                    f"({type(e).__name__})."
                )
                audit_verb(
                    settings.memory_db_path,
                    verb=decision.label,
                    ok=False,
                    detail=str(e)[:500],
                    session_id=sess.id,
                )
            return _reply(reply, verb=decision.label)

    if decision.is_verb:
        name = decision.label
        if decision.verb_class == "confirm":
            if not decision.args:
                _args, err = parse_confirm_args(name, text)
                return _reply(err or "I need a clearer target for that action.")
            try:
                prop = await propose_confirm(name, decision.args)
            except Exception as e:  # noqa: BLE001
                log.exception("propose %s failed", name)
                return _reply(
                    f"I could not prepare {name} ({type(e).__name__}). "
                    "Check the name and try again."
                )
            pending_obj = new_pending(prop["verb"], prop["args"], prop["summary"])
            store.set_pending(sess.id, pending_obj)
            audit_verb(
                settings.memory_db_path,
                verb=name,
                ok=False,
                detail="awaiting_confirm:" + prop["summary"][:400],
                session_id=sess.id,
            )
            confirm = {
                "id": pending_obj["id"],
                "kind": "hands",
                "verb": prop["verb"],
                "args": prop["args"],
                "summary": prop["summary"],
            }
            return _reply(prop["text"], verb=name, confirm=confirm)

        try:
            body = await execute_verb(name)
            reply = format_verb_reply(name, body, temp_unit=_temp_unit())
            audit_verb(
                settings.memory_db_path,
                verb=name,
                ok=True,
                detail=(body.get("text") or str(body))[:500],
                session_id=sess.id,
            )
        except Exception as e:  # noqa: BLE001
            log.exception("verb %s failed", name)
            reply = (
                f"I could not run {name} just now "
                f"({type(e).__name__}). Live numbers need Hands — try again shortly."
            )
            audit_verb(
                settings.memory_db_path,
                verb=name,
                ok=False,
                detail=str(e)[:500],
                session_id=sess.id,
            )
        return _reply(reply, verb=name)

    system = system_prompt()
    if unplaced_lab:
        system += "\n\n" + _UNPLACED_LAB_NOTE
    messages: list[dict[str, str]] = [{"role": "system", "content": system}]
    for m in sess.messages[-settings.max_history :]:
        messages.append({"role": m["role"], "content": m["content"]})

    def _record_talker_turn(candidate: str | None) -> None:
        """The talker paths bypass _reply, so they record referents here."""
        store.set_referents(
            sess.id,
            last_user_text=text,
            last_candidate=candidate,
            last_verb=None,
        )

    async def _maybe_memory_confirm(reply: str) -> tuple[str, dict[str, Any] | None]:
        """Append memory confirm ask after talker reply (heuristic, then LLM)."""
        candidate = parse_memory_candidate(text)
        if not candidate and eligible_for_llm_extract(text):
            candidate = await extract_memory_fact(text)
        _record_talker_turn(candidate)
        if not candidate:
            return reply, None
        if fact_already_known(candidate, mem().active_facts(200)):
            return reply, None
        pending_obj = new_memory_pending(candidate)
        store.set_pending(sess.id, pending_obj)
        ask = f"Shall I remember: {candidate}? Say yes or cancel."
        cleaned = _scrub_for_memory_confirm(reply)
        combined = (cleaned.rstrip() + "\n\n" + ask) if cleaned else ask
        confirm = {
            "id": pending_obj["id"],
            "kind": "memory",
            "verb": "memory.remember",
            "fact": candidate,
            "summary": pending_obj["summary"],
        }
        return combined, confirm

    if want_sse:

        async def event_gen() -> AsyncIterator[bytes]:
            yield _sse("meta", {"session_id": sess.id, "transcript": text})
            chunks: list[str] = []
            try:
                async for token in chat_stream(messages):
                    chunks.append(token)
                    yield _sse("token", {"text": token})
            except asyncio.CancelledError:
                # Barge-in: glass aborted the stream. Without this the whole
                # reply is dropped and the session shows a question with no
                # answer at all, so keep exactly what was delivered and mark it
                # truncated. Cancellation still has to propagate.
                partial = "".join(chunks).strip()
                if partial:
                    store.append(sess.id, "assistant", partial + INTERRUPTED_SUFFIX)
                raise
            except Exception as e:  # noqa: BLE001 — surface to glass
                log.exception("turn failed")
                safe = "llm error"
                err = str(e)
                if "http" in err and "Bearer" not in err and "sk-" not in err:
                    safe = err
                yield _sse("error", {"message": safe})
                yield _sse("done", {"session_id": sess.id, "degraded": True})
                return
            reply = "".join(chunks).strip()
            base = reply
            reply, confirm = await _maybe_memory_confirm(reply)
            if confirm and reply != base and reply.startswith(base):
                # Scrubbed replies are applied via done.reply_text (glass).
                yield _sse("token", {"text": reply[len(base) :]})
            if reply:
                store.append(sess.id, "assistant", reply)
            done: dict[str, Any] = {
                "session_id": sess.id,
                "reply_text": reply,
                "degraded": False,
                "transcript": text,
                "route": resolved_label,
            }
            if confirm:
                done["confirm"] = confirm
            yield _sse("done", done)

        return StreamingResponse(event_gen(), media_type="text/event-stream")

    chunks: list[str] = []
    try:
        async for token in chat_stream(messages):
            chunks.append(token)
    except Exception as e:  # noqa: BLE001
        log.exception("turn failed")
        raise HTTPException(502, "llm error") from e
    reply = "".join(chunks).strip()
    reply, confirm = await _maybe_memory_confirm(reply)
    if reply:
        store.append(sess.id, "assistant", reply)
    payload: dict[str, Any] = {
        "session_id": sess.id,
        "reply_text": reply,
        "degraded": False,
        "transcript": text,
        "route": resolved_label,
    }
    if confirm:
        payload["confirm"] = confirm
    return JSONResponse(payload)


def _sse(event: str, data: dict[str, Any]) -> bytes:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n".encode()


@app.get("/")
async def root() -> dict[str, str]:
    return {"service": "jarvis-orchestrator", "docs": "/docs", "health": "/health"}
