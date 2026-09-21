"""Overnight retrospective for the CMD briefing.

The AM BRIEFING column was empty because briefing.md has no Overnight section
and there was nothing else to fill it with. Prometheus keeps the answer: what
the cluster did while the operator was away. Every clause below is a query
result; a query that returns nothing drops its clause rather than guessing.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any

import httpx

from .config import settings
from .prom import _finite, _scalar, _vector

log = logging.getLogger("jarvis.orchestrator.overnight")

WINDOW = "12h"

SCALARS: dict[str, str] = {
    "pods_running": 'count(kube_pod_status_phase{phase="Running"}==1)',
    "pods_pending": 'count(kube_pod_status_phase{phase="Pending"}==1)',
    "pods_failed": 'count(kube_pod_status_phase{phase="Failed"}==1)',
    "restarts": f"sum(increase(kube_pod_container_status_restarts_total[{WINDOW}]))",
    "reboots": f"max(changes(node_boot_time_seconds[{WINDOW}]))",
    "peak_load": f"max(max_over_time(node_load1[{WINDOW}]))",
    "traffic": (
        f'sum(increase(node_network_receive_bytes_total{{device="eth0"}}[{WINDOW}])'
        f'+increase(node_network_transmit_bytes_total{{device="eth0"}}[{WINDOW}]))'
    ),
}

VECTORS: dict[str, str] = {
    "gpu_peak": f"max by(instance)(max_over_time(nvidia_smi_temperature_gpu[{WINDOW}]))",
    "gpu_now": "max by(instance)(nvidia_smi_temperature_gpu)",
    "restart_by_pod": (
        f"topk(3, sum by(pod)(increase(kube_pod_container_status_restarts_total[{WINDOW}])) > 0)"
    ),
}


def _bytes(n: float) -> str:
    for unit, scale in (("TB", 1e12), ("GB", 1e9), ("MB", 1e6), ("kB", 1e3)):
        if n >= scale:
            return f"{n / scale:.1f} {unit}"
    return f"{int(n)} B"


def _plural(n: int, one: str, many: str) -> str:
    return one if n == 1 else many


def compose(scalars: dict[str, float], vectors: dict[str, dict[str, float]]) -> dict[str, Any]:
    """Pure mapping: measurements in, briefing lines and Today rows out.

    The reference briefing is several short lines, not one paragraph, with the
    notable change marked. Lines prefixed with a delta are rendered in accent.
    """
    lines: list[str] = []
    today: list[dict[str, str]] = []

    running = scalars.get("pods_running")
    pending = scalars.get("pods_pending") or 0
    failed = scalars.get("pods_failed") or 0
    restarts = scalars.get("restarts")
    reboots = scalars.get("reboots")

    quiet = (
        (restarts is None or restarts < 0.5)
        and (reboots is None or reboots < 0.5)
        and not failed
        and not pending
    )

    if running is not None:
        state = ", ".join(
            [f"{int(running)} pods running"]
            + ([f"{int(pending)} pending"] if pending else [])
            + ([f"{int(failed)} failed"] if failed else ["none failed"])
        )
        lines.append(("Quiet window. " if quiet else "") + state + ".")
        today.append(
            {"t": "", "kind": "cluster", "label": "Workload", "detail": state}
        )

    if restarts is not None:
        n = int(round(restarts))
        reboot_n = int(round(reboots)) if reboots is not None else 0
        if n:
            worst = sorted(vectors.get("restart_by_pod", {}).items(), key=lambda kv: -kv[1])
            names = ", ".join(pod for pod, _ in worst[:2])
            lines.append(
                f"\u0394 {n} container {_plural(n, 'restart', 'restarts')} in the last {WINDOW}"
                + (f" ({names})." if names else ".")
            )
            today.append(
                {"t": "", "kind": "gear", "label": "Restarts",
                 "detail": f"{n} in {WINDOW}" + (f" · {names}" if names else "")}
            )
        else:
            tail = " and no node reboots" if reboots is not None and not reboot_n else ""
            lines.append(f"No container restarts{tail} in the last {WINDOW}.")
            today.append({"t": "", "kind": "gear", "label": "Restarts", "detail": f"None in {WINDOW}"})
        if reboot_n:
            lines.append(
                f"\u0394 {reboot_n} node {_plural(reboot_n, 'reboot', 'reboots')} recorded in the last {WINDOW}."
            )
            today.append(
                {"t": "", "kind": "system", "label": "Node reboots",
                 "detail": f"{reboot_n} in {WINDOW}"}
            )

    peaks = vectors.get("gpu_peak") or {}
    now = vectors.get("gpu_now") or {}
    if peaks:
        node, peak = max(peaks.items(), key=lambda kv: kv[1])
        current = now.get(node)
        tail = f", now {current:.0f}\u00b0C" if current is not None else ""
        mark = "\u0394 " if peak >= 80 else ""
        lines.append(f"{mark}{node} peaked at {peak:.0f}\u00b0C over the last {WINDOW}{tail}.")
        today.append(
            {"t": "", "kind": "pulse", "label": "GPU thermals",
             "detail": f"{node} peak {peak:.0f}\u00b0C" + (f" · now {current:.0f}\u00b0C" if current is not None else "")}
        )

    load = scalars.get("peak_load")
    traffic = scalars.get("traffic")
    tail_bits: list[str] = []
    if load is not None:
        tail_bits.append(f"peak 1-minute load {load:.2f}")
    if traffic is not None and traffic > 0:
        tail_bits.append(f"{_bytes(traffic)} across the LAN")
    if tail_bits:
        joined = " \u00b7 ".join(tail_bits)
        # Only the leading character: .capitalize() would flatten MB and LAN.
        lines.append(joined[:1].upper() + joined[1:] + ".")
        if traffic is not None and traffic > 0:
            today.append(
                {"t": "", "kind": "pulse", "label": "LAN traffic", "detail": f"{_bytes(traffic)} in {WINDOW}"}
            )

    return {"overnight": "\n".join(lines) or None, "today": today}


async def _q(client: httpx.AsyncClient, base: str, expr: str) -> Any:
    try:
        r = await client.post(f"{base}/api/v1/query", data={"query": expr})
        return r.json() if r.status_code < 400 else None
    except Exception:  # noqa: BLE001
        return None


async def build_cluster_briefing() -> dict[str, Any]:
    """Query the window. Prometheus down -> empty, never a made-up retrospective."""
    base = settings.prometheus_base.rstrip("/")
    if not base:
        return {"overnight": None, "today": []}
    skeys, vkeys = list(SCALARS), list(VECTORS)
    try:
        async with httpx.AsyncClient(timeout=settings.prometheus_timeout) as client:
            payloads = await asyncio.gather(
                *(_q(client, base, SCALARS[k]) for k in skeys),
                *(_q(client, base, VECTORS[k]) for k in vkeys),
            )
    except Exception:  # noqa: BLE001
        log.info("overnight batch failed")
        return {"overnight": None, "today": []}

    scalars: dict[str, float] = {}
    for key, payload in zip(skeys, payloads[: len(skeys)]):
        value = _scalar(payload)
        if value is not None:
            scalars[key] = value

    vectors: dict[str, dict[str, float]] = {}
    for key, payload in zip(vkeys, payloads[len(skeys) :]):
        if key == "restart_by_pod":
            vectors[key] = _labelled(payload, "pod")
        else:
            vectors[key] = _vector(payload)
    return compose(scalars, vectors)


def _labelled(payload: Any, label: str) -> dict[str, float]:
    out: dict[str, float] = {}
    if not isinstance(payload, dict) or payload.get("status") != "success":
        return out
    for row in (payload.get("data") or {}).get("result") or []:
        name = (row.get("metric") or {}).get(label)
        value = _finite((row.get("value") or [None, None])[1])
        if name and value is not None:
            out[name] = value
    return out
