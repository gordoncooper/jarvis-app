"""Pure /v1/session briefing parse. No I/O — missing sections stay null."""

from __future__ import annotations

import re
from typing import Any

_ATX = re.compile(r"^#{1,3}\s+(.+?)\s*$")
_LABELED = re.compile(
    r"^(overnight|lab|agenda|today|focus|lab[ _-]?name)\s*:\s*$",
    re.I,
)
_KNOWN = {
    "overnight": "overnight",
    "lab": "lab",
    "agenda": "agenda",
    "today": "today",
    "focus": "focus",
    "lab name": "lab_name",
    "lab_name": "lab_name",
    "lab-name": "lab_name",
}
_LIST = re.compile(
    r"^[-*]\s+(?:(\d{1,2}:\d{2})\s+)?(?:\[([a-z][a-z0-9_-]*)\]\s+)?(.+)$",
    re.I,
)
_KIND_PREFIX = re.compile(
    r"^(inbound|inbox|mail|schedule|calendar|agenda|clock|pulse|cluster|system|gear|memory|mem|chip)\s*[:·\-]?\s+(.+)$",
    re.I,
)


def _norm_heading(raw: str) -> str | None:
    key = re.sub(r"[#]+", "", raw).strip().lower()
    key = re.sub(r"[:]+$", "", key).strip()
    key = re.sub(r"[\s_]+", " ", key)
    return _KNOWN.get(key)


def _cap(text: str, max_len: int) -> str:
    t = re.sub(r"\s+", " ", text).strip()
    if len(t) <= max_len:
        return t
    return t[: max_len - 1].rstrip() + "…"


def _paragraph(lines: list[str], max_len: int) -> str | None:
    body = "\n".join(lines).strip()
    if not body:
        return None
    return _cap(body, max_len)


def _items(lines: list[str], *, today: bool) -> list[dict[str, str]]:
    out: list[dict[str, str]] = []
    limit = 8 if today else 6
    for raw in lines:
        line = raw.strip()
        if not line:
            continue
        m = _LIST.match(line)
        if not m:
            continue
        t = (m.group(1) or "").strip()
        kind = (m.group(2) or "").strip().lower()
        label = (m.group(3) or "").strip()
        if not label:
            continue
        if today and not kind:
            km = _KIND_PREFIX.match(label)
            if km:
                kind = km.group(1).lower()
                label = km.group(2).strip()
        row: dict[str, str] = {"t": t, "label": _cap(label, 80)}
        if today:
            row["kind"] = kind or "note"
        out.append(row)
        if len(out) >= limit:
            break
    return out


def _heading_name(line: str) -> str | None:
    stripped = line.strip()
    atx = _ATX.match(stripped)
    if atx:
        return _norm_heading(atx.group(1))
    labeled = _LABELED.match(stripped)
    if labeled:
        return _norm_heading(labeled.group(1))
    return None


def assemble_briefing(markdown: str) -> dict[str, Any]:
    """Map briefing.md (optional Overnight/Lab/Agenda/Today/Focus) to JSON.

    Does not invent cluster numbers. Unheaded prose becomes ``lab``.
    """
    empty: dict[str, Any] = {
        "overnight": None,
        "lab": None,
        "agenda": [],
        "today": [],
        "focus": None,
        "lab_name": None,
    }
    text = (markdown or "").strip()
    if not text:
        return empty

    sections: list[tuple[str, list[str]]] = []
    current = "lab"
    buf: list[str] = []
    saw_heading = False
    for line in text.splitlines():
        name = _heading_name(line)
        if name:
            saw_heading = True
            sections.append((current, buf))
            current = name
            buf = []
            continue
        buf.append(line)
    sections.append((current, buf))
    if not saw_heading:
        sections = [("lab", text.splitlines())]

    out = dict(empty)
    for name, lines in sections:
        if name in ("overnight", "lab", "focus", "lab_name"):
            cap = 48 if name == "lab_name" else (220 if name == "focus" else 420)
            parsed = _paragraph(lines, cap)
            if parsed:
                out[name] = parsed
        elif name == "agenda":
            out["agenda"] = _items(lines, today=False)
        elif name == "today":
            out["today"] = _items(lines, today=True)
    return out
