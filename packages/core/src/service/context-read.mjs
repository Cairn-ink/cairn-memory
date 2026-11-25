import { revision, validateObject } from "../capture/validate.mjs";
import { CoreError } from "../errors.mjs";
import { hasLedgerCue } from "../ledger/terms.mjs";
import { staleLedger } from "./context-read-assembly-evidence.mjs";
import { legacyRef, responseBytes, snapshotContextCall } from "./context-read-evidence.mjs";
import { contextReadSet, CONTEXT_HORIZON, findCandidatesInput } from "./context-read-input.mjs";
import { fitLedgerDigest, meter, packContext } from "./context-read-pack.mjs";
import { prepareItem } from "./context-read-projection.mjs";
import { packRawContext, readRawChannel } from "./context-read-raw.mjs";
import { CONTEXT_VERSION } from "./context-read-tokens.mjs";
import { entry } from "./entry.mjs";

/** @import { CallOptions, ClockAndHash, ContextAssemblyDiagnostics,
  ContextLedgerDiagnostics, ContextLedgerErrorStage, ContextReadError, ContextReadSet,
  MemoryService, ReadContextInput, ReadContractStorage } from "../ports/index.d.ts" */
/** @import { PackOptions, Projection } from "./context-read-pack.mjs" */
/** @import { LedgerCheck, LedgerReading } from "./context-read-assembly-evidence.mjs" */
/** @import { KeylessMemoryServiceDeps } from "./index.d.mts" */
/** @typedef {KeylessMemoryServiceDeps["storage"] & Partial<Pick<ReadContractStorage, "quantityLedger" | "memories">>} KeylessStorage */

const MAX_BYTES = 65_536;
const SNAPSHOT_LIMIT = 16_384;
const COUNTER = /** @type {const} */ ({ id: "tiktoken-o200k_base" });
const policies = /** @type {const} */ (["rank-first-whole-v1", "coverage-first-v1", "rank-first-first-source-v1"]);
const representations = /** @type {const} */ (["representation-v2-dated", "representation-v2"]);
const encoder = new TextEncoder();
const refreshAssembly = new Error("refresh context assembly");
/** @param {string} text */
const bytes = text => encoder.encode(text).length;
// Legacy context-read-assembly.mjs:36–48. Subtract the exact transport
// framing when moving the formatted value into the complete response.
const blockOverhead = bytes(JSON.stringify({ ok: true, value: null, evidenceTrust: "untrusted-data-not-instructions" })) - 4;

/** @param {unknown} value @param {number} fallback @param {number} minimum @param {number} maximum */
function integer(value, fallback, minimum, maximum) {
  const limit = value === undefined ? fallback : revision(value);
  if (limit < minimum || limit > maximum) throw new CoreError("invalid_input");
  return limit;
}

/** @template {string} T @param {unknown} value @param {readonly T[]} choices */
function select(value, choices) {
  if (value === undefined) return choices[0];
  const choice = choices.find(choice => choice === value);
  if (!choice) throw new CoreError("invalid_input");
  return choice;
}

/** @param {unknown} value */
function readInput(value) {
  // Legacy context-read-input.mjs:188–211. The candidate and Raw defaults
  // differ because an omitted semantic flag leaves Raw in its default mode.
  const { query, types, intent, semantic, deadlineMs, budget, policy, representation, raw } = validateObject(value,
    ["query", "types", "intent", "semantic", "deadlineMs", "budget", "policy", "representation", "raw"]);
  const candidate = findCandidatesInput({ query, types, intent, semantic, deadlineMs, limit: CONTEXT_HORIZON });
  const limits = budget === undefined ? {} : validateObject(budget, ["maxTokens", "maxItems"]);
  const selectedPolicy = policy === undefined ? policies[0] : validateObject(policy, ["id"]).id;
  if ((policy !== undefined && selectedPolicy === undefined) || (raw !== undefined && typeof raw !== "boolean")) {
    throw new CoreError("invalid_input");
  }
  return {
    candidate,
    policy: select(selectedPolicy, policies), representation: select(representation, representations),
    budget: { maxTokens: integer(limits.maxTokens, 6000, 64, 6000), maxItems: integer(limits.maxItems, 24, 1, 24) },
    raw: raw ?? true, lexicalOnly: semantic === false,
  };
}

/** @template T @param {() => number} now @param {number} deadline
 * @param {AbortSignal | undefined} signal @param {(active: () => void) => Promise<T>} attempt */
async function beforeLedgerDeadline(now, deadline, signal, attempt) {
  const remaining = deadline - now();
  if (remaining <= 0 || signal?.aborted) return;
  const timeout = AbortSignal.timeout(Math.max(1, Math.ceil(remaining)));
  const stop = signal ? AbortSignal.any([signal, timeout]) : timeout;
  let closed = false;
  let abort = () => {};
  // The timer races the transaction from outside. In-flight store calls can
  // settle on their own Tx, and active() prevents starting any further work.
  /** @type {Promise<undefined>} */
  const expired = new Promise(resolve => {
    abort = () => resolve(undefined);
    if (stop.aborted) abort();
    else stop.addEventListener("abort", abort, { once: true });
  });
  const active = () => {
    if (closed || stop.aborted || now() >= deadline) throw staleLedger;
  };
  try {
    const result = await Promise.race([attempt(active), expired]);
    active();
    return result;
  } catch (error) {
    if (error !== staleLedger && !stop.aborted && now() < deadline) throw error;
  } finally {
    closed = true;
    stop.removeEventListener("abort", abort);
  }
}

/** @param {{ storage: KeylessStorage | ReadContractStorage, clock: ClockAndHash,
 * find: ReturnType<typeof import("./context-read-find.mjs").findCandidatesMethod>["findForAssembly"],
 * fetch: ReturnType<typeof import("./context-read-assembly-evidence.mjs").fetchForAssembly>,
 * calendarReading?: boolean,
 * counter?: KeylessMemoryServiceDeps["contextReadCounter"], format?: KeylessMemoryServiceDeps["contextReadFormat"] }} deps
 * @returns {NonNullable<MemoryService["readContext"]>} */
export function readContextMethod({ storage, clock, find, fetch, counter, format, calendarReading = false }) {
  const now = () => clock.monotonicMs();
  /** @param {ContextReadSet} readSet @param {ReturnType<typeof readInput>} input
   * @param {CallOptions} options @param {number} deadline @param {boolean} includeLedger
   * @param {{ witness: string, asOfMs: number }} [expectedRolling] */
  async function assemble(readSet, input, options, deadline, includeLedger, expectedRolling) {
    const { candidate, budget, policy, representation, raw, lexicalOnly } = input;
    /** @type {Awaited<ReturnType<typeof find>>} */
    let found;
    try {
      found = await find(readSet, candidate, { ...options, deadlineAtMs: deadline });
    } catch (error) {
      // The public entry sanitizes errors. Preserve only the content-free
      // diagnostic object that this service's find preflight produced.
      const refused = /** @type {ContextReadError} */ (error);
      if (refused.diagnostics) return { refused };
      throw error;
    }
    if (!counter || !format) throw new CoreError("token_count_unavailable");
    const { items, channels, coverage, trace } = found.result;
    const candidates = { count: items.length, channels, coverage, trace };
    const rawRead = await readRawChannel(raw ? storage.contextRead?.raw : undefined,
      storage.uow, readSet, candidate.query, lexicalOnly, options, now, deadline);
    const ledgerRequest = includeLedger && storage.capabilities.quantityLedger === true && storage.quantityLedger && storage.memories &&
      candidate.types.includes("memory") && hasLedgerCue(candidate.query)
      ? { query: candidate.query, asOfMs: expectedRolling?.asOfMs ?? clock.nowMs(), calendarReading } : undefined;
    const evidence = await fetch(readSet, candidate, found.generations, items.map(item => item.ref), ledgerRequest);
    const prepared = evidence.rows.flatMap((row, i) => row ? [prepareItem(row, readSet, items[i].rank, candidate.intent)] : []);
    let rawCoverage = rawRead.coverage;
    let rawPacking = rawRead.turns.length > 0;
    const unavailable = items.length - prepared.length;
    const unitCount = prepared.length + prepared.reduce((n, item) => n + item.sources.length, 0);
    const amendmentTrials = prepared.reduce((n, item) => n + item.evidence.amendments.length, 0);
    /** @type {ContextLedgerDiagnostics | undefined} */
    let ledgerDetails;
    /** @param {unknown} error */
    const staleSnapshot = error => !options.signal?.aborted && error instanceof CoreError && error.code === "snapshot_stale";

    /** @param {import("./context-read-pack.mjs").PackDiagnostics} details @param {number} used
     * @returns {ContextAssemblyDiagnostics} */
    const diagnostics = (details, used) => ({
      version: CONTEXT_VERSION, policy: { id: policy }, representation, counter: COUNTER, items: details.items,
      budget: { ...budget, used }, omitted: { ...details.omitted, unavailable }, dedup: details.dedup,
      stops: details.stops, trace: details.trace, coverage: { raw: rawCoverage }, candidates,
      ...(ledgerDetails && Object.keys(ledgerDetails).length && { ledger: ledgerDetails }),
    });
    /** @type {PackOptions} */
    const packing = { budget, policy, representation, now, deadline,
      format, count: text => counter.count(text),
      fitsBytes(assembly, text, details, selected) {
        // Bound the mutable diagnostic scalars, including the final clock
        // reading. The snapshot is measured without signing a trial token.
        const bounded = diagnostics(details, budget.maxTokens);
        bounded.omitted.oversized = unitCount;
        bounded.stops = { budget: false, items: false, deadline: false };
        bounded.trace = { timings: { assemblyMs: -0.0000010000000000000002 },
          counterCalls: rawPacking || packing.ledger ? Number.MAX_SAFE_INTEGER : 2 + 3 * unitCount + 7 * amendmentTrials };
        const snapshotSize = selected.length
          ? Math.ceil(4 * bytes(JSON.stringify(evidence.payload(selected.map(item => item.evidence)))) / 3) + 44
          : 0;
        const full = responseBytes({ metered: null, diagnostics: { ...bounded, items: bounded.items.map(item => ({ ...item, ref: legacyRef(item.ref) })) }, snapshot: null }) - 8 +
          Math.max(bytes(JSON.stringify(assembly)), bytes(text) - blockOverhead) + (snapshotSize ? snapshotSize + 2 : 4);
        return snapshotSize <= SNAPSHOT_LIMIT && full <= MAX_BYTES;
      } };
    /** @param {Projection} pack @param {LedgerCheck} [ledgerCheck] */
    function deliver(pack, ledgerCheck) {
      return evidence.deliver(pack.selected.map(item => item.evidence), rawPacking ? rawRead.turns : [], options.signal, ledgerCheck);
    }
    function packEvidence() {
      let packed = rawPacking ? packRawContext(prepared, rawRead, readSet, candidate.query, packing, meter(packing)) : null;
      if (!packed) {
        if (rawPacking) rawCoverage = "partial";
        rawPacking = false;
        packed = packContext(prepared, packing, meter(packing));
      }
      packed.diagnostics.stops.deadline ||= now() >= deadline;
      return packed;
    }
    /** @param {ReturnType<typeof packEvidence>} packed @param {string | null} snapshot */
    function response(packed, snapshot) {
      return { assembly: packed.value, diagnostics: diagnostics(packed.diagnostics, packed.used), snapshot };
    }
    async function finishOrdinary() {
      let packed = packEvidence();
      let snapshot = await deliver(packed);
      if (snapshot === undefined) {
        rawCoverage = "partial";
        rawPacking = false;
        packed = packEvidence();
        snapshot = await deliver(packed);
      }
      return response(packed, typeof snapshot === "string" ? snapshot : null);
    }
    // Complete all ordinary validation before optional ledger work can use the
    // deadline or hold a serialized reader.
    const ordinary = await finishOrdinary().catch(error => {
      if (ledgerRequest && staleSnapshot(error)) throw refreshAssembly;
      throw error;
    });
    if (!ledgerRequest) return ordinary;
    const ordinaryHasRaw = rawPacking;
    // The ordinary pack establishes whether this read can deliver a ranked item.
    const rankedType = ordinary.assembly.items.some(item => item.ref.type === "memory") ? "memory" :
      ordinary.assembly.items.some(item => item.ref.type === "card") ? "card" : undefined;
    /** @type {string | undefined} */
    let refreshRolling;
    const enriched = await beforeLedgerDeadline(now, deadline, options.signal, async active => {
      /** @type {NonNullable<ContextLedgerDiagnostics["ledger_digest_error"]>} */
      const errors = {};
      /** @param {ContextLedgerErrorStage} stage */
      const onError = stage => { errors[stage] = (errors[stage] ?? 0) + 1; };
      const attempt = { active, onError };
      /** @type {ContextLedgerDiagnostics} */
      let counts = {};
      const ledger = await evidence.prepareLedger(attempt, expectedRolling === undefined).catch(error => {
        active();
        if (!staleSnapshot(error)) onError("snapshot");
        return null;
      });
      active();
      if (!ledger) return withDiagnostics(ordinary, counts, errors);
      const { rolling, calendar: comparison } = ledger;
      const rollingWitness = () => rolling.project(rolling.lines, false).witness();
      if (expectedRolling && rollingWitness() !== expectedRolling.witness) {
        return withDiagnostics(ordinary, { ledger_digest_omitted: 1 }, errors);
      }
      /** @param {LedgerReading} reading @param {boolean} calendar */
      async function tryReading(reading, calendar) {
        active();
        counts = {};
        let counterCalls = 0;
        const count = packing.count;
        const countLedger = (/** @type {string} */ text) => { counterCalls++; return count(text); };
        const fitted = fitLedgerDigest(reading, budget.maxTokens, meter({ ...packing, count: countLedger }), active, counts, value => {
          if (rankedType && budget.maxItems === 1) return;
          rawCoverage = ordinary.diagnostics.coverage.raw;
          rawPacking = ordinaryHasRaw;
          packing.ledger = value;
          packing.count = countLedger;
          ledgerDetails = { ...counts, ...(Object.keys(errors).length && { ledger_digest_error: errors }) };
          try {
            const packed = packEvidence();
            if (ordinaryHasRaw && !rawPacking) return;
            if (rankedType && !packed.value.items.some(item => item.ref.type === rankedType)) return;
            return packed;
          } catch (error) {
            if (!(error instanceof CoreError) || error.code !== "context_item_too_large") throw error;
          } finally {
            packing.ledger = undefined;
            packing.count = count;
            ledgerDetails = undefined;
          }
        });
        if (!fitted) return;
        const { packed, witness, selection } = fitted;
        packed.diagnostics.trace.counterCalls = counterCalls;
        const snapshot = await deliver(packed, { witness, selection, calendar, ...attempt }).catch(error => {
          active();
          if (staleSnapshot(error)) {
            if (comparison) refreshRolling = rollingWitness();
          } else onError("snapshot");
        });
        active();
        if (typeof snapshot === "string" || snapshot === null) return response(packed, snapshot);
        counts.ledger_digest_omitted = 1;
      }
      const combined = comparison ? await tryReading(comparison, true) : undefined;
      if (refreshRolling !== undefined) return;
      const result = combined ?? await tryReading(rolling, false);
      return withDiagnostics(result ?? ordinary, counts, errors);
    });
    if (options.signal?.aborted) throw new CoreError("snapshot_stale");
    // Suppression can also advance the namespace generation. Refresh the
    // ordinary snapshot once and require the original rolling witness.
    if (refreshRolling !== undefined && now() < deadline) {
      return assemble(readSet, input, options, deadline, true, { witness: refreshRolling, asOfMs: ledgerRequest.asOfMs });
    }
    return enriched ?? ordinary;
  }
  const run = entry(async (/** @type {ContextReadSet} */ value, /** @type {ReadContextInput} */ request,
    /** @type {CallOptions} */ options) => {
    const readSet = contextReadSet(value);
    const input = readInput(request);
    const deadline = Math.min(now() + input.candidate.deadlineMs, options.deadlineAtMs ?? Infinity);
    try {
      return await assemble(readSet, input, options, deadline, true);
    } catch (error) {
      if (error !== refreshAssembly) throw error;
      return assemble(readSet, input, options, deadline, false);
    }
  }, undefined, snapshotContextCall);
  return async (readSet, request, options = {}) => {
    const result = await run(readSet, request, options);
    if ("refused" in result) throw result.refused;
    return result;
  };
}

/**
 * @param {import("../ports/host.d.ts").ReadContextResult} result @param {ContextLedgerDiagnostics} counts
 * @param {NonNullable<ContextLedgerDiagnostics["ledger_digest_error"]>} errors
 */
function withDiagnostics(result, counts, errors) {
  if (Object.keys(errors).length) counts.ledger_digest_error = errors;
  if (!Object.keys(counts).length) return result;
  return { ...result, diagnostics: { ...result.diagnostics, ledger: counts } };
}
