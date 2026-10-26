import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';
import { openMemoryCore } from '../contract.mjs';
import { openMemoryStore } from '../index.mjs';
import { openRawCaptureCore } from '../raw-capture.mjs';
import { openDatabase } from '../database.mjs';
import { openDatabase as openV25 } from '../testing/raw-v25-database.mjs';
import { rawSourceMap } from '../raw-source-map.mjs';
import { fixture, ns, request, splitRaw, localPlainPort, ok, completed, usage, count } from '../testing/raw-capture-fixtures.mjs';

const excluded = result => assert.deepEqual(result, { ok: false, error: { code: 'source_excluded', retryable: false } });
const proof = (client = 'manual', sessionId = 'independent', eventId = 'manual-message', excerpt = 'Independent source.') =>
  ({ client, sessionId, eventId, role: 'user', excerpt });
const legacy = (input, eventId = 'new-event') => ({ namespace: input.namespace, client: input.client,
  sessionId: input.sessionId, eventId, messages: input.messages.map(({ id, role, content }) => ({ id, role, content })) });
const model = () => ({ items: [{ content: 'Synthetic derived assertion.', kind: 'fact', confidence: .8, sourceIndices: [0] }] });

test('P3a-01 schema opt-in, old-opener refusal, failed migration rollback and strict option', t => {
  const ws = createTestWorkspace(t, { prefix: 'raw-lineage-schema-' }), path = join(ws.path, 'store.sqlite');
  let db = openDatabase(path, { rawCapture: true }); db.close();
  const exec = DatabaseSync.prototype.exec;
  DatabaseSync.prototype.exec = function(sql) {
    const result = exec.call(this, sql);
    if (sql.includes('CREATE TABLE raw_source_maps')) throw Error('Synthetic lineage migration failure');
    return result;
  };
  try { assert.throws(() => openDatabase(path, { rawLineage: true }), /Synthetic lineage migration failure/); }
  finally { DatabaseSync.prototype.exec = exec; }
  db = openDatabase(path); ws.defer(() => db.close());
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 25);
  assert.equal(db.prepare("SELECT count(*) n FROM sqlite_master WHERE name LIKE 'raw_source_%'").get().n, 0);
  const selected = openDatabase(path, { rawLineage: true }); ws.defer(() => selected.close());
  assert.equal(selected.prepare('PRAGMA user_version').get().user_version, 26);
  assert.throws(() => openV25(path), error => error.code === 'unsupported_database');
  const options = { mode: 'raw-v1', port: localPlainPort(), readPolicy: () => ({ generation: 'synthetic', reason: null }) };
  assert.throws(() => openRawCaptureCore({ path }, { ...options, lineage: 'true' }), error => error.code === 'invalid_input');
  let reads = 0;
  const accessor = { ...options, get lineage() { reads++; return true; } };
  assert.throws(() => openRawCaptureCore({ path }, accessor), error => error.code === 'invalid_input');
  assert.equal(reads, 0);
  assert.throws(() => openMemoryCore({ path, rawLineage: true }), error => error.code === 'invalid_input');
});

for (const [text, precision] of [['  A\n\t😀 B  ', 'exact'], ['e\u0301 ﬁ Ａ', 'whole-message'],
  ['Bearer sk-synthetic-abcdefghijklmnopqrstuvwxyz1234567890', 'whole-message']]) {
  test(`P3a-02 source mapping ${precision} validates actual canonical spans`, () => {
    const message = splitRaw(text)[0], map = rawSourceMap(message);
    for (const entry of map.entries) {
      assert.equal(entry.precision, precision);
      if (precision === 'whole-message') assert.deepEqual([entry.start, entry.end], [0, text.length]);
      else {
        assert.equal(text.slice(entry.start, entry.end).replace(/\s+/gu, ' '), entry.excerpt);
        assert.equal(text.slice(0, entry.start).isWellFormed(), true);
        assert.equal(text.slice(0, entry.end).isWellFormed(), true);
      }
    }
  });
}

for (const client of ['claude-code', 'codex']) {
  test(`P3a-02 ${client}: normalization expansion map matches the actual twice-normalized projection`, async t => {
    const f = fixture(t, { lineage: true, model: { extract: model } });
    const message = splitRaw('\uFDFA '.repeat(400))[0], map = rawSourceMap(message);
    const first = completed(await f.core.captureRaw(request(message, { client })));
    const shown = f.calls.find(call => call.method === 'extract').input.messages[0].content;
    assert.equal(map.entries[0].excerpt, shown);
    assert.equal(shown.length <= 4000, true);
    const memory = ok(f.core.get({ namespace: ns, memoryId: first.admission.memories[0].id })).memory;
    const anchors = f.db.prepare('SELECT start,end,precision FROM raw_receipt_lineage').all();
    assert.deepEqual(anchors.map(row => ({ ...row })), [{ start: 0, end: message.part.totalUnits, precision: 'whole-message' }]);
    ok(f.core.forget({ namespace: ns, memoryId: memory.id, expectedRevision: memory.revision }));
    const before = f.calls.length;
    const resubmitted = legacy(request(message, { client }));
    resubmitted.messages[0].content = shown; // Legacy input must itself fit its unchanged 4,000-unit limit.
    excluded(await f.core.capture(resubmitted));
    assert.equal(f.calls.length, before);
  });
  for (const reason of ['notice_required','quota_reached']) test(`P3a-04/09 ${client}: ${reason} retains provenance without a saved anchor`, async t => {
    const f = fixture(t, { lineage: true, model: { extract: model },
      ...(reason === 'quota_reached' ? { capBytes: 1 } : { policy: { generation: 'synthetic', reason } }) });
    const input = request(splitRaw('Synthetic skipped source.')[0], { client });
    const saved = ok(await f.core.captureRaw(input)), first = ok(saved.interpretation);
    assert.equal(saved.raw.parts[0].saved, false); assert.equal(saved.raw.parts[0].reason, reason);
    assert.equal(usage(f.core).savedBytes, 0); assert.equal(count(f.db, 'raw_receipt_lineage'), 1);
    const memory = ok(f.core.get({ namespace: ns, memoryId: first.admission.memories[0].id })).memory;
    ok(f.core.forget({ namespace: ns, memoryId: memory.id, expectedRevision: memory.revision }));
    const calls = f.calls.length; excluded(await f.core.capture(legacy(input)));
    assert.equal(f.calls.length, calls); assert.equal(usage(f.core).savedBytes, 0);
  });

  test(`P3a-02/04 ${client}: forgotten prefix keeps continuation Raw and exact UTF16 bounds`, async t => {
    const f = fixture(t, { lineage: true, model: { extract: model } });
    const parts = splitRaw('  ' + '😀'.repeat(400) + 'z'.repeat(4000)), input = request(parts[0], { client });
    const source = ok(await f.core.captureRaw(input)), first = ok(source.interpretation);
    ok(await f.core.captureRaw(request(parts[1], { client })));
    const before = usage(f.core), memory = ok(f.core.get({ namespace: ns, memoryId: first.admission.memories[0].id })).memory;
    ok(f.core.forget({ namespace: ns, memoryId: memory.id, expectedRevision: memory.revision }));
    assert.deepEqual(f.db.prepare('SELECT start,end FROM raw_source_exclusions').all().map(row => ({ ...row })), [{ start: 2, end: 802 }]);
    assert.deepEqual(usage(f.core), before);
    const raw = ok(await f.core.getConversation({ namespace: ns, conversationId: source.raw.conversationId }));
    assert.equal(raw.messages[0].parts.map(part => part.text).join(''), parts.map(part => part.content).join(''));
    assert.equal(raw.messages[0].parts.some(part => Object.hasOwn(part, 'rawAnchor')), false);
  });

  test(`P3a-07 ${client}: a cold option-off process refuses the excluded alias before extraction`, async t => {
    const f = fixture(t, { lineage: true, model: { extract: model } });
    const input = request(splitRaw('Synthetic cold process source.')[0], { client });
    const first = completed(await f.core.captureRaw(input)), memory = ok(f.core.get({ namespace: ns, memoryId: first.admission.memories[0].id })).memory;
    ok(f.core.forget({ namespace: ns, memoryId: memory.id, expectedRevision: memory.revision }));
    const child = spawnSync(process.execPath, [fileURLToPath(new URL('../testing/raw-lineage-process.mjs', import.meta.url)),
      f.path, JSON.stringify(legacy(input))], { encoding: 'utf8', env: {}, timeout: 10000 });
    assert.equal(child.status, 0, child.stderr);
    const observed = JSON.parse(child.stdout); excluded(observed.result); assert.equal(observed.calls, 0);
  });

  test(`P3a-09 ${client}: owner/project/client/session boundaries do not inherit exclusions`, async t => {
    const f = fixture(t, { lineage: true, model: { extract: model } });
    const input = request(splitRaw('Synthetic isolated source.')[0], { client });
    const first = completed(await f.core.captureRaw(input)), memory = ok(f.core.get({ namespace: ns, memoryId: first.admission.memories[0].id })).memory;
    ok(f.core.forget({ namespace: ns, memoryId: memory.id, expectedRevision: memory.revision }));
    const writer = openMemoryCore({ path: f.path, model: { ...f.model, extract: () => ({ items: [] }) } });
    f.workspace.defer(() => writer.close());
    for (const patch of [{ namespace: { ...ns, ownerId: 'other-owner' } },
      { namespace: { ...ns, scope: 'project', projectId: 'other-project' } },
      { client: client === 'codex' ? 'claude-code' : 'codex' }, { sessionId: 'other-session' }]) {
      ok(await writer.capture({ ...legacy(input, 'boundary-' + JSON.stringify(patch)), ...patch }));
    }
    const forged = { ...legacy(input), messages: [{ ...legacy(input).messages[0], content: 'A forged source under the same identity.' }] };
    assert.deepEqual(await writer.capture(forged), { ok: false, error: { code: 'raw_lineage_unavailable', retryable: false } });
    assert.equal((await writer.capture({ ...legacy(input), rawAnchor: {} })).error.code, 'invalid_input');
  });
  test(`P3a-03 ${client}: duplicate legacy unknown cannot become independent by explicit promotion`, async t => {
    const f = fixture(t, { model: { extract: model } });
    const input = request(splitRaw('Synthetic before-lineage unlinked source.')[0], { client });
    const first = ok(await f.core.capture(legacy(input, 'legacy-original'))), memoryId = first.admission.memories[0].id;
    const receipt = ok(f.core.get({ namespace: ns, memoryId })).receipts[0];
    const dto = Object.fromEntries(['client','sessionId','eventId','role','excerpt'].map(key => [key, receipt[key]]));
    const upgraded = openDatabase(f.path, { rawLineage: true }); f.workspace.defer(() => upgraded.close());
    ok(f.core.admit({ namespace: ns, memory: { content: 'Synthetic derived assertion.', kind: 'fact' }, receipts: [dto] }));
    assert.equal(upgraded.prepare('SELECT kind FROM raw_receipt_origins').get().kind, 'unknown');
    assert.equal(count(upgraded, 'raw_receipt_lineage'), 0);
    const store = openMemoryStore({ path: f.path }); f.workspace.defer(() => store.close());
    const scope = store.scope({ ownerId: ns.ownerId });
    scope.remember({ content: 'New inferred legacy assertion.', kind: 'fact', origin: 'agent-inferred', confidence: .8,
      receipt: proof('legacy-source') });
    assert.equal(upgraded.prepare(`SELECT o.kind FROM raw_receipt_origins o JOIN receipts r ON r.id=o.receipt_id
      WHERE r.client='legacy-source'`).get().kind, 'unknown');
    scope.remember({ content: 'New explicit legacy assertion.', receipt: proof('explicit-source') });
    assert.equal(upgraded.prepare(`SELECT o.kind FROM raw_receipt_origins o JOIN receipts r ON r.id=o.receipt_id
      WHERE r.client='explicit-source'`).get().kind, 'independent');
  });

  for (const mutation of ['forget','correct']) test(`P3a-05 ${client}: legacy facade ${mutation} shares D6 before receipt purge`, async t => {
    const f = fixture(t, { lineage: true, model: { extract: model } });
    const input = request(splitRaw('Synthetic legacy facade source.')[0], { client });
    const first = completed(await f.core.captureRaw(input)), memoryId = first.admission.memories[0].id;
    const store = openMemoryStore({ path: f.path }); f.workspace.defer(() => store.close());
    const scope = store.scope({ ownerId: ns.ownerId }), memory = scope.get(memoryId);
    if (mutation === 'forget') assert.equal(scope.forget(memoryId, memory.revision), true);
    else scope.correct(memoryId, { content: 'Explicit legacy correction.', receipt: proof() }, memory.revision);
    assert.ok(count(f.db, 'raw_source_exclusions') > 0);
    assert.throws(() => scope.remember({ content: 'Explicit receipt alias cannot restore source.',
      receipt: proof(client, input.sessionId, input.messages[0].id, input.messages[0].content) }), error => error.code === 'source_excluded');
  });
  for (const kind of ['ordinary', 'staged', 'ordered']) for (const mutation of ['forget', 'correct']) {
    test(`P3a-03/05/06 ${client} ${kind} ${mutation}: option-off aliases cannot revive source`, async t => {
      const f = fixture(t, { lineage: true, kind: kind === 'staged' ? kind : 'ordinary', model: { extract: model } });
      const input = request(splitRaw('  Synthetic source supporting an assertion.  ')[0], { client,
        ...(kind === 'ordered' ? { causal: { streamId: 'synthetic-stream', sequence: 1 } } : {}) });
      const first = completed(await f.core.captureRaw(input));
      const id = first.admission.memories[0].id, current = ok(f.core.get({ namespace: ns, memoryId: id })).memory;
      assert.ok(count(f.db, 'raw_receipt_lineage') > 0);
      const beforeUsage = usage(f.core);
      const writer = openMemoryCore({ path: f.path, model: f.model }); f.workspace.defer(() => writer.close());
      if (mutation === 'forget') ok(writer.forget({ namespace: ns, memoryId: id, expectedRevision: current.revision }));
      else ok(writer.correct({ namespace: ns, memoryId: id, expectedRevision: current.revision,
        content: 'Independent explicit replacement.', kind: 'fact', receipt: proof() }));
      assert.ok(count(f.db, 'raw_source_exclusions') > 0);
      const calls = f.calls.length;
      excluded(await writer.capture(legacy(input)));
      excluded(writer.admit({ namespace: ns, memory: { content: 'A paraphrase supplied through explicit admit.', kind: 'fact' },
        receipts: [proof(client, input.sessionId, input.messages[0].id, input.messages[0].content)] }));
      excluded(writer.admit({ namespace: ns, memory: { content: 'Synthetic derived assertion.', kind: 'fact' },
        receipts: [proof(client, input.sessionId, input.messages[0].id, input.messages[0].content)] }));
      assert.equal(f.calls.length, calls); assert.deepEqual(usage(f.core), beforeUsage);
      ok(writer.admit({ namespace: ns, memory: { content: 'Genuinely independent explicit assertion.', kind: 'fact' }, receipts: [proof()] }));
      ok(await writer.capture({ ...legacy(input, 'independent-session'), sessionId: 'different-session' }));
      const columns = f.db.prepare('PRAGMA table_info(raw_source_maps)').all().map(row => row.name);
      assert.deepEqual(columns, ['conversation_id','message_id','source_key','start','end','precision']);
      assert.equal(f.db.prepare("SELECT count(*) n FROM raw_receipt_origins WHERE kind='independent'").get().n > 0, true);
    });
  }

  test(`P3a-04/06 ${client}: indexed filtering preserves disjoint original window and repeated-text coverage`, async t => {
    let derived = 0;
    const f = fixture(t, { lineage: true, coreOptions: { captureSourcePolicy: 'indexed-evidence-v1' }, model: {
      extract: () => ({ items: [{ content: 'Synthetic window assertion ' + ++derived, kind: 'fact', confidence: .8,
        sourceIndices: [0] }] }),
    } });
    const text = 'A'.repeat(800) + 'B'.repeat(800), input = request(splitRaw(text)[0], { client });
    const first = completed(await f.core.captureRaw(input)), memory = ok(f.core.get({ namespace: ns, memoryId: first.admission.memories[0].id })).memory;
    ok(f.core.forget({ namespace: ns, memoryId: memory.id, expectedRevision: memory.revision }));
    const writer = openMemoryCore({ path: f.path, model: f.model, captureSourcePolicy: 'indexed-evidence-v1' });
    f.workspace.defer(() => writer.close());
    const next = ok(await writer.capture(legacy(input)));
    const receipt = ok(writer.get({ namespace: ns, memoryId: next.admission.memories[0].id })).receipts[0];
    assert.equal(receipt.excerpt, 'B'.repeat(800));
    const span = f.db.prepare('SELECT start,end FROM raw_receipt_lineage WHERE receipt_id=?')
      .get(f.db.prepare('SELECT id FROM receipts WHERE excerpt=?').get(receipt.excerpt).id);
    assert.deepEqual({ ...span }, { start: 800, end: 1600 });
    const shown = f.calls.filter(call => call.method === 'extract').at(-1).input.messages;
    assert.equal(shown.length, 1); assert.equal(shown[0].index, 0); assert.equal(shown[0].content, 'B'.repeat(800));
  });

  test(`P3a-04 ${client}: equal window text binds every original position`, async t => {
    const f = fixture(t, { lineage: true, coreOptions: { captureSourcePolicy: 'indexed-evidence-v1' }, model: { extract: model } });
    const input = request(splitRaw('X'.repeat(1600))[0], { client });
    const first = completed(await f.core.captureRaw(input));
    const memory = ok(f.core.get({ namespace: ns, memoryId: first.admission.memories[0].id })).memory;
    assert.deepEqual(f.db.prepare('SELECT start,end FROM raw_receipt_lineage ORDER BY start').all().map(value => ({ ...value })),
      [{ start: 0, end: 800 }, { start: 800, end: 1600 }]);
    ok(f.core.forget({ namespace: ns, memoryId: memory.id, expectedRevision: memory.revision }));
    const calls = f.calls.length;
    excluded(await f.core.capture(legacy(input)));
    assert.equal(f.calls.length, calls);
  });

  test(`P3a-03 ${client}: episode keep and dedup retain original source despite explicit promotion`, async t => {
    const f = fixture(t, { lineage: true, kind: 'episode', model: { extract: model } });
    const input = request(splitRaw('Synthetic source retained by an episode.')[0], { client }, 'episode');
    const original = completed(await f.core.captureRaw(input));
    const memoryId = original.admission.memories[0].id;
    const first = ok(f.core.get({ namespace: ns, memoryId })), receipt = first.receipts[0];
    const dto = Object.fromEntries(['client','sessionId','eventId','role','excerpt'].map(key => [key, receipt[key]]));
    ok(f.core.admit({ namespace: ns, memory: { content: first.memory.content, kind: 'fact' }, receipts: [dto] }));
    assert.equal(count(f.db, 'receipts'), 1);
    assert.equal(f.db.prepare('SELECT kind FROM raw_receipt_origins').get().kind, 'derived');
    const episode = ok(f.core.getEpisode({ namespace: ns, episodeId: original.episode.id })).episode;
    const kept = ok(await f.core.keepEpisode({ namespace: ns, episodeId: episode.id,
      expectedRevision: episode.revision, actionId: 'synthetic-keep' }));
    assert.equal(kept.admission.memories[0].id, memoryId);
    assert.equal(count(f.db, 'receipts'), 1);
    assert.equal(count(f.db, 'raw_receipt_lineage'), 1);
    const before = f.calls.length;
    assert.equal(ok(await f.core.keepEpisode({ namespace: ns, episodeId: episode.id,
      expectedRevision: episode.revision, actionId: 'synthetic-keep' })).duplicate, true);
    assert.equal(f.calls.length, before);
  });

  test(`P3a-03/05 ${client}: historical receipts and manual admission finish obey exclusions`, async t => {
    const f = fixture(t, { lineage: true, model: { extract: model } });
    const input = request(splitRaw('Synthetic historical source.')[0], { client });
    const original = completed(await f.core.captureRaw(input)), memoryId = original.admission.memories[0].id;
    let memory = ok(f.core.get({ namespace: ns, memoryId })).memory;
    ok(f.core.supersede({ namespace: ns, memoryId, expectedRevision: memory.revision,
      replacement: { content: 'Explicit successor assertion.', kind: 'fact' }, receipts: [proof()] }));
    memory = ok(f.core.get({ namespace: ns, memoryId })).memory;
    assert.equal(memory.state, 'historical');
    ok(f.core.forget({ namespace: ns, memoryId, expectedRevision: memory.revision }));
    const key = { namespace: ns, client, eventId: 'manual-finish', payloadDigest: 'a'.repeat(64) };
    const claimed = ok(f.core.claimAdmission({ ...key, leaseMs: 125000 }));
    excluded(f.core.finishAdmission({ ...key, token: claimed.token, items: [{ content: 'Another source paraphrase.',
      kind: 'fact', confidence: .8, receipts: [proof(client, input.sessionId, input.messages[0].id, input.messages[0].content)] }] }));
    assert.equal(f.db.prepare('SELECT count(*) n FROM memories WHERE deleted=0').get().n, 1);
  });

  for (const point of ['token-microtask','extract']) test(`P3a-07 ${client}: concurrent forget during ${point} blocks provider/publication`, async t => {
    const f = fixture(t, { lineage: true, model: { extract: model } });
    const input = request(splitRaw('Synthetic concurrent forgotten source.')[0], { client });
    const first = completed(await f.core.captureRaw(input)), memory = ok(f.core.get({ namespace: ns, memoryId: first.admission.memories[0].id })).memory;
    const writer = openMemoryCore({ path: f.path }); f.workspace.defer(() => writer.close());
    let armed = false, extracted = 0;
    const forget = () => ok(writer.forget({ namespace: ns, memoryId: memory.id, expectedRevision: memory.revision }));
    const racing = openMemoryCore({ path: f.path, model: { contextWindow: 8192,
      countTokens: () => { if (armed && point === 'token-microtask') { armed = false; queueMicrotask(forget); } return 1; },
      extract: () => { extracted++; if (point === 'extract') forget(); return model(); },
    } }); f.workspace.defer(() => racing.close());
    armed = true;
    excluded(await racing.capture(legacy(input)));
    assert.equal(extracted, point === 'extract' ? 1 : 0);
    assert.equal(f.db.prepare('SELECT count(*) n FROM memories WHERE deleted=0').get().n, 0);
  });

  test(`P3a-05 ${client}: injected receipt purge failure rolls exclusions and Memory back`, async t => {
    const f = fixture(t, { lineage: true, model: { extract: model } });
    const input = request(splitRaw('Synthetic rollback source.')[0], { client });
    const first = completed(await f.core.captureRaw(input)), memory = ok(f.core.get({ namespace: ns, memoryId: first.admission.memories[0].id })).memory;
    f.db.exec("CREATE TRIGGER synthetic_lineage_failure BEFORE DELETE ON receipts BEGIN SELECT RAISE(ABORT,'synthetic'); END;");
    assert.equal(f.core.forget({ namespace: ns, memoryId: memory.id, expectedRevision: memory.revision }).ok, false);
    assert.equal(count(f.db, 'raw_source_exclusions'), 0);
    assert.equal(ok(f.core.get({ namespace: ns, memoryId: memory.id })).memory.revision, memory.revision);
    assert.equal(count(f.db, 'receipts'), 1);
  });

  test(`P3a-04 ${client}: pre-v26 provenance falls back to whole message without synthetic maps`, async t => {
    const f = fixture(t, { model: { extract: model } });
    const input = request(splitRaw('Synthetic legacy source.')[0], { client });
    const first = completed(await f.core.captureRaw(input)), memory = ok(f.core.get({ namespace: ns, memoryId: first.admission.memories[0].id })).memory;
    const upgraded = openDatabase(f.path, { rawLineage: true }); f.workspace.defer(() => upgraded.close());
    assert.equal(count(upgraded, 'raw_source_maps'), 0);
    ok(f.core.forget({ namespace: ns, memoryId: memory.id, expectedRevision: memory.revision }));
    const span = upgraded.prepare('SELECT start,end FROM raw_source_exclusions').get();
    assert.deepEqual({ ...span }, { start: 0, end: input.messages[0].part.totalUnits });
    assert.equal(count(upgraded, 'raw_source_maps'), 0);
  });
}
