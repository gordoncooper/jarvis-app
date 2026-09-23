"""A very small read-only Kubernetes client (D-0037, D-0041).

Deliberately not a client library and deliberately not general: it does GETs
against a fixed set of paths using the pod's own ServiceAccount, and it has
no way to write anything. Flux status uses the two collection paths. Pod
logs use pod_log_path(), which refuses any namespace outside LOG_NS.

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
import re
from pathlib import Path
from typing import Any

import httpx

log = logging.getLogger("jarvis.orchestrator.kube")

_SA = Path("/var/run/secrets/kubernetes.io/serviceaccount")
TOKEN_PATH = _SA / "token"
CA_PATH = _SA / "ca.crt"

# Every collection path this client is allowed to touch. A caller cannot
# pass a URL. Pod logs are not in here: they are built by pod_log_path(),
# which only accepts a namespace from LOG_NS and a DNS-shaped name.
READ_PATHS: dict[str, str] = {
    "flux_kustomizations": (
        "/apis/kustomize.toolkit.fluxcd.io/v1/namespaces/flux-system/kustomizations"
    ),
    "flux_gitrepositories": (
        "/apis/source.toolkit.fluxcd.io/v1/namespaces/flux-system/gitrepositories"
    ),
}

# D-0041. The four namespaces openclaw-recycle already covered. flux-system
# and kube-system are absent on purpose.
LOG_NS = frozenset({"apps", "inference", "agents", "monitoring"})
_NAME_RE = re.compile(r"^[a-z0-9]([-a-z0-9]*[a-z0-9])?$")
LOG_TAIL_LINES = 80


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


def _check_log_target(namespace: str, name: str) -> None:
    if namespace not in LOG_NS:
        raise ValueError(f"namespace not allowed for logs: {namespace or '(empty)'}")
    if not _NAME_RE.match(name or ""):
        raise ValueError(f"bad pod name: {name or '(empty)'}")


def pod_log_path(namespace: str, pod: str, *, previous: bool = False) -> str:
    """The only way to build a log URL. tailLines is fixed."""
    _check_log_target(namespace, pod)
    prev = "&previous=true" if previous else ""
    return (
        f"/api/v1/namespaces/{namespace}/pods/{pod}/log"
        f"?tailLines={LOG_TAIL_LINES}{prev}"
    )


def pod_list_path(namespace: str) -> str:
    if namespace not in LOG_NS:
        raise ValueError(f"namespace not allowed for logs: {namespace or '(empty)'}")
    return f"/api/v1/namespaces/{namespace}/pods"


def project_pods(body: dict[str, Any]) -> list[dict[str, str]]:
    """Name, phase, start. The pod spec — where env values live — is dropped."""
    out: list[dict[str, str]] = []
    for item in body.get("items") or []:
        if not isinstance(item, dict):
            continue
        meta = item.get("metadata") if isinstance(item.get("metadata"), dict) else {}
        status = item.get("status") if isinstance(item.get("status"), dict) else {}
        name = str(meta.get("name") or "")
        if not name:
            continue
        out.append(
            {
                "name": name,
                "phase": str(status.get("phase") or ""),
                "started": str(meta.get("creationTimestamp") or ""),
                "deleting": "yes" if meta.get("deletionTimestamp") else "",
            }
        )
    return out


def choose_pod(pods: list[dict[str, str]], workload: str) -> str | None:
    """A Running pod for this deployment, or the exact pod name."""
    own = [
        p
        for p in pods
        if not p.get("deleting")
        and (p["name"] == workload or p["name"].startswith(workload + "-"))
    ]
    if not own:
        return None
    running = [p for p in own if p.get("phase") == "Running"]
    pool = running or own
    pool.sort(key=lambda p: p.get("started") or "")
    return pool[-1]["name"]


async def _get(path: str) -> tuple[int, Any] | None:
    """GET one path we already built. None if we are not in a cluster.

    Callers must not log the body: a log tail and a pod list can both
    carry credentials. Status codes are safe to log; bodies are not.
    """
    base = _api_base()
    if not base:
        return None
    try:
        token = TOKEN_PATH.read_text().strip()
    except OSError:
        return None
    verify: Any = str(CA_PATH) if CA_PATH.is_file() else False
    try:
        async with httpx.AsyncClient(timeout=6.0, verify=verify) as client:
            r = await client.get(
                base + path, headers={"Authorization": f"Bearer {token}"}
            )
    except Exception as e:  # noqa: BLE001
        log.warning("k8s get failed: %s", type(e).__name__)
        return None
    if r.status_code == 200 and "application/json" in r.headers.get("content-type", ""):
        try:
            return r.status_code, r.json()
        except Exception:  # noqa: BLE001
            return r.status_code, None
    return r.status_code, r.text


async def find_pod(namespace: str, workload: str) -> str | None:
    """Resolve a deployment short name to one pod. None if the API refuses."""
    _check_log_target(namespace, workload)
    got = await _get(pod_list_path(namespace))
    if got is None or got[0] != 200 or not isinstance(got[1], dict):
        return None
    return choose_pod(project_pods(got[1]), workload)


async def read_pod_log(namespace: str, pod: str) -> tuple[str, str] | None:
    """(text, source) where source is 'current' or 'previous'.

    None means the API could not be read. An empty string means the pod
    had nothing to say. A 400 (more than one container) comes back as
    ('', 'ambiguous') so the caller can refuse to guess.
    """
    current = await _get(pod_log_path(namespace, pod))
    if current is None:
        return None
    status, body = current
    if status == 400:
        return "", "ambiguous"
    if status == 200 and isinstance(body, str) and body.strip():
        return body, "current"
    if status not in (200, 204):
        log.warning("pod log HTTP %s", status)
        return None
    previous = await _get(pod_log_path(namespace, pod, previous=True))
    if previous is None or previous[0] != 200 or not isinstance(previous[1], str):
        return "", "current"
    return previous[1], "previous"
