"""What "that" points at (D-0035).

"remember that" and "delete that last one" carry no fact of their own. Slice 0
stopped them storing the literal word; this is where they resolve. Resolution
is an inference about what Gordon meant, so the result is always
confirm-gated — D-0013 says a model's guess is never written on its own.
"""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from app.router import route
from app.session_store import SessionStore


class ReferentPhraseTest(unittest.TestCase):
    def test_phrases_that_point_backwards(self) -> None:
        for text, label in (
            ("remember that", "memory.remember_ref"),
            ("hey jarvis, delete that last one", "memory.forget_ref"),
            ("scratch that", "memory.forget_ref"),
            ("that's wrong, remove it", "memory.forget_ref"),
            ("undo that", "memory.forget_ref"),
            ("forget that", "memory.forget_ref"),
        ):
            with self.subTest(text=text):
                self.assertEqual(route(text).label, label)

    def test_a_named_target_is_not_a_referent(self) -> None:
        # These say what they mean, so they must not be diverted.
        self.assertEqual(route("delete the memory about dark mode").label, "memory.forget")
        self.assertEqual(route("forget everything").label, "memory.forget_all")
        self.assertEqual(
            route("remember that I take my coffee black").label, "memory.remember"
        )


class ReferentStoreTest(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.store = SessionStore(str(Path(self._tmp.name) / "s.sqlite"))
        self.sid = self.store.get_or_create("t1").id

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def test_empty_by_default(self) -> None:
        self.assertEqual(self.store.get_referents(self.sid), {})

    def test_values_merge_rather_than_replace(self) -> None:
        self.store.set_referents(self.sid, last_user_text="a", last_fact_text="f")
        self.store.set_referents(self.sid, last_user_text="b")
        refs = self.store.get_referents(self.sid)
        self.assertEqual(refs["last_user_text"], "b")
        self.assertEqual(refs["last_fact_text"], "f", "untouched keys survive")

    def test_none_clears_a_key(self) -> None:
        # How last_candidate stops surviving a turn that found nothing, so
        # "remember that" cannot reach back five exchanges.
        self.store.set_referents(self.sid, last_candidate="c")
        self.store.set_referents(self.sid, last_candidate=None)
        self.assertNotIn("last_candidate", self.store.get_referents(self.sid))

    def test_survives_a_pod_restart(self) -> None:
        # Sessions outlive the process (D-0024); "remember that" after a
        # restart must not quietly mean something else.
        self.store.set_referents(self.sid, last_candidate="Gordon likes black coffee")
        reopened = SessionStore(str(self.store.path))
        sess = reopened.get_or_create(self.sid)
        self.assertEqual(
            reopened.get_referents(sess.id)["last_candidate"],
            "Gordon likes black coffee",
        )

    def test_referents_are_per_session(self) -> None:
        other = self.store.get_or_create("t2").id
        self.store.set_referents(self.sid, last_candidate="mine")
        self.assertEqual(self.store.get_referents(other), {})


if __name__ == "__main__":
    unittest.main()
