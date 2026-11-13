import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { openMemoryCore, createMemoryCore } from '../../../core/contract.mjs';
import { composeRawCore } from '../../../core/raw-composition.mjs';
import { createCommitDispatcher } from '../../../core/commit-dispatch.mjs';
import { setup, input, interpretation, ns as episodeNs } from '../../../core/testing/episode-capture-helpers.mjs';
import { engineCardFixture, scriptedConsolidator } from '../../../core/testing/engine-card-fixture.mjs';
import { localPlainPort, request as rawRequest, splitRaw } from '../../../core/testing/raw-capture-fixtures.mjs';
import { rationaleModel } from '../../../core/testing/rationale-model.mjs';
import { ns, ok } from './local-shared-support.mjs';

// Every gate acquires a real second-connection lock at the selected cleanup's
// native BEGIN, then cancels the request. Only compensating retries may finish.
// A synthetic dispatcher clock also exercises exhausted cleanup budgets without
// five-second wall-clock sleeps. Engine transactions never span an await.
function gate(t, selector, { exhausted = false } = {}) {
  const previousStackLimit = Error.stackTraceLimit;
  Error.stackTraceLimit = 64;
  t.after(() => { Error.stackTraceLimit = previousStackLimit; });
  const cancellation = new AbortController();
  let holder, armed = false, fired = 0, backoffs = 0, clock = 0;
  const host = createCommitDispatcher({ strict: true, now: () => clock, random: () => 0, onBackoff() {
    backoffs++;
    assert.equal(holder.isTransaction, true, 'real native lock must cause cleanup backoff');
    holder.exec('ROLLBACK');
    if (exhausted) clock += 5001;
  } });
  const exec = DatabaseSync.prototype.exec;
  t.mock.method(DatabaseSync.prototype, 'exec', function(sql) {
    if (armed && this !== holder && sql === 'BEGIN IMMEDIATE' && selector(new Error().stack)) {
      armed = false; fired++; holder.exec('BEGIN IMMEDIATE'); cancellation.abort();
    }
    return Reflect.apply(exec, this, [sql]);
  });
  return { host, connect(path, workspace) {
    holder = new DatabaseSync(path);
    workspace.defer(() => { armed = false; if (holder.isTransaction) holder.exec('ROLLBACK'); holder.close(); });
    return holder;
  }, arm() { armed = true; }, run(work) { return host.run(work, { signal: cancellation.signal }); },
  verify(marker) {
    assert.equal(fired, 1, marker + ': real cleanup reached');
    assert.ok(backoffs >= 1, marker + ': cancellation must not suppress cleanup retry');
    assert.equal(cancellation.signal.aborted, true);
    assert.ok(host.inspectTransactions().every(state => state.isOpen && !state.isTransaction));
  } };
}
const inFile = (file, method) => stack => stack.includes(file) && new RegExp('\\b' + method + ' \\(').test(stack);
const source = 'Synthetic cobalt telescope preference';
const capture = { namespace: ns, client: 'synthetic', sessionId: 'cleanup', eventId: 'batch',
  messages: [{ id: 'message', role: 'user', content: source }] };
const extracted = () => ({ items: [{ content: source, kind: 'preference', confidence: .8, sourceIndices: [0] }] });

// D2 sites: capture.mjs:64 and :229.
for (const phase of ['classification', 'admission']) test(`cancelled ${phase} failure retries native-locked cleanup`, async t => {
  const g = gate(t, inFile(phase === 'classification' ? 'classification-journal-storage.mjs' : 'admission-storage.mjs',
    phase === 'classification' ? 'failAttempt' : 'abandonAdmission'));
  const w = createTestWorkspace(t), path = join(w.path, 'cleanup.sqlite');
  const model = { ...rationaleModel(), extract() { if (phase === 'admission') throw Error('synthetic extraction failure'); return extracted(); },
    classify() { throw Error('synthetic classification failure'); } };
  const core = g.host.open(() => openMemoryCore({ path, raw: false, model })); w.defer(() => core.close());
  const observer = g.connect(path, w); g.arm();
  await g.run(() => core.capture(capture)); g.verify('R2K_' + phase.toUpperCase() + '_CLEANUP');
  if (phase === 'classification') assert.equal(observer.prepare('SELECT status FROM capture_initial_classification').get().status, 'failed');
  else {
    assert.equal(observer.prepare('SELECT lease_expires_at FROM admission_claims').get().lease_expires_at, 0);
    assert.deepEqual(ok(await core.list({ namespace: ns })).memories, []);
  }
});

// D2 sites: engine-card-maintenance.mjs:207 (success finish), :219 (failure
// finish) and :214 (pause release). The real consolidation pipeline owns them.
for (const outcome of ['success', 'failure', 'pause']) test(`cancelled Card ${outcome} retries native-locked cleanup`, async t => {
  const g = gate(t, inFile('engine-card-storage.mjs', outcome === 'pause' ? 'release' : 'finish'));
  let writer, cardNs;
  const base = scriptedConsolidator();
  const model = { ...base, consolidate(request) {
    if (outcome === 'failure') throw Error('synthetic consolidation failure');
    if (outcome === 'pause') ok(writer.setCapturePaused({ namespace: cardNs, expectedGeneration: 'initial', paused: true }));
    return base.consolidate(request);
  } };
  const f = g.host.open(() => engineCardFixture(t, { model, sessionEpisodes: { mode: 'episode-v1' } }));
  const memories = f.seed(); f.file(memories, 'Synthetic cleanup topic');
  writer = openMemoryCore({ path: f.path, raw: false, sessionEpisodes: { mode: 'episode-v1' } }); f.workspace.defer(() => writer.close());
  const observer = g.connect(f.path, f.workspace);
  // The fixture exports a fixed namespace; derive it from canonical seeded rows.
  const row = observer.prepare('SELECT owner_id,scope,project_id FROM memories LIMIT 1').get();
  cardNs = { ownerId: row.owner_id, scope: row.scope, projectId: row.project_id || null };
  g.arm(); await g.run(() => f.pass()); g.verify('R2K_CARD_' + outcome.toUpperCase() + '_CLEANUP');
  if (outcome === 'pause') assert.equal(observer.prepare("SELECT count(*) n FROM card_operations WHERE method='consolidateAttempt'").get().n, 0);
  else assert.equal(JSON.parse(observer.prepare("SELECT result FROM card_operations WHERE method='consolidateOutcome'").get().result).outcome,
    outcome === 'success' ? 'succeeded' : 'terminal');
});

// D2 sites: episode-capture.mjs:97, :199, :219, :310 and :347.
test('cancelled episode draft failure retries native-locked finalization', async t => {
  const g = gate(t, inFile('episode-storage.mjs', 'failDraft'));
  const f = g.host.open(() => setup(t, { interpretEpisode() { throw Error('synthetic episode failure'); } }));
  const observer = g.connect(f.path, f.ws); g.arm(); await g.run(() => f.core.capture(input()));
  g.verify('R2K_EPISODE_DRAFT_CLEANUP');
  assert.equal(observer.prepare('SELECT finished FROM episode_attempts').get().finished, 1);
});

for (const exhausted of [false, true]) test(`cancelled episode settlement native lock; exhausted=${exhausted}`, async t => {
  const g = gate(t, inFile('episode-storage.mjs', 'settleAttempt'), { exhausted });
  let prepared = false, injected = false, providers = 0;
  const f = g.host.open(() => setup(t, { countTokens(value) {
    if (value.includes('classificationTarget') && new Error().stack.includes('/model-call.mjs')) prepared = true;
    return 1;
  }, interpretEpisode() { providers++; throw Error('must remain pre-dispatch'); } }));
  const prepare = DatabaseSync.prototype.prepare;
  t.mock.method(DatabaseSync.prototype, 'prepare', function(sql) {
    if (prepared && !injected && new Error().stack.includes('episodeDraftSnapshot')) {
      injected = true; throw Object.assign(Error('synthetic preflight busy'), { code: 'ERR_SQLITE_ERROR', errcode: 5 });
    }
    return Reflect.apply(prepare, this, [sql]);
  });
  const observer = g.connect(f.path, f.ws); g.arm(); await g.run(() => f.core.capture(input()));
  g.verify('R2K_EPISODE_SETTLEMENT'); assert.ok(injected); assert.equal(providers, 0);
  assert.equal(observer.prepare('SELECT count(*) n FROM episode_attempts').get().n, exhausted ? 1 : 0);
  if (exhausted) assert.equal(observer.prepare('SELECT started FROM episode_attempts').get().started, 0,
    'exhaustion must not convert an uninvoked provider into paid work');
});

for (const auxiliary of [false, true]) test(`cancelled episode writer release; auxiliary=${auxiliary}`, async t => {
  const site = auxiliary ? 'episode-capture.mjs:219:' : 'episode-capture.mjs:310:';
  const g = gate(t, stack => stack.includes(site) && stack.includes('releaseWriter'));
  const f = g.host.open(() => setup(t)); const observer = g.connect(f.path, f.ws);
  let run = () => f.core.capture(input());
  if (auxiliary) {
    ok(await f.core.capture(input())); ok(await f.core.capture(input(2)));
    run = () => f.core.endEpisodeSession({ namespace: episodeNs, client: 'synthetic', sessionId: input().sessionId,
      generation: 'initial', eventId: 'synthetic-end' });
  }
  g.arm(); await g.run(run); g.verify('R2K_EPISODE_WRITER_RELEASE');
  assert.equal(observer.prepare('SELECT writer_token FROM session_episodes').get().writer_token, null);
});

test('cancelled Keep failure retries native BUSY instead of swallowing compensation', async t => {
  const g = gate(t, inFile('episode-storage.mjs', 'failKeep'));
  const f = g.host.open(() => setup(t, { interpretEpisode: request => interpretation(request, 'quick-one-off-question'),
    extract() { throw Error('synthetic Keep extraction failure'); } }));
  const seeded = ok(await f.core.capture(input()));
  const episode = ok(await f.core.getEpisode({ namespace: episodeNs, episodeId: seeded.episode.id })).episode;
  const observer = g.connect(f.path, f.ws); g.arm();
  await g.run(() => f.core.keepEpisode({ namespace: episodeNs, episodeId: episode.id,
    expectedRevision: episode.revision, actionId: 'synthetic-keep-cleanup' }));
  g.verify('R2K_KEEP_COMPENSATION');
  const row = observer.prepare('SELECT state,keep_state,token FROM episode_keep_actions').get();
  assert.deepEqual({ ...row }, { state: 'reserved', keep_state: 'retryable', token: null }, 'R2K_KEEP_COMPENSATION');
});

test('unbound Keep retains deferred native-BUSY cleanup and recovers on the same action', async t => {
  let reject = true, armed = false, cleanupDb;
  const base = rationaleModel();
  const f = setup(t, { interpretEpisode: request => interpretation(request, 'quick-one-off-question'),
    extract(request) { if (reject) throw Error('synthetic Keep failure'); return base.extract(request); } });
  const seeded = ok(await f.core.capture(input()));
  const episode = ok(await f.core.getEpisode({ namespace: episodeNs, episodeId: seeded.episode.id })).episode;
  const holder = new DatabaseSync(f.path);
  f.ws.defer(() => { if (holder.isTransaction) holder.exec('ROLLBACK'); holder.close(); });
  const exec = DatabaseSync.prototype.exec;
  t.mock.method(DatabaseSync.prototype, 'exec', function(sql) {
    if (armed && this !== holder && sql === 'BEGIN IMMEDIATE' && inFile('episode-storage.mjs', 'failKeep')(new Error().stack)) {
      armed = false; cleanupDb = this;
      // Shorten only the fixture's unbound handle to observe its existing
      // deferred fallback immediately, without a five-second wall-clock wait.
      Reflect.apply(exec, this, ['PRAGMA busy_timeout=0']); holder.exec('BEGIN IMMEDIATE');
    }
    return Reflect.apply(exec, this, [sql]);
  });
  const request = { namespace: episodeNs, episodeId: episode.id, expectedRevision: episode.revision, actionId: 'synthetic-deferred-keep' };
  armed = true;
  const failed = await f.core.keepEpisode(request);
  assert.equal(failed.error.code, 'extraction_failed'); assert.equal(armed, false);
  assert.equal(holder.prepare('SELECT state FROM episode_keep_actions').get().state, 'pending');
  holder.exec('ROLLBACK'); cleanupDb.exec('PRAGMA busy_timeout=5000'); reject = false;
  ok(await f.core.keepEpisode(request));
  assert.equal(holder.prepare('SELECT state FROM episode_keep_actions').get().state, 'completed');
});

// All three real Raw failure-path fence sites, including budget exhaustion.
for (const site of [72, 101, 112]) for (const exhausted of [false, true])
test(`cancelled Raw fence at ${site}; exhausted=${exhausted}`, async t => {
  const g = gate(t, stack => stack.includes('raw-composition.mjs:' + site + ':') && stack.includes('fenceArrival'), { exhausted });
  const w = createTestWorkspace(t), path = join(w.path, 'raw.sqlite'), plain = localPlainPort();
  const request = rawRequest(splitRaw('Synthetic failure fence source')[0]);
  let writer, forgotten;
  const port = { ...plain, async sealRaw(value) {
    // A real forget lands while sealing awaits. The anchor is in a different
    // synthetic session, so only the failure-path fence can fence this arrival.
    ok(writer.forget({ namespace: request.namespace, memoryId: forgotten.id, expectedRevision: forgotten.revision }));
    g.arm();
    if (site !== 101) throw Error('synthetic sealing failure');
    return plain.sealRaw(value);
  } };
  const core = g.host.open(() => composeRawCore(createMemoryCore, { path,
    model: { contextWindow: 8192, countTokens: () => 100000, extract() { assert.fail('preflight must refuse'); } } },
  { mode: 'raw-v1', port, readPolicy: () => ({ generation: 'notice-1', reason: null }) },
  { sources: false, lineage: true, deletion: true, localControls: true, localRawPrivacy: true, captureDefault: true, rawTextReaders: false }));
  w.defer(() => core.close()); writer = openMemoryCore({ path, raw: true, rawSearch: false }); w.defer(() => writer.close());
  forgotten = ok(writer.admit({ namespace: request.namespace,
    memory: { content: 'Synthetic separate forget anchor', kind: 'fact' },
    receipts: [{ client: 'synthetic', sessionId: 'other', eventId: 'other', role: 'user', excerpt: 'Synthetic separate anchor' }] })).memory;
  const observer = g.connect(path, w);
  const result = await g.run(() => site === 72 ? core.capture({ ...request,
    messages: request.messages.map(({ id, role, content }) => ({ id, role, content })) }) : core.captureRaw(request));
  g.verify('R2K_RAW_FAILURE_FENCE_' + site);
  assert.equal(result.ok, false);
  // At :101 the outer :112 catch gets its own cleanup budget and can recover
  // the first exhausted fence; the other two sites return storage_busy.
  const recovered = exhausted && site === 101;
  if (exhausted) assert.equal(result.error.code, recovered ? 'conversation_deleted' : 'storage_busy',
    'exhausted fence must not acknowledge success');
  assert.equal(observer.prepare('SELECT count(*) n FROM raw_conversations').get().n, 0);
  assert.equal(observer.prepare('SELECT count(*) n FROM raw_session_fences').get().n, exhausted && !recovered ? 0 : 1);
  assert.deepEqual(ok(await core.listRawConversations({ namespace: request.namespace, client: request.client })).conversations, []);
});
