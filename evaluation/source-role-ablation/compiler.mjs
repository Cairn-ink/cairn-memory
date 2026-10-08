// Maintainer-only, fixed synthetic fixtures. No CLI, keys, live fetch or caller transport.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createOpenAIModel } from '../../adapters/openai/index.mjs';
import { DEFAULT_MODEL } from '../../adapters/openai/profiles.mjs';
import { captureSnapshot } from '../../core/capture-input.mjs';
import { extractionRequest, checkExtractionFits } from '../../core/capture.mjs';
import { callModel, modelRequestText } from '../../core/model-call.mjs';
import { extractedWindowItems } from '../../core/source-windows.mjs';
import { MemoryStoreError } from '../../core/validation.mjs';
import { snapshotJson, freeze } from '../longmemeval/mixed-validation.mjs';
import { sourceRoleCases } from './cases.mjs';

const assets = Object.fromEntries(['baseline', 'candidate'].map(arm =>
  [arm, readFileSync(new URL(`./${arm}.md`, import.meta.url), 'utf8')]));
const manifest = JSON.parse(readFileSync(new URL('./frozen-manifest.json', import.meta.url), 'utf8'));
const sha256 = value => createHash('sha256').update(value).digest('hex');
for (const filename of ['cases.mjs', 'baseline.md', 'candidate.md']) {
  if (sha256(readFileSync(new URL(`./${filename}`, import.meta.url))) !== manifest.sha256[filename]) {
    throw new Error('source_role_assets_not_frozen');
  }
}

function options(input, withOutput) {
  const copied = snapshotJson(input, { bytes: 64_000, nodes: 4096, depth: 10 }, 'invalid_source_role_options');
  const keys = withOutput ? ['caseOrdinal', 'arm', 'scriptedOutput'] : ['caseOrdinal', 'arm'];
  if (!copied || typeof copied !== 'object' || Array.isArray(copied) ||
      Object.keys(copied).length !== keys.length || keys.some(key => !Object.hasOwn(copied, key)) ||
      !Number.isSafeInteger(copied.caseOrdinal) || copied.caseOrdinal < 1 || copied.caseOrdinal > 12 ||
      typeof copied.arm !== 'string' || !Object.hasOwn(assets, copied.arm)) throw new Error('invalid_source_role_options');
  return copied;
}

function offlineModel(scriptedOutput, httpBodies) {
  return createOpenAIModel({ apiKey: 'synthetic-offline-not-a-provider-key', extractionModel: DEFAULT_MODEL,
    fetchImpl: async (url, init) => {
      const endpoint = new URL(url).pathname;
      if (!['/v1/responses/input_tokens', '/v1/responses'].includes(endpoint) ||
          init.method !== 'POST' || typeof init.body !== 'string' || httpBodies.length >= 2) {
        throw new Error('unexpected_offline_transport');
      }
      const body = JSON.parse(init.body);
      httpBodies.push({ endpoint, bodyText: init.body });
      if (endpoint.endsWith('/input_tokens')) {
        return Response.json({ object: 'response.input_tokens', input_tokens: 100 });
      }
      return Response.json({ object: 'response', model: body.model, status: 'completed', error: null,
        incomplete_details: null, output: [{ type: 'message', role: 'assistant', status: 'completed',
          content: [{ type: 'output_text', text: JSON.stringify(scriptedOutput) }] }],
        usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120 } });
    } });
}

function prepare(copied, model) {
  const snapshot = captureSnapshot(sourceRoleCases[copied.caseOrdinal - 1].capture,
    undefined, 'indexed-evidence-v1');
  const original = extractionRequest(snapshot, { captureSourcePolicy: 'indexed-evidence-v1' });
  // The sole evaluation variation is selected BEFORE exact fit and dispatch.
  const request = { ...original, system: assets[copied.arm] };
  checkExtractionFits(model, request);
  const envelopeText = modelRequestText(request.system, request.input);
  return { snapshot, catalog: request.catalog, request, envelopeText,
    localInputTokens: model.countTokens(envelopeText) };
}

export function prepareSourceRoleArm(input) {
  const copied = options(input, false);
  return freeze(prepare(copied, offlineModel({ items: [] }, [])));
}

export async function compileSourceRoleArm(input) {
  const copied = options(input, true), httpBodies = [];
  const model = offlineModel(copied.scriptedOutput, httpBodies);
  const prepared = prepare(copied, model);
  const metadata = { caseOrdinal: copied.caseOrdinal, arm: copied.arm,
    localInputTokens: prepared.localInputTokens, envelopeText: prepared.envelopeText,
    caps: { inputTokens: 6000, outputTokens: 1024, items: 5, windowsPerItem: 4, contentUnits: 600 } };
  try {
    const output = await callModel(model, 'extract', prepared.request.system, prepared.request.input,
      { failureCode: 'extraction_failed' });
    // A later invalid item refuses the entire arm; no partial item admission here.
    const items = extractedWindowItems(output, prepared.snapshot, prepared.catalog);
    const passages = [];
    for (const item of items) for (const receipt of item.receipts) {
      const entry = prepared.catalog.entries.find(entry => entry.id === receipt.eventId &&
        entry.role === receipt.role && entry.content === receipt.excerpt);
      if (!entry) throw new Error('offline_receipt_binding_failed');
      if (!passages.some(passage => passage.index === entry.index)) passages.push({
        index: entry.index, messageIndex: entry.messageIndex, messageId: entry.id, role: entry.role,
        start: entry.start, end: entry.end, excerpt: entry.content });
    }
    return freeze({ ...metadata, status: 'completed', items, passages, httpBodies });
  } catch (error) {
    const code = error instanceof MemoryStoreError ? error.code : 'offline_compilation_failed';
    return freeze({ ...metadata, status: 'refused', code, items: [], passages: [], httpBodies });
  }
}
