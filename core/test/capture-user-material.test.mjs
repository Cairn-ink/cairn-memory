import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { capturedSuppressedCount } from '../admission-storage.mjs';
import { openMemoryCore } from '../contract.mjs';
import { extractionLimit } from '../capture-input.mjs';
import { extractionRequest } from '../capture.mjs';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';

const namespace = { ownerId: 'synthetic-user-material', scope: 'personal', projectId: null };
const messages = count => Array.from({ length: count }, (_, i) => ({ id: `source-${i}`, role: 'user',
  content: `I purchased a drawing supply for ${i + 1} credits.` }));
const item = i => ({ content: `Purchase ${i + 1} costs ${i + 1} credits.`, kind: 'fact', confidence: 0.8,
  sourceIndices: [i] });
const ok = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };
function fixture(t, options = {}, overflow = false) {
  const workspace = createTestWorkspace(t, { prefix: 'capture-user-material-' });
  const calls = [];
  const model = { contextWindow: 8192, countTokens: () => 1,
    extract(request) {
      calls.push(request);
      const count = extractionLimit(request.input.messages);
      return { items: Array.from({ length: count + Number(overflow) }, (_, i) => ({ ...item(i % request.input.messages.length),
        content: request.input.messages[i % request.input.messages.length].content })) };
    },
    classify: ({ input }) => ({ items: input.memories.map(({ id }) => ({ memoryId: id, parentIds: [] })) }),
    qualifyCandidates: ({ input }) => ({ qualifications: input.items.map(entry => ({ itemIndex: entry.itemIndex,
      ...Object.fromEntries(['subject', 'property', 'scope', 'applies', 'value', 'attribution', 'commitment'].map(field =>
        [field, { value: ['attribution', 'commitment'].includes(field) ? 'unknown' : null,
          evidenceIndices: field === 'subject' ? [entry.candidates[0].candidateIndex] : [] }])) })) }),
  };
  const path = join(workspace.path, 'memory.sqlite');
  const core = openMemoryCore({ path, model, ...options });
  workspace.defer(() => core.close());
  return { core, calls, path, workspace };
}

for (const count of [1, 5, 6, 12, 20, 40]) {
  test(`user material: ${count} user messages use bounded extraction requests and store every returned item`, async t => {
    for (const options of [{}, { captureQualification: 'source-bound-v2' }, { captureSourcePolicy: 'indexed-evidence-v1' }]) {
      const { core, calls } = fixture(t, options);
      const all = messages(count);
      const plan = ok(core.planCaptureBatches({ messages: all }));
      assert.deepEqual(plan.batches.map(batch => batch.length), count === 40 ? [24, 16] : [count]);
      for (const [index, batch] of plan.batches.entries()) {
        const result = ok(await core.capture({ namespace, client: 'synthetic', sessionId: 'synthetic-session',
          eventId: `batch-${index}`, messages: batch.map(i => all[i]) }));
        const expected = Math.max(5, Math.min(20, batch.length));
        assert.equal(result.admission.memories.length, Math.min(expected, batch.length));
        assert.equal(result.classification.status, 'applied');
        // Duplicate replay and admission inspection must accept the larger stored set.
        const inspected = ok(core.inspectAdmission({ namespace, client: 'synthetic', eventId: `batch-${index}` }));
        assert.equal(inspected.members.length, Math.min(expected, batch.length));
        for (const memory of result.admission.memories) {
          const detail = ok(core.get({ namespace, memoryId: memory.id }));
          assert.ok(detail.receipts.every(receipt => all.some(source => source.id === receipt.eventId && source.content === receipt.excerpt)));
        }
      }
      assert.deepEqual(calls.map(request => request.maxOutputTokens),
        (count === 40 ? [20, 16] : [Math.max(5, Math.min(20, count))]).map(limit => Math.ceil(1024 * limit / 5)));
      for (const request of calls) assert.deepEqual(Object.keys(request.input).sort(), options.captureSourcePolicy
        ? ['inputMode', 'messages'] : ['messages']);
    }
  });
}

for (const count of [1, 6, 20]) test(`user material: reject more than the ${Math.max(5, count)} item limit`, async t => {
  const { core } = fixture(t, {}, true);
  const result = await core.capture({ namespace, client: 'synthetic', sessionId: 'synthetic-session', eventId: 'overflow',
    messages: messages(count) });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'invalid_model_output');
});

test('user material: assistant messages and repeated windows do not inflate the limit', () => {
  assert.equal(extractionLimit([...messages(6), ...messages(20).map(message => ({ ...message, role: 'assistant' }))]), 6);
  assert.equal(extractionLimit(Array.from({ length: 12 }, (_, index) => ({ role: 'user', messageIndex: index % 3 }))), 5);
});

test('user material: every extraction prompt names the user-first and eligible-assistant rules', () => {
  for (const name of ['extract-memories', 'extract-retained-sources', 'extract-episode-sources', 'extract-source-windows']) {
    const system = readFileSync(new URL(`../prompts/${name}.md`, import.meta.url), 'utf8');
    for (const pattern of [/User-stated facts are the primary material/, /each distinct user-stated item its own candidate/,
      /keep names,\s*amounts, dates and titles as stated/, /Do not merge distinct items into a summary/,
      /decision the user accepted/, /result of work the user\s*asked for/, /correction the user confirmed/,
      /small talk, general\s*knowledge, opinions, hypotheticals, offers and pleasantries are never memories/,
      /Closing remarks[\s\S]*are not memories/, /clamped to 5\.\.20/]) assert.match(system, pattern, name);
  }
  for (const options of [{}, { captureQualification: 'source-bound-v2' }, { captureSourcePolicy: 'indexed-evidence-v1' }, { episode: true }]) {
    assert.match(extractionRequest({ messages: messages(1) }, options).system, /User-stated facts are the primary material/);
  }
});


for (const count of [5, 6, 12, 20]) for (const safety of [false, true])
  test(`user material: ${count} suppressed candidates keep exact totals without resurrection (safety=${safety})`, async t => {
  const f = fixture(t, safety ? { contentSafety: 's2h-v1' } : {});
  const capture = (eventId, sources) => f.core.capture({ namespace, client: 'synthetic', sessionId: 'synthetic-session',
    eventId, messages: sources });
  for (const [index, source] of messages(count).entries()) {
    const admitted = ok(f.core.admit({ namespace, memory: { content: source.content, kind: 'fact' },
      receipts: [{ client: 'synthetic-prior', sessionId: 'synthetic-prior-session', eventId: `prior-${index}`,
        role: 'user', excerpt: 'A synthetic previous receipt.' }] }));
    ok(f.core.forget({ namespace, memoryId: admitted.memory.id, expectedRevision: admitted.memory.revision }));
  }
  const repeated = messages(count).map(message => ({ ...message, id: `repeat-${message.id}` }));
  const result = ok(await capture('repeat', repeated));
  assert.equal(result.admission.suppressedCount, count);
  assert.deepEqual(result.admission.memories, []);
  const inspected = ok(f.core.inspectAdmission({ namespace, client: 'synthetic', eventId: 'repeat' }));
  assert.equal(inspected.suppressedCount, count);
  assert.deepEqual(inspected.members, []);
  const replay = ok(await capture('repeat', repeated));
  assert.equal(replay.duplicate, true);
  assert.equal(replay.suppressedCount, count);
  assert.equal(f.calls.length, 1, 'replay performs no extraction');
  const db = new DatabaseSync(f.path); f.workspace.defer(() => db.close());
  const row = db.prepare("SELECT * FROM admission_claims WHERE client='synthetic' AND event_id='repeat'").get();
  assert.equal(row.suppressed_count, Math.min(5, count), 'legacy CHECK remains satisfied');
  assert.equal(capturedSuppressedCount(db, namespace, { client: 'synthetic', eventId: 'repeat' }, row), count,
    'Raw replay namespace normalization recovers the same exact total');
  assert.equal(db.prepare("SELECT count(*) n FROM admission_claims WHERE client!='synthetic'").get().n,
    Math.ceil(Math.max(0, count - 5) / 5));
});


test('user material: public manual placement retains its five-item bound', async t => {
  const { core } = fixture(t);
  const captured = ok(await core.capture({ namespace, client: 'synthetic', sessionId: 'synthetic-session',
    eventId: 'manual-bound', messages: messages(6) }));
  const guards = captured.classification.memoryRevisions;
  const result = core.applyPlacement({ namespace,
    proposal: { items: guards.map(({ memoryId }) => ({ memoryId, parentIds: [] })) },
    expectedMemoryRevisions: guards, expectedIndexRevision: captured.classification.indexRevision }, 20);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'invalid_input');
});
