import { CAPABILITIES } from "../capabilities.mjs";
import { identifier, validateObject } from "../capture/validate.mjs";
import { FUSION_PRESETS, NEAR_DUPLICATE_DISTANCE } from "../decisions.mjs";
import { CoreError } from "../errors.mjs";
import { entry, entryError, scopeOf } from "./entry.mjs";
import { forgetMethod } from "./forget.mjs";
import { importMethod } from "./import.mjs";
import { pauseMethods } from "./pause.mjs";
import { readMethods } from "./reads.mjs";
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
  validateObject(input, [...Object.keys(config), "leaseMs", "deadlines"]);
  const {
    nearDuplicateDistance = config.nearDuplicateDistance,
    lexicalWeight = config.lexicalWeight,
    vectorWeight = config.vectorWeight,
    rowShingles = config.rowShingles,
    leaseMs,
    deadlines,
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
  for (const duration of Object.values(stages)) positiveInteger(duration);

  return Object.freeze({
    nearDuplicateDistance, lexicalWeight, vectorWeight, rowShingles, leaseMs,
    deadlines: Object.freeze(stages),
  });
}

/** @param {object | undefined} port @param {...string} methods */
function requireMethods(port, ...methods) {
  if (!port || typeof port !== "object" || methods.some(method => typeof Reflect.get(port, method) !== "function")) {
    throw new CoreError("invalid_input");
  }
}

/** @param {import("./index.d.mts").MemoryServiceDeps} input */
function freezeDeps(input) {
  const deps = { ...input };
  const { storage, model, embedder, gate, clock, tokens, embedQuery, diagnostics } = deps;
  identifier(storage?.name);
  validateObject(storage.capabilities, CAPABILITIES);
  if (Object.values(storage.capabilities).some(value => typeof value !== "boolean")) {
    throw new CoreError("invalid_input");
  }
  // Validate the storage methods this slice uses. Optional ports are checked at adapter registration.
  requireMethods(storage.uow, "run");
  requireMethods(storage.pause, "get", "set");
  requireMethods(storage.snapshot, "stateToken", "assertUnchanged");
  requireMethods(storage.fence, "assertVisible");
  requireMethods(storage.recent, "recent");
  requireMethods(storage.memories, "exportPage");

  requireMethods(model, "call", "countTokens");
  if (typeof model.model !== "string" || !model.model ||
      (model.fits !== undefined && typeof model.fits !== "function")) throw new CoreError("invalid_input");
  positiveInteger(model.contextWindow);
  requireMethods(embedder, "embed");
  if (typeof embedder.model !== "string" || !embedder.model) throw new CoreError("invalid_input");
  positiveInteger(embedder.dimensions);
  requireMethods(gate, "assertOpen");
  requireMethods(clock, "nowMs", "monotonicMs", "sha256Hex", "hmacHex");
  requireMethods(tokens, "countTokens");
  if (embedQuery !== undefined) requireMethods(embedQuery, "embedQuery");
  if (diagnostics !== undefined && typeof diagnostics !== "function") throw new CoreError("invalid_input");

  return Object.freeze({ ...deps, config: freezeConfig(deps.config) });
}

/**
 * @param {import("./index.d.mts").MemoryServiceDeps} input
 * @returns {import("../ports/host.d.ts").MemoryService & import("./index.d.mts").CaptureRunner}
 */
export function createMemoryService(input) {
  try {
    const deps = freezeDeps(input);
    const placeholder = entry(unavailable);
    return {
      ...pauseMethods(deps.storage),
      ...readMethods(deps.storage, deps.tokens),
      ...writeMethods(deps),
      forget: forgetMethod(deps),
      recall: placeholder,
      captureStatus: placeholder,
      listRawMessages: placeholder,
      importMemories: importMethod(deps),
      importRawMessages: placeholder,
      enqueueCapture: placeholder,
      runCapture: placeholder,
    };
  } catch (error) {
    throw entryError(error);
  }
}

/** @param {unknown} scope */
async function unavailable(scope) {
  scopeOf(scope);
  throw new CoreError("capability_unavailable");
}
