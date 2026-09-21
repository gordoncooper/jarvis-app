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


class SelfServedTest(unittest.TestCase):
    """Capabilities the orchestrator answers itself (D-0036).

    They exist partly so the house can still answer when Hands is down, so
    the coupling that matters is: every one of them has a handler, and none
    of them quietly routes through the shim.
    """

    def test_every_self_served_capability_has_a_handler(self) -> None:
        from app.local_verbs import HANDLERS

        declared = {
            c.name
            for c in MANIFEST.values()
            if c.backend in ("prom", "kube", "local")
        }
        # meta.capabilities is answered inline in main.py from the manifest.
        declared.discard("meta.capabilities")
        self.assertEqual(declared, set(HANDLERS))

    def test_no_handler_exists_for_something_undeclared(self) -> None:
        from app.local_verbs import HANDLERS

        for name in HANDLERS:
            with self.subTest(name=name):
                self.assertIn(name, MANIFEST)

    def test_self_served_capabilities_never_reach_the_shim(self) -> None:
        from app.local_verbs import HANDLERS

        for name in HANDLERS:
            with self.subTest(name=name):
                self.assertNotIn(name, CATALOG)

    def test_they_are_all_reads(self) -> None:
        # Nothing here should ever be confirm-class; if one needs a confirm
        # it belongs behind Hands with a blast radius and a Role.
        for cap in MANIFEST.values():
            if cap.backend in ("prom", "kube", "local"):
                with self.subTest(name=cap.name):
                    self.assertEqual(cap.klass, "trusted")


class KubeReadTest(unittest.TestCase):
    """The orchestrator's Kubernetes access is read-only and allowlisted.

    It exists for flux.status alone (D-0037). The ServiceAccount had no RBAC
    at all before that, so the ClusterRole in
    cluster/clusters/jarvis/apps/jarvis-orchestrator-rbac.yaml is the entire
    list of what the product brain may see. These assert the client cannot
    quietly grow past it.
    """

    def test_only_flux_reads_are_reachable(self) -> None:
        from app.kube import READ_PATHS

        self.assertEqual(
            set(READ_PATHS), {"flux_kustomizations", "flux_gitrepositories"}
        )
        for name, path in READ_PATHS.items():
            with self.subTest(name=name):
                self.assertIn("fluxcd.io", path)
                self.assertIn("/namespaces/flux-system/", path)

    def test_a_caller_cannot_pass_an_arbitrary_path(self) -> None:
        import asyncio

        from app.kube import read

        for attempt in ("/api/v1/secrets", "flux_kustomizations/../secrets", "pods"):
            with self.subTest(attempt=attempt):
                with self.assertRaises(ValueError):
                    asyncio.run(read(attempt))

    def test_the_client_has_no_write_path(self) -> None:
        import inspect

        from app import kube

        src = inspect.getsource(kube)
        for verb in (".post(", ".put(", ".patch(", ".delete("):
            with self.subTest(verb=verb):
                self.assertNotIn(verb, src)
