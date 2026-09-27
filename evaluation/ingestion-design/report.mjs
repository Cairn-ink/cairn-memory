import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { captureSnapshot, retainedSourceView, extractedItems } from '../../core/capture-input.mjs';
import { createQualificationCandidateSnapshot, compileQualificationCandidates, qualifyCandidateItems } from '../../core/qualification-candidates.mjs';
import { standardInlineQualificationPrompt } from '../../core/qualification-candidates-prompt.mjs';
import { createQualificationTextCatalog, snapshotQualificationTextCatalog } from '../../core/qualification-text-catalog.mjs';
import { callModel } from '../../core/model-call.mjs';
import { createOpenAIModel, countOpenAITokens } from '../../adapters/openai/index.mjs';
import { DEFAULT_MODEL } from '../../adapters/openai/profiles.mjs';
import { schemasFor } from '../../adapters/openai/schemas.mjs';
import { decodeQualificationEvidencePool } from '../../adapters/openai/qualification-evidence-pool.mjs';
import { measureCandidateRequest } from '../qualification-wire/direct-candidates.mjs';
import { fixtures, fixtureSha256 } from './fixtures.mjs';
import { prepareCombined, measureCombined, compileCombined, measureBodies, legacyPrompt, retainedPrompt, limits } from './combined.mjs';
import { scriptedExtraction, scriptedFields, scriptedCombined } from './oracle.mjs';

export function wireFor(fixture, input, long = false) {
  return { wireVersion: 'evidence-pool-v1', qualifications: Object.fromEntries(input.items.map(item => {
    const id = item.candidates.at(-1).candidateIndex;
    const fields = scriptedFields(fixture, id, long);
    return [`item_${item.itemIndex}`, { itemIndex: item.itemIndex, pool: [id], ...Object.fromEntries(
      Object.entries(fields).map(([name, field]) => [name, { value: field.value, evidenceSlots: field.evidenceIndices.map(() => 0) }])) }];
  })) };
}
function envelope(model, output) {
  return { object: 'response', model, status: 'completed', error: null, incomplete_details: null,
    output: [{ type: 'message', role: 'assistant', status: 'completed',
      content: [{ type: 'output_text', text: JSON.stringify(output) }] }],
    usage: { input_tokens: 120, output_tokens: 80, total_tokens: 200 } };
}

export async function runBaseline(fixture, arm) {
  const legacy = arm === 'legacy';
  const snapshot = captureSnapshot(fixture.input, legacy ? undefined : 'source-bound-v2');
  const retained = legacy ? null : retainedSourceView(snapshot);
  const input = { messages: (retained?.messages ?? snapshot.messages).map(({ role, content }, index) => ({ index, role, content })) };
  const extractionSystem = legacy ? legacyPrompt : retainedPrompt;
  const payload = { model: DEFAULT_MODEL, instructions: extractionSystem,
    input: [{ role: 'user', content: [{ type: 'input_text', text: JSON.stringify(input) }] }],
    text: { format: { type: 'json_schema', name: 'cairn_extract', strict: true, schema: schemasFor('extract', input) } }, truncation: 'disabled' };
  const extractionPreflight = measureBodies(JSON.stringify(payload),
    JSON.stringify({ ...payload, max_output_tokens: 1024, store: false, stream: false }),
    JSON.stringify({ system: extractionSystem, input, maxOutputTokens: 1024 }), 'reconstructed-real-extraction-serializer');
  const bodies = [], calls = [], diagnostics = [];
  const model = createOpenAIModel({ apiKey: 'synthetic-only', extractionModel: DEFAULT_MODEL,
    qualificationInputMode: 'adaptive-text-catalog-v1',
    onDiagnostic: d => diagnostics.push(d), fetchImpl: async (url, options) => {
      bodies.push(options.body);
      const payload = JSON.parse(options.body);
      const sent = JSON.parse(payload.input[0].content[0].text);
      const qualification = payload.text.format.name === 'cairn_qualifyCandidates';
      const expanded = Object.hasOwn(sent, 'inputMode') ? snapshotQualificationTextCatalog(sent).expanded : sent;
      const output = qualification ? wireFor(fixture, expanded) : scriptedExtraction(fixture);
      if (url.endsWith('/input_tokens')) return Response.json({ object: 'response.input_tokens', input_tokens: 120 });
      const system = qualification ? payload.instructions : legacy ? legacyPrompt : retainedPrompt;
      const legalLong = qualification ? wireFor(fixture, expanded, true) : scriptedExtraction(fixture, true);
      calls.push({ ...measureBodies(bodies.at(-2), options.body,
        JSON.stringify({ system, input: sent, maxOutputTokens: 1024 }), 'actual-adapter-fake-http', output),
        method: qualification ? 'qualifyCandidates' : 'extract',
        decodedOutputTokens: countOpenAITokens(JSON.stringify(qualification ? decodeQualificationEvidencePool(expanded, output) : output)),
        selectedLegalLongOutputTokens: countOpenAITokens(JSON.stringify(legalLong)),
        selectedLegalLongDecodedOutputTokens: countOpenAITokens(JSON.stringify(qualification ? decodeQualificationEvidencePool(expanded, legalLong) : legalLong)) });
      return Response.json(envelope(payload.model, output));
    } });
  let status = 'completed', reason = null, compiledItems = 0, compiledSha256 = null, stage = 'extract', attemptedQualification = null;
  const recordCompiled = items => { compiledItems = items.length;
    compiledSha256 = createHash('sha256').update(JSON.stringify(items)).digest('hex'); };
  try {
    const output = await callModel(model, 'extract', legacy ? legacyPrompt : retainedPrompt, input);
    const items = extractedItems(output, snapshot, retained?.messages);
    if (!legacy && items.length) {
      stage = 'qualification';
      const candidateSnapshot = createQualificationCandidateSnapshot(items);
      const { countBody, generationBody, ...measurement } = measureCandidateRequest(candidateSnapshot.input);
      attemptedQualification = measurement;
      if (arm === 'whole-batch') {
        const request = input => ({ system: standardInlineQualificationPrompt, input, maxOutputTokens: 1024 });
        let selected = candidateSnapshot.input;
        if (!model.fitsQualificationRequest(request(selected))) {
          selected = createQualificationTextCatalog(selected).catalog;
          const { countBody, generationBody, ...catalog } = measureCandidateRequest(selected);
          attemptedQualification = { inline: measurement, catalog };
          if (!model.fitsQualificationRequest(request(selected))) {
            const error = new Error('whole_batch_unfit'); error.code = 'context_budget_exceeded'; throw error;
          }
        }
        const output = await callModel(model, 'qualifyCandidates', standardInlineQualificationPrompt, selected);
        recordCompiled(compileQualificationCandidates(output, candidateSnapshot));
      } else recordCompiled(await qualifyCandidateItems(model, items));
    } else recordCompiled(items);
  } catch (error) { status = 'refused'; reason = error.code ?? 'unexpected_error'; }
  return { arm, status, reason, failureStage: reason ? stage : null, compiledItems, compiledSha256, extractionPreflight, attemptedQualification,
    exposure: input.messages, calls, httpCalls: bodies.length, countGenerationPairs: calls.length,
    totalSerializedInputTokens: calls.reduce((sum, c) => sum + c.countBodyTokens + c.generationBodyTokens, 0),
    totalGenerationInputTokens: calls.reduce((sum, c) => sum + c.generationBodyTokens, 0),
    totalOutputTokens: calls.reduce((sum, c) => sum + c.outputTokens, 0), diagnostics };
}

export async function buildReport() {
  const rows = [];
  for (const fixture of fixtures) {
    const prepared = prepareCombined(fixture.input);
    const request = measureCombined(prepared);
    const output = scriptedCombined(fixture, prepared);
    const outputTokens = countOpenAITokens(JSON.stringify(output));
    let reason = null, compiledItems = 0;
    try { compiledItems = compileCombined(prepared, output).length; }
    catch (error) { reason = error.code ?? 'unexpected_error'; }
    const feasibleInput = request.logicalTokens <= 6000 && request.countBodyTokens <= 6000;
    const combined = { arm: 'combined', status: reason ? 'refused' : 'completed', reason, compiledItems,
      request, exposure: prepared.requestInput, retainedSourceWindow: prepared.retained.retainedSourceWindow,
      scriptedOutputTokens: outputTokens,
      selectedLegalLongOutputTokens: countOpenAITokens(JSON.stringify(scriptedCombined(fixture, prepared, true))),
      modeledCountGenerationPairs: feasibleInput ? 1 : 0, actualHttpCalls: 0,
      totalSerializedInputTokens: feasibleInput ? request.countBodyTokens + request.generationBodyTokens : 0,
      totalGenerationInputTokens: feasibleInput ? request.generationBodyTokens : 0,
      totalOutputTokens: feasibleInput ? outputTokens : 0 };
    rows.push({ id: fixture.id, sourceMessages: fixture.input.messages,
      arms: [...await Promise.all(['legacy', 'whole-batch', 'bounded-partition'].map(arm => runBaseline(fixture, arm))), combined] });
  }
  return { schemaVersion: 'ingestion-design-offline-v1', fixtureSha256, fixtureDenominator: fixtures.length,
    model: DEFAULT_MODEL, limits,
    provenance: 'Baseline bodies captured through real adapter and core model-call/qualification compiler; combined reconstructed only. No persistence/admission or classification in any arm. Fake provider count/usage120/80 are synthetic, not measurements. Totals use local tokenizer over complete bodies and scripted output, not observed provider tokens or dollars. Refusal work is retained; classification excluded uniformly. Whole-batch uses real adaptive serializer inline then catalog fit; bounded arm uses unchanged core partition capability. Legacy extraction is an unqualified resource control.',
    exposureBoundary: 'Legacy exposes up to4000 units per message, receipts retain800. Qualified and combined expose the same core retainedSourceView800 prefix. Qualifier sees only extracted receipts; combined sees all retained sources before selecting cards. No silent additional truncation.',
    decision: 'revise-before-live-test; structural feasibility and conditional resource counts do not establish interpretation quality or adoption; combined needs a separate reviewed live guard contract',
    fixtures: rows };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.stdout.write(JSON.stringify(await buildReport()) + '\n');
}
