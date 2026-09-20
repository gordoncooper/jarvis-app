"""Pure /v1/pulse mapping. No I/O — unknown metrics stay null."""

from __future__ import annotations

import math
from typing import Any

_ROLE_PREFIX = {
    "ctrl": "control-plane",
    "gpu": "gpu-node",
    "data": "storage",
    "apps": "workload",
}


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


def assemble_pulse(
    *,
    health_verb: dict[str, Any] | None,
    gpus_verb: dict[str, Any] | None,
    llm_ok: bool,
    stt_ok: bool,
    tts_ok: bool,
    hands_ok: bool,
    utc: str,
) -> dict[str, Any]:
    """Map Hands/health payloads. Never invent GPU temps or node counters."""
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
            }
        )

    listed = {_norm(n["id"]) for n in nodes_out}
    for key, temp in temps.items():
        if key in listed or not key:
            continue
        nodes_out.append(
            {
                "id": key,
                "role": _role_for(key),
                "ip": None,
                "cpu": None,
                "ram": None,
                "disk": None,
                "load": None,
                "temp_c": temp,
                "ready": None,
            }
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

    events: list[dict[str, str]] = []
    for n in nodes_out:
        if n.get("ready") is True:
            msg = "Ready"
        elif n.get("ready") is False:
            msg = "NotReady"
        else:
            continue
        events.append({"ts": utc, "src": str(n["id"]), "msg": msg})

    return {
        "lan": None,
        "k3s": k3s,
        "utc": utc,
        "uptime": None,
        "nodes": nodes_out,
        "rings": {"cpu": None, "mem": None, "net": None, "io": None},
        "env": {"air_c": None, "hum": None, "pwr": None},
        "events": events,
        "talker": bool(llm_ok),
        "hands": bool(hands_ok),
        "stt": bool(stt_ok),
        "tts": bool(tts_ok),
    }
