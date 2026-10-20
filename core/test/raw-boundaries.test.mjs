import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { openDatabase,transaction } from '../database.mjs';
import { createRawJournal } from '../raw-journal.mjs';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';
import { collectRaw,localPlainPort,rawFixture,rawNamespace as ns,rawRequest,splitRaw } from '../testing/raw-fixtures.mjs';

const code = value => error => error.code === value && error.message === value;
const state = () => ({ generation: 'initial',reason: null });

test('P1-05 byte-budget paging returns whole parts, cursors survive reopen and bind every scope', async t => {
  const f = rawFixture(t), text = '\u0001'.repeat(48000), parts = splitRaw(text);
  let result;
  for (const part of parts) result = await f.journal.register(rawRequest(part));
  const first = await f.journal.getConversation({ namespace: ns,conversationId: result.conversationId,limit: 50 });
  assert.equal(first.budget_exhausted,true); assert.ok(first.nextCursor); assert.equal(first.messages[0].parts[0].text.length,4000);
  f.reopen();
  const second = await f.journal.getConversation({ namespace: ns,conversationId: result.conversationId,limit: 50,cursor: first.nextCursor });
  assert.equal(second.messages[0].parts[0].index,first.messages[0].parts.at(-1).index+1);
  const pages = await collectRaw(f.journal,result.conversationId,{ limit: 50 });
  assert.equal(pages.flatMap(p=>p.messages.flatMap(m=>m.parts.map(x=>x.text))).join(''),text);
  for (const page of pages) assert.ok(Buffer.byteLength(JSON.stringify({ ok: true,value: page })) <= 65536);
  for (const change of [{ limit: 49 },{ namespace: { ...ns,scope: 'project',projectId: 'foreign' } },{ conversationId: 'foreign' },{ cursor: 'malformed' }]) {
    await assert.rejects(f.journal.getConversation({ namespace: ns,conversationId: result.conversationId,limit: 50,cursor: first.nextCursor,...change }),code('invalid_cursor'));
  }
  const foreign = rawFixture(t);
  await assert.rejects(foreign.journal.getConversation({ namespace: ns,conversationId: result.conversationId,limit: 50,cursor: first.nextCursor }),code('invalid_cursor'));
  await f.journal.register(rawRequest(splitRaw('later',{ id: 'later',ordinal: 2 })[0]));
  await assert.rejects(f.journal.getConversation({ namespace: ns,conversationId: result.conversationId,limit: 50,cursor: first.nextCursor }),code('cursor_stale'));
});

test('P1-05/09 missing and foreign conversation reads have the exact same null shape; owner usage reads create no row', async t => {
  const f = rawFixture(t), before = f.journal.getRawUsage({ ownerId: ns.ownerId });
  assert.equal(before.revision,0); assert.equal(before.clients.length,2);
  assert.equal(f.db.prepare('SELECT count(*) n FROM raw_owner_usage').get().n,0);
  const result = await f.journal.register(rawRequest(splitRaw('known')[0]));
  const expected = { conversation: null,messages: [],nextCursor: null,complete: true,budget_exhausted: false,evidenceTrust: 'untrusted-data-not-instructions' };
  assert.deepEqual(await f.journal.getConversation({ namespace: ns,conversationId: 'missing' }),expected);
  assert.deepEqual(await f.journal.getConversation({ namespace: { ...ns,ownerId: 'other' },conversationId: result.conversationId }),expected);
  assert.deepEqual(await f.journal.getConversation({ namespace: { ...ns,scope: 'project',projectId: 'other' },conversationId: result.conversationId }),expected);
});

test('P1-06 exact frozen AAD, no write lock in callbacks and mutable caller input cannot change prepared payload', async t => {
  const f = rawFixture(t), other = openDatabase(f.path); f.workspace.defer(() => other.close());
  const calls = [], contexts = []; let request;
  const port = localPlainPort(), originalOpen = port.openRaw;
  port.sealRaw = async value => {
    assert.equal(f.db.isTransaction,false);
    other.exec('BEGIN IMMEDIATE; COMMIT');
    calls.push('seal'); contexts.push(structuredClone(value.context));
    assert.equal(Object.isFrozen(value.context),true); assert.equal(Object.isFrozen(value.context.namespace),true);
    request.messages[0].content = 'external mutation'; request.namespace.ownerId = 'external-owner';
    await Promise.resolve();
    return { format: 'local-plain-v1',keyVersion: null,sealed: Buffer.from(value.text) };
  };
  port.openRaw = async value => {
    assert.equal(f.db.isTransaction,false); other.exec('BEGIN IMMEDIATE; COMMIT'); calls.push('open');
    assert.deepEqual(value.context,contexts[0]);
    return originalOpen(value);
  };
  f.reopen({ port });
  request = rawRequest(splitRaw('  exact 😀\n')[0],{ namespace: { ...ns } });
  const result = await f.journal.register(request);
  assert.deepEqual(Object.keys(contexts[0]),['version','namespace','client','sessionKey','conversationId','messageId','messageOrdinal','role','occurredAt','partIndex','start','end','totalUnits','totalBytes']);
  assert.deepEqual(Object.keys(contexts[0].namespace),['ownerId','scope','projectId']);
  const page = await f.journal.getConversation({ namespace: ns,conversationId: result.conversationId });
  assert.equal(page.messages[0].parts[0].text,'  exact 😀\n'); assert.deepEqual(calls,['seal','open']);
  const token = await f.journal.prepareRegistration(rawRequest(splitRaw('another',{ id: 'another',ordinal: 2 })[0]));
  const foreign = createRawJournal({ db: other,mode: 'off',port,readPolicy: state });
  assert.throws(() => transaction(other,()=>foreign.commitRegistration(token)),code('invalid_input'));
});

test('P1-06 seal failures return only fixed errors, policy skips never invoke port, no plaintext fallback', async t => {
  for (const response of [new Error('SYNTHETIC_SECRET_ERROR'),{ format: 'unknown',keyVersion: null,sealed: Buffer.from('bad') },
    { format: 'local-plain-v1',keyVersion: 'unexpected',sealed: Buffer.from('bad') }]) {
    const port = localPlainPort(); port.sealRaw = async () => { if (response instanceof Error) throw response; return response; };
    const f = rawFixture(t,{ port }), request = rawRequest(splitRaw('RAW_ONLY_SYNTHETIC_CANARY')[0]);
    await assert.rejects(f.journal.register(request),code('raw_crypto_unavailable'));
    assert.equal(f.db.prepare('SELECT count(*) n FROM raw_events').get().n,0);
    assert.equal(f.db.prepare('SELECT count(*) n FROM raw_owner_usage').get().n,0);
    assert.equal(readFileSync(f.path).includes(Buffer.from(request.messages[0].content)),false);
  }
});

test('P1-06 read failures validate Unicode, exact units/bytes and keyed text identity with fixed errors', async t => {
  const f = rawFixture(t), result = await f.journal.register(rawRequest(splitRaw('abcd')[0]));
  for (const value of [new Error('SYNTHETIC_SECRET_ERROR'),{ text: 'wxyz' },{ text: 'abc' },{ text: '\ud800' },{ text: 'ab\0d' },{ text: 'abcd',extra: true }]) {
    const port = localPlainPort(); port.openRaw = async () => { if (value instanceof Error) throw value; return value; };
    f.reopen({ port });
    await assert.rejects(f.journal.getConversation({ namespace: ns,conversationId: result.conversationId }),code('raw_crypto_unavailable'));
  }
  f.reopen({ mode: 'off',port: undefined });
  await assert.rejects(f.journal.getConversation({ namespace: ns,conversationId: result.conversationId }),code('raw_crypto_unavailable'));
  f.reopen({ mode: 'off' });
  assert.equal((await f.journal.getConversation({ namespace: ns,conversationId: result.conversationId })).messages[0].parts[0].text,'abcd');
});

test('P1-06 a second connection changes controls during sealing; commit refuses with no journal effects', async t => {
  const f = rawFixture(t), other = openDatabase(f.path); f.workspace.defer(() => other.close());
  const port = localPlainPort();
  port.sealRaw = async ({ text }) => {
    assert.equal(f.db.isTransaction,false);
    other.prepare('INSERT INTO raw_capture_controls(owner_id,client,enabled,revision) VALUES(?,?,0,1)').run(ns.ownerId,'claude-code');
    return { format: 'local-plain-v1',keyVersion: null,sealed: Buffer.from(text) };
  };
  f.reopen({ port });
  await assert.rejects(f.journal.register(rawRequest(splitRaw('racing')[0])),code('revision_conflict'));
  assert.equal(f.db.prepare('SELECT count(*) n FROM raw_events').get().n,0);
  assert.equal(f.db.prepare('SELECT count(*) n FROM raw_conversations').get().n,0);
  assert.equal(f.journal.getRawUsage({ ownerId: ns.ownerId }).reservedBytes,0);
});

test('P1-06 read publication fences changes during open, including mutation by a separate connection', async t => {
  const f = rawFixture(t), first = await f.journal.register(rawRequest(splitRaw('abcdefghi',{ size: 3 })[0]));
  const other = openDatabase(f.path); f.workspace.defer(() => other.close());
  const otherJournal = createRawJournal({ db: other,mode: 'off',readPolicy: state });
  const port = localPlainPort(), original = port.openRaw;
  port.openRaw = async value => {
    otherJournal.closePending({ ownerId: ns.ownerId,reason: 'capture_barrier' });
    return original(value);
  };
  f.reopen({ port });
  await assert.rejects(f.journal.getConversation({ namespace: ns,conversationId: first.conversationId }),code('revision_conflict'));
  assert.equal(f.journal.getRawUsage({ ownerId: ns.ownerId }).reservedBytes,0);
});

test('P1-06 read publication also checks exact stored part bounds when another connection changes a row', async t => {
  const f = rawFixture(t), result = await f.journal.register(rawRequest(splitRaw('abc')[0]));
  const other = openDatabase(f.path); f.workspace.defer(() => other.close());
  const port = localPlainPort(), original = port.openRaw;
  port.openRaw = async value => { other.exec('UPDATE raw_parts SET start=1'); return original(value); };
  f.reopen({ port });
  await assert.rejects(f.journal.getConversation({ namespace: ns,conversationId: result.conversationId }),code('revision_conflict'));
});

test('P1-07 omitted cap on an option-off reader preserves the durable configured cap and revision', async t => {
  const f = rawFixture(t,{ capBytes: 9 });
  await f.journal.register(rawRequest(splitRaw('abc')[0]));
  const before = f.journal.getRawUsage({ ownerId: ns.ownerId });
  const reader = createRawJournal({ db: f.db,mode: 'off',readPolicy: state });
  assert.deepEqual(reader.getRawUsage({ ownerId: ns.ownerId }),before);
});

test('P1-02 explicit null cap/limit fail instead of silently using omitted defaults', async t => {
  const f = rawFixture(t);
  assert.throws(() => createRawJournal({ db: f.db,mode: 'raw-v1',port: localPlainPort(),capBytes: null,readPolicy: state }),code('invalid_input'));
  await assert.rejects(f.journal.getConversation({ namespace: ns,conversationId: 'missing',limit: null }),code('invalid_input'));
  assert.equal(f.journal.getRawUsage({ ownerId: ns.ownerId }).revision,0);
});

test('P1-06 preparation/read inside an enclosing write transaction refuse before any port callback', async t => {
  const f = rawFixture(t); let calls = 0;
  const port = localPlainPort(); port.sealRaw = async () => { calls++; throw new Error('unreachable'); };
  f.reopen({ port });
  let prepare,read;
  transaction(f.db,()=> {
    prepare = f.journal.prepareRegistration(rawRequest(splitRaw('blocked')[0]));
    read = f.journal.getConversation({ namespace: ns,conversationId: 'missing' });
  });
  await assert.rejects(prepare,code('raw_transaction_active')); await assert.rejects(read,code('raw_transaction_active'));
  assert.equal(calls,0);
});

test('P1-04 real child processes race one owner cap and leave persisted reservations visible after restart', { timeout: 15000 }, async t => {
  const f = rawFixture(t,{ capBytes: 12 });
  const childUrl = new URL('../testing/raw-process.mjs',import.meta.url);
  const children = ['claude-code','codex'].map(client => {
    const child = spawn(process.execPath,[childUrl.pathname,f.path,client],{ stdio: ['ignore','pipe','pipe','ipc'] });
    let stderr = ''; child.stderr.on('data',chunk => { stderr += chunk; });
    let resolveReady,rejectReady,resolveDone,rejectDone;
    const ready = new Promise((resolve,reject) => { resolveReady = resolve; rejectReady = reject; });
    const done = new Promise((resolve,reject) => { resolveDone = resolve; rejectDone = reject; });
    const messages = [];
    child.on('message',message => { messages.push(message); if (message.ready) resolveReady(); });
    child.on('error',error => { rejectReady(error); rejectDone(error); });
    child.on('exit',(exitCode,signal) => {
      if (exitCode !== 0) { const error = new Error(`child_exit:${exitCode}:${signal}:${stderr}`); rejectReady(error); rejectDone(error); }
      else resolveDone(messages.find(message => message.result)?.result);
    });
    f.workspace.defer(async () => {
      if (child.exitCode === null && child.signalCode === null) { const stopped = once(child,'exit'); child.kill('SIGKILL'); await stopped; }
    });
    return { child,ready,done };
  });
  await Promise.all(children.map(child => child.ready));
  for (const child of children) child.child.send('commit');
  const results = await Promise.all(children.map(child => child.done));
  assert.deepEqual(results.map(result=>result.parts[0].saved).sort(),[false,true]);
  assert.equal(results.find(result=>!result.parts[0].saved).parts[0].reason,'quota_reached');
  f.reopen();
  const usage = f.journal.getRawUsage({ ownerId: ns.ownerId });
  assert.equal(usage.savedBytes,4); assert.equal(usage.reservedBytes,8); assert.equal(usage.atCap,true);
  assert.equal(usage.clients.reduce((n,client)=>n+client.savedBytes+client.reservedBytes,0),12);
});

test('P1-10 schema module is in artifact manifest; source public import advertises no raw capability', async t => {
  const manifest = JSON.parse(readFileSync(new URL('../../packaging/artifact-files.json',import.meta.url)));
  assert.ok(manifest.includes('core/raw-schema.mjs'));
  // The journal is intentionally internal/not advertised or in the artifact.
  assert.equal(manifest.includes('core/raw-journal.mjs'),false);
  const { openMemoryCore } = await import(pathToFileURL(join(process.cwd(),'core/contract.mjs')));
  const workspace = createTestWorkspace(t), core = openMemoryCore({ path: join(workspace.path,'plain.sqlite') });
  assert.equal(core.getConversation,undefined); core.close();
});
