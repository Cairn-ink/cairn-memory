import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { openDatabase,transaction } from '../database.mjs';
import { openDatabase as preRawDatabase } from '../testing/raw-v23-database.mjs';
import { createRawJournal } from '../raw-journal.mjs';
import { openMemoryCore } from '../contract.mjs';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';
import { collectRaw,localPlainPort,rawFixture,rawNamespace as ns,rawRequest,splitRaw } from '../testing/raw-fixtures.mjs';

const code = value => error => error.code === value && error.message === value;
const usage = f => f.journal.getRawUsage({ ownerId: ns.ownerId });
const count = (db,table) => db.prepare(`SELECT count(*) n FROM ${table}`).get().n;

test('P1-01 default v18 and private v23 migrate empty to coherent v24; option-off preserves both engines', async t => {
  for (const privateCards of [false,true]) {
    const workspace = createTestWorkspace(t), path = join(workspace.path,'schema.sqlite');
    let db = openDatabase(path,{ privateCards });
    assert.equal(db.prepare('PRAGMA user_version').get().user_version,privateCards ? 23 : 18);
    assert.equal(db.prepare("SELECT count(*) n FROM sqlite_master WHERE name LIKE 'raw_%'").get().n,0); db.close();
    db = openDatabase(path,{ rawConversations: true });
    assert.equal(db.prepare('PRAGMA user_version').get().user_version,24);
    for (const table of ['raw_conversations','raw_messages','raw_parts','raw_events','raw_owner_usage']) assert.equal(count(db,table),0);
    db.close();
    const core = openMemoryCore({ path }); assert.equal(core.getConversation,undefined); core.close();
    db = openDatabase(path,{ privateCards: true }); assert.equal(count(db,'private_cards'),0); db.close();
  }
});

test('P1-01 failed migration rolls back schema/version and a mislabeled v24 refuses', t => {
  const workspace = createTestWorkspace(t), path = join(workspace.path,'failure.sqlite');
  let db = openDatabase(path); db.exec('CREATE TABLE raw_parts (synthetic TEXT)'); db.close();
  assert.throws(() => openDatabase(path,{ rawConversations: true }));
  db = new DatabaseSync(path); assert.equal(db.prepare('PRAGMA user_version').get().user_version,18);
  assert.equal(db.prepare("SELECT count(*) n FROM sqlite_master WHERE name='raw_conversations'").get().n,0);
  assert.equal(db.prepare("SELECT count(*) n FROM sqlite_master WHERE name='private_cards'").get().n,0);
  db.exec('DROP TABLE raw_parts; PRAGMA user_version=24'); db.close();
  assert.throws(() => openDatabase(path),code('unsupported_database'));
});

test('P1-01 actual frozen pre-Raw opener accepts v23 and refuses genuine v24 without losing data', async t => {
  const workspace = createTestWorkspace(t), path = join(workspace.path,'old-opener.sqlite');
  let db = preRawDatabase(path,{ privateCards: true }); assert.equal(db.prepare('PRAGMA user_version').get().user_version,23); db.close();
  db = openDatabase(path,{ rawConversations: true });
  const journal = createRawJournal({ db,mode: 'raw-v1',port: localPlainPort(),readPolicy: () => ({ generation: 'initial',reason: null }) });
  const result = await journal.register(rawRequest(splitRaw('preserved across old opener refusal')[0])); db.close();
  assert.throws(() => preRawDatabase(path),code('unsupported_database'));
  db = openDatabase(path); workspace.defer(() => db.close());
  const reader = createRawJournal({ db,mode: 'off',port: localPlainPort(),readPolicy: () => ({ generation: 'initial',reason: null }) });
  assert.equal((await reader.getConversation({ namespace: ns,conversationId: result.conversationId })).messages[0].parts[0].text,'preserved across old opener refusal');
});

for (const client of ['claude-code','codex']) test(`P1-02/03/05 ${client}: exact long Unicode/escaping, restart, stable replay and paged coverage`, async t => {
  const f = rawFixture(t), messages = [
    ' \tFirst 😀 e\u0301 \\"\r\n'.repeat(1900),
    ' 第二則 👨‍👩‍👧‍👦\n'.repeat(2300),
  ];
  const results = [], requests = [];
  for (const [index,text] of messages.entries()) {
    for (const message of splitRaw(text,{ id: `message-${index}`,ordinal: index+1,role: index ? 'assistant' : 'user',
      occurredAt: index ? '2026-10-21T00:00:00.000Z' : null })) {
      const request = rawRequest(message,{ client }); requests.push(request);
      results.push(await f.journal.register(request));
    }
  }
  const initialUsage = usage(f), first = results[0], last = results.at(-1);
  assert.equal(initialUsage.savedBytes,messages.reduce((n,text) => n+Buffer.byteLength(text),0));
  assert.equal(initialUsage.reservedBytes,0);
  f.reopen();
  assert.deepEqual(await f.journal.register(requests[0]),first);
  assert.deepEqual(await f.journal.register(requests.at(-1)),last);
  const overlap = await f.journal.register({ ...requests[0],eventId: 'overlap' });
  assert.equal(overlap.conversationId,first.conversationId);
  const pages = await collectRaw(f.journal,first.conversationId,{ limit: 3 });
  const reconstructed = new Map();
  for (const page of pages) {
    assert.equal(page.evidenceTrust,'untrusted-data-not-instructions');
    assert.ok(Buffer.byteLength(JSON.stringify({ ok: true,value: page })) <= 65536);
    for (const message of page.messages) for (const part of message.parts) {
      assert.equal(part.saved,true); assert.equal(part.reason,null);
      reconstructed.set(message.id,(reconstructed.get(message.id) ?? '')+part.text);
    }
  }
  assert.deepEqual([...reconstructed.values()],messages);
  assert.equal(pages[0].conversation.eventTimeCoverage,'partial');
  assert.equal(pages[0].conversation.coverage.completeMessages,2);
  assert.equal(pages[0].conversation.rawState,'saved');
  assert.deepEqual(usage(f),initialUsage);
  const secret = f.db.prepare('SELECT secret FROM episode_identity').get().secret;
  const expected = 's1:'+createHmac('sha256',Buffer.from(secret,'hex'))
    .update(JSON.stringify(['episode-v1',ns.ownerId,'personal','',client,'synthetic-session'])).digest('hex');
  assert.equal(pages[0].conversation.sessionKey,expected);
  assert.equal(JSON.stringify(pages[0].conversation).includes('synthetic-session'),false);
});

test('P1-02 invalid part text, totals, duplicate ordinal, changed metadata and missing predecessor leave no partial transaction', async t => {
  const f = rawFixture(t), [first,second] = splitRaw('x'.repeat(5000));
  for (const content of ['x\0y','\ud800','x'.repeat(4001),'']) {
    await assert.rejects(f.journal.register(rawRequest({ ...first,content })),code('invalid_input'));
  }
  await assert.rejects(f.journal.register(rawRequest(second)),code('raw_part_out_of_order'));
  assert.equal(count(f.db,'raw_events'),0);
  const result = await f.journal.register(rawRequest(first)), initial = usage(f);
  await assert.rejects(f.journal.register(rawRequest({ ...second,role: 'assistant' })),code('event_payload_conflict'));
  await assert.rejects(f.journal.register(rawRequest({ ...second,part: { ...second.part,totalBytes: 6000 } })),code('event_payload_conflict'));
  await assert.rejects(f.journal.register(rawRequest({ ...second,content: '😀'+'y'.repeat(998) })),code('event_payload_conflict'));
  await assert.rejects(f.journal.register(rawRequest(splitRaw('other',{ id: 'new',ordinal: 1 })[0])),code('event_payload_conflict'));
  assert.deepEqual(usage(f),initial);
  assert.equal(count(f.db,'raw_parts'),1);
  const page = await f.journal.getConversation({ namespace: ns,conversationId: result.conversationId });
  assert.equal(page.conversation.rawState,'partial'); assert.equal(page.messages[0].assemblyState,'pending');
  assert.equal(page.messages[0].parts.length,1);
  assert.equal(page.conversation.coverage.unreceivedBatches,'unknown');
});

test('P1-03/07 skips retain keyed identities, no plaintext and never backfill after policy changes', async t => {
  let seals = 0;
  const port = localPlainPort(); port.sealRaw = async () => { seals++; throw new Error('must not seal'); };
  const f = rawFixture(t,{ port }); f.state.reason = 'notice_required';
  const [part] = splitRaw('Synthetic skipped canary 😀'), request = rawRequest(part);
  const initial = await f.journal.register(request);
  assert.equal(initial.parts[0].reason,'notice_required'); assert.equal(seals,0);
  f.state.reason = null; f.state.generation = 'new';
  assert.deepEqual(await f.journal.register(request),initial);
  assert.equal((await f.journal.register({ ...request,eventId: 'overlap' })).parts[0].reason,'notice_required');
  await assert.rejects(f.journal.register({ ...request,messages: [{ ...part,content: 'changed' }] }),code('event_payload_conflict'));
  const page = await f.journal.getConversation({ namespace: ns,conversationId: initial.conversationId });
  assert.equal(page.messages[0].parts[0].text,null); assert.equal(page.messages[0].assemblyState,'closed');
  assert.equal(usage(f).savedBytes,0); assert.equal(usage(f).revision,0);
  assert.equal(readFileSync(f.path).includes(Buffer.from(part.content)),false);
});

test('P1-04/07 whole-message reservation survives restart/cap decrease and quota skips cannot fill later', async t => {
  const f = rawFixture(t,{ capBytes: 10 });
  const parts = splitRaw('abcdefghi',{ size: 3 });
  const first = await f.journal.register(rawRequest(parts[0]));
  assert.equal(usage(f).savedBytes,3); assert.equal(usage(f).reservedBytes,6);
  const project = { ownerId: ns.ownerId,scope: 'project',projectId: 'project' };
  const denied = rawRequest(splitRaw('xy',{ id: 'other' })[0],{ namespace: project,client: 'codex' });
  const skip = await f.journal.register(denied);
  assert.equal(skip.parts[0].reason,'quota_reached');
  f.reopen({ capBytes: 4 });
  assert.equal(usage(f).capBytes,4); assert.equal(usage(f).reservedBytes,6);
  for (const part of parts.slice(1)) assert.equal((await f.journal.register(rawRequest(part))).parts[0].saved,true);
  assert.equal(usage(f).savedBytes,9); assert.equal(usage(f).reservedBytes,0); assert.equal(usage(f).remainingBytes,0);
  f.reopen({ capBytes: 100 });
  assert.deepEqual(await f.journal.register(denied),skip);
  const page = await f.journal.getConversation({ namespace: ns,conversationId: first.conversationId });
  assert.equal(page.conversation.rawState,'saved');
  assert.equal(usage(f).savedBytes,9);
});

test('P1-04 two connections compete at commit across clients/namespaces, exact cap cannot overspend', async t => {
  const f = rawFixture(t,{ capBytes: 8 }), otherDb = openDatabase(f.path); f.workspace.defer(() => otherDb.close());
  const other = createRawJournal({ db: otherDb,mode: 'raw-v1',port: localPlainPort(),capBytes: 8,readPolicy: () => ({ generation: 'initial',reason: null }) });
  const a = await f.journal.prepareRegistration(rawRequest(splitRaw('12345678')[0]));
  const b = await other.prepareRegistration(rawRequest(splitRaw('abcdefgh')[0],{ client: 'codex',namespace: { ...ns,scope: 'project',projectId: 'other' } }));
  assert.equal(transaction(f.db,() => f.journal.commitRegistration(a)).parts[0].saved,true);
  assert.equal(transaction(otherDb,() => other.commitRegistration(b)).parts[0].reason,'quota_reached');
  assert.equal(usage(f).savedBytes,8); assert.equal(usage(f).atCap,true);
  assert.deepEqual(other.getRawUsage({ ownerId: ns.ownerId }),usage(f));
});

test('P1-07 control close is idempotent, retains accepted prefix and later parts remain gaps', async t => {
  const f = rawFixture(t), parts = splitRaw('abcdefghij',{ size: 3 });
  const first = await f.journal.register(rawRequest(parts[0]));
  assert.equal(f.journal.setRawCaptureControl({ ownerId: ns.ownerId,client: 'claude-code',enabled: false,expectedRevision: 0 }).revision,1);
  assert.equal(usage(f).savedBytes,3); assert.equal(usage(f).reservedBytes,0);
  const revision = usage(f).revision;
  assert.deepEqual(f.journal.closePending({ ownerId: ns.ownerId,reason: 'capture_barrier' }),{ closedMessages: 0,releasedBytes: 0 });
  assert.equal(usage(f).revision,revision);
  f.journal.setRawCaptureControl({ ownerId: ns.ownerId,client: 'claude-code',enabled: true,expectedRevision: 1 });
  for (const part of parts.slice(1)) assert.equal((await f.journal.register(rawRequest(part))).parts[0].reason,'tool_off');
  const page = await f.journal.getConversation({ namespace: ns,conversationId: first.conversationId });
  assert.equal(page.messages[0].parts[0].text,'abc'); assert.equal(page.messages[0].assemblyState,'closed');
  assert.equal(page.conversation.rawState,'partial');
});

test('P1-07 capture_barrier permits a fresh higher ordinal while its late closed suffix stays a gap', async t => {
  const f = rawFixture(t), parts = splitRaw('abcdefghi',{ size: 3 });
  const first = await f.journal.register(rawRequest(parts[0]));
  const fresh = rawRequest(splitRaw('XY',{ id: 'fresh',ordinal: 2 })[0]);
  await assert.rejects(f.journal.register(fresh),code('raw_part_out_of_order'));
  assert.deepEqual(f.journal.closePending({ ownerId: ns.ownerId,reason: 'capture_barrier' }),{ closedMessages: 1,releasedBytes: 6 });
  assert.equal((await f.journal.register(fresh)).parts[0].saved,true);
  for (const part of parts.slice(1)) {
    const result = await f.journal.register(rawRequest(part));
    assert.equal(result.parts[0].saved,false); assert.equal(result.parts[0].reason,'capture_barrier');
  }
  assert.equal(usage(f).savedBytes,5); assert.equal(usage(f).reservedBytes,0);
  const page = await f.journal.getConversation({ namespace: ns,conversationId: first.conversationId });
  assert.equal(page.conversation.rawState,'partial');
  assert.deepEqual(page.conversation.coverage,{ completeMessages: 1,pendingMessages: 0,closedMessages: 1,skippedParts: 2,unreceivedBatches: 'unknown' });
  assert.deepEqual(page.messages[0].parts.map(part=>part.text),['abc',null,null]);
  assert.equal(page.messages[1].parts[0].text,'XY');
});

for (const reason of ['raw_disabled','notice_required']) test(`P1-07 ${reason} closes pending reservation exactly once`, async t => {
  const f = rawFixture(t), parts = splitRaw('abcdefghi',{ size: 3 });
  await f.journal.register(rawRequest(parts[0]));
  if (reason === 'raw_disabled') f.reopen({ mode: 'off',port: undefined });
  else f.state.reason = reason;
  const second = await f.journal.register(rawRequest(parts[1]));
  assert.equal(second.parts[0].reason,reason); assert.equal(usage(f).reservedBytes,0); assert.equal(usage(f).savedBytes,3);
  const revision = usage(f).revision;
  assert.deepEqual(await f.journal.register(rawRequest(parts[1])),second); assert.equal(usage(f).revision,revision);
  f.reopen();
  assert.equal((await f.journal.register(rawRequest(parts[2]))).parts[0].reason,reason);
});

test('P1-08 opaque prepared registration joins an enclosing transaction and all effects roll back', async t => {
  const f = rawFixture(t), request = rawRequest(splitRaw('atomic synthetic')[0]);
  const prepared = await f.journal.prepareRegistration(request);
  assert.throws(() => f.journal.commitRegistration(prepared),code('raw_transaction_required'));
  assert.throws(() => transaction(f.db,() => f.journal.commitRegistration({})),code('invalid_input'));
  assert.throws(() => transaction(f.db,() => { f.journal.commitRegistration(prepared); throw new Error('synthetic rollback'); }),/synthetic rollback/);
  for (const table of ['raw_conversations','raw_events','raw_messages','raw_parts','raw_owner_usage']) assert.equal(count(f.db,table),0);
  assert.equal(usage(f).revision,0);
  transaction(f.db,() => f.journal.commitRegistration(prepared));
  assert.equal(usage(f).savedBytes,request.messages[0].part.totalBytes);
});
