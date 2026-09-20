from __future__ import annotations

import re
import sqlite3
import time
import uuid
from dataclasses import dataclass
from pathlib import Path
from threading import Lock


_REMEMBER = re.compile(
    r"^\s*(?:please\s+)?(?:jarvis[,:]?\s+)?(?:"
    r"remember(?:\s+that)?|"
    r"don'?t\s+forget(?:\s+that)?|"
    r"from\s+now\s+on"
    r")\s*[,:]?\s+(.+?)\s*$",
    re.IGNORECASE | re.DOTALL,
)
_FORGET = re.compile(
    r"^\s*(?:please\s+)?(?:jarvis[,:]?\s+)?(?:"
    r"forget(?:\s+that)?|"
    r"stop\s+remembering"
    r")\s*[,:]?\s+(.+?)\s*$",
    re.IGNORECASE | re.DOTALL,
)


@dataclass
class MemoryHit:
    kind: str  # remember | forget | none
    fact: str


def parse_memory_intent(text: str) -> MemoryHit:
    """Explicit remember/forget only (D-0013 / D-0017)."""
    t = " ".join(text.strip().split())
    m = _REMEMBER.match(t)
    if m:
        fact = _normalize_fact(m.group(1))
        if fact:
            return MemoryHit("remember", fact)
    m = _FORGET.match(t)
    if m:
        fact = _normalize_fact(m.group(1))
        if fact:
            return MemoryHit("forget", fact)
    return MemoryHit("none", "")


def _normalize_fact(raw: str) -> str:
    s = " ".join(raw.strip().strip("\"'").split())
    if len(s) < 2 or len(s) > 500:
        return ""
    # refuse obvious secrets
    low = s.lower()
    for bad in ("password", "api key", "token", "secret", "kubeconfig", "ssh key"):
        if bad in low:
            return ""
    return s


class PromotedMemory:
    """Sqlite promoted facts on NFS (D-0013)."""

    def __init__(self, db_path: str) -> None:
        self.path = Path(db_path)
        self._lock = Lock()
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._init()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(str(self.path), check_same_thread=False)
        conn.row_factory = sqlite3.Row
        return conn

    def _init(self) -> None:
        with self._lock, self._connect() as conn:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS facts (
                  id TEXT PRIMARY KEY,
                  text TEXT NOT NULL,
                  created_at REAL NOT NULL,
                  source_turn TEXT,
                  tombstoned_at REAL
                );
                CREATE TABLE IF NOT EXISTS audit (
                  id TEXT PRIMARY KEY,
                  ts REAL NOT NULL,
                  action TEXT NOT NULL,
                  fact_id TEXT,
                  detail TEXT
                );
                """
            )

    def active_facts(self, limit: int = 50) -> list[str]:
        with self._lock, self._connect() as conn:
            rows = conn.execute(
                "SELECT text FROM facts WHERE tombstoned_at IS NULL "
                "ORDER BY created_at DESC LIMIT ?",
                (limit,),
            ).fetchall()
        return [r["text"] for r in rows]

    def remember(self, text: str, source_turn: str | None = None) -> str:
        fid = str(uuid.uuid4())
        now = time.time()
        with self._lock, self._connect() as conn:
            conn.execute(
                "INSERT INTO facts (id, text, created_at, source_turn, tombstoned_at) "
                "VALUES (?, ?, ?, ?, NULL)",
                (fid, text, now, source_turn),
            )
            conn.execute(
                "INSERT INTO audit (id, ts, action, fact_id, detail) VALUES (?, ?, ?, ?, ?)",
                (str(uuid.uuid4()), now, "remember", fid, text),
            )
        return fid

    def forget(self, query: str) -> int:
        """Tombstone active facts whose text contains query (case-insensitive)."""
        q = query.lower()
        now = time.time()
        count = 0
        with self._lock, self._connect() as conn:
            rows = conn.execute(
                "SELECT id, text FROM facts WHERE tombstoned_at IS NULL"
            ).fetchall()
            for row in rows:
                if q in row["text"].lower() or row["text"].lower() in q:
                    conn.execute(
                        "UPDATE facts SET tombstoned_at = ? WHERE id = ?",
                        (now, row["id"]),
                    )
                    conn.execute(
                        "INSERT INTO audit (id, ts, action, fact_id, detail) "
                        "VALUES (?, ?, ?, ?, ?)",
                        (str(uuid.uuid4()), now, "forget", row["id"], row["text"]),
                    )
                    count += 1
        return count
