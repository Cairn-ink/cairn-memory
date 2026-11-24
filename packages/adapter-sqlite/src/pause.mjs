import { CoreError, pauseGenerationAfter } from "@cairn-ink/core";
import { ownerKey } from "./storage-values.mjs";

/** @import { PauseStore } from "@cairn-ink/core/ports" */
/** @typedef {ReturnType<typeof import("./uow.mjs").openSqliteUnitOfWork>["port"]} Port */
/** @typedef {Parameters<Parameters<Port>[3]>[0]} Connection */

/** @param {Connection} db @param {string} owner */
function readPause(db, owner) {
  const row = db.prepare("SELECT paused, generation FROM cairn_pause WHERE owner_id = ?").get(ownerKey(owner));
  return { paused: row?.paused === 1, generation: Number(row?.generation ?? 0) };
}

/** @param {Port} port @returns {PauseStore} */
export function createPauseStore(port) {
  return {
    get(tx, owner) {
      return port(tx, owner, { pauseLock: true }, db => readPause(db, owner));
    },
    set(tx, owner, paused) {
      return port(tx, owner, { pauseLock: true, write: true }, db => {
        if (typeof paused !== "boolean") throw new CoreError("invalid_input");
        const current = readPause(db, owner);
        if (!paused && !current.paused) return current;
        const generation = pauseGenerationAfter(current.generation, paused ? "pause" : "resume");
        if (!Number.isSafeInteger(generation)) throw new CoreError("internal_error");
        db.prepare(`INSERT INTO cairn_pause (owner_id, paused, generation) VALUES (?, ?, ?)
          ON CONFLICT (owner_id) DO UPDATE SET paused = excluded.paused, generation = excluded.generation`)
          .run(owner, Number(paused), generation);
        return { paused, generation };
      });
    },
  };
}
