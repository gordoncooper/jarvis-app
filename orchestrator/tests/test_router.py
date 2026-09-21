"""The intent-router gate (D-0033 slice 1).

Scores `app.router.route` — the real router, not a copy of it — against
`fixtures/utterances.tsv`, and fails the build on two absolute counts:

  * chat false-positives must be 0. This protects the thing that already
    works. Widening a regex to catch one more phrasing usually steals a
    general question, and that trade is never worth it.
  * false refusals must be 0, and that means two things, not one: no
    ordinary question may be answered with "I cannot do that", and neither
    may a request for something JARVIS genuinely can do. The second is the
    one that bit — the first cut of the slice 2 rule refused "show me all
    your saved facts and memories" while offering, in the same reply, to
    read back everything Gordon had asked it to remember.
  * capability passes must not drop below the recorded baseline.

Absolute counts, deliberately, not rates: a rate over the mixed set climbs
when you add negatives, which would let the gate rot while looking healthier.
"""

from __future__ import annotations

import unittest
from pathlib import Path

from app.router import CHAT, UNSUPPORTED, route

FIXTURE = Path(__file__).parent / "fixtures" / "utterances.tsv"

# Recorded 2026-09-21 on orchestrator v0.6.28. Raise this when a slice
# genuinely improves recall; never lower it to make a build pass.
#
# History, so the number is auditable rather than folklore:
#   39  slice 2. The 'unsupported' and 'meta.capabilities' utterances now
#       route correctly instead of reaching the talker, which is the whole
#       point of the slice — an honest refusal is a right answer. 39 and not
#       40 because "list all the running pods for me" was given back to the
#       talker on purpose: pods are a subject a capability owns, so the
#       refusal rule must not claim ignorance of them.
#   26  pre-slice-0, coarse labels — but one was `remember that` "passing"
#       by storing the word "that", i.e. a bug counted as a pass
#   25  post-slice-0, same coarse labels
#   28  slice 1. +2 is real: narrowing the `gpu` regex let "are the graphics
#       cards running warm?" and "how much video memory is free?" route, while
#       dropping the three chat false-positives. The rest is label precision —
#       memory.candidate / .forget_all / .remember_ref are distinct outcomes
#       and the coarse buckets had been scoring them against the wrong name.
#
# This gate scores the DETERMINISTIC pass only — no network in unit tests, so
# the classifier is not represented here. It is therefore a floor: the number
# JARVIS manages with the local model unavailable. The classifier's own score
# comes from `python -m app.score_router` against the same fixture, and was
# 47/64 on 2026-09-21.
BASELINE_CAPABILITY_PASSES = 39




def load_cases() -> list[tuple[str, str]]:
    cases: list[tuple[str, str]] = []
    for raw in FIXTURE.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        expected, _, utterance = line.partition("\t")
        assert utterance, f"fixture line is not <label>TAB<utterance>: {raw!r}"
        cases.append((expected.strip(), utterance.strip()))
    return cases


class RouterGateTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.cases = load_cases()
        cls.scored = [(exp, route(utt).label, utt) for exp, utt in cls.cases]

    def test_fixture_is_not_empty(self) -> None:
        self.assertGreaterEqual(len(self.cases), 89)

    def test_no_plain_chat_is_captured_by_a_verb(self) -> None:
        stolen = [
            (utt, got)
            for exp, got, utt in self.scored
            if exp == CHAT and got != CHAT
        ]
        self.assertEqual(
            stolen,
            [],
            "plain chat was routed into a capability:\n"
            + "\n".join(f"  {u!r} -> {g}" for u, g in stolen),
        )

    def test_no_ordinary_question_is_refused(self) -> None:
        refused = [
            utt for exp, got, utt in self.scored
            if exp == CHAT and got == UNSUPPORTED
        ]
        self.assertEqual(
            refused,
            [],
            "ordinary conversation was answered with a refusal:\n"
            + "\n".join(f"  {u!r}" for u in refused),
        )

    def test_a_capability_request_is_never_refused(self) -> None:
        # Worse than a miss: a refusal asserts something untrue about JARVIS.
        # A phrasing the matchers fail to recognise should fall through to the
        # talker (status quo) rather than be denied outright.
        denied = [
            (utt, exp)
            for exp, got, utt in self.scored
            if got == UNSUPPORTED and exp not in (CHAT, UNSUPPORTED)
        ]
        self.assertEqual(
            denied,
            [],
            "JARVIS refused something he can actually do:\n"
            + "\n".join(f"  {u!r} (is really {e})" for u, e in denied),
        )

    def test_capability_recall_has_not_regressed(self) -> None:
        passes = sum(
            1 for exp, got, _ in self.scored if exp != CHAT and got == exp
        )
        self.assertGreaterEqual(
            passes,
            BASELINE_CAPABILITY_PASSES,
            f"capability recall fell to {passes}, below the recorded "
            f"{BASELINE_CAPABILITY_PASSES}",
        )

    def test_an_unsupported_request_never_acts_on_the_rack(self) -> None:
        # The worst outcome is not a refusal or a guess — it is a request
        # JARVIS cannot serve matching the wrong verb and touching the cluster.
        acted = [
            (utt, got)
            for exp, got, utt in self.scored
            if exp == UNSUPPORTED and got not in (UNSUPPORTED, CHAT)
        ]
        self.assertEqual(
            acted,
            [],
            "a request with no capability matched a real verb:\n"
            + "\n".join(f"  {u!r} -> {g}" for u, g in acted),
        )


class RouterExtractionTest(unittest.TestCase):
    """`route()` must stay the single description of the ordering.

    The order matters and is load-bearing: a preference line has to win over a
    Hands verb, or "I prefer GPU temps in Fahrenheit" runs cluster.gpus
    instead of being remembered (D-0026).
    """

    def test_preference_line_beats_a_metrics_verb(self) -> None:
        self.assertEqual(
            route("I prefer GPU temps in Fahrenheit").label, "memory.candidate"
        )

    def test_explicit_remember_beats_everything(self) -> None:
        self.assertEqual(
            route("remember that I prefer GPU temps in Fahrenheit").label,
            "memory.remember",
        )

    def test_verb_carries_its_class_and_args(self) -> None:
        r = route("restart deploy apps/jarvis-glass")
        self.assertTrue(r.is_verb)
        self.assertEqual(r.verb_class, "confirm")
        self.assertEqual(r.args, {"namespace": "apps", "name": "jarvis-glass"})

    def test_a_trusted_verb_needs_no_args(self) -> None:
        r = route("how is the cluster doing?")
        self.assertEqual(r.label, "cluster.health")
        self.assertEqual(r.verb_class, "trusted")


if __name__ == "__main__":
    unittest.main()
