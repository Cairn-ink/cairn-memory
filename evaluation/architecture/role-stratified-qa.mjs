import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { statSync } from 'node:fs';
import { isDeepStrictEqual, types } from 'node:util';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';
import { captureSnapshot } from '../../core/capture-input.mjs';
import { sourceWindowCatalog } from '../../core/source-windows.mjs';
import { countTokens } from '../../core/model-budget.mjs';
import { isCoreModelDeadlineSignal } from '../../core/model-call.mjs';
import { boundedText, identifier, revision, MemoryStoreError } from '../../core/validation.mjs';
import { placementProposal } from '../../core/placement-input.mjs';
import { PUBLIC_ANSWER_INSTRUCTION } from '../longmemeval/public-comparison.mjs';

export const ROLE_STRATIFIED_QA_REPORT_VERSION = 'role-stratified-qa-report-v1';
export const ROLE_STRATIFIED_ANSWER_INSTRUCTION = PUBLIC_ANSWER_INSTRUCTION + ' ' +
  'Each source is an exact quotation attributed to its speaker. Preserve attribution, conditions, rejection, corrections, and whether a suggestion was adopted.';
const POLICY = Object.freeze({ captureSourcePolicy: 'indexed-evidence-v1' });
const knownCodes = new Set(['invalid_model_output', 'extraction_failed', 'classification_failed',
  'model_timeout', 'model_cancelled', 'context_budget_exceeded', 'token_count_unavailable', 'answer_failed']);
const now = () => performance.now();
const bytes = text => Buffer.byteLength(text, 'utf8');
const elapsed = start => Math.max(0, now() - start);
class Boundary extends Error { constructor(code) { super(code); this.code = code; } }
const fail = code => { throw new Boundary(code); };
const exact = (value, keys) => value && Object.getPrototypeOf(value) === Object.prototype &&
  Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const text = (value, max) => typeof value === 'string' && value.isWellFormed() &&
  value.length > 0 && value.length <= max;
const sourceText = (value, max) => text(value, max) && !/[\x00-\x1f\x7f]/u.test(value);
const wireOf = ({ system, input, maxOutputTokens }) => ({ system, input, maxOutputTokens });

// Copy before serialization, including synchronous port returns. Never run a
// model-owned accessor/toJSON/then while observing its output.
function jsonCopy(value, maximum = 1_000_000) {
  let remaining = maximum;
  const path = new Set();
  function copy(node, depth) {
    if (--remaining < 0 || depth > 32) fail('invalid_model_output');
    if (node === null || typeof node === 'boolean') return node;
    if (typeof node === 'string') {
      remaining -= node.length;
      if (remaining < 0 || !node.isWellFormed()) fail('invalid_model_output');
      return node;
    }
    if (typeof node === 'number' && Number.isFinite(node)) return node;
    if (!node || typeof node !== 'object' || types.isProxy(node) || path.has(node)) fail('invalid_model_output');
    const array = Array.isArray(node);
    if (Object.getPrototypeOf(node) !== (array ? Array.prototype : Object.prototype) &&
        (array || Object.getPrototypeOf(node) !== null)) fail('invalid_model_output');
    path.add(node);
    const result = array ? [] : {};
    const keys = Reflect.ownKeys(node).filter(key => !(array && key === 'length'));
    if (array && (keys.length !== node.length || keys.some((key, i) => key !== String(i)))) fail('invalid_model_output');
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(node, key);
      if (typeof key !== 'string' || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) fail('invalid_model_output');
      remaining -= key.length;
      Object.defineProperty(result, key, { enumerable: true, writable: true, configurable: true,
        value: copy(descriptor.value, depth + 1) });
    }
    path.delete(node);
    return result;
  }
  const result = copy(value, 0);
  if (JSON.stringify(result).length > maximum) fail('invalid_model_output');
  return result;
}

const captureFor = row => ({ namespace: { ownerId: 'role-stratified-qa', scope: 'personal', projectId: null },
  client: 'role-stratified-qa', sessionId: `case-${row.id}`, eventId: `capture-${row.id}`,
  messages: row.messages.map((message, index) => ({ id: `source-${index}`, ...message })) });

const freeze = value => {
  if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
  return value;
};

/** Pure fixture validation for preflight; no ports, environment or stores. */
export function parseRoleStratifiedQaFixture(fixtureJson) {
  if (typeof fixtureJson !== 'string' || fixtureJson.length > 2_500_000 || !fixtureJson.isWellFormed()) fail('invalid_fixture');
  let fixture;
  try { fixture = JSON.parse(fixtureJson); } catch { fail('invalid_fixture'); }
  if (!exact(fixture, ['version', 'cases']) || fixture.version !== 'role-stratified-qa-v1' ||
      !Array.isArray(fixture.cases) || fixture.cases.length < 1 || fixture.cases.length > 24) fail('invalid_fixture');
  const ids = new Set();
  for (const row of fixture.cases) {
    if (!exact(row, ['id', 'messages', 'question']) || typeof row.id !== 'string' || !/^[0-9a-f]{12}$/u.test(row.id) ||
        ids.has(row.id) || !sourceText(row.question, 300) || !Array.isArray(row.messages) ||
        row.messages.length < 1 || row.messages.length > 12 || row.messages.some(message =>
          !exact(message, ['role', 'content']) || !['user', 'assistant'].includes(message.role) || !sourceText(message.content, 4000)) ||
        row.messages.reduce((sum, message) => sum + message.content.length, 0) > 20_000) fail('invalid_fixture');
    const roles = new Set(row.messages.map(message => message.role));
    if (roles.size === 1 ? row.messages.length > 6 : row.messages.some((message, i) => message.role !== (i % 2 ? 'assistant' : 'user'))) fail('invalid_fixture');
    try {
      const snapshot = captureSnapshot(captureFor(row), undefined, POLICY.captureSourcePolicy);
      if (snapshot.messages.some((message, i) => message.content !== row.messages[i].content) ||
          row.question !== boundedText(row.question, 300)) fail('invalid_fixture');
      sourceWindowCatalog(snapshot);
    } catch { fail('invalid_fixture'); }
    ids.add(row.id);
  }
  return freeze(fixture);
}

/** Deterministic capture envelope shared by runner and independent preflight. */
export function roleStratifiedQaCapture(source) {
  let row;
  try {
    row = jsonCopy(source, 100_000);
    parseRoleStratifiedQaFixture(JSON.stringify({ version: 'role-stratified-qa-v1', cases: [row] }));
  } catch { fail('invalid_fixture'); }
  return freeze(captureFor(row));
}

function readRevisions(result, classificationOutput) {
  try {
    if (!Array.isArray(result.admission.memories) || result.admission.memories.length > 5) fail('source_binding_failed');
    const expected = new Map();
    for (const admitted of result.admission.memories) {
      if (!exact(admitted, ['id', 'revision']) || expected.has(identifier(admitted.id))) fail('source_binding_failed');
      expected.set(admitted.id, revision(admitted.revision));
    }
    const classification = result.classification;
    if (!['applied', 'failed', 'skipped'].includes(classification?.status)) fail('source_binding_failed');
    if (classification.status !== 'applied') {
      if (Object.hasOwn(classification, 'memoryRevisions')) fail('source_binding_failed');
      return expected;
    }
    // Each runner arm starts with a new store: every admitted memory is
    // initially unfiled. The core returns every placement item's revision,
    // including items whose filing did not change. Never guess a later read.
    const proposal = placementProposal(classificationOutput, [...expected.keys()]);
    if (!Array.isArray(classification.memoryRevisions) || classification.memoryRevisions.length !== proposal.items.length) fail('source_binding_failed');
    const selected = new Map(proposal.items.map(item => [item.memoryId, item]));
    const seen = new Set();
    for (const entry of classification.memoryRevisions) {
      if (!exact(entry, ['memoryId', 'revision']) || !selected.has(identifier(entry.memoryId)) || seen.has(entry.memoryId)) fail('source_binding_failed');
      seen.add(entry.memoryId);
      const current = revision(entry.revision), admitted = expected.get(entry.memoryId), item = selected.get(entry.memoryId);
      // Validate this core's 0/1 filing transition, but bind only the explicit
      // returned revision, not a calculated increment or arbitrary latest row.
      if (current !== admitted + Number(item.parentIds.length > 0 || Boolean(item.newL1))) fail('source_binding_failed');
      expected.set(entry.memoryId, current);
    }
    return expected;
  } catch { fail('source_binding_failed'); }
}

function boundMemories(core, capture, result, catalog, classificationOutput) {
  const memories = [];
  const revisions = readRevisions(result, classificationOutput);
  for (const admitted of result.admission.memories) {
    const detail = core.get({ namespace: capture.namespace, memoryId: admitted.id, receiptLimit: 100 });
    if (!detail.ok || !detail.value.exhausted || detail.value.memory.id !== admitted.id ||
        detail.value.memory.revision !== revisions.get(admitted.id) || !detail.value.receipts.length) fail('source_binding_failed');
    const memory = detail.value.memory;
    const receipts = detail.value.receipts.map(receipt => {
      const matches = catalog.entries.filter(window => receipt.client === capture.client &&
        receipt.sessionId === capture.sessionId && receipt.eventId === window.id &&
        receipt.role === window.role && receipt.excerpt === window.content);
      if (matches.length !== 1) fail('source_binding_failed');
      const window = matches[0];
      return { receipt: jsonCopy(receipt), windowIndex: window.index, messageIndex: window.messageIndex,
        start: window.start, end: window.end };
    });
    memories.push({ memoryId: memory.id, revision: memory.revision, content: memory.content, kind: memory.kind, receipts });
  }
  // No relationship between admission ID ordering and proposal positions is assumed.
  return memories;
}

function pack(memories, question, counter) {
  const windows = new Map();
  for (const memory of memories) for (const source of memory.receipts) windows.set(source.windowIndex, source);
  const ordered = [...windows.entries()].sort(([a], [b]) => a - b);
  const request = { system: ROLE_STRATIFIED_ANSWER_INSTRUCTION, input: { sources: [], question }, maxOutputTokens: 512 };
  const measure = () => countTokens(counter, JSON.stringify(request));
  if (measure() > 4000) fail('context_budget_exceeded');
  const retainedIds = [], includedIds = [], omittedIds = [], decisions = [];
  let includedBytes = 0, omittedBytes = 0;
  for (const [index, bound] of ordered) {
    const source = { sourceId: `window-${index}`, speaker: bound.receipt.role, text: bound.receipt.excerpt };
    retainedIds.push(source.sourceId);
    request.input.sources.push(source);
    const attemptedInputTokens = measure();
    const included = attemptedInputTokens <= 4000;
    decisions.push({ sourceId: source.sourceId, included, textBytes: bytes(source.text), attemptedInputTokens });
    if (included) { includedIds.push(source.sourceId); includedBytes += bytes(source.text); }
    else { request.input.sources.pop(); omittedIds.push(source.sourceId); omittedBytes += bytes(source.text); }
  }
  return { request, retainedIds, includedIds, omittedIds, decisions, retainedCount: retainedIds.length,
    includedCount: includedIds.length, omittedCount: omittedIds.length,
    retainedBytes: includedBytes + omittedBytes, includedBytes, omittedBytes, inputTokens: measure() };
}

/** Offline evaluation only. Accounting, transport and credentials belong to the caller. */
export async function runRoleStratifiedQa({ fixtureJson, model, answer, onRecord, assertActive }) {
  const fixture = parseRoleStratifiedQaFixture(fixtureJson); // Before callbacks, imports that open stores, or workspace creation.
  if (!model || ['extract', 'extractRoleStratified', 'classify', 'countTokens'].some(name => typeof model[name] !== 'function') ||
      !Number.isSafeInteger(model.contextWindow) || model.contextWindow < 8192 ||
      [answer, onRecord, assertActive].some(callback => typeof callback !== 'function')) fail('invalid_options');
  const started = now();
  let fatal = null;
  const stop = code => { fatal ??= code; throw new Boundary(fatal); };
  const synchronous = result => {
    if (result && typeof result.then === 'function') {
      Promise.resolve(result).catch(() => {});
      return false;
    }
    return true;
  };
  const active = () => {
    if (fatal) throw new Boundary(fatal);
    try { if (!synchronous(assertActive())) throw new Error(); } catch { stop('assert_active_failed'); }
  };
  const emit = event => {
    try { if (!synchronous(onRecord(jsonCopy(event, 8_000_000)))) throw new Error(); }
    catch { stop('record_failed'); }
  };
  const finalRecord = event => { try { emit(event); } catch { /* Stop is latched; still attempt final evidence. */ } };
  const counter = { countTokens(value) { active(); const result = model.countTokens.call(model, value); active(); return result; } };
  const rows = fixture.cases.map((source, i) => ({ id: source.id,
    order: i % 2 ? ['candidate', 'baseline'] : ['baseline', 'candidate'],
    ...Object.fromEntries(['baseline', 'candidate'].map(name => [name, {
      // output is the ordinary proposal passed to core validation (compiled for
      // candidate); admittedMemories is authoritative for actual canonical prose.
      status: 'not-run', reason: null, failedPhase: null, extraction: { request: null, proposal: null, output: null, groups: null },
      classificationOutput: null, capture: null, admittedMemories: [], coldRead: null, packed: null,
      answer: null, answerOutput: null, cleanupCompleted: true, modelCalls: { extract: 0, classify: 0, answer: 0 },
      tokenCounts: { extract: { input: null, output: null }, classify: { input: null, output: null }, answer: { input: null, output: null } },
      storageBytes: null, durations: {},
    }])) }));
  const run = { schemaVersion: ROLE_STRATIFIED_QA_REPORT_VERSION,
    fixtureVersion: fixture.version, fixtureSha256: createHash('sha256').update(fixtureJson, 'utf8').digest('hex'),
    status: 'running', reason: null,
    rows, counts: { extract: 0, classify: 0, answer: 0 }, caseCount: rows.length, armCount: rows.length * 2,
    completedArms: 0, failedArms: 0, notRunArms: 0, durationMs: 0 };
  const physical = async (caseId, armName, arm, phase, port, wire, retain) => {
    active();
    const request = jsonCopy(wireOf(wire));
    arm.tokenCounts[phase].input = countTokens(counter, JSON.stringify(request));
    if (phase === 'extract') arm.extraction.request = jsonCopy(request);
    emit({ kind: 'model-start', caseId, arm: armName, phase, request });
    active();
    const callStart = now();
    let abort;
    const cancelled = new Promise((_, reject) => {
      abort = () => {
        if (isCoreModelDeadlineSignal(wire.signal) || wire.signal.reason?.code === 'model_timeout') reject(new MemoryStoreError('model_timeout'));
        else { const error = new Error('model_cancelled'); error.name = 'AbortError'; reject(error); }
      };
      wire.signal.addEventListener('abort', abort, { once: true });
    });
    try {
      if (wire.signal.aborted) abort();
      const invocation = Promise.resolve().then(() => {
        active();
        if (wire.signal.aborted) { const error = new Error('model_cancelled'); error.name = 'AbortError'; throw error; }
        run.counts[phase]++; arm.modelCalls[phase]++;
        const returned = port({ ...jsonCopy(request), signal: wire.signal });
        const copied = output => jsonCopy(output, 40_000);
        return types.isPromise(returned) ? Promise.prototype.then.call(returned, copied) : copied(returned);
      });
      const output = await Promise.race([invocation, cancelled]);
      retain(output); // Received output survives a post-call guard/observer failure.
      active();
      arm.tokenCounts[phase].output = countTokens(counter, JSON.stringify(output));
      emit({ kind: 'model-output', caseId, arm: armName, phase, output });
      active();
      return output;
    } catch (error) {
      if (!fatal && !(error instanceof Boundary) && !(error instanceof MemoryStoreError && knownCodes.has(error.code)) && error?.name !== 'AbortError') {
        fatal = 'model_dispatch_failed';
      }
      const reason = fatal ?? (error?.name === 'AbortError' ? 'model_cancelled' : error.code);
      emit({ kind: 'model-failure', caseId, arm: armName, phase, reason });
      active();
      if (error instanceof Boundary && knownCodes.has(error.code)) throw new MemoryStoreError(error.code);
      throw error;
    } finally { wire.signal.removeEventListener('abort', abort); arm.durations[phase] = elapsed(callStart); }
  };
  const finalized = new Set();
  try {
    active();
    const { openMemoryCore } = await import('../../core/contract.mjs');
    const { prepareRoleStratifiedExtraction, createRoleStratifiedModel } = await import('./role-stratified-extraction.mjs');
    active();
    for (const [index, source] of fixture.cases.entries()) {
      active();
      const row = rows[index], caseStart = now();
      for (const armName of row.order) {
        active();
        const arm = row[armName], armStart = now();
        let workspace, candidate, phase = 'capture';
        arm.cleanupCompleted = false;
        arm.status = 'running';
        try {
          const prepared = prepareRoleStratifiedExtraction(captureFor(source), POLICY);
          const capture = prepared.capture;
          const catalog = sourceWindowCatalog(captureSnapshot(capture, undefined, POLICY.captureSourcePolicy));
          const port = { contextWindow: model.contextWindow, countTokens: counter.countTokens,
            extract(wire) {
              phase = 'extract';
              return physical(row.id, armName, arm, 'extract', model.extract.bind(model), wire,
                output => { arm.extraction.proposal = jsonCopy(output); arm.extraction.output = jsonCopy(output); });
            },
            extractRoleStratified(wire) {
              phase = 'extract';
              return physical(row.id, armName, arm, 'extract', model.extractRoleStratified.bind(model), wire,
                output => { arm.extraction.proposal = jsonCopy(output); });
            },
            classify(wire) {
              phase = 'classify';
              if (candidate) {
                const observed = candidate.observe();
                arm.extraction.output = jsonCopy(observed.output);
                arm.extraction.groups = jsonCopy(observed.groups);
              }
              return physical(row.id, armName, arm, 'classify', model.classify.bind(model), wire,
                output => { arm.classificationOutput = jsonCopy(output); });
            } };
          candidate = armName === 'candidate' ? createRoleStratifiedModel(prepared, port) : null;
          workspace = createTestWorkspace(null, { prefix: 'role-stratified-qa-' });
          const path = join(workspace.path, 'memory.sqlite');
          const writer = openMemoryCore({ path, model: candidate ?? port, ...prepared.options });
          workspace.defer(() => writer.close());
          active();
          arm.capture = await writer.capture(capture);
          if (candidate) {
            const observed = candidate.observe();
            arm.extraction.groups = jsonCopy(observed.groups);
            arm.extraction.output = jsonCopy(observed.output);
          }
          // Inspect admission even after a guard/observer or classification failure.
          if (arm.capture.ok) {
            phase = 'source-binding';
            arm.admittedMemories = boundMemories(writer, capture, arm.capture.value, catalog, arm.classificationOutput);
            writer.close();
            const coldModel = Object.freeze({ countTokens: counter.countTokens });
            const cold = openMemoryCore({ path, model: coldModel, ...prepared.options });
            workspace.defer(() => cold.close());
            const memories = boundMemories(cold, capture, arm.capture.value, catalog, arm.classificationOutput);
            if (!isDeepStrictEqual(memories, arm.admittedMemories)) fail('source_binding_failed');
            arm.coldRead = { verified: true, generationMethods: [], memories };
            emit({ kind: 'source-bound', caseId: row.id, arm: armName, admittedMemories: memories, coldRead: arm.coldRead });
          }
          active();
          if (!arm.capture.ok) {
            const code = arm.capture.error.code;
            if (!knownCodes.has(code)) stop(code === 'invalid_input' ? 'capture_binding_failed' : 'storage_error');
            fail(code);
          }
          if (arm.capture.value.classification.status === 'failed') {
            phase = 'classify';
            const code = arm.capture.value.classification.error.code;
            if (!knownCodes.has(code)) stop('storage_error');
            fail(code);
          }
          phase = 'pack';
          arm.packed = pack(arm.coldRead.memories, source.question, counter);
          active();
          phase = 'answer';
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(new MemoryStoreError('model_timeout')), 60_000);
          try {
            const output = await physical(row.id, armName, arm, 'answer', answer, { ...arm.packed.request, signal: controller.signal },
              received => { arm.answerOutput = jsonCopy(received); });
            if (!exact(output, ['answer']) || !text(output.answer, 40_000) || !output.answer.trim() ||
                countTokens(counter, JSON.stringify(output)) > 512) fail('invalid_model_output');
            arm.answer = output.answer;
          } finally { clearTimeout(timer); }
          active();
          arm.status = 'completed';
        } catch (error) {
          arm.status = 'failed'; arm.failedPhase = phase;
          arm.reason = fatal ?? (knownCodes.has(error?.code) ? error.code : 'source_binding_failed');
          if (!knownCodes.has(arm.reason)) fatal ??= arm.reason;
        } finally {
          if (workspace) {
            try {
              arm.storageBytes = ['memory.sqlite', 'memory.sqlite-wal', 'memory.sqlite-shm'].reduce((sum, name) => {
                try { return sum + statSync(join(workspace.path, name)).size; }
                catch (error) { if (error.code === 'ENOENT') return sum; throw error; }
              }, 0);
            } catch { fatal ??= 'storage_error'; }
            try { await workspace.cleanup(); arm.cleanupCompleted = true; }
            catch { arm.cleanupCompleted = false; arm.status = 'failed'; arm.failedPhase = 'cleanup'; arm.reason = 'cleanup_failed'; fatal = 'cleanup_failed'; }
          } else arm.cleanupCompleted = true;
          try { if (!fatal) active(); } catch { /* Post-cleanup stop remains latched. */ }
          arm.durations.total = elapsed(armStart);
          finalRecord({ kind: 'arm-final', caseId: row.id, arm: armName, result: arm });
        }
        if (fatal) break;
      }
      row.durationMs = elapsed(caseStart);
      finalRecord({ kind: 'case-final', caseId: row.id, result: row });
      finalized.add(row.id);
      if (fatal) break;
    }
  } catch (error) { fatal ??= error instanceof Boundary ? error.code : 'storage_error'; }
  for (const row of rows) {
    for (const armName of row.order) {
      const arm = row[armName];
      if (arm.status === 'not-run') finalRecord({ kind: 'arm-final', caseId: row.id, arm: armName, result: arm });
      if (arm.status === 'completed') run.completedArms++;
      else if (arm.status === 'failed') run.failedArms++;
      else run.notRunArms++;
    }
    if (!finalized.has(row.id)) finalRecord({ kind: 'case-final', caseId: row.id, result: row });
  }
  try { if (!fatal) active(); } catch { /* Final audit stop remains latched. */ }
  run.status = fatal ? 'stopped' : 'completed'; run.reason = fatal; run.durationMs = elapsed(started);
  finalRecord({ kind: 'run-final', result: run });
  if (fatal) { run.status = 'stopped'; run.reason = fatal; }
  return run;
}
