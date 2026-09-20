from __future__ import annotations

import time
import uuid
from dataclasses import dataclass, field
from threading import Lock
from typing import Any


@dataclass
class Session:
    id: str
    created_at: float
    messages: list[dict[str, Any]] = field(default_factory=list)


class SessionStore:
    """In-process session memory — survives glass restart, not orchestrator restart (D-0013 v1)."""

    def __init__(self) -> None:
        self._lock = Lock()
        self._sessions: dict[str, Session] = {}

    def get_or_create(self, session_id: str | None) -> Session:
        with self._lock:
            if session_id and session_id in self._sessions:
                return self._sessions[session_id]
            sid = session_id or str(uuid.uuid4())
            sess = Session(id=sid, created_at=time.time())
            self._sessions[sid] = sess
            return sess

    def append(self, session_id: str, role: str, content: str) -> None:
        with self._lock:
            sess = self._sessions[session_id]
            sess.messages.append({"role": role, "content": content, "ts": time.time()})
