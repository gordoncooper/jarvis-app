from __future__ import annotations

import json
import sqlite3
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from threading import Lock
from typing import Any


@dataclass
class Session:
    id: str
    created_at: float
    messages: list[dict[str, Any]] = field(default_factory=list)
    pending_confirm: dict[str, Any] | None = None
    # What "that" points at (D-0035). See SessionStore.set_referents.
    referents: dict[str, Any] = field(default_factory=dict)


class SessionStore:
    """Durable session memory on NFS sqlite (D-0024). Survives orch restart."""

    def __init__(self, db_path: str, *, max_history: int = 24) -> None:
        self.path = Path(db_path)
        self.max_history = max_history
        self._lock = Lock()
        self._cache: dict[str, Session] = {}
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
                CREATE TABLE IF NOT EXISTS sessions (
                  id TEXT PRIMARY KEY,
                  created_at REAL NOT NULL,
                  updated_at REAL NOT NULL
                );
                CREATE TABLE IF NOT EXISTS messages (
                  session_id TEXT NOT NULL,
                  seq INTEGER NOT NULL,
                  role TEXT NOT NULL,
                  content TEXT NOT NULL,
                  ts REAL NOT NULL,
                  PRIMARY KEY (session_id, seq)
                );
                CREATE TABLE IF NOT EXISTS pending (
                  session_id TEXT PRIMARY KEY,
                  kind TEXT NOT NULL,
                  payload_json TEXT NOT NULL,
                  expires_at REAL NOT NULL
                );
                CREATE TABLE IF NOT EXISTS referents (
                  session_id TEXT PRIMARY KEY,
                  payload_json TEXT NOT NULL,
                  updated_at REAL NOT NULL
                );
                """
            )

    def get_or_create(self, session_id: str | None) -> Session:
        with self._lock:
            if session_id and session_id in self._cache:
                return self._cache[session_id]
            if session_id:
                loaded = self._load(session_id)
                if loaded is not None:
                    self._cache[session_id] = loaded
                    return loaded
            sid = session_id or str(uuid.uuid4())
            now = time.time()
            with self._connect() as conn:
                conn.execute(
                    "INSERT OR IGNORE INTO sessions (id, created_at, updated_at) VALUES (?, ?, ?)",
                    (sid, now, now),
                )
            sess = Session(id=sid, created_at=now)
            self._cache[sid] = sess
            return sess

    def _load(self, session_id: str) -> Session | None:
        with self._connect() as conn:
            row = conn.execute(
                "SELECT id, created_at FROM sessions WHERE id = ?",
                (session_id,),
            ).fetchone()
            if not row:
                return None
            msgs = conn.execute(
                "SELECT role, content, ts FROM messages WHERE session_id = ? "
                "ORDER BY seq DESC LIMIT ?",
                (session_id, self.max_history),
            ).fetchall()
            messages = [
                {"role": m["role"], "content": m["content"], "ts": m["ts"]}
                for m in reversed(msgs)
            ]
            pend = conn.execute(
                "SELECT kind, payload_json, expires_at FROM pending WHERE session_id = ?",
                (session_id,),
            ).fetchone()
            pending = None
            if pend and float(pend["expires_at"]) >= time.time():
                try:
                    pending = json.loads(pend["payload_json"])
                except json.JSONDecodeError:
                    pending = None
                if isinstance(pending, dict):
                    pending.setdefault("kind", pend["kind"])
                    pending.setdefault("expires_at", pend["expires_at"])
                else:
                    pending = None
            elif pend:
                conn.execute("DELETE FROM pending WHERE session_id = ?", (session_id,))
            ref_row = conn.execute(
                "SELECT payload_json FROM referents WHERE session_id = ?",
                (session_id,),
            ).fetchone()
            referents: dict[str, Any] = {}
            if ref_row:
                try:
                    loaded = json.loads(ref_row["payload_json"])
                except json.JSONDecodeError:
                    loaded = None
                if isinstance(loaded, dict):
                    referents = loaded
            return Session(
                id=row["id"],
                created_at=float(row["created_at"]),
                messages=messages,
                pending_confirm=pending,
                referents=referents,
            )

    def append(self, session_id: str, role: str, content: str) -> None:
        with self._lock:
            sess = self._cache[session_id]
            now = time.time()
            sess.messages.append({"role": role, "content": content, "ts": now})
            if len(sess.messages) > self.max_history * 2:
                sess.messages = sess.messages[-self.max_history :]
            with self._connect() as conn:
                row = conn.execute(
                    "SELECT COALESCE(MAX(seq), 0) AS m FROM messages WHERE session_id = ?",
                    (session_id,),
                ).fetchone()
                seq = int(row["m"]) + 1
                conn.execute(
                    "INSERT INTO messages (session_id, seq, role, content, ts) "
                    "VALUES (?, ?, ?, ?, ?)",
                    (session_id, seq, role, content, now),
                )
                conn.execute(
                    "UPDATE sessions SET updated_at = ? WHERE id = ?",
                    (now, session_id),
                )
                # Trim old messages beyond 2x max_history in DB
                conn.execute(
                    "DELETE FROM messages WHERE session_id = ? AND seq <= ("
                    "  SELECT MAX(seq) - ? FROM messages WHERE session_id = ?"
                    ")",
                    (session_id, self.max_history * 2, session_id),
                )

    def set_pending(self, session_id: str, pending: dict[str, Any] | None) -> None:
        with self._lock:
            sess = self._cache[session_id]
            sess.pending_confirm = pending
            with self._connect() as conn:
                if pending is None:
                    conn.execute("DELETE FROM pending WHERE session_id = ?", (session_id,))
                else:
                    kind = str(pending.get("kind") or "hands")
                    expires = float(pending.get("expires_at") or (time.time() + 90))
                    conn.execute(
                        "INSERT OR REPLACE INTO pending "
                        "(session_id, kind, payload_json, expires_at) VALUES (?, ?, ?, ?)",
                        (session_id, kind, json.dumps(pending), expires),
                    )
                conn.execute(
                    "UPDATE sessions SET updated_at = ? WHERE id = ?",
                    (time.time(), session_id),
                )

    def get_pending(self, session_id: str) -> dict[str, Any] | None:
        with self._lock:
            return self._cache[session_id].pending_confirm

    def set_referents(self, session_id: str, **values: Any) -> None:
        """Merge into what "that" points at for this session (D-0035).

        Keys in use:
          last_candidate   — a durable-sounding fact heard in the previous
                             turn but not written. What "remember that" means.
          last_user_text   — the previous user utterance, so a candidate can
                             still be extracted later if none was found then.
          last_fact_text   — the most recent promoted fact. What "delete that
                             last one" means.
          last_verb        — the last capability run.

        Durable alongside pending, on the same NFS sqlite, because a session
        outlives the pod (D-0024) and "remember that" after a restart should
        not silently mean something different.
        """
        with self._lock:
            sess = self._cache[session_id]
            merged = dict(sess.referents)
            for key, value in values.items():
                if value is None:
                    merged.pop(key, None)
                else:
                    merged[key] = value
            sess.referents = merged
            with self._connect() as conn:
                conn.execute(
                    "INSERT OR REPLACE INTO referents "
                    "(session_id, payload_json, updated_at) VALUES (?, ?, ?)",
                    (session_id, json.dumps(merged), time.time()),
                )

    def discard(self, session_id: str) -> None:
        """Delete one session. Nothing is copied into memory or another table."""
        if not session_id:
            return
        with self._lock:
            self._cache.pop(session_id, None)
            with self._connect() as conn:
                conn.execute("DELETE FROM messages WHERE session_id = ?", (session_id,))
                conn.execute("DELETE FROM pending WHERE session_id = ?", (session_id,))
                conn.execute("DELETE FROM referents WHERE session_id = ?", (session_id,))
                conn.execute("DELETE FROM sessions WHERE id = ?", (session_id,))

    def get_referents(self, session_id: str) -> dict[str, Any]:
        with self._lock:
            return dict(self._cache[session_id].referents)
