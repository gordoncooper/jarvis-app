"""Event journal behind the NOC ticker.

The ticker must read like a log, not like a row of identical "Ready" lines with
one shared timestamp. Every entry here is either a real boot time read from
node_boot_time_seconds or a transition this process actually observed between
two pulses. Nothing is synthesised to fill the strip.
"""

from __future__ import annotations

import time
from collections import deque
from datetime import datetime, timezone
from typing import Any, Deque

MAX_EVENTS = 20
GPU_WARN_C = 80.0

# Pulse fields that are plain up/down booleans, and how to name them in the log.
_SERVICES = {
    "talker": "talker",
    "hands": "hands",
    "stt": "stt",
    "tts": "tts",
}


def _iso(epoch: float) -> str:
    return datetime.fromtimestamp(epoch, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


class EventJournal:
    """Newest-last ring buffer of observed cluster transitions."""

    def __init__(self, maxlen: int = MAX_EVENTS) -> None:
        self._events: Deque[dict[str, str]] = deque(maxlen=maxlen)
        self._node_ready: dict[str, bool] = {}
        self._gpu_hot: dict[str, bool] = {}
        self._services: dict[str, bool] = {}
        self._k3s: str | None = None
        self._seeded = False

    def snapshot(self) -> list[dict[str, str]]:
        return list(self._events)

    def _add(self, ts: float, src: str, msg: str, level: str = "info") -> None:
        self._events.append({"ts": _iso(ts), "src": src, "msg": msg, "level": level})

    def _seed_boots(self, nodes: list[dict[str, Any]], uptimes: dict[str, float]) -> None:
        """One real entry per node, stamped at that node's actual boot time."""
        now = time.time()
        boots = sorted(
            ((now - secs, node) for node, secs in uptimes.items() if secs is not None),
            key=lambda pair: pair[0],
        )
        for boot_ts, node in boots:
            self._add(boot_ts, node, "node booted", "info")
        if not boots:
            self._add(now, "pulse", "journal started", "info")

    def observe(
        self,
        *,
        nodes: list[dict[str, Any]],
        uptimes: dict[str, float],
        k3s: str | None,
        services: dict[str, bool],
    ) -> list[dict[str, str]]:
        now = time.time()

        if not self._seeded:
            self._seed_boots(nodes, uptimes)
            self._seeded = True
            for node in nodes:
                ready = node.get("ready")
                if isinstance(ready, bool):
                    self._node_ready[str(node["id"])] = ready
            self._k3s = k3s
            self._services = dict(services)
            for node in nodes:
                temp = node.get("temp_c")
                if isinstance(temp, (int, float)):
                    self._gpu_hot[str(node["id"])] = temp >= GPU_WARN_C
            return self.snapshot()

        for node in nodes:
            name = str(node.get("id") or "")
            if not name:
                continue
            ready = node.get("ready")
            if isinstance(ready, bool):
                was = self._node_ready.get(name)
                if was is not None and was != ready:
                    self._add(now, name, "NodeReady" if ready else "NodeNotReady",
                              "info" if ready else "bad")
                self._node_ready[name] = ready

            temp = node.get("temp_c")
            if isinstance(temp, (int, float)):
                hot = temp >= GPU_WARN_C
                was_hot = self._gpu_hot.get(name)
                if was_hot is not None and was_hot != hot:
                    self._add(
                        now,
                        name,
                        f"GPU {temp:.0f}°C {'above' if hot else 'back under'} {GPU_WARN_C:.0f}°C",
                        "warn" if hot else "info",
                    )
                self._gpu_hot[name] = hot

        if k3s and k3s != self._k3s:
            self._add(now, "k3s", f"nodes ready {k3s}", "info")
            self._k3s = k3s

        for key, label in _SERVICES.items():
            state = services.get(key)
            if not isinstance(state, bool):
                continue
            was = self._services.get(key)
            if was is not None and was != state:
                self._add(now, label, "online" if state else "unreachable",
                          "info" if state else "bad")
            self._services[key] = state

        return self.snapshot()


journal = EventJournal()
