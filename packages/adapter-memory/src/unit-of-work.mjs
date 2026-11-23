import { coreDigest, CoreError, compareUtf8, isErrorCode, toCoreError } from "@cairn-ink/core";
import { addKeyedDigest, createFactStore } from "./privacy.mjs";

/** @typedef {import("@cairn-ink/core").ErrorCode} ErrorCode */
/** @typedef {import("@cairn-ink/core/ports").Tx} Tx */
/** @typedef {import("@cairn-ink/core/ports").Scope} Scope */
/** @typedef {import("@cairn-ink/core/ports").Namespace} Namespace */
/** @typedef {import("@cairn-ink/core/ports").MemoryRow & {
 *   embedding: {model: string, vector: number[]} | null, historical: boolean, legacyHash?: string,
 *   digests: import("@cairn-ink/core").TextDigest[]
 * }} Row */
/** @typedef {{row: Row, receipts: import("@cairn-ink/core/ports").Receipt[]}} Entry */
/** @typedef {import("@cairn-ink/core/ports").FingerprintKeyProvider["userKey"]} UserKey */
/** @typedef {import("@cairn-ink/core").StoredFact} StoredFact */
/** @typedef {import("@cairn-ink/core/ports").PauseState} PauseState */
/** @typedef {import("./capture.mjs").ClaimRecord} ClaimRecord */
/** @typedef {import("@cairn-ink/core/ports").FinishResult} FinishResult */
/** @typedef {import("./topics.mjs").TopicState} TopicState */
/** @typedef {{text: string, role: import("@cairn-ink/core/ports").Role, occurredAtMs: number | null}} RationaleMessage */
/** @typedef {import("./memory-relations.mjs").RelationState} RelationState */
/** @typedef {{topics: Map<Namespace, TopicState>, rows: Map<Namespace, Map<string, Entry>>, facts: Map<string, StoredFact>, epoch: bigint | null, pause: PauseState, indexRevision: number,
 * rationale: Map<Namespace, Map<string, import("@cairn-ink/core/ports").RationaleEdge>>,
 * rationaleMessages: Map<Namespace, Map<string, RationaleMessage>>,
 * rawRows: Map<string, import("./raw.mjs").RawEntry>, rawFences: Set<string>, rawConflicts: Set<string>,
 * claims: Map<string, ClaimRecord>, activeTokens: Map<string, string>, abandonedTokens: Set<string>, relations: Map<Namespace, RelationState>}} State */
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

/** @param {Row} row */
export function copyPublicRow({ digests: _digests, ...row }) {
  return structuredClone(row);
}

/**
 * Handle the promise exposed by each queued write, including async wrappers around the queue.
 * The caller still observes the rejection and the run retains the first state-level error.
 * @template {PropertyKey} K
 * @template {Record<K, (...args: any[]) => Promise<unknown>>} P
 * @param {P} ports @param {readonly K[]} names
 */
export function handleWriteRejections(ports, names) {
  for (const name of names) {
    const write = ports[name];
    ports[name] = /** @type {P[K]} */ ((/** @type {any[]} */ ...args) => {
      const pending = write.apply(ports, args);
      void pending.catch(() => {});
      return pending;
    });
  }
  return ports;
}

class Mutex {
  #tail = Promise.resolve();
  #locked = false;

  get locked() { return this.#locked; }

  async acquire() {
    const previous = this.#tail;
    /** @type {() => void} */
    let release = () => {};
    this.#tail = new Promise((resolve) => { release = resolve; });
    await previous;
    this.#locked = true;
    return () => {
      this.#locked = false;
      release();
    };
  }
}

class Owner {
  /** @type {State} */
  committed = {
    topics: new Map(), rows: new Map(), facts: new Map(), epoch: null, pause: { paused: false, generation: 0 }, indexRevision: 0,
    claims: new Map(), activeTokens: new Map(), abandonedTokens: new Set(),
    rawRows: new Map(), rawFences: new Set(), rawConflicts: new Set(),
    relations: new Map(), rationale: new Map(), rationaleMessages: new Map(),
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

/** @param {Readonly<Record<string, ErrorCode>>} nativeErrorMap @param {() => number} [now] @param {boolean} [includeTopics] */
export function createUnitOfWork(nativeErrorMap, now = Date.now, includeTopics = false) {
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
        // A write callback can submit another write before the run callback returns.
        while (issuedRun.writeTail) await issuedRun.writeTail;
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
    if (write) return writePort(tx, scope, true, () => (getState) => body(getState()), pauseLock);
    return readPort(tx, scope, (getState) => body(getState()), pauseLock);
  }

  /** @template T
   * @param {Tx} tx @param {Pick<Scope, "owner">} scope
   * @param {(getState: () => State) => T} body @param {boolean} [pauseLock]
   */
  function readPort(tx, scope, body, pauseLock = false) {
    return accessPort(tx, scope, false, body, pauseLock);
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
   * @param {() => (getState: () => State, markDirty: () => void, run: IssuedRun) => T} prepare
   * @param {boolean} [pauseLock]
   */
  async function writePort(tx, scope, write, prepare, pauseLock = false) {
    const run = issued.get(tx);
    if (!run) throw new CoreError("internal_error");

    // Reserve the slot before preparation or execution can call back into another port.
    const previous = run.writeTail;
    /** @type {() => void} */
    let release = () => {};
    const complete = new Promise((resolve) => { release = () => resolve(undefined); });
    // Failed preparation can release its slot early. Later writes still wait for its predecessor.
    const tail = previous ? previous.then(() => complete) : complete;
    run.writeTail = tail;
    void tail.then(() => {
      if (run.writeTail === tail) run.writeTail = undefined;
    });
    try {
      return await accessPort(tx, scope, write, (getState, markDirty, run) => {
        const body = prepare();
        const execute = () => {
          if (run.run.ended) throw new CoreError("internal_error");
          const result = body(getState, markDirty, run);
          if (write === true) markDirty();
          return result;
        };
        return previous ? previous.then(execute) : execute();
      }, pauseLock);
    } finally {
      release();
    }
  }

  // Ports can validate arguments after the transaction guard and before requesting owner state.
  port.read = readPort;
  port.write = writePort;

  /**
   * Memory operations invoked by the finish that already holds the queue.
   * @template T
   * @param {Tx} tx @param {Pick<Scope, "owner">} scope
   * @param {() => (getState: () => State, markDirty: () => void) => T} prepare
   */
  port.writeFromFinish = (tx, scope, prepare) =>
    accessPort(tx, scope, "conditional", (getState) => prepare()(getState, () => {}));

  /**
   * @template T
   * @param {Tx} tx @param {Pick<Scope, "owner">} scope
   * @param {() => (getState: () => State, run: IssuedRun) => T} prepare
   */
  port.capture = (tx, scope, prepare) => writePort(tx, scope, "conditional", () => {
    const body = prepare();
    return (getState, _markDirty, run) => body(getState, run);
  }, true);

  function dump(includeRaw = false) {
    const snapshot = [...owners]
      .filter(([, { committed }]) => committed.rows.size > 0 || committed.facts.size > 0 ||
        committed.pause.generation > 0 || committed.claims.size > 0 ||
        (includeTopics && (committed.topics.size > 0 || committed.indexRevision > 0)) ||
        (includeRaw && (committed.rawRows.size > 0 || committed.rawFences.size > 0 || committed.indexRevision > 0)))
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
        ...(includeRaw && {
          rawRows: [...committed.rawRows.values()].sort((a, b) => compareUtf8(a.ref.id, b.ref.id)),
          rawFences: [...committed.rawFences].sort(compareUtf8),
        }),
        ...((includeRaw || includeTopics) && { indexRevision: committed.indexRevision }),
        ...(includeTopics && {
          topics: [...committed.topics].map(([namespace, { topics, outcomes, failures }]) => ({
            namespace,
            topics: [...topics.values()],
            outcomes: [...outcomes].map(([id, { revision, memberships }]) => ({ id, revision, memberships: [...memberships] })),
            failures: [...failures],
          })),
        }),
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
  async function setWriteTime({ owner, namespace }, id, updatedAtUs) {
    const current = owners.get(owner);
    if ((current && current.open > 0) || typeof updatedAtUs !== "bigint" || updatedAtUs < 0n) {
      throw new CoreError("invalid_input");
    }
    if (!current) throw new CoreError("memory_not_found");
    const release = await current.write.acquire();
    try {
      const entries = current.committed.rows.get(namespace);
      const entry = entries?.get(id);
      if (!entries || !entry) throw new CoreError("memory_not_found");

      const rows = new Map(current.committed.rows);
      const updated = new Map(entries);
      updated.set(id, { ...entry, row: { ...entry.row, updatedAtUs, updatedAtMs: Number(updatedAtUs / 1000n) } });
      rows.set(namespace, updated);
      current.committed = { ...current.committed, rows, indexRevision: current.committed.indexRevision + 1 };
    } finally {
      release();
    }
  }

  /** @param {State["rows"]} rows @param {Awaited<ReturnType<UserKey>>} key @returns {Promise<State["rows"]>} */
  async function refreshRows(rows, key) {
    const refreshed = new Map();
    for (const [namespace, entries] of rows) {
      const updated = new Map();
      for (const [id, entry] of entries) {
        const { row } = entry;
        const digests = [...(row.digests ?? [])];
        addKeyedDigest(digests, await coreDigest(row.text, key));
        updated.set(id, { ...entry, row: { ...row, digests } });
      }
      refreshed.set(namespace, updated);
    }
    return refreshed;
  }

  /**
   * @param {UserKey} pendingKey
   * @param {(owner: string) => Promise<Set<string>>} retainedKeyIds
   * @param {() => void} publish
   */
  async function rotateRowDigests(pendingKey, retainedKeyIds, publish) {
    /** @type {Map<Owner, {base: State, rows: State["rows"]}>} */
    const staged = new Map();
    /** @param {Owner} owner */
    const needsRefresh = (owner) => owner.write.locked || staged.get(owner)?.base !== owner.committed;

    do {
      for (const [owner, current] of owners) {
        if (!needsRefresh(current)) continue;
        const release = await current.write.acquire();
        try {
          const base = current.committed;
          if (staged.get(current)?.base === base) continue;
          const keyedFacts = [...base.facts.values()].flatMap(({ fact }) =>
            fact.kind === "text" && fact.text.digests.every(({ alg }) => alg === "hmac") ? fact.text.digests : []);
          if (keyedFacts.length > 0) {
            const olderIds = await retainedKeyIds(owner);
            if (keyedFacts.some(({ keyId }) => keyId !== null && olderIds.has(keyId))) {
              throw new CoreError("fingerprint_key_mismatch");
            }
          }
          const rows = base.rows.size === 0 ? base.rows : await refreshRows(base.rows, await pendingKey(owner));
          staged.set(current, { base, rows });
        } finally {
          release();
        }
      }
      // A writer can commit or start while another owner is being refreshed. Recheck those owners
      // under their locks so their rows and facts are included and an active write cannot replace the refresh.
    } while ([...owners.values()].some(needsRefresh));

    // Publish all validated snapshots and the key in one synchronous step.
    for (const [current, { base, rows }] of staged) {
      if (rows !== base.rows) current.committed = { ...base, rows };
    }
    publish();
  }

  /** @param {string} owner @param {import("./privacy.mjs").RingKeys} ringKeys */
  async function rowsMissingKeyedDigest(owner, ringKeys) {
    const rows = owners.get(owner)?.committed.rows;
    if (!rows) return 0;
    const keys = await ringKeys(owner);
    let count = 0;
    for (const entries of rows.values()) {
      for (const { row: { digests } } of entries.values()) {
        if (keys.some((key) => !digests?.some(({ alg, keyId }) => alg === "hmac" && keyId === key.id))) count++;
      }
    }
    return count;
  }

  return { uow, port, dump, appendFact, runSeed, setWriteTime, rotateRowDigests, rowsMissingKeyedDigest };
}
