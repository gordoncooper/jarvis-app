import unittest

from app.pulse_map import assemble_pulse


class PulseAssembleTest(unittest.TestCase):
    def test_maps_hands_nodes_and_gpu_temps_without_inventing_counters(self) -> None:
        body = assemble_pulse(
            health_verb={
                "ok": True,
                "data": {
                    "nodes": [
                        {"name": "ctrl-01", "ready": True, "ip": "10.8.0.10"},
                        {"name": "gpu-01", "ready": True, "ip": "10.8.0.21"},
                    ],
                    "ready_count": 2,
                    "node_count": 2,
                },
            },
            gpus_verb={
                "ok": True,
                "data": {"gpus": [{"node": "gpu-01", "temp_c": 61}]},
            },
            llm_ok=True,
            stt_ok=True,
            tts_ok=False,
            hands_ok=True,
            utc="2026-09-20T20:00:00Z",
        )
        self.assertEqual(body["k3s"], "2/2")
        self.assertEqual(body["utc"], "2026-09-20T20:00:00Z")
        self.assertIsNone(body["lan"])
        self.assertIsNone(body["uptime"])
        self.assertIsNone(body["rings"]["cpu"])
        self.assertIsNone(body["env"]["air_c"])
        self.assertTrue(body["talker"])
        self.assertFalse(body["tts"])
        gpu = next(n for n in body["nodes"] if n["id"] == "gpu-01")
        self.assertEqual(gpu["temp_c"], 61)
        self.assertIsNone(gpu["cpu"])
        self.assertIsNone(gpu["ram"])
        self.assertEqual(gpu["ip"], "10.8.0.21")
        self.assertEqual(gpu["role"], "gpu-node")

    def test_unknown_hands_yields_null_metrics_not_mock_numbers(self) -> None:
        body = assemble_pulse(
            health_verb=None,
            gpus_verb=None,
            llm_ok=False,
            stt_ok=False,
            tts_ok=False,
            hands_ok=False,
            utc="2026-09-20T20:00:00Z",
        )
        self.assertEqual(body["nodes"], [])
        self.assertIsNone(body["k3s"])
        self.assertIsNone(body["rings"]["mem"])
        self.assertEqual(body["events"], [])
        self.assertFalse(body["hands"])


if __name__ == "__main__":
    unittest.main()
