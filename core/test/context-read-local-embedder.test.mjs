import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { coreFixture, query, refresh, ns, ok } from '../testing/context-read-core-fixture.mjs';
const vector = () => { const v = new Float32Array(1024); v[0] = 1; return v; };
const localPolicy = { family: 'local', maxRequests: 100, maxConcurrent: 1, maxBatchDocuments: 1 };
const localStatus = () => Object.freeze({ state: 'ready', reason: null });
function port(behavior = texts => texts.map(vector), revision = randomUUID(), id = 'local:bge-m3:dense') { return { id, revision, dimensions: 1024, normalization: 'l2', embed: behavior }; }
function vectors(f, revision) {
  const db = new DatabaseSync(f.path + '.context-read-v1.sqlite', { readOnly: true }); db.exec('PRAGMA busy_timeout=5000');
  try { return db.prepare('SELECT id,embedder_id,embedder_revision,dimensions FROM vectors WHERE embedder_revision=? ORDER BY id').all(revision); } finally { db.close(); }
}
test('L11 singleton local commit survives next refusal and refresh resumes without re-embedding', async t => {
  const f = coreFixture(t); f.admit('apple first'); f.admit('apple second');
  let failSecond = true, attempts = [];
  const embedder = port(async texts => { assert.equal(texts.length, 1); attempts.push(texts[0]); if (failSecond && attempts.length === 2) throw Object.assign(Error('synthetic refusal'), { code: 'context_item_too_large' }); return [vector()]; });
  f.reopen({ embedder, policy: localPolicy, localStatus });
  const first = ok(await f.call('refreshContextIndex', refresh()));
  assert.equal(first.status, 'partial'); assert.equal(first.progress.embedded, 1); assert.equal(first.progress.embeddingAttempts, 2); assert.equal(vectors(f, embedder.revision).length, 1);
  const committedText = attempts[0]; failSecond = false;
  const second = ok(await f.call('refreshContextIndex', refresh()));
  assert.equal(second.status, 'complete'); assert.equal(second.progress.embedded, 1); assert.equal(vectors(f, embedder.revision).length, 2);
  assert.equal(attempts.filter(text => text === committedText).length, 1);
});
test('L10 equal-dimensional hosted/local identities and two revisions remain isolated with explicit back-switch reuse', async t => {
  const f = coreFixture(t); f.admit('apple identity');
  const beforeDDL = f.db.prepare("SELECT name,sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY name").all();
  const a = port(), b = port(), hosted = port(undefined, randomUUID(), 'openai:equal-dimensional-fixture');
  for (const embedder of [hosted, a, b, a]) {
    let calls = 0; const counted = { ...embedder, embed: async texts => { calls++; return texts.map(vector); } };
    f.reopen({ embedder: counted, ...(embedder === hosted ? { policy: { family: 'hosted', maxRequests: 100, maxUsd: 1, estimateUsd: () => 0 } } : { localStatus, policy: localPolicy }) });
    // Omit the local-only field on the hosted control rather than setting it.
    const value = ok(await f.call('refreshContextIndex', refresh())); assert.equal(value.status, 'complete');
    if (embedder === a && vectors(f, b.revision).length) assert.equal(calls, 0);
    assert.equal(vectors(f, embedder.revision).length, 1);
  }
  assert.deepEqual(f.db.prepare("SELECT name,sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY name").all(), beforeDDL);
});
test('L11 canonical forgetting after send blocks late publication and preserves refusal precedence', async t => {
  const f = coreFixture(t), memory = f.admit('apple forget after send');
  const embedder = port(async texts => { ok(f.core.forget({ namespace: ns, memoryId: memory.id, expectedRevision: memory.revision })); return texts.map(vector); });
  f.reopen({ embedder, policy: localPolicy, localStatus });
  const value = await f.call('refreshContextIndex', refresh());
  assert.equal(vectors(f, embedder.revision).length, 0);
  assert.ok(value.ok ? value.value.status === 'partial' || value.value.channels.semantic.state !== 'ready' : ['index_unavailable', 'scope_changed'].includes(value.error.code));
});
test('L12 local refusal preserves lexical; partial/semantic-false preflight does not dispatch query', async t => {
  const f = coreFixture(t); f.admit('apple lexical survives'); let calls = 0;
  const embedder = port(async () => { calls++; throw Object.assign(Error('synthetic crash'), { code: 'provider_error' }); });
  f.reopen({ embedder, policy: localPolicy, localStatus });
  const first = ok(await f.call('findCandidates', query({ semantic: true }))); assert.equal(first.items.length, 1); assert.equal(calls, 0);
  const refreshResult = ok(await f.call('refreshContextIndex', refresh())); assert.equal(refreshResult.status, 'partial'); assert.equal(calls, 1);
  const lexical = ok(await f.call('findCandidates', query({ semantic: false }))); assert.equal(lexical.items.length, 1); assert.equal(calls, 1);
});
