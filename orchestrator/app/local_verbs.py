"""Capabilities the orchestrator answers itself (D-0036).

Everything here reads a source the orchestrator already had — Prometheus for
cluster facts, open-meteo for weather, its own clock and the glass build
manifest. No OpenClaw round trip, no RBAC change, and nothing new to recycle.

That matters beyond convenience: these keep working when Hands is down, which
is the half of the rack most likely to be sick when Gordon asks.

Every function returns `(spoken_text, data)`. When a source has nothing to
say the text says so — never a plausible-looking zero (D-0012 in spirit;
glass reports, it does not invent).
"""

from __future__ import annotations

import logging
import time
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

import httpx

from . import __version__
from . import kube
from .config import settings
from .prom import query_series
from .weather import get_weather

log = logging.getLogger("jarvis.orchestrator.local_verbs")


def _fmt_bytes(n: float) -> str:
    for unit, div in (("TiB", 1024**4), ("GiB", 1024**3), ("MiB", 1024**2)):
        if n >= div:
            return f"{n / div:.1f} {unit}"
    return f"{int(n)} B"


# --- pods.list -------------------------------------------------------------

async def pods_list() -> tuple[str, dict[str, Any]]:
    """Where the pods are, and which ones are unhappy.

    Deliberately not 41 pod names: that is unreadable on the wall and
    unlistenable over Piper. Counts per namespace, then the names of anything
    actually worth knowing about — not Running, or restarting.
    """
    phases = await query_series('kube_pod_status_phase == 1')
    if not phases:
        return (
            "I cannot see the pod list just now, sir — kube-state-metrics is "
            "not answering.",
            {},
        )

    by_ns: dict[str, int] = {}
    unhappy: list[dict[str, str]] = []
    total = 0
    for series in phases:
        m = series.get("metric", {})
        ns, pod, phase = m.get("namespace", "?"), m.get("pod", "?"), m.get("phase", "?")
        total += 1
        by_ns[ns] = by_ns.get(ns, 0) + 1
        if phase not in ("Running", "Succeeded"):
            unhappy.append({"namespace": ns, "pod": pod, "phase": phase})

    restarts = await query_series(
        "topk(5, sum by (namespace, pod) "
        "(kube_pod_container_status_restarts_total) > 0)"
    )
    restarting = [
        {
            "namespace": s.get("metric", {}).get("namespace", "?"),
            "pod": s.get("metric", {}).get("pod", "?"),
            "restarts": int(float(s.get("value", [0, "0"])[1])),
        }
        for s in restarts
    ]

    spread = ", ".join(f"{n} in {ns}" for ns, n in sorted(by_ns.items(), key=lambda x: -x[1]))
    text = f"{total} pods across {len(by_ns)} namespaces: {spread}."
    if unhappy:
        bad = "; ".join(f"{u['namespace']}/{u['pod']} is {u['phase']}" for u in unhappy[:5])
        text += f" Not Running: {bad}."
    else:
        text += " All Running or Succeeded."
    if restarting:
        top = restarting[0]
        text += (
            f" Most restarts: {top['namespace']}/{top['pod']} at {top['restarts']}."
        )
    return text, {
        "total": total,
        "by_namespace": by_ns,
        "not_running": unhappy,
        "restarting": restarting,
    }


# --- storage.free ----------------------------------------------------------

async def storage_free() -> tuple[str, dict[str, Any]]:
    """Root-filesystem headroom per node. The question behind 'am I about to
    run out', which BACKLOG section C treats as a durability concern."""
    avail = await query_series(
        'node_filesystem_avail_bytes{mountpoint="/",fstype!~"tmpfs|overlay"}'
    )
    size = await query_series(
        'node_filesystem_size_bytes{mountpoint="/",fstype!~"tmpfs|overlay"}'
    )
    if not avail:
        return "I have no disk figures just now, sir — Prometheus is not answering.", {}

    def by_node(series: list[dict[str, Any]]) -> dict[str, float]:
        out: dict[str, float] = {}
        for s in series:
            node = s.get("metric", {}).get("instance", "?")
            try:
                out[node] = float(s.get("value", [0, "0"])[1])
            except (TypeError, ValueError):
                continue
        return out

    free, total = by_node(avail), by_node(size)
    nodes = []
    for node in sorted(free):
        f = free[node]
        t = total.get(node)
        pct = (100.0 * f / t) if t else None
        nodes.append({"node": node, "free_bytes": f, "total_bytes": t, "free_pct": pct})

    tight = [n for n in nodes if n["free_pct"] is not None and n["free_pct"] < 15]
    parts = [
        f"{n['node']} {_fmt_bytes(n['free_bytes'])} free"
        + (f" of {_fmt_bytes(n['total_bytes'])}" if n["total_bytes"] else "")
        for n in nodes
    ]
    text = "Root filesystem headroom: " + "; ".join(parts) + "."
    if tight:
        text += " Tight on " + ", ".join(n["node"] for n in tight) + "."
    return text, {"nodes": nodes}


# --- weather.now -----------------------------------------------------------

async def weather_now() -> tuple[str, dict[str, Any]]:
    """The same reading the cockpit header shows, spoken."""
    wx = await get_weather()
    if not wx:
        return (
            "I have no weather reading, sir — no location is configured, or "
            "the service is unreachable.",
            {},
        )
    place = wx.get("place") or settings.weather_place or "here"
    temp = wx.get("temp_c")
    desc = wx.get("text") or wx.get("summary") or ""
    bits = []
    if temp is not None:
        bits.append(f"{round(float(temp))} degrees")
    if desc:
        bits.append(str(desc))
    if not bits:
        return "The weather service answered, but with nothing I can read out.", wx
    return f"{place}: " + ", ".join(bits) + ".", wx


# --- time.now --------------------------------------------------------------

async def time_now() -> tuple[str, dict[str, Any]]:
    """The talker has no clock, so without this it guesses, confidently."""
    try:
        tz = ZoneInfo(settings.weather_tz)
    except Exception:  # noqa: BLE001
        tz = None
    now = datetime.now(tz) if tz else datetime.now()
    return (
        now.strftime("It is %-I:%M %p on %A, %-d %B."),
        {"iso": now.isoformat(timespec="seconds"), "tz": settings.weather_tz},
    )


# --- deploy.version --------------------------------------------------------

async def deploy_version() -> tuple[str, dict[str, Any]]:
    """What is actually running, from the artifacts themselves.

    Both halves describe themselves on purpose (see the repo README), so this
    reads them rather than repeating a pin from a file that can go stale.
    """
    data: dict[str, Any] = {"orchestrator": __version__}
    glass: dict[str, Any] | None = None
    try:
        async with httpx.AsyncClient(timeout=4.0) as client:
            r = await client.get(settings.glass_build_url)
            if r.status_code < 400:
                glass = r.json()
    except Exception as e:  # noqa: BLE001
        log.info("glass build.json unreachable: %s", type(e).__name__)
    if glass:
        data["glass"] = glass
        return (
            f"Orchestrator {__version__}, glass {glass.get('tag')} "
            f"running the {glass.get('theme')} theme.",
            data,
        )
    return (
        f"Orchestrator {__version__}. I cannot reach the glass build manifest, "
        "so I will not guess at its version.",
        data,
    )


# --- flux.status -----------------------------------------------------------

async def flux_status() -> tuple[str, dict[str, Any]]:
    """Is what git says actually what the cluster is running?"""
    ks = await kube.read("flux_kustomizations")
    if ks is None:
        return (
            "I cannot read Flux state just now, sir \u2014 the API did not "
            "answer, or my read permission is missing.",
            {},
        )
    if not ks:
        return "Flux has no Kustomizations in flux-system.", {"kustomizations": []}

    entries, unready = [], []
    for obj in ks:
        name = (obj.get("metadata") or {}).get("name", "?")
        status, reason, message = kube.ready_condition(obj)
        rev = str((obj.get("status") or {}).get("lastAppliedRevision") or "")
        entry = {
            "name": name,
            "ready": status == "True",
            "reason": reason,
            "message": message[:300],
            "revision": rev,
        }
        entries.append(entry)
        if status != "True":
            unready.append(entry)

    srcs = await kube.read("flux_gitrepositories") or []
    sources = []
    for obj in srcs:
        name = (obj.get("metadata") or {}).get("name", "?")
        status, reason, message = kube.ready_condition(obj)
        sources.append({"name": name, "ready": status == "True", "reason": reason})
    bad_sources = [s for s in sources if not s["ready"]]

    if unready or bad_sources:
        bits = [f"{e['name']} is not ready ({e['reason']})" for e in unready]
        bits += [f"source {s['name']} is not ready ({s['reason']})" for s in bad_sources]
        text = "Flux is out of sync: " + "; ".join(bits) + "."
        if unready and unready[0]["message"]:
            text += f" {unready[0]['message']}"
    else:
        rev = entries[0]["revision"]
        short = rev.split(":")[-1][:8] if ":" in rev else rev[:8]
        n = len(entries)
        text = (
            f"Flux is in sync. {n} kustomization{'s' if n != 1 else ''} "
            f"reconciled"
            + (f" at revision {short}." if short else ".")
        )
    return text, {"kustomizations": entries, "sources": sources}


# --- backup.latest ---------------------------------------------------------

# Written by jarvis-infra scripts/backup-jarvis.sh onto the same NFS share the
# orchestrator already mounts. The backup directory itself is 0750 root, and
# it stays that way: the producer publishes a status document instead, so
# nothing has to be loosened to answer "when did the last backup run?".
BACKUP_STATUS_PATH = "/var/lib/jarvis/backup-status.json"


async def backup_latest() -> tuple[str, dict[str, Any]]:
    import json
    import os

    try:
        with open(BACKUP_STATUS_PATH, encoding="utf-8") as fh:
            body = json.load(fh)
    except FileNotFoundError:
        return (
            "I have no record of a backup, sir. The backup job publishes a "
            "status file and I do not see one \u2014 which is not the same as "
            "knowing there has been no backup.",
            {},
        )
    except (OSError, json.JSONDecodeError) as e:
        return f"The backup status file is unreadable ({type(e).__name__}).", {}

    stamp = str(body.get("stamp") or "?")
    finished = body.get("finished_at")
    total = body.get("total_bytes")
    files = body.get("files") or []
    ok = body.get("ok", True)

    age = ""
    if isinstance(finished, (int, float)):
        hours = (time.time() - float(finished)) / 3600.0
        age = (
            f" about {int(hours)} hours ago"
            if hours >= 1.5
            else " within the last hour"
        )
        if hours > 48:
            age = f" {int(hours / 24)} days ago"

    text = f"Last backup {stamp}{age}"
    if isinstance(total, (int, float)):
        text += f", {_fmt_bytes(float(total))} across {len(files)} archives"
    text += "." if ok else " \u2014 and it reported a failure."
    if isinstance(finished, (int, float)) and (time.time() - float(finished)) > 48 * 3600:
        text += " That is older than two days, sir."
    return text, body


HANDLERS = {
    "flux.status": flux_status,
    "backup.latest": backup_latest,
    "pods.list": pods_list,
    "storage.free": storage_free,
    "weather.now": weather_now,
    "time.now": time_now,
    "deploy.version": deploy_version,
}
