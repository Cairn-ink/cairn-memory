import assert from "node:assert/strict";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { detectCardAmendments } from "@cairn-ink/core/routing";

const timeoutMs = 20;
const scope = { owner: "owner", namespace: "work" };
const capture = {
  client: "client", sessionId: "later", scope, date: "2025-06-12",
  messages: [{ id: "question", role: "user", content: "Set the width to 4." }],
};
const cards = [{
  id: "card", date: "2025-06-10", scope, body: "Width: 3",
  sourceMessage: { client: "client", sessionId: "earlier", messageId: "original" },
}];

function detect(detectChanges) {
  const model = {
    countTokens: text => text.length,
    detectChanges,
    async verifyChange() { assert.fail("verify should not be called"); },
  };
  return detectCardAmendments({ model, capture, cards, limits: { timeoutMs } });
}

test("the deadline aborts the model signal and ends detection even if the model keeps waiting", async () => {
  const watchdog = new AbortController();
  let signal;
  let abortedOnDispatch;
  try {
    const result = await Promise.race([
      detect((_request, options) => {
        signal = options.signal;
        abortedOnDispatch = signal.aborted;
        return new Promise(() => {});
      }),
      // Keep the event loop available for the unref'ed deadline, and bound a broken race.
      delay(2_000, undefined, { signal: watchdog.signal }).then(() => assert.fail("detection did not time out")),
    ]);
    assert.deepEqual(result, { amendments: [], counters: { detect_calls: 1, detect_timeout: 1 } });
    assert.equal(abortedOnDispatch, false);
    assert.equal(signal.aborted, true);
    assert.equal(signal.reason.name, "TimeoutError");
  } finally {
    watchdog.abort();
  }
});

test("a model response before the deadline leaves no unhandled rejection when the signal aborts", async (t) => {
  const unhandled = [];
  const onUnhandled = reason => unhandled.push(reason);
  process.on("unhandledRejection", onUnhandled);
  t.after(() => process.off("unhandledRejection", onUnhandled));

  let signal;
  const result = await detect(async (_request, options) => {
    signal = options.signal;
    return { changes: [] };
  });
  assert.deepEqual(result, { amendments: [], counters: { detect_calls: 1 } });
  assert.equal(signal.aborted, false);
  await delay(2 * timeoutMs);
  assert.equal(signal.aborted, true);
  assert.deepEqual(unhandled, []);
});
