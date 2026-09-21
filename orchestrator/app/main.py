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
    format_forget_confirm_ask,
    format_list_reply,
    gpu_temp_unit,
    new_memory_pending,
    parse_memory_candidate,
)
from .capabilities import refusal, spoken_list, talker_note
from .classify import classify
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


async def _apply_classifier(text: str, decision: Any) -> Any:
    """Let the local classifier speak when the deterministic pass had no answer.

    Only ever called on a fall-through, so a turn that matched a verb costs
    nothing extra. In `shadow` the verdict is logged and discarded, which is
    how the model gets scored against Gordon's real traffic before it is
    allowed to change a reply (D-0033).
    """
    mode = (settings.router_classifier or "off").strip().lower()
    if mode not in ("shadow", "on"):
        return decision
    if decision.label not in (CHAT, UNSUPPORTED):
        return decision

    verdict = await classify(text)
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
    return proposed if mode == "on" else decision


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
    sid = session_id or str(uuid.uuid4())
    sess = store.get_or_create(sid)
    store.append(sess.id, "user", text)
    accept = request.headers.get("accept", "")
    want_sse = "text/event-stream" in accept or request.query_params.get("stream") == "1"

    def _reply(
        reply: str,
        *,
        verb: str | None = None,
        confirm: dict[str, Any] | None = None,
        extra: dict[str, Any] | None = None,
    ) -> Response:
        store.append(sess.id, "assistant", reply)
        payload: dict[str, Any] = {
            "session_id": sess.id,
            "reply_text": reply,
            "degraded": False,
            "transcript": text,
        }
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

    # Resolve pending confirm before memory/verbs (yes/cancel).
    raw_pending = store.get_pending(sess.id)
    pending = pending_alive(raw_pending)
    if raw_pending and not pending:
        store.set_pending(sess.id, None)
    if not pending and (is_affirm(text) or is_cancel(text)):
        return _reply("Nothing pending to confirm or cancel.")
    if pending:
        kind = str(pending.get("kind") or "hands")
        if is_affirm(text):
            store.set_pending(sess.id, None)
            if kind == "memory":
                action = str(pending.get("action") or "remember")
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

    decision = await _apply_classifier(text, route(text))

    if decision.label == MEMORY_LIST:
        facts = mem().active_facts(200)
        return _reply(format_list_reply(facts), extra={"memory": "list"})

    # "remember that" / "forget that" with nothing after the pronoun. The
    # referent is in the previous turn, which this orchestrator does not track
    # yet. Say so — the old behaviour stored the word "that" as a fact, and
    # matched it against every stored fact on the way back out.
    if decision.label == MEMORY_REMEMBER_REF:
        return _reply(
            "I am not sure which part you would like me to keep, sir. "
            "Say it again with the fact in it \u2014 "
            "\u201cremember that I take my coffee black\u201d.",
            extra={"memory": "remember"},
        )
    if decision.label == MEMORY_FORGET_REF:
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
        return _reply(reply, extra={"memory": "remember"})

    if decision.label in (MEMORY_FORGET, MEMORY_FORGET_ALL):
        if decision.label == MEMORY_FORGET_ALL:
            targets = mem().active_facts(500)
        else:
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
        )

    if decision.label == META_CAPABILITIES:
        return _reply(spoken_list(), verb=META_CAPABILITIES)

    # Plainly about this house, and nothing in the manifest serves it. Answer
    # from the manifest rather than handing it to a talker with no data — that
    # path invented "the last update I recall was from yesterday" about a
    # cluster it cannot see (D-0033).
    if decision.label == UNSUPPORTED:
        return _reply(refusal(), extra={"unsupported": True})

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

    messages: list[dict[str, str]] = [{"role": "system", "content": system_prompt()}]
    for m in sess.messages[-settings.max_history :]:
        messages.append({"role": m["role"], "content": m["content"]})

    async def _maybe_memory_confirm(reply: str) -> tuple[str, dict[str, Any] | None]:
        """Append memory confirm ask after talker reply (heuristic, then LLM)."""
        candidate = parse_memory_candidate(text)
        if not candidate and eligible_for_llm_extract(text):
            candidate = await extract_memory_fact(text)
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
    }
    if confirm:
        payload["confirm"] = confirm
    return JSONResponse(payload)


def _sse(event: str, data: dict[str, Any]) -> bytes:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n".encode()


@app.get("/")
async def root() -> dict[str, str]:
    return {"service": "jarvis-orchestrator", "docs": "/docs", "health": "/health"}
