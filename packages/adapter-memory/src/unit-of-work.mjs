import { CoreError, compareUtf8, toCoreError } from "@cairn-ink/core";
import { copyFact } from "./fact-match.mjs";

/** @typedef {import("@cairn-ink/core").ErrorCode} ErrorCode */
/** @typedef {import("@cairn-ink/core/ports").Tx} Tx */
/** @typedef {import("@cairn-ink/core/ports").Scope} Scope */
/** @typedef {import("@cairn-ink/core/ports").Namespace} Namespace */
/** @typedef {import("@cairn-ink/core/ports").MemoryRow & {embedding: {model: string, vector: number[]} | null, historical: boolean}} Row */
/** @typedef {{row: Row, receipts: import("@cairn-ink/core/ports").Receipt[]}} Entry */
/** @typedef {import("@cairn-ink/core").SuppressionFact} SuppressionFact */
/** @typedef {{rows: Map<Namespace, Map<string, Entry>>, facts: SuppressionFact[]}} State */

class Mutex {
  #tail = Promise.resolve();

  async acquire() {
    const previous = this.#tail;
    /** @type {() => void} */
    let release = () => {};
    this.#tail = new Promise((resolve) => { release = resolve; });
    await previous;
    return release;
  }
}

class Owner {
  /** @type {State} */
  committed = { rows: new Map(), facts: [] };
  pause = new Mutex();
  write = new Mutex();
  open = 0;
}

/** @param {unknown} value @returns {unknown} */
function jsonSafe(value) {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => compareUtf8(a, b))
      .map(([key, item]) => [key, jsonSafe(item)]));
  }
  return value;
}

/** @param {Readonly<Record<string, ErrorCode>>} nativeErrorMap */
export function createUnitOfWork(nativeErrorMap) {
  /** @type {Map<string, Owner>} */
  const owners = new Map();
  /** @type {WeakMap<Tx, {state: State, run: {readonly ended: boolean}}>} */
  const issued = new WeakMap();

  /** @param {string} owner */
  function ownerState(owner) {
    let state = owners.get(owner);
    if (!state) owners.set(owner, state = new Owner());
    return state;
  }

  /** @type {import("@cairn-ink/core/ports").UnitOfWork} */
  const uow = {
    async run(owner, options, fn) {
      if (typeof owner !== "string" || !owner || options === null || typeof options !== "object" || typeof fn !== "function") {
        throw new CoreError("invalid_input");
      }
      const readOnly = options.readOnly === true;
      const pauseLock = options.pauseLock === true;
      const current = ownerState(owner);
      current.open++;
      let ended = false;
      /** @type {Tx | undefined} */
      let tx;
      /** @type {(() => void) | undefined} */
      let releasePause;
      /** @type {(() => void) | undefined} */
      let releaseWrite;
      try {
        if (pauseLock) releasePause = await current.pause.acquire();
        if (!readOnly) releaseWrite = await current.write.acquire();

        let state = current.committed;
        if (!readOnly) {
          try {
            state = structuredClone(state);
          } catch (error) {
            throw toCoreError(error, nativeErrorMap);
          }
        }
        const run = Object.freeze({ get ended() { return ended; } });
        tx = Object.freeze({ owner, readOnly, __adapter: run });
        issued.set(tx, { run, state });
        const result = await fn(tx);
        if (!readOnly) current.committed = state;
        return result;
      } finally {
        ended = true;
        if (tx) issued.delete(tx);
        releaseWrite?.();
        releasePause?.();
        current.open--;
      }
    },
  };

  /**
   * @template T
   * @param {Tx} tx @param {Scope} scope @param {boolean} write
   * @param {(state: State) => T} body
   */
  function port(tx, scope, write, body) {
    try {
      const issuedRun = issued.get(tx);
      if (!issuedRun || issuedRun.run.ended || (write && tx.readOnly) || scope?.owner !== tx.owner) {
        throw new CoreError("internal_error");
      }
      return body(issuedRun.state);
    } catch (error) {
      throw toCoreError(error, nativeErrorMap);
    }
  }

  function dump() {
    const snapshot = [...owners]
      .filter(([, { committed }]) => committed.rows.size > 0 || committed.facts.length > 0)
      .sort(([a], [b]) => compareUtf8(a, b))
      .map(([owner, { committed }]) => ({
        owner,
        rows: [...committed.rows.values()].flatMap((namespace) => [...namespace.values()])
          .sort(({ row: a }, { row: b }) => {
            const x = a.scope.namespace;
            const y = b.scope.namespace;
            if (x !== y) return x === null ? -1 : y === null ? 1 : compareUtf8(x, y);
            return compareUtf8(a.id, b.id);
          }),
        facts: committed.facts,
      }));
    return jsonSafe(snapshot);
  }

  /** @param {string} owner @param {SuppressionFact} fact */
  function appendFact(owner, fact) {
    const current = ownerState(owner);
    if (current.open > 0) throw new CoreError("invalid_input");
    current.committed = {
      rows: current.committed.rows,
      facts: [...current.committed.facts, copyFact(owner, fact)],
    };
  }

  /** @param {Scope} scope @param {string} id @param {bigint} updatedAtUs */
  async function setWriteTime(scope, id, updatedAtUs) {
    const current = owners.get(scope.owner);
    if ((current && current.open > 0) || typeof updatedAtUs !== "bigint" || updatedAtUs < 0n) {
      throw new CoreError("invalid_input");
    }
    const namespace = current?.committed.rows.get(scope.namespace);
    const entry = namespace?.get(id);
    if (!current || !namespace || !entry) throw new CoreError("memory_not_found");

    const rows = new Map(current.committed.rows);
    const updated = new Map(namespace);
    updated.set(id, { ...entry, row: { ...entry.row, updatedAtUs, updatedAtMs: Number(updatedAtUs / 1000n) } });
    rows.set(scope.namespace, updated);
    current.committed = { ...current.committed, rows };
  }

  return { uow, port, dump, appendFact, setWriteTime };
}
