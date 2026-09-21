export type BriefingAgenda = {
  t: string;
  label: string;
};

export type BriefingToday = {
  t: string;
  kind: string;
  label: string;
  /** Second line under the title. Falls back to the kind when absent. */
  detail: string | null;
};

export type SessionBriefing = {
  overnight: string | null;
  lab: string | null;
  agenda: BriefingAgenda[];
  today: BriefingToday[];
  focus: string | null;
  lab_name: string | null;
};

export function capCopy(text: string, max = 420): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1).trimEnd()}…`;
}

/** capCopy collapses every run of whitespace, which flattens a multi-line
 *  briefing into one paragraph. This caps line-by-line instead. */
export function capLines(text: string, maxLines = 8, maxPerLine = 160): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, maxLines)
    .map((line) => capCopy(line, maxPerLine));
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asAgenda(value: unknown): BriefingAgenda[] {
  if (!Array.isArray(value)) return [];
  const out: BriefingAgenda[] = [];
  for (const row of value) {
    if (!row || typeof row !== "object") continue;
    const rec = row as Record<string, unknown>;
    const label = asString(rec.label);
    if (!label) continue;
    out.push({ t: asString(rec.t) ?? "", label: capCopy(label, 80) });
  }
  return out.slice(0, 6);
}

function asToday(value: unknown): BriefingToday[] {
  if (!Array.isArray(value)) return [];
  const out: BriefingToday[] = [];
  for (const row of value) {
    if (!row || typeof row !== "object") continue;
    const rec = row as Record<string, unknown>;
    const label = asString(rec.label);
    if (!label) continue;
    const detail = asString(rec.detail);
    out.push({
      t: asString(rec.t) ?? "",
      kind: asString(rec.kind) ?? "note",
      label: capCopy(label, 80),
      detail: detail ? capCopy(detail, 90) : null,
    });
  }
  return out.slice(0, 8);
}

export function parseBriefing(raw: unknown): SessionBriefing | null {
  if (!raw || typeof raw !== "object") return null;
  const rec = raw as Record<string, unknown>;
  const overnight = asString(rec.overnight);
  const lab = asString(rec.lab);
  const focus = asString(rec.focus);
  const lab_name = asString(rec.lab_name);
  const agenda = asAgenda(rec.agenda);
  const today = asToday(rec.today);
  if (!overnight && !lab && !focus && !lab_name && agenda.length === 0 && today.length === 0) {
    return null;
  }
  return { overnight, lab, agenda, today, focus, lab_name };
}
