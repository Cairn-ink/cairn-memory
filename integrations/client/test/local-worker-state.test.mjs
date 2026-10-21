import test from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, chmodSync, existsSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createLocalRawWorker } from '../raw/local-worker.mjs';
import { workerFixture } from './fixtures/local-worker-workspace.mjs';
import { claude, codex } from './fixtures/raw-fixtures.mjs';
import { withWriteObserver } from '../private-state.mjs';

for (const client of ['claude-code','codex']) for (const start of ['eof','beginning']) test(`B4b ${client} initializes ${start} with opaque durable identity, without dispatch`,async t => {
  const f = workerFixture(t,{ client }), worker = createLocalRawWorker(f.options);
  const result = await worker.initialize({ ...f.context,start }); assert.equal(result.status,'ready'); assert.equal(result.reason,'initialized');
  assert.equal(result.dispatchedParts,0); assert.equal(Object.isFrozen(result),true); assert.equal(Object.isFrozen(worker),true);
  const cursor = f.cursor(); assert.equal(cursor.offset,start === 'eof' ? statSync(f.sourcePath).size : 0); assert.equal(cursor.issuedOrdinal,0);
  assert.equal(cursor.pending,null); assert.match(cursor.sessionKey,/^[a-f0-9]{64}$/); assert.match(cursor.wireSessionId,/^localv2_[a-f0-9]{64}$/);
  assert.deepEqual(cursor.selection,client === 'codex' ? {} : { ownSkillTurn:start === 'eof',awaitingUserBoundary:start === 'eof' });
  for (const path of [join(f.stateRoot,'root.json'),...readdirSync(join(f.stateRoot,'sessions')).filter(name => name.endsWith('.json')).map(name => join(f.stateRoot,'sessions',name))]) {
    const text = readFileSync(path,'utf8'); assert.equal(statSync(path).mode & 0o777,0o600);
    for (const secret of [f.context.sessionId,f.sourcePath,f.context.pluginRoot,'synthetic_source_secret','31'.repeat(32)].filter(Boolean)) assert.equal(text.includes(secret),false);
  }
  assert.equal(f.calls().length,0); assert.equal(f.ledger(),null);
  const before = readFileSync(f.cursorPath(),'utf8'); appendFileSync(f.sourcePath,JSON.stringify(client === 'codex' ? codex('later') : claude('later'))+'\n');
  assert.equal((await worker.initialize(f.context)).status,'ready'); assert.equal(readFileSync(f.cursorPath(),'utf8'),before);
});

test('B4b partial EOF waits without claiming a session or silently arming capture',async t => {
  const f = workerFixture(t); f.writeSource([claude('unfinished')],{ partial:true });
  const result = await createLocalRawWorker(f.options).initialize(f.context);
  assert.equal(result.status,'waiting'); assert.equal(result.reason,'partial_record');
  assert.deepEqual(readdirSync(join(f.stateRoot,'sessions')),[]); assert.equal(f.ledger(),null);
});
test('B4b run never initializes missing state; repeated initialize cannot repair a missing cursor',async t => {
  const f = workerFixture(t), worker = createLocalRawWorker(f.options);
  assert.equal((await worker.run(f.context)).status,'blocked'); assert.equal(existsSync(join(f.stateRoot,'root.json')),false);
  assert.equal((await worker.initialize(f.context)).status,'ready'); unlinkSync(f.cursorPath());
  assert.equal((await worker.initialize(f.context)).reason,'state_invalid'); assert.equal((await worker.run(f.context)).reason,'state_invalid');
});
test('B4b key replacement and unsafe permissions cannot adopt existing state',async t => {
  const f = workerFixture(t), worker = createLocalRawWorker(f.options); await worker.initialize(f.context);
  writeFileSync(f.identityKeyPath,'32'.repeat(32)); assert.equal((await worker.initialize(f.context)).reason,'key_invalid');
  writeFileSync(f.identityKeyPath,'31'.repeat(32)); chmodSync(f.identityKeyPath,0o644);
  assert.equal((await worker.initialize(f.context)).reason,'key_invalid');
});
for (const replaceKey of [false,true]) test(`B4b missing root with established sessions refuses ${replaceKey ? 'replaced' : 'unchanged'} installation key`,async t => {
    const f = workerFixture(t), worker = createLocalRawWorker(f.options); await worker.initialize(f.context);
    const before = readFileSync(f.cursorPath(),'utf8'); unlinkSync(join(f.stateRoot,'root.json'));
    if (replaceKey) writeFileSync(f.identityKeyPath,'32'.repeat(32));
    const result = await worker.initialize(f.context);
    assert.equal(result.status,'blocked'); assert.equal(result.reason,'state_invalid');
    assert.equal(existsSync(join(f.stateRoot,'root.json')),false); assert.equal(readFileSync(f.cursorPath(),'utf8'),before);
    assert.equal(readdirSync(join(f.stateRoot,'sessions')).filter(name => name.endsWith('.claim.json')).length,1);
});
test('B4b source rewrite, corrupt cursor and foreign authority refuse without cursor reset',async t => {
  const f = workerFixture(t), worker = createLocalRawWorker(f.options); await worker.initialize(f.context);
  const before = readFileSync(f.cursorPath(),'utf8'); f.writeSource([claude('changed_source_secret')]);
  assert.equal((await worker.initialize(f.context)).reason,'source_changed'); assert.equal(readFileSync(f.cursorPath(),'utf8'),before);
  writeFileSync(f.cursorPath(),'{}'); assert.equal((await worker.initialize(f.context)).reason,'state_invalid');
  writeFileSync(f.cursorPath(),before); f.config.authority.expectedControlRevision++; f.save();
  assert.equal((await worker.initialize(f.context)).reason,'authority_changed'); assert.equal(readFileSync(f.cursorPath(),'utf8'),before);
});
test('B4b Codex qualifies its header even for empty/EOF initialization and existing no-work state',async t => {
  const f = workerFixture(t,{ client:'codex',rows:[] }), worker = createLocalRawWorker(f.options);
  assert.equal((await worker.initialize(f.context)).status,'ready');
  writeFileSync(f.sourcePath,f.header.replace('0.162.0','9.999.9'));
  assert.equal((await worker.initialize(f.context)).status,'blocked');
  const empty = workerFixture(t,{ client:'codex',rows:[] }); writeFileSync(empty.sourcePath,'');
  assert.equal((await createLocalRawWorker(empty.options).initialize(empty.context)).status,'blocked');
});
test('B4b data-only method bindings and native signals refuse before accessors, state or source work',async t => {
  const f = workerFixture(t), worker = createLocalRawWorker(f.options); let invoked = 0;
  const context = { ...f.context }; Object.defineProperty(context,'sessionId',{ get() { invoked++; throw Error(); } });
  assert.equal((await worker.initialize(context)).reason,'invalid_input');
  const signal = new Proxy(new AbortController().signal,{ getPrototypeOf() { invoked++; throw Error(); },get() { invoked++; throw Error(); } });
  assert.equal((await worker.initialize(f.context,{ signal })).reason,'invalid_input'); assert.equal(invoked,0);
  assert.equal((await worker.initialize(f.context,{ signal:AbortSignal.abort() })).reason,'cancelled');
  assert.equal(existsSync(join(f.stateRoot,'root.json')),false);
  assert.throws(() => createLocalRawWorker({ ...f.options,unknown:true }),{ code:'local_raw_worker_invalid_input' });
});
const malformedPending = [
  ['positive prepared',pending => { pending.attempts = 1; pending.lastAttemptAt = Date.now(); }],
  ...['dispatched','processing','uncertain'].map(state => [`${state} without eligibility`,pending => {
    pending.state = state; pending.attempts = 1; pending.lastAttemptAt = Date.now();
  }]),
  ['blocked without reason',pending => { pending.state = 'blocked'; pending.attempts = 1; pending.lastAttemptAt = Date.now(); }],
  ['unavailable with eligibility',pending => { pending.state = 'unavailable'; pending.attempts = 1; pending.lastAttemptAt = Date.now(); pending.nextEligibleAt = pending.lastAttemptAt+125000; }],
  ['uncertain shortened eligibility',pending => { pending.state = 'uncertain'; pending.attempts = 1; pending.lastAttemptAt = Date.now(); pending.nextEligibleAt = pending.lastAttemptAt+124999; }],
];
for (const [name,tamper] of malformedPending) test(`B4b malformed ${name} refuses before dispatch and never rewrites supplied cursor`,async t => {
  const f = workerFixture(t), worker = createLocalRawWorker(f.options); await worker.initialize({ ...f.context,start:'beginning' });
  const controller = new AbortController();
  await withWriteObserver(({ path }) => { if (path === f.cursorPath() && f.cursor().pending?.attempts === 0) controller.abort(); },
    () => worker.run(f.context,{ signal:controller.signal }));
  const cursor = f.cursor(); tamper(cursor.pending); writeFileSync(f.cursorPath(),JSON.stringify(cursor));
  const before = readFileSync(f.cursorPath(),'utf8'), result = await worker.run(f.context);
  assert.equal(result.reason,'state_invalid'); assert.equal(result.status,'blocked'); assert.equal(result.dispatchedParts,0);
  assert.equal(readFileSync(f.cursorPath(),'utf8'),before); assert.equal(f.calls().length,0); assert.equal(f.ledger(),null);
});
test('B4b legal zero-attempt block and unavailable-derived capped block retain opaque valid pending',async t => {
  const f = workerFixture(t), worker = createLocalRawWorker(f.options); await worker.initialize({ ...f.context,start:'beginning' });
  const controller = new AbortController();
  await withWriteObserver(({ path }) => { if (path === f.cursorPath() && f.cursor().pending?.attempts === 0) controller.abort(); },
    () => worker.run(f.context,{ signal:controller.signal }));
  const cursor = f.cursor();
  for (const field of ['sessionId','messageId','projectId','occurredAt']) assert.equal(Object.hasOwn(cursor.pending.projection,field),false);
  for (const sentinel of [f.context.sessionId,f.sourcePath,f.context.pluginRoot,'synthetic_source_secret','synthetic-message','31'.repeat(32)])
    assert.equal(JSON.stringify(cursor).includes(sentinel),false);
  cursor.blockedReason = 'source_changed'; writeFileSync(f.cursorPath(),JSON.stringify(cursor));
  assert.equal((await worker.initialize(f.context)).reason,'source_changed');
  cursor.pending.state = 'blocked'; cursor.pending.attempts = 4; cursor.pending.lastAttemptAt = Date.now(); cursor.blockedReason = 'recovery_exhausted';
  writeFileSync(f.cursorPath(),JSON.stringify(cursor)); const before = readFileSync(f.cursorPath(),'utf8');
  assert.equal((await worker.initialize(f.context)).reason,'recovery_exhausted'); assert.equal(readFileSync(f.cursorPath(),'utf8'),before);
});
