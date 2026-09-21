/**
 * Turning a streamed reply into speakable chunks.
 *
 * TTS used to be fired once with the whole reply, so the voice started only
 * after the last token: 20.8s to the first spoken word on a 1497-character
 * answer. Piper renders roughly 8x faster than the audio plays, so speaking
 * sentence by sentence keeps the queue ahead of playback and moves the first
 * word to a few seconds.
 */

/** Trailing tokens that end in "." but do not end a sentence. */
const ABBREVIATIONS = new Set([
  "mr", "mrs", "ms", "dr", "prof", "sr", "jr", "st", "vs", "etc", "e.g", "i.e",
  "approx", "fig", "no", "inc", "ltd", "dept", "est", "min", "max", "avg",
]);

/** Speak a long run even without punctuation, so a bulleted list is not silent. */
const FLUSH_AT = 180;

function endsSentence(buf: string, i: number): boolean {
  const c = buf[i];
  if (c !== "." && c !== "!" && c !== "?" && c !== "…") return false;
  const next = buf[i + 1];
  // Nothing after it yet: the stream may still be mid-token.
  if (next === undefined) return false;
  // A dot with no following space is inside something — 192.168.8.1, gpu-01.lan,
  // 2.15 — not a sentence end. This is why the rack's IPs survive intact.
  if (!/\s/.test(next)) return false;
  if (c !== ".") return true;
  const word = (buf.slice(Math.max(0, i - 14), i).match(/([A-Za-z.]+)$/)?.[1] ?? "")
    .toLowerCase()
    .replace(/^\.+/, "");
  if (ABBREVIATIONS.has(word)) return false;
  // A single letter is an initial: "J. Stark".
  if (word.length === 1) return false;
  return true;
}

/**
 * Pull complete sentences off the front of a streaming buffer.
 * Returns what is ready to speak and what must wait for more tokens.
 */
export function takeSentences(
  buf: string,
  { flushAt = FLUSH_AT, final = false }: { flushAt?: number; final?: boolean } = {},
): { ready: string[]; rest: string } {
  const ready: string[] = [];
  let start = 0;
  for (let i = 0; i < buf.length; i += 1) {
    if (!endsSentence(buf, i)) continue;
    const s = buf.slice(start, i + 1).trim();
    if (s) ready.push(s);
    start = i + 1;
  }
  let rest = buf.slice(start);

  // Unpunctuated run: break at the last word boundary rather than mid-word.
  while (rest.trim().length > flushAt) {
    const cut = rest.lastIndexOf(" ", flushAt);
    if (cut <= 0) break;
    const head = rest.slice(0, cut).trim();
    if (!head) break;
    ready.push(head);
    rest = rest.slice(cut + 1);
  }

  if (final) {
    const tail = rest.trim();
    if (tail) ready.push(tail);
    rest = "";
  }
  return { ready, rest };
}

/**
 * Markdown is for the eye. Piper reads "**Bastion**" as "asterisk asterisk
 * Bastion", so strip the syntax and keep the words.
 */
export function stripForSpeech(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/(\*\*\*|___)(\S(?:[\s\S]*?\S)?)\1/g, "$2")
    .replace(/(\*\*|__)(\S(?:[\s\S]*?\S)?)\1/g, "$2")
    .replace(/(?<![\w*])\*(?!\s)([^*\n]+?)(?<!\s)\*(?![\w*])/g, "$1")
    .replace(/(?<![\w_])_(?!\s)([^_\n]+?)(?<!\s)_(?![\w_])/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s{0,3}>\s?/gm, "")
    // A list item is a beat of its own. Dropping the bullet and collapsing
    // newlines would run "ctrl-01 gpu-01 gpu-02" together as one breath, so
    // give each item a terminator for Piper to pause on.
    .replace(/^\s{0,3}([-*+]|\d{1,2}[.)])\s+(.*?)\s*$/gm, (_m, _b, item: string) =>
      /[.!?:;,\u2026]$/.test(item) ? item : `${item}.`,
    )
    .replace(/^\s*([-*_]\s*){3,}$/gm, " ")
    .replace(/\s+/g, " ")
    .trim();
}
