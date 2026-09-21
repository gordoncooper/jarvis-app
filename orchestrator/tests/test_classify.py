"""Classifier parsing and precedence (D-0033 slice 3). No network.

The load-bearing property is the closed list: whatever the 7B emits, only a
name already in the manifest can reach execution. VISION's rule exists
because the 7B fake-called tools, so the guard is tested harder than the
happy path.
"""

from __future__ import annotations

import unittest

from app.classify import Verdict, build_prompt, parse_verdict
from app.capabilities import MANIFEST
from app.router import CHAT, UNSUPPORTED, Route, combine


class ParseVerdictTest(unittest.TestCase):
    def test_plain_json(self) -> None:
        v = parse_verdict('{"kind":"capability","verb":"cluster.health","confidence":0.9}')
        self.assertEqual(v, Verdict("capability", "cluster.health", 0.9))

    def test_fenced_json(self) -> None:
        v = parse_verdict('```json\n{"kind":"chat","verb":null,"confidence":0.8}\n```')
        assert v is not None
        self.assertEqual(v.kind, "chat")
        self.assertIsNone(v.verb)

    def test_json_buried_in_prose(self) -> None:
        v = parse_verdict('Sure! {"kind":"chat","verb":null,"confidence":0.7} hope that helps')
        assert v is not None
        self.assertEqual(v.kind, "chat")

    def test_an_invented_verb_is_dropped(self) -> None:
        # The whole reason the talker gets no tools.
        v = parse_verdict('{"kind":"capability","verb":"cluster.nuke","confidence":0.99}')
        assert v is not None
        self.assertIsNone(v.verb)
        self.assertEqual(v.kind, "capability")

    def test_shell_dressed_as_a_verb_is_dropped(self) -> None:
        v = parse_verdict('{"kind":"capability","verb":"kubectl delete ns apps","confidence":1.0}')
        assert v is not None
        self.assertIsNone(v.verb)

    def test_string_null_is_not_a_verb(self) -> None:
        for raw in ("null", "None", ""):
            with self.subTest(raw=raw):
                v = parse_verdict('{"kind":"chat","verb":"%s","confidence":0.9}' % raw)
                assert v is not None
                self.assertIsNone(v.verb)

    def test_garbage_is_no_opinion(self) -> None:
        for raw in ("", "I think it's a cluster question", "{", "[]", "null"):
            with self.subTest(raw=raw):
                self.assertIsNone(parse_verdict(raw))

    def test_unknown_kind_is_rejected(self) -> None:
        self.assertIsNone(parse_verdict('{"kind":"maybe","verb":null,"confidence":0.9}'))

    def test_confidence_is_clamped_and_defaulted(self) -> None:
        v = parse_verdict('{"kind":"chat","verb":null,"confidence":"banana"}')
        assert v is not None
        self.assertEqual(v.confidence, 0.0)
        v = parse_verdict('{"kind":"chat","verb":null,"confidence":5}')
        assert v is not None
        self.assertEqual(v.confidence, 1.0)

    def test_a_named_verb_forces_capability(self) -> None:
        v = parse_verdict('{"kind":"chat","verb":"lab.map","confidence":0.9}')
        assert v is not None
        self.assertEqual(v.kind, "capability")


class PromptTest(unittest.TestCase):
    def test_prompt_lists_every_capability(self) -> None:
        prompt = build_prompt()
        for name in MANIFEST:
            with self.subTest(name=name):
                self.assertIn(name, prompt)

    def test_prompt_teaches_the_overlap_that_actually_broke(self) -> None:
        prompt = build_prompt()
        self.assertIn("what is a GPU?", prompt)
        self.assertIn("how hot are the GPUs?", prompt)


class CombineTest(unittest.TestCase):
    FLOORS = {"min_confidence": 0.6, "min_confidence_write": 0.8}

    def test_a_deterministic_hit_always_wins(self) -> None:
        det = Route("cluster.health", verb_class="trusted")
        out = combine("x", det, Verdict("chat", None, 1.0), **self.FLOORS)
        self.assertEqual(out.label, "cluster.health")

    def test_no_verdict_changes_nothing(self) -> None:
        # A classifier outage must degrade to slice 2 behaviour exactly.
        for det in (Route(CHAT), Route(UNSUPPORTED)):
            with self.subTest(det=det.label):
                self.assertEqual(combine("x", det, None, **self.FLOORS).label, det.label)

    def test_an_unsure_verdict_changes_nothing(self) -> None:
        out = combine("x", Route(CHAT), Verdict("capability", "cluster.health", 0.5), **self.FLOORS)
        self.assertEqual(out.label, CHAT)

    def test_a_confident_verb_fills_a_gap(self) -> None:
        out = combine("anything broken?", Route(CHAT),
                      Verdict("capability", "cluster.health", 0.9), **self.FLOORS)
        self.assertEqual(out.label, "cluster.health")
        self.assertEqual(out.verb_class, "trusted")

    def test_writes_need_more_confidence_than_reads(self) -> None:
        text = "give the piper deployment a kick"
        low = combine(text, Route(CHAT), Verdict("capability", "apps.restart_deploy", 0.7), **self.FLOORS)
        self.assertEqual(low.label, CHAT, "0.7 is under the write floor")
        high = combine(text, Route(CHAT), Verdict("capability", "apps.restart_deploy", 0.9), **self.FLOORS)
        self.assertEqual(high.label, "apps.restart_deploy")
        self.assertEqual(high.args, {"namespace": "inference", "name": "piper"})

    def test_capability_without_a_verb_becomes_an_honest_refusal(self) -> None:
        out = combine("x", Route(CHAT), Verdict("capability", None, 0.9), **self.FLOORS)
        self.assertEqual(out.label, UNSUPPORTED)

    def test_chat_overrides_the_slice_2_stopgap(self) -> None:
        # The rule on sentence shape loses its vote once the model has one.
        out = combine("x", Route(UNSUPPORTED), Verdict("chat", None, 0.9), **self.FLOORS)
        self.assertEqual(out.label, CHAT)

    def test_memory_verbs_come_back_without_shim_args(self) -> None:
        out = combine("read back my preferences", Route(CHAT),
                      Verdict("capability", "memory.list", 0.9), **self.FLOORS)
        self.assertEqual(out.label, "memory.list")
        self.assertIsNone(out.args)


if __name__ == "__main__":
    unittest.main()
