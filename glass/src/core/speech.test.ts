import assert from "node:assert/strict";
import test from "node:test";
import { stripForSpeech, takeSentences } from "./speech.ts";

test("splits on sentence ends and holds the incomplete tail", () => {
  const { ready, rest } = takeSentences("All nodes are ready. The rack is quiet. Tea is");
  assert.deepEqual(ready, ["All nodes are ready.", "The rack is quiet."]);
  assert.equal(rest, " Tea is");
});

test("does not split inside an IP address, a version or a hostname", () => {
  for (const s of ["The LAN is 192.168.8.0/24 and", "Load hit 2.15 on", "See gpu-01.lan for"]) {
    assert.deepEqual(takeSentences(s).ready, [], s);
  }
  // …but a number that really does end a sentence still splits. The trailing
  // "." is held back because mid-stream we cannot know it is the last char.
  assert.deepEqual(takeSentences("Peak load was 2.15. Nothing else.").ready,
    ["Peak load was 2.15."]);
  assert.deepEqual(takeSentences("Peak load was 2.15. Nothing else.", { final: true }).ready,
    ["Peak load was 2.15.", "Nothing else."]);
});

test("does not split on abbreviations or initials", () => {
  assert.deepEqual(takeSentences("Nodes, e.g. gpu-01, are warm. Fine.", { final: true }).ready,
    ["Nodes, e.g. gpu-01, are warm.", "Fine."]);
  assert.deepEqual(takeSentences("Ask J. Stark about it. Done.", { final: true }).ready,
    ["Ask J. Stark about it.", "Done."]);
});

test("a trailing terminator waits for the next token", () => {
  // The stream may be mid-token: "ready." could still become "ready.5".
  assert.deepEqual(takeSentences("All nodes are ready."), { ready: [], rest: "All nodes are ready." });
  assert.deepEqual(takeSentences("All nodes are ready. ").ready, ["All nodes are ready."]);
});

test("flushes an unpunctuated run at a word boundary", () => {
  const run = "alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima mike november oscar papa quebec";
  const { ready, rest } = takeSentences(run, { flushAt: 40 });
  assert.ok(ready.length >= 2);
  for (const c of ready) assert.ok(!c.endsWith(" ") && !c.startsWith(" "));
  assert.ok(ready.every((c) => c.length <= 60), ready.join("|"));
  assert.ok(!(ready.join(" ") + " " + rest).includes("  "));
  assert.equal((ready.join(" ") + " " + rest).trim(), run);
});

test("final drains whatever is left", () => {
  assert.deepEqual(takeSentences("no terminator here", { final: true }),
    { ready: ["no terminator here"], rest: "" });
  assert.deepEqual(takeSentences("   ", { final: true }), { ready: [], rest: "" });
});

test("strips markdown Piper would otherwise read aloud", () => {
  assert.equal(stripForSpeech("**Bastion** is the *gateway*"), "Bastion is the gateway");
  assert.equal(stripForSpeech("## Lab\n- ctrl-01\n- gpu-01"), "Lab ctrl-01. gpu-01.");
  assert.equal(stripForSpeech("Run `kubectl get pods` now"), "Run kubectl get pods now");
  assert.equal(stripForSpeech("See [the docs](http://x/y) please"), "See the docs please");
  assert.equal(stripForSpeech("1. first\n2. second"), "first. second.");
  // An item that already ends in punctuation is not double-stopped.
  assert.equal(stripForSpeech("- ready.\n- warm?"), "ready. warm?");
});

test("leaves ordinary prose and identifiers alone", () => {
  for (const s of ["The rack is at 192.168.8.0/24.", "gpu-01 and gpu-02 are warm.", "Tea, or coffee?"]) {
    assert.equal(stripForSpeech(s), s, s);
  }
  // snake_case and a*b must survive: they are not emphasis.
  assert.equal(stripForSpeech("set memory_db_path now"), "set memory_db_path now");
});
