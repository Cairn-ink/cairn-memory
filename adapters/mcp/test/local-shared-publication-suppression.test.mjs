import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { openMemoryCore } from '../../../core/contract.mjs';
import { createCommitDispatcher, bindCommitConnection } from '../../../core/commit-dispatch.mjs';
import { createFakeEmbedder } from '../../../core/context-read-embedder.mjs';
import { openContextReadSidecar } from '../../../core/context-read-sidecar.mjs';
import { transaction } from '../../../core/database.mjs';
import { suppressOwnerInside, writeContentSuppressionInside } from '../../../core/content-suppression-storage.mjs';
import { safetyFixture } from '../../../core/testing/content-safety-s2h-fixture.mjs';
import { createContextReadAccess } from '../context-read-access.mjs';
import { ns, counter, ok } from './local-shared-support.mjs';

const forget = (db, kind) => transaction(db, () => kind === 'owner'
  ? suppressOwnerInside(db, { ownerId: ns.ownerId, reason: 'user_forget', actionId: 'synthetic-publication-forget' })
  : writeContentSuppressionInside(db, { namespace: ns, kind: 'namespace', matchMode: 'namespace',
    reason: 'user_forget', actionId: 'synthetic-publication-forget' }));
const admit = core => core.admit({ namespace: ns,
  memory: { content: 'Synthetic selected Memory whose vectors must never survive forget', kind: 'fact' },
  receipts: [{ client: 'synthetic', sessionId: 'publication', eventId: 'source', role: 'user', excerpt: 'Synthetic source' }] });

for (const kind of ['owner', 'namespace']) test(`vector publication keeps the selection epochs across BUSY and ${kind} forget`, { timeout: 10000 }, async t => {
  const f = safetyFixture(t); await f.migrate();
  const writer = f.connect(), access = createContextReadAccess(ns, false, { refresh: true });
  const base = createFakeEmbedder();
  let holder, embeddingFinished = false, backoffs = 0, forgotten = false;
  const host = createCommitDispatcher({ strict: true, onBackoff() {
    backoffs++;
    assert.ok(embeddingFinished && holder?.isTransaction, 'publication, after embedding, encounters the real writer lock');
    assert.ok(host.inspectTransactions().every(state => !state.isTransaction));
    forget(writer, kind); forgotten = true;
    holder.exec('ROLLBACK');
  } });
  const core = host.open(() => openMemoryCore({ path: f.path, raw: false,
    contextRead: { ...access.configuration, counter, embedder: { ...base, async embed(texts, controls) {
      const vectors = await base.embed(texts, controls);
      embeddingFinished = true;
      holder = new DatabaseSync(f.path + '.context-read-v1.sqlite');
      holder.exec('PRAGMA busy_timeout=5000; BEGIN IMMEDIATE');
      return vectors;
    } }, policy: { family: 'local', maxRequests: 100, maxUsd: 1, estimateUsd: () => 0 } } }));
  t.after(() => { if (holder?.isTransaction) holder.exec('ROLLBACK'); holder?.close(); core.close(); writer.close(); });
  const memory = ok(await admit(core)).memory;
  const result = await access.call(core, 'refreshContextIndex', { readSet: [ns], types: ['memory'],
    intent: 'current', budget: { maxItems: 16, maxMs: 5000 } });
  assert.ok(embeddingFinished && forgotten);
  assert.ok(backoffs >= 1, 'R2N_VECTOR_PUBLICATION_BUSY');
  // Inspect durable rows before checking the public envelope: a later refusal
  // must never hide a publication that already stored forgotten derivatives.
  const observer = new DatabaseSync(f.path + '.context-read-v1.sqlite', { readOnly: true });
  try {
    assert.equal(observer.prepare('SELECT count(*) n FROM vectors WHERE id=?').get(memory.id).n, 0,
      'R2N_FORGOTTEN_VECTOR_DURABLE');
    assert.equal(observer.prepare('SELECT count(*) n FROM vectors WHERE json_extract(namespace,\'$.ownerId\')=?').get(ns.ownerId).n, 0,
      'R2N_FORGOTTEN_OWNER_VECTORS_DURABLE');
  } finally { observer.close(); }
  assert.equal(result.ok, false, 'R2N_FORGOTTEN_REFRESH_REFUSED');
});

for (const kind of ['owner', 'namespace']) test(`reconciliation checkpoint keeps the selection epochs across BUSY and ${kind} forget`, { timeout: 10000 }, async t => {
  const f = safetyFixture(t); await f.migrate();
  const writer = f.connect(), suppressor = f.connect();
  let holder, backoffs = 0;
  const host = createCommitDispatcher({ strict: true, onBackoff() {
    backoffs++; forget(suppressor, kind); holder.exec('ROLLBACK');
  } });
  const core = openMemoryCore({ path: f.path, raw: false });
  const memory = ok(admit(core)).memory;
  host.open(() => bindCommitConnection(writer));
  const side = host.open(() => openContextReadSidecar({ path: f.path, db: writer }));
  holder = new DatabaseSync(f.path + '.context-read-v1.sqlite');
  t.after(() => { if (holder.isTransaction) holder.exec('ROLLBACK'); holder.close(); side.close(); core.close(); writer.close(); suppressor.close(); });
  holder.exec('BEGIN IMMEDIATE');
  let refusal;
  try { await side.reconcileAsync({ readSet: [ns], types: ['memory'], intent: 'current',
    accessGeneration: 1, budget: { maxItems: 16, maxMs: 5000 } }); }
  catch (error) { refusal = error; }
  assert.ok(backoffs >= 1, 'R2N_CHECKPOINT_BUSY');
  const observer = new DatabaseSync(f.path + '.context-read-v1.sqlite', { readOnly: true });
  try { assert.equal(observer.prepare('SELECT count(*) n FROM documents WHERE id=?').get(memory.id).n, 0,
    'R2N_FORGOTTEN_DOCUMENT_DURABLE'); }
  finally { observer.close(); }
  assert.match(refusal?.code ?? '', /^(evidence_unavailable|index_unavailable)$/, 'R2N_FORGOTTEN_CHECKPOINT_REFUSED');
});
