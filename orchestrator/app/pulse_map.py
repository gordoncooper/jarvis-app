"""Pure /v1/pulse mapping. No I/O — unknown metrics stay null.

Node identity and Ready state come from Hands (cluster.health). Counters come
from Prometheus via app.prom. Anything neither source reports stays None so the
NOC renders a steel placeholder instead of a number nobody measured.
"""

from __future__ import annotations

import ipaddress
import math
from typing import Any

from .prom import PromSnapshot

_ROLE_PREFIX = {
    "ctrl": "control-plane",
    "gpu": "gpu-node",
    "data": "storage",
    "apps": "workload",
}

# Per-node pulse field -> prom.NODE_QUERIES key.
_NODE_METRICS = {
    "cpu": "cpu",
    "ram": "ram",
    "disk": "disk",
    "load": "load",
    "cpu_c": "cpu_c",
    "net_bps": "net_bps",
    "gpu_util": "gpu_util",
    "vram": "vram",
    "fan": "fan",
    "uptime_s": "uptime_s",
}

_PERCENT_FIELDS = {"cpu", "ram", "disk", "gpu_util", "vram", "fan"}


def _finite(value: Any) -> float | None:
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, (int, float)):
        n = float(value)
        return n if math.isfinite(n) else None
    if isinstance(value, str):
        try:
            n = float(value.strip())
        except ValueError:
            return None
        return n if math.isfinite(n) else None
    return None


def _pct(value: float | None) -> float | None:
    if value is None:
        return None
    return round(min(100.0, max(0.0, value)), 1)


def _text(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    t = value.strip()
    return t or None


def _role_for(name: str) -> str | None:
    prefix = name.split("-", 1)[0].lower()
    return _ROLE_PREFIX.get(prefix)


def _norm(value: str | None) -> str:
    return (value or "").strip().lower()


def format_uptime(seconds: float | None) -> str | None:
    """15d 06h 42m 18s — the shape the Earth UPTIME chip expects."""
    if seconds is None or seconds < 0:
        return None
    total = int(seconds)
    days, rem = divmod(total, 86400)
    hours, rem = divmod(rem, 3600)
    minutes, secs = divmod(rem, 60)
    return f"{days}d {hours:02d}h {minutes:02d}m {secs:02d}s"


def derive_lan(ips: list[str]) -> str | None:
    """Collapse the real node addresses to their common /24. Never guessed."""
    nets: set[str] = set()
    for raw in ips:
        try:
            addr = ipaddress.ip_address(raw)
        except ValueError:
            continue
        if addr.version != 4:
            continue
        nets.add(str(ipaddress.ip_network(f"{addr}/24", strict=False)))
    return nets.pop() if len(nets) == 1 else None


def assemble_pulse(
    *,
    health_verb: dict[str, Any] | None,
    gpus_verb: dict[str, Any] | None,
    llm_ok: bool,
    stt_ok: bool,
    tts_ok: bool,
    hands_ok: bool,
    utc: str,
    prom: PromSnapshot | None = None,
    events: list[dict[str, str]] | None = None,
    weather: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Map Hands + Prometheus payloads. Never invent a counter."""
    snap = prom or PromSnapshot()
    health_data = (health_verb or {}).get("data") if isinstance(health_verb, dict) else None
    if not isinstance(health_data, dict):
        health_data = {}
    gpu_data = (gpus_verb or {}).get("data") if isinstance(gpus_verb, dict) else None
    if not isinstance(gpu_data, dict):
        gpu_data = {}

    temps: dict[str, float] = {}
    for row in gpu_data.get("gpus") or []:
        if not isinstance(row, dict):
            continue
        temp = _finite(row.get("temp_c"))
        if temp is None:
            continue
        node = _text(row.get("node"))
        if node:
            temps[_norm(node)] = temp
    # Prometheus is the fallback when the Hands GPU verb is unavailable.
    for node, temp in snap.nodes.get("gpu_c", {}).items():
        temps.setdefault(_norm(node), temp)

    def enrich(name: str, row: dict[str, Any]) -> dict[str, Any]:
        for field, metric in _NODE_METRICS.items():
            if row.get(field) is not None:
                continue
            value = snap.node_value(metric, name)
            row[field] = _pct(value) if field in _PERCENT_FIELDS else (
                round(value, 2) if value is not None else None
            )
        row["uptime"] = format_uptime(row.pop("uptime_s", None))
        return row

    nodes_out: list[dict[str, Any]] = []
    ready_n = 0
    for row in health_data.get("nodes") or []:
        if not isinstance(row, dict):
            continue
        name = _text(row.get("name")) or _text(row.get("id"))
        if not name:
            continue
        ready = row.get("ready")
        if ready is True:
            ready_n += 1
        ip = _text(row.get("ip"))
        nodes_out.append(
            enrich(
                name,
                {
                    "id": name,
                    "role": _text(row.get("role")) or _role_for(name),
                    "ip": ip,
                    "cpu": _finite(row.get("cpu")),
                    "ram": _finite(row.get("ram")),
                    "disk": _finite(row.get("disk")),
                    "load": _finite(row.get("load")),
                    "temp_c": temps.get(_norm(name), temps.get(_norm(ip)) if ip else None),
                    "ready": True if ready is True else False if ready is False else None,
                },
            )
        )

    listed = {_norm(n["id"]) for n in nodes_out}
    # Nodes Prometheus can see but Hands did not list (verb down, new node).
    extra = {_norm(k) for k in snap.nodes.get("cpu", {})} | set(temps)
    for key in sorted(extra - listed):
        if not key:
            continue
        nodes_out.append(
            enrich(
                key,
                {
                    "id": key,
                    "role": _role_for(key),
                    "ip": None,
                    "cpu": None,
                    "ram": None,
                    "disk": None,
                    "load": None,
                    "temp_c": temps.get(key),
                    "ready": None,
                },
            )
        )

    ready_count = health_data.get("ready_count")
    node_count = health_data.get("node_count")
    if not isinstance(ready_count, int):
        ready_count = ready_n
    if not isinstance(node_count, int):
        node_count = len(nodes_out) if nodes_out else None
    k3s = None
    if isinstance(node_count, int) and node_count >= 0:
        k3s = f"{int(ready_count)}/{node_count}"

    if events is None:
        events = []
        for n in nodes_out:
            if n.get("ready") is True:
                msg = "Ready"
            elif n.get("ready") is False:
                msg = "NotReady"
            else:
                continue
            events.append({"ts": utc, "src": str(n["id"]), "msg": msg, "level": "info"})

    return {
        "lan": derive_lan([str(n["ip"]) for n in nodes_out if n.get("ip")]),
        "k3s": k3s,
        "utc": utc,
        "uptime": format_uptime(snap.scalar("uptime_s")),
        "nodes": nodes_out,
        "rings": {
            "cpu": _pct(snap.scalar("ring_cpu")),
            "mem": _pct(snap.scalar("ring_mem")),
            "net": _pct(snap.scalar("ring_net")),
            "io": _pct(snap.scalar("ring_io")),
        },
        # Rack thermals, not room climate: this lab has no air or humidity sensor,
        # so the NOC panel reports quantities the hardware actually measures.
        "env": {
            "cpu_c": round(v, 1) if (v := snap.scalar("env_cpu_c")) is not None else None,
            "fan": _pct(snap.scalar("env_fan")),
            "vram": _pct(snap.scalar("env_vram")),
        },
        "events": events,
        "weather": weather,
        "talker": bool(llm_ok),
        "hands": bool(hands_ok),
        "stt": bool(stt_ok),
        "tts": bool(tts_ok),
    }
