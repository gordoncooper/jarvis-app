"""Prometheus instant-query client for /v1/pulse (D-0012: server side only).

Glass never touches Prometheus. The orchestrator does, and publishes the result
on /v1/pulse. Every value here is a measurement; when a query returns nothing
the field stays None rather than being filled in.
"""

from __future__ import annotations

import asyncio
import logging
import math
import time
from dataclasses import dataclass, field
from typing import Any

import httpx

from .config import settings

log = logging.getLogger("jarvis.orchestrator.prom")

# instance label on every job below is the bare node name (ctrl-01, gpu-01, ...).
RANGE = "2m"

NODE_QUERIES: dict[str, str] = {
    "cpu": f'100*(1-avg by(instance)(rate(node_cpu_seconds_total{{mode="idle"}}[{RANGE}])))',
    "ram": "100*(1-node_memory_MemAvailable_bytes/node_memory_MemTotal_bytes)",
    "disk": (
        ' 100*(1-sum by(instance)(node_filesystem_avail_bytes{mountpoint="/",fstype!~"tmpfs|overlay"})'
        ' /sum by(instance)(node_filesystem_size_bytes{mountpoint="/",fstype!~"tmpfs|overlay"}))'
    ),
    "load": "node_load1",
    "cpu_c": "max by(instance)(node_hwmon_temp_celsius)",
    "uptime_s": "time()-node_boot_time_seconds",
    "net_bps": (
        f"sum by(instance)(rate(node_network_receive_bytes_total{{device!~'lo|veth.*|cni.*|flannel.*'}}[{RANGE}])"
        f"+rate(node_network_transmit_bytes_total{{device!~'lo|veth.*|cni.*|flannel.*'}}[{RANGE}]))"
    ),
    "gpu_c": "max by(instance)(nvidia_smi_temperature_gpu)",
    "gpu_util": "100*max by(instance)(nvidia_smi_utilization_gpu_ratio)",
    "vram": "100*max by(instance)(nvidia_smi_memory_used_bytes/nvidia_smi_memory_total_bytes)",
    "fan": "100*max by(instance)(nvidia_smi_fan_speed_ratio)",
}

SCALAR_QUERIES: dict[str, str] = {
    "ring_cpu": f'100*(1-avg(rate(node_cpu_seconds_total{{mode="idle"}}[{RANGE}])))',
    "ring_mem": "100*(1-sum(node_memory_MemAvailable_bytes)/sum(node_memory_MemTotal_bytes))",
    "ring_net": (
        f"100*sum(rate(node_network_receive_bytes_total{{device='eth0'}}[{RANGE}])"
        f"+rate(node_network_transmit_bytes_total{{device='eth0'}}[{RANGE}]))"
        "/sum(node_network_speed_bytes{device='eth0'})"
    ),
    "ring_io": f"100*avg(rate(node_disk_io_time_seconds_total[{RANGE}]))",
    "uptime_s": "time()-min(node_boot_time_seconds)",
    "env_cpu_c": "max(node_hwmon_temp_celsius)",
    "env_fan": "100*max(nvidia_smi_fan_speed_ratio)",
    "env_vram": "100*max(nvidia_smi_memory_used_bytes/nvidia_smi_memory_total_bytes)",
}


# Range queries back the NOC sparklines, so a fresh page load already shows
# history instead of waiting minutes to accumulate client-side samples.
HISTORY_WINDOW_SEC = 1800
HISTORY_STEP_SEC = 60

RANGE_QUERIES: dict[str, str] = {
    "gpu_temp": "max by(instance)(nvidia_smi_temperature_gpu)",
}


@dataclass
class PromSnapshot:
    """Query name -> {node: value} for vectors, plus name -> value for scalars."""

    nodes: dict[str, dict[str, float]] = field(default_factory=dict)
    scalars: dict[str, float] = field(default_factory=dict)
    series: dict[str, dict[str, list[float | None]]] = field(default_factory=dict)

    def node_value(self, metric: str, node: str) -> float | None:
        return self.nodes.get(metric, {}).get(node)

    def scalar(self, name: str) -> float | None:
        return self.scalars.get(name)

    @property
    def ok(self) -> bool:
        return bool(self.nodes or self.scalars or self.series)


def _finite(raw: Any) -> float | None:
    try:
        value = float(raw)
    except (TypeError, ValueError):
        return None
    return value if math.isfinite(value) else None


def _vector(payload: Any) -> dict[str, float]:
    out: dict[str, float] = {}
    if not isinstance(payload, dict) or payload.get("status") != "success":
        return out
    for row in (payload.get("data") or {}).get("result") or []:
        instance = (row.get("metric") or {}).get("instance")
        value = _finite((row.get("value") or [None, None])[1])
        if not instance or value is None:
            continue
        # A node may expose several series for one query; keep the largest.
        prev = out.get(instance)
        out[instance] = value if prev is None else max(prev, value)
    return out


def _scalar(payload: Any) -> float | None:
    if not isinstance(payload, dict) or payload.get("status") != "success":
        return None
    result = (payload.get("data") or {}).get("result") or []
    if not result:
        return None
    return _finite((result[0].get("value") or [None, None])[1])


def _matrix(payload: Any, start: float, step: int, buckets: int) -> dict[str, list[float | None]]:
    """Align each series onto a fixed grid; gaps stay None so the line breaks."""
    out: dict[str, list[float | None]] = {}
    if not isinstance(payload, dict) or payload.get("status") != "success":
        return out
    for row in (payload.get("data") or {}).get("result") or []:
        instance = (row.get("metric") or {}).get("instance")
        if not instance:
            continue
        slots: list[float | None] = [None] * buckets
        for pair in row.get("values") or []:
            try:
                ts = float(pair[0])
            except (TypeError, ValueError, IndexError):
                continue
            value = _finite(pair[1] if len(pair) > 1 else None)
            if value is None:
                continue
            idx = int(round((ts - start) / step))
            if 0 <= idx < buckets:
                slots[idx] = value
        if any(v is not None for v in slots):
            out[instance] = slots
    return out


async def _query(client: httpx.AsyncClient, base: str, expr: str) -> Any:
    try:
        r = await client.post(f"{base}/api/v1/query", data={"query": expr})
        if r.status_code >= 400:
            log.info("prometheus %s -> HTTP %s", expr[:48], r.status_code)
            return None
        return r.json()
    except Exception:  # noqa: BLE001
        log.info("prometheus unreachable for %s", expr[:48])
        return None


async def _query_range(
    client: httpx.AsyncClient, base: str, expr: str, start: float, end: float, step: int
) -> Any:
    try:
        r = await client.post(
            f"{base}/api/v1/query_range",
            data={"query": expr, "start": f"{start:.0f}", "end": f"{end:.0f}", "step": str(step)},
        )
        if r.status_code >= 400:
            log.info("prometheus range %s -> HTTP %s", expr[:48], r.status_code)
            return None
        return r.json()
    except Exception:  # noqa: BLE001
        log.info("prometheus range unreachable for %s", expr[:48])
        return None


async def fetch_snapshot() -> PromSnapshot:
    """One round-trip batch of instant queries. Failure yields an empty snapshot."""
    base = settings.prometheus_base.rstrip("/")
    if not base:
        return PromSnapshot()
    node_keys = list(NODE_QUERIES)
    scalar_keys = list(SCALAR_QUERIES)
    range_keys = list(RANGE_QUERIES)
    end = time.time()
    buckets = HISTORY_WINDOW_SEC // HISTORY_STEP_SEC + 1
    start = end - HISTORY_WINDOW_SEC
    try:
        async with httpx.AsyncClient(timeout=settings.prometheus_timeout) as client:
            payloads = await asyncio.gather(
                *(_query(client, base, NODE_QUERIES[k]) for k in node_keys),
                *(_query(client, base, SCALAR_QUERIES[k]) for k in scalar_keys),
                *(
                    _query_range(client, base, RANGE_QUERIES[k], start, end, HISTORY_STEP_SEC)
                    for k in range_keys
                ),
            )
    except Exception:  # noqa: BLE001
        log.info("prometheus batch failed")
        return PromSnapshot()

    snap = PromSnapshot()
    cut = len(node_keys)
    for key, payload in zip(node_keys, payloads[:cut]):
        vec = _vector(payload)
        if vec:
            snap.nodes[key] = vec
    for key, payload in zip(scalar_keys, payloads[cut : cut + len(scalar_keys)]):
        value = _scalar(payload)
        if value is not None:
            snap.scalars[key] = value
    cut += len(scalar_keys)
    for key, payload in zip(range_keys, payloads[cut:]):
        mat = _matrix(payload, start, HISTORY_STEP_SEC, buckets)
        if mat:
            snap.series[key] = mat
    return snap
