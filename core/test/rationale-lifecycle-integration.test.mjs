import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { openMemoryCore } from '../index.mjs';
import { rationaleModel } from '../testing/rationale-model.mjs';

const namespace = { ownerId: 'rationale-lifecycle', scope: 'personal', projectId: null };
const ok = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };
const edge = (from, to, relation) => ({ from, to, relation, fromReceipt: 0, toReceipt: 0 });
const support = (from, to) => edge(from, to, 'supports-decision');
const challenge = (from, to) => edge(from, to, 'challenges-premise');

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'cairn-rationale-lifecycle-'));
  const path = join(dir, 'memory.sqlite');
  const model = rationaleModel();
  const core = openMemoryCore({ path, model });
  let closed = false;
  const close = () => { if (!closed) { core.close(); closed = true; } };
  t.after(() => { close(); rmSync(dir, { recursive: true, force: true }); });
  const detail = id => ok(core.get({ namespace, memoryId: id, includeQualification: true }));
  const ref = id => ({ memoryId: id, revision: detail(id).memory.revision });
  const epoch = () => ok(core.map({ namespace, purpose: 'classification' })).indexRevision;
  const admit = (eventId, content, qualification) => ok(core.admit({ namespace,
    memory: { content, kind: 'context' },
    receipts: [{ client: 'synthetic', sessionId: 'lifecycle', eventId, role: 'user', excerpt: content }],
    ...(qualification ? { qualification } : {}) })).memory;
  const review = (refs, edges, writeMode) => {
    model.relate = () => ({ edges });
    return core.reviewRationale({ namespace, refs, ...(writeMode ? { writeMode } : {}) });
  };
  const place = items => ok(core.applyPlacement({ namespace, proposal: { items },
    expectedMemoryRevisions: items.map(item => ref(item.memoryId)), expectedIndexRevision: epoch() }));
  return { core, model, path, close, detail, ref, epoch, admit, review, place };
}

function seed(f) {
  const text = 'I chose A because its offline mode supports the field team.';
  const decision = f.admit('decision', text, { version: 1,
    slot: { subject: 'A', property: 'offline mode', scope: 'field team', applies: 'current decision' },
    value: 'supports field work', attribution: 'direct', commitment: 'adopted',
    anchors: [{ receiptIndex: 0, start: 0, end: text.length, text,
      fields: ['subject', 'property', 'scope', 'applies', 'value', 'attribution', 'commitment'] }] });
  const mistaken = f.admit('mistaken-report', 'The old note reporting that A cannot work offline was mistaken.');
  const crossing = f.admit('crossing', 'Another reason for A remains in the source record.');
  return { decision, mistaken, crossing };
}

async function seededGraph(f) {
  const memories = seed(f);
  const { decision, mistaken, crossing } = memories;
  ok(await f.review([f.ref(decision.id), f.ref(mistaken.id)],
    [support(0, 0), challenge(1, 0)]));
  ok(await f.review([f.ref(decision.id), f.ref(crossing.id)], [support(1, 0)]));
  const graph = ok(f.core.getRationale({ namespace, ...f.ref(decision.id) }));
  assert.equal(graph.status, 'reconfirmation-suggested');
  assert.deepEqual(graph.edges.map(item => item.relation).sort(),
    ['supports-decision', 'supports-decision', 'challenges-premise'].sort());
  assert.ok(f.detail(decision.id).qualification?.anchors.length);
  return memories;
}

function coldRead(path, ref) {
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import { openMemoryCore } from ${JSON.stringify(new URL('../index.mjs', import.meta.url).href)};
    globalThis.fetch = () => { throw new Error('network disabled in cold reader'); };
    const core = openMemoryCore({ path: process.argv[1] });
    const namespace = JSON.parse(process.argv[2]);
    const ref = JSON.parse(process.argv[3]);
    const result = { rationale: core.getRationale({ namespace, ...ref }),
      detail: core.get({ namespace, memoryId: ref.memoryId, includeQualification: true }) };
    core.close(); process.stdout.write(JSON.stringify(result));
  `, path, JSON.stringify(namespace), JSON.stringify(ref)],
  { encoding: 'utf8', timeout: 10000, env: { NODE_NO_WARNINGS: '1' } });
  assert.equal(child.status, 0, child.stderr);
  return JSON.parse(child.stdout);
}

function sameSource(before, after) {
  assert.equal(after.memory.content, before.memory.content);
  assert.deepEqual(after.receipts, before.receipts);
  // Qualification stays bound to its original source revision; rationale edge
  // endpoint revisions are the guards rebound by pure filing.
  assert.deepEqual(after.qualification, before.qualification);
  assert.ok(after.qualification.boundRevision <= after.memory.revision);
}

test('LI3 filing, selective replacement and refiling preserve exact surviving links and sources', async t => {
  const f = fixture(t); const { decision, mistaken, crossing } = await seededGraph(f);
  const initialDecision = f.detail(decision.id);
  const originalRef = f.ref(decision.id);
  f.place([{ memoryId: decision.id, parentIds: [], newL1: { title: 'Offline decisions', parentL2Ids: [] } },
    { memoryId: mistaken.id, parentIds: [], newL1: { title: 'Source reports', parentL2Ids: [] } }]);
  const filedRef = f.ref(decision.id); const filedMistaken = f.ref(mistaken.id);
  assert.equal(filedRef.revision, originalRef.revision + 1);
  assert.equal(f.core.getRationale({ namespace, ...originalRef }).error.code, 'revision_conflict');
  const beforeReview = f.detail(decision.id);
  sameSource(initialDecision, beforeReview);
  assert.equal(beforeReview.memory.filing.status, 'filed');
  assert.ok(beforeReview.placements.length > 0);
  assert.equal(ok(f.core.getRationale({ namespace, ...filedRef })).edges.length, 3);

  const reviewed = ok(await f.review([filedRef, filedMistaken], [support(0, 0)], 'replace-reviewed'));
  assert.equal(reviewed.removed, 1); assert.equal(reviewed.inserted, 0);
  assert.deepEqual(f.detail(decision.id), beforeReview);
  const corrected = ok(f.core.getRationale({ namespace, ...filedRef }));
  assert.equal(corrected.status, 'unassessed');
  assert.equal(corrected.edges.length, 2);
  assert.deepEqual(new Set(corrected.edges.map(item => item.from)), new Set([decision.id, crossing.id]));
  assert.equal(ok(f.core.getRationale({ namespace, ...f.ref(crossing.id), view: 'incident-proposals' })).edges.length, 1);

  f.place([{ memoryId: decision.id, parentIds: [] }]);
  f.place([{ memoryId: decision.id, parentIds: [], newL1: { title: 'Refiled decisions', parentL2Ids: [] } }]);
  const finalRef = f.ref(decision.id);
  assert.equal(finalRef.revision, filedRef.revision + 2);
  assert.equal(f.core.getRationale({ namespace, ...filedRef }).error.code, 'revision_conflict');
  const warm = ok(f.core.getRationale({ namespace, ...finalRef }));
  assert.equal(warm.status, 'unassessed'); assert.equal(warm.edges.length, 2);
  assert.equal(new Set(warm.edges.map(item => JSON.stringify(item))).size, 2);
  const finalDetail = f.detail(decision.id);
  sameSource(initialDecision, finalDetail);
  assert.equal(finalDetail.memory.filing.status, 'filed');
  assert.ok(finalDetail.placements.length > 0);
  f.close();
  const cold = coldRead(f.path, finalRef);
  assert.deepEqual(ok(cold.rationale), warm);
  assert.deepEqual(ok(cold.detail), finalDetail);
});

for (const mutation of ['correct', 'forget']) test(`LI4 ${mutation} after replacement invalidates links without resurrection`, async t => {
  const f = fixture(t); const { decision, mistaken, crossing } = await seededGraph(f);
  const otherReason = f.admit('other-reason', 'An unrelated plan has a separate reason.');
  const otherDecision = f.admit('other-decision', 'I chose the unrelated plan for that reason.');
  ok(await f.review([f.ref(otherDecision.id), f.ref(otherReason.id)], [support(1, 0)]));
  f.place([{ memoryId: decision.id, parentIds: [], newL1: { title: 'Offline decisions', parentL2Ids: [] } }]);
  ok(await f.review([f.ref(decision.id), f.ref(mistaken.id)], [support(0, 0)], 'replace-reviewed'));
  const beforeMutation = ok(f.core.getRationale({ namespace, ...f.ref(decision.id) }));
  assert.equal(beforeMutation.edges.length, 2);
  const unrelated = ok(f.core.getRationale({ namespace, ...f.ref(otherDecision.id) }));
  const current = f.ref(decision.id);
  if (mutation === 'correct') ok(f.core.correct({ namespace, memoryId: decision.id,
    expectedRevision: current.revision, content: 'I chose C after the new source correction.', kind: 'decision',
    receipt: { client: 'synthetic', sessionId: 'lifecycle', eventId: 'corrected', role: 'user',
      excerpt: 'I chose C after the new source correction.' } }));
  else ok(f.core.forget({ namespace, memoryId: decision.id, expectedRevision: current.revision }));
  assert.equal(f.core.getRationale({ namespace, ...current }).error.code,
    mutation === 'correct' ? 'revision_conflict' : 'memory_not_found');
  if (mutation === 'correct') {
    assert.deepEqual(ok(f.core.getRationale({ namespace, ...f.ref(decision.id) })).edges, []);
    f.place([{ memoryId: decision.id, parentIds: [], newL1: { title: 'Corrected decisions', parentL2Ids: [] } }]);
    assert.deepEqual(ok(f.core.getRationale({ namespace, ...f.ref(decision.id) })).edges, []);
  } else {
    f.place([{ memoryId: crossing.id, parentIds: [], newL1: { title: 'Remaining sources', parentL2Ids: [] } }]);
    assert.deepEqual(ok(f.core.getRationale({ namespace, ...f.ref(crossing.id), view: 'incident-proposals' })).edges, []);
  }
  assert.deepEqual(ok(f.core.getRationale({ namespace, ...f.ref(otherDecision.id) })).edges, unrelated.edges);
});

test('LI4 filing during replacement commits independently and fences the stale review', async t => {
  const f = fixture(t); const { decision, mistaken } = await seededGraph(f);
  const oldRef = f.ref(decision.id);
  const before = ok(f.core.getRationale({ namespace, ...oldRef }));
  const beforeEpoch = f.epoch();
  let placement;
  f.model.relate = () => {
    placement = f.place([{ memoryId: decision.id, parentIds: [],
      newL1: { title: 'Concurrent filing', parentL2Ids: [] } }]);
    return { edges: [] };
  };
  const result = await f.core.reviewRationale({ namespace, refs: [oldRef, f.ref(mistaken.id)],
    writeMode: 'replace-reviewed' });
  assert.equal(result.error.code, 'revision_conflict');
  assert.ok(placement.indexRevision > beforeEpoch);
  const newRef = f.ref(decision.id);
  assert.equal(newRef.revision, oldRef.revision + 1);
  assert.equal(f.core.getRationale({ namespace, ...oldRef }).error.code, 'revision_conflict');
  const after = ok(f.core.getRationale({ namespace, ...newRef }));
  assert.deepEqual(after.edges, before.edges);
  assert.equal(after.status, 'reconfirmation-suggested');
  assert.equal(f.detail(decision.id).memory.filing.status, 'filed');
  assert.equal(f.epoch(), placement.indexRevision);
});
