"""Turn a raw pod log into something safe to say aloud (D-0041).

The orchestrator fetches the tail, then this module is the only thing that
may look at it. Lines that look like credentials are dropped, not masked:
a half-redacted token read out by Piper is still a token. What remains is
capped, and the spoken reply is a handful of lines, not the tail.
"""

from __future__ import annotations

import re

# Fixed. Not a parameter a request can raise.
TAIL_FETCH = 80
KEEP_LINES = 40
SPEAK_LINES = 4
LINE_MAX = 140

# Drop the whole line. Matching a keyword and then speaking the rest of the
# line is how "token: *** abc.def.ghi" still leaks.
_SECRET = re.compile(
    r"(?i)("
    r"password|passwd|\bsecret\b|api[-_]?key|"
    r"authorization\s*[:=]|bearer\s+\S|"
    r"\btoken\s*[:=]|kubeconfig|private[-_ ]key|"
    r"BEGIN [A-Z ]*PRIVATE KEY|"
    r"AKIA[0-9A-Z]{16}|"
    r"eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}|"
    r"://[^/\s:]+:[^/\s@]+@"
    r")"
)

_ERRORISH = re.compile(
    r"(?i)\b(error|fail(?:ed|ure)?|exception|panic|traceback|fatal|warn(?:ing)?)\b"
)


def summarize_log(raw: str, *, workload: str) -> tuple[str, dict[str, int]]:
    """Spoken summary plus counts. The counts are the only structured data.

    `raw` is not returned, stored, or interpolated into the summary except
    for lines that survived the filter, and those are truncated.
    """
    withheld = 0
    kept: list[str] = []
    for line in (raw or "").splitlines():
        if _SECRET.search(line):
            withheld += 1
            continue
        text = line.strip()
        if not text:
            continue
        kept.append(text[:LINE_MAX])
    kept = kept[-KEEP_LINES:]
    notable = [line for line in kept if _ERRORISH.search(line)]
    chosen = (notable or kept)[-SPEAK_LINES:]

    counts = {
        "kept": len(kept),
        "withheld": withheld,
        "spoken": len(chosen),
    }
    if not kept and withheld:
        text = (
            f"I read the recent logs for {workload} and withheld every line, "
            "because they looked like credentials. I will not read them out."
        )
        return text, counts
    if not kept:
        text = f"The recent logs for {workload} are empty."
        return text, counts

    if notable:
        head = (
            f"In the recent logs for {workload}, "
            f"{len(notable)} line{'s' if len(notable) != 1 else ''} "
            f"look{'s' if len(notable) == 1 else ''} like a problem."
        )
    else:
        head = (
            f"The recent logs for {workload} show nothing that looks like an error."
        )
    if withheld:
        head += f" I withheld {withheld} line{'s' if withheld != 1 else ''} that looked like credentials."
    body = " ".join(f'"{line}"' for line in chosen)
    return f"{head} Latest: {body}", counts
