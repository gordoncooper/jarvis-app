import assert from "node:assert/strict";
import test from "node:test";
import { breathBlocks } from "./breathCopy.ts";

test("keeps single newlines and splits paragraphs on a blank line", () => {
  assert.deepEqual(breathBlocks("Alpha\nbeta\n\nGamma"), [
    { k: "p", body: [{ k: "t", s: "Alpha" }, { k: "br" }, { k: "t", s: "beta" }] },
    { k: "p", body: [{ k: "t", s: "Gamma" }] },
  ]);
});

test("lays bullets and counts out as rows without the markers", () => {
  assert.deepEqual(breathBlocks("Nodes:\n- **ctrl-01** ready\n- gpu-01 warm\n\n1. Confirm\n2. Leave it"), [
    { k: "p", body: [{ k: "t", s: "Nodes:" }] },
    {
      k: "ul",
      items: [
        [{ k: "b", s: "ctrl-01" }, { k: "t", s: " ready" }],
        [{ k: "t", s: "gpu-01 warm" }],
      ],
    },
    {
      k: "ol",
      nums: [1, 2],
      items: [[{ k: "t", s: "Confirm" }], [{ k: "t", s: "Leave it" }]],
    },
  ]);
});

test("leaves an unclosed marker literal so a stream does not eat the tail", () => {
  assert.deepEqual(breathBlocks("**Bas"), [{ k: "p", body: [{ k: "t", s: "**Bas" }] }]);
});

test("does not treat a version or snake_case as a list or emphasis", () => {
  assert.deepEqual(breathBlocks("Load hit 2.15 on gpu_01"), [
    { k: "p", body: [{ k: "t", s: "Load hit 2.15 on gpu_01" }] },
  ]);
});

test("joins an indented continuation onto the open item", () => {
  assert.deepEqual(breathBlocks("- alpha\n  beta"), [
    { k: "ul", items: [[{ k: "t", s: "alpha beta" }]] },
  ]);
});

test("strips a fence, a link sigil, and a rule", () => {
  assert.deepEqual(breathBlocks("See [apps](http://apps.lan)\n\n```\nkubectl get po\n```\n\n---\n\nDone"), [
    { k: "p", body: [{ k: "t", s: "See apps" }] },
    { k: "pre", s: "kubectl get po" },
    { k: "p", body: [{ k: "t", s: "Done" }] },
  ]);
});

test("keeps a trailing open fence as the code so far", () => {
  assert.deepEqual(breathBlocks("```\nkubectl"), [{ k: "pre", s: "kubectl" }]);
});
