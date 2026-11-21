import fs, { lstatSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { isMainThread } from 'node:worker_threads';
import { DatabaseSync } from 'node:sqlite';
import assert from 'node:assert/strict';
import test from 'node:test';
import { ns, ok, setupProductSemantic } from '../testing/content-safety-s2h-product-semantic-probe.mjs';
import { createContextReadHost as countingHost } from '../testing/context-semantic-host.mjs';
import { openContextIndexMaintainer, openContextProductReader } from '../index.mjs';
import { PRODUCT_SIDECAR_SUFFIX } from '../context-product-admission.mjs';
import { digest, signedRecord } from '../context-product-validation.mjs';
import { transaction } from '../database.mjs';

const scope = { readSet: [ns], types: ['memory'], intent: 'current' };
const bytesPerItem = 43_014n;
const sufficientVolume = 2_000_000_000n;

// The test host replaces the directory metadata reader inside each Worker.
// The provider is the existing stub, with a counter after its final guard.
export async function createContextReadHost(config) {
  const volume = new BigInt64Array(config.volume);
  const counters = new Int32Array(config.paid);
  const nativeStatfs = fs.statfsSync;
  fs.statfsSync = (directory, options) => {
    if (!config.volume) return nativeStatfs(directory, options);
    if (config.semanticServiceBinding && Atomics.exchange(counters, 3, 0)) Atomics.store(volume, 0, 0n);
    return { bavail: Atomics.load(volume, 0), bsize: 1n };
  };
  syncBuiltinESMExports();

  const host = await countingHost(config);
  const state = new Int32Array(config.state);
  const model = host.contextEmbedding?.embedder;
  if (model) {
    const embed = model.embed.bind(model);
    model.embed = (texts, controls) => embed(texts, {
      ...controls,
      beforeDispatch() {
        if (Atomics.exchange(counters, 2, 0)) Atomics.store(volume, 0, 0n);
        const denyPrice = Atomics.exchange(counters, 4, 0);
        if (denyPrice) Atomics.store(state, 9, 1);
        try {
          controls.beforeDispatch();
        } finally {
          if (denyPrice) Atomics.store(state, 9, 0);
        }
        Atomics.add(counters, 0, 1);
        Atomics.add(counters, 1, texts.length);
      },
    });
  }
  return host;
}

function withDb(path, readOnly, work) {
  const db = new DatabaseSync(path, { readOnly });
  try { return work(db); } finally { db.close(); }
}

// Use the real publication, document rows and canonical fence. Re-sign only
// the counts and matching generation checkpoint, as in the artifact tests.
function setEligible(canonical, sidecar, eligible) {
  const secret = withDb(canonical, true, db => db.prepare('SELECT cursor_secret FROM store_metadata').get().cursor_secret);
  withDb(sidecar, false, db => transaction(db, () => {
    const g = db.prepare('SELECT g.* FROM publications p JOIN generations g ON g.id=p.generation').get();
    const verify = JSON.parse(g.verify);
    verify.counts.byType.memory = { eligible, indexed: eligible };
    verify.counts.documents = eligible;
    const incarnation = digest({ seed: g.seed, id: g.id, projection: g.projection, sequence: g.sequence,
      baseSequence: g.base_sequence, kind: g.kind, access: g.access, fences: JSON.parse(g.fences),
      phase: g.phase, lastKey: g.last_key, verify });
    const { mac, ...record } = JSON.parse(db.prepare('SELECT record FROM validation_records WHERE generation=?').get(g.id).record);
    record.generation.incarnation = incarnation;
    record.counts = verify.counts;
    db.prepare('UPDATE generations SET verify=?,incarnation=? WHERE id=?').run(JSON.stringify(verify), incarnation, g.id);
    db.prepare('UPDATE validation_records SET record=? WHERE generation=?').run(signedRecord(secret, 'validation', record), g.id);
  }));
}

async function fixture(t, { corpus = 12, journal = 'DELETE', transmissionSnapshot = false } = {}) {
  const volume = new BigInt64Array(new SharedArrayBuffer(8));
  const paid = new Int32Array(new SharedArrayBuffer(20));
  const host = { volume: volume.buffer, paid: paid.buffer };
  Atomics.store(volume, 0, sufficientVolume);
  const s = await setupProductSemantic(t, { corpus, sidecarMode: journal,
    canonicalMode: transmissionSnapshot ? 'WAL' : 'DELETE', coordinatorHost: import.meta.url, host });
  const m = s.configure(true);
  Object.assign(m.options.host, { moduleUrl: import.meta.url, configuration: { ...m.options.host.configuration, ...host } });
  const maintainer = await openContextIndexMaintainer(m.options);
  s.f.workspace.defer(() => maintainer.close());
  ok(await s.coordinator.setOwnerSemantic({ ownerId: ns.ownerId, semantic: true, expectedRevision: 0 }, s.token));
  ok(await maintainer.refreshContextIndex({ ...scope, mode: 'lexical', budget: { maxItems: 1024, maxMs: 5000 } }, m.credential));
  const sidecar = s.f.path + PRODUCT_SIDECAR_SUFFIX;
  const status = async () => ok(await maintainer.getContextIndexStatus({ ...scope, deadlineMs: 5000 }, m.credential));
  assert.equal((await status()).lexical.state, 'ready');
  return {
    s, sidecar, paid, status,
    count: n => setEligible(s.f.path, sidecar, n),
    volume: bytes => Atomics.store(volume, 0, bytes),
    refresh: async (maxItems = 1) => ok(await maintainer.refreshContextIndex({ ...scope, mode: 'embeddings',
      budget: { maxItems, maxMs: 5000, maxUsd: '0.50' } }, m.credential)),
    reservations: () => withDb(s.ledgerPath, true, db => Object.values(JSON.parse(db.prepare('SELECT state FROM semantic_owners').get().state).reservations)),
  };
}

const sent = f => Array.from(f.paid.subarray(0, 2));
async function expectDenied(f) {
  const before = sent(f);
  assert.equal((await f.refresh()).progress.embeddingAttempts, 0);
  assert.deepEqual(sent(f), before);
  const status = await f.status();
  assert.equal(status.lexical.state, 'ready');
  assert.equal(status.semantic.reason, 'capacity_exceeded');
}

async function dispatchLedger(f, result) {
  const { refresh } = ok(await f.s.coordinator.getOwnerSemanticStatus({ ownerId: ns.ownerId }, f.s.token));
  return {
    reservations: f.reservations().map(r => r.status),
    attempts: result.progress.embeddingAttempts,
    paid: sent(f),
    itemsCharged: refresh.itemsCharged,
    usdCharged: refresh.usdCharged,
  };
}

if (isMainThread) {
  for (const n of [19_999, 20_000, 20_001]) test(`signed eligible count ${n} controls document dispatch`, async t => {
    const f = await fixture(t);
    f.count(n);
    if (n <= 20_000) {
      assert.equal((await f.refresh()).progress.embeddingAttempts, 1);
      assert.deepEqual(sent(f), [1, 1]);
    } else {
      await expectDenied(f);
      assert.equal(f.s.view[4], 0);
      assert.deepEqual(f.reservations(), []);
    }
  });

  test('document backfill stops on the next batch after growth and resumes after shrink', async t => {
    const f = await fixture(t);
    f.count(20_000);
    assert.equal((await f.refresh()).progress.embedded, 1);
    assert.deepEqual(sent(f), [1, 1]);
    const before = f.reservations().length;
    f.count(20_001);
    await expectDenied(f);
    assert.equal(f.reservations().length, before);
    f.count(19_999);
    assert.equal((await f.refresh()).progress.embedded, 1);
    assert.deepEqual(sent(f), [2, 2]);
  });

  test('disk high-water rejects one byte short and preserves lexical results', async t => {
    const f = await fixture(t);
    const before = bytesPerItem * 12n - lstatSync(f.sidecar, { bigint: true }).size;
    assert.ok(before > 0n);
    f.volume(before - 1n);
    await expectDenied(f);
    assert.deepEqual(f.reservations(), []);
    const r = f.s.configure(false);
    const reader = await openContextProductReader(r.options);
    f.s.f.workspace.defer(() => reader.close());
    const lexical = ok(await reader.findCandidates({ ...scope, query: 'probecommon', semantic: false, limit: 12, deadlineMs: 5000 }, r.credential));
    assert.equal(lexical.channels.lexical.state, 'ready');
    assert.equal(lexical.items.length, 12);
    f.volume(before);
    assert.equal((await f.refresh()).progress.embeddingAttempts, 1);
    assert.deepEqual(sent(f), [1, 1]);
  });

  test('disk high-water gives credit for the live WAL', async t => {
    const f = await fixture(t, { journal: 'WAL' });
    f.count(19_999);
    const main = lstatSync(f.sidecar, { bigint: true }).size;
    const wal = lstatSync(f.sidecar + '-wal', { bigint: true }).size;
    assert.ok(wal > 0n);
    const boundary = bytesPerItem * 19_999n - main - wal;
    f.volume(boundary - 1n);
    await expectDenied(f);
    f.volume(boundary);
    assert.equal((await f.refresh()).progress.embeddingAttempts, 1);
    assert.deepEqual(sent(f), [1, 1]);
  });

  test('completed vectors remain ready and searchable during a disk shortfall', async t => {
    const f = await fixture(t);
    assert.equal((await f.refresh(12)).status, 'complete');
    const required = bytesPerItem * 12n;
    assert.ok(lstatSync(f.sidecar, { bigint: true }).size < required);
    f.volume(0n);
    const status = await f.status();
    assert.equal(status.semantic.state, 'ready');
    assert.equal(status.semantic.reason, null);
    const r = f.s.configure(false);
    const reader = await openContextProductReader(r.options);
    f.s.f.workspace.defer(() => reader.close());
    const result = ok(await reader.findCandidates({ ...scope, query: 'probecommon', semantic: true, limit: 12, deadlineMs: 5000 }, r.credential));
    assert.equal(result.trace.effective, 'hybrid');
    assert.equal(result.trace.semantic.queryEmbeddingAttempts, 1);
  });

  test('disk space lost after the refresh check releases the reservation before provider invocation', async t => {
    const f = await fixture(t);
    Atomics.store(f.paid, 3, 1);
    const result = await f.refresh();
    assert.equal(f.s.view[4], 0);
    assert.deepEqual(await dispatchLedger(f, result), {
      reservations: ['released'],
      attempts: 0,
      paid: [0, 0],
      itemsCharged: 0,
      usdCharged: '0',
    });
    assert.equal((await f.status()).semantic.reason, 'capacity_exceeded');
  });

  test('disk space lost at the final dispatch callback sends nothing and settles like a price denial', async t => {
    let deniedLedger;
    await t.test('price authority unavailable within final transport validation', async t => {
      const denied = await fixture(t, { transmissionSnapshot: true });
      Atomics.store(denied.paid, 4, 1);
      const deniedResult = await denied.refresh();
      assert.equal(denied.s.view[4], 1, 'price denial reached the adapter');
      assert.equal(Atomics.load(denied.paid, 4), 0, 'final dispatch checked the price');
      assert.deepEqual(deniedResult.channels.semantic.causes, ['budget_denied']);
      deniedLedger = await dispatchLedger(denied, deniedResult);
      assert.deepEqual(deniedLedger.paid, [0, 0]);
    });

    const f = await fixture(t, { transmissionSnapshot: true });
    Atomics.store(f.paid, 2, 1);
    const result = await f.refresh();
    assert.equal(f.s.view[4], 1);
    const ledger = await dispatchLedger(f, result);
    assert.deepEqual(ledger.paid, [0, 0]);
    assert.deepEqual(ledger.reservations, ['unknown']);
    assert.deepEqual(ledger, deniedLedger);
    assert.equal((await f.status()).semantic.reason, 'capacity_exceeded');
    f.volume(sufficientVolume);
    assert.equal((await f.refresh()).progress.embeddingAttempts, 1);
    assert.deepEqual(sent(f), [1, 1]);
  });
}
