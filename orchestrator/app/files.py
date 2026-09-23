"""List the one folder Gordon drops files into (D-0042).

The root is fixed. There is no path argument, so a request cannot point
this at the memory database or at backups. Names, sizes, and ages only.
File contents are never opened, and a symlink is reported as a link
without following it.
"""

from __future__ import annotations

import os
import time
from pathlib import Path

FILES_ROOT = Path("/var/jarvis/files")

# Voice cap. The data dict can hold more; Piper should not recite a tree.
SPEAK_MAX = 8
LIST_MAX = 40


def _fmt_bytes(n: float) -> str:
    for unit, div in (("TB", 1000**4), ("GB", 1000**3), ("MB", 1000**2), ("KB", 1000)):
        if n >= div:
            return f"{n / div:.1f} {unit}"
    return f"{int(n)} B"


def _age(mtime: float, now: float) -> str:
    secs = max(0.0, now - mtime)
    if secs < 3600:
        return "within the last hour"
    if secs < 48 * 3600:
        hours = int(secs / 3600)
        return f"about {hours} hour{'s' if hours != 1 else ''} ago"
    days = int(secs / 86400)
    return f"{days} day{'s' if days != 1 else ''} ago"


def list_folder(root: Path = FILES_ROOT, *, now: float | None = None) -> tuple[str, dict]:
    """Spoken listing plus a name-only data dict."""
    now = time.time() if now is None else now
    if root.is_symlink() or not root.is_dir():
        return (
            "The files folder is not there, so I have nothing to list.",
            {"entries": []},
        )

    rows: list[dict] = []
    try:
        with os.scandir(root) as scan:
            for entry in scan:
                kind = "link" if entry.is_symlink() else "dir" if entry.is_dir(follow_symlinks=False) else "file"
                try:
                    st = entry.stat(follow_symlinks=False)
                    size = int(st.st_size)
                    mtime = float(st.st_mtime)
                except OSError:
                    size, mtime = 0, now
                rows.append(
                    {
                        "name": entry.name,
                        "kind": kind,
                        "bytes": size,
                        "mtime": mtime,
                    }
                )
    except OSError:
        return ("I could not read the files folder.", {"entries": []})

    rows.sort(key=lambda row: row["name"].casefold())
    extra = max(0, len(rows) - LIST_MAX)
    rows = rows[:LIST_MAX]
    if not rows:
        return ("The files folder is empty.", {"entries": []})

    spoken = rows[:SPEAK_MAX]
    parts = []
    for row in spoken:
        if row["kind"] == "dir":
            label = "a folder"
        elif row["kind"] == "link":
            label = "a link"
        else:
            label = _fmt_bytes(row["bytes"])
        parts.append(f"{row['name']}, {label}, {_age(row['mtime'], now)}")
    n = len(rows) + extra
    head = f"{n} item{'s' if n != 1 else ''} in the files folder."
    text = head + " " + ". ".join(parts) + "."
    hidden = (len(rows) - len(spoken)) + extra
    if hidden:
        text += f" And {hidden} more."
    data = {
        "entries": [
            {"name": row["name"], "kind": row["kind"], "bytes": row["bytes"]}
            for row in rows
        ]
    }
    return text, data
