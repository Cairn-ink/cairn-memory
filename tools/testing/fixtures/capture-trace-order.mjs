import assert from "node:assert/strict";

const methods = calls => calls.map(([method]) => method);
const dispatchGate = calls => calls.findIndex(([method, , phase]) => method === "gate" && phase === "dispatch");

export function restoreCaptureTraceOrder({ calls, mutations }, baseCalls) {
  const screen = ["run", "lock", "lock", "pause.get", "capture.load", "suppressions.snapshot", "capture.assertEligible"];
  const dispatch = dispatchGate(calls);
  const refresh = dispatch - screen.length;
  assert.ok(refresh >= 0);
  assert.deepEqual(methods(calls.slice(refresh, dispatch)), screen);
  assert.equal(calls[dispatch + 1][0], "model.call");

  const screeningReads = calls.slice(0, refresh).flatMap(([method], index) =>
    method === "capture.assertEligible" ? [index - 2] : []);
  assert.equal(screeningReads.length, 2);
  for (const read of screeningReads) {
    assert.deepEqual(methods(calls.slice(read - 4, read + 3)), screen);
  }

  const baseDispatch = dispatchGate(baseCalls);
  assert.ok(baseDispatch > 0);
  let restored;
  if (baseCalls[baseDispatch - 1][0] === "capture.load") {
    // The immediate predecessor read the outbox after asserting in the refresh.
    const load = refresh + 4;
    restored = calls.toSpliced(load, 3, ...calls.slice(load + 1, dispatch), calls[load]);
  } else {
    // Older qualifications also remove the read-only refresh and two later outbox reads.
    const preEmbed = calls.findIndex(([method], index) => index > dispatch && method === "capture.load");
    assert.ok(preEmbed > dispatch);
    assert.deepEqual(methods(calls.slice(preEmbed - 5, preEmbed + 2)),
      ["run", "lock", "lock", "pause.get", "capture.eligible", "capture.load", "suppressions.snapshot"]);
    const finish = calls.findIndex(([method], index) => index > preEmbed && method === "capture.load");
    assert.ok(finish > preEmbed);
    assert.deepEqual(methods(calls.slice(finish - 4, finish + 2)),
      ["run", "lock", "lock", "pause.get", "capture.load", "capture.assertEligible"]);
    restored = calls.toSpliced(finish, 1).toSpliced(preEmbed, 1).toSpliced(refresh, screen.length);
    const refreshRun = 1 + methods(calls.slice(0, refresh)).filter(method => method === "run").length;
    mutations = mutations.map(mutation => {
      assert.notEqual(mutation.run, refreshRun, "the refresh has no mutations");
      return { ...mutation, run: mutation.run - Number(mutation.run > refreshRun) };
    });
  }
  for (const read of screeningReads.toReversed()) restored.splice(read, 1);
  return { calls: restored, mutations };
}
