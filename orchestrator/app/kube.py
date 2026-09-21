"""A very small read-only Kubernetes client (D-0037).

Only what `flux.status` needs. Deliberately not a client library and
deliberately not general: it does GETs against a fixed set of paths using the
pod's own ServiceAccount, and it has no way to write anything.

**Why the orchestrator and not Hands.** Cluster reads normally go through the
OpenClaw shim (D-0022). Flux state is the exception, for the same reason
D-0036 kept its capabilities local: "is the house in sync?" is asked when
something is wrong, and OpenClaw is the component most likely to be wrong —
its pod holds a `hostPort` that races on restart and it has its own entry list
in LESSONS. A status read that needs the flakiest component to be healthy is
not a status read.

The grant is one ClusterRole in `cluster/clusters/jarvis/apps/`: get and list
on Flux `kustomizations` and `gitrepositories`. Nothing else, no write verbs,
no other API group. The orchestrator ServiceAccount had no RBAC at all before
this, which is what makes the grant easy to audit — it is the whole list.
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

import httpx

log = logging.getLogger("jarvis.orchestrator.kube")

_SA = Path("/var/run/secrets/kubernetes.io/serviceaccount")
TOKEN_PATH = _SA / "token"
CA_PATH = _SA / "ca.crt"

# Every path this client is allowed to touch. A caller cannot pass a URL.
READ_PATHS: dict[str, str] = {
    "flux_kustomizations": (
        "/apis/kustomize.toolkit.fluxcd.io/v1/namespaces/flux-system/kustomizations"
    ),
    "flux_gitrepositories": (
        "/apis/source.toolkit.fluxcd.io/v1/namespaces/flux-system/gitrepositories"
    ),
}


def _api_base() -> str | None:
    import os

    host = os.environ.get("KUBERNETES_SERVICE_HOST")
    port = os.environ.get("KUBERNETES_SERVICE_PORT_HTTPS") or os.environ.get(
        "KUBERNETES_SERVICE_PORT"
    )
    if not host:
        return None
    return f"https://{host}:{port or 443}"


def in_cluster() -> bool:
    return bool(_api_base()) and TOKEN_PATH.is_file()


async def read(name: str) -> list[dict[str, Any]] | None:
    """Fetch one allowlisted collection. None on any failure — a capability
    that cannot measure says so rather than reporting an empty cluster."""
    path = READ_PATHS.get(name)
    if path is None:
        raise ValueError(f"not an allowlisted read: {name}")
    base = _api_base()
    if not base:
        log.info("not running in-cluster; %s unavailable", name)
        return None
    try:
        token = TOKEN_PATH.read_text().strip()
    except OSError:
        log.info("no serviceaccount token; %s unavailable", name)
        return None
    verify: Any = str(CA_PATH) if CA_PATH.is_file() else False
    try:
        async with httpx.AsyncClient(timeout=6.0, verify=verify) as client:
            r = await client.get(
                base + path, headers={"Authorization": f"Bearer {token}"}
            )
            if r.status_code == 403:
                log.warning("RBAC refuses %s — the ClusterRole is missing", name)
                return None
            if r.status_code >= 400:
                log.warning("k8s %s -> HTTP %s", name, r.status_code)
                return None
            body = r.json()
    except Exception as e:  # noqa: BLE001
        log.warning("k8s read %s failed: %s", name, type(e).__name__)
        return None
    items = body.get("items")
    return items if isinstance(items, list) else None


def ready_condition(obj: dict[str, Any]) -> tuple[str | None, str, str]:
    """(status, reason, message) of the Ready condition, or (None, ...)."""
    for cond in (obj.get("status") or {}).get("conditions") or []:
        if cond.get("type") == "Ready":
            return (
                str(cond.get("status")),
                str(cond.get("reason") or ""),
                str(cond.get("message") or ""),
            )
    return None, "", ""
