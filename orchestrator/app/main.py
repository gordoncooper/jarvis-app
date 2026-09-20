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
from .session_store import SessionStore

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("jarvis.orchestrator")

app = FastAPI(title="jarvis-orchestrator", version="0.6.0-dev")
store = SessionStore()

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
    parts.append(
        "You have no tools in this turn. Do not invent live cluster numbers; "
        "say you do not know if not in the briefing."
    )
    return "\n\n".join(parts)


@app.get("/health")
async def health() -> dict[str, Any]:
    llm_ok, llm_reason = await health_llm()
    degraded = not llm_ok
    return {
        "ok": True,
        "service": "jarvis-orchestrator",
        "version": "0.6.0-dev",
        "degraded": degraded,
        "reason": None if llm_ok else llm_reason,
        "llm": llm_ok,
        "mock": settings.mock_llm,
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


@app.post("/v1/turns")
async def post_turn(body: TurnIn, request: Request) -> Response:
    text = body.text.strip()
    if not text:
        raise HTTPException(400, "empty text")

    sid = body.session_id or request.headers.get("X-Session-Id") or str(uuid.uuid4())
    sess = store.get_or_create(sid)
    store.append(sess.id, "user", text)

    messages: list[dict[str, str]] = [{"role": "system", "content": system_prompt()}]
    for m in sess.messages[-settings.max_history :]:
        messages.append({"role": m["role"], "content": m["content"]})

    accept = request.headers.get("accept", "")
    want_sse = "text/event-stream" in accept or request.query_params.get("stream") == "1"

    if want_sse:

        async def event_gen() -> AsyncIterator[bytes]:
            yield _sse("meta", {"session_id": sess.id})
            chunks: list[str] = []
            try:
                async for token in chat_stream(messages):
                    chunks.append(token)
                    yield _sse("token", {"text": token})
            except Exception as e:  # noqa: BLE001 — surface to glass
                log.exception("turn failed")
                yield _sse("error", {"message": str(e)})
                yield _sse("done", {"session_id": sess.id, "degraded": True})
                return
            reply = "".join(chunks).strip()
            if reply:
                store.append(sess.id, "assistant", reply)
            yield _sse("done", {"session_id": sess.id, "reply_text": reply, "degraded": False})

        return StreamingResponse(event_gen(), media_type="text/event-stream")

    # Non-SSE: collect full reply
    chunks: list[str] = []
    try:
        async for token in chat_stream(messages):
            chunks.append(token)
    except Exception as e:  # noqa: BLE001
        log.exception("turn failed")
        raise HTTPException(502, f"llm error: {e}") from e
    reply = "".join(chunks).strip()
    if reply:
        store.append(sess.id, "assistant", reply)
    return JSONResponse(
        {
            "session_id": sess.id,
            "reply_text": reply,
            "degraded": False,
        }
    )


def _sse(event: str, data: dict[str, Any]) -> bytes:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n".encode()


@app.get("/")
async def root() -> dict[str, str]:
    return {"service": "jarvis-orchestrator", "docs": "/docs", "health": "/health"}
