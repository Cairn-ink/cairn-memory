import assert from "node:assert/strict";
import { test } from "node:test";
import { mayAdmitCapture, maySettleAfterPause, pauseGenerationAfter } from "../src/index.mjs";

test("capture admission requires a known unpaused state", () => {
  assert.equal(mayAdmitCapture({ paused: false, generation: 0 }), true);
  assert.equal(mayAdmitCapture({ paused: true, generation: 1 }), false);
  assert.equal(mayAdmitCapture({ generation: 1 }), false);
  assert.equal(mayAdmitCapture(null), false);
  assert.equal(mayAdmitCapture(undefined), false);
});

test("registered work may settle status and counts after pause returns", () => {
  for (const kind of ["status", "counts"]) assert.equal(maySettleAfterPause(kind), true);
  for (const kind of ["memory", "raw", "embedding", "unknown"]) assert.equal(maySettleAfterPause(kind), false);
});

test("every pause increments the generation and resume preserves it", () => {
  const actions = ["resume", "pause", "pause", "resume", "resume", "pause"];
  let generation = 0;
  assert.deepEqual(actions.map((action) => generation = pauseGenerationAfter(generation, action)), [0, 1, 2, 2, 2, 3]);
});
