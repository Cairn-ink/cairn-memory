import assert from 'node:assert/strict';
import { mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { openMemoryCore } from '../contract.mjs';
import { boundedText } from '../validation.mjs';
import { emitDiagnostic } from '../model-diagnostics.mjs';
import { rationaleModel } from '../testing/rationale-model.mjs';
import { interpretation } from '../testing/episode-capture-helpers.mjs';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';
import { createDiagnosticCollector, readDiagnostics } from '../../evaluation/live/diagnostics.mjs';
import { createMixedModelDiagnosticObserver } from '../../evaluation/longmemeval/mixed-ingestion-diagnostics.mjs';

const namespace = { ownerId: 'synthetic-text-shape', scope: 'personal', projectId: null };
const failed = { ok: false, error: { code: 'invalid_model_output', retryable: false } };
const source = 'Synthetic source fact';
const secret = 'sk-' + 's'.repeat(20);
const rejectionCases = [
  ['type', false, 'invalid_extraction_text_type'],
  ['raw-bound', 'x'.repeat(20001), 'invalid_extraction_text_raw_bounds'],
  ['empty', ' \t\n ', 'invalid_extraction_text_empty'],
  ['redacted', secret, 'invalid_extraction_text_redacted'],
  ['nul', 'Synthetic\0fact', 'invalid_extraction_text_nul'],
  ['normalized-bound', 'x'.repeat(601), 'invalid_extraction_text_normalized_bounds'],
  ['unicode', '\ud800', 'invalid_extraction_text_unicode', { captureQualification: 'source-bound-v1' }],
];

const modes = [
  ['plain', {}], ['qualification-v1', { captureQualification: 'source-bound-v1' }],
  ['qualification-v2', { captureQualification: 'source-bound-v2' }],
  ['indexed-evidence', { captureSourcePolicy: 'indexed-evidence-v1' }],
  ['episode', { captureQualification: 'source-bound-v2', captureEvidence: 'staged-v1',
    sessionEpisodes: { mode: 'episode-v1' } }],
];

function fixture(t, content, options = {}, onDiagnostic) {
  const workspace = createTestWorkspace(t, { prefix: 'cairn-extraction-text-' });
  const events = [];
  let extractions = 0;
  const model = { ...rationaleModel(), interpretEpisode: request => interpretation(request),
    qualify: ({ input }) => ({ qualifications: input.items.map((item, itemIndex) => ({ itemIndex,
      qualification: { version: 1, slot: { subject: null, property: null, scope: null, applies: null },
        value: null, attribution: 'unknown', commitment: 'unknown', anchors: [{ receiptIndex: 0,
          start: 0, end: source.length, text: source, fields: ['value'] }] } })) }),
    extract: () => { extractions++; return { items: [{ content: source, kind: 'fact', confidence: 0.8, sourceIndices: [0] },
      { content, kind: 'fact', confidence: 0.8, sourceIndices: [0] }] }; },
    onDiagnostic: event => { events.push(event); return onDiagnostic?.(event); } };
  const core = openMemoryCore({ path: join(workspace.path, 'memory.sqlite'), model, ...options });
  workspace.defer(() => core.close());
  const capture = () => core.capture({ namespace, client: 'synthetic', sessionId: 'session', eventId: 'event',
    ...(options.sessionEpisodes ? { episodeContext: { clientLabel: 'Synthetic', generation: 'initial', origin: 'ordinary' } } : {}),
    messages: [{ id: 'message', role: 'user', content: source }] });
  return { core, events, capture, workspace, extractions: () => extractions };
}

for (const [mode, options] of modes) test(`ET3 unchanged rejection/claims in ${mode}`, async t => {
  for (const [name, content, reason] of rejectionCases) {
    if (name === 'unicode' && mode === 'plain') continue;
    const current = fixture(t, content, options);
    assert.deepEqual(await current.capture(), failed);
    assert.deepEqual(current.core.list({ namespace }).value.memories, []);
    assert.deepEqual(current.events.filter(event => event.stage === 'extract'),
      [{ version: 1, stage: 'extract', layer: 'core_validation', reason }]);
    assert.deepEqual(await current.capture(), mode === 'episode'
      ? { ok: false, error: { code: 'capture_evidence_closed', retryable: false } } : failed);
    assert.equal(current.extractions(), mode === 'episode' ? 1 : 2,
      'preserve mode-specific staged-evidence closure or admission claim abandonment');
  }
});

const acceptedCases = [
  ['x'.repeat(600), 'x'.repeat(600)], ['😀'.repeat(300), '😀'.repeat(300)],
  ['Ａ\tＢ\nＣ', 'A B C'], ['e\u0301', 'é'],
  [`Safe ${secret} fact`, 'Safe [REDACTED] fact'], ['\u200b', '\u200b'],
  [' '.repeat(19400) + 'x'.repeat(600), 'x'.repeat(600)],
  ['ﬁ'.repeat(300), 'fi'.repeat(300)],
];
for (const [mode, options] of modes) test(`ET4 valid normalization/Unicode/redaction boundaries in ${mode}`, async t => {
  for (const [content, expected] of acceptedCases) {
    const current = fixture(t, content, options);
    const response = await current.capture();
    assert.equal(response.ok, true, JSON.stringify(response));
    const stored = current.core.list({ namespace }).value.memories;
    assert.equal(stored.length, 2);
    assert.equal(stored.some(memory => current.core.get({ namespace, memoryId: memory.id }).value.memory.content === expected), true);
    assert.deepEqual(current.events, []);
    const before = current.extractions();
    const replay = await current.capture();
    assert.equal(replay.ok, true);
    assert.equal(replay.value.duplicate, true);
    assert.equal(current.extractions(), before);
    await current.workspace.cleanup();
    assert.equal(existsSync(current.workspace.path), false);
  }
});

test('ET3 plain malformed Unicode remains accepted; NFKC expansion bound precedence is unchanged', async t => {
  const plain = fixture(t, '\ud800');
  assert.equal((await plain.capture()).ok, true);
  assert.deepEqual(plain.events, []);
  assert.throws(() => boundedText('ﬁ'.repeat(301), 600), { code: 'invalid_text' });
  assert.equal(boundedText('x'.repeat(599) + '😀', 600, true), 'x'.repeat(599));
  assert.equal(boundedText(' '.repeat(19400) + 'x'.repeat(600), 600), 'x'.repeat(600));
});

test('ET1/ET3 rejection precedence remains raw-before-normalized and qualified-Unicode-before-raw', async t => {
  for (const [content, options, reason] of [
    [' '.repeat(20001), {}, 'invalid_extraction_text_raw_bounds'],
    ['\0' + 'x'.repeat(20000), {}, 'invalid_extraction_text_raw_bounds'],
    ['ﬁ'.repeat(301), {}, 'invalid_extraction_text_normalized_bounds'],
    ['\0' + 'x'.repeat(601), {}, 'invalid_extraction_text_nul'],
    ['\ud800' + 'x'.repeat(20000), {}, 'invalid_extraction_text_raw_bounds'],
    ['\ud800' + 'x'.repeat(20000), { captureQualification: 'source-bound-v1' }, 'invalid_extraction_text_unicode'],
  ]) {
    const current = fixture(t, content, options);
    assert.deepEqual(await current.capture(), failed);
    assert.equal(current.events[0].reason, reason);
  }
});

test('ET4 throwing/rejecting/mutating observers and bounded rejection hooks are inert', async t => {
  for (const observe of [() => { throw Error('SYNTHETIC_PRIVATE'); },
    async () => { throw Error('SYNTHETIC_PRIVATE'); }, event => { event.reason = 'SYNTHETIC_PRIVATE'; }]) {
    const current = fixture(t, '\0', {}, observe);
    assert.deepEqual(await current.capture(), failed);
    assert.deepEqual(current.core.list({ namespace }).value.memories, []);
  }
  for (const hook of [() => { throw Error('SYNTHETIC_PRIVATE'); },
    async () => { throw Error('SYNTHETIC_PRIVATE'); }]) {
    assert.throws(() => boundedText(' ', 600, false, hook), { code: 'invalid_text' });
  }
  await setImmediate();
});

test('ET5 actual core text failures pass through pilot slots and mixed finite collectors', async t => {
  for (const [, content, reason, options] of rejectionCases) {
    const workspace = createTestWorkspace(t, { prefix: 'cairn-text-collectors-' });
    const directory = join(workspace.path, 'events'); mkdirSync(directory, { mode: 0o700 });
    const collect = createDiagnosticCollector(directory), mixed = createMixedModelDiagnosticObserver();
    const current = fixture(t, content, options, event => { collect(event); mixed.onDiagnostic(event); });
    assert.deepEqual(await current.capture(), failed);
    const expected = [{ version: 1, stage: 'extract', layer: 'core_validation', reason }];
    assert.deepEqual(readDiagnostics(directory).events, expected);
    assert.equal(readDiagnostics(directory).collection.corrupted, false);
    assert.equal(readDiagnostics(directory).collection.writeFailed, false);
    assert.deepEqual(mixed.snapshot().events, expected);
  }
  const events = [];
  emitDiagnostic({ onDiagnostic: event => events.push(event) }, 'extract', 'core_validation', 'invalid_extraction_text');
  assert.equal(events.length, 1, 'legacy category remains allowlisted');
});

for (const [name, content, reason, options] of rejectionCases) {
  test(`ET1 real capture distinguishes extraction text ${name} without admission`, async t => {
    const current = fixture(t, content, options);
    assert.deepEqual(await current.capture(), failed);
    assert.deepEqual(current.core.list({ namespace }).value.memories, []);
    assert.deepEqual(current.events, [{ version: 1, stage: 'extract', layer: 'core_validation', reason }]);
    assert.equal(Object.isFrozen(current.events[0]), true);
    assert.deepEqual(await current.capture(), failed);
    assert.equal(current.events.length, 2, 'failed claim is abandoned, not stuck processing');
    assert.deepEqual(current.core.list({ namespace }).value.memories, []);
  });
}
