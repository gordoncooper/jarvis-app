"""Where a turn goes: memory, a Hands verb, or the talker (D-0033).

This is the whole pre-talker routing decision in one pure function, so the
utterance fixture scores *the router* rather than a reimplementation of it in
a test. Session state (pending confirm, yes/cancel) is resolved before this
runs and stays in `main.py`; everything here is text in, label out.

Labels are one flat namespace shared with the verb catalog — `chat`,
`memory.*`, and the `CATALOG` verb names. Slice 2 turns that namespace into a
declared manifest; slice 3 lets a classifier propose a label when the
deterministic pass below returns `chat`.
"""

from __future__ import annotations

from dataclasses import dataclass

from .hands import CATALOG, match_verb
from .memory import parse_memory_candidate, parse_memory_intent

CHAT = "chat"

# Memory labels. `.remember_ref` / `.forget_ref` are utterances that point at
# an earlier turn ("remember that") and carry no fact of their own.
MEMORY_LIST = "memory.list"
MEMORY_REMEMBER = "memory.remember"
MEMORY_REMEMBER_REF = "memory.remember_ref"
MEMORY_FORGET = "memory.forget"
MEMORY_FORGET_ALL = "memory.forget_all"
MEMORY_FORGET_REF = "memory.forget_ref"
# A preference/identity line without "remember that" — confirm-gated (D-0024).
MEMORY_CANDIDATE = "memory.candidate"

MEMORY_LABELS = frozenset(
    {
        MEMORY_LIST,
        MEMORY_REMEMBER,
        MEMORY_REMEMBER_REF,
        MEMORY_FORGET,
        MEMORY_FORGET_ALL,
        MEMORY_FORGET_REF,
        MEMORY_CANDIDATE,
    }
)


@dataclass(frozen=True)
class Route:
    label: str
    fact: str = ""
    verb_class: str | None = None
    args: dict[str, str] | None = None

    @property
    def is_verb(self) -> bool:
        return self.label in CATALOG

    @property
    def is_memory(self) -> bool:
        return self.label in MEMORY_LABELS


def route(text: str) -> Route:
    """Classify one utterance. Pure: no session, no sqlite, no network."""
    intent = parse_memory_intent(text)
    if intent.kind == "list":
        return Route(MEMORY_LIST)
    if intent.kind == "remember_ref":
        return Route(MEMORY_REMEMBER_REF)
    if intent.kind == "forget_ref":
        return Route(MEMORY_FORGET_REF)
    if intent.kind == "remember":
        return Route(MEMORY_REMEMBER, fact=intent.fact)
    if intent.kind == "forget":
        return Route(MEMORY_FORGET, fact=intent.fact)
    if intent.kind == "forget_all":
        return Route(MEMORY_FORGET_ALL)

    # Preference/identity heuristics before Hands, so "I prefer GPU temps in F"
    # is confirm-gated memory rather than a live metrics verb (D-0026).
    candidate = parse_memory_candidate(text)
    if candidate:
        return Route(MEMORY_CANDIDATE, fact=candidate)

    hit = match_verb(text)
    if hit is not None:
        return Route(hit.name, verb_class=hit.klass, args=hit.args)

    return Route(CHAT)
