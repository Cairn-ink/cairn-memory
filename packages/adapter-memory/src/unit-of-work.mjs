import { CoreError, compareUtf8, isErrorCode, toCoreError } from "@cairn-ink/core";
import { createFactStore } from "./privacy.mjs";

/** @typedef {import("@cairn-ink/core").ErrorCode} ErrorCode */
/** @typedef {import("@cairn-ink/core/ports").Tx} Tx */
/** @typedef {import("@cairn-ink/core/ports").Scope} Scope */
/** @typedef {import("@cairn-ink/core/ports").Namespace} Namespace */
/** @typedef {import("@cairn-ink/core/ports").MemoryRow & {embedding: {model: string, vector: number[]} | null, historical: boolean}} Row */
/** @typedef {{row: Row, receipts: import("@cairn-ink/core/ports").Receipt[]}} Entry */
/** @typedef {import("@cairn-ink/core").StoredFact} StoredFact */
/** @typedef {import("@cairn-ink/core/ports").PauseState} PauseState */
/** @typedef {import("./capture.mjs").ClaimRecord} ClaimRecord */
/** @typedef {import("@cairn-ink/core/ports").FinishResult} FinishResult */
/** @typedef {{rows: Map<Namespace, Map<string, Entry>>, facts: Map<string, StoredFact>, epoch: bigint | null, pause: PauseState, indexRevision: number,
 * claims: Map<string, ClaimRecord>, activeTokens: Map<string, string>, abandonedTokens: Set<string>}} State */
/** @typedef {{state: State, run: {readonly ended: boolean}, indexDirty: boolean, stateWritten: boolean, pauseLock: boolean,
 * poisoned: boolean, writeErrorCode: ErrorCode, finishes: Set<FinishResult>, writingFinishes: number,
 * writeTail?: Promise<void>}} IssuedRun */

/** @param {IssuedRun} run */
export function indexRevisionAfterRun(run) {
  // Ordinary writes share one revision advance. Each finish with writes contributes one.
  const revision = run.state.indexRevision + Number(run.indexDirty) + run.writingFinishes;
  if (!Number.isSafeInteger(revision)) throw new CoreError("internal_error");
  return revision;
}

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
    claims: new Map(), activeTokens: new Map(), abandonedTokens: new Set(),
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

/** @param {Readonly<Record<string, ErrorCode>>} nativeErrorMap @param {() => number} [now] */
export function createUnitOfWork(nativeErrorMap, now = Date.now) {
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
        const issuedRun = {
          run, state, indexDirty: false, stateWritten: false, pauseLock, poisoned: false,
          writeErrorCode: "internal_error", finishes: new Set(), writingFinishes: 0,
        };
        issued.set(tx, issuedRun);
        const result = await fn(tx);
        if (issuedRun.poisoned) throw new CoreError(issuedRun.writeErrorCode);
        if (issuedRun.indexDirty || issuedRun.stateWritten) {
          const revision = indexRevisionAfterRun(issuedRun);
          for (const finish of issuedRun.finishes) {
            // A later port call in the same run may have made the index dirty.
            finish.indexRevision = revision;
          }
          state.indexRevision = revision;
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
    const access = write ? writePort : accessPort;
    return access(tx, scope, write, (getState) => body(getState()), pauseLock);
  }

  /**
   * @template T
   * @param {Tx} tx @param {Pick<Scope, "owner">} scope @param {boolean | "conditional"} write
   * @param {(getState: () => State, markDirty: () => void, run: IssuedRun) => T} body
   * @param {boolean} [pauseLock]
   */
  async function accessPort(tx, scope, write, body, pauseLock = false) {
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
      }, () => { issuedRun.indexDirty = true; }, issuedRun);
      if (write === true) issuedRun.indexDirty = true;
      return await result;
    } catch (error) {
      const firstFailure = write && touchedState && issuedRun && !issuedRun.poisoned;
      // Poison the run even if inspecting the thrown value fails.
      if (firstFailure) issuedRun.poisoned = true;
      const mapped = toCoreError(error, nativeErrorMap);
      if (firstFailure) {
        const code = mapped.code;
        issuedRun.writeErrorCode = isErrorCode(code) ? code : "internal_error";
      }
      throw mapped;
    }
  }

  /**
   * @template T
   * @param {Tx} tx @param {Pick<Scope, "owner">} scope @param {boolean | "conditional"} write
   * @param {(getState: () => State, markDirty: () => void, run: IssuedRun) => T} body
   * @param {boolean} [pauseLock] @param {boolean} [exclusive]
   */
  async function writePort(tx, scope, write, body, pauseLock = false, exclusive = false) {
    const run = issued.get(tx);
    if (!run || (!exclusive && !run.writeTail)) return accessPort(tx, scope, write, body, pauseLock);

    // A finish holds the queue from policy read through claim completion. Ordinary writes
    // still run immediately when there is no finish or queued write ahead of them.
    const previous = run.writeTail;
    /** @type {() => void} */
    let release = () => {};
    /** @type {Promise<void>} */
    const tail = new Promise((resolve) => { release = resolve; });
    run.writeTail = tail;
    try {
      if (previous) await previous;
      return await accessPort(tx, scope, write, body, pauseLock);
    } finally {
      if (run.writeTail === tail) run.writeTail = undefined;
      release();
    }
  }

  // Write ports validate arguments before requesting the owner state.
  port.write = writePort;

  /**
   * Memory operations invoked by the finish that already holds the queue.
   * @template T
   * @param {Tx} tx @param {Pick<Scope, "owner">} scope @param {(getState: () => State) => T} body
   */
  port.writeFromFinish = (tx, scope, body) => accessPort(tx, scope, "conditional", body);

  /**
   * @template T
   * @param {Tx} tx @param {Pick<Scope, "owner">} scope
   * @param {(getState: () => State, run: IssuedRun) => T} body
   * @param {boolean} [exclusive]
   */
  port.capture = (tx, scope, body, exclusive = false) =>
    writePort(tx, scope, "conditional", (getState, _markDirty, run) => body(getState, run), true, exclusive);

  function dump() {
    const snapshot = [...owners]
      .filter(([, { committed }]) => committed.rows.size > 0 || committed.facts.size > 0 ||
        committed.pause.generation > 0 || committed.claims.size > 0)
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
        ...(committed.claims.size ? {
          claims: [...committed.claims.values()],
          abandonedTokens: [...committed.abandonedTokens],
        } : {}),
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
    const { seedFact } = createFactStore(port, runSeed, { now });
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
