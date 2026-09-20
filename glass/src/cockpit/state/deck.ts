export const SLIDES = ["login", "earth", "cmd", "noc"] as const;
export type SlideName = (typeof SLIDES)[number];
export type Slide = 0 | 1 | 2 | 3;

export function parseHash(hash = window.location.hash): Slide {
  const name = hash.replace(/^#/, "").toLowerCase();
  const i = SLIDES.indexOf(name as SlideName);
  return (i >= 0 ? i : 0) as Slide;
}

export function hashFor(index: Slide): string {
  return `#${SLIDES[index]}`;
}
