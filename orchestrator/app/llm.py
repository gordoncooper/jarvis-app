from __future__ import annotations

import json
import logging
import re
from collections.abc import AsyncIterator
from typing import Any

import httpx

from .config import settings

log = logging.getLogger("jarvis.orchestrator.llm")

_EXTRACT_SYSTEM = (
    "You extract at most one durable personal fact about Gordon for long-term "
    "memory (preferences, identity, habits). Reply with JSON only: "
    '{"fact":"<one short line>"} or {"fact":null}. '
    "Refuse secrets, passwords, tokens, live rack/cluster metrics, one-off "
    "chit-chat, and questions. Never invent facts not in the user text."
)


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
    async with httpx.AsyncClient(timeout=120.0) as client:
        async with client.stream(
            "POST", url, headers=_headers(), json=payload
        ) as resp:
            if resp.status_code >= 400:
                raise RuntimeError(f"litellm http {resp.status_code}")
            async for line in resp.aiter_lines():
                if not line.startswith("data:"):
                    continue
                data = line[5:].strip()
                if not data or data == "[DONE]":
                    continue
                try:
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


async def extract_memory_fact(user_text: str) -> str | None:
    """Non-stream JSON extract for durable personal facts (D-0025). Never raises."""
    from .memory import _normalize_fact  # local avoid cycle at import

    t = " ".join((user_text or "").strip().split())
    if not t:
        return None
    if settings.mock_llm:
        return None
    key = settings.litellm_api_key.strip()
    if not key:
        return None

    url = settings.litellm_base.rstrip("/") + "/v1/chat/completions"
    payload: dict[str, Any] = {
        "model": settings.memory_extract_model,
        "messages": [
            {"role": "system", "content": _EXTRACT_SYSTEM},
            {"role": "user", "content": t[:1000]},
        ],
        "stream": False,
        "temperature": 0,
        "max_tokens": 80,
    }
    try:
        async with httpx.AsyncClient(timeout=settings.memory_extract_timeout) as client:
            r = await client.post(url, headers=_headers(), json=payload)
            if r.status_code >= 400:
                log.warning("memory extract http %s", r.status_code)
                return None
            body = r.json()
    except Exception as e:  # noqa: BLE001
        log.warning("memory extract failed: %s", type(e).__name__)
        return None

    try:
        content = (
            ((body.get("choices") or [{}])[0].get("message") or {}).get("content")
            or ""
        )
    except Exception:  # noqa: BLE001
        return None
    content = str(content).strip()
    if content.startswith("```"):
        content = re.sub(r"^```(?:json)?\s*", "", content)
        content = re.sub(r"\s*```$", "", content)
    try:
        obj = json.loads(content)
    except json.JSONDecodeError:
        m = re.search(r"\{[^{}]*\}", content)
        if not m:
            return None
        try:
            obj = json.loads(m.group(0))
        except json.JSONDecodeError:
            return None
    if not isinstance(obj, dict):
        return None
    raw = obj.get("fact")
    if raw is None or raw is False:
        return None
    return _normalize_fact(str(raw)) or None


def _headers() -> dict[str, str]:
    key = settings.litellm_api_key.strip()
    return {
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
    }
