import { createOpenAIModel, countOpenAITokens } from '../../adapters/openai/index.mjs';
import { DEFAULT_MODEL } from '../../adapters/openai/profiles.mjs';
import { captureSnapshot, retainedSourceView, extractedItems } from '../../core/capture-input.mjs';
import { callModel } from '../../core/model-call.mjs';
import { qualifyCandidateItems } from '../../core/qualification-candidates.mjs';
import { createCaptureDeadline } from '../../core/capture-deadline.mjs';
import { retainedPrompt, prepareCombined, compileCombined } from '../ingestion-design/combined.mjs';
import { combinedBodies, probeLimits } from './transport.mjs';

const fail = code => { const error = new Error(code); error.code = code; throw error; };
const deeplyFrozen = value => !value || typeof value !== 'object'
  || (Object.isFrozen(value) && Object.values(value).every(deeplyFrozen));
function decodeCombined(body) {
  let response;
  try { response = JSON.parse(body); } catch { fail('invalid_model_output'); }
  const usage = response?.usage;
  if (response?.object !== 'response' || response.model !== DEFAULT_MODEL || response.status !== 'completed'
    || response.error !== null || response.incomplete_details !== null || !Array.isArray(response.output) || !response.output.length
    || !usage || !['input_tokens', 'output_tokens', 'total_tokens'].every(k => Number.isSafeInteger(usage[k]) && usage[k] >= 0)
    || usage.input_tokens > 7024 || usage.output_tokens > 1024 || usage.total_tokens !== usage.input_tokens + usage.output_tokens) fail('invalid_model_output');
  let text = '';
  for (const message of response.output) {
    if (message.type !== 'message' || message.role !== 'assistant' || message.status !== 'completed'
      || !Array.isArray(message.content) || !message.content.length) fail('invalid_model_output');
    for (const part of message.content) {
      if (part.type !== 'output_text' || typeof part.text !== 'string') fail('invalid_model_output');
      text += part.text;
      if (text.length > 40_000) fail('invalid_model_output');
    }
  }
  if (!text || countOpenAITokens(text) > 1024) fail('invalid_model_output');
  try { return JSON.parse(text); } catch { fail('invalid_model_output'); }
}

/** Run only explicitly supplied, frozen source fixtures; no oracle/rubric import. */
export async function runIngestionSemanticProbe({ fixtures, transport, onArm = () => {} } = {}) {
  if (!Array.isArray(fixtures) || fixtures.length !== 12 || !deeplyFrozen(fixtures)
    || new Set(fixtures.map(f => f.id)).size !== 12 || fixtures.some(f => typeof f.id !== 'string'
      || !Object.isFrozen(f) || !Object.isFrozen(f.input)) || typeof onArm !== 'function') fail('invalid_probe_fixtures');
  const started = performance.now(), attempts = [];
  for (let repetition = 0; repetition < 2; repetition += 1) {
    for (let index = 0; index < fixtures.length; index += 1) {
      const fixture = fixtures[index];
      const order = (index + repetition) % 2 ? ['combined', 'baseline'] : ['baseline', 'combined'];
      for (const arm of order) {
        transport.assertHealthy();
        if (performance.now() - started >= probeLimits.probeMs) fail('probe_deadline');
        const armStarted = performance.now(), before = transport.records().length;
        const deadline = createCaptureDeadline(Math.floor(Math.min(probeLimits.armMs,
          Math.max(1, probeLimits.probeMs - (armStarted - started)))));
        const row = { id: fixture.id, repetition, arm, status: 'failed', reason: null,
          failureStage: null, compiledItems: [], records: [] };
        let stage = arm === 'baseline' ? 'extract' : 'combined';
        transport.beginArm({ id: fixture.id, repetition, name: arm, input: fixture.input });
        try {
          if (arm === 'baseline') {
            const adapter = createOpenAIModel({ apiKey: 'guard-owns-credential', qualificationInputMode: 'adaptive-text-catalog-v1',
              fetchImpl: transport.fetch });
            const wrapped = { contextWindow: adapter.contextWindow, countTokens: adapter.countTokens,
              fitsQualificationRequest: adapter.fitsQualificationRequest,
              extract: async request => { await transport.prepareMethod('extract', request); return adapter.extract(request); },
              qualifyCandidates: async request => { await transport.prepareMethod('qualifyCandidates', request); return adapter.qualifyCandidates(request); } };
            const snapshot = captureSnapshot(fixture.input, 'source-bound-v2'), retained = retainedSourceView(snapshot);
            const input = { messages: retained.messages.map(({ role, content }, index) => ({ index, role, content })) };
            const output = await callModel(wrapped, 'extract', retainedPrompt, input, { deadline });
            const items = extractedItems(output, snapshot, retained.messages);
            if (items.length) { stage = 'qualification'; row.compiledItems = await qualifyCandidateItems(wrapped, items, deadline); }
            else row.compiledItems = [];
          } else {
            const prepared = prepareCombined(fixture.input), bodies = combinedBodies(prepared);
            await transport.prepareMethod('evaluation_combined_v1');
            const controller = new AbortController(), timer = setTimeout(() => controller.abort(), deadline.remainingMs(probeLimits.armMs));
            const post = async (endpoint, body) => {
              const response = await transport.fetch(`https://api.openai.com/v1/responses${endpoint}`, {
                method: 'POST', redirect: 'error', signal: controller.signal, body });
              if (!response.ok) fail('provider_failure');
              return response.text();
            };
            try {
              let count;
              try { count = JSON.parse(await post('/input_tokens', bodies.count)); } catch { fail('token_count_unavailable'); }
              if (count.object !== 'response.input_tokens' || !Number.isSafeInteger(count.input_tokens) || count.input_tokens < 0) fail('token_count_unavailable');
              if (count.input_tokens > 7024) fail('context_budget_exceeded');
              const output = decodeCombined(await post('', bodies.generation));
              row.compiledItems = compileCombined(prepared, output);
            } finally { clearTimeout(timer); }
          }
          deadline.check(); row.status = 'completed';
        } catch (error) {
          row.reason = error?.name === 'AbortError' ? 'model_timeout' : error?.code ?? 'provider_failure';
          row.failureStage = stage; row.compiledItems = [];
        } finally {
          row.latencyMs = performance.now() - armStarted;
          row.records = transport.records().slice(before);
          attempts.push(row);
        }
        // Core deliberately launders provider errors. The independent transport
        // latch preserves fatal accounting/authentication/HTTP authority failures.
        try { await onArm(structuredClone(row)); } catch { fail('probe_persistence_failure'); }
        transport.assertHealthy();
        transport.endArm();
      }
    }
  }
  const state = transport.state();
  const finalBudget = Object.fromEntries(['schemaVersion', 'runId', 'limitMicroUsd', 'requestCap',
    'reservedMicroUsd', 'requestCount', 'state', 'historySha256'].map(field => [field, state[field]]));
  return { schemaVersion: 'ingestion-semantic-probe-v1', model: DEFAULT_MODEL, repetitions: 2,
    fixtureDenominator: 12, attemptDenominatorPerArm: 24, attempts,
    records: transport.records(), finalBudget, latencyMs: performance.now() - started };
}
