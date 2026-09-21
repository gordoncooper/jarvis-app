import unittest

from app.journal import EventJournal
from app.prom import PromSnapshot, _vector
from app.pulse_map import assemble_pulse, derive_lan, format_uptime

HEALTH = {
    "ok": True,
    "data": {
        "nodes": [
            {"name": "ctrl-01", "ready": True, "ip": "10.8.0.10"},
            {"name": "gpu-01", "ready": True, "ip": "10.8.0.21"},
        ],
        "ready_count": 2,
        "node_count": 2,
    },
}


def snapshot() -> PromSnapshot:
    return PromSnapshot(
        nodes={
            "cpu": {"ctrl-01": 24.4, "gpu-01": 67.2},
            "ram": {"ctrl-01": 38.0, "gpu-01": 71.4},
            "disk": {"ctrl-01": 41.0, "gpu-01": 64.0},
            "load": {"ctrl-01": 1.234, "gpu-01": 4.8},
            "uptime_s": {"ctrl-01": 90000.0, "gpu-01": 3600.0},
        },
        scalars={
            "ring_cpu": 42.4,
            "ring_mem": 56.0,
            "ring_net": 18.0,
            "ring_io": 27.0,
            "uptime_s": 1320138.0,
            "env_cpu_c": 50.85,
            "env_fan": 42.0,
            "env_vram": 73.4,
        },
    )


class PulseAssembleTest(unittest.TestCase):
    def test_maps_hands_nodes_and_gpu_temps_without_inventing_counters(self) -> None:
        body = assemble_pulse(
            health_verb=HEALTH,
            gpus_verb={"ok": True, "data": {"gpus": [{"node": "gpu-01", "temp_c": 61}]}},
            llm_ok=True,
            stt_ok=True,
            tts_ok=False,
            hands_ok=True,
            utc="2026-09-20T20:00:00Z",
        )
        self.assertEqual(body["k3s"], "2/2")
        self.assertEqual(body["utc"], "2026-09-20T20:00:00Z")
        self.assertIsNone(body["uptime"])
        self.assertIsNone(body["rings"]["cpu"])
        self.assertIsNone(body["env"]["cpu_c"])
        self.assertIsNone(body["weather"])
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
        self.assertIsNone(body["lan"])
        self.assertIsNone(body["rings"]["mem"])
        self.assertEqual(body["events"], [])
        self.assertFalse(body["hands"])

    def test_prometheus_fills_counters_rings_env_and_uptime(self) -> None:
        body = assemble_pulse(
            health_verb=HEALTH,
            gpus_verb=None,
            llm_ok=True,
            stt_ok=True,
            tts_ok=True,
            hands_ok=True,
            utc="2026-09-20T20:00:00Z",
            prom=snapshot(),
        )
        gpu = next(n for n in body["nodes"] if n["id"] == "gpu-01")
        self.assertEqual(gpu["cpu"], 67.2)
        self.assertEqual(gpu["ram"], 71.4)
        self.assertEqual(gpu["disk"], 64.0)
        self.assertEqual(gpu["load"], 4.8)
        self.assertEqual(gpu["uptime"], "0d 01h 00m 00s")
        self.assertEqual(body["lan"], "10.8.0.0/24")
        self.assertEqual(body["uptime"], "15d 06h 42m 18s")
        self.assertEqual(body["rings"], {"cpu": 42.4, "mem": 56.0, "net": 18.0, "io": 27.0})
        self.assertEqual(body["env"], {"cpu_c": 50.9, "fan": 42.0, "vram": 73.4})

    def test_hands_values_win_over_prometheus_and_percentages_are_clamped(self) -> None:
        health = {"ok": True, "data": {"nodes": [{"name": "ctrl-01", "ready": True, "cpu": 12}]}}
        prom = PromSnapshot(nodes={"cpu": {"ctrl-01": 999.0}, "ram": {"ctrl-01": -3.0}})
        body = assemble_pulse(
            health_verb=health,
            gpus_verb=None,
            llm_ok=True, stt_ok=True, tts_ok=True, hands_ok=True,
            utc="2026-09-20T20:00:00Z",
            prom=prom,
        )
        node = body["nodes"][0]
        self.assertEqual(node["cpu"], 12.0)
        self.assertEqual(node["ram"], 0.0)

    def test_prometheus_only_node_is_listed_when_hands_misses_it(self) -> None:
        prom = PromSnapshot(nodes={"cpu": {"data-09": 5.0}, "gpu_c": {"gpu-07": 70.0}})
        body = assemble_pulse(
            health_verb=None, gpus_verb=None,
            llm_ok=True, stt_ok=True, tts_ok=True, hands_ok=False,
            utc="2026-09-20T20:00:00Z", prom=prom,
        )
        ids = sorted(n["id"] for n in body["nodes"])
        self.assertEqual(ids, ["data-09", "gpu-07"])
        self.assertEqual(next(n for n in body["nodes"] if n["id"] == "gpu-07")["temp_c"], 70.0)
        self.assertEqual(next(n for n in body["nodes"] if n["id"] == "data-09")["cpu"], 5.0)

    def test_mixed_subnets_do_not_produce_a_lan_guess(self) -> None:
        self.assertEqual(derive_lan(["192.168.8.11", "192.168.8.16"]), "192.168.8.0/24")
        self.assertIsNone(derive_lan(["192.168.8.11", "10.0.0.4"]))
        self.assertIsNone(derive_lan([]))
        self.assertIsNone(derive_lan(["not-an-ip"]))

    def test_uptime_format(self) -> None:
        self.assertEqual(format_uptime(1320138), "15d 06h 42m 18s")
        self.assertEqual(format_uptime(0), "0d 00h 00m 00s")
        self.assertIsNone(format_uptime(None))
        self.assertIsNone(format_uptime(-1))


class PromParseTest(unittest.TestCase):
    def test_vector_keeps_largest_series_per_instance_and_drops_nan(self) -> None:
        payload = {
            "status": "success",
            "data": {
                "result": [
                    {"metric": {"instance": "gpu-01"}, "value": [0, "3"]},
                    {"metric": {"instance": "gpu-01"}, "value": [0, "9"]},
                    {"metric": {"instance": "gpu-02"}, "value": [0, "NaN"]},
                    {"metric": {}, "value": [0, "5"]},
                ]
            },
        }
        self.assertEqual(_vector(payload), {"gpu-01": 9.0})

    def test_failed_query_is_empty_not_zero(self) -> None:
        self.assertEqual(_vector({"status": "error"}), {})
        self.assertEqual(_vector(None), {})


class JournalTest(unittest.TestCase):
    def test_seeds_from_real_boot_times_then_logs_only_transitions(self) -> None:
        j = EventJournal()
        nodes = [{"id": "ctrl-01", "ready": True, "temp_c": 50.0},
                 {"id": "gpu-01", "ready": True, "temp_c": 60.0}]
        kw = {"k3s": "2/2", "services": {"talker": True, "hands": True, "stt": True, "tts": True}}
        first = j.observe(nodes=nodes, uptimes={"ctrl-01": 90000.0, "gpu-01": 3600.0}, **kw)
        self.assertEqual([e["msg"] for e in first], ["node booted", "node booted"])
        # Oldest boot first: ctrl-01 has been up longer than gpu-01.
        self.assertEqual([e["src"] for e in first], ["ctrl-01", "gpu-01"])
        self.assertLess(first[0]["ts"], first[1]["ts"])

        steady = j.observe(nodes=nodes, uptimes={}, **kw)
        self.assertEqual(len(steady), 2)

        nodes[1] = {"id": "gpu-01", "ready": False, "temp_c": 85.0}
        after = j.observe(nodes=nodes, uptimes={}, k3s="1/2",
                          services={"talker": False, "hands": True, "stt": True, "tts": True})
        msgs = [e["msg"] for e in after[2:]]
        self.assertIn("NodeNotReady", msgs)
        self.assertIn("nodes ready 1/2", msgs)
        self.assertIn("unreachable", msgs)
        self.assertTrue(any("above 80" in m for m in msgs))
        self.assertEqual(next(e for e in after if e["msg"] == "NodeNotReady")["level"], "bad")

    def test_ring_buffer_is_bounded(self) -> None:
        j = EventJournal(maxlen=3)
        kw = {"uptimes": {}, "k3s": "1/1", "services": {}}
        j.observe(nodes=[{"id": "a", "ready": True}], **kw)
        for i in range(6):
            j.observe(nodes=[{"id": "a", "ready": bool(i % 2)}], **kw)
        self.assertEqual(len(j.snapshot()), 3)


if __name__ == "__main__":
    unittest.main()


class SeriesTest(unittest.TestCase):
    def test_range_matrix_aligns_onto_the_bucket_grid_and_keeps_gaps(self) -> None:
        from app.prom import _matrix

        payload = {
            "status": "success",
            "data": {
                "result": [
                    {
                        "metric": {"instance": "gpu-01"},
                        # t=1000 (bucket 0), t=1120 (bucket 2). Bucket 1 is a real gap.
                        "values": [[1000, "61"], [1120, "63"]],
                    },
                    {"metric": {"instance": "gpu-02"}, "values": [[9999, "70"]]},
                ]
            },
        }
        out = _matrix(payload, start=1000.0, step=60, buckets=4)
        self.assertEqual(out["gpu-01"], [61.0, None, 63.0, None])
        # Out-of-window samples are dropped, and an all-None series is omitted.
        self.assertNotIn("gpu-02", out)

    def test_series_is_exposed_on_pulse(self) -> None:
        prom = PromSnapshot(series={"gpu_temp": {"gpu-01": [61.0, 62.0]}})
        body = assemble_pulse(
            health_verb=None, gpus_verb=None,
            llm_ok=True, stt_ok=True, tts_ok=True, hands_ok=True,
            utc="2026-09-20T20:00:00Z", prom=prom,
        )
        self.assertEqual(body["series"]["gpu_temp"], {"gpu-01": [61.0, 62.0]})
        self.assertEqual(body["series"]["step_s"], 60)

    def test_missing_prometheus_yields_empty_series_not_fake_points(self) -> None:
        body = assemble_pulse(
            health_verb=None, gpus_verb=None,
            llm_ok=True, stt_ok=True, tts_ok=True, hands_ok=True,
            utc="2026-09-20T20:00:00Z",
        )
        self.assertEqual(body["series"]["gpu_temp"], {})
