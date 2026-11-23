import { CoreError, compareUtf8, toCoreError } from "@cairn-ink/core";
import { createFactStore } from "./privacy.mjs";

/** @typedef {import("@cairn-ink/core").ErrorCode} ErrorCode */
/** @typedef {import("@cairn-ink/core/ports").Tx} Tx */
/** @typedef {import("@cairn-ink/core/ports").Scope} Scope */
/** @typedef {import("@cairn-ink/core/ports").Namespace} Namespace */
/** @typedef {import("@cairn-ink/core/ports").MemoryRow & {embedding: {model: string, vector: number[]} | null, historical: boolean}} Row */
/** @typedef {{row: Row, receipts: import("@cairn-ink/core/ports").Receipt[]}} Entry */
/** @typedef {import("@cairn-ink/core").StoredFact} StoredFact */
/** @typedef {import("@cairn-ink/core/ports").PauseState} PauseState */
/** @typedef {{rows: Map<Namespace, Map<string, Entry>>, facts: Map<string, StoredFact>, epoch: bigint | null, pause: PauseState, indexRevision: number}} State */
/** @typedef {{state: State, run: {readonly ended: boolean}, dirty: boolean, pauseLock: boolean, writeError?: CoreError}} IssuedRun */

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
  committed = {
    rows: new Map(), facts: new Map(), epoch: null, pause: { paused: false, generation: 0 }, indexRevision: 0,
  };
  pause = new Mutex();
  write = new Mutex();
  open = 0;
  /** @type {Promise<void> | undefined} */
  fixtureWrite;
}

/** @param {unknown} value @returns {import("@cairn-ink/conformance/factory").JsonValue} */
function jsonSafe(value) {
  if (typeof value === "bigint") return value.toString();
  if (value === null || typeof value === "boolean" || typeof value === "string") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : String(value);
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (typeof value === "object") {
    return Object.fromEntries(Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => compareUtf8(a, b))
      .map(([key, item]) => [key, jsonSafe(item)]));
  }
  throw new TypeError("Unsupported value in memory snapshot");
}

/** @param {Readonly<Record<string, ErrorCode>>} nativeErrorMap */
export function createUnitOfWork(nativeErrorMap) {
  /** @type {Map<string, Owner>} */
  const owners = new Map();
  /** @type {WeakMap<Tx, IssuedRun>} */
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
      if (current.fixtureWrite) await current.fixtureWrite;
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
        /** @type {IssuedRun} */
        const issuedRun = { run, state, dirty: false, pauseLock };
        issued.set(tx, issuedRun);
        const result = await fn(tx);
        if (issuedRun.writeError) throw issuedRun.writeError;
        if (issuedRun.dirty) {
          state.indexRevision++;
          current.committed = state;
        }
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
   * @param {Tx} tx @param {Pick<Scope, "owner">} scope @param {boolean} write
   * @param {(state: State) => T} body
   * @param {boolean} [pauseLock]
   */
  function port(tx, scope, write, body, pauseLock = false) {
    return accessPort(tx, scope, write, (getState) => body(getState()), pauseLock);
  }

  /**
   * @template T
   * @param {Tx} tx @param {Pick<Scope, "owner">} scope @param {boolean | "conditional"} write
   * @param {(getState: () => State, markDirty: () => void) => T} body
   * @param {boolean} [pauseLock]
   */
  function accessPort(tx, scope, write, body, pauseLock = false) {
    const issuedRun = issued.get(tx);
    let touchedState = false;
    try {
      if (!issuedRun || issuedRun.run.ended || (write && tx.readOnly) || scope?.owner !== tx.owner ||
          (pauseLock && !issuedRun.pauseLock)) {
        throw new CoreError("internal_error");
      }
      const result = body(() => {
        touchedState = true;
        return issuedRun.state;
      }, () => { issuedRun.dirty = true; });
      if (write === true) issuedRun.dirty = true;
      return result;
    } catch (error) {
      const mapped = toCoreError(error, nativeErrorMap);
      if (write && touchedState && issuedRun) issuedRun.writeError ??= mapped;
      throw mapped;
    }
  }

  // Write ports validate arguments before requesting the owner state.
  port.write = accessPort;

  function dump() {
    const snapshot = [...owners]
      .filter(([, { committed }]) => committed.rows.size > 0 || committed.facts.size > 0 || committed.pause.generation > 0)
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
        facts: [...committed.facts.values()],
        pause: committed.pause,
      }));
    return jsonSafe(snapshot);
  }

  /** @param {string} owner @param {(tx: Tx) => Promise<void>} fn */
  async function runSeed(owner, fn) {
    if (owners.get(owner)?.open) throw new CoreError("invalid_input");
    await uow.run(owner, {}, fn);
  }

  /**
   * Unit-of-work tests can start a fixture write and observe it from their next run.
   * @param {string} owner @param {import("@cairn-ink/core").SuppressionFact} fact
   */
  function appendFact(owner, fact) {
    const current = ownerState(owner);
    if (current.open > 0) throw new CoreError("invalid_input");
    const { seedFact } = createFactStore(port, runSeed, {});
    current.fixtureWrite = seedFact(owner, fact).finally(() => { current.fixtureWrite = undefined; });
    return current.fixtureWrite;
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
    current.committed = { ...current.committed, rows, indexRevision: current.committed.indexRevision + 1 };
  }

  return { uow, port, dump, appendFact, runSeed, setWriteTime };
}
