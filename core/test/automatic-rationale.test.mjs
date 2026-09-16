import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openMemoryCore } from '../index.mjs';
import { rationaleModel } from '../testing/rationale-model.mjs';

const namespace = { ownerId: 'automatic-rationale', scope: 'personal', projectId: null };
const ok = r => { assert.equal(r.ok, true, JSON.stringify(r)); return r.value; };
const error = (r, code) => { assert.equal(r.ok, false, JSON.stringify(r)); if (code) assert.equal(r.error.code, code); };
const input = (eventId, content) => ({ namespace, client: 'synthetic-client', sessionId: 'synthetic-session', eventId,
  messages: [{ id: eventId, role: 'user', content }] });
const decision = input('one', 'I chose A because it supports offline work.');
const challenge = input('two', 'I checked: A cannot work offline.');
function fixture(t, options = {}) {
  const path = join(mkdtempSync(join(tmpdir(), 'cairn-auto-rationale-')), 'memory.sqlite'); const calls = [];
  const model = rationaleModel((method, request) => calls.push({ method, input: structuredClone(request.input) }));
  const core = openMemoryCore({ path, model, captureQualification: 'source-bound-v2', captureRationale: 'source-bound-v1', ...options });
  const db = new DatabaseSync(path); t.after(() => { core.close(); db.close(); });
  const recall = patch => core.recall({ readSet: [namespace], query: 'Why did I chose A?', contextMode: 'rationale-evidence', ...patch });
  return { core, model, path, calls, db, recall };
}

test('A1 capture discovers prior decision without IDs, after classification, then recall carries unselected challenge and cold inspect survives', async t => {
  const f = fixture(t);
  const first = ok(await f.core.capture(decision)); assert.equal(first.classification.status, 'applied');
  assert.equal(first.rationale.status, 'reviewed'); assert.equal(first.rationale.inserted, 1);
  assert.deepEqual(f.calls.map(c => c.method), ['extract', 'qualifyCandidates', 'classify', 'relate']);
  const second = ok(await f.core.capture(challenge)); assert.equal(second.rationale.status, 'reviewed');
  assert.equal(second.rationale.discovery.candidateCount, 2);
  const result = ok(await f.recall()); assert.equal(result.memories.length, 1);
  const root = result.memories[0]; assert.equal(root.rationale.status, 'reconfirmation-suggested');
  assert.equal(root.rationale.sources.length, 2);
  assert.ok(root.rationale.sources.some(s => s.receipts.some(r => r.excerpt === challenge.messages[0].content)));
  assert.deepEqual(f.calls.findLast(c => c.method === 'rank').input.candidates[0].rationale, root.rationale);
  assert.equal(root.memory.currentness, 'current');
  assert.ok(!JSON.stringify(root).includes('synthetic-client'));
  const count = f.calls.length; const duplicate = ok(await f.core.capture(challenge));
  assert.equal(duplicate.rationale.status, 'not-run'); assert.equal(duplicate.rationale.reason, 'duplicate');
  assert.equal(f.calls.length, count);
  f.core.close(); const cold = openMemoryCore({ path: f.path }); t.after(() => cold.close());
  assert.deepEqual(ok(cold.getRationale({ namespace, memoryId: root.memory.id, revision: root.memory.revision })), root.rationale);
  const other = root.rationale.sources.find(s => s.memory.id !== root.memory.id).memory;
  ok(cold.forget({ namespace, memoryId: other.id, expectedRevision: other.revision }));
  assert.equal(ok(cold.getRationale({ namespace, memoryId: root.memory.id, revision: root.memory.revision })).status, 'unassessed');
});

test('DC3 ordinary capture retains direct-only challenge through cold inspection and rationale recall', async t => {
  const f = fixture(t);
  f.model.relate = ({ input: { memories } }) => {
    const root = memories.find(memory => memory.receipts.some(receipt =>
      receipt.excerpt.startsWith('I chose A because')));
    const later = memories.find(memory => memory.receipts.some(receipt =>
      receipt.excerpt.startsWith('I checked: A cannot work offline')));
    return { edges: root && later ? [{ from: later.index, to: root.index,
      relation: 'challenges-premise', fromReceipt: 0, toReceipt: 0 }] : [] };
  };
  const first = ok(await f.core.capture(decision));
  const memoryId = first.admission.memories[0].id;
  const ref = { memoryId, revision: ok(f.core.get({ namespace, memoryId })).memory.revision };
  const sourceBefore = ok(f.core.fetch({ namespace, refs: [ref], contextMode: 'source-evidence' })).items[0];
  assert.deepEqual(ok(f.core.getRationale({ namespace, ...ref })).edges, []);
  const second = ok(await f.core.capture(challenge));
  assert.equal(second.rationale.status, 'reviewed'); assert.equal(second.rationale.inserted, 1);
  const sourceAfter = ok(f.core.fetch({ namespace, refs: [ref], contextMode: 'source-evidence' })).items[0];
  assert.deepEqual(sourceAfter, sourceBefore);
  const warm = ok(f.core.getRationale({ namespace, ...ref }));
  assert.equal(warm.edges.length, 1); assert.equal(warm.edges[0].relation, 'challenges-premise');
  assert.equal(warm.status, 'reconfirmation-suggested');
  assert.ok(warm.sources.some(source => source.receipts.some(receipt =>
    receipt.excerpt === challenge.messages[0].content)));
  const incident = ok(f.core.getRationale({ namespace, ...ref, view: 'incident-proposals' }));
  assert.equal(incident.edges.length, 1); assert.equal(incident.status, 'unassessed');
  f.core.close(); const cold = openMemoryCore({ path: f.path, model: f.model }); t.after(() => cold.close());
  assert.deepEqual(ok(cold.getRationale({ namespace, ...ref })), warm);
  const recalled = ok(await cold.recall({ readSet: [namespace], query: 'Why did I choose A?',
    contextMode: 'rationale-evidence' }));
  const root = recalled.memories.find(item => item.memory.id === memoryId);
  assert.ok(root); assert.deepEqual(root.rationale, warm);
  assert.equal(root.memory.currentness, 'current');
});

test('A2 rationale failure reports saved admission, duplicate never retries; empty capture skips', async t => {
  const f = fixture(t); let attempted = 0;
  f.model.relate = () => { attempted++; throw new Error('sensitive upstream error'); };
  const result = ok(await f.core.capture(decision)); assert.equal(result.rationale.status, 'failed');
  assert.equal(result.rationale.error.code, 'rationale_failed'); assert.equal(result.admission.memories.length, 1);
  ok(f.core.get({ namespace, memoryId: result.admission.memories[0].id }));
  ok(await f.core.capture(decision)); assert.equal(attempted, 1);
  f.model.extract = () => ({ items: [] });
  assert.deepEqual(ok(await f.core.capture(challenge)).rationale, { status: 'skipped', reason: 'empty' });
});

test('A3 absent mode does not call relate, invalid mode fails before database creation', async t => {
  const path = join(mkdtempSync(join(tmpdir(), 'cairn-invalid-rationale-')), 'memory.sqlite');
  for (const config of [{ captureRationale: null }, { captureRationale: 'other' }, { captureRationale: 'source-bound-v1' },
    { captureRationale: 'source-bound-v1', captureQualification: 'source-bound-v1' }]) {
    assert.throws(() => openMemoryCore({ path, ...config })); assert.equal(existsSync(path), false);
  }
  const core = openMemoryCore({ path, model: rationaleModel(method => assert.notEqual(method, 'relate')),
    captureQualification: 'source-bound-v2' }); t.after(() => core.close());
  assert.equal(Object.hasOwn(ok(await core.capture(decision)), 'rationale'), false);
});

test('A4 discovery stays in namespace and bounds candidates; no relevance/coverage guarantee', async t => {
  const f = fixture(t);
  for (let i = 0; i < 9; i++) ok(f.core.admit({ namespace, memory: { content: `A offline distraction ${i}`, kind: 'context' },
    receipts: [{ client: 'test', sessionId: 's', eventId: `d${i}`, role: 'user', excerpt: `distraction ${i}` }] }));
  ok(f.core.admit({ namespace: { ...namespace, ownerId: 'foreign' }, memory: { content: 'A offline FOREIGN', kind: 'context' },
    receipts: [{ client: 'test', sessionId: 's', eventId: 'foreign', role: 'user', excerpt: 'FOREIGN' }] }));
  const result = ok(await f.core.capture(decision)); assert.equal(result.rationale.status, 'reviewed');
  assert.equal(result.rationale.discovery.candidateCount, 6); assert.equal(result.rationale.discovery.candidatesTruncated, true);
  assert.equal(result.rationale.discovery.semanticCoverage, 'unassessed');
  assert.ok(!JSON.stringify(f.calls.filter(c => c.method === 'relate')).includes('FOREIGN'));
});

test('A5 linked evidence mutations at rank/output counter cannot return stale rationale, including unselected roots', async t => {
  for (const stage of ['rank', 'counter']) {
    const f = fixture(t); ok(await f.core.capture(decision)); ok(await f.core.capture(challenge));
    const change = () => {
      const row = f.db.prepare("SELECT id, revision FROM memories WHERE content LIKE 'I checked:%'").get();
      if (row) ok(f.core.forget({ namespace, memoryId: row.id, expectedRevision: row.revision }));
    };
    if (stage === 'rank') f.model.rank = () => { change(); return { refs: [] }; };
    else f.model.countTokens = text => { if (text.startsWith('{"refs":')) change(); return 1; };
    error(await f.recall());
  }
});

test('A6 graph counts in fetch/rank budgets and modes cannot share cursors or qualifications', async t => {
  const f = fixture(t); ok(await f.core.capture(decision)); ok(await f.core.capture(challenge));
  const memories = ok(f.core.list({ namespace })).memories;
  const refs = memories.map(memory => ({ memoryId: memory.id, revision: memory.revision }));
  const source = ok(f.core.fetch({ namespace, refs, contextMode: 'source-evidence' }));
  error(f.core.fetch({ namespace, refs, contextMode: 'rationale-evidence', cursor: source.nextCursor }), 'invalid_cursor');
  error(f.core.fetch({ namespace, refs, contextMode: 'rationale-evidence', view: 'historical' }), 'invalid_input');
  error(await f.recall({ includeQualification: true }), 'invalid_input');
  f.model.countTokens = text => text.includes('"rationale"') ? 4001 : 1;
  error(f.core.fetch({ namespace, refs, contextMode: 'rationale-evidence' }), 'context_item_too_large');
  f.model.countTokens = text => text.includes('"candidates"') && text.includes('"rationale"') ? 6001 : 1;
  error(await f.recall(), 'context_budget_exceeded');
});

test('A7 actual filing revision is used before rationale, while classification failure remains separately visible', async t => {
  const f = fixture(t);
  f.model.classify = ({ input }) => ({ items: input.memories.map(memory => ({ memoryId: memory.id,
    parentIds: [], newL1: { title: 'Offline decision', parentL2Ids: [] } })) });
  const first = ok(await f.core.capture(decision)); assert.equal(first.classification.status, 'applied');
  assert.ok(first.classification.memoryRevisions[0].revision > first.admission.memories[0].revision);
  assert.equal(first.rationale.status, 'reviewed');
  const ref = first.classification.memoryRevisions[0];
  assert.equal(ok(f.core.getRationale({ namespace, ...ref })).edges.length, 1);
  f.model.classify = () => { throw new Error('synthetic classification failure'); };
  const second = ok(await f.core.capture(challenge)); assert.equal(second.classification.status, 'failed');
  assert.equal(second.rationale.status, 'reviewed');
  assert.equal(ok(f.core.getRationale({ namespace, ...ref })).status, 'reconfirmation-suggested');
});

test('A8 bounded discovery query reports omitted canonical tail and relates retained redacted sources only', async t => {
  const f = fixture(t); f.model.extract = () => ({ items: [{ content: 'I chose A because it works offline.', kind: 'decision',
    confidence: 0.5, sourceIndices: [0] }] });
  const secret = 'sk-' + 'a'.repeat(48);
  const result = ok(await f.core.capture({ ...decision, messages: Array.from({ length: 7 }, (_, index) => ({ id: `message-${index}`,
    role: 'user', content: index === 0 ? `I chose A because it works offline. ${secret}` : 'filler '.repeat(115) })) }));
  assert.equal(result.rationale.status, 'reviewed'); assert.equal(result.rationale.discovery.queryTruncated, true);
  const payload = JSON.stringify(f.calls.find(c => c.method === 'relate').input);
  assert.ok(!payload.includes(secret)); assert.ok(payload.includes('[REDACTED]'));
});
