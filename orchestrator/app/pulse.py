"""GET /v1/pulse — rack snapshot for Earth chips + NOC (D-0032).

Filled from Hands verbs (cluster.health, cluster.gpus) and health helpers.
Unknown metrics stay null. Never invent GPU temperatures or node counters.
"""

from __future__ import annotations

import asyncio
import logging
import time
from datetime import datetime, timezone
from typing import Any

import httpx

from .config import settings
from .hands import health_hands
from .llm import health_llm
from .pulse_map import assemble_pulse
from .stt import health_whisper
from .tts import health_piper

log = logging.getLogger("jarvis.orchestrator.pulse")

CACHE_TTL_SEC = 2.0
HANDS_TIMEOUT_SEC = 4.0

_cache_lock = asyncio.Lock()
_cache: tuple[float, dict[str, Any]] | None = None


async def _hands_verb(name: str) -> dict[str, Any] | None:
    url = settings.hands_base.rstrip("/") + "/v1/verbs"
    payload = {"verb": name, "args": {}, "confirmed": False}
    try:
        async with httpx.AsyncClient(timeout=HANDS_TIMEOUT_SEC) as client:
            r = await client.post(url, json=payload)
            try:
                body = r.json()
            except Exception:  # noqa: BLE001
                return None
            if r.status_code >= 400 or not body.get("ok"):
                log.info("pulse %s unavailable: %s", name, body.get("error") or r.status_code)
                return None
            return body if isinstance(body, dict) else None
    except Exception:  # noqa: BLE001
        log.info("pulse %s unreachable", name)
        return None


async def _ok(fn) -> bool:  # type: ignore[no-untyped-def]
    try:
        ok, _reason = await fn()
        return bool(ok)
    except Exception:  # noqa: BLE001
        return False


async def build_pulse() -> dict[str, Any]:
    health_verb, gpus_verb, llm_ok, stt_ok, tts_ok, hands_ok = await asyncio.gather(
        _hands_verb("cluster.health"),
        _hands_verb("cluster.gpus"),
        _ok(health_llm),
        _ok(health_whisper),
        _ok(health_piper),
        _ok(health_hands),
    )
    utc = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    return assemble_pulse(
        health_verb=health_verb if isinstance(health_verb, dict) else None,
        gpus_verb=gpus_verb if isinstance(gpus_verb, dict) else None,
        llm_ok=bool(llm_ok),
        stt_ok=bool(stt_ok),
        tts_ok=bool(tts_ok),
        hands_ok=bool(hands_ok),
        utc=utc,
    )


async def get_pulse() -> dict[str, Any]:
    global _cache
    now = time.monotonic()
    cached = _cache
    if cached and now - cached[0] < CACHE_TTL_SEC:
        return cached[1]
    async with _cache_lock:
        cached = _cache
        now = time.monotonic()
        if cached and now - cached[0] < CACHE_TTL_SEC:
            return cached[1]
        body = await build_pulse()
        _cache = (time.monotonic(), body)
        return body
