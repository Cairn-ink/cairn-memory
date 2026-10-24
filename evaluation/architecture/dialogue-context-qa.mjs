import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { performance } from 'node:perf_hooks';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';
import { countTokens } from '../../core/model-budget.mjs';
import { captureSnapshot } from '../../core/capture-input.mjs';
import { MemoryStoreError } from '../../core/validation.mjs';
import { PUBLIC_ANSWER_INSTRUCTION } from '../longmemeval/public-comparison.mjs';
import { createNeighborSourceBinding, resolveNeighborSourceBinding } from './neighbor-source-binding.mjs';

export const DIALOGUE_CONTEXT_ANSWER_INSTRUCTION = PUBLIC_ANSWER_INSTRUCTION + ' ' + [
  'Each source is an exact quotation attributed to its speaker.',
  'Retention role describes how a passage was retained, not its truth, support for another statement, or adoption.',
  'Preserve attribution, conditions, rejection, corrections, and whether a suggestion was adopted.',
].join(' ');
const safeCodes = new Set(['invalid_model_output', 'extraction_failed', 'classification_failed',
  'model_timeout', 'model_cancelled', 'context_budget_exceeded', 'token_count_unavailable',
  'storage_error', 'storage_busy', 'revision_conflict', 'index_revision_conflict',
  'stale_admission', 'event_payload_conflict', 'source_binding_failed', 'answer_failed']);
const persistenceCodes = new Set(['storage_error', 'storage_busy', 'revision_conflict',
  'index_revision_conflict', 'stale_admission', 'event_payload_conflict', 'source_binding_failed']);
const safe = (error, fallback) => safeCodes.has(error?.code) ? error.code : fallback;
const now = () => performance.now();
const elapsed = start => Math.max(0, now() - start);
const bytes = text => Buffer.byteLength(text, 'utf8');
const requestOf = ({ system, input, maxOutputTokens }) => structuredClone({ system, input, maxOutputTokens });
const exact = (value, keys) => value && Object.getPrototypeOf(value) === Object.prototype &&
  Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const normalText = (value, max) => typeof value === 'string' && value.isWellFormed() &&
  value.length > 0 && value.length <= max && value.trim() === value && !/[\x00-\x1f\x7f]/u.test(value);
class Boundary extends Error { constructor(code) { super(code); this.code = code; } }
const failure = code => { throw new Boundary(code); };
const captureInputFor = source => ({
  namespace: { ownerId: 'dialogue-context-qa', scope: 'personal', projectId: null },
  client: 'dialogue-context-qa', sessionId: `case-${source.id}`, eventId: `capture-${source.id}`,
  messages: source.messages.map((message, index) => ({ id: `source-${index}`, ...message })),
});
const selectedAnchors = arm => arm.coldResolution.resolved
  .filter(entry => entry.provenanceRole === 'extractor-selected')
  .map(entry => ({ itemIndex: entry.itemIndex, windowIndex: entry.windowIndex,
    speaker: entry.receipt.role, text: entry.receipt.excerpt }));

function sourceFixture(raw) {
  let fixture;
  try { fixture = structuredClone(raw); } catch { failure('invalid_fixture'); }
  if (!exact(fixture, ['version', 'cases']) || fixture.version !== 'dialogue-context-qa-v1' ||
      !Array.isArray(fixture.cases) || fixture.cases.length < 1 || fixture.cases.length > 24 ||
      Object.keys(fixture.cases).length !== fixture.cases.length) failure('invalid_fixture');
  const seen = new Set();
  for (const row of fixture.cases) {
    if (!exact(row, ['id', 'messages', 'question']) || typeof row.id !== 'string' || !/^[a-f0-9]{12}$/u.test(row.id) || seen.has(row.id) ||
        !normalText(row.question, 300) || !Array.isArray(row.messages) || row.messages.length < 1 ||
        row.messages.length > 6 || Object.keys(row.messages).length !== row.messages.length ||
        Array.from(row.messages).some((message, index) => !exact(message, ['role', 'content']) ||
          message.role !== (index % 2 ? 'assistant' : 'user') || !normalText(message.content, 600)) ||
        row.messages.reduce((sum, message) => sum + message.content.length, row.question.length) > 2200) {
      failure('invalid_fixture');
    }
    try {
      const canonical = captureSnapshot(captureInputFor(row), undefined, 'indexed-evidence-v1');
      if (canonical.messages.some(message => message.content.length > 600)) failure('invalid_fixture');
    } catch { failure('invalid_fixture'); }
    seen.add(row.id);
  }
  return fixture;
}

function pack(resolution, question, counter) {
  const ordered = ['extractor-selected', 'dialogue-context'].flatMap(role =>
    resolution.resolved.filter(row => row.provenanceRole === role));
  const unique = new Map();
  for (const row of ordered) if (!unique.has(row.windowIndex)) unique.set(row.windowIndex, {
    sourceId: `window-${row.windowIndex}`, speaker: row.receipt.role,
    retentionRole: row.provenanceRole, text: row.receipt.excerpt });
  const request = { system: DIALOGUE_CONTEXT_ANSWER_INSTRUCTION, input: { sources: [], question }, maxOutputTokens: 512 };
  const measured = () => countTokens(counter, JSON.stringify(request));
  if (measured() > 4000) failure('context_budget_exceeded');
  const includedIds = [], omittedIds = [];
  let includedBytes = 0, omittedBytes = 0;
  for (const source of unique.values()) {
    request.input.sources.push(source);
    if (measured() > 4000) {
      request.input.sources.pop(); omittedIds.push(source.sourceId); omittedBytes += bytes(source.text);
    } else { includedIds.push(source.sourceId); includedBytes += bytes(source.text); }
  }
  return { request, includedIds, omittedIds, includedBytes, omittedBytes,
    includedCount: includedIds.length, omittedCount: omittedIds.length,
    retainedCount: unique.size, retainedBytes: includedBytes + omittedBytes, inputTokens: measured() };
}

/** Offline orchestration only. Transport accounting/credentials remain outside this runner. */
export async function runDialogueContextQa({ fixture: raw, model, answer, onRecord, assertActive }) {
  const fixture = sourceFixture(raw);
  if (typeof onRecord !== 'function' || typeof assertActive !== 'function' || typeof answer !== 'function' ||
      !model || ['extract', 'classify', 'countTokens'].some(key => typeof model[key] !== 'function') ||
      !Number.isSafeInteger(model.contextWindow) || model.contextWindow < 8192) failure('invalid_options');
  const started = now();
  let fatal = null;
  const stop = code => { fatal ??= code; throw new Boundary(fatal); };
  const syncResult = result => {
    if (result && typeof result.then === 'function') {
      Promise.resolve(result).catch(() => {}); // Reject async callbacks without an unhandled rejection.
      return false;
    }
    return true;
  };
  const active = () => {
    if (fatal) throw new Boundary(fatal);
    try { if (!syncResult(assertActive())) throw new Error(); }
    catch { stop('assert_active_failed'); }
  };
  const emit = event => {
    try { if (!syncResult(onRecord(structuredClone(event)))) throw new Error(); }
    catch { stop('record_failed'); }
  };
  const finalRecord = event => { try { emit(event); } catch { /* Fatal latch survives final observer failure. */ } };
  const originalCounter = model.countTokens.bind(model);
  const counter = { countTokens(text) { active(); const result = originalCounter(text); active(); return result; } };
  const counts = { extract: 0, classify: 0, answer: 0, replays: 0 };
  const finalizedCases = new Set();
  const rows = fixture.cases.map((row, index) => ({ id: row.id,
    order: index % 2 ? ['candidate', 'baseline'] : ['baseline', 'candidate'],
    sharedExtraction: { status: 'not-run', request: null, output: null, reason: null, replays: 0 },
    ...Object.fromEntries(['baseline', 'candidate'].map(arm => [arm, {
      status: 'not-run', reason: null, failedPhase: null, capture: null, transformedOutput: null,
      binding: null, coldResolution: null, packed: null, answer: null, answerOutput: null,
      classificationOutput: null, cleanupCompleted: true,
      modelCalls: { extract: 0, classify: 0, answer: 0 }, durations: {} }])) }));
  const run = { status: 'completed', reason: null, rows, counts, caseCount: rows.length,
    completedArms: 0, failedArms: 0, notRunArms: 0, durationMs: 0 };
  const physical = async (caseId, armName, arm, phase, port, wire, deadline, retainOutput) => {
    active();
    const request = requestOf(wire);
    emit({ kind: 'model-start', caseId, arm: armName, phase, request });
    active();
    const callStart = now();
    try {
      const invocation = Promise.resolve().then(() => {
        active(); counts[phase]++; arm.modelCalls[phase]++;
        return port({ ...structuredClone(request), signal: wire.signal });
      });
      const output = await (deadline ? Promise.race([invocation, deadline]) : invocation);
      const detached = structuredClone(output);
      retainOutput?.(detached); // Retain received bytes even if the post-call operator check stops the run.
      active();
      emit({ kind: 'model-output', caseId, arm: armName, phase, output: detached });
      active(); return detached;
    } catch (error) {
      active();
      emit({ kind: 'model-failure', caseId, arm: armName, phase, reason: safe(error, `${phase === 'answer' ? 'answer' : phase === 'extract' ? 'extraction' : 'classification'}_failed`) });
      active(); throw error;
    } finally { arm.durations[phase] = elapsed(callStart); }
  };
  let openMemoryCore;
  try {
    active(); ({ openMemoryCore } = await import('../../core/contract.mjs')); active();
    for (const [caseIndex, source] of fixture.cases.entries()) {
      active();
      const row = rows[caseIndex], caseStart = now();
      const captureInput = captureInputFor(source), namespace = captureInput.namespace;
      for (const armName of row.order) {
        active();
        const arm = row[armName], armStart = now();
        let workspace, phase = 'capture';
        arm.cleanupCompleted = false;
        try {
          workspace = createTestWorkspace(null, { prefix: 'dialogue-context-qa-' });
          const path = join(workspace.path, 'memory.sqlite');
          const binding = createNeighborSourceBinding(captureInput, {
            enabled: armName === 'candidate', countTokens: counter.countTokens });
          const wrapped = { contextWindow: model.contextWindow, countTokens: counter.countTokens,
            async extract(wire) {
              active(); phase = 'extract';
              const request = requestOf(wire), shared = row.sharedExtraction;
              let output;
              if (shared.status === 'not-run') {
                shared.request = structuredClone(request); shared.status = 'started';
                try {
                  output = await physical(row.id, armName, arm, 'extract', model.extract.bind(model), wire, null,
                    received => { shared.output = structuredClone(received); shared.status = 'output'; });
                  active();
                } catch (error) {
                  if (shared.status !== 'output') shared.status = 'failed';
                  shared.reason = fatal ?? safe(error, 'extraction_failed'); throw error;
                }
              } else {
                if (!isDeepStrictEqual(shared.request, request)) stop('shared_request_mismatch');
                shared.replays++; counts.replays++;
                emit({ kind: 'extraction-replay', caseId: row.id, arm: armName,
                  request, status: shared.status, output: shared.output, reason: shared.reason });
                active();
                if (shared.status !== 'output') throw new MemoryStoreError(shared.reason ?? 'extraction_failed');
                output = structuredClone(shared.output);
              }
              active(); arm.transformedOutput = binding.transform(wire, output);
              return arm.transformedOutput;
            },
            async classify(wire) {
              active(); phase = 'classify';
              const output = await physical(row.id, armName, arm, 'classify', model.classify.bind(model), wire, null,
                received => { arm.classificationOutput = structuredClone(received); });
              active(); return output;
            } };
          const writer = openMemoryCore({ path, model: wrapped, captureSourcePolicy: 'indexed-evidence-v1' });
          workspace.defer(() => writer.close());
          active(); arm.capture = await writer.capture(structuredClone(captureInput)); active();
          if (!arm.capture.ok) failure(safe(arm.capture.error, 'storage_error'));
          if (arm.capture.value.classification.status === 'failed') {
            phase = 'classify'; failure(safe(arm.capture.value.classification.error, 'classification_failed'));
          }
          phase = 'source-binding';
          arm.binding = binding.bind(writer, arm.capture);
          writer.close();
          emit({ kind: 'source-bound', caseId: row.id, arm: armName, binding: arm.binding }); active();
          const cold = openMemoryCore({ path, model: { countTokens: counter.countTokens }, captureSourcePolicy: 'indexed-evidence-v1' });
          workspace.defer(() => cold.close());
          arm.coldResolution = resolveNeighborSourceBinding(cold, namespace, arm.binding.sidecar, arm.binding.expectedDigest);
          active();
          if (arm.coldResolution.rejected.length || arm.coldResolution.resolved.length !== arm.binding.sidecar.entries.length) {
            failure('source_binding_failed');
          }
          // Report-only identity comes from authoritative cold get, never a guessed window/message mapping.
          for (const entry of arm.coldResolution.resolved) {
            const detail = cold.get({ namespace, memoryId: entry.memoryId, receiptLimit: 100 });
            const sourceReceipt = detail.ok && detail.value.receipts.find(receipt => receipt.id === entry.receipt.id);
            const bound = arm.binding.sidecar.entries.find(row => row.itemIndex === entry.itemIndex &&
              row.windowIndex === entry.windowIndex && row.memoryId === entry.memoryId && row.receiptId === entry.receipt.id);
            if (!detail.ok || !detail.value.exhausted || detail.value.memory.revision !== entry.revision ||
                !sourceReceipt || !bound || sourceReceipt.role !== entry.receipt.role ||
                sourceReceipt.excerpt !== entry.receipt.excerpt || sourceReceipt.client !== captureInput.client ||
                sourceReceipt.sessionId !== captureInput.sessionId || sourceReceipt.eventId !== `source-${bound.messageIndex}`) {
              failure('source_binding_failed');
            }
            Object.assign(entry.receipt, { client: sourceReceipt.client,
              sessionId: sourceReceipt.sessionId, eventId: sourceReceipt.eventId });
          }
          const other = row[armName === 'baseline' ? 'candidate' : 'baseline'];
          if (other.coldResolution && !isDeepStrictEqual(selectedAnchors(arm), selectedAnchors(other))) {
            failure('source_binding_failed');
          }
          phase = 'pack';
          arm.packed = pack(arm.coldResolution, source.question, counter); active();
          phase = 'answer';
          const controller = new AbortController();
          let timer;
          const deadline = new Promise((_, reject) => { timer = setTimeout(() => {
            controller.abort(); reject(new MemoryStoreError('model_timeout'));
          }, 60_000); });
          try {
            active(); const output = await physical(row.id, armName, arm, 'answer', answer,
              { ...arm.packed.request, signal: controller.signal }, deadline,
              received => { arm.answerOutput = structuredClone(received); }); active();
            if (!exact(output, ['answer']) || typeof output.answer !== 'string' || !output.answer.trim() || !output.answer.isWellFormed() ||
                JSON.stringify(output).length > 40_000 || countTokens(counter, JSON.stringify(output)) > 512) {
              failure('invalid_model_output');
            }
            arm.answer = output.answer;
          } finally { clearTimeout(timer); }
          arm.status = 'completed';
        } catch (error) {
          arm.status = 'failed'; arm.failedPhase = phase;
          arm.reason = fatal ?? safe(error, ({ 'source-binding': 'source_binding_failed',
            answer: 'answer_failed', extract: 'extraction_failed', classify: 'classification_failed' })[phase] ?? 'storage_error');
          if (persistenceCodes.has(arm.reason)) fatal ??= arm.reason;
        } finally {
          if (workspace) {
            try { if (!fatal) active(); } catch { /* Cleanup remains mandatory after an operator stop. */ }
            try { await workspace.cleanup(); arm.cleanupCompleted = true; }
            catch { arm.cleanupCompleted = false; arm.status = 'failed'; arm.failedPhase = 'cleanup'; arm.reason = 'cleanup_failed'; fatal = 'cleanup_failed'; }
            try { if (!fatal) active(); } catch { /* The fatal latch records the post-cleanup stop. */ }
          }
          arm.durations.total = elapsed(armStart);
          finalRecord({ kind: 'arm-final', caseId: row.id, arm: armName, result: arm });
        }
        if (fatal) break;
        active();
      }
      row.durationMs = elapsed(caseStart);
      if (!fatal) active();
      finalRecord({ kind: 'case-final', caseId: row.id, result: row }); finalizedCases.add(row.id);
      if (fatal) break;
    }
  } catch (error) { fatal ??= safe(error, 'storage_error'); }
  // Include untouched arms/cases in the denominator, even after a fatal callback.
  for (const row of rows) {
    for (const armName of row.order) {
      const arm = row[armName];
      if (arm.status === 'not-run') finalRecord({ kind: 'arm-final', caseId: row.id, arm: armName, result: arm });
      if (arm.status === 'completed') run.completedArms++;
      else if (arm.status === 'failed') run.failedArms++;
      else run.notRunArms++;
    }
    if (!finalizedCases.has(row.id)) finalRecord({ kind: 'case-final', caseId: row.id, result: row });
  }
  run.status = fatal ? 'stopped' : 'completed'; run.reason = fatal; run.durationMs = elapsed(started);
  finalRecord({ kind: 'run-final', result: run });
  if (fatal) { run.status = 'stopped'; run.reason = fatal; }
  return run;
}
