import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { openMemoryCore } from '../index.mjs';

const namespace = { ownerId: 'synthetic-incident', scope: 'personal', projectId: null };
const ok = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };
function fixture(t) {
  const path = join(mkdtempSync(join(tmpdir(), 'cairn-incident-')), 'memory.sqlite');
  let edges = [];
  const model = { contextWindow: 8192, countTokens: () => 1, relate: () => ({ edges }) };
  const core = openMemoryCore({ path, model }); t.after(() => core.close());
  const refs = ['The room thermometer read 21 degrees.', 'The room thermometer now reads 26 degrees.',
    'I selected the green desk because it folds.', 'The green desk folds.'].map((content, index) => {
    const memory = ok(core.admit({ namespace, memory: { content, kind: 'context' }, receipts: [{
      client: 'synthetic', sessionId: 'synthetic', eventId: `source-${index}`, role: 'user', excerpt: content,
    }] })).memory;
    return { memoryId: memory.id, revision: memory.revision };
  });
  const inspect = (index = 0, extra = {}) => core.getRationale({ namespace, ...refs[index], ...extra });
  const propose = async (tuples, selected = refs) => { edges = tuples.map(([from, to, relation]) => ({ from, to, relation, fromReceipt: 0, toReceipt: 0 }));
    return ok(await core.reviewRationale({ namespace, refs: selected })); };
  return { path, core, refs, inspect, propose };
}

test('RI1 explicit incident view exposes orphan challenges without claiming a decision or changing default context', async t => {
  const f = fixture(t); assert.equal((await f.propose([[1, 0, 'challenges-premise']])).inserted, 1);
  const before = ok(f.inspect()); assert.deepEqual(before.edges, []);
  const audit = ok(f.inspect(0, { view: 'incident-proposals' }));
  assert.equal(audit.edges.length, 1); assert.equal(audit.edges[0].relation, 'challenges-premise');
  assert.equal(audit.status, 'unassessed'); assert.equal(audit.view, 'incident-proposals');
  assert.equal(audit.coverage, 'root-incident-only'); assert.equal(audit.sources.length, 2);
  assert.deepEqual(ok(f.inspect()), before); assert.deepEqual(ok(f.inspect(0, { view: 'decision-context' })), before);
});

test('RI2 incident root stays one-hop, includes outgoing/self edges once and retains stable order', async t => {
  const f = fixture(t); await f.propose([[0, 0, 'supports-decision'], [0, 1, 'supports-decision'],
    [1, 2, 'supports-decision'], [3, 2, 'supports-decision']]);
  const audit = ok(f.inspect(0, { view: 'incident-proposals' }));
  assert.equal(audit.edges.length, 2); assert.equal(audit.sources.length, 2);
  assert.equal(audit.edges.filter(edge => edge.from === edge.to).length, 1);
  assert.ok(audit.edges.every(edge => edge.from === f.refs[0].memoryId || edge.to === f.refs[0].memoryId));
  assert.deepEqual(ok(f.inspect(0, { view: 'incident-proposals' })), audit);
});

test('RI3 closed modes, namespace/revision guards and cold keyless forget preserve original authority', async t => {
  const f = fixture(t); await f.propose([[1, 0, 'challenges-premise']]);
  for (const view of [null, '', 'history', true, {}, []]) {
    assert.equal(f.inspect(0, { view }).error.code, 'invalid_input');
  }
  assert.equal(f.inspect(0, { view: 'incident-proposals', namespace: { ...namespace, ownerId: 'foreign' } }).error.code, 'memory_not_found');
  assert.equal(f.inspect(0, { view: 'incident-proposals', revision: 999 }).error.code, 'revision_conflict');
  const warm = ok(f.inspect(0, { view: 'incident-proposals' })); f.core.close();
  const cold = openMemoryCore({ path: f.path }); t.after(() => cold.close());
  assert.deepEqual(ok(cold.getRationale({ namespace, ...f.refs[0], view: 'incident-proposals' })), warm);
  ok(cold.forget({ namespace, memoryId: f.refs[1].memoryId, expectedRevision: f.refs[1].revision }));
  assert.deepEqual(ok(cold.getRationale({ namespace, ...f.refs[0], view: 'incident-proposals' })).edges, []);
});

test('RI4 incident sources still fail at six-memory bound without partial graph', async t => {
  const f = fixture(t); const neighbors = [...f.refs.slice(1)];
  for (let i = 0; i < 3; i++) {
    const content = `Synthetic neighbor ${i}.`;
    const memory = ok(f.core.admit({ namespace, memory: { content, kind: 'context' }, receipts: [{
      client: 'synthetic', sessionId: 'synthetic', eventId: `extra-${i}`, role: 'user', excerpt: content,
    }] })).memory;
    neighbors.push({ memoryId: memory.id, revision: memory.revision });
  }
  for (const ref of neighbors.slice(0, 5)) await f.propose([[0, 1, 'supports-decision']], [f.refs[0], ref]);
  assert.equal(ok(f.inspect(0, { view: 'incident-proposals' })).sources.length, 6);
  await f.propose([[0, 1, 'supports-decision']], [f.refs[0], neighbors[5]]);
  assert.equal(f.inspect(0, { view: 'incident-proposals' }).error.code, 'rationale_limit');
  assert.deepEqual(ok(f.inspect()).edges, []);
});

test('RI5 changing a receipt invalidates incident proposals without a model call', async t => {
  const f = fixture(t); await f.propose([[1, 0, 'challenges-premise']]);
  assert.equal(ok(f.inspect(0, { view: 'incident-proposals' })).edges.length, 1);
  const db = new DatabaseSync(f.path); t.after(() => db.close());
  db.prepare('UPDATE receipts SET excerpt = ? WHERE memory_id = ?')
    .run('The reading was corrected by the source.', f.refs[1].memoryId);
  assert.deepEqual(ok(f.inspect(0, { view: 'incident-proposals' })).edges, []);
});
