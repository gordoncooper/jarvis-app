"""Invariants on the capability manifest (D-0033).

The manifest is the one source for the router, the refusal, the talker note
and shim execution. These assert the couplings that would otherwise rot
quietly — a verb JARVIS offers but cannot run, or a memory capability leaking
into the set posted to OpenClaw.
"""

from __future__ import annotations

import unittest

import re

from app.capabilities import BACKENDS, MANIFEST, hands_catalog, refusal, spoken_list
from app.hands import CATALOG
from app.router import _UNSERVED_SUBJECT


class ManifestShapeTest(unittest.TestCase):
    def test_every_entry_is_well_formed(self) -> None:
        for name, cap in MANIFEST.items():
            with self.subTest(name=name):
                self.assertEqual(name, cap.name, "dict key must match .name")
                self.assertIn(cap.klass, ("trusted", "confirm"))
                self.assertIn(cap.backend, BACKENDS)
                self.assertTrue(cap.summary, "needs a spoken summary")
                # Spoken aloud by Piper — keep punctuation it can read.
                for ch in "()/|`":
                    self.assertNotIn(ch, cap.summary)

    def test_confirm_verbs_declare_their_args(self) -> None:
        for cap in MANIFEST.values():
            if cap.backend == "hands" and cap.klass == "confirm":
                with self.subTest(name=cap.name):
                    self.assertEqual(set(cap.args), {"namespace", "name"})

    def test_hands_catalog_is_exactly_the_hands_backed_entries(self) -> None:
        expected = {c.name for c in MANIFEST.values() if c.backend == "hands"}
        self.assertEqual(set(hands_catalog()), expected)

    def test_memory_and_local_never_reach_the_shim(self) -> None:
        # hands.execute_verb refuses anything outside CATALOG; this asserts the
        # memory verbs are genuinely outside it rather than accidentally in.
        for cap in MANIFEST.values():
            if cap.backend != "hands":
                with self.subTest(name=cap.name):
                    self.assertNotIn(cap.name, CATALOG)

    def test_hands_module_catalog_tracks_the_manifest(self) -> None:
        self.assertEqual(CATALOG, hands_catalog())


class RefusalCouplingTest(unittest.TestCase):
    """The refusal rule and the manifest must not both claim a subject.

    `router._UNSERVED_SUBJECT` lists what nothing can serve. The day a
    capability lands for one of those words and it is not removed, JARVIS
    refuses the thing he has just started advertising — the same
    self-contradiction that shipped as v0.6.29 and had to be pulled. The
    comment in `router.py` says to delete the word in the same commit; this
    is what makes that a rule rather than a hope.
    """

    def test_no_capability_describes_a_subject_marked_unserved(self) -> None:
        for cap in MANIFEST.values():
            for word in re.findall(r"[a-z]+", f"{cap.short} {cap.summary}".lower()):
                with self.subTest(name=cap.name, word=word):
                    self.assertIsNone(
                        _UNSERVED_SUBJECT.search(word),
                        f"{cap.name} offers {word!r}, which the refusal rule "
                        f"still treats as unserved \u2014 remove it from "
                        f"router._UNSERVED_SUBJECT",
                    )


class SpokenOutputTest(unittest.TestCase):
    def test_capability_list_mentions_every_capability(self) -> None:
        said = spoken_list()
        for cap in MANIFEST.values():
            with self.subTest(name=cap.name):
                self.assertIn(cap.summary, said)

    def test_refusal_says_what_it_cannot_do_and_what_it_can(self) -> None:
        said = refusal()
        self.assertIn("no verb for that", said)
        self.assertIn("will not guess", said)
        # A refusal that does not offer the alternative is just a dead end.
        self.assertIn(MANIFEST["cluster.health"].short, said)

    def test_refusal_stays_short_enough_to_speak(self) -> None:
        # Piper reads this aloud. The first cut recited nine bullets.
        self.assertLess(len(refusal()), 400)
        self.assertNotIn("\n", refusal())

    def test_every_capability_has_a_short_form(self) -> None:
        for cap in MANIFEST.values():
            with self.subTest(name=cap.name):
                self.assertTrue(cap.short, "needed for the one-breath refusal")


if __name__ == "__main__":
    unittest.main()
