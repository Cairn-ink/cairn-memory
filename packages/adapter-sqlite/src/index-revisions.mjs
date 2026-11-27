import { CoreError } from "@cairn-ink/core";
import { advanceCardNeutralEpoch, CARD_NEUTRAL_WRITES } from "./context-read-state.mjs";
import { ownerKey } from "./storage-values.mjs";

/** @import { FinishResult, Tx, UnitOfWork } from "@cairn-ink/core/ports" */
/** @import { Connection, Port } from "./storage-values.mjs" */
/** @typedef {readonly [string, string, string]} Identity */
/** @typedef {{ revision: number | undefined }} RevisionView */
/** @typedef {{ ordinaryWrite: boolean, cardNeutralWrite: boolean, start?: number, view: RevisionView,
 *   finishes: Map<string, { identity: Identity, revision: number }> }} IndexRun */

/** @param {Connection} db @param {string} owner @param {boolean} advance */
function readRevision(db, owner, advance) {
  const id = ownerKey(owner);
  const row = advance
    ? db.prepare(`INSERT INTO cairn_index_revisions (owner_id, revision) VALUES (?, 1)
        ON CONFLICT (owner_id) DO UPDATE SET revision = revision + 1 RETURNING revision`).get(id)
    : db.prepare("SELECT revision FROM cairn_index_revisions WHERE owner_id = ?").get(id);
  return Number(row?.revision ?? 0);
}

/** @param {UnitOfWork} uow @param {Port} port */
export function createIndexRevisions(uow, port) {
  /** @type {WeakMap<Tx, IndexRun>} */
  const runs = new WeakMap();

  /** @param {Tx} tx */
  function indexRun(tx) {
    const run = runs.get(tx);
    if (!run) throw new CoreError("internal_error");
    return run;
  }

  /** @param {Connection} db @param {Tx} tx @param {IndexRun} run */
  function startRevision(db, tx, run) {
    return run.start ??= readRevision(db, tx.owner, false);
  }

  /** @param {Connection} db @param {Tx} tx */
  function current(db, tx) {
    const run = indexRun(tx);
    return run.view.revision ?? startRevision(db, tx, run);
  }

  /** @param {Connection} db @param {Tx} tx @param {IndexRun} run */
  function advance(db, tx, run) {
    startRevision(db, tx, run);
    return run.view.revision = readRevision(db, tx.owner, true);
  }

  return {
    /** @type {UnitOfWork["run"]} */
    run(owner, options, work) {
      if (typeof work !== "function") return uow.run(owner, options, work);
      return uow.run(owner, options, async tx => {
        /** @type {IndexRun} */
        const run = { ordinaryWrite: false, cardNeutralWrite: false, view: { revision: undefined }, finishes: new Map() };
        runs.set(tx, run);
        try {
          const value = await work(tx);
          if (run.cardNeutralWrite) {
            await port(tx, owner, { write: true }, db => advanceCardNeutralEpoch(db, ownerKey(owner), CARD_NEUTRAL_WRITES));
          }
          const revision = run.view.revision;
          const earlier = [...run.finishes.values()].filter(finish => finish.revision !== revision);
          if (earlier.length) {
            await port(tx, owner, { write: true }, db => {
              const update = db.prepare(`UPDATE cairn_capture_outbox SET result = json_set(result, '$.indexRevision', ?)
                WHERE owner_id = ? AND client_key = ? AND event_key = ?`);
              for (const finish of earlier) update.run(revision ?? null, ...finish.identity);
            }).catch(() => {
              // The write guard records the first failure and rolls the run back.
            });
          }
          return value;
        } finally {
          runs.delete(tx);
        }
      });
    },

    /** Ordinary index mutations share one advance per unit of work.
     * @param {Connection} db @param {Tx} tx @param {boolean} [cardNeutral]
     */
    markDirty(db, tx, cardNeutral = false) {
      const run = indexRun(tx);
      if (!run.ordinaryWrite) {
        advance(db, tx, run);
        run.ordinaryWrite = true;
        run.cardNeutralWrite = cardNeutral;
      } else if (!cardNeutral) {
        run.cardNeutralWrite = false;
      }
    },

    /** Each changing Raw or document-card operation advances the owner revision.
     * @param {Connection} db @param {Tx} tx
     */
    advanceDerived(db, tx) {
      advance(db, tx, indexRun(tx));
    },

    /** @param {Connection} db @param {Tx} tx */
    start(db, tx) {
      return startRevision(db, tx, indexRun(tx));
    },

    /** @param {Tx} tx */
    indexRevision(tx) {
      return port(tx, tx?.owner, {}, db => startRevision(db, tx, indexRun(tx)));
    },

    current,

    /** @param {Tx} tx */
    committedIndexRevision(tx) {
      return port(tx, tx?.owner, {}, db => current(db, tx));
    },

    /** @param {Connection} db @param {Tx} tx @param {Identity} identity @param {boolean} changed */
    finish(db, tx, identity, changed) {
      const run = indexRun(tx);
      const revision = changed ? advance(db, tx, run) : run.view.revision ?? startRevision(db, tx, run);
      run.view.revision = revision;
      run.finishes.set(JSON.stringify(identity), { identity, revision });
      return revision;
    },

    /** The caller owns its result. Finishes in the same run report the revision
     * that the run commits, including any later writes.
     * @param {Tx} tx @param {Identity} identity @param {FinishResult} result
     * @returns {FinishResult}
     */
    project(tx, identity, result) {
      const run = indexRun(tx);
      if (!run.finishes.has(JSON.stringify(identity))) return result;
      const { view } = run;
      let overridden = false;
      const { indexRevision: initial, ...fields } = result;
      let callerRevision = initial;
      return {
        ...fields,
        get indexRevision() { return overridden ? callerRevision : view.revision ?? initial; },
        set indexRevision(value) { callerRevision = value; overridden = true; },
      };
    },
  };
}
