import assert from "node:assert/strict";
import test from "node:test";
import { cmdBarEnterSends } from "./cmdEnter.ts";

test("Enter sends, Shift+Enter and Alt+Enter do not", () => {
  const plain = { shift: false, alt: false, composing: false };
  assert.equal(cmdBarEnterSends("Enter", plain), true);
  assert.equal(cmdBarEnterSends("Enter", { ...plain, shift: true }), false);
  assert.equal(cmdBarEnterSends("Enter", { ...plain, alt: true }), false);
  assert.equal(cmdBarEnterSends("Enter", { ...plain, composing: true }), false);
  assert.equal(cmdBarEnterSends("a", plain), false);
});
