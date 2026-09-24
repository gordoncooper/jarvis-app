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

import re
from dataclasses import dataclass

from .capabilities import MANIFEST
from .hands import CATALOG, logs_args, match_verb, parse_confirm_args
from .memory import parse_memory_candidate, parse_memory_intent

CHAT = "chat"
# Asked for something that is plainly about this house, but no capability
# covers it. Answered from the manifest, never by the talker — that path is
# where "the last update I recall was from yesterday" came from.
UNSUPPORTED = "unsupported"
META_CAPABILITIES = "meta.capabilities"

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

    @property
    def is_self_served(self) -> bool:
        """A capability the orchestrator answers itself (D-0036).

        Prometheus and local-only reads. These survive Hands being down,
        which is when Gordon is most likely to be asking.
        """
        cap = MANIFEST.get(self.label)
        return bool(cap and cap.backend in ("prom", "kube", "local"))


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

    # After the verbs, so "what can you tell me about the cluster" is still
    # cluster.health rather than a recital of the manifest.
    if _META_ASK.search(text or ""):
        return Route(META_CAPABILITIES, verb_class="trusted")

    if is_house_request(text):
        return Route(UNSUPPORTED)

    return Route(CHAT)


# Verbs the classifier may name. memory.remember / memory.forget are excluded
# on purpose: both need a *fact* extracted from the utterance, which the
# classifier does not produce, so naming one would fire a confirm prompt with
# nothing in it. Explicit phrasings still reach them deterministically.
CLASSIFIER_PROMOTABLE = frozenset(
    set(MANIFEST) - {MEMORY_REMEMBER, MEMORY_FORGET, MEMORY_FORGET_ALL}
)


def combine(text: str, deterministic: Route, verdict: object | None, *,
            min_confidence: float, min_confidence_write: float) -> Route:
    """Fold a classifier verdict into the deterministic route (D-0033 slice 3).

    Pure, so the precedence rules are testable without a model.

    **The classifier may only ever promote to a named verb.** It cannot turn a
    refusal into chat, and it cannot invent a refusal. That is not caution for
    its own sake — it is what the first shadow run measured. Against the
    fixture, `jarvis-local` was good at naming a verb (6 of the 7 phrasings the
    regexes miss, including "anything broken?" and "did anything break
    overnight?") and bad at the capability/chat boundary when no verb fits: it
    called "take a look at the flux error logs", "is flux in sync?" and
    "what's the latest backup of the cluster?" ordinary chat. Letting it
    demote wiped out six honest refusals and made the whole slice a wash,
    39/64 either way.

    So each side keeps what it is good at. `is_house_request` owns "nothing
    serves this subject", which is a fact about the manifest rather than a
    guess. The model owns "which verb did he mean", which no list of patterns
    was ever going to cover.
    """
    if deterministic.label not in (CHAT, UNSUPPORTED):
        return deterministic
    if verdict is None:
        return deterministic

    verb = getattr(verdict, "verb", None)
    if not verb or verb not in CLASSIFIER_PROMOTABLE:
        return deterministic

    cap = MANIFEST.get(verb)
    if cap is None:  # belt and braces; parse_verdict already checked
        return deterministic

    confidence = float(getattr(verdict, "confidence", 0.0) or 0.0)
    floor = min_confidence_write if cap.klass == "confirm" else min_confidence
    if confidence < floor:
        return deterministic

    args = None
    if verb == "logs.tail":
        args = logs_args(text)
    elif cap.backend == "hands" and cap.klass == "confirm":
        # main.py asks for a target when this comes back empty.
        parsed, _err = parse_confirm_args(verb, text)
        args = parsed or None
    return Route(verb, verb_class=cap.klass, args=args)


# --- telling "a capability I lack" apart from small talk -------------------
#
# Slice 2 needs this distinction before the slice 3 classifier exists, so it
# is a rule — and rules on English are what D-0033 exists to remove. It is
# therefore written to be *conservative*: refuse only when the utterance is
# plainly about this house. A miss leaves the status quo (the talker answers,
# possibly badly); a false refusal breaks ordinary conversation, which is the
# one thing that already works. The asymmetry decides every judgement call
# below, and `test_router.py` asserts false refusals stay at zero.
#
# Vocabulary does not separate the two. 11 of the 25 plain-chat utterances in
# the fixture mention pods, flux, nodes or GPUs. What separates them is
# whether the sentence is about the *idea* or about *this rack*.

# Nouns that exist in this lab. Necessary but nowhere near sufficient.
_LAB_NOUN = re.compile(
    r"\b(pods?|flux|backups?|nodes?|disks?|logs?|cluster|namespaces?|"
    r"deploy(?:ment)?s?|deployed|gpus?|prometheus|grafana|kubernetes|k3s|"
    r"glass|orchestrator|rack|directory|files?|images?|certificates?|"
    r"secrets?|volumes?|ingress)\b",
    re.I,
)

# Asking about the idea, not the instance. Deliberately NOT anchored to the
# start: "show me how a pod works" is conceptual despite the imperative, and
# an anchored version refused it.
_CONCEPTUAL = re.compile(
    r"\b(what\s+is\s+an?\b|what\s+are\s+(?!your\b)|explain|"
    r"tell\s+me\s+about|an?\s+example\s+of|how\s+(a|an|do|does)\s+\w+\s+work|"
    r"how\s+(do|does)\s+(a|an|people|you\s+usually)|difference\s+between|"
    r"why\s+(do|does)|should\s+i\b|better\s+than|used\s+for|"
    r"like\s+i'?m\s+five|in\s+general|what\s+does\s+an?\b)",
    re.I,
)

# An instruction, or a reference to state that exists only here and now.
_HOUSE = re.compile(
    r"^\s*(list|show|check|get|tail|fetch|take\s+a\s+look|give\s+me)\b|"
    r"\b(for\s+me|right\s+now|today|currently|latest|last\s+(backup|deploy|run)|"
    r"in\s+sync|is\s+deployed|did\s+the\s+last|how\s+much\s+\w+\s+is\s+left|"
    r"data-0\d|apps-0\d|gpu-0\d|ctrl-0\d)\b",
    re.I,
)

# "can you …", "do you have …" — a question about JARVIS's own abilities.
# Only meaningful alongside a lab noun: "can you tell me a joke" is chat.
_SELF_ABILITY = re.compile(
    r"\b(can\s+you|could\s+you|do\s+you\s+have|are\s+you\s+able\s+to|"
    r"do\s+you\s+know\s+how\s+to)\b",
    re.I,
)

# Subjects no capability in the manifest owns. This is the load-bearing half
# of the rule and the reason it can be trusted: JARVIS refuses only when the
# request names something he demonstrably has no verb for, rather than
# whenever a sentence merely *looks* like an instruction.
#
# The first version refused on shape alone, and promptly told Gordon "that is
# not something I can do" in answer to "show me all your saved facts and
# memories" — while offering, two lines later, to read back everything he had
# asked it to remember. A refusal that contradicts its own capability list is
# worse than the hallucination it replaced.
#
# When a capability lands for one of these, delete its word from here in the
# same commit. That is the only maintenance this list should ever get.
_UNSERVED_SUBJECT = re.compile(
    r"\b(certificates?|secrets?|volumes?|ingress)\b",
    re.I,
)

# "what can you do" with no subject attached — answered by meta.capabilities.
_META_ASK = re.compile(
    r"\b(what\s+(can|could)\s+you\s+(actually\s+)?do"
    r"(\s+for\s+me)?|what\s+are\s+your\s+(capabilities|abilities)|"
    r"what\s+verbs\s+do\s+you\s+have|list\s+your\s+capabilities)\b",
    re.I,
)


def is_house_request(text: str) -> bool:
    """True only when the utterance asks this lab for something nothing serves.

    Three conditions, and all must hold. Ordered cheapest-first, but the
    middle one is the point: never refuse a subject a capability owns, even
    if the phrasing was one the matchers failed to recognise. A missed
    capability should fall through and be answered badly by the talker
    (status quo, and slice 3's job) rather than be denied outright — denying
    it states something untrue about JARVIS himself.
    """
    t = " ".join((text or "").strip().split())
    if not t or _CONCEPTUAL.search(t):
        return False
    if not _UNSERVED_SUBJECT.search(t):
        return False
    return bool(_HOUSE.search(t) or (_SELF_ABILITY.search(t) and _LAB_NOUN.search(t)))
