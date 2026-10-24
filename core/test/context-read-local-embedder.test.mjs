import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { coreFixture, query, refresh, ns, ok, receipt, waitForContextEntry, denied } from '../testing/context-read-core-fixture.mjs';
import { performance } from 'node:perf_hooks';
import { fixture as dependencyFixture, ns as dependencyNs } from './card-current-fixture.mjs';
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

const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
for (const stop of ['provider-refusal', 'adapter-cancellation', 'deadline-expiry', 'store-close', 'store-close-provider_error', 'store-close-timeout']) {
  test('L11 singleton-refresh acceptance matrix is incomplete: commit then ' + stop + ' and resume', async t => {
    let now = 0;
    const clock = t.mock.method(performance, 'now', () => now);
    const f = coreFixture(t); f.admit('apple singleton one'); f.admit('apple singleton two');
    const entered = deferred(), release = deferred(), attempts = [];
    let request;
    const embedder = port(async (texts, options) => {
      assert.equal(texts.length, 1); attempts.push(texts[0]);
      if (attempts.length === 2) { request = options; entered.resolve(); await release.promise; }
      return [vector()];
    });
    const policy = { ...localPolicy, maxRequests: 3 };
    f.reopen({ embedder, policy, localStatus });
    const operation = f.call('refreshContextIndex', refresh());
    try {
      await waitForContextEntry(entered.promise, operation);
      assert.equal(vectors(f, embedder.revision).length, 1, 'first singleton transaction is already committed');
      if (stop === 'deadline-expiry') now = request.deadlineAt + 1;
      if (stop.startsWith('store-close')) { f.context.close(); assert.equal(request.signal.aborted, true); }
      if (stop === 'provider-refusal') release.reject(Object.assign(Error('provider_error'), { code: 'provider_error' }));
      else if (stop === 'adapter-cancellation') release.reject(new DOMException('synthetic cancellation', 'AbortError'));
      else if (stop.startsWith('store-close-')) { const code = stop.slice('store-close-'.length); release.reject(Object.assign(Error(code), { code })); }
      else release.resolve();
      const result = await operation;
      if (stop.startsWith('store-close')) { denied(result, 'store_closed'); assert.equal(result.error.details, undefined); }
      else {
        const value = ok(result);
        assert.equal(value.status, 'partial'); assert.equal(value.progress.embedded, 1); assert.equal(value.progress.embeddingAttempts, 2);
        assert.equal(value.channels.semantic.state, stop === 'provider-refusal' ? 'provider_error' : 'timeout');
        if (stop === 'deadline-expiry') assert.equal(value.coverage.stops.deadline, true);
      }
      assert.equal(vectors(f, embedder.revision).length, 1); assert.equal(attempts.length, 2);
      now = 0;
      if (stop.startsWith('store-close')) f.reopen({ embedder, policy, localStatus });
      const resumed = ok(await f.call('refreshContextIndex', refresh()));
      assert.equal(resumed.status, 'complete'); assert.equal(resumed.progress.embedded, 1); assert.equal(resumed.progress.embeddingAttempts, 1);
      assert.equal(vectors(f, embedder.revision).length, 2); assert.equal(attempts.filter(text => text === attempts[0]).length, 1);
      const capped = ok(await f.call('findCandidates', query({ semantic: true })));
      assert.equal(capped.channels.semantic.state, 'budget_denied'); assert.equal(capped.items.length, 2); assert.equal(attempts.length, 3);
    } finally { release.resolve(); await operation; clock.mock.restore(); }
  });
}

function seedCards(f) {
  return [1, 2].map(n => {
    const title = 'apple singleton Card ' + n, body = 'independently authored body ' + n;
    const draft = ok(f.host.call(f.core, 'createCardDraft', { namespace: ns, actionId: 'draft-' + n, drafting: 'authored',
      input: { title, body, authoredInput: { text: 'source ' + n, occurredAt: null } } }));
    const card = ok(f.host.call(f.core, 'confirmCardDraft', { namespace: ns, cardId: draft.id, expectedRevision: draft.revision, actionId: 'confirm-' + n, applicability: 'current' }));
    return { ...card, text: title + '\n' + body };
  });
}
for (const mutation of ['memory-edit', 'memory-forget', 'memory-deletion', 'card-body', 'card-support', 'card-applicability', 'card-deletion', 'grant-revocation']) {
  for (const outcome of ['vector', 'provider_error', 'timeout']) {
    test('L11 singleton-refresh acceptance matrix is incomplete: ' + mutation + ' after send overrides ' + outcome, async t => {
      t.mock.method(performance, 'now', () => 0);
      const cards = mutation.startsWith('card'), f = coreFixture(t, { cards });
      const definitions = cards ? seedCards(f) : ['apple mutation one', 'apple mutation two'].map(text => ({ ...f.admit(text), text }));
      const entered = deferred(), release = deferred(), attempts = [];
      const embedder = port(async texts => { assert.equal(texts.length, 1); attempts.push(texts[0]); if (attempts.length === 2) { entered.resolve(); await release.promise; } return [vector()]; });
      f.reopen({ embedder, policy: localPolicy, localStatus });
      const input = refresh({ types: [cards ? 'card' : 'memory'] });
      const operation = f.call('refreshContextIndex', input);
      try {
        await waitForContextEntry(entered.promise, operation);
        const committed = vectors(f, embedder.revision); assert.equal(committed.length, 1);
        const target = definitions.find(row => row.text === attempts[1]); assert.ok(target); assert.notEqual(target.id, committed[0].id);
        if (mutation === 'memory-edit') ok(f.core.correct({ namespace: ns, memoryId: target.id, expectedRevision: target.revision,
          content: 'apple corrected after dispatch', kind: 'fact', receipt: receipt('singleton-correction') }));
        if (mutation === 'memory-forget') ok(f.core.forget({ namespace: ns, memoryId: target.id, expectedRevision: target.revision }));
        if (mutation === 'memory-deletion') {
          const writer = new DatabaseSync(f.path); writer.exec('PRAGMA busy_timeout=5000');
          try {
            // Model a canonical deletion transaction, including the namespace
            // epoch advanced by canonical writers (not an unfenced SQL edit).
            writer.exec('BEGIN IMMEDIATE');
            writer.prepare('DELETE FROM receipts WHERE memory_id=?').run(target.id);
            writer.prepare('DELETE FROM memories WHERE id=?').run(target.id);
            writer.prepare('UPDATE namespace_epochs SET epoch=epoch+1 WHERE owner_id=? AND scope=? AND project_id=?').run(ns.ownerId, ns.scope, ns.projectId ?? '');
            writer.exec('COMMIT');
          } finally { writer.close(); }
        }
        if (cards) {
          const detail = ok(f.host.call(f.core, 'getCard', { namespace: ns, cardId: target.id })).card;
          if (mutation === 'card-body' || mutation === 'card-applicability') ok(f.host.call(f.core, 'editKnowledgeCard', {
            namespace: ns, cardId: target.id, expectedRevision: detail.revision, actionId: 'mutate-card', title: detail.title,
            body: mutation === 'card-body' ? 'apple corrected Card body' : detail.body,
            bindings: detail.bindings.map(binding => binding.source), applicability: mutation === 'card-applicability' ? 'historical' : 'current' }));
          if (mutation === 'card-support') ok(f.host.call(f.core, 'deleteSourceNote', { namespace: ns, sourceId: detail.bindings[0].source.sourceId, expectedRevision: 1, actionId: 'delete-support' }));
          if (mutation === 'card-deletion') ok(f.host.call(f.core, 'deleteKnowledgeCard', { namespace: ns, cardId: target.id, expectedRevision: detail.revision, actionId: 'delete-card' }));
        }
        if (mutation === 'grant-revocation') f.trusted.state.enabled = false;
        if (outcome === 'vector') release.resolve(); else release.reject(Object.assign(Error(outcome), { code: outcome }));
        const result = await operation;
        denied(result, mutation === 'grant-revocation' ? 'scope_changed' : 'index_unavailable');
        if (mutation === 'grant-revocation') assert.equal(result.error.details, undefined);
        else assert.equal(result.error.details.channels.semantic.state, 'stale_index');
        assert.deepEqual(vectors(f, embedder.revision), committed, 'late vectors never publish, even if the provider also refuses');
        assert.equal(attempts.length, 2);
        f.trusted.state.enabled = true;
        const resumed = ok(await f.call('refreshContextIndex', input));
        const remaining = ['memory-edit', 'card-body', 'grant-revocation'].includes(mutation) ? 1 : 0;
        assert.equal(resumed.status, 'complete'); assert.equal(resumed.progress.embedded, remaining); assert.equal(resumed.progress.embeddingAttempts, remaining);
        assert.equal(attempts.length, 2 + remaining); assert.equal(attempts.filter(text => text === attempts[0]).length, 1);
      } finally { release.resolve(); await operation; }
    });
  }
}

for (const outcome of ['vector', 'provider_error', 'timeout']) test('L11 singleton-refresh acceptance matrix is incomplete: Card dependency changes after send override ' + outcome, async t => {
  t.mock.method(performance, 'now', () => 0);
  const f = dependencyFixture(t);
  const a = f.card({ declare: false, body: 'first independent body' }), b = f.card({ declare: false, body: 'second dependent body' });
  const ordered = [a, b].sort((a, b) => a.cardId < b.cardId ? -1 : 1), target = ordered[1];
  ok(f.call('declareCardCurrentDependencies', { namespace: dependencyNs, cardId: target.cardId, expectedRevision: target.revision,
    expectedDependencyRevision: null, actionId: 'declare-target', currentDependencies: f.declaration() }));
  const entered = deferred(), release = deferred(), attempts = [];
  const embedder = port(async texts => { attempts.push(texts[0]); if (attempts.length === 2) { entered.resolve(); await release.promise; } return [vector()]; });
  f.reopen(true, { contextRead: { ...f.h.context, embedder, policy: localPolicy, localStatus } });
  const input = refresh({ readSet: [dependencyNs], types: ['card'] }), operation = f.call('refreshContextIndex', input);
  try {
    await waitForContextEntry(entered.promise, operation);
    const committed = vectors(f, embedder.revision); assert.equal(committed.length, 1); assert.equal(committed[0].id, ordered[0].cardId);
    const before = f.db.prepare('SELECT revision,body_revision FROM private_cards WHERE id=?').get(target.cardId);
    f.change();
    assert.deepEqual(f.db.prepare('SELECT revision,body_revision FROM private_cards WHERE id=?').get(target.cardId), before, 'dependency-only mutation leaves Card body/revision intact');
    if (outcome === 'vector') release.resolve(); else release.reject(Object.assign(Error(outcome), { code: outcome }));
    const result = await operation; denied(result, 'index_unavailable'); assert.equal(result.error.details.channels.semantic.state, 'stale_index');
    assert.deepEqual(vectors(f, embedder.revision), committed); assert.equal(attempts.length, 2);
    const resumed = ok(await f.call('refreshContextIndex', input)); assert.equal(resumed.status, 'complete'); assert.equal(resumed.progress.embeddingAttempts, 0); assert.equal(attempts.length, 2);
  } finally { release.resolve(); await operation; }
});

test('L11 singleton-refresh acceptance matrix is incomplete: oversized document remains uncovered on resume', async t => {
  const f = coreFixture(t), ordinary = f.admit('apple ordinary'), oversized = f.admit('apple oversized'), attempts = [];
  const embedder = port(async texts => { attempts.push(texts[0]); if (texts[0].includes('oversized')) throw Object.assign(Error('context_item_too_large'), { code: 'context_item_too_large' }); return [vector()]; });
  f.reopen({ embedder, policy: localPolicy, localStatus });
  const result = ok(await f.call('refreshContextIndex', refresh()));
  assert.equal(result.status, 'partial'); assert.equal(result.channels.semantic.state, 'provider_error');
  assert.equal(result.channels.semantic.causes.includes('context_item_too_large'), true);
  const count = vectors(f, embedder.revision).length, before = attempts.length;
  assert.equal(count, ordinary.id < oversized.id ? 1 : 0);
  assert.equal(vectors(f, embedder.revision).some(row => row.id === oversized.id), false);
  const resumed = ok(await f.call('refreshContextIndex', refresh()));
  assert.equal(resumed.status, 'partial'); assert.equal(resumed.progress.embedded, 0); assert.equal(resumed.progress.embeddingAttempts, 1);
  assert.equal(vectors(f, embedder.revision).length, count); assert.equal(attempts.length, before + 1);
});
