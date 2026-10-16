import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { DIALOGUE_CONTEXT_ANSWER_INSTRUCTION, runDialogueContextQa } from '../dialogue-context-qa.mjs';
import { PUBLIC_ANSWER_INSTRUCTION } from '../../longmemeval/public-comparison.mjs';

const supportsSqlite = Number(process.versions.node.split('.')[0]) >= 22 &&
  (Number(process.versions.node.split('.')[0]) > 22 || Number(process.versions.node.split('.')[1]) >= 16);
const sqlite = { skip: !supportsSqlite && 'node:sqlite requires Node >=22.16' };
const counter = text => Math.ceil(text.length / 16);
const source = (index = 0) => ({ id: index.toString(16).padStart(12, 'a'), messages: [
  { role: 'user', content: 'The folding ruler must fit inside my small blue sketch pouch.' },
  { role: 'assistant', content: 'Consider a brass ruler; this is only a suggestion.' },
], question: 'What size constraint was given for the drawing equipment?' });
const fixture = (count = 1) => ({ version: 'dialogue-context-qa-v1', cases: Array.from({ length: count }, (_, i) => source(i)) });
const extracted = { items: [{ content: 'Generated brass equipment paraphrase', kind: 'context', confidence: 0.8, sourceIndices: [1] }] };
const requestOf = ({ system, input, maxOutputTokens }) => ({ system, input, maxOutputTokens });
const ok = value => { assert.equal(value.ok, true, JSON.stringify(value)); return value.value; };

function ports(overrides = {}) {
  const records = [], calls = [];
  const invoke = (phase, wire) => {
    assert.ok(wire.signal instanceof AbortSignal);
    const start = records.at(-1);
    assert.equal(start.kind, 'model-start'); assert.equal(start.phase, phase);
    assert.deepEqual(start.request, requestOf(wire));
    calls.push({ phase, wire: structuredClone(requestOf(wire)) });
  };
  const model = { contextWindow: 8192, countTokens: overrides.countTokens ?? counter,
    extract(wire) { invoke('extract', wire); return overrides.extract ? overrides.extract(wire) : structuredClone(extracted); },
    classify(wire) { invoke('classify', wire); return overrides.classify ? overrides.classify(wire)
      : { items: wire.input.memories.map(memory => ({ memoryId: memory.id, parentIds: [] })) }; } };
  for (const method of ['qualify', 'qualifyCandidates', 'rank', 'select', 'reconcile', 'relate', 'reviewBasis']) {
    Object.defineProperty(model, method, { get() { assert.fail(`Forbidden generation method: ${method}`); } });
  }
  return { records, calls, options: { model,
    answer(wire) { invoke('answer', wire); return overrides.answer ? overrides.answer(wire) : { answer: 'I do not know.' }; },
    onRecord(record) { records.push(record); return overrides.onRecord?.(record); },
    assertActive: overrides.assertActive ?? (() => {}) } };
}

test('Q1 source-only exact schema rejects oracle fields and invalid bounds before calls', async () => {
  const bad = [
    { ...fixture(), gold: 'oracle' },
    { version: 'dialogue-context-qa-v1', cases: [{ ...source(), expectedAnswer: 'oracle' }] },
    { version: 'dialogue-context-qa-v1', cases: [{ ...source(), messages: [{ role: 'user', content: 'source', id: 'extra' }] }] },
    { version: 'dialogue-context-qa-v1', cases: [{ ...source(), id: 123456789012 }] },
    { version: 'dialogue-context-qa-v1', cases: [{ ...source(), messages: [{ role: 'assistant', content: 'wrong first role' }] }] },
    { version: 'dialogue-context-qa-v1', cases: [{ ...source(), question: 'x'.repeat(301) }] },
    { version: 'dialogue-context-qa-v1', cases: [{ ...source(), messages: [{ role: 'user', content: 'x'.repeat(601) }] }] },
    { version: 'dialogue-context-qa-v1', cases: [{ ...source(), messages: [{ role: 'user', content: 'ﬃ'.repeat(300) }] }] },
    { version: 'dialogue-context-qa-v1', cases: [source(), source()] },
    { version: 'dialogue-context-qa-v1', cases: [] }, fixture(25),
  ];
  for (const invalid of bad) {
    const p = ports();
    await assert.rejects(runDialogueContextQa({ fixture: invalid, ...p.options }), { code: 'invalid_fixture' });
    assert.deepEqual(p.calls, []);
  }
});

test('Q2/Q3/Q4 actual capture/cold source, shared extract once, classify/answer twice and alternating order', sqlite, async t => {
  const data = fixture(2), saved = structuredClone(data), p = ports();
  const result = await runDialogueContextQa({ fixture: data, ...p.options });
  assert.equal(result.status, 'completed'); assert.equal(result.reason, null);
  assert.deepEqual(result.counts, { extract: 2, classify: 4, answer: 4, replays: 2 });
  assert.equal(result.completedArms, 4); assert.deepEqual(data, saved);
  assert.deepEqual(result.rows.map(row => row.order), [['baseline', 'candidate'], ['candidate', 'baseline']]);
  for (const row of result.rows) {
    assert.deepEqual(row.sharedExtraction.output, extracted);
    assert.equal(row.sharedExtraction.replays, 1);
    assert.deepEqual(row.baseline.transformedOutput.items[0].sourceIndices, [1]);
    assert.deepEqual(row.candidate.transformedOutput.items[0].sourceIndices, [1, 0]);
    const original = arm => arm.coldResolution.resolved.filter(entry => entry.provenanceRole === 'extractor-selected')
      .map(entry => [entry.windowIndex, entry.receipt.role, entry.receipt.excerpt]);
    assert.deepEqual(original(row.baseline), original(row.candidate));
    assert.deepEqual(row.baseline.binding.sidecar.capture, row.candidate.binding.sidecar.capture);
    assert.deepEqual(row.baseline.binding.sidecar.namespace, row.candidate.binding.sidecar.namespace);
    const receiptIdentities = arm => arm.binding.sidecar.entries.filter(entry => entry.provenanceRole === 'extractor-selected')
      .map(entry => [entry.receiptIdentityDigest, entry.messageIndex, entry.start, entry.end]);
    assert.deepEqual(receiptIdentities(row.baseline), receiptIdentities(row.candidate));
    assert.equal(row.baseline.coldResolution.resolved.length, 1);
    assert.equal(row.candidate.coldResolution.resolved.length, 2);
    for (const entry of row.candidate.coldResolution.resolved) {
      const metadata = row.candidate.binding.sidecar.capture;
      assert.equal(entry.receipt.client, metadata.client);
      assert.equal(entry.receipt.sessionId, metadata.sessionId);
      assert.equal(entry.receipt.eventId, entry.provenanceRole === 'extractor-selected' ? 'source-1' : 'source-0');
    }
    assert.deepEqual(row.candidate.packed.request.input.sources.map(source => [source.sourceId, source.speaker, source.retentionRole, source.text]),
      [['window-1', 'assistant', 'extractor-selected', source().messages[1].content],
        ['window-0', 'user', 'dialogue-context', source().messages[0].content]]);
    for (const arm of [row.baseline, row.candidate]) {
      assert.equal(arm.status, 'completed'); assert.equal(arm.cleanupCompleted, true);
      assert.equal(arm.capture.value.classification.status, 'applied');
      assert.ok(arm.packed.inputTokens <= 4000);
      assert.ok(!JSON.stringify(arm.packed.request).includes(extracted.items[0].content));
      assert.deepEqual(Object.keys(arm.packed.request.input.sources[0]).sort(), ['retentionRole', 'sourceId', 'speaker', 'text']);
      assert.equal(arm.packed.request.maxOutputTokens, 512);
    }
  }
  for (const call of p.calls.filter(call => call.phase !== 'answer')) {
    assert.ok(!JSON.stringify(call.wire).includes(source().question));
    assert.equal(call.wire.maxOutputTokens, 1024);
  }
  assert.ok(DIALOGUE_CONTEXT_ANSWER_INSTRUCTION.startsWith(PUBLIC_ANSWER_INSTRUCTION));
  assert.equal(p.records.filter(record => record.kind === 'model-start').length, 10);
  assert.equal(p.records.filter(record => record.kind === 'model-output').length, 10);
  assert.equal(p.records.filter(record => record.kind === 'arm-final').length, 4);
  assert.equal(p.records.filter(record => record.kind === 'case-final').length, 2);
  assert.equal(p.records.at(-1).kind, 'run-final');
  for (const row of result.rows) {
    const replay = p.records.find(record => record.kind === 'extraction-replay' && record.caseId === row.id);
    assert.deepEqual(replay.request, row.sharedExtraction.request);
    assert.deepEqual(replay.output, row.sharedExtraction.output);
  }
  t.diagnostic(JSON.stringify({ synthetic: true, counts: result.counts,
    retained: result.rows.map(row => [row.baseline.packed.retainedCount, row.candidate.packed.retainedCount]) }));
});

test('Q2 failed or malformed original extraction remains failed in both arms without retry', sqlite, async () => {
  for (const extract of [() => ({ items: [{ ...extracted.items[0], sourceIndices: [99] }] }),
    () => { throw new Error('arbitrary provider secret must not escape'); }]) {
    const p = ports({ extract });
    const result = await runDialogueContextQa({ fixture: fixture(), ...p.options });
    assert.equal(result.status, 'completed'); assert.equal(result.failedArms, 2);
    assert.deepEqual(result.counts, { extract: 1, classify: 0, answer: 0, replays: 1 });
    assert.equal(result.rows[0].baseline.status, 'failed'); assert.equal(result.rows[0].candidate.status, 'failed');
    assert.ok(result.rows[0].baseline.cleanupCompleted && result.rows[0].candidate.cleanupCompleted);
    assert.ok(!JSON.stringify(result).includes('arbitrary provider secret'));
  }
});

test('Q2 classification failure retains partial admission but never completes/answers that arm', sqlite, async () => {
  const p = ports({ classify() { throw new Error('classifier failed'); } });
  const result = await runDialogueContextQa({ fixture: fixture(), ...p.options });
  assert.equal(result.status, 'completed'); assert.equal(result.failedArms, 2);
  assert.deepEqual(result.counts, { extract: 1, classify: 2, answer: 0, replays: 1 });
  for (const arm of [result.rows[0].baseline, result.rows[0].candidate]) {
    assert.equal(arm.capture.ok, true); assert.equal(arm.capture.value.admission.memories.length, 1);
    assert.equal(arm.capture.value.classification.status, 'failed');
    assert.equal(arm.failedPhase, 'classify'); assert.equal(arm.reason, 'classification_failed');
    assert.equal(arm.answer, null); assert.equal(arm.cleanupCompleted, true);
  }
});

test('Q2/Q4 empty capture completes with zero evidence and unknown answer', sqlite, async () => {
  const p = ports({ extract: () => ({ items: [] }) });
  const result = await runDialogueContextQa({ fixture: fixture(), ...p.options });
  assert.equal(result.completedArms, 2);
  assert.deepEqual(result.counts, { extract: 1, classify: 0, answer: 2, replays: 1 });
  for (const arm of [result.rows[0].baseline, result.rows[0].candidate]) {
    assert.deepEqual(arm.coldResolution, { resolved: [], rejected: [] });
    assert.deepEqual(arm.packed.request.input.sources, []);
    assert.equal(arm.answer, 'I do not know.');
  }
});

test('Q4 whole passage budget excludes optional context without evicting original; dedupe prefers selected', sqlite, async () => {
  const p = ports({ countTokens(text) {
    const value = JSON.parse(text || '{}');
    return value.input?.sources ? 3999 + value.input.sources.length : counter(text);
  } });
  const result = await runDialogueContextQa({ fixture: fixture(), ...p.options });
  assert.equal(result.completedArms, 2);
  const [baseline, candidate] = [result.rows[0].baseline, result.rows[0].candidate];
  assert.deepEqual(baseline.packed.request, candidate.packed.request);
  assert.deepEqual(candidate.packed.includedIds, ['window-1']);
  assert.deepEqual(candidate.packed.omittedIds, ['window-0']);
  assert.equal(candidate.packed.omittedBytes, Buffer.byteLength(source().messages[0].content));
  const selected = ports({ extract: () => ({ items: [extracted.items[0],
    { ...extracted.items[0], content: 'Second independent generated paraphrase', sourceIndices: [0] }] }) });
  const dedup = await runDialogueContextQa({ fixture: fixture(), ...selected.options });
  const sources = dedup.rows[0].candidate.packed.request.input.sources;
  assert.deepEqual(sources.map(source => [source.sourceId, source.retentionRole]),
    [['window-1', 'extractor-selected'], ['window-0', 'extractor-selected']]);
});

test('Q4 answer output bounds reject invalid schema/raw/token output without exposing provider errors', sqlite, async () => {
  for (const answer of [() => ({ answer: 'text', extra: true }), () => ({ answer: '' }),
    () => ({ answer: ' \n  ' }), () => ({ answer: 'x'.repeat(40_001) }),
    () => { throw new Error('private provider failure'); }]) {
    const p = ports({ answer });
    const result = await runDialogueContextQa({ fixture: fixture(), ...p.options });
    assert.equal(result.failedArms, 2);
    assert.ok(!JSON.stringify(result).includes('private provider failure'));
    assert.ok(result.rows[0].baseline.cleanupCompleted && result.rows[0].candidate.cleanupCompleted);
  }
  for (const outputTokens of [512, 513]) {
    const p = ports({ countTokens(text) {
      const value = JSON.parse(text || '{}');
      return Object.hasOwn(value, 'answer') ? outputTokens : counter(text);
    } });
    const result = await runDialogueContextQa({ fixture: fixture(), ...p.options });
    assert.equal(result.completedArms, outputTokens === 512 ? 2 : 0);
    assert.equal(result.failedArms, outputTokens === 513 ? 2 : 0);
  }
});

test('Q6 assertActive/model observer failures latch stop, retain denominator/finals and prevent further calls', sqlite, async () => {
  for (const boundary of ['start-observer', 'output-observer', 'active']) {
    let stopped = false;
    const p = ports({ onRecord(record) {
      if (boundary === 'start-observer' && record.kind === 'model-start') throw new Error('observer private');
      if (record.kind === 'model-output' && record.phase === 'extract') {
        if (boundary === 'output-observer') throw new Error('observer private');
        if (boundary === 'active') stopped = true;
      }
    }, assertActive() { if (stopped) throw new Error('operator private'); } });
    const result = await runDialogueContextQa({ fixture: fixture(2), ...p.options });
    assert.equal(result.status, 'stopped'); assert.equal(result.rows.length, 2);
    assert.equal(result.reason, boundary === 'active' ? 'assert_active_failed' : 'record_failed');
    assert.equal(p.calls.length, boundary === 'start-observer' ? 0 : 1);
    assert.equal(p.records.filter(record => record.kind === 'arm-final').length, 4);
    assert.equal(p.records.filter(record => record.kind === 'case-final').length, 2);
    assert.equal(p.records.at(-1).kind, 'run-final');
    assert.equal(result.rows[0].baseline.cleanupCompleted, true);
    if (boundary !== 'start-observer') assert.deepEqual(result.rows[0].sharedExtraction.output, extracted);
    assert.equal(result.rows[1].candidate.status, 'not-run');
    assert.ok(!JSON.stringify(result).includes('private'));
  }
});

test('Q6 final observer failures stop at arm/case boundaries and retain all not-run rows', sqlite, async () => {
  for (const kind of ['arm-final', 'case-final', 'run-final']) {
    let failed = false;
    const p = ports({ onRecord(record) {
      if (!failed && record.kind === kind) { failed = true; throw new Error('private observer failure'); }
    } });
    const result = await runDialogueContextQa({ fixture: fixture(2), ...p.options });
    assert.equal(result.status, 'stopped'); assert.equal(result.reason, 'record_failed');
    assert.equal(result.rows.length, 2);
    assert.equal(p.calls.length, kind === 'arm-final' ? 3 : kind === 'case-final' ? 5 : 10);
    if (kind !== 'run-final') assert.equal(result.rows[1].baseline.status, 'not-run');
  }
});

test('Q6 an immediate operator stop retains all 24 cases and 48 not-run arms', async () => {
  const p = ports({ assertActive() { throw new Error('operator stop'); } });
  const result = await runDialogueContextQa({ fixture: fixture(24), ...p.options });
  assert.equal(result.status, 'stopped'); assert.equal(result.reason, 'assert_active_failed');
  assert.equal(result.caseCount, 24); assert.equal(result.rows.length, 24); assert.equal(result.notRunArms, 48);
  assert.deepEqual(p.calls, []);
  assert.equal(p.records.filter(record => record.kind === 'arm-final').length, 48);
  assert.equal(p.records.filter(record => record.kind === 'case-final').length, 24);
  assert.equal(p.records.at(-1).kind, 'run-final');
});

test('Q6 rejecting async callbacks fails closed without unhandled promise rejections', sqlite, async () => {
  for (const callback of ['onRecord', 'assertActive']) {
    const p = ports({ [callback]: () => Promise.reject(new Error('async callback private failure')) });
    const result = await runDialogueContextQa({ fixture: fixture(), ...p.options });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(result.status, 'stopped');
    assert.equal(result.reason, callback === 'onRecord' ? 'record_failed' : 'assert_active_failed');
    assert.equal(p.calls.length, 0);
    assert.ok(!JSON.stringify(result).includes('private failure'));
  }
});

test('Q3 cold evidence preserves real canonical redaction and UTF-8 bytes', sqlite, async () => {
  const data = fixture(), secret = 'sk-' + 'a'.repeat(48);
  data.cases[0].messages[0].content = `Ａ ruler 🚋 Private ${secret} stays inside the pouch.`;
  const p = ports();
  const result = await runDialogueContextQa({ fixture: data, ...p.options });
  assert.equal(result.completedArms, 2);
  const candidate = result.rows[0].candidate;
  const actual = candidate.packed.request.input.sources[1];
  assert.equal(actual.text, 'A ruler 🚋 Private [REDACTED] stays inside the pouch.');
  assert.equal(candidate.packed.includedBytes, candidate.packed.request.input.sources
    .reduce((sum, source) => sum + Buffer.byteLength(source.text, 'utf8'), 0));
  assert.ok(!JSON.stringify(p.calls).includes(secret));
});

async function withOwnedParent(t, task) {
  const workspace = createTestWorkspace(t, { prefix: 'dialogue-context-qa-control-' });
  const previous = process.env.TMPDIR;
  process.env.TMPDIR = workspace.path;
  try { await task(workspace.path); }
  finally { if (previous === undefined) delete process.env.TMPDIR; else process.env.TMPDIR = previous; }
}

test('Q3 actual cold binding fails closed after source correction; owned success/failure cleanup', sqlite, async t => {
  const { openMemoryCore } = await import('../../../core/contract.mjs');
  await withOwnedParent(t, async parent => {
    let corrected = false;
    const p = ports({ onRecord(record) {
      if (record.kind !== 'source-bound' || corrected) return;
      corrected = true;
      const roots = readdirSync(parent); assert.equal(roots.length, 1);
      const core = openMemoryCore({ path: join(parent, roots[0], 'memory.sqlite') });
      try {
        const binding = record.binding.sidecar, entry = binding.entries[0];
        const saved = ok(core.get({ namespace: binding.namespace, memoryId: entry.memoryId }));
        ok(core.correct({ namespace: binding.namespace, memoryId: entry.memoryId,
          expectedRevision: saved.memory.revision, content: 'Synthetic corrected content', kind: 'context',
          receipt: { client: 'manual', sessionId: 'manual', eventId: 'correction', role: 'user', excerpt: 'Synthetic correction' } }));
      } finally { core.close(); }
    } });
    const result = await runDialogueContextQa({ fixture: fixture(), ...p.options });
    assert.equal(result.status, 'stopped'); assert.equal(result.reason, 'source_binding_failed');
    assert.equal(result.rows[0].baseline.failedPhase, 'source-binding');
    assert.equal(result.rows[0].baseline.cleanupCompleted, true); assert.deepEqual(readdirSync(parent), []);
    assert.equal(result.counts.answer, 0);
    const success = ports();
    assert.equal((await runDialogueContextQa({ fixture: fixture(), ...success.options })).status, 'completed');
    assert.deepEqual(readdirSync(parent), []);
  });
});

test('Q3 owned cleanup identity failure is fatal and reports incomplete cleanup', sqlite, async t => {
  await withOwnedParent(t, async parent => {
    let displaced;
    const p = ports({ onRecord(record) {
      if (record.kind !== 'source-bound' || displaced) return;
      const root = join(parent, readdirSync(parent)[0]);
      displaced = root + '-displaced'; renameSync(root, displaced); mkdirSync(root);
    } });
    const result = await runDialogueContextQa({ fixture: fixture(), ...p.options });
    assert.equal(result.status, 'stopped'); assert.equal(result.reason, 'cleanup_failed');
    assert.equal(result.rows[0].baseline.cleanupCompleted, false);
    assert.equal(result.rows[0].baseline.failedPhase, 'cleanup');
    assert.ok(existsSync(displaced)); // Only our outer owned workspace removes the deliberately retained scratch.
    assert.equal(result.counts.answer, 0);
  });
});

test('Q3 forged stored receipt message mapping cannot become cold scoring identity', sqlite, async t => {
  const { DatabaseSync } = await import('node:sqlite');
  await withOwnedParent(t, async parent => {
    let forged = false;
    const p = ports({ onRecord(record) {
      if (record.kind !== 'source-bound' || forged) return;
      forged = true;
      const db = new DatabaseSync(join(parent, readdirSync(parent)[0], 'memory.sqlite'));
      try { db.prepare('UPDATE receipts SET event_id = ? WHERE id = ?')
        .run('source-5', record.binding.sidecar.entries[0].receiptId); }
      finally { db.close(); }
    } });
    const result = await runDialogueContextQa({ fixture: fixture(), ...p.options });
    assert.equal(result.status, 'stopped'); assert.equal(result.reason, 'source_binding_failed');
    assert.equal(result.counts.answer, 0); assert.deepEqual(readdirSync(parent), []);
  });
});
