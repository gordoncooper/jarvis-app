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

# Gordon-named trusted verbs (D-0022). Class trusted = auto-run, no confirm UI.
CATALOG: dict[str, str] = {
    "cluster.health": "Node Ready / non-Running pods snapshot.",
    "cluster.gpus": "GPU temperature and memory from Prometheus.",
    "lab.map": "Canonical lab URLs plus live node list.",
}

# Ingress heuristics — flexible speech → rigid verb (D-0009). First match wins.
_RULES: list[tuple[str, re.Pattern[str]]] = [
    (
        "cluster.gpus",
        re.compile(
            r"\b("
            r"gpu\s*(temps?|temperature|memory|status|health|usage)?|"
            r"vram|nvidia|"
            r"how\s+hot\s+(are\s+)?(the\s+)?gpus?"
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


def match_verb(text: str) -> VerbHit | None:
    t = " ".join((text or "").strip().split())
    if not t:
        return None
    for name, pat in _RULES:
        if pat.search(t):
            return VerbHit(name=name)
    return None


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


async def execute_verb(name: str) -> dict[str, Any]:
    if name not in CATALOG:
        raise RuntimeError(f"unknown verb {name}")
    url = settings.hands_base.rstrip("/") + "/v1/verbs"
    async with httpx.AsyncClient(timeout=90.0) as client:
        r = await client.post(url, json={"verb": name, "args": {}})
        if r.status_code >= 400:
            raise RuntimeError(f"hands http {r.status_code}")
        body = r.json()
        if not body.get("ok"):
            raise RuntimeError(body.get("error") or "verb failed")
        return body


def format_verb_reply(name: str, body: dict[str, Any]) -> str:
    """Prefer shim `text` (already prose). Fall back to structured `data`."""
    text = (body.get("text") or "").strip()
    if text:
        return text

    data = body.get("data") or {}
    if name == "cluster.health":
        nodes = data.get("nodes") or []
        ready = sum(1 for n in nodes if n.get("ready"))
        total = len(nodes)
        pod = data.get("pod_summary") or ""
        return f"{ready}/{total} nodes Ready. {pod}".strip()
    if name == "cluster.gpus":
        bits = []
        for g in data.get("gpus") or []:
            part = str(g.get("node") or "?")
            if g.get("temp_c") is not None:
                part += f" {int(g['temp_c'])}°C"
            if g.get("mem_used_bytes") is not None:
                mb = float(g["mem_used_bytes"]) / (1024**3)
                part += f", {mb:.1f} GiB used"
            bits.append(part)
        return "GPU status: " + "; ".join(bits) + "." if bits else "No GPU samples."
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
