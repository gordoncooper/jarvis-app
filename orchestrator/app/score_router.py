"""Score the router against a fixture, using the real classifier (D-0033).

Diagnostic entrypoint, not part of the request path. It lives under `app/`
because the image ships only `app/`, and the number that matters — how well
`jarvis-local` classifies — can only be measured where the LiteLLM key is:

    kubectl -n apps exec -i deploy/jarvis-orchestrator -- \\
        python -m app.score_router < tests/fixtures/utterances.tsv

Reads `<label>TAB<utterance>` on stdin, ignores comments, and prints the same
three gate numbers `test_router.py` asserts — once for the deterministic pass
alone, once with the classifier folded in — so the cost and benefit of turning
it on are visible side by side.
"""

from __future__ import annotations

import asyncio
import sys
import time
from collections import Counter

from .classify import classify
from .config import settings
from .router import CHAT, UNSUPPORTED, combine, route


def _load(stream) -> list[tuple[str, str]]:
    out = []
    for raw in stream:
        line = raw.strip()
        if not line or line.startswith("#") or "\t" not in line:
            continue
        label, _, utt = line.partition("\t")
        out.append((label.strip(), utt.strip()))
    return out


def _score(rows: list[tuple[str, str, str]], title: str) -> None:
    """rows: (expected, got, utterance)"""
    stolen = [(u, g) for e, g, u in rows if e == CHAT and g != CHAT]
    refused_chat = [u for e, g, u in rows if e == CHAT and g == UNSUPPORTED]
    denied = [(u, e) for e, g, u in rows if g == UNSUPPORTED and e not in (CHAT, UNSUPPORTED)]
    passes = sum(1 for e, g, _ in rows if e != CHAT and g == e)
    total = sum(1 for e, _, _ in rows if e != CHAT)

    print(f"\n=== {title} ===")
    print(f"  chat captured by a capability : {len(stolen)}     (gate: 0)")
    print(f"  ordinary questions refused    : {len(refused_chat)}     (gate: 0)")
    print(f"  requests he CAN serve, refused: {len(denied)}     (gate: 0)")
    print(f"  capability passes             : {passes}/{total}")
    for u, g in stolen:
        print(f"    STOLEN   {u!r} -> {g}")
    for u, e in denied:
        print(f"    DENIED   {u!r} (is really {e})")


async def main() -> int:
    rows = _load(sys.stdin)
    if not rows:
        print("no fixture on stdin", file=sys.stderr)
        return 2
    print(f"{len(rows)} utterances | model={settings.classifier_model} "
          f"| floors={settings.classifier_min_confidence}/"
          f"{settings.classifier_min_confidence_write}")

    det_rows, cls_rows = [], []
    latencies: list[float] = []
    calls = 0
    disagree: list[str] = []
    for expected, utt in rows:
        det = route(utt)
        det_rows.append((expected, det.label, utt))
        out = det
        if det.label in (CHAT, UNSUPPORTED):
            t0 = time.monotonic()
            verdict = await classify(utt)
            latencies.append(time.monotonic() - t0)
            calls += 1
            out = combine(
                utt, det, verdict,
                min_confidence=settings.classifier_min_confidence,
                min_confidence_write=settings.classifier_min_confidence_write,
            )
            if out.label != det.label:
                mark = "OK " if out.label == expected else "BAD"
                disagree.append(
                    f"    {mark} {utt!r}\n         {det.label} -> {out.label} "
                    f"(want {expected})"
                )
        cls_rows.append((expected, out.label, utt))

    _score(det_rows, "deterministic only (shipped behaviour)")
    _score(cls_rows, "with the local classifier")

    if latencies:
        latencies.sort()
        print(f"\n  classify calls: {calls}/{len(rows)} turns "
              f"| median {latencies[len(latencies)//2]:.2f}s "
              f"| p90 {latencies[int(len(latencies)*0.9)]:.2f}s "
              f"| max {latencies[-1]:.2f}s")
    silent = Counter(e for e, g, _ in cls_rows if g == CHAT and e != CHAT)
    if silent:
        print("\n  still reaching the talker:")
        for k, v in silent.most_common():
            print(f"    {v:>2}  {k}")
    if disagree:
        print("\n  where the classifier changed the answer:")
        print("\n".join(disagree))
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
