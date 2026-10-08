// Fixed maintainer study preparation. Sources only; evaluator metadata never enters this module.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { countOpenAITokens, createOpenAIModel } from '../../adapters/openai/index.mjs';
import { DEFAULT_MODEL } from '../../adapters/openai/profiles.mjs';
import { planCaptureMessageBatches } from '../../core/capture-batch-planning.mjs';
import { captureSnapshot } from '../../core/capture-input.mjs';
import { extractionRequest, checkExtractionFits } from '../../core/capture.mjs';
import { callModel, modelRequestText } from '../../core/model-call.mjs';
import { sourceWindowCatalog } from '../../core/source-windows.mjs';
import { snapshotJson, freeze } from '../longmemeval/mixed-validation.mjs';

export const SOURCE_COMPETITION_ASSETS = Object.freeze({
  'sources.json': '264ea389ba745fcb22a9de2b0d3e714da3ed4731a9152e707cdcc2e94c6695bf',
  'evaluator.json': 'c39ea215067f3a67efed12c35d27221ff763460dea43b2d680122e8e2c541416',
  'protocol.md': 'f90858329149fa690b27a9d28eee07dff132411502e9fc7eb01991a5f216a7e3',
});
const bytes = readFileSync(new URL('./sources.json', import.meta.url));
if (createHash('sha256').update(bytes).digest('hex') !== SOURCE_COMPETITION_ASSETS['sources.json']) {
  throw new Error('source_competition_assets_not_frozen');
}
const sources = freeze(JSON.parse(bytes));
const policy = Object.freeze({ captureSourcePolicy: 'indexed-evidence-v1' });
const counter = Object.freeze({ countTokens: countOpenAITokens });
const snapshot = messages => captureSnapshot({
  namespace: { ownerId: 'source-competition', scope: 'personal', projectId: null },
  client: 'private-offline', eventId: 'preparation', sessionId: 'synthetic', messages,
}, undefined, policy.captureSourcePolicy);
const actualPlan = messages => planCaptureMessageBatches({ messages }, { model: counter, ...policy });

function prepareCase(ordinal) {
  const messages = sources.cases[ordinal - 1].messages;
  const baseline = actualPlan(messages);
  if (baseline.oversizedMessageIndices.length || baseline.batches.length !== 1) {
    throw new Error('source_competition_plan_changed');
  }
  const candidate = [];
  for (const group of baseline.batches) {
    let pending = [];
    for (const index of group) {
      const next = [...pending, index];
      if (sourceWindowCatalog(snapshot(next.map(i => messages[i]))).entries.length > 10) {
        candidate.push(pending); pending = [index];
      } else pending = next;
    }
    if (pending.length) candidate.push(pending);
  }
  if (candidate.length !== 2) throw new Error('source_competition_plan_changed');
  for (const indices of candidate) {
    const checked = actualPlan(indices.map(index => messages[index]));
    if (checked.oversizedMessageIndices.length || checked.batches.length !== 1 ||
      checked.batches[0].length !== indices.length ||
      sourceWindowCatalog(snapshot(indices.map(index => messages[index]))).entries.length > 10) {
      throw new Error('source_competition_plan_changed');
    }
  }
  return { messages, control: baseline.batches, candidate };
}

function options(input, withOutput = false) {
  const copied = snapshotJson(input, { bytes: 64_000, nodes: 4096, depth: 10 }, 'invalid_source_competition_options');
  const keys = ['ordinal', 'arm', 'subBatch', ...(withOutput ? ['scriptedOutput'] : [])];
  if (!copied || Array.isArray(copied) || Object.keys(copied).length !== keys.length ||
    keys.some(key => !Object.hasOwn(copied, key)) || !Number.isSafeInteger(copied.ordinal) ||
    copied.ordinal < 1 || copied.ordinal > 8 || !['control', 'candidate'].includes(copied.arm) ||
    !Number.isSafeInteger(copied.subBatch) || copied.subBatch < 1 ||
    copied.subBatch > (copied.arm === 'control' ? 1 : 2)) throw new Error('invalid_source_competition_options');
  return copied;
}

export function prepareSourceCompetitionBatch(input) {
  const copied = options(input), plan = prepareCase(copied.ordinal);
  const messageIndices = plan[copied.arm][copied.subBatch - 1];
  const source = snapshot(messageIndices.map(index => plan.messages[index]));
  // Prompt selection precedes exact fit. No prompt rewriting, truncation or output-aware split.
  const request = extractionRequest(source, policy);
  checkExtractionFits(counter, request);
  return freeze({ ...copied, messageIndices, snapshot: source, catalog: request.catalog, request,
    localInputTokens: countOpenAITokens(modelRequestText(request.system, request.input)) });
}

/** Preparation transport is always this fake HTTP, never global fetch or a caller's live transport. */
export async function compileSourceCompetitionBatch(input) {
  const copied = options(input, true), httpBodies = [];
  const prepared = prepareSourceCompetitionBatch({ ordinal: copied.ordinal, arm: copied.arm, subBatch: copied.subBatch });
  const model = createOpenAIModel({ apiKey: 'synthetic-offline-not-a-provider-key', extractionModel: DEFAULT_MODEL,
    fetchImpl: async (url, init) => {
      const endpoint = new URL(url).pathname;
      if (!['/v1/responses/input_tokens', '/v1/responses'].includes(endpoint) ||
        init.method !== 'POST' || typeof init.body !== 'string' || httpBodies.length >= 2) {
        throw new Error('unexpected_offline_transport');
      }
      httpBodies.push({ endpoint, bodyText: init.body });
      if (endpoint.endsWith('/input_tokens')) return Response.json({ object: 'response.input_tokens', input_tokens: 100 });
      return Response.json({ object: 'response', model: DEFAULT_MODEL, status: 'completed', error: null,
        incomplete_details: null, output: [{ type: 'message', role: 'assistant', status: 'completed',
          content: [{ type: 'output_text', text: JSON.stringify(copied.scriptedOutput) }] }],
        usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120 } });
    } });
  checkExtractionFits(model, prepared.request);
  const output = await callModel(model, 'extract', prepared.request.system, prepared.request.input,
    { failureCode: 'extraction_failed' });
  return freeze({ ...prepared, output, httpBodies });
}
