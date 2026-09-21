/**
 * The four rooms of the cockpit, left to right.
 *
 *   login   the gate — authentication portal to JARVIS
 *   breath  the first portal you speak to; a 1:1 living exchange with JARVIS,
 *           staged on the night Earth. The globe is the backdrop; the room is
 *           the conversation.
 *   cmd     the operator's desk — the day's work and what needs attention
 *   noc     the rack — network and systems operations, drill-down detail
 */
export const SLIDES = ["login", "breath", "cmd", "noc"] as const;
export type SlideName = (typeof SLIDES)[number];
export type Slide = 0 | 1 | 2 | 3;

/** Retired route names. `#earth` was the breath room until 2026-09-21; an old
 *  bookmark should land on the right room, not silently fall back to login. */
const LEGACY: Record<string, SlideName> = { earth: "breath" };

export function parseHash(hash = window.location.hash): Slide {
  const name = hash.replace(/^#/, "").toLowerCase();
  const resolved = LEGACY[name] ?? name;
  const i = SLIDES.indexOf(resolved as SlideName);
  return (i >= 0 ? i : 0) as Slide;
}

export function hashFor(index: Slide): string {
  return `#${SLIDES[index]}`;
}
