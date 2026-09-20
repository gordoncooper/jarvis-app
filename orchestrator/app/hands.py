from __future__ import annotations

import logging
import re
import time
import uuid
from dataclasses import dataclass

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
            r"cluster\s+health|"
            r"nodes?\s+(ready|status)|"
            r"(is|how\s+is)\s+the\s+(lab|cluster|rack)\b|"
            r"(lab|cluster|rack)\s+(up|healthy|ok|okay)|"
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
            if r.status_code < 500:
                return True, None
            return False, f"hands http {r.status_code}"
    except Exception:  # noqa: BLE001
        return False, "hands unreachable"


async def execute_verb(name: str) -> str:
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
        text = (body.get("text") or "").strip()
        if not text:
            raise RuntimeError("empty verb result")
        return text


def format_verb_reply(name: str, raw: str) -> str:
    title = {
        "cluster.health": "Cluster health",
        "cluster.gpus": "GPU status",
        "lab.map": "Lab map",
    }.get(name, name)
    return f"{title} ({name}):\n\n{raw}"


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
