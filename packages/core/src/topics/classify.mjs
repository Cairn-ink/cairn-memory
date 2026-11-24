import { callBuiltModel, emitDiagnostic } from '../capture/model-call.mjs';
import { MODEL_OUTPUT_TOKENS, modelRequestText } from '../capture/request-size.mjs';
import { CoreError, isCoreError } from '../errors.mjs';
import { CLASSIFY_PLACEMENT_PROMPT } from './generated/prompt.mjs';
import { packClassification } from './packing.mjs';
import { checkProposalAgainstCatalog, placementProposal } from './proposal.mjs';
import { classificationWire, classifySchema, schemaAccepts } from './wire.mjs';

/** @import { ClassifyPlacementOptions, ClassifyPlacementResult } from './classify.mjs' */
/** @import { PlacementProposal } from './proposal.mjs' */
/** @import { BuiltModelRequest } from '../capture/model-call.mjs' */

/** @param {ClassifyPlacementOptions} options @returns {Promise<ClassifyPlacementResult>} */
export async function classifyPlacement({
  model, snapshot, catalog, allowNewTopics = true, validateFresh, deadline, gate, owner, signal, onDiagnostic,
}) {
  let call;
  try { call = model?.call; }
  catch { /* An unreadable model call is unavailable. */ }
  if (!model || typeof call !== 'function') {
    emitDiagnostic(onDiagnostic, 'classify', 'core_call', 'model_not_configured');
    throw new CoreError('model_not_configured');
  }

  const system = CLASSIFY_PLACEMENT_PROMPT;
  const { memories, indexRevision } = snapshot;
  const memoryRevisions = memories.map(({ id: memoryId, revision }) => ({ memoryId, revision }));
  const { map, mapExhausted } = catalog;
  let packed;
  try {
    packed = packClassification(model, system, { memories, map, mapExhausted: allowNewTopics && mapExhausted }, deadline);
  } catch (error) {
    if (isCoreError(error) && (error.code === 'token_count_unavailable' || error.code === 'model_timeout')) {
      emitDiagnostic(onDiagnostic, 'classify', 'core_call', error.code);
    }
    throw error;
  }

  const { input: packedInput, memoriesShortened, catalogItemsOmitted } = packed;
  const sizingText = modelRequestText(system, packedInput);
  const wire = classificationWire(packedInput);
  const schema = classifySchema(wire.input);
  // Accept the shared creation shape locally so a model that returns it can still file existing parents.
  const decodeSchema = allowNewTopics ? schema : classifySchema({ ...wire.input, mapExhausted: true });
  /** @type {BuiltModelRequest<PlacementProposal>} */
  const built = {
    stage: 'classify',
    sizingText,
    request: { system, input: wire.input, schema, schemaName: 'cairn_classify', maxOutputTokens: MODEL_OUTPUT_TOKENS },
    decode(raw, report) {
      const reject = () => {
        report('classify', 'adapter', 'output_shape');
        throw new CoreError('invalid_model_output');
      };
      if (!schemaAccepts(decodeSchema, raw)) return reject();
      try { return wire.decode(/** @type {PlacementProposal} */ (raw)); }
      catch { return reject(); }
    },
  };

  await validateFresh();
  const output = await callBuiltModel(model, 'classify', built, {
    failureCode: 'classification_failed', refresh: validateFresh, deadline, gate, owner, signal, onDiagnostic,
  });
  await validateFresh();

  let proposal;
  try {
    const allowed = allowNewTopics ? output : {
      items: output.items.map(({ memoryId, parentIds }) => ({ memoryId, parentIds })),
    };
    proposal = placementProposal(allowed, memoryRevisions.map(({ memoryId }) => memoryId));
    checkProposalAgainstCatalog(proposal, packedInput.map, packedInput.mapExhausted);
  } catch (error) {
    deadline?.check();
    if (isCoreError(error) && error.code === 'token_count_unavailable') throw error;
    emitDiagnostic(onDiagnostic, 'classify', 'core_validation', 'invalid_classification');
    throw new CoreError('invalid_model_output');
  }
  deadline?.check();
  return {
    proposal,
    basedOn: { memoryRevisions, indexRevision, mapExhausted: packedInput.mapExhausted },
    ...(memoriesShortened || catalogItemsOmitted ? {
      classificationTruncated: { memoriesShortened, catalogItemsOmitted },
    } : {}),
  };
}
