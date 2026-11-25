import { revision, validateObject } from "../capture/validate.mjs";
import { CoreError } from "../errors.mjs";
import { staleLedger } from "./context-read-assembly-evidence.mjs";
import { legacyRef, responseBytes, snapshotContextCall } from "./context-read-evidence.mjs";
import { contextReadSet, CONTEXT_HORIZON, findCandidatesInput } from "./context-read-input.mjs";
import { meter, packContext } from "./context-read-pack.mjs";
import { prepareItem } from "./context-read-projection.mjs";
import { packRawContext, readRawChannel } from "./context-read-raw.mjs";
import { CONTEXT_VERSION } from "./context-read-tokens.mjs";
import { entry } from "./entry.mjs";

/** @import { CallOptions, ClockAndHash, ContextAssemblyDiagnostics, ContextRawTurn,
  ContextReadError, ContextReadSet, MemoryService, ReadContextInput, ReadContractStorage } from "../ports/index.d.ts" */
/** @import { PackOptions, Projection } from "./context-read-pack.mjs" */
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

/** @param {{ storage: KeylessStorage | ReadContractStorage, clock: ClockAndHash,
 * find: ReturnType<typeof import("./context-read-find.mjs").findCandidatesMethod>["findForAssembly"],
 * fetch: ReturnType<typeof import("./context-read-assembly-evidence.mjs").fetchForAssembly>,
 * counter?: KeylessMemoryServiceDeps["contextReadCounter"], format?: KeylessMemoryServiceDeps["contextReadFormat"] }} deps
 * @returns {NonNullable<MemoryService["readContext"]>} */
export function readContextMethod({ storage, clock, find, fetch, counter, format }) {
  const now = () => clock.monotonicMs();
  /** @param {ContextReadSet} readSet @param {ReturnType<typeof readInput>} input
   * @param {CallOptions} options @param {number} deadline @param {boolean} includeLedger */
  async function assemble(readSet, { candidate, budget, policy, representation, raw, lexicalOnly }, options, deadline, includeLedger) {
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
      candidate.types.includes("memory") ? { query: candidate.query, asOfMs: clock.nowMs() } : undefined;
    const evidence = await fetch(readSet, candidate, found.generations, items.map(item => item.ref), ledgerRequest);
    const prepared = evidence.rows.flatMap((row, i) => row ? [prepareItem(row, readSet, items[i].rank, candidate.intent)] : []);
    let rawCoverage = rawRead.coverage;
    let rawPacking = rawRead.turns.length > 0;
    const unavailable = items.length - prepared.length;
    const unitCount = prepared.length + prepared.reduce((n, item) => n + item.sources.length, 0);
    const amendmentTrials = prepared.reduce((n, item) => n + item.evidence.amendments.length, 0);
    /** @param {unknown} error */
    const staleSnapshot = error => !options.signal?.aborted && error instanceof CoreError && error.code === "snapshot_stale";

    /** @param {import("./context-read-pack.mjs").PackDiagnostics} details @param {number} used
     * @returns {ContextAssemblyDiagnostics} */
    const diagnostics = (details, used) => ({
      version: CONTEXT_VERSION, policy: { id: policy }, representation, counter: COUNTER, items: details.items,
      budget: { ...budget, used }, omitted: { ...details.omitted, unavailable }, dedup: details.dedup,
      stops: details.stops, trace: details.trace, coverage: { raw: rawCoverage }, candidates,
    });
    /** @type {PackOptions} */
    const packing = { budget, policy, representation, now, deadline, ledger: evidence.ledger,
      format, count: text => counter.count(text),
      fitsBytes(assembly, text, details, selected) {
        // Bound the mutable diagnostic scalars, including the final clock
        // reading. The snapshot is measured without signing a trial token.
        const bounded = diagnostics(details, budget.maxTokens);
        bounded.omitted.oversized = unitCount;
        bounded.stops = { budget: false, items: false, deadline: false };
        bounded.trace = { timings: { assemblyMs: -0.0000010000000000000002 },
          counterCalls: rawPacking ? Number.MAX_SAFE_INTEGER : 2 + Number(!!packing.ledger) + 3 * unitCount + 7 * amendmentTrials };
        const snapshotSize = selected.length
          ? Math.ceil(4 * bytes(JSON.stringify(evidence.payload(selected.map(item => item.evidence)))) / 3) + 44
          : 0;
        const full = responseBytes({ metered: null, diagnostics: { ...bounded, items: bounded.items.map(item => ({ ...item, ref: legacyRef(item.ref) })) }, snapshot: null }) - 8 +
          Math.max(bytes(JSON.stringify(assembly)), bytes(text) - blockOverhead) + (snapshotSize ? snapshotSize + 2 : 4);
        return snapshotSize <= SNAPSHOT_LIMIT && full <= MAX_BYTES;
      } };
    /** @param {Projection} pack @param {readonly ContextRawTurn[]} turns */
    async function deliver(pack, turns) {
      const included = evidence.ledger !== undefined && pack.value.items[0] === evidence.ledger;
      const selected = pack.selected.map(item => item.evidence);
      if (!included) return evidence.deliver(selected, turns, options.signal);
      try {
        const result = await evidence.deliver(selected, turns, options.signal, true);
        if (result !== staleLedger) return result;
      } catch (error) {
        if (staleSnapshot(error)) throw refreshAssembly;
        throw error;
      }
      if (options.signal?.aborted) throw new CoreError("snapshot_stale");
      throw staleLedger;
    }
    async function packAndDeliver() {
      let packed = rawPacking ? packRawContext(prepared, rawRead, readSet, candidate.query, packing, meter(packing)) : null;
      let snapshot;
      if (packed) {
        packed.diagnostics.stops.deadline ||= now() >= deadline;
        snapshot = await deliver(packed, rawRead.turns);
      }
      if (!packed || snapshot === undefined) {
        if (rawPacking) {
          rawCoverage = "partial";
          rawPacking = false;
        }
        packed = packContext(prepared, packing, meter(packing));
        packed.diagnostics.stops.deadline ||= now() >= deadline;
        snapshot = await deliver(packed, []);
      }
      return { assembly: packed.value, diagnostics: diagnostics(packed.diagnostics, packed.used), snapshot: typeof snapshot === "string" ? snapshot : null };
    }
    try {
      return await packAndDeliver();
    } catch (error) {
      if (error !== staleLedger) throw error;
      packing.ledger = undefined;
      rawCoverage = rawRead.coverage;
      rawPacking = rawRead.turns.length > 0;
      try {
        return await packAndDeliver();
      } catch (replacementError) {
        if (staleSnapshot(replacementError)) throw refreshAssembly;
        throw replacementError;
      }
    }
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
