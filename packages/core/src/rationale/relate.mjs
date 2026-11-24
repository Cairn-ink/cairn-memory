import { callBuiltModel } from '../capture/model-call.mjs';
import { MODEL_OUTPUT_TOKENS, modelRequestText } from '../capture/request-size.mjs';
import { validateDenseArray, validateObject } from '../capture/validate.mjs';
import { CoreError } from '../errors.mjs';
import { RELATE_RATIONALE_PROMPT } from './generated/prompt.mjs';
import { RATIONALE_LIMITS } from './limits.mjs';

/** @import { BuiltModelRequest } from '../capture/model-call.mjs' */
/** @import { RationaleSource } from '../ports/rationale.d.ts' */
/** @import { RelateOptions, RationaleProposal } from './types.d.ts' */

const relations = Object.freeze(/** @type {const} */ (['supports-decision', 'challenges-premise']));

/** @param {Record<string, object>} properties */
const object = (properties) => ({
  type: 'object', properties, required: Object.keys(properties), additionalProperties: false,
});

/** @param {number[]} indices */
const index = (indices) => ({ type: 'integer', minimum: 0, enum: indices });

/** @param {readonly RationaleSource[]} sources @returns {BuiltModelRequest<RationaleProposal[]>} */
export function buildRelateRequest(sources) {
  if (!sources.length || sources.length > RATIONALE_LIMITS.refs ||
      sources.some(({ receipts }) => !receipts.length || receipts.length > RATIONALE_LIMITS.receipts)) {
    throw new CoreError('invalid_input');
  }
  const input = { memories: sources.map(({ receipts }, index) => ({
    index, receipts: receipts.map(({ role, excerpt }, index) => ({ index, role, excerpt })),
  })) };
  const memoryIndices = input.memories.map(({ index }) => index);
  // The provider schema constrains receipt indices to their union. Decode checks each pairing.
  const receiptIndices = [...new Set(input.memories.flatMap(({ receipts }) => receipts.map(({ index }) => index)))];
  const schema = object({
    edges: { type: 'array', items: object({
      from: index(memoryIndices), to: index(memoryIndices), relation: { type: 'string', enum: relations },
      fromReceipt: index(receiptIndices), toReceipt: index(receiptIndices),
    }), maxItems: RATIONALE_LIMITS.proposalEdges },
  });
  const system = RELATE_RATIONALE_PROMPT;
  const maxOutputTokens = MODEL_OUTPUT_TOKENS;
  // Capture only the lengths needed by the decoder.
  const counts = sources.map(({ receipts }) => receipts.length);
  return {
    stage: 'rationale',
    request: { system, input, schema, schemaName: 'cairn_relate', maxOutputTokens },
    sizingText: modelRequestText(system, input, maxOutputTokens),
    decode(raw, report) {
      try {
        const { edges } = validateObject(raw, ['edges']);
        const seen = new Set();
        return validateDenseArray(edges, 0, RATIONALE_LIMITS.proposalEdges).map(value => {
          const { from, to, relation, fromReceipt, toReceipt } =
            validateObject(value, ['from', 'to', 'relation', 'fromReceipt', 'toReceipt']);
          if ((relation !== relations[0] && relation !== relations[1]) ||
              !validIndex(from, counts.length) || !validIndex(to, counts.length) ||
              !validIndex(fromReceipt, counts[from]) || !validIndex(toReceipt, counts[to]) ||
              (from === to && relation !== 'supports-decision')) throw new CoreError('invalid_model_output');
          /** @type {RationaleProposal} */
          const edge = { from, to, relation, fromReceipt, toReceipt };
          const key = JSON.stringify(edge);
          if (seen.has(key)) throw new CoreError('invalid_model_output');
          seen.add(key);
          return edge;
        });
      } catch {
        report('relate', 'core_validation', 'invalid_rationale');
        throw new CoreError('invalid_model_output');
      }
    },
  };
}

/** @param {unknown} value @param {number} count @returns {value is number} */
function validIndex(value, count) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value < count;
}

/** @param {RelateOptions} options */
export async function relate({ model, sources, validateFresh, deadline, gate, owner, signal, onDiagnostic }) {
  if (typeof gate?.assertOpen !== 'function') throw new CoreError('invalid_input');
  const built = buildRelateRequest(sources);
  await validateFresh();
  const edges = await callBuiltModel(model, 'relate', built, {
    failureCode: 'rationale_failed', refresh: validateFresh, deadline, gate, owner, signal, onDiagnostic,
  });
  await validateFresh();
  return edges;
}
