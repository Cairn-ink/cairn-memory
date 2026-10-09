export { withHeldLock as withHeldDispatch } from "../../client/testing/lock-contention.mjs";

import assert from "node:assert/strict";
import { channel } from "node:diagnostics_channel";
import { handleHook } from "../hook.mjs";

// Observe the real hook through its named channel, without rewriting source or
// depending on the shape of processHook's arguments. Join work left by the race.
export async function observedHook() {
  const work = new Set();
  let started = 0;
  const observation = channel("cairn.codex.hook.work");
  const observe = ({ work: promise }) => {
    started++;
    work.add(promise);
    promise.then(() => work.delete(promise), () => work.delete(promise));
  };
  return {
    async handleHook(input, options) {
      observation.subscribe(observe);
      try { return await handleHook(input, options); }
      finally { observation.unsubscribe(observe); }
    },
    async drainHookWork() {
      assert.ok(started > 0, "real hook work must have been observed");
      await Promise.all([...work]);
    },
  };
}
