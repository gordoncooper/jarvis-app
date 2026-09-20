from __future__ import annotations

import logging

import httpx

from .config import settings

log = logging.getLogger("jarvis.orchestrator.tts")


async def synthesize(text: str) -> tuple[bytes, str]:
    """POST text to cluster Piper (D-0014 — orchestrator owns TTS contract)."""
    clean = " ".join((text or "").split())
    if not clean:
        raise RuntimeError("empty text")
    if len(clean) > 4000:
        clean = clean[:4000]
    url = settings.piper_base.rstrip("/") + "/v1/audio/speech"
    payload = {
        "model": settings.piper_model,
        "voice": settings.piper_voice,
        "input": clean,
        "response_format": "wav",
    }
    async with httpx.AsyncClient(timeout=60.0) as client:
        r = await client.post(url, json=payload)
        if r.status_code >= 400:
            raise RuntimeError(f"piper http {r.status_code}")
        data = r.content
        if not data:
            raise RuntimeError("piper empty audio")
        ctype = r.headers.get("content-type") or "audio/wav"
        return data, ctype


async def health_piper() -> tuple[bool, str | None]:
    url = settings.piper_base.rstrip("/") + "/health"
    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            r = await client.get(url)
            if r.status_code < 500:
                return True, None
            return False, f"piper http {r.status_code}"
    except Exception:  # noqa: BLE001
        return False, "piper unreachable"
