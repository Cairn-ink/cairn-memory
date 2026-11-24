import {
  assertReadContractCapabilities, CAPABILITIES, READ_CONTRACT_CAPABILITIES, WRITE_PARITY_CAPABILITIES,
} from "../capabilities.mjs";
import { identifier, validateObject } from "../capture/validate.mjs";
import { FUSION_PRESETS, NEAR_DUPLICATE_DISTANCE } from "../decisions.mjs";
import { CoreError } from "../errors.mjs";
import { captureMethods } from "./capture.mjs";
import { fetchForAssembly } from "./context-read-assembly-evidence.mjs";
import { fetchEvidenceMethod } from "./context-read-fetch.mjs";
import { findCandidatesMethod } from "./context-read-find.mjs";
import { readContextMethod } from "./context-read.mjs";
import { entryError } from "./entry.mjs";
import { findMethod, readMethod } from "./find.mjs";
import { forgetMethod } from "./forget.mjs";
import { importMethod, importRawMethod } from "./import.mjs";
import { inspectMethod } from "./inspect.mjs";
import { pauseMethods } from "./pause.mjs";
import { recallMethod } from "./recall.mjs";
import { listRawMessagesMethod, readMethods } from "./reads.mjs";
import { writeMethods } from "./writes.mjs";

/** @param {unknown} value */
function positiveInteger(value) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    throw new CoreError("invalid_input");
  }
}

/** @param {import("./index.d.mts").MemoryServiceConfig} input */
function freezeConfig(input) {
  const config = {
    nearDuplicateDistance: NEAR_DUPLICATE_DISTANCE,
    lexicalWeight: FUSION_PRESETS.hosted.lexicalWeight,
    vectorWeight: FUSION_PRESETS.hosted.vectorWeight,
    rowShingles: true,
  };
  validateObject(input, [...Object.keys(config), "leaseMs", "deadlines", "documentCards", "quantityLedger"]);
  const {
    nearDuplicateDistance = config.nearDuplicateDistance,
    lexicalWeight = config.lexicalWeight,
    vectorWeight = config.vectorWeight,
    rowShingles = config.rowShingles,
    leaseMs,
    deadlines,
    documentCards,
    quantityLedger,
  } = input;
  for (const weight of [nearDuplicateDistance, lexicalWeight, vectorWeight]) {
    if (!Number.isFinite(weight) || weight < 0) throw new CoreError("invalid_input");
  }
  if (nearDuplicateDistance > 2 || typeof rowShingles !== "boolean") throw new CoreError("invalid_input");
  if (leaseMs !== undefined) positiveInteger(leaseMs);
  if (deadlines !== undefined) {
    validateObject(deadlines, ["extract", "qualify", "reconcile", "classify", "rationale"]);
  }
  const stages = { ...deadlines };
  for (const duration of Object.values(stages)) {
    positiveInteger(duration);
    // Match the capture runner's deadline range.
    if (duration > 120_000) throw new CoreError("invalid_input");
  }
  let cards, ledger;
  if (documentCards !== undefined) {
    const { enabled, amendments } = validateObject(documentCards, ["enabled", "amendments"]);
    if (typeof enabled !== "boolean" || (amendments !== undefined && typeof amendments !== "boolean")) {
      throw new CoreError("invalid_input");
    }
    cards = Object.freeze({ enabled, amendments });
  }
  if (quantityLedger !== undefined) {
    const { enabled } = validateObject(quantityLedger, ["enabled"]);
    if (typeof enabled !== "boolean") throw new CoreError("invalid_input");
    ledger = Object.freeze({ enabled });
  }

  return Object.freeze({
    nearDuplicateDistance, lexicalWeight, vectorWeight, rowShingles, leaseMs,
    deadlines: Object.freeze(stages),
    documentCards: cards, quantityLedger: ledger,
  });
}

/** @param {object | undefined} port @param {...string} methods */
function requireMethods(port, ...methods) {
  if (!port || typeof port !== "object" || methods.some(method => typeof Reflect.get(port, method) !== "function")) {
    throw new CoreError("invalid_input");
  }
}

/**
 * @param {import("./index.d.mts").KeylessInspectServiceDeps["storage"] &
 *   Pick<import("../ports/index.d.ts").StorageAdapter, "proceduralTags">} storage
 */
function validateReadRegistration(storage) {
  validateObject(storage.capabilities, [...CAPABILITIES, ...READ_CONTRACT_CAPABILITIES, ...WRITE_PARITY_CAPABILITIES]);
  if (Object.values(storage.capabilities).some(value => typeof value !== "boolean")) {
    throw new CoreError("invalid_input");
  }
  assertReadContractCapabilities(storage);
  if (storage.capabilities.proceduralTags === true) requireMethods(storage.proceduralTags, "write", "clear", "read");
}

/** @param {import("./index.d.mts").MemoryServiceRegistrationDeps} input */
function freezeDeps(input) {
  const deps = { ...input };
  const { storage, model: configuredModel, embedder: configuredEmbedder, gate, clock, tokens, embedQuery, diagnostics } = deps;
  identifier(storage?.name);
  validateReadRegistration(storage);
  // Validate the storage methods this slice uses. Optional ports are checked at adapter registration.
  requireMethods(storage.uow, "run");
  requireMethods(storage.pause, "get", "set");
  requireMethods(storage.snapshot, "stateToken", "assertUnchanged");
  requireMethods(storage.fence, "assertVisible");
  requireMethods(storage.recent, "recent");
  requireMethods(storage.memories, "exportPage");

  const model = configuredModel ?? null;
  if (model === null && storage.capabilities.fingerprintKey === true) throw new CoreError("invalid_input");
  if (model !== null) {
    requireMethods(model, "call", "countTokens");
    if (typeof model.model !== "string" || !model.model ||
        (model.fits !== undefined && typeof model.fits !== "function")) throw new CoreError("invalid_input");
    positiveInteger(model.contextWindow);
  }
  if (configuredEmbedder === undefined && storage.capabilities.embeddingRequiredOnInsert !== false) {
    throw new CoreError("invalid_input");
  }
  const embedder = configuredEmbedder ?? null;
  if (embedder !== null) {
    requireMethods(embedder, "embed");
    if (typeof embedder.model !== "string" || !embedder.model) throw new CoreError("invalid_input");
    positiveInteger(embedder.dimensions);
  }
  requireMethods(gate, "assertOpen");
  requireMethods(clock, "nowMs", "monotonicMs", "sha256Hex", "hmacHex");
  requireMethods(tokens, "countTokens");
  if (embedQuery !== undefined) requireMethods(embedQuery, "embedQuery");
  if (diagnostics !== undefined && typeof diagnostics !== "function") throw new CoreError("invalid_input");
  if (deps.documentCardSessionKey !== undefined && typeof deps.documentCardSessionKey !== "function") {
    throw new CoreError("invalid_input");
  }

  return Object.freeze({ ...deps, model, embedder, config: freezeConfig(deps.config) });
}

/** @param {import("./index.d.mts").KeylessMemoryServiceDeps["storage"] | import("./index.d.mts").MemoryServiceDeps["storage"]} storage
 * @param {import("../ports/index.d.ts").ClockAndHash} clock
 * @param {Pick<import("./index.d.mts").MemoryServiceDeps, "contextReadCounter" | "contextReadFormat">} host
 * @returns {import("./index.d.mts").ContextReadMemoryService}
 */
function readContractMethods(storage, clock, host) {
  const { findCandidates, findForAssembly } = findCandidatesMethod({ storage, clock });
  return {
    findCandidates,
    fetchEvidence: fetchEvidenceMethod(storage),
    readContext: readContextMethod({ storage, clock, find: findForAssembly, fetch: fetchForAssembly(storage),
      counter: host.contextReadCounter, format: host.contextReadFormat }),
    inspect: inspectMethod(storage, clock),
  };
}

/**
 * @param {import("./index.d.mts").MemoryServiceRegistrationDeps | import("./index.d.mts").KeylessInspectServiceDeps |
 * import("./index.d.mts").KeylessMemoryServiceDeps} input
 */
export function createMemoryService(input) {
  try {
    if ("profile" in input && input.profile === "keyless-local") {
      const { storage, clock } = input;
      requireMethods(storage.uow, "run");
      requireMethods(clock, "hmacHex");
      validateReadRegistration(storage);
      if (!storage.inspect) throw new CoreError("capability_unavailable");
      if (storage.capabilities.contextRead === true) {
        if (!("fence" in storage)) throw new CoreError("invalid_input");
        requireMethods(storage.fence, "assertVisible");
        requireMethods(clock, "nowMs", "monotonicMs");
        return readContractMethods(storage, clock, "contextReadCounter" in input || "contextReadFormat" in input ? input : {});
      }
      return { inspect: inspectMethod(storage, clock) };
    }
    const deps = freezeDeps(input);
    return {
      ...pauseMethods(deps.storage),
      ...readMethods(deps.storage, deps.tokens),
      ...writeMethods(deps),
      ...captureMethods(deps),
      ...readContractMethods(deps.storage, deps.clock, deps),
      forget: forgetMethod(deps),
      recall: recallMethod(deps),
      find: findMethod(deps),
      read: readMethod(deps.storage),
      listRawMessages: listRawMessagesMethod(deps.storage),
      importMemories: importMethod(deps),
      importRawMessages: importRawMethod(deps),
    };
  } catch (error) {
    throw entryError(error);
  }
}
