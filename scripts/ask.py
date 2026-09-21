#!/usr/bin/env python3
"""Talk to a live orchestrator and see how each turn was routed.

The most useful thing to have while working on the router: it prints the verb
that fired and the round-trip time beside the reply, so "did that match a
capability or reach the talker?" is answerable without reading pod logs. Every
routing bug fixed under D-0033 was found by running real sentences through
this against jarvis.lan — not by reading the fixture, which agreed with the
code right up until the live host disagreed with both.

    ./scripts/ask.py "are there any issues with the cluster today?"
    ./scripts/ask.py "I like black coffee" "remember that"   # same session
    ./scripts/ask.py -f orchestrator/tests/fixtures/utterances.tsv
    ORCH=http://127.0.0.1:18080 ./scripts/ask.py "list memories"

Turns in one invocation share a session id and run in order, so confirm and
referent flows work: propose, then answer. `-n` gives each its own session.

It never answers "yes" for you. Confirm-class verbs stay Gordon's to approve.
"""

from __future__ import annotations

import argparse
import json
import os
import ssl
import sys
import time
import urllib.error
import urllib.request


def read_utterances(path: str) -> list[str]:
    """One per line. Accepts the router fixture's <label>TAB<utterance> too."""
    out: list[str] = []
    with open(path, encoding="utf-8") as fh:
        for raw in fh:
            line = raw.strip()
            if not line or line.startswith("#"):
                continue
            out.append(line.split("\t", 1)[1].strip() if "\t" in line else line)
    return out


def ask(orch: str, text: str, session: str, timeout: float) -> tuple[float, dict]:
    body = json.dumps({"text": text, "session_id": session}).encode()
    req = urllib.request.Request(
        orch.rstrip("/") + "/v1/turns",
        data=body,
        headers={"Content-Type": "application/json"},
    )
    # The lab uses a private CA; this is a diagnostic on the LAN, not a client.
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    start = time.monotonic()
    try:
        with urllib.request.urlopen(req, timeout=timeout, context=ctx) as resp:
            payload = json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        payload = {"reply_text": f"HTTP {e.code}: {e.read().decode()[:200]}"}
    except Exception as e:  # noqa: BLE001
        payload = {"reply_text": f"{type(e).__name__}: {e}"}
    return time.monotonic() - start, payload


def main() -> int:
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    ap.add_argument("text", nargs="*", help="utterances, in order")
    ap.add_argument("-f", "--file", help="read utterances from a file")
    ap.add_argument("-n", "--new", action="store_true", help="fresh session each")
    ap.add_argument("-F", "--full", action="store_true", help="do not truncate")
    ap.add_argument("--timeout", type=float, default=120.0)
    args = ap.parse_args()

    texts = list(args.text)
    if args.file:
        texts = read_utterances(args.file) + texts
    if not texts:
        ap.print_help()
        return 2

    orch = os.environ.get("ORCH", "https://jarvis.lan")
    session = f"ask-{int(time.time())}-{os.getpid()}"
    print(f"orchestrator {orch}  |  session {session}\n")

    for i, text in enumerate(texts):
        sid = f"{session}-{i}" if args.new else session
        elapsed, d = ask(orch, text, sid, args.timeout)
        verb = d.get("verb") or ("unsupported" if d.get("unsupported") else "-")
        reply = (d.get("reply_text") or "").strip()
        if not args.full:
            reply = reply.replace("\n", " / ")
            if len(reply) > 160:
                reply = reply[:157] + "..."
        print(f"> {text}")
        print(f"  {elapsed:.1f}s  [{verb}]")
        for line in (reply.splitlines() or [""]):
            print(f"       {line}")
        if d.get("confirm"):
            print(f"       CONFIRM PENDING: {d['confirm'].get('summary')}")
        print()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
