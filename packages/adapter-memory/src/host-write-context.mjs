// @ts-ignore Node supplies this module at runtime.
import { AsyncLocalStorage } from "node:async_hooks";

/** @import { HostWriteHookPort, HostCaptureWrite, Tx } from "../../core/src/ports/index.d.ts" */
/** @typedef {HostWriteHookPort["context"]} HookContext */

// The Node adapters share the marker, including when separate package copies are loaded.
const key = Symbol.for("@cairn-ink/host-write-context");
const shared = /** @type {{ [key]?: HookContext }} */ (globalThis);

/** @type {HookContext} */
export const nodeHostWriteContext = {
  getStore() { return shared[key]?.getStore(); },
  run(store, callback) {
    const context = shared[key] ??= new AsyncLocalStorage();
    return context.run(store, callback);
  },
};

/** @type {WeakMap<Tx, HostCaptureWrite[]>} */
export const hostCaptureEffects = new WeakMap();
