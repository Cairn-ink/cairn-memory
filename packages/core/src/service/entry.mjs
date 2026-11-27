import { detach, identifier, isWellFormedText, validateObject } from "../capture/validate.mjs";
import { CoreError, isErrorCode, toCoreError } from "../errors.mjs";

/** @param {unknown} error */
export function entryError(error) {
  try {
    if (error instanceof CoreError) {
      const code = error.code;
      if (isErrorCode(code)) return new CoreError(code);
    }
  } catch {
    // Prototype inspection and code access can themselves throw.
  }
  return new CoreError("internal_error");
}

/**
 * @template {unknown[]} Args
 * @template Result
 * @template [Invalid=never]
 * @param {(...args: Args) => Promise<Result>} run
 * @param {() => Invalid} [invalid]
 * @param {(args: Args) => Args} [snapshot]
 */
export function entry(run, invalid, snapshot = args => detach(args, "invalid_input")) {
  /** @param {Args} args */
  return async (...args) => {
    try {
      assertOutsideHostWriteHook();
      /** @type {Args} */
      let input;
      try {
        input = snapshot(args);
      } catch (error) {
        if (invalid) return invalid();
        throw error;
      }
      return await run(...input);
    } catch (error) {
      throw entryError(error);
    }
  };
}

/** @param {unknown} value @returns {import("../ports/common.d.ts").Scope} */
export function scopeOf(value) {
  const { owner, namespace } = validateObject(value, ["owner", "namespace"]);
  if (namespace !== null && !isWellFormedText(namespace)) throw new CoreError("invalid_input");
  // Engine namespaces contain a NUL separator, so only the owner is an identifier.
  return { owner: identifier(owner), namespace };
}

export { identifier as ownerOf };

/** @import { HostWriteHooks, HostWriteHookPort, HostHookRun, Scope, Tx, Receipt, HostReceipt, HostAttachment, MemoryRow,
 *   HostAdmissionDecision, SaveRequestDecision } from "../ports/index.d.ts" */
/** @type {Set<HostWriteHookPort["context"]>} */
const hookContexts = new Set();
/** @type {WeakMap<HostWriteHookPort["context"], HostWriteHookPort["context"]>} */
const guardedHookContexts = new WeakMap();

/** @returns {HostHookRun | undefined} */
function currentHookRun() {
  for (const context of hookContexts) {
    const run = context.getStore();
    if (run) return run;
  }
  return undefined;
}
/** @type {WeakSet<object>} */
const hookFailures = new WeakSet();

/** @param {HostWriteHookPort["context"]} context */
function validateHostWriteContext(context) {
  if (typeof context?.getStore !== "function" || typeof context?.run !== "function") {
    throw new CoreError("invalid_input");
  }
}

/** @param {HostWriteHookPort["context"]} context */
export function registerHostWriteContext(context) {
  validateHostWriteContext(context);
  hookContexts.add(context);
}

/** @param {HostWriteHookPort["context"]} context @returns {HostWriteHookPort["context"]} */
export function guardHostWriteContext(context) {
  validateHostWriteContext(context);
  // Ports that share a delegate also share an entry in the context registry.
  const existing = guardedHookContexts.get(context);
  if (existing) return existing;
  const guarded = Object.freeze(/** @type {HostWriteHookPort["context"]} */ ({
    getStore() { return context.getStore(); },
    run(store, fn) {
      if ((store === null || typeof store !== "object") && context.getStore()) {
        throw new CoreError("host_write_hook_failed");
      }
      return context.run(store, fn);
    },
  }));
  guardedHookContexts.set(context, guarded);
  return guarded;
}

export function assertOutsideHostWriteHook() {
  if (currentHookRun()) throw new CoreError("storage_transaction_active");
}

/** @param {unknown} error */
export function isHostWriteHookFailure(error) {
  return typeof error === "object" && error !== null && hookFailures.has(error);
}

/**
 * Port-owned authorization: a port asks only the reader that core registered through
 * `bindHookAuthority`, keyed by the live transaction. Records entered through the async
 * context grant nothing; that context only tells whether code runs inside a hook.
 * @returns {{ bind(reader: (tx: Tx) => HostHookRun | undefined): void, authorize(tx: Tx): HostHookRun | undefined }}
 */
export function createHookAuthorizer() {
  /** @type {((tx: Tx) => HostHookRun | undefined) | undefined} */
  let authorityReader;
  return Object.freeze({
    bind(reader) {
      assertOutsideHostWriteHook();
      if (typeof reader !== "function") throw new CoreError("invalid_input");
      if (authorityReader) throw new CoreError("invalid_input");
      authorityReader = reader;
    },
    authorize(tx) {
      return authorityReader?.(tx);
    },
  });
}

/**
 * @template T
 * @param {(tx: Tx) => HostHookRun | undefined} authorize
 * @param {Tx} tx @param {Scope} scope @param {"read" | "write" | "finalizeSave"} mode
 * @param {(scope: Scope) => Promise<T>} start
 */
export function hostOperation(authorize, tx, scope, mode, start) {
  const run = typeof authorize === "function" ? authorize(tx) : undefined;
  if (!run) {
    const denied = Promise.reject(new CoreError("host_write_hook_failed"));
    void denied.catch(() => {});
    return denied;
  }
  return run.track(() => {
    if (run.tx !== tx || tx.readOnly || scope?.owner !== run.scope.owner ||
        scope.namespace !== run.scope.namespace ||
        (mode !== "read" && (run.phase === "beforeSave" || run.phase === "beforeCorrect")) ||
        (mode === "finalizeSave" && !run.keyedSave)) {
      throw new CoreError("host_write_hook_failed");
    }
    return start(run.scope);
  });
}

/** @template T @param {T} value @returns {T} */
function freeze(value) {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

/** @param {unknown} value */
export function hostRequestOf(value) {
  if (value === undefined) return null;
  const { key, fingerprint } = validateObject(value, ["key", "fingerprint"]);
  if (typeof key !== "string" || !key || typeof fingerprint !== "string" || !fingerprint) {
    throw new CoreError("invalid_input");
  }
  return { key, fingerprint };
}

/** @param {unknown} decision @param {boolean} keyed @returns {SaveRequestDecision} */
export function saveRequestDecision(decision, keyed) {
  const value = validateObject(decision, ["status", "result"]);
  if (value.status === "proceed" || value.status === "refuse" || (keyed && value.status === "conflict")) {
    validateObject(decision, ["status"]);
    return { status: value.status };
  }
  if (keyed && value.status === "replay") {
    const { status, memory, indexRevision } = validateObject(value.result, ["status", "memory", "indexRevision"]);
    const { id, revision } = validateObject(memory, ["id", "revision"]);
    if ((status === "saved" || status === "duplicate") && typeof revision === "number" &&
        Number.isSafeInteger(revision) && revision >= 0 && typeof indexRevision === "number" &&
        Number.isSafeInteger(indexRevision) && indexRevision >= 0) {
      return { status: "replay", result: { status, memory: { id: identifier(id), revision }, indexRevision } };
    }
  }
  throw new CoreError("host_write_hook_failed");
}

/** @param {unknown} decision @returns {HostAdmissionDecision} */
export function correctRequestDecision(decision) {
  const { status } = validateObject(decision, ["status"]);
  if (status === "proceed" || status === "refuse") return { status };
  throw new CoreError("host_write_hook_failed");
}

/** @param {unknown} value */
export function writeHookResult(value) {
  if (value !== undefined) throw new CoreError("host_write_hook_failed");
}

/** @param {HostWriteHooks | undefined} input @param {HostWriteHookPort | undefined} port */
export function bindHostWriteHooks(input, port) {
  if (input === undefined) return undefined;
  const names = /** @type {const} */ (["beforeSave", "beforeCorrect", "onSave", "onCaptureFinish", "onForget", "onCorrect"]);
  /** @type {HostWriteHooks} */
  let hooks;
  try {
    validateObject(input, names);
    const methods = names.map(name => {
      const fn = input[name];
      if (typeof fn !== "function") throw new CoreError("invalid_input");
      return [name, fn.bind(input)];
    });
    hooks = /** @type {HostWriteHooks} */ (/** @type {unknown} */ (Object.fromEntries(methods)));
  } catch {
    throw new CoreError("invalid_input");
  }
  if (!port) throw new CoreError("capability_unavailable");
  const adapter = port;
  registerHostWriteContext(adapter.context);
  /** @type {WeakMap<Tx, HostHookRun>} */
  const live = new WeakMap();
  try {
    adapter.bindHookAuthority(tx => live.get(tx));
  } catch (error) {
    // The adapter can load a separate copy of core and its error class.
    throw toCoreError(error);
  }

  /**
   * @template {keyof HostWriteHooks} K
   * @template T
   * @param {K} phase @param {Tx} tx @param {Parameters<HostWriteHooks[K]>[1]} ctx
   * @param {(value: unknown) => T} validate
   * @returns {Promise<T>}
   */
  async function invoke(phase, tx, ctx, validate) {
    const context = freeze(structuredClone(ctx));
    let active = true;
    /** @type {Set<Promise<unknown>>} */
    const pending = new Set();
    /** @type {HostHookRun} */
    const run = Object.freeze({
      tx, scope: context.scope, phase,
      keyedSave: phase === "onSave" && "request" in context && context.request !== null,
      /** @template U @param {() => Promise<U>} start */
      track(start) {
        const operation = Promise.resolve().then(() => {
          if (!active) throw new CoreError("host_write_hook_failed");
          return start();
        });
        pending.add(operation);
        const remove = () => pending.delete(operation);
        void operation.then(remove, remove);
        return operation;
      },
    });
    let failed = false;
    let result;
    live.set(tx, run);
    try {
      const callback = /** @type {(tx: Tx, ctx: typeof context) => Promise<unknown>} */ (hooks[phase]);
      result = await adapter.context.run(run, async () => {
        const decision = await callback(tx, context);
        active = false;
        if (pending.size) throw new CoreError("host_write_hook_failed");
        return validate(structuredClone(decision));
      });
    } catch {
      failed = true;
    } finally {
      active = false;
      if (pending.size) await Promise.allSettled(pending);
      if (live.get(tx) === run) live.delete(tx);
    }
    const native = adapter.statementFailure(tx);
    if (native || failed) {
      const error = native ?? new CoreError("host_write_hook_failed");
      hookFailures.add(error);
      throw error;
    }
    return /** @type {T} */ (result);
  }
  return { port: adapter, invoke };
}

/** @param {MemoryRow} row */
export function predecessorOf({ id, revision, source, createdAtMs }) {
  return { id, revision, source: { kind: source.kind, client: source.client, sessionId: source.sessionId }, createdAtMs };
}

/** @param {Receipt} receipt @returns {HostReceipt} */
export function hostReceipt({ client, sessionId, messageId, role, occurredAtMs, id }) {
  return { client, sessionId, messageId, role, occurredAtMs, receiptId: id ?? null };
}

/** @param {readonly HostReceipt[]} before @param {readonly HostReceipt[]} after
 * @param {readonly Receipt[]} incoming @returns {HostAttachment[]} */
export function hostAttachments(before, after, incoming) {
  /** @param {Pick<Receipt, "client" | "sessionId" | "messageId">} receipt */
  const key = ({ client, sessionId, messageId }) => JSON.stringify([client, sessionId, messageId]);
  const previous = new Set(before.map(key));
  const stored = new Map(after.map(receipt => [key(receipt), receipt]));
  return incoming.flatMap(receipt => {
    const address = key(receipt);
    const active = stored.get(address);
    if (!active) return [];
    const outcome = previous.has(address) ? "existing" : "inserted";
    previous.add(address);
    return [{ ...active, outcome }];
  });
}

/** @typedef {import("./index.d.mts").MemoryServiceDeps & { hooks?: ReturnType<typeof bindHostWriteHooks> }} HookedDeps */

/** @param {import("../suppression-fact.mjs").SuppressionFact["kind"]} kind
 * @param {Omit<import("../ports/index.d.ts").HostFactRef, "kind">} written */
export function factReference(kind, { factId, epoch, createdAtMs }) {
  return { kind, factId, epoch, createdAtMs };
}

/** @param {import("../suppression-fact.mjs").RawSpanFact} span */
export function spanReference({ sessionKeyHash, messageKey, startUtf16, endUtf16 }) {
  return { sessionKeyHash, messageKey, start: startUtf16, end: endUtf16 };
}
