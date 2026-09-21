import unittest

from app.overnight import WINDOW, compose

FULL = (
    {"pods_running": 39, "restarts": 0, "reboots": 0, "peak_load": 2.15, "traffic": 142131000},
    {"gpu_peak": {"gpu-01": 93.0, "gpu-02": 62.0}, "gpu_now": {"gpu-01": 69.0, "gpu-02": 62.0}},
)


class ComposeTest(unittest.TestCase):
    def test_quiet_window_reads_as_short_lines_with_the_notable_change_marked(self) -> None:
        out = compose(*FULL)
        lines = out["overnight"].split("\n")
        self.assertEqual(len(lines), 4)
        self.assertTrue(lines[0].startswith("Quiet window. 39 pods running, none failed."))
        self.assertEqual(lines[1], f"No container restarts and no node reboots in the last {WINDOW}.")
        # Only the hot GPU is flagged with a delta.
        self.assertTrue(lines[2].startswith("Δ gpu-01 peaked at 93°C"))
        self.assertIn("now 69°C", lines[2])
        # Leading capital only: MB and LAN must survive.
        self.assertEqual(lines[3], "Peak 1-minute load 2.15 · 142.1 MB across the LAN.")

    def test_today_rows_carry_a_title_and_a_detail(self) -> None:
        rows = compose(*FULL)["today"]
        self.assertEqual([r["label"] for r in rows], ["Workload", "Restarts", "GPU thermals", "LAN traffic"])
        self.assertEqual(rows[0]["detail"], "39 pods running, none failed")
        self.assertEqual(rows[2]["detail"], "gpu-01 peak 93°C · now 69°C")
        self.assertTrue(all(r["kind"] for r in rows))

    def test_a_cool_gpu_is_not_flagged_as_a_delta(self) -> None:
        out = compose({"restarts": 0}, {"gpu_peak": {"gpu-01": 64.0}, "gpu_now": {"gpu-01": 61.0}})
        self.assertNotIn("Δ", out["overnight"])

    def test_a_busy_window_names_the_restarting_pods_and_is_not_called_quiet(self) -> None:
        out = compose(
            {"pods_running": 38, "pods_failed": 1, "restarts": 5, "reboots": 1},
            {"restart_by_pod": {"ollama-7f": 4.0, "piper-54": 1.0}},
        )
        text = out["overnight"]
        self.assertNotIn("Quiet window", text)
        self.assertIn("1 failed", text)
        self.assertIn("Δ 5 container restarts", text)
        self.assertIn("ollama-7f", text)
        self.assertIn("Δ 1 node reboot recorded", text)
        self.assertIn("Node reboots", [r["label"] for r in out["today"]])

    def test_singular_plural(self) -> None:
        out = compose({"restarts": 1, "reboots": 2}, {})
        self.assertIn("1 container restart in", out["overnight"])
        self.assertIn("2 node reboots recorded", out["overnight"])

    def test_no_measurements_yields_no_briefing_rather_than_filler(self) -> None:
        out = compose({}, {})
        self.assertIsNone(out["overnight"])
        self.assertEqual(out["today"], [])

    def test_partial_data_drops_only_the_missing_clause(self) -> None:
        out = compose({"pods_running": 39}, {})
        self.assertIn("39 pods running", out["overnight"])
        self.assertNotIn("restart", out["overnight"])
        self.assertNotIn("load", out["overnight"])


if __name__ == "__main__":
    unittest.main()
