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
#   local  — answered from this process alone
BACKENDS = ("hands", "memory", "local")


@dataclass(frozen=True)
class Capability:
    name: str
    klass: str  # trusted | confirm
    backend: str
    # One line, spoken aloud. Written to be read back by Piper, so no
    # parentheses, no slashes, no shell.
    summary: str
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
        klass="trusted",
        backend="hands",
        summary="read the GPU temperatures and memory in use",
        examples=("how hot are the GPUs?", "how much vram is in use?"),
        desc="GPU temperature and memory from Prometheus.",
    ),
    "lab.map": _cap(
        name="lab.map",
        klass="trusted",
        backend="hands",
        summary="give you the lab addresses and the node list",
        examples=("what are the lab urls?", "where do I find grafana?"),
        desc="Canonical lab URLs plus live node list.",
    ),
    "apps.recycle_pod": _cap(
        name="apps.recycle_pod",
        klass="confirm",
        backend="hands",
        summary="delete one named pod so its controller recreates it",
        examples=("recycle the glass pod", "kill the whisper pod"),
        args=("namespace", "name"),
        desc="Delete one named pod (recreate via controller).",
    ),
    "apps.restart_deploy": _cap(
        name="apps.restart_deploy",
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
        klass="trusted",
        backend="memory",
        summary="read back everything you have asked me to remember",
        examples=("list memories", "what do you remember about me?"),
    ),
    "memory.remember": _cap(
        name="memory.remember",
        klass="trusted",
        backend="memory",
        summary="remember a fact you tell me to keep",
        examples=("remember that I take my coffee black",),
    ),
    "memory.forget": _cap(
        name="memory.forget",
        klass="confirm",
        backend="memory",
        summary="forget a fact, after checking with you first",
        examples=("forget that I like tea", "forget everything"),
    ),
    # --- Local ---
    "meta.capabilities": _cap(
        name="meta.capabilities",
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
    """Said when an utterance clearly asks for something with no capability.

    Names the gap and what does exist, instead of handing the question to a
    talker with no data — which is how "the last update I recall was from
    yesterday" happened about a cluster it cannot see.
    """
    head = "That is not something I can do yet, sir"
    if request_hint:
        head += f" — {request_hint}"
    return (
        head
        + ". I have no verb for it, and I will not guess at live state.\n"
        + spoken_list()
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
