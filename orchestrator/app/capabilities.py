"""What JARVIS can actually do, declared once (D-0033).

One manifest, four readers: the refusal when nothing matches, the
`meta.capabilities` answer, the talker's "do not pretend you queried this"
note, and `hands.CATALOG` for execution. Before this file existed, each of
those knew a different, partial version of the truth, so JARVIS could not
answer "what can you do?" and cheerfully claimed abilities he did not have.

Adding a capability is a row here plus a decision entry. A model never invents
one: the router validates every label against `MANIFEST`, and the OpenClaw
shim re-validates server-side with its own RBAC.
"""

from __future__ import annotations

from dataclasses import dataclass, field

# backend: where the work happens.
#   hands  — OpenClaw shim POST /v1/verbs, under the openclaw-recycle Role
#   memory — promoted sqlite on NFS, orchestrator-owned
#   prom   — Prometheus, read by the orchestrator directly (D-0012 allows
#            this; glass never does). Keeps working when Hands is down.
#   kube   — the Kubernetes API, read-only, via the orchestrator's own
#            ServiceAccount and a ClusterRole scoped to exactly these reads
#   local  — answered from this process alone
BACKENDS = ("hands", "memory", "prom", "kube", "local")


@dataclass(frozen=True)
class Capability:
    name: str
    klass: str  # trusted | confirm
    backend: str
    # One line, spoken aloud. Written to be read back by Piper, so no
    # parentheses, no slashes, no shell.
    summary: str
    # Two or three words, for listing several in one breath. A refusal that
    # recites nine full bullets is unusable over voice.
    short: str = ""
    # How Gordon actually says it. These seed the classifier prompt in slice 3
    # and double as documentation of intended phrasing.
    examples: tuple[str, ...] = ()
    args: tuple[str, ...] = ()
    desc: str = ""  # operator-facing detail; not spoken


def _cap(**kw: object) -> Capability:
    return Capability(**kw)  # type: ignore[arg-type]


MANIFEST: dict[str, Capability] = {
    # --- Hands: the rack (D-0022 trusted / D-0023 confirm) ---
    "cluster.health": _cap(
        name="cluster.health",
        short="cluster health",
        klass="trusted",
        backend="hands",
        summary="tell you whether the cluster is healthy, and which pods are not running",
        examples=(
            "how is the cluster doing?",
            "are there any issues today?",
            "is the lab healthy?",
        ),
        desc="Node Ready / non-Running pods snapshot.",
    ),
    "cluster.gpus": _cap(
        name="cluster.gpus",
        short="GPU temperature and memory",
        klass="trusted",
        backend="hands",
        summary="read the GPU temperatures and memory in use",
        examples=("how hot are the GPUs?", "how much vram is in use?"),
        desc="GPU temperature and memory from Prometheus.",
    ),
    "lab.map": _cap(
        name="lab.map",
        short="the lab map",
        klass="trusted",
        backend="hands",
        summary="give you the lab addresses and the node list",
        examples=("what are the lab urls?", "where do I find grafana?"),
        desc="Canonical lab URLs plus live node list.",
    ),
    "apps.recycle_pod": _cap(
        name="apps.recycle_pod",
        short="recycling a pod",
        klass="confirm",
        backend="hands",
        summary="delete one named pod so its controller recreates it",
        examples=("recycle the glass pod", "kill the whisper pod"),
        args=("namespace", "name"),
        desc="Delete one named pod (recreate via controller).",
    ),
    "apps.restart_deploy": _cap(
        name="apps.restart_deploy",
        short="restarting a deployment",
        klass="confirm",
        backend="hands",
        summary="restart a deployment",
        examples=("bounce the orchestrator", "restart deploy jarvis-glass"),
        args=("namespace", "name"),
        desc="Patch Deployment restartedAt to bounce pods.",
    ),
    # --- Memory: promoted sqlite (D-0013 / D-0024 / D-0027 / D-0028) ---
    "memory.list": _cap(
        name="memory.list",
        short="listing what I remember",
        klass="trusted",
        backend="memory",
        summary="read back everything you have asked me to remember",
        examples=("list memories", "what do you remember about me?"),
    ),
    "memory.remember": _cap(
        name="memory.remember",
        short="remembering a fact",
        klass="trusted",
        backend="memory",
        summary="remember a fact you tell me to keep",
        examples=("remember that I take my coffee black",),
    ),
    "memory.forget": _cap(
        name="memory.forget",
        short="forgetting one",
        klass="confirm",
        backend="memory",
        summary="forget a fact, after checking with you first",
        examples=("forget that I like tea", "forget everything"),
    ),
    # --- Prometheus, read by the orchestrator (D-0036) ---
    "pods.list": _cap(
        name="pods.list",
        klass="trusted",
        backend="prom",
        short="listing the pods",
        summary="tell you where the pods are and which ones are unhappy",
        examples=(
            "list all the running pods",
            "how many pods are there?",
            "is anything crash looping?",
        ),
        desc="kube-state-metrics phase counts per namespace, plus restarts.",
    ),
    "storage.free": _cap(
        name="storage.free",
        klass="trusted",
        backend="prom",
        short="checking free disk",
        summary="tell you how much disk each node has left",
        examples=(
            "how much disk is left on data-01?",
            "are we running out of space?",
        ),
        desc="node-exporter root filesystem avail/size per node.",
    ),
    "flux.status": _cap(
        name="flux.status",
        klass="trusted",
        backend="kube",
        short="whether Flux is in sync",
        summary="tell you whether Flux has reconciled what git says",
        examples=(
            "is flux in sync?",
            "did the last deploy land?",
            "is the cluster running what is in git?",
        ),
        desc="Kustomization + GitRepository Ready conditions in flux-system.",
    ),
    # --- Local ---
    "backup.latest": _cap(
        name="backup.latest",
        klass="trusted",
        backend="local",
        short="when the last backup ran",
        summary="tell you when the last backup ran and how big it was",
        examples=("when did the last backup run?", "is there a recent backup?"),
        desc="Status document published onto NFS by backup-jarvis.sh.",
    ),
    "weather.now": _cap(
        name="weather.now",
        klass="trusted",
        backend="local",
        short="the local weather",
        summary="tell you the weather where the house is",
        examples=("what's the weather?", "is it cold out?"),
        desc="open-meteo, the same reading the cockpit header shows.",
    ),
    "time.now": _cap(
        name="time.now",
        klass="trusted",
        backend="local",
        short="the time and date",
        summary="tell you the time and date",
        examples=("what time is it?", "what's today's date?"),
        desc="Orchestrator clock in WEATHER_TZ. The talker has none.",
    ),
    "deploy.version": _cap(
        name="deploy.version",
        klass="trusted",
        backend="local",
        short="which build is deployed",
        summary="tell you which build of me is deployed",
        examples=("what version of glass is deployed?", "did the last deploy land?"),
        desc="Orchestrator __version__ plus the glass build.json.",
    ),
    "meta.capabilities": _cap(
        name="meta.capabilities",
        short="listing what I can do",
        klass="trusted",
        backend="local",
        summary="tell you what I can do",
        examples=("what can you do?", "what are your capabilities?"),
    ),
}


def hands_catalog() -> dict[str, dict[str, str]]:
    """Back-compat shape for `hands.CATALOG` — Hands verbs only.

    Memory and local capabilities must never reach the shim, so they are not
    in here. `hands.execute_verb` refuses anything absent.
    """
    return {
        c.name: {"class": c.klass, "desc": c.desc or c.summary}
        for c in MANIFEST.values()
        if c.backend == "hands"
    }


def spoken_list() -> str:
    """What `meta.capabilities` says out loud."""
    lines = [f"- I can {c.summary}." for c in MANIFEST.values()]
    return (
        "Here is what I can do, sir:\n"
        + "\n".join(lines)
        + "\nAnything else I will say I cannot do rather than guess at it."
    )


def refusal(request_hint: str = "") -> str:
    """Said when an utterance names something no capability covers.

    Names the gap and what does exist, instead of handing the question to a
    talker with no data — which is how "the last update I recall was from
    yesterday" happened about a cluster it cannot see.

    One breath, not a recital: the first version read all nine bullets aloud.
    `meta.capabilities` is where the full list belongs.
    """
    head = "I have no verb for that, sir"
    if request_hint:
        head += f" — {request_hint}"
    have = ", ".join(c.short or c.summary for c in MANIFEST.values() if c.backend != "local")
    return (
        head
        + ", and I will not guess at live state. What I do have: "
        + have
        + ". Ask what I can do for the detail."
    )


def talker_note() -> str:
    """Injected into the talker system prompt, derived so it cannot drift.

    Names rather than prose: the note replaced a hand-written sentence listing
    three verbs, which had already fallen behind the catalog.
    """
    names = ", ".join(
        c.name for c in MANIFEST.values() if c.backend in ("hands", "memory")
    )
    return (
        "These are handled as declared capabilities before you run: "
        + names
        + ". If a question needed one, it has already been answered or "
        "refused — never claim you queried anything yourself."
    )
