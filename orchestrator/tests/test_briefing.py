import unittest

from app.briefing_map import assemble_briefing


class BriefingAssembleTest(unittest.TestCase):
    def test_unheaded_prose_becomes_lab_only(self) -> None:
        body = assemble_briefing(
            "The lab is a physical LAN rack. Operator is Gordon."
        )
        self.assertEqual(body["lab"], "The lab is a physical LAN rack. Operator is Gordon.")
        self.assertIsNone(body["overnight"])
        self.assertEqual(body["agenda"], [])
        self.assertEqual(body["today"], [])
        self.assertIsNone(body["focus"])

    def test_headings_map_without_inventing_metrics(self) -> None:
        md = """
## Lab
Physical LAN rack. Live numbers come from the cluster.

## Overnight
Flux reconciled. No incidents in the log.

## Agenda
- 09:00 Lab sync
- 14:00 Spare

## Today
- 06:58 inbound 3 unread
- 07:10 [calendar] Rack walk

## Focus
Ask before mutating the cluster.

## Lab name
JARVIS LAB
"""
        body = assemble_briefing(md)
        self.assertIn("Physical LAN rack", body["lab"] or "")
        self.assertIn("Flux reconciled", body["overnight"] or "")
        self.assertEqual(body["agenda"][0], {"t": "09:00", "label": "Lab sync"})
        self.assertEqual(
            body["today"][0],
            {"t": "06:58", "kind": "inbound", "label": "3 unread"},
        )
        self.assertEqual(
            body["today"][1],
            {"t": "07:10", "kind": "calendar", "label": "Rack walk"},
        )
        self.assertEqual(body["focus"], "Ask before mutating the cluster.")
        self.assertEqual(body["lab_name"], "JARVIS LAB")

    def test_empty_markdown_is_nulls_not_stub_cluster(self) -> None:
        body = assemble_briefing("")
        self.assertIsNone(body["lab"])
        self.assertIsNone(body["overnight"])
        self.assertEqual(body["agenda"], [])
        self.assertEqual(body["today"], [])


if __name__ == "__main__":
    unittest.main()
