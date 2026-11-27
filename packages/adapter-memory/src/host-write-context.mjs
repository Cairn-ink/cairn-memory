// @ts-ignore Node supplies this module at runtime.
import { AsyncLocalStorage } from "node:async_hooks";
import { guardHostWriteContext } from "../../core/src/service/entry.mjs";

/** @import { HostWriteHookPort, HostCaptureWrite, Tx } from "../../core/src/ports/index.d.ts" */
/** @typedef {HostWriteHookPort["context"]} HookContext */

// Module-private: this context only tells whether code runs inside a hook. It grants nothing;
// hook operations are authorized from the port's core-registered reader.
const storage = new AsyncLocalStorage();

export const nodeHostWriteContext = guardHostWriteContext(/** @type {HookContext} */ ({
  getStore() { return storage.getStore(); },
  run(store, callback) { return storage.run(store, callback); },
}));

/** @type {WeakMap<Tx, HostCaptureWrite[]>} */
export const hostCaptureEffects = new WeakMap();
