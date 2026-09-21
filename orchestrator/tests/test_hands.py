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


if __name__ == "__main__":
    unittest.main()
