"""A turn that is about the chat itself, not a fact and not a question.

The utterance has to be the command. "forget this chat" wipes the session.
"forget that I like tea" does not. "start a new chat about the gpus" does
not rotate, because it is still a request.
"""

from __future__ import annotations

import re

SessionIntent = str  # "discard" | "rotate"

_WAKE = r"(?:(?:hey|ok|okay)[, ]+)?jarvis[, ]+"
_NOUN = r"(?:chat(?:\s+session)?|conversation|convo|dialog(?:ue)?|session|thread)"
_TAIL = r"(?:\s+(?:history|log|transcript))?"
_EDGE = r"(?:[.!?,\s]+please)?[.!?]*"

_DISCARD = re.compile(
    rf"^(?:{_WAKE})?(?:please[, ]+)?"
    rf"(?:clear|delete|wipe|erase|discard|drop|forget|scrap)"
    rf"(?:\s+(?:the\s+current|this|the|our|my|current))?"
    rf"\s+{_NOUN}{_TAIL}"
    rf"{_EDGE}$",
    re.IGNORECASE,
)

_ROTATE = re.compile(
    rf"^(?:{_WAKE})?(?:please[, ]+)?"
    rf"(?:"
    rf"(?:start|begin|open|create|make)\s+(?:a\s+)?(?:new|fresh)\s+{_NOUN}"
    rf"|new\s+{_NOUN}"
    rf")"
    rf"{_EDGE}$",
    re.IGNORECASE,
)


def parse_session_intent(text: str) -> SessionIntent | None:
    """discard throws the session away. rotate keeps it and opens another."""
    uttered = re.sub(r"\s+", " ", (text or "").strip())
    if not uttered:
        return None
    if _DISCARD.match(uttered):
        return "discard"
    if _ROTATE.match(uttered):
        return "rotate"
    return None
