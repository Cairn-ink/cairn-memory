import { readFileSync } from 'node:fs';
import { createOpenAIModel } from '../../adapters/openai/index.mjs';
import { DEFAULT_MODEL } from '../../adapters/openai/profiles.mjs';
import { captureSnapshot, retainedSourceView, extractedItems } from '../../core/capture-input.mjs';
import { callModel } from '../../core/model-call.mjs';
import { qualifyCandidateItems } from '../../core/qualification-candidates.mjs';
import { createCaptureDeadline } from '../../core/capture-deadline.mjs';
import { probeLimits } from '../ingestion-semantic/transport.mjs';

const extractionPrompt = readFileSync(new URL('../../core/prompts/extract-retained-sources.md', import.meta.url), 'utf8');
const fail = code => { const error = new Error(code); error.code = code; throw error; };
// Source fixtures are plain immutable data, never accessors, cyclic objects or
// evaluator payloads. Validate the entire cohort before starting any arm.
function frozenData(value, seen = new Set()) {
  if (value === null || typeof value !== 'object') return ['string', 'number', 'boolean'].includes(typeof value) || value === null;
  if (seen.has(value) || !Object.isFrozen(value)
    || (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype)) return false;
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) {
    if (Array.isArray(value) && key === 'length') continue;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (typeof key !== 'string' || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')
      || !frozenData(descriptor.value, seen)) return false;
  }
  seen.delete(value);
  return true;
}
function sourceFixtures(fixtures) {
  try {
    if (!Array.isArray(fixtures) || fixtures.length !== 12 || !frozenData(fixtures)) fail('invalid_probe_fixtures');
    const ids = new Set();
    return Array.from(fixtures, fixture => {
      if (!fixture || Object.keys(fixture).length !== 2 || !Object.hasOwn(fixture, 'input')
        || typeof fixture.id !== 'string' || !fixture.id.length || fixture.id.length > 128 || ids.has(fixture.id)
        || !fixture.input || Object.keys(fixture.input).some(key => !['namespace', 'client', 'sessionId', 'eventId', 'messages', 'causal'].includes(key))) fail('invalid_probe_fixtures');
      ids.add(fixture.id);
      const snapshot = captureSnapshot(fixture.input, 'source-bound-v2');
      const retained = retainedSourceView(snapshot);
      if (retained.retainedSourceWindow.truncatedMessageIndices.length) fail('invalid_probe_fixtures');
      return { id: fixture.id, input: fixture.input, snapshot, retained };
    });
  } catch { fail('invalid_probe_fixtures'); }
}

/** Baseline-only diagnostic; importing never loads fixtures, a rubric or credentials. */
export async function runQualificationMeaningProbe({ fixtures, transport, onArm = () => {} } = {}) {
  const cohort = sourceFixtures(fixtures);
  if (typeof onArm !== 'function') fail('invalid_probe_configuration');
  const started = performance.now(), attempts = [];
  for (let repetition = 0; repetition < 2; repetition += 1) {
    for (const fixture of cohort) {
      transport.assertHealthy();
      if (performance.now() - started >= probeLimits.probeMs) fail('probe_deadline');
      const armStarted = performance.now(), before = transport.records().length;
      const deadline = createCaptureDeadline(Math.floor(Math.min(probeLimits.armMs,
        Math.max(1, probeLimits.probeMs - (armStarted - started)))));
      const row = { id: fixture.id, repetition, arm: 'baseline', status: 'failed', reason: null,
        failureStage: null, compiledItems: [], records: [] };
      let stage = 'extract';
      transport.beginArm({ id: fixture.id, repetition, name: 'baseline', input: fixture.input });
      try {
        const adapter = createOpenAIModel({ apiKey: 'guard-owns-credential',
          qualificationInputMode: 'adaptive-text-catalog-v1', fetchImpl: transport.fetch });
        const wrapped = { contextWindow: adapter.contextWindow, countTokens: adapter.countTokens,
          fitsQualificationRequest: adapter.fitsQualificationRequest,
          extract: async request => { await transport.prepareMethod('extract', request); return adapter.extract(request); },
          qualifyCandidates: async request => { await transport.prepareMethod('qualifyCandidates', request); return adapter.qualifyCandidates(request); } };
        const input = { messages: fixture.retained.messages.map(({ role, content }, index) => ({ index, role, content })) };
        const output = await callModel(wrapped, 'extract', extractionPrompt, input, { deadline });
        const items = extractedItems(output, fixture.snapshot, fixture.retained.messages);
        if (items.length) {
          stage = 'qualification';
          row.compiledItems = await qualifyCandidateItems(wrapped, items, deadline);
        }
        deadline.check();
        row.status = 'completed';
      } catch (error) {
        row.reason = error?.name === 'AbortError' ? 'model_timeout' : error?.code ?? 'provider_failure';
        row.failureStage = stage;
        row.compiledItems = [];
      } finally {
        row.latencyMs = performance.now() - armStarted;
        row.records = transport.records().slice(before);
        attempts.push(row);
      }
      try { await onArm(structuredClone(row)); } catch { fail('probe_persistence_failure'); }
      // Preserve the failed row first, then propagate independent authority that
      // the core deliberately removes from untrusted model errors.
      transport.assertHealthy();
      transport.endArm();
    }
  }
  const state = transport.state();
  const finalBudget = Object.fromEntries(['schemaVersion', 'runId', 'limitMicroUsd', 'requestCap',
    'reservedMicroUsd', 'requestCount', 'state', 'historySha256'].map(field => [field, state[field]]));
  return { schemaVersion: 'qualification-meaning-probe-v1', model: DEFAULT_MODEL, repetitions: 2,
    fixtureDenominator: 12, attemptDenominator: 24, attempts,
    records: transport.records(), finalBudget, latencyMs: performance.now() - started };
}
