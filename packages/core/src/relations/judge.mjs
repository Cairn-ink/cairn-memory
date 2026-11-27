import { callBuiltModel } from "../capture/model-call.mjs";
import { MODEL_OUTPUT_TOKENS, modelRequestText } from "../capture/request-size.mjs";
import { validateDenseArray, validateObject } from "../capture/validate.mjs";
import { CoreError } from "../errors.mjs";
import { RELATION_LIMIT } from "../memory-policy/relation-limits.mjs";
import { JUDGE_MEMORY_RELATIONS_PROMPT } from "./generated/prompt.mjs";

/** @import { BuiltModelCallOptions, BuiltModelRequest } from "../capture/model-call.mjs" */
/** @import { MemoryRow, ModelPort, Role } from "../ports/index.d.ts" */
/** @typedef {{ predecessorIndex: number; relation: "supersedes" | "contradicts" }} RelationVerdict */
/** @typedef {Pick<MemoryRow, "text" | "kind">} RelationMemory */

const relations = ["supersedes", "contradicts", "reaffirms", "historical_context", "compatible", "unresolved"];
const valueChanges = ["changed", "unchanged", "unknown"];
const adoptions = ["explicit", "not_adopted", "uncertain"];

/** @param {Record<string, object>} properties */
const strictObject = properties => ({
  type: "object", properties, required: Object.keys(properties), additionalProperties: false,
});

/** @param {number[]} indices */
const index = indices => ({ type: "integer", enum: indices });

/**
 * @param {unknown} output
 * @param {{ candidateCount: number; sourceIndices: readonly number[]; messages: readonly { role: Role }[] }} evidence
 * @returns {RelationVerdict[]}
 */
export function validateRelationVerdicts(output, { candidateCount, sourceIndices, messages }) {
  try {
    const { transitions } = validateObject(output, ["transitions"]);
    const seen = new Set();
    /** @type {RelationVerdict[]} */
    const verdicts = [];
    for (const transition of validateDenseArray(transitions, 0, RELATION_LIMIT)) {
      const { replacementIndex, predecessorIndex, evidenceIndices, relation, valueChange, adoption } =
        validateObject(transition, ["replacementIndex", "predecessorIndex", "evidenceIndices",
          "relation", "valueChange", "adoption"]);
      if (typeof relation !== "string" || !relations.includes(relation) ||
          typeof valueChange !== "string" || !valueChanges.includes(valueChange) ||
          typeof adoption !== "string" || !adoptions.includes(adoption) ||
          (relation === "supersedes" && (valueChange !== "changed" || adoption !== "explicit")) ||
          (relation === "contradicts" && valueChange === "unchanged") ||
          replacementIndex !== 0 || typeof predecessorIndex !== "number" ||
          !Number.isInteger(predecessorIndex) || predecessorIndex < 0 || predecessorIndex >= candidateCount ||
          seen.has(predecessorIndex)) throw new CoreError("invalid_model_output");
      seen.add(predecessorIndex);

      const selected = validateDenseArray(evidenceIndices, 1, 4);
      if (new Set(selected).size !== selected.length || selected.some(value =>
        typeof value !== "number" || !Number.isInteger(value) || value < 0 ||
        !sourceIndices.includes(value) || !messages[value])) throw new CoreError("invalid_model_output");
      if (relation === "supersedes" && !selected.some(value => messages[/** @type {number} */ (value)].role === "user")) {
        throw new CoreError("invalid_model_output");
      }
      if (relation === "supersedes" || relation === "contradicts") verdicts.push({ predecessorIndex, relation });
    }
    return verdicts;
  } catch {
    throw new CoreError("invalid_model_output");
  }
}

/**
 * @param {RelationMemory} memory @param {readonly RelationMemory[]} candidates
 * @returns {BuiltModelRequest<RelationVerdict[]>}
 */
function buildJudgeRequest(memory, candidates) {
  const { text: content, kind } = memory;
  const sourceIndices = [0];
  const messages = [{ index: 0, role: /** @type {const} */ ("user"), content }];
  const input = {
    messages,
    items: [{ index: 0, content, kind, sourceIndices }],
    candidates: candidates.map(({ text: content, kind }, index) => ({ index, content, kind, receipts: [] })),
  };
  const schema = strictObject({
    transitions: {
      type: "array", maxItems: RELATION_LIMIT,
      items: strictObject({
        replacementIndex: index([0]),
        predecessorIndex: index(input.candidates.map(({ index }) => index)),
        evidenceIndices: { type: "array", items: index(sourceIndices), minItems: 1, maxItems: sourceIndices.length },
        relation: { type: "string", enum: relations },
        valueChange: { type: "string", enum: valueChanges },
        adoption: { type: "string", enum: adoptions },
      }),
    },
  });
  const system = JUDGE_MEMORY_RELATIONS_PROMPT;
  const maxOutputTokens = MODEL_OUTPUT_TOKENS;
  const evidence = { candidateCount: candidates.length, sourceIndices, messages };
  return {
    stage: "reconcile",
    request: { system, input, schema, schemaName: "cairn_judge_memory_relations", maxOutputTokens },
    sizingText: modelRequestText(system, input, maxOutputTokens),
    decode(raw, report) {
      try {
        return validateRelationVerdicts(raw, evidence);
      } catch (error) {
        report("reconcile", "core_validation", "invalid_reconciliation");
        throw error;
      }
    },
  };
}

/**
 * @param {ModelPort} model @param {RelationMemory} memory @param {readonly RelationMemory[]} candidates
 * @param {BuiltModelCallOptions} options
 */
export function judgeMemoryRelations(model, memory, candidates, options) {
  return callBuiltModel(model, "reconcile", buildJudgeRequest(memory, candidates), {
    ...options, failureCode: "reconciliation_failed",
  });
}
