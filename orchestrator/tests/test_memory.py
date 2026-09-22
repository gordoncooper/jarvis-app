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

    def test_list_is_unaffected(self) -> None:
        self.assertEqual(parse_memory_intent("list memories").kind, "list")


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

    def test_hands_pendings_name_a_verb(self) -> None:
        from app.hands import new_pending

        p = new_pending("apps.restart_deploy", {"namespace": "apps", "name": "piper"}, "x")
        self.assertEqual(p["verb"], "apps.restart_deploy")
