"""Jarvis orchestrator — product brain (D-0012, D-0020)."""

from __future__ import annotations

import json
import logging
import uuid
from collections.abc import AsyncIterator
from typing import Any

from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response, StreamingResponse
from pydantic import BaseModel, Field

from .config import settings
from .llm import chat_stream, health_llm
from .memory import PromotedMemory, parse_memory_intent
from .session_store import SessionStore
from .hands import (
    audit_verb,
    execute_verb,
    format_verb_reply,
    health_hands,
    match_verb,
)
from .stt import health_whisper, transcribe
from .tts import health_piper, synthesize

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("jarvis.orchestrator")

app = FastAPI(title="jarvis-orchestrator", version="0.6.7-dev")
store = SessionStore()
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
        "Cluster health, GPU metrics, and the lab map are handled as declared "
        "verbs before this talker runs — do not pretend you queried them."
    )
    return "\n\n".join(parts)


def _memory_reply(kind: str, fact: str, forgotten: int = 0) -> str:
    if kind == "remember":
        if not fact:
            return (
                "I will not store that — it looks like a secret or it was empty. "
                "Say it again without credentials, sir."
            )
        return f"Noted. I will remember: {fact}"
    if kind == "forget":
        if forgotten:
            return f"Forgotten ({forgotten})."
        return "I found nothing matching that to forget."
    return ""


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
    return {
        "ok": True,
        "service": "jarvis-orchestrator",
        "version": "0.6.7-dev",
        "degraded": degraded,
        "reason": reason,
        "llm": llm_ok,
        "stt": stt_ok,
        "tts": tts_ok,
        "hands": hands_ok,
        "mock": settings.mock_llm,
        "memory_facts": len(mem().active_facts(500)),
    }


@app.get("/v1/session")
async def get_session(x_session_id: str | None = Header(default=None, alias="X-Session-Id")) -> dict[str, Any]:
    sid = x_session_id or str(uuid.uuid4())
    sess = store.get_or_create(sid)
    return {
        "session_id": sess.id,
        "messages": sess.messages,
        "created_at": sess.created_at,
        "greeting": settings.greeting,
        "briefing_blurb": settings.briefing_blurb,
    }


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

    intent = parse_memory_intent(text)
    if intent.kind in ("remember", "forget"):
        forgotten = 0
        if intent.kind == "remember":
            if intent.fact:
                mem().remember(intent.fact, source_turn=sess.id)
            reply = _memory_reply("remember", intent.fact)
        else:
            forgotten = mem().forget(intent.fact) if intent.fact else 0
            reply = _memory_reply("forget", intent.fact, forgotten=forgotten)
        store.append(sess.id, "assistant", reply)
        accept = request.headers.get("accept", "")
        want_sse = "text/event-stream" in accept or request.query_params.get("stream") == "1"
        if want_sse:

            async def mem_gen() -> AsyncIterator[bytes]:
                yield _sse("meta", {"session_id": sess.id, "transcript": text})
                yield _sse("token", {"text": reply})
                yield _sse(
                    "done",
                    {
                        "session_id": sess.id,
                        "reply_text": reply,
                        "degraded": False,
                        "memory": intent.kind,
                        "transcript": text,
                    },
                )

            return StreamingResponse(mem_gen(), media_type="text/event-stream")
        return JSONResponse(
            {
                "session_id": sess.id,
                "reply_text": reply,
                "degraded": False,
                "memory": intent.kind,
                "transcript": text,
            }
        )

    hit = match_verb(text)
    if hit is not None:
        accept = request.headers.get("accept", "")
        want_sse = "text/event-stream" in accept or request.query_params.get("stream") == "1"
        try:
            raw = await execute_verb(hit.name)
            reply = format_verb_reply(hit.name, raw)
            audit_verb(
                settings.memory_db_path,
                verb=hit.name,
                ok=True,
                detail=raw[:500],
                session_id=sess.id,
            )
        except Exception as e:  # noqa: BLE001
            log.exception("verb %s failed", hit.name)
            reply = (
                f"I could not run {hit.name} just now "
                f"({type(e).__name__}). Live numbers need Hands — try again shortly."
            )
            audit_verb(
                settings.memory_db_path,
                verb=hit.name,
                ok=False,
                detail=str(e)[:500],
                session_id=sess.id,
            )
        store.append(sess.id, "assistant", reply)
        if want_sse:

            async def verb_gen() -> AsyncIterator[bytes]:
                yield _sse("meta", {"session_id": sess.id, "transcript": text})
                yield _sse("token", {"text": reply})
                yield _sse(
                    "done",
                    {
                        "session_id": sess.id,
                        "reply_text": reply,
                        "degraded": False,
                        "verb": hit.name,
                        "transcript": text,
                    },
                )

            return StreamingResponse(verb_gen(), media_type="text/event-stream")
        return JSONResponse(
            {
                "session_id": sess.id,
                "reply_text": reply,
                "degraded": False,
                "verb": hit.name,
                "transcript": text,
            }
        )

    messages: list[dict[str, str]] = [{"role": "system", "content": system_prompt()}]
    for m in sess.messages[-settings.max_history :]:
        messages.append({"role": m["role"], "content": m["content"]})

    accept = request.headers.get("accept", "")
    want_sse = "text/event-stream" in accept or request.query_params.get("stream") == "1"

    if want_sse:

        async def event_gen() -> AsyncIterator[bytes]:
            yield _sse("meta", {"session_id": sess.id, "transcript": text})
            chunks: list[str] = []
            try:
                async for token in chat_stream(messages):
                    chunks.append(token)
                    yield _sse("token", {"text": token})
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
            if reply:
                store.append(sess.id, "assistant", reply)
            yield _sse(
                "done",
                {
                    "session_id": sess.id,
                    "reply_text": reply,
                    "degraded": False,
                    "transcript": text,
                },
            )

        return StreamingResponse(event_gen(), media_type="text/event-stream")

    chunks: list[str] = []
    try:
        async for token in chat_stream(messages):
            chunks.append(token)
    except Exception as e:  # noqa: BLE001
        log.exception("turn failed")
        raise HTTPException(502, "llm error") from e
    reply = "".join(chunks).strip()
    if reply:
        store.append(sess.id, "assistant", reply)
    return JSONResponse(
        {
            "session_id": sess.id,
            "reply_text": reply,
            "degraded": False,
            "transcript": text,
        }
    )


def _sse(event: str, data: dict[str, Any]) -> bytes:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n".encode()


@app.get("/")
async def root() -> dict[str, str]:
    return {"service": "jarvis-orchestrator", "docs": "/docs", "health": "/health"}
