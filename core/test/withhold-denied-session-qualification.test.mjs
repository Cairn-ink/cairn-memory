import assert from 'node:assert/strict';
import crypto, { createHash } from 'node:crypto';
import { syncBuiltinESMExports } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { createQualificationStorage } from '../claim-qualification-storage.mjs';
import { migrateCardLineage } from '../content-safety-migration.mjs';
import { attestContentSafety, cardLineageRevision } from '../content-safety-schema.mjs';
import { writeContentSuppressionInside } from '../content-suppression-storage.mjs';
import { transaction } from '../database.mjs';
import { openMemoryCore } from '../index.mjs';
import { createMemoryRuntime } from '../runtime.mjs';
import { copySqliteFixture, quiescence, safetyFixture } from '../testing/content-safety-s2h-fixture.mjs';
import { batch, draft, ns, ok, register } from '../testing/episode-helpers.mjs';

const forgottenText = 'forgetneedle synthetic source';
const stepText = 'stepneedle review forgotten evidence';
const correctedText = 'Synthetic corrected claim';
const input = { namespace: ns, groups: { nextSteps: true, procedural: true, background: true } };
const receipt = (eventId, excerpt) => ({ client: 'synthetic', sessionId: 'source', eventId, role: 'user', excerpt });
const qualification = text => ({ version: 1,
  slot: { subject: 'I', property: 'transport', scope: null, applies: null },
  value: 'violet tram', attribution: 'direct', commitment: 'adopted',
  anchors: [{ receiptIndex: 0, start: 0, end: text.length, text,
    fields: ['subject', 'property', 'value', 'attribution', 'commitment'] }] });

function deterministicFixture(t) {
  let id = 0;
  t.mock.method(crypto, 'randomUUID', () => '00000000-0000-4000-8000-' + String(++id).padStart(12, '0'));
  t.mock.method(crypto, 'randomBytes', size => Buffer.alloc(size, 23));
  syncBuiltinESMExports();
  t.after(() => {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  });
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2025-06-01T00:00:00.000Z') });
}

async function fixture(t, layout) {
  deterministicFixture(t);
  const f = safetyFixture(t, 33);
  if (layout === 48) await f.migrate();
  if (layout === 53) {
    copySqliteFixture(f.path, f.backupPath);
    await migrateCardLineage({ path: f.path, backupPath: f.backupPath,
      expected: { storeId: f.storeId, base: 33 }, quiescence });
  }
  const core = openMemoryCore({ path: f.path, model: { countTokens: () => 1 } });
  f.workspace.defer(() => core.close());
  const db = f.connect();
  f.workspace.defer(() => db.close());
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, layout);
  if (layout === 53) {
    assert.equal(cardLineageRevision(attestContentSafety(db)), 1);
  }
  return { ...f, core, db };
}

function publishStep(f, sourceText, step) {
  const runtime = createMemoryRuntime({ path: f.path, sessionEpisodes: { mode: 'episode-v1' } });
  try {
    const input = batch('step-event', sourceText, 'episode-session');
    const registered = register({ runtime }, input);
    const job = draft({ runtime }, registered, input);
    job.commit.result.nextStep.value = step;
    runtime.commitEpisodeDraft(ns, job.commit);
    runtime.releaseEpisodeWriter(ns, { episodeId: registered.episodeId, token: job.writer.token });
    return { id: registered.episodeId,
      source: { client: input.client, sessionId: input.sessionId, eventId: input.messages[0].id,
        role: input.messages[0].role, excerpt: sourceText } };
  } finally { runtime.close(); }
}

function add(core, kind, content, source, qualified = false) {
  return ok(core.admit({ namespace: ns, memory: { content, kind }, receipts: [source],
    ...(qualified ? { qualification: qualification(source.excerpt) } : {}) })).memory;
}

function bindCorrectedQualification(db, memoryId, source) {
  const row = db.prepare('SELECT * FROM memories WHERE id=?').get(memoryId);
  const receiptKey = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
  const storage = createQualificationStorage({ db, receiptKey });
  // The public correction clears qualifications. Seed the retained storage shape
  // explicitly, through the same binding used by qualified admission.
  transaction(db, () => storage.bind(row, qualification(source.excerpt), [source], false, row.content));
}

function trace(read) {
  const statements = [], { prepare, exec } = DatabaseSync.prototype;
  DatabaseSync.prototype.exec = function (sql) {
    statements.push(['exec', sql]);
    return exec.call(this, sql);
  };
  DatabaseSync.prototype.prepare = function (sql) {
    const statement = prepare.call(this, sql);
    return new Proxy(statement, { get(target, name) {
      const value = Reflect.get(target, name, target);
      if (typeof value !== 'function') return value;
      return (...bindings) => {
        if (['get', 'all', 'run', 'iterate'].includes(name)) statements.push([name, sql, bindings]);
        return Reflect.apply(value, target, bindings);
      };
    } });
  };
  try { return { result: read(), statements }; }
  finally {
    DatabaseSync.prototype.prepare = prepare;
    DatabaseSync.prototype.exec = exec;
  }
}

// Exact public envelopes captured before the session group fix.
const plainGet = {
  48: '{"ok":true,"value":{"memory":{"id":"00000000-0000-4000-8000-000000000015","namespace":{"ownerId":"synthetic","scope":"project","projectId":"project"},"kind":"fact","origin":"explicit","confidence":1,"revision":2,"state":"active","filing":{"status":"unfiled"},"receiptCount":0,"createdAt":"2025-06-01T00:00:00.000Z","updatedAt":"2025-07-20T00:00:00.000Z","content":"Synthetic corrected claim"},"receipts":[],"placements":[],"conflicts":[],"nextReceiptCursor":null,"exhausted":true}}',
  53: '{"ok":true,"value":{"memory":{"id":"00000000-0000-4000-8000-000000000016","namespace":{"ownerId":"synthetic","scope":"project","projectId":"project"},"kind":"instruction","origin":"explicit","confidence":1,"revision":2,"state":"active","filing":{"status":"unfiled"},"receiptCount":0,"createdAt":"2025-06-01T00:00:00.000Z","updatedAt":"2025-07-20T00:00:00.000Z","content":"Synthetic corrected claim"},"receipts":[],"placements":[],"conflicts":[],"nextReceiptCursor":null,"exhausted":true}}',
};
const qualificationRefusal = '{"ok":false,"error":{"code":"revision_conflict","retryable":false}}';
// Each digest covers SQL text, execution kind, order and ordered bindings.
const traces = {
  33: [98, '3708e2b6af6d998fe0ffb76ccd39af16f353ee62d1bdf946e37b6b4d8688061b'],
  48: [199, '73b7d97db0ea2c8df0f387c6c12ce8425e8887922804aa9abe8e76ac258000d0'],
  53: [204, 'f02df23421c83084a516ca5874aaab1927123a852af8251c4ca81e2fd1e859bc'],
};

for (const [layout, group, kind, otherGroup, otherKind] of [
  [48, 'background', 'fact', 'procedural', 'instruction'],
  [53, 'procedural', 'instruction', 'background', 'fact'],
]) {
  test(`layout ${layout} withholds the whole denied claim and refills ${group} on both calls`, async t => {
    const f = await fixture(t, layout);
    const { core, db } = f;
    const { id: episodeId, source: stepSource } = publishStep(f, forgottenText, stepText);
    const victim = add(core, 'context', forgottenText, stepSource);
    const visible = add(core, kind, 'Synthetic refill', receipt('refill', 'Synthetic refill source'));
    const other = add(core, otherKind, 'Synthetic other group', receipt('other', 'Synthetic independent source'));
    const seed = add(core, kind, 'Synthetic original claim', receipt('original', 'Synthetic original source'));
    const correctionSource = receipt('correction', forgottenText);
    const corrected = ok(core.correct({ namespace: ns, memoryId: seed.id, expectedRevision: seed.revision,
      content: correctedText, kind, receipt: correctionSource })).memory;
    bindCorrectedQualification(db, corrected.id, correctionSource);
    const get = extra => core.get({ namespace: ns, memoryId: corrected.id, ...extra });
    assert.equal(ok(get({ includeQualification: true })).qualification.anchors[0].text, forgottenText);
    const [step] = ok(core.sessionStartContext(input)).groups.nextSteps.items;
    assert.equal(step.episodeId, episodeId);

    const denied = [corrected, ...Array.from({ length: 12 }, (_, i) =>
      add(core, kind, 'Synthetic qualified claim ' + i, receipt('denied-' + i, forgottenText), true))];
    const update = db.prepare('UPDATE memories SET updated_at=? WHERE id=?');
    update.run('2025-01-01T00:00:00.000Z', visible.id);
    denied.forEach((memory, index) => update.run(new Date(Date.UTC(2025, 6, 20 - index)).toISOString(), memory.id));
    ok(core.forgetEpisode({ namespace: ns, episodeId, expectedRevision: step.revision }));
    ok(core.forget({ namespace: ns, memoryId: victim.id, expectedRevision: victim.revision }));
    const receipts = db.prepare('SELECT id FROM receipts WHERE memory_id=?');
    transaction(db, () => {
      for (const { id } of denied) writeContentSuppressionInside(db, {
        namespace: ns, kind: 'receipt', key: receipts.get(id).id, reason: 'user_forget', actionId: 'suppress-source',
      });
    });

    const getBytes = JSON.stringify(get());
    t.diagnostic('get: ' + getBytes);
    assert.equal(getBytes, plainGet[layout]);
    const qualificationBytes = JSON.stringify(get({ includeQualification: true }));
    t.diagnostic('get with qualification: ' + qualificationBytes);
    assert.equal(qualificationBytes, qualificationRefusal);
    const first = core.sessionStartContext(input), retry = core.sessionStartContext(input);
    for (const [label, result] of [['first', first], ['fresh retry', retry]]) {
      t.diagnostic(label + ': ' + (result.ok ? 'ok' : result.error.code));
      const bytes = JSON.stringify(result);
      for (const needle of [forgottenText, stepText, correctedText, ...denied.map(memory => memory.id)]) {
        assert.equal(bytes.includes(needle), false, label + ' exposed ' + needle);
      }
    }
    for (const result of [first, retry]) {
      const { groups } = ok(result);
      assert.deepEqual(groups[group].items.map(item => item.memory.id), [visible.id]);
      assert.equal(groups[group].complete, true);
      assert.deepEqual(groups[otherGroup].items.map(item => item.memory.id), [other.id]);
      assert.deepEqual(groups.nextSteps.items, []);
    }
  });
}

for (const layout of [33, 48, 53]) {
  test(`layout ${layout} preserves the ordered SQL and bindings without a denial`, async t => {
    const f = await fixture(t, layout);
    publishStep(f, 'Synthetic visible Episode source', 'Review visible evidence');
    for (const kind of ['fact', 'instruction']) {
      add(f.core, kind, 'Synthetic visible ' + kind, receipt(kind, 'Synthetic claim evidence'), true);
    }
    const { result, statements } = trace(() => f.core.sessionStartContext(input));
    const { groups } = ok(result);
    assert.deepEqual(Object.values(groups).map(group => group.returned), [1, 1, 1]);
    const digest = createHash('sha256').update(JSON.stringify(statements)).digest('hex');
    t.diagnostic(layout + ': ' + statements.length + ' SQL executions, ' + digest);
    assert.deepEqual([statements.length, digest], traces[layout]);
  });
}
