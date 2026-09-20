from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from typing import Any

import httpx

from .config import settings

log = logging.getLogger("jarvis.orchestrator.llm")


async def health_llm() -> tuple[bool, str | None]:
    if settings.mock_llm:
        return True, None
    if not settings.litellm_api_key:
        return False, "LITELLM_API_KEY unset"
    # Strip accidental whitespace from secret mounts / files
    key = settings.litellm_api_key.strip()
    if not key:
        return False, "LITELLM_API_KEY empty"
    url = settings.litellm_base.rstrip("/") + "/v1/models"
    try:
        async with httpx.AsyncClient(timeout=2.0) as client:
            r = await client.get(
                url,
                headers={
                    "Authorization": f"Bearer {key}",
                    "Content-Type": "application/json",
                },
            )
            if r.status_code < 400:
                return True, None
            return False, f"litellm http {r.status_code}"
    except Exception as e:  # noqa: BLE001
        # Never surface header/Authorization material to callers
        msg = str(e)
        if "Bearer" in msg or "sk-" in msg:
            return False, "litellm unreachable (auth/header)"
        return False, "litellm unreachable"


async def chat_stream(messages: list[dict[str, str]]) -> AsyncIterator[str]:
    if settings.mock_llm:
        reply = (
            "At your service, sir. Orchestrator mock mode is on — "
            "the rack talker is not in this loop."
        )
        for word in reply.split(" "):
            yield word + " "
        return

    key = settings.litellm_api_key.strip()
    if not key:
        raise RuntimeError("LITELLM_API_KEY unset")

    url = settings.litellm_base.rstrip("/") + "/v1/chat/completions"
    payload: dict[str, Any] = {
        "model": settings.talker_model,
        "messages": messages,
        "stream": True,
        "temperature": 0.4,
    }
    headers = {
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
    }
    async with httpx.AsyncClient(timeout=120.0) as client:
        async with client.stream("POST", url, headers=headers, json=payload) as resp:
            if resp.status_code >= 400:
                raise RuntimeError(f"litellm http {resp.status_code}")
            async for line in resp.aiter_lines():
                if not line.startswith("data:"):
                    continue
                data = line[5:].strip()
                if not data or data == "[DONE]":
                    continue
                try:
                    import json

                    obj = json.loads(data)
                except json.JSONDecodeError:
                    continue
                choices = obj.get("choices") or []
                if not choices:
                    continue
                delta = choices[0].get("delta") or {}
                token = delta.get("content")
                if token:
                    yield token


def _headers() -> dict[str, str]:
    key = settings.litellm_api_key.strip()
    return {
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
    }
