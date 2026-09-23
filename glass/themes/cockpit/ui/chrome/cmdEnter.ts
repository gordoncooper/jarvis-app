/** Enter sends. Shift+Enter and Alt+Enter keep the newline. A composing
 *  Enter (IME) must not send a partial word. */
export function cmdBarEnterSends(key: string, mod: { shift: boolean; alt: boolean; composing: boolean }): boolean {
  if (key !== "Enter" || mod.composing) return false;
  return !mod.shift && !mod.alt;
}
