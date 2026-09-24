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
    r"from\s+now\s+on|"
    # The classifier may not name memory.remember: it does not extract the
    # fact (D-0034). These two are closed lead-ins, same capture as remember.
    r"keep\s+in\s+mind(?:\s+that)?|"
    r"make\s+a\s+note(?:\s+that)?"
    r")\s*[,:]?\s+(.+?)\s*$",
    re.IGNORECASE | re.DOTALL,
)
_FORGET = re.compile(
    _PREFIX
    + r"(?:"
    r"forget(?:\s+that)?|"
    r"stop\s+remembering|"
    r"(?:delete|remove|drop)\s+(?:the\s+)?"
    r"(?:memory|memories|fact)(?:\s+(?:about|for|of|regarding))?|"
    r"(?:delete|remove|drop)\s+(?:my\s+)?"
    r"preference(?:\s+for)?"
    r")\s*[,:]?\s+(.+?)\s*$",
    re.IGNORECASE | re.DOTALL,
)
# Wipe every promoted fact. Always confirm-class (D-0027). The noun has to
# be the whole store — everything, all, or memories/facts/preferences as a
# set. "delete the memory about tea" stays a single forget.
_FORGET_ALL = re.compile(
    _PREFIX
    + r"(?:forget|wipe|delete|remove|erase|clear|drop)\s+"
    r"(?:"
    r"everything|all(?:\s+of\s+it|\s+that)?"
    r"|all(?:\s+of)?(?:\s+(?:my|the|your))?\s+"
    r"(?:memories|memory|facts|fact|preferences|preference)"
    r"|(?:my|the|your)\s+(?:promoted\s+)?"
    r"(?:memories|memory|facts|preferences)"
    r")"
    r"(?:\s*,?\s*please)?\s*[.!?]*\s*$",
    re.IGNORECASE,
)
# Pointing at the previous turn without naming it: "scratch that",
# "delete that last one". A closed, tiny set — none of these phrases means
# anything else, which is why they are matched rather than classified. The
# referent itself is resolved from session state, and the result is still
# confirm-gated (D-0013: an inference about what Gordon meant is never
# written on its own).
_FORGET_REF = re.compile(
    _PREFIX
    + r"(?:"
    r"scratch\s+(?:that|it|this)|"
    r"undo\s+(?:that|it|the\s+last\s+one)|"
    r"(?:delete|remove|drop|forget)\s+(?:that|this|the)\s+last\s+one|"
    r"(?:delete|remove|drop)\s+(?:that|it|this)|"
    r"that(?:'s|\s+is)\s+wrong[,.]?\s*(?:remove|delete|drop|forget)\s+it"
    r")\s*[.!?]?\s*$",
    re.IGNORECASE,
)
_LIST = re.compile(
    _PREFIX
    + r"(?:"
    r"(?:list|show|what\s+are)\s+(?:all\s+|exact\s+|my\s+)?(?:the\s+)?"
    r"(?:promoted\s+)?(?:memories|memory|facts)|"
    r"what\s+do\s+you\s+remember(?:\s+about\s+me)?|"
    r"(?:list|show)\s+what\s+you\s+remember|"
    # End-anchored on purpose: "show me your memory of Hastings" is chat.
    r"show\s+me\s+your\s+memory|"
    r"read\s+back\s+my\s+preferences"
    r")\s*\??\s*$",
    re.IGNORECASE,
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


# "remember that" / "forget that" carry no fact — they point at something
# said earlier. The capture group happily swallows the bare demonstrative,
# which is how the literal fact "that" reached the production store, and how
# `forget that` came to substring-match every fact containing the word.
# Resolving the referent needs conversation state the orchestrator does not
# keep yet, so for now say so instead of storing or matching garbage.
_REFERENT_WORDS = frozenset(
    {
        "bit",
        "it",
        "last",
        "one",
        "part",
        "so",
        "stuff",
        "that",
        "the",
        "these",
        "thing",
        "this",
        "those",
    }
)


def _is_referent(fact: str) -> bool:
    """True when the "fact" is only a pointer back at an earlier turn."""
    words = re.findall(r"[a-z]+", (fact or "").lower())
    return bool(words) and all(w in _REFERENT_WORDS for w in words)


@dataclass
class MemoryHit:
    kind: str  # remember | remember_ref | forget | forget_ref | forget_all | list | none
    fact: str


def parse_memory_intent(text: str) -> MemoryHit:
    """Explicit remember / forget / list (D-0013 / D-0027 / D-0028)."""
    t = " ".join(text.strip().split())
    if _LIST.match(t):
        return MemoryHit("list", "")
    m = _REMEMBER.match(t)
    if m:
        fact = _normalize_fact(m.group(1))
        if fact and _is_referent(fact):
            return MemoryHit("remember_ref", "")
        if fact:
            return MemoryHit("remember", fact)
    if _FORGET_REF.match(t):
        return MemoryHit("forget_ref", "")
    if _FORGET_ALL.match(t):
        return MemoryHit("forget_all", "")
    m = _FORGET.match(t)
    if m:
        fact = _normalize_fact(m.group(1))
        if fact and _is_referent(fact):
            return MemoryHit("forget_ref", "")
        if fact:
            return MemoryHit("forget", fact)
    return MemoryHit("none", "")


def format_list_reply(facts: list[str]) -> str:
    if not facts:
        return "Promoted memory is empty — nothing stored yet."
    lines = [f"{i}. {f}" for i, f in enumerate(facts, 1)]
    return "Promoted memory:\n" + "\n".join(lines)


def new_memory_pending(
    fact: str,
    *,
    action: str = "remember",
    facts: list[str] | None = None,
    ttl_sec: float = 90.0,
) -> dict:
    """Pending confirm for remember or forget (D-0024 / D-0027)."""
    act = action if action in ("remember", "forget", "forget_all") else "remember"
    if act == "forget_all":
        return {
            "id": str(uuid.uuid4()),
            "kind": "memory",
            "action": "forget_all",
            "verb": "memory.forget_all",
            "fact": "",
            "facts": [f for f in (facts or []) if f],
            "summary": "forget all memories, facts, and preferences",
            "expires_at": time.time() + ttl_sec,
        }
    if act == "forget":
        targets = [f for f in (facts or ([fact] if fact else [])) if f]
        if len(targets) == 1:
            summary = f"forget: {targets[0]}"
        else:
            summary = f"forget {len(targets)} facts"
        return {
            "id": str(uuid.uuid4()),
            "kind": "memory",
            "action": "forget",
            "verb": "memory.forget",
            "fact": targets[0] if len(targets) == 1 else "",
            "facts": targets,
            "summary": summary,
            "expires_at": time.time() + ttl_sec,
        }
    return {
        "id": str(uuid.uuid4()),
        "kind": "memory",
        "action": "remember",
        "verb": "memory.remember",
        "fact": fact,
        "facts": [fact] if fact else [],
        "summary": f"remember: {fact}",
        "expires_at": time.time() + ttl_sec,
    }


def format_forget_all_ask(count: int, preview: list[str]) -> str:
    if count <= 0:
        return "Promoted memory is already empty — nothing to forget."
    shown = [f for f in preview if f][:3]
    if not shown:
        body = f"all {count} memories, facts, and preferences"
    elif count == 1:
        body = f"the one thing stored: {shown[0]}"
    else:
        extra = f" (+{count - len(shown)} more)" if count > len(shown) else ""
        body = f"all {count} memories, facts, and preferences: {'; '.join(shown)}{extra}"
    return f"Shall I forget {body}? Say yes or cancel."


def format_forget_confirm_ask(facts: list[str]) -> str:
    if not facts:
        return "I found nothing matching that to forget."
    if len(facts) == 1:
        return f"Shall I forget: {facts[0]}? Say yes or cancel."
    preview = "; ".join(facts[:3])
    extra = f" (+{len(facts) - 3} more)" if len(facts) > 3 else ""
    return (
        f"Shall I forget {len(facts)} facts: {preview}{extra}? "
        "Say yes or cancel."
    )


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
    """Heuristic preference/identity fact without 'remember that…'.

    Lab/metrics words are allowed here (e.g. "I prefer GPU temps in Fahrenheit")
    so Hands does not steal the turn; LLM extract still uses labish gating.
    """
    t = " ".join((text or "").strip().split())
    if not t or not _CANDIDATE.match(t):
        return None
    # Strip leading filler for a cleaner stored line.
    fact = re.sub(
        r"^\s*(?:hey[, ]+)?(?:jarvis[,:]?\s+)?",
        "",
        t,
        flags=re.I,
    ).strip()
    return _normalize_fact(fact) or None


def gpu_temp_unit(facts: list[str]) -> str:
    """Newest matching preference wins. Default Celsius (Prometheus native)."""
    for f in facts:
        low = (f or "").lower()
        if "fahrenheit" in low or "farenheit" in low:
            return "F"
        if "celsius" in low:
            return "C"
    return "C"


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
    """Strict-ish dedup: exact, containment, or token subset — not half-overlap."""
    f = " ".join((fact or "").lower().split())
    if not f:
        return False
    for k in known:
        kk = " ".join((k or "").lower().split())
        if not kk:
            continue
        if f == kk or f in kk or kk in f:
            return True
        ft, kt = _tokens(f), _tokens(kk)
        if ft and kt and (ft <= kt or kt <= ft):
            return True
    return False


def _forget_match(query: str, fact: str) -> bool:
    """Substring either way, token subset, or single-token hit.

    Multi-token queries require most query tokens present so
    \"smoke-pizza\" does not match \"I like pizza\".
    """
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
    if len(qt) == 1:
        return bool(qt & ft)
    return len(qt & ft) >= max(2, (len(qt) + 1) // 2)


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

    def matching_facts(self, query: str, limit: int = 200) -> list[str]:
        """Active facts that would be removed by forget(query)."""
        q = (query or "").strip()
        if not q:
            return []
        out: list[str] = []
        for text in self.active_facts(limit):
            if _forget_match(q, text):
                out.append(text)
        return out

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

    def count_active(self) -> int:
        with self._lock, self._connect() as conn:
            row = conn.execute(
                "SELECT COUNT(*) AS n FROM facts WHERE tombstoned_at IS NULL"
            ).fetchone()
        return int(row["n"]) if row else 0

    def forget_all(self) -> list[str]:
        """Tombstone every active fact. Returns what was removed."""
        now = time.time()
        removed: list[str] = []
        with self._lock, self._connect() as conn:
            rows = conn.execute(
                "SELECT id, text FROM facts WHERE tombstoned_at IS NULL"
            ).fetchall()
            for row in rows:
                conn.execute(
                    "UPDATE facts SET tombstoned_at = ? WHERE id = ?",
                    (now, row["id"]),
                )
                conn.execute(
                    "INSERT INTO audit (id, ts, action, fact_id, detail) "
                    "VALUES (?, ?, ?, ?, ?)",
                    (str(uuid.uuid4()), now, "forget", row["id"], row["text"]),
                )
                removed.append(str(row["text"]))
        return removed

    def forget_texts(self, texts: list[str]) -> list[str]:
        """Tombstone exact active fact texts; return removed texts."""
        want = {t for t in texts if t}
        if not want:
            return []
        now = time.time()
        removed: list[str] = []
        with self._lock, self._connect() as conn:
            rows = conn.execute(
                "SELECT id, text FROM facts WHERE tombstoned_at IS NULL"
            ).fetchall()
            for row in rows:
                if row["text"] not in want:
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
                removed.append(str(row["text"]))
        return removed

    def forget(self, query: str) -> list[str]:
        """Tombstone active facts matching query; return removed texts."""
        return self.forget_texts(self.matching_facts(query))
