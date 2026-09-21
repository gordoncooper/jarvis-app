# cockpit — theme docs

Everything specific to the `cockpit` theme. Product-level docs live at the repo
root: [architecture](../../../../docs/ARCHITECTURE.md),
[workflow](../../../../docs/WORKFLOW.md),
[theme contract](../../../../docs/THEMES.md), [law](../../../../AGENTS.md).

| File | What it is | Use it when |
| --- | --- | --- |
| [DESIGN.md](./DESIGN.md) | Visual contract — locked tokens, chrome language, what is allowed | Changing colour, type, density, or adding a viz |
| [COCKPIT.md](./COCKPIT.md) | Build brief — what each display contains, what to type | Implementing or altering a display |
| [COCKPIT-PLAN.md](./COCKPIT-PLAN.md) | Architecture of the four rooms and why | Understanding intent before changing layout |
| [reference/](./reference) | The four locked frames at 1920×1080 | Judging whether a display still looks right |

## The four displays

`login → earth → cmd → noc`, one horizontal deck. Hash routes:
`#login`, `#earth`, `#cmd`, `#noc`.

Acceptance is comparison against `reference/*.jpg`: same hierarchy, same teal,
same Plex, same density. Earth has no centred modal, Login has no visible form
until the badge is lifted, NOC is a schematic not a globe, CMD is a briefing
desk not a rack.

## Revisions to the locked spec

Operator requests that override the original brief are marked inline in
`COCKPIT.md` with the date and reason — search for **Revised**. They are not
drift; they are the current spec. So far:

- **2026-09-20** — Login gained a mocked presence gate behind the badge lid,
  superseding "no form fields".
- **2026-09-20** — Earth gained a bounded, fading dialogue strip, superseding
  the "two-line toast" and narrowing the "no chat transcript" rule to "no
  scrolling transcript, no modal".
