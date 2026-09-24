import unittest

from app.memory import parse_memory_intent


class ReferentGuardTest(unittest.TestCase):
    """"remember that" points at an earlier turn and carries no fact. The
    capture group swallowed the bare demonstrative, so the literal fact "that"
    was written to the production store, and "forget that" then substring-
    matched every stored fact containing the word."""

    def test_bare_remember_that_is_not_stored_as_a_fact(self) -> None:
        hit = parse_memory_intent("remember that")
        self.assertEqual(hit.kind, "remember_ref")
        self.assertEqual(hit.fact, "")

    def test_bare_forget_that_is_not_matched_against_the_store(self) -> None:
        hit = parse_memory_intent("forget that")
        self.assertEqual(hit.kind, "forget_ref")
        self.assertEqual(hit.fact, "")

    def test_referent_variants(self) -> None:
        for text in (
            "remember that",
            "remember this",
            "remember that one",
            "remember the last one",
            "hey jarvis, remember that",
            "forget it",
            "forget that last one",
        ):
            with self.subTest(text=text):
                self.assertIn(parse_memory_intent(text).kind, ("remember_ref", "forget_ref"))

    def test_a_real_fact_after_the_demonstrative_still_stores(self) -> None:
        hit = parse_memory_intent("remember that I take my coffee black")
        self.assertEqual(hit.kind, "remember")
        self.assertEqual(hit.fact, "I take my coffee black")

    def test_a_real_target_after_forget_still_forgets(self) -> None:
        hit = parse_memory_intent("forget that I like tea")
        self.assertEqual(hit.kind, "forget")
        self.assertEqual(hit.fact, "I like tea")

    def test_facts_containing_filler_words_are_not_referents(self) -> None:
        hit = parse_memory_intent("remember that one thing about tea matters")
        self.assertEqual(hit.kind, "remember")

    def test_forget_everything_still_wipes(self) -> None:
        self.assertEqual(parse_memory_intent("forget everything").kind, "forget_all")

    def test_a_full_wipe_is_named_and_a_single_fact_is_not(self) -> None:
        for text in (
            "wipe all my memories",
            "delete all facts",
            "erase all preferences",
            "clear my memory",
            "hey jarvis, forget all my preferences",
            "drop all memory please",
            "remove all of my facts",
        ):
            with self.subTest(text=text):
                self.assertEqual(parse_memory_intent(text).kind, "forget_all")
        for text in (
            "forget that I like tea",
            "delete the memory about dark mode",
            "wipe this session",
            "clear this chat",
        ):
            with self.subTest(text=text):
                self.assertNotEqual(parse_memory_intent(text).kind, "forget_all")

    def test_list_is_unaffected(self) -> None:
        self.assertEqual(parse_memory_intent("list memories").kind, "list")

    def test_closed_list_phrasings_the_anchor_used_to_drop(self) -> None:
        for text in (
            "what do you remember about me",
            "what do you remember about me?",
            "show me your memory",
            "read back my preferences",
        ):
            with self.subTest(text=text):
                hit = parse_memory_intent(text)
                self.assertEqual(hit.kind, "list")
                self.assertEqual(hit.fact, "")

    def test_a_longer_memory_question_is_not_a_list(self) -> None:
        # End-anchored. These are chat, not a dump of promoted memory.
        for text in (
            "show me your memory of the battle of Hastings",
            "what do you remember about kubernetes",
        ):
            with self.subTest(text=text):
                self.assertEqual(parse_memory_intent(text).kind, "none")

    def test_keep_in_mind_and_make_a_note_store_the_fact(self) -> None:
        # memory.remember is not classifier-promotable, so these have to
        # match here or they reach the talker forever.
        late = parse_memory_intent("keep in mind that I work late")
        self.assertEqual(late.kind, "remember")
        self.assertEqual(late.fact, "I work late")
        dog = parse_memory_intent("make a note that my dog is called Bagel")
        self.assertEqual(dog.kind, "remember")
        self.assertEqual(dog.fact, "my dog is called Bagel")

    def test_a_note_that_is_only_a_pointer_is_a_referent(self) -> None:
        hit = parse_memory_intent("keep in mind that")
        self.assertEqual(hit.kind, "remember_ref")


if __name__ == "__main__":
    unittest.main()


class PendingCarriesItsVerbTest(unittest.TestCase):
    """Both pending shapes must name their verb.

    `main._run_turn` reports that name as the turn's `route` when a confirm is
    resolved. Without it, answering "yes" logs `chat` — claiming the talker
    replied when the orchestrator actually wrote a fact or bounced a pod.
    """

    def test_memory_pendings_name_a_verb(self) -> None:
        from app.memory import new_memory_pending

        self.assertEqual(new_memory_pending("a fact")["verb"], "memory.remember")
        self.assertEqual(
            new_memory_pending("a fact", action="forget", facts=["a fact"])["verb"],
            "memory.forget",
        )
        self.assertEqual(
            new_memory_pending("", action="forget_all")["verb"],
            "memory.forget_all",
        )

    def test_hands_pendings_name_a_verb(self) -> None:
        from app.hands import new_pending

        p = new_pending("apps.restart_deploy", {"namespace": "apps", "name": "piper"}, "x")
        self.assertEqual(p["verb"], "apps.restart_deploy")


class ForgetAllStoreTest(unittest.TestCase):
    def test_yes_would_tombstone_every_active_fact(self) -> None:
        import tempfile
        from pathlib import Path

        from app.memory import PromotedMemory

        with tempfile.TemporaryDirectory() as tmp:
            mem = PromotedMemory(str(Path(tmp) / "m.db"))
            mem.remember("coffee is black")
            mem.remember("prefers GPU temps in F")
            self.assertEqual(mem.count_active(), 2)
            removed = mem.forget_all()
            self.assertEqual(mem.count_active(), 0)
            self.assertCountEqual(removed, ["coffee is black", "prefers GPU temps in F"])
