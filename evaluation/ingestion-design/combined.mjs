import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { captureSnapshot, retainedSourceView, extractedItems } from '../../core/capture-input.mjs';
import { createQualificationCandidateSnapshot, compileQualificationCandidates } from '../../core/qualification-candidates.mjs';
import { countOpenAITokens } from '../../adapters/openai/index.mjs';
import { DEFAULT_MODEL } from '../../adapters/openai/profiles.mjs';
import { denseArray, object, fail } from '../../core/validation.mjs';

export const fields = ['subject', 'property', 'scope', 'applies', 'value', 'attribution', 'commitment'];
export const limits = Object.freeze({ localTokens: 6000, providerTokens: 7024, outputTokens: 1024 });
export const legacyPrompt = readFileSync(new URL('../../core/prompts/extract-memories.md', import.meta.url), 'utf8');
export const retainedPrompt = readFileSync(new URL('../../core/prompts/extract-retained-sources.md', import.meta.url), 'utf8');
const qualificationGuidance = readFileSync(new URL('../../core/prompts/qualify-candidates-shared.md', import.meta.url), 'utf8')
  .replace('Describe the source support for each extracted memory.', 'Describe the source support for each proposed output memory.')
  .replace('from THIS item only.', "whose sourceIndex belongs to THIS output item's sourceIndices only.");
// Reuse semantic extraction guidance, replacing its incompatible four-field wire contract.
export const combinedPrompt = `${retainedPrompt.split('Return only an object with an items array')[0]}
${qualificationGuidance}
Input sources are ordered exact chunks of retained messages. sourceIndex identifies a message;
candidateIndex identifies one passage. Concatenate chunks with the same sourceIndex in input
order to read that retained message; equal text never merges distinct sources or roles.
Return only {items:[{content,kind,confidence,sourceIndices,qualification}]} with zero to five items.
Each item has exactly those five fields. content is a concise standalone memory of at most600
UTF-16 units; kind is fact, preference, decision, instruction or context; confidence is a finite
number 0..1. sourceIndices contains one to four unique supporting sourceIndex values.
qualification has exactly subject, property, scope, applies, value, attribution, commitment.
Each qualification field has exactly value and evidenceIndices. Descriptive values are null
when unknown; otherwise subject/property/value are at most160 units and scope/applies120.
attribution is direct, reported, quoted, proposed or unknown. commitment is adopted, considered,
rejected or unknown. Select one to four distinct candidateIndex values per known field from
the item's selected sourceIndices; unknown fields may select zero. Each card needs at least
one citation; at most four distinct passages may be cited across its seven fields.
Preserve attributed uncertainty and scope: a suggestion or uncertainty is not adoption;
import time does not establish event time or currentness. Qualification is source-attributed
interpretation, never identity, authorization, model confidence or truth. Return no quotes,
offsets, receipts or extra fields. The core binds exact canonical evidence and checks structure;
real citations alone do not prove interpretation. Do not reproduce secrets.`;
const obj = properties => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const arr = (items, maxItems, minItems = 0) => ({ type: 'array', items, minItems, maxItems });
const sha = text => createHash('sha256').update(text).digest('hex');
function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze); Object.freeze(value);
  }
  return value;
}

export function prepareCombined(input) {
  const snapshot = captureSnapshot(input, 'source-bound-v2');
  const retained = retainedSourceView(snapshot);
  const candidates = [];
  // Core owns canonicalization and Unicode-safe segmentation before card selection.
  retained.messages.forEach((m, sourceIndex) => {
    const one = createQualificationCandidateSnapshot([{ content: 'Synthetic catalog carrier', kind: 'context',
      confidence: 0, receipts: [{ client: snapshot.client, sessionId: snapshot.sessionId,
        eventId: m.id, role: m.role, excerpt: m.content }] }]);
    one.candidates[0].forEach(c => candidates.push({ ...c, candidateIndex: candidates.length, sourceIndex }));
  });
  const requestInput = { sources: candidates.map(({ candidateIndex, sourceIndex, role, text }) =>
    ({ candidateIndex, sourceIndex, role, text })) };
  const refs = arr({ type: 'integer', enum: candidates.map(c => c.candidateIndex) }, 4);
  const qualifier = obj(Object.fromEntries(fields.map(f => [f, obj({ value: f === 'attribution'
    ? { type: 'string', enum: ['direct', 'reported', 'quoted', 'proposed', 'unknown'] }
    : f === 'commitment' ? { type: 'string', enum: ['adopted', 'considered', 'rejected', 'unknown'] }
      : { anyOf: [{ type: 'null' }, { type: 'string', minLength: 1, maxLength: ['scope', 'applies'].includes(f) ? 120 : 160 }] },
    evidenceIndices: refs })])));
  const schema = obj({ items: arr(obj({ content: { type: 'string', maxLength: 600 },
    kind: { type: 'string', enum: ['fact', 'preference', 'decision', 'instruction', 'context'] },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    sourceIndices: arr({ type: 'integer', enum: retained.messages.map((_, i) => i) }, 4, 1), qualification: qualifier }), 5) });
  return freeze({ snapshot, retained, candidates, requestInput, schema });
}

export function measureCombined(prepared) {
  const payload = { model: DEFAULT_MODEL, instructions: combinedPrompt,
    input: [{ role: 'user', content: [{ type: 'input_text', text: JSON.stringify(prepared.requestInput) }] }],
    text: { format: { type: 'json_schema', name: 'evaluation_combined_v1', strict: true, schema: prepared.schema } }, truncation: 'disabled' };
  return measureBodies(JSON.stringify(payload), JSON.stringify({ ...payload, max_output_tokens: 1024, store: false, stream: false }),
    JSON.stringify({ system: combinedPrompt, input: prepared.requestInput, maxOutputTokens: 1024 }), 'reconstructed-evaluation-only');
}

export function measureBodies(countBody, generationBody, local, provenance, output) {
  const payload = JSON.parse(countBody);
  return { provenance, promptSha256: sha(payload.instructions), schemaSha256: sha(JSON.stringify(payload.text.format.schema)),
    logicalTokens: countOpenAITokens(local), countBodyTokens: countOpenAITokens(countBody),
    generationBodyTokens: countOpenAITokens(generationBody), countBodyBytes: Buffer.byteLength(countBody),
    generationBodyBytes: Buffer.byteLength(generationBody),
    outputTokens: output === undefined ? null : countOpenAITokens(JSON.stringify(output)) };
}

export function compileCombined(prepared, output) {
  const measured = measureCombined(prepared);
  if (measured.logicalTokens > 6000 || measured.countBodyTokens > 6000) fail('context_budget_exceeded');
  try { return compileOutput(prepared, output); }
  catch { fail('invalid_model_output'); }
}
function compileOutput(prepared, output) {
  if (countOpenAITokens(JSON.stringify(output)) > 1024) fail('invalid_model_output');
  object(output, ['items']);
  const entries = denseArray(output.items, 0, 5);
  entries.forEach(item => { object(item, ['content', 'kind', 'confidence', 'sourceIndices', 'qualification']);
    if (!Object.hasOwn(item, 'qualification')) fail('invalid_model_output'); });
  const extracted = { items: entries.map(({ qualification, ...item }) => item) };
  const items = extractedItems(extracted, prepared.snapshot, prepared.retained.messages);
  if (!items.length) return [];
  const local = createQualificationCandidateSnapshot(items);
  const qualifications = entries.map((entry, itemIndex) => {
    object(entry.qualification, fields);
    const qualification = { itemIndex };
    for (const f of fields) {
      const field = entry.qualification[f]; object(field, ['value', 'evidenceIndices']);
      const indices = denseArray(field.evidenceIndices, 0, 4).map(id => {
        const original = prepared.candidates.find(c => c.candidateIndex === id);
        const receiptIndex = original && entry.sourceIndices.indexOf(original.sourceIndex);
        if (!original || receiptIndex < 0) fail('invalid_model_output');
        const candidate = local.candidates[itemIndex].find(c => c.receiptIndex === receiptIndex &&
          c.start === original.start && c.end === original.end && c.text === original.text);
        if (!candidate) fail('invalid_model_output');
        return candidate.candidateIndex;
      });
      qualification[f] = { value: field.value, evidenceIndices: indices };
    }
    return qualification;
  });
  return compileQualificationCandidates({ qualifications }, local);
}
