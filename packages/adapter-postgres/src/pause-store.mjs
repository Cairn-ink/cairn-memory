import { CoreError } from "../../core/src/index.mjs";
import { advanceIndex } from "./memory-rows.mjs";
import { requireLiveRun, runOperation } from "./uow.mjs";

/** @import { OwnerId, PauseStore, Tx } from "../../core/src/ports/index.d.ts" */

const DEFAULT = { paused: false, generation: 0 };

/** @param {Tx} tx @param {OwnerId} owner @param {boolean} [write] */
function guardPause(tx, owner, write) {
  const run = requireLiveRun(tx, write);
  if (!run.pauseLock || owner !== tx.owner) throw new CoreError("internal_error");
}

/** @returns {PauseStore} */
export function createPostgresPauseStore() {
  return {
    async get(tx, owner) {
      guardPause(tx, owner);
      return runOperation(tx, async (query) => {
        const { rows: [row] } = await query("SELECT paused, generation FROM memory_pause WHERE user_id = $1", [owner]);
        return row ?? { ...DEFAULT };
      });
    },
    async set(tx, owner, paused) {
      guardPause(tx, owner, true);
      if (typeof paused !== "boolean") throw new CoreError("invalid_input");
      return runOperation(tx, async (query) => {
        if (paused) {
          const { rows: [row] } = await query(`INSERT INTO memory_pause (user_id, paused, generation)
            VALUES ($1, true, 1) ON CONFLICT (user_id) DO UPDATE
            SET paused = true, generation = memory_pause.generation + 1 RETURNING paused, generation`, [owner]);
          await advanceIndex(query, owner);
          return row;
        }
        const { rows: [changed] } = await query(`UPDATE memory_pause SET paused = false
          WHERE user_id = $1 AND paused RETURNING paused, generation`, [owner]);
        if (changed) {
          await advanceIndex(query, owner);
          return changed;
        }
        const { rows: [row] } = await query("SELECT paused, generation FROM memory_pause WHERE user_id = $1", [owner]);
        return row ?? { ...DEFAULT };
      });
    },
  };
}
