import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { FORMAT } from '../../codex/parser.mjs';
import { join,resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { lazyFixture, ok } from '../../../integrations/client/test/fixtures/local-setup-workspace.mjs';
import { withWriteObserver } from '../../../integrations/client/private-state.mjs';
import { runLocalHostCli } from '../raw/local-host-cli.mjs';
import { createLocalRawWorker } from '../raw/local-worker.mjs';
import { createLocalRawHost } from '../../../integrations/client/raw/local-host.mjs';
import { localPlainPort } from '../../../core/testing/raw-capture-fixtures.mjs';
import { searchFixture } from '../../../core/testing/raw-search-fixtures.mjs';
import { installRawSearchTestClock } from '../../../core/testing/raw-search-clock.mjs';

test('every fence writer must enqueue Claude UUID protection after backfill completes', async t => {
  installRawSearchTestClock(t);
  const f = await lazyFixture(t, 'claude-code');
  await f.hook();
  f.append('copper original to hide',{at:new Date(Date.now()-86400000).toISOString()});
  assert.equal((await f.hook('Stop')).status, 'progress');
  const original = f.cursor();
  const copied = JSON.parse(readFileSync(f.sourcePath, 'utf8').trim().split('\n').at(-1));
  const controlId = '22222222-2222-4222-8222-222222222222';
  const controlPath = join(f.request.sourceRoot, 'control.jsonl');
  writeFileSync(controlPath, '', { mode: 0o600 });
  const control = { session_id: controlId, transcript_path: controlPath };
  assert.equal((await f.hook('SessionStart', control)).status, 'ready');
  f.append('copper visible control', { path: controlPath, nativeSessionId: controlId });
  assert.equal((await f.hook('Stop', control)).status, 'progress');
  const db = new DatabaseSync(f.request.databasePath);
  f.workspace.defer(() => db.close());
  assert.equal(db.prepare('SELECT complete FROM local_raw_uuid_backfill').get().complete, 1);
  // This is the public Raw handle without localAuthority, on the SAME local DB.
  ok(f.core.fenceSession({ namespace: f.request.namespace, client: 'claude-code', sessionId: original.wireSessionId }));
  const forkId = '33333333-3333-4333-8333-333333333333';
  const forkPath = join(f.request.sourceRoot, 'fork.jsonl');
  const fork = { session_id: forkId, transcript_path: forkPath };
  assert.equal(existsSync(forkPath), false);
  assert.equal((await f.hook('SessionStart', fork)).status, 'ready');
  assert.equal(db.prepare('SELECT count(*) n FROM local_raw_uuid_jobs WHERE complete=0').get().n,1,'the non-local fence atomically enqueued its hash job');
  copied.timestamp = new Date().toISOString();
  writeFileSync(forkPath, JSON.stringify(copied) + '\n', { mode: 0o600 });
  assert.equal((await f.hook('Stop', fork)).status, 'blocked', 'a copied UUID must terminally fence the fork');
  const search = await searchFixture({ workspace: f.workspace, db, path: f.request.databasePath, port: localPlainPort() },
    { ownerId: f.request.namespace.ownerId, readSet: [f.request.namespace] });
  await search.maintain();
  for (const intent of ['current', 'history']) {
    const hits = (await search.search({ query: 'copper', intent })).candidates;
    assert.ok(hits.length > 0, 'visible control prevents a vacuous empty-search assertion');
    const text = [];
    for (const hit of hits) text.push(...(await search.prepare(hit, intent)).validate().ranges.map(range => range.text));
    assert.match(text.join('\n'), /visible control/);
    assert.doesNotMatch(text.join('\n'), /original to hide/);
  }
});

for (const client of ['claude-code', 'codex']) for (const cutPoint of ['receipt','cursor']) test(`pending ${client} ${cutPoint} lazy rearm must recover across another disable/activate`, async t => {
  const f = await lazyFixture(t, client);
  await f.hook();
  f.append('copper captured before disabling');
  assert.equal((await f.hook('Stop')).status, 'progress');
  const before = f.cursor(), keyPath = join(f.request.installationDirectory,'identity.key'), key = readFileSync(keyPath);
  await f.invoke('disable');
  f.append('first off-period content');
  await f.invoke('activate');
  const receiptPath = f.cursorPath().replace(/\.json$/, '.rearm.json');
  let cut = false;
  await withWriteObserver(({ path }) => {
    if (!cut && path === (cutPoint === 'receipt' ? receiptPath : f.cursorPath()) && existsSync(receiptPath) && JSON.parse(readFileSync(receiptPath)).phase === 'pending') {
      cut = true;
      throw Error('synthetic crash after pending receipt publication');
    }
  }, () => f.hook('Stop'));
  assert.equal(cut, true);
  assert.equal(JSON.parse(readFileSync(receiptPath)).phase, 'pending');
  await f.invoke('disable');
  f.append('second off-period content');
  assert.equal((await f.invoke('activate')).status, 'active');
  const pendingReceipt = JSON.parse(readFileSync(receiptPath));
  assert.equal((await f.hook('Stop')).status, 'ready', 'known durable pending work must have a supported recovery');
  const after = f.cursor(), committed = JSON.parse(readFileSync(receiptPath));
  assert.equal(after.sessionKey, before.sessionKey); assert.equal(after.wireSessionId, before.wireSessionId);
  assert.equal(after.issuedOrdinal, before.issuedOrdinal); assert.deepEqual(readFileSync(keyPath),key);
  assert.equal(committed.phase,'committed'); assert.equal(committed.revision,pendingReceipt.revision+1);
  assert.equal(committed.oldAuthorityCommitment,pendingReceipt.authorityCommitment);
  assert.notEqual(committed.authorityCommitment,pendingReceipt.authorityCommitment);
  assert.ok(after.offset > pendingReceipt.replacementCursor.offset);
  f.append('copper after recovery');
  assert.equal((await f.hook('Stop')).status, 'progress');
  const db = new DatabaseSync(f.request.databasePath, { readOnly: true });
  try {
    const text = db.prepare('SELECT sealed FROM raw_parts WHERE saved=1 ORDER BY rowid').all().map(row => Buffer.from(row.sealed).toString()).join('');
    assert.doesNotMatch(text, /off-period/);
    assert.match(text, /after recovery/);
  } finally { db.close(); }
});

test('managed Codex cannot select an offset-zero import', async t => {
  const f = await lazyFixture(t, 'codex');
  const host = createLocalRawHost({ profilePath: join(f.request.installationDirectory, 'host-profile.json') });
  const selection = { sessionId: '11111111-1111-4111-8111-111111111111', sourcePath: f.sourcePath };
  const result = await f.scoped(() => host.initialize({ ...selection, start: 'beginning' }));
  assert.equal(result.reason,'invalid_input');
  const cli=await f.scoped(()=>runLocalHostCli(['--profile',join(f.request.installationDirectory,'host-profile.json'),'initialize','--session',selection.sessionId,'--source',selection.sourcePath,'--start','beginning']));
  assert.equal(cli.exitCode,2); assert.equal(cli.result.reason,'invalid_input');
  const config=JSON.parse(readFileSync(join(f.request.installationDirectory,'capture.json')));
  const worker=createLocalRawWorker({stateRoot:join(f.request.installationDirectory,'state'),identityKeyPath:join(f.request.installationDirectory,'identity.key'),
    nodeExecutable:process.execPath,runtimeRoot:resolve(new URL('../../../',import.meta.url).pathname),configPath:join(f.request.installationDirectory,'capture.json'),expectedAuthority:config.authority,home:join(f.request.installationDirectory,'home')});
  const direct=await worker.initialize({...selection,start:'beginning',pluginRoot:null,formatAuthority:{format:FORMAT,sessionId:selection.sessionId,creatorVersion:'0.162.0',qualifiedCreatorVersion:'0.162.0'}});
  assert.equal(direct.status,'blocked');assert.equal(direct.reason,'invalid_input');
  assert.equal(result.status, 'blocked', 'Codex must keep the required EOF-only initialization invariant');
  const db = new DatabaseSync(f.request.databasePath, { readOnly: true });
  try { assert.equal(db.prepare('SELECT count(*) n FROM raw_parts').get().n, 0); }
  finally { db.close(); }
});
