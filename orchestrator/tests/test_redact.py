import unittest

from app.kube import choose_pod, pod_log_path, project_pods
from app.redact import summarize_log
from app.router import route


class RedactTest(unittest.TestCase):
    def test_a_credential_line_is_dropped_not_spoken(self) -> None:
        raw = "\n".join(
            [
                "listening on 8080",
                "Authorization: Bearer super-secret-value",
                "token=abc.def.ghi",
                'api_key="sk-live-123"',
                "postgres://jarvis:hunter2@db:5432/jarvis",
                "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJnb3Jkb24ifQ.signature",
                "ERROR connection refused to prometheus",
            ]
        )
        text, counts = summarize_log(raw, workload="orchestrator")
        self.assertEqual(counts["withheld"], 5)
        for leaked in (
            "super-secret-value",
            "abc.def.ghi",
            "sk-live",
            "hunter2",
            "eyJhbGci",
            "eyJzdWIi",
        ):
            self.assertNotIn(leaked, text)
        self.assertIn("connection refused", text)
        self.assertIn("withheld 5", text)

    def test_an_all_secret_tail_is_not_read_out(self) -> None:
        text, counts = summarize_log("password=swordfish\n", workload="piper")
        self.assertEqual(counts["kept"], 0)
        self.assertEqual(counts["withheld"], 1)
        self.assertIn("will not read them out", text)
        self.assertNotIn("swordfish", text)

    def test_a_quiet_log_says_there_was_no_error(self) -> None:
        text, counts = summarize_log("started\nready\n", workload="grafana")
        self.assertEqual(counts["withheld"], 0)
        self.assertIn("nothing that looks like an error", text)
        self.assertIn("started", text)

    def test_only_a_few_lines_are_spoken(self) -> None:
        raw = "\n".join(f"ERROR number {i}" for i in range(20))
        text, counts = summarize_log(raw, workload="ollama")
        self.assertEqual(counts["spoken"], 4)
        self.assertIn("ERROR number 19", text)
        self.assertNotIn("ERROR number 0", text)


class PodPickTest(unittest.TestCase):
    def test_the_spec_is_discarded_before_anyone_else_sees_it(self) -> None:
        pods = project_pods(
            {
                "items": [
                    {
                        "metadata": {
                            "name": "jarvis-orchestrator-abcde-xyz12",
                            "creationTimestamp": "2026-09-22T00:00:00Z",
                        },
                        "spec": {
                            "containers": [
                                {"env": [{"name": "LITELLM_API_KEY", "value": "sk-do-not-keep"}]}
                            ]
                        },
                        "status": {"phase": "Running"},
                    }
                ]
            }
        )
        self.assertEqual(pods, [
            {
                "name": "jarvis-orchestrator-abcde-xyz12",
                "phase": "Running",
                "started": "2026-09-22T00:00:00Z",
                "deleting": "",
            }
        ])
        blob = str(pods)
        self.assertNotIn("sk-do-not-keep", blob)
        self.assertNotIn("LITELLM", blob)

    def test_a_running_pod_wins_over_an_older_succeeded_one(self) -> None:
        chosen = choose_pod(
            [
                {"name": "piper-old", "phase": "Succeeded", "started": "2026-09-01", "deleting": ""},
                {"name": "piper-new", "phase": "Running", "started": "2026-09-22", "deleting": ""},
            ],
            "piper",
        )
        self.assertEqual(chosen, "piper-new")

    def test_log_path_is_fixed_and_rejects_traversal(self) -> None:
        path = pod_log_path("apps", "jarvis-orchestrator")
        self.assertIn("tailLines=80", path)
        self.assertNotIn("follow", path)
        with self.assertRaises(ValueError):
            pod_log_path("apps", "../secrets")
        with self.assertRaises(ValueError):
            pod_log_path("kube-system", "kube-apiserver")


class LogsRouteTest(unittest.TestCase):
    def test_a_named_workload_resolves(self) -> None:
        hit = route("show me the logs for the orchestrator")
        self.assertEqual(hit.label, "logs.tail")
        self.assertEqual(hit.args, {"namespace": "apps", "name": "jarvis-orchestrator"})

    def test_flux_logs_are_labeled_but_not_fetched(self) -> None:
        hit = route("take a look at the flux error logs and tell me what's wrong")
        self.assertEqual(hit.label, "logs.tail")
        self.assertEqual(hit.args["namespace"], "flux-system")

    def test_log_files_in_a_directory_stay_unserved(self) -> None:
        self.assertEqual(
            route("show me the log files in the directory").label,
            "unsupported",
        )

    def test_a_question_about_logs_in_general_stays_chat(self) -> None:
        self.assertEqual(route("what is a log file?").label, "chat")
