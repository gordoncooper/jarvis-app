"""The chat command is the whole utterance. Nearby memory phrases stay memory."""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from app.session_intent import parse_session_intent
from app.session_store import SessionStore


class ParseTests(unittest.TestCase):
    def test_discard_phrases(self) -> None:
        for text in (
            "clear this chat",
            "Clear the chat.",
            "delete this chat",
            "delete this conversation",
            "wipe this session",
            "forget this chat",
            "hey jarvis, forget this chat",
            "hey jarvis forget this chat",
            "jarvis, clear this chat",
            "please clear this chat",
            "erase the current conversation",
            "discard this thread",
            "drop this chat please",
            "clear this chat session",
        ):
            with self.subTest(text=text):
                self.assertEqual(parse_session_intent(text), "discard")

    def test_rotate_phrases(self) -> None:
        for text in (
            "start a new chat",
            "start a new session",
            "start a fresh conversation",
            "create a new chat session",
            "create a new session",
            "new chat",
            "new session",
            "hey jarvis, start a new chat",
            "hey jarvis start a new session",
            "begin a new chat",
            "open a new session",
            "make a new chat",
        ):
            with self.subTest(text=text):
                self.assertEqual(parse_session_intent(text), "rotate")

    def test_memory_and_ordinary_chat_are_left_alone(self) -> None:
        for text in (
            "forget that",
            "forget that I like tea",
            "forget everything",
            "delete that last one",
            "forget the memory about tea",
            "clear the cluster",
            "delete the pod",
            "what is this chat about",
            "please clear this chat and tell me the weather",
            "start a new chat about the gpus",
            "remember that I take my coffee black",
            "hey jarvis, how are the nodes",
        ):
            with self.subTest(text=text):
                self.assertIsNone(parse_session_intent(text))


class StoreTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.store = SessionStore(str(Path(self.tmp.name) / "s.db"))

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def test_discard_removes_the_transcript_and_keeps_nothing(self) -> None:
        sess = self.store.get_or_create(None)
        self.store.append(sess.id, "user", "the secret")
        self.store.append(sess.id, "assistant", "noted")
        self.store.set_pending(sess.id, {"kind": "hands", "id": "c1", "expires_at": 9e12})
        self.store.set_referents(sess.id, last_user_text="the secret")
        self.store.discard(sess.id)

        self.assertIsNone(self.store._load(sess.id))
        with self.store._connect() as conn:
            messages = conn.execute("SELECT content FROM messages").fetchall()
            pending = conn.execute("SELECT kind FROM pending").fetchall()
            refs = conn.execute("SELECT payload_json FROM referents").fetchall()
        self.assertEqual(messages, [])
        self.assertEqual(pending, [])
        self.assertEqual(refs, [])
        # The discarded id is not sitting in the cache either.
        self.assertNotIn(sess.id, self.store._cache)

    def test_a_new_session_leaves_the_old_one_on_disk(self) -> None:
        old = self.store.get_or_create(None)
        self.store.append(old.id, "user", "keep me")
        fresh = self.store.get_or_create(None)
        self.assertNotEqual(fresh.id, old.id)
        self.assertEqual(fresh.messages, [])
        kept = self.store._load(old.id)
        assert kept is not None
        self.assertEqual(kept.messages[0]["content"], "keep me")


if __name__ == "__main__":
    unittest.main()
