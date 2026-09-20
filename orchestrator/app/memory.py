from __future__ import annotations

import re
import sqlite3
import time
import uuid
from dataclasses import dataclass
from pathlib import Path
from threading import Lock

# Optional lead-in before the verb — STT / natural phrasing (D-0013).
_PREFIX = (
    r"^\s*(?:please\s+|just\s+)?"
    r"(?:(?:hey|ok|okay)[, ]+)?"
    r"(?:jarvis[,:]?\s+)?"
    r"(?:please\s+)?"
    r"(?:(?:can|could|would)\s+you\s+)?"
    r"(?:i\s+(?:want|need)\s+you\s+to\s+|i(?:'?d|\s+would)\s+like\s+you\s+to\s+)?"
)

_REMEMBER = re.compile(
    _PREFIX
    + r"(?:"
    r"remember(?:\s+that)?|"
    r"don'?t\s+forget(?:\s+that)?|"
    r"from\s+now\s+on"
    r")\s*[,:]?\s+(.+?)\s*$",
    re.IGNORECASE | re.DOTALL,
)
_FORGET = re.compile(
    _PREFIX
    + r"(?:"
    r"forget(?:\s+that)?|"
    r"stop\s+remembering"
    r")\s*[,:]?\s+(.+?)\s*$",
    re.IGNORECASE | re.DOTALL,
)

# Dropped when matching forget queries to stored facts.
_STOP = frozenset(
    {
        "a",
        "an",
        "and",
        "about",
        "be",
        "do",
        "does",
        "for",
        "forget",
        "i",
        "is",
        "it",
        "its",
        "me",
        "my",
        "mine",
        "of",
        "or",
        "please",
        "prefer",
        "preference",
        "preferences",
        "preferred",
        "prefers",
        "remember",
        "remembering",
        "that",
        "the",
        "this",
        "to",
        "you",
        "your",
    }
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


# Non-explicit candidates → confirm UI (D-0024). Not lab/metrics language.
_CANDIDATE = re.compile(
    r"^\s*(?:"
    r"i\s+prefer\s+.+|"
    r"i(?:'?d|\s+would)\s+(?:rather|prefer)\s+.+|"
    r"i\s+(?:really\s+)?(?:like|love|hate)\s+.+|"
    r"i\s+always\s+.+|"
    r"i\s+never\s+.+|"
    r"call\s+me\s+.+|"
    r"my\s+(?:name|wife|husband|partner|dog|cat|kid|kids|son|daughter|"
    r"birthday|timezone|tz|email|phone|address|team|title|job)\s+(?:is|are)\s+.+"
    r")\s*$",
    re.IGNORECASE | re.DOTALL,
)
_LABISH = re.compile(
    r"\b(cluster|gpu|pod|node|prometheus|grafana|kubectl|deploy|namespace|"
    r"temperature|vram|nfs|flux|traefik)\b",
    re.I,
)


def parse_memory_candidate(text: str) -> str | None:
    """Heuristic preference/identity fact without 'remember that…'."""
    t = " ".join((text or "").strip().split())
    if not t or not _CANDIDATE.match(t):
        return None
    if _LABISH.search(t):
        return None
    # Strip leading filler for a cleaner stored line.
    fact = re.sub(
        r"^\s*(?:hey[, ]+)?(?:jarvis[,:]?\s+)?",
        "",
        t,
        flags=re.I,
    ).strip()
    return _normalize_fact(fact) or None


def eligible_for_llm_extract(text: str) -> bool:
    """Whether to spend a local LLM call after heuristic miss (D-0025)."""
    t = " ".join((text or "").strip().split())
    if len(t) < 12:
        return False
    if _LABISH.search(t):
        return False
    # Affirm/cancel — import lazily to keep memory free of hands cycle risk
    from .hands import is_affirm, is_cancel

    if is_affirm(t) or is_cancel(t):
        return False
    return True


def fact_already_known(fact: str, known: list[str]) -> bool:
    for k in known:
        if _forget_match(fact, k):
            return True
    return False


def new_memory_pending(fact: str, ttl_sec: float = 90.0) -> dict:
    return {
        "id": str(uuid.uuid4()),
        "kind": "memory",
        "fact": fact,
        "summary": f"remember: {fact}",
        "expires_at": time.time() + ttl_sec,
    }


def _normalize_fact(raw: str) -> str:
    s = " ".join(raw.strip().strip("\"'").split())
    s = s.rstrip(".,!?;:")
    if len(s) < 2 or len(s) > 500:
        return ""
    # refuse obvious secrets
    low = s.lower()
    for bad in ("password", "api key", "token", "secret", "kubeconfig", "ssh key"):
        if bad in low:
            return ""
    return s


def _tokens(s: str) -> set[str]:
    return {
        t
        for t in re.findall(r"[a-z0-9]+", s.lower())
        if t not in _STOP and len(t) > 1
    }


def _forget_match(query: str, fact: str) -> bool:
    """Substring either way, or content-token overlap (STT paraphrase)."""
    q = query.lower().strip()
    f = fact.lower().strip()
    if not q or not f:
        return False
    if q in f or f in q:
        return True
    qt, ft = _tokens(query), _tokens(fact)
    if not qt or not ft:
        return False
    if qt <= ft or ft <= qt:
        return True
    smaller = qt if len(qt) <= len(ft) else ft
    return len(qt & ft) >= max(1, (len(smaller) + 1) // 2)


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
        """Tombstone active facts matching query (substring or token overlap)."""
        now = time.time()
        count = 0
        with self._lock, self._connect() as conn:
            rows = conn.execute(
                "SELECT id, text FROM facts WHERE tombstoned_at IS NULL"
            ).fetchall()
            for row in rows:
                if not _forget_match(query, row["text"]):
                    continue
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
