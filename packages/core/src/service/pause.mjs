import { CoreError } from "../errors.mjs";
import { pauseGenerationAfter } from "../privacy/pause.mjs";
import { entry, ownerOf } from "./entry.mjs";

/** @param {import("../ports/privacy.d.ts").PauseState} state */
export function pauseResult(state) {
  if (typeof state?.paused !== "boolean" || !Number.isSafeInteger(state.generation) || state.generation < 0) {
    throw new CoreError("internal_error");
  }
  return { paused: state.paused, generation: state.generation };
}

/**
 * @param {Pick<import("../ports/index.d.ts").StorageAdapter, "uow" | "pause">} storage
 * @returns {Pick<import("../ports/host.d.ts").MemoryService, "pauseState" | "setPause">}
 */
export function pauseMethods({ uow, pause }) {
  return {
    pauseState: entry(async (owner) => {
      owner = ownerOf(owner);
      return uow.run(owner, { pauseLock: true }, async tx => pauseResult(await pause.get(tx, owner)));
    }),
    setPause: entry(async (owner, paused) => {
      owner = ownerOf(owner);
      if (typeof paused !== "boolean") throw new CoreError("invalid_input");
      return uow.run(owner, { pauseLock: true }, async tx => {
        const before = pauseResult(await pause.get(tx, owner));
        const generation = pauseGenerationAfter(before.generation, paused ? "pause" : "resume");
        const after = pauseResult(await pause.set(tx, owner, paused));
        if (after.paused !== paused || after.generation !== generation) throw new CoreError("internal_error");
        return after;
      });
    }),
  };
}
