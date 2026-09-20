from __future__ import annotations

import logging

import httpx

from .config import settings

log = logging.getLogger("jarvis.orchestrator.stt")


async def transcribe(filename: str, content_type: str, data: bytes) -> str:
    """POST audio to cluster Whisper (D-0016 — orchestrator proxies)."""
    if not data:
        raise RuntimeError("empty audio")
    url = settings.whisper_base.rstrip("/") + "/v1/audio/transcriptions"
    files = {"file": (filename or "audio.webm", data, content_type or "application/octet-stream")}
    form = {
        "model": settings.whisper_model,
        "response_format": "json",
        "language": "en",
    }
    async with httpx.AsyncClient(timeout=120.0) as client:
        r = await client.post(url, files=files, data=form)
        if r.status_code >= 400:
            raise RuntimeError(f"whisper http {r.status_code}")
        payload = r.json()
        text = (payload.get("text") or "").strip()
        if not text:
            raise RuntimeError("whisper empty transcript")
        return text


async def health_whisper() -> tuple[bool, str | None]:
    url = settings.whisper_base.rstrip("/") + "/health"
    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            r = await client.get(url)
            if r.status_code < 500:
                return True, None
            return False, f"whisper http {r.status_code}"
    except Exception:  # noqa: BLE001
        return False, "whisper unreachable"
