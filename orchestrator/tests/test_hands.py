import unittest

from app.hands import ALLOW_NS, match_verb, parse_confirm_args


class ConfirmArgsTest(unittest.TestCase):
    """`ALLOW_NS` was referenced but never defined, so every utterance that
    named an explicit `namespace/name` raised NameError and the turn 500'd."""

    def test_explicit_namespace_slash_name_resolves(self) -> None:
        args, err = parse_confirm_args(
            "apps.restart_deploy", "restart deploy apps/jarvis-glass"
        )
        self.assertIsNone(err)
        self.assertEqual(args, {"namespace": "apps", "name": "jarvis-glass"})

    def test_namespace_outside_the_allowlist_is_not_accepted(self) -> None:
        # Falls through to the short-name scan rather than trusting the slash
        # form; kube-system is not a namespace this verb may ever write to.
        args, _err = parse_confirm_args(
            "apps.recycle_pod", "recycle pod kube-system/coredns-abc12"
        )
        self.assertNotEqual(args, {"namespace": "kube-system", "name": "coredns-abc12"})

    def test_allowlist_matches_the_shim(self) -> None:
        # The OpenClaw shim re-validates against the same set (D-0023).
        self.assertEqual(ALLOW_NS, {"apps", "inference", "agents", "monitoring"})

    def test_match_verb_does_not_raise_on_slash_form(self) -> None:
        hit = match_verb("restart deploy apps/jarvis-glass")
        self.assertIsNotNone(hit)
        assert hit is not None
        self.assertEqual(hit.name, "apps.restart_deploy")
        self.assertEqual(hit.klass, "confirm")
        self.assertEqual(hit.args, {"namespace": "apps", "name": "jarvis-glass"})

    def test_naming_a_pod_is_a_recycle_not_a_rollout(self) -> None:
        # The service-name rule used to win, so both of these offered to
        # restart a Deployment. The word "pod" is the recycle.
        cases = {
            "can you restart the piper pod for me?": ("apps", "piper"),
            "recycle the glass pod": ("apps", "jarvis-glass"),
            "kill the whisper pod, it's wedged": ("inference", "jarvis-whisper"),
        }
        for text, (ns, name) in cases.items():
            with self.subTest(text=text):
                hit = match_verb(text)
                self.assertIsNotNone(hit)
                assert hit is not None
                self.assertEqual(hit.name, "apps.recycle_pod")
                self.assertEqual(hit.args, {"namespace": ns, "name": name})

    def test_a_deployment_named_without_pod_is_still_a_restart(self) -> None:
        for text, name in (
            ("bounce the orchestrator", "jarvis-orchestrator"),
            ("restart deploy apps/jarvis-glass", "jarvis-glass"),
            ("please restart litellm", "litellm"),
        ):
            with self.subTest(text=text):
                hit = match_verb(text)
                self.assertIsNotNone(hit)
                assert hit is not None
                self.assertEqual(hit.name, "apps.restart_deploy")
                self.assertEqual(hit.args["name"], name)


if __name__ == "__main__":
    unittest.main()


class ShortNameTest(unittest.TestCase):
    """Write targets must name things that exist.

    A wrong row here is not a missed match — it is a confirm prompt offering
    to restart a Deployment that is not there, or one in the wrong namespace.
    Checked against the live cluster on 2026-09-21, which is the only way to
    check it; these assertions just pin what was found so a silent edit shows
    up in review.
    """

    def test_namespaces_are_all_writable(self) -> None:
        from app.hands import ALLOW_NS, SHORT_NAMES

        for name, (ns, _kind) in SHORT_NAMES.items():
            with self.subTest(name=name):
                self.assertIn(ns, ALLOW_NS)

    def test_aliases_resolve_to_a_real_short_name(self) -> None:
        from app.hands import SHORT_NAMES, _NAME_ALIASES

        for alias, real in _NAME_ALIASES.items():
            with self.subTest(alias=alias):
                self.assertIn(real, SHORT_NAMES)

    def test_the_rows_that_had_drifted(self) -> None:
        from app.hands import SHORT_NAMES

        self.assertEqual(SHORT_NAMES["piper"][0], "apps")
        self.assertIn("jarvis-whisper", SHORT_NAMES)
        for gone in ("jarvis-home", "speaches", "openedai-speech", "whisper"):
            with self.subTest(gone=gone):
                self.assertNotIn(gone, SHORT_NAMES)
