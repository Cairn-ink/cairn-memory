import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync, appendFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { workerFixture } from './fixtures/local-worker-workspace.mjs';
import { claude } from './fixtures/raw-fixtures.mjs';
import { sourceBudget, READ_LIMIT, RECORD_LIMIT } from '../raw/local-worker-source.mjs';

async function call(f,action,options = {}) {
  const result = await f.runWorker(action,options).done;
  assert.equal(result.code,0,result.stderr); assert.equal(result.signal,null);
  assert.doesNotMatch(result.stdout+result.stderr,/synthetic_source_secret|synthetic_key_secret/);
  return JSON.parse(result.stdout);
}
function policyFixture(t,settings = {}) {
  const f = workerFixture(t,settings), directory = join(f.workspace.path,'fake-runtime','adapters','local');
  mkdirSync(directory,{ recursive:true });
  copyFileSync(new URL('./fixtures/local-transport-child.mjs',import.meta.url),join(directory,'cli.mjs'));
  f.options.runtimeRoot = join(f.workspace.path,'fake-runtime');
  const reply = mode => writeFileSync(join(directory,'scenario.json'),JSON.stringify({ mode }),{ mode:0o600 });
  reply('complete');
  return { ...f,reply,invoke:(action,options) => call(f,action,{ realNode:true,...options }),
    observed:() => JSON.parse(readFileSync(join(directory,'observed.json'),'utf8')) };
}
test('B4b wrong-inode invocation refuses without cursor rewrite, original inode resumes exact pending',{ timeout:20000 },async t => {
  const f = workerFixture(t), now = Date.now(); await call(f,'initialize',{ start:'beginning' }); f.providerMode('drop-ack');
  await call(f,'run',{ clock:now }); const before = readFileSync(f.cursorPath(),'utf8'), event = f.cursor().pending.projection.eventId;
  const inode = statSync(f.sourcePath).ino, backup = join(f.workspace.path,'owned-source-backup'); renameSync(f.sourcePath,backup);
  writeFileSync(f.sourcePath,readFileSync(backup),{ mode:0o600 }); assert.notEqual(statSync(f.sourcePath).ino,inode);
  const calls = f.calls().length, used = f.ledger().used;
  const refused = await call(f,'run',{ clock:now+125001,key:false });
  assert.equal(refused.reason,'source_changed'); assert.equal(refused.dispatchedParts,0);
  assert.equal(readFileSync(f.cursorPath(),'utf8'),before); assert.equal(f.calls().length,calls);
  renameSync(backup,f.sourcePath); assert.equal(statSync(f.sourcePath).ino,inode); f.providerMode('memory');
  const recovered = await call(f,'run',{ clock:now+125001,key:false }); assert.equal(recovered.status,'progress');
  assert.equal(recovered.completedParts,1); assert.equal(f.cursor().pending,null); assert.equal(f.cursor().issuedOrdinal,1);
  assert.equal(f.calls().length,calls); assert.equal(f.ledger().used,used); assert.equal(f.cursor().offset,statSync(f.sourcePath).size);
  assert.match(event,/^[a-f0-9]{64}$/);
});
test('B4b synthetic processing cadence and four-submission cap survive fresh processes and wall-clock rollback',{ timeout:20000 },async t => {
  const f = policyFixture(t), now = Date.now(); await f.invoke('initialize',{ start:'beginning' }); f.reply('processing');
  let result = await f.invoke('run',{ clock:now }), event = f.cursor().pending.projection.eventId;
  assert.equal(result.status,'waiting'); assert.equal(result.reason,'processing');
  for (let attempts = 2; attempts <= 4; attempts++) {
    const before = readFileSync(f.cursorPath(),'utf8'), eligible = f.cursor().pending.nextEligibleAt;
    const waiting = await f.invoke('run',{ clock:now-999999 }); assert.equal(waiting.dispatchedParts,0);
    assert.equal(readFileSync(f.cursorPath(),'utf8'),before);
    result = await f.invoke('run',{ clock:eligible+1,key:false });
    assert.equal(result.dispatchedParts,1); assert.equal(result.reason,'processing');
    assert.equal(f.cursor().pending.attempts,attempts); assert.equal(f.cursor().pending.projection.eventId,event);
    assert.equal(f.observed().eventId,event); assert.equal(f.cursor().offset,0); assert.equal(f.cursor().issuedOrdinal,1);
  }
  result = await f.invoke('run',{ clock:f.cursor().pending.nextEligibleAt+1 });
  assert.equal(result.reason,'recovery_exhausted'); assert.equal(result.dispatchedParts,0); assert.equal(f.cursor().pending.attempts,4);
  assert.equal(f.cursor().blockedReason,'recovery_exhausted'); assert.equal(f.calls().length,0);
});
for (const mode of ['wrong-part','no-newline','nonzero']) test(`B4b synthetic ${mode} is bounded uncertainty, not progress or a replacement event`,{ timeout:10000 },async t => {
  const f = policyFixture(t), now = Date.now(); await f.invoke('initialize',{ start:'beginning' }); f.reply(mode);
  const failed = await f.invoke('run',{ clock:now }); assert.equal(failed.reason,'uncertain'); assert.equal(failed.completedParts,0);
  const event = f.cursor().pending.projection.eventId; assert.equal(f.cursor().offset,0); f.reply('complete');
  const recovered = await f.invoke('run',{ clock:f.cursor().pending.nextEligibleAt+1,key:false });
  assert.equal(recovered.dispatchedParts,1); assert.equal(recovered.status,'progress'); assert.equal(f.observed().eventId,event);
  assert.equal(f.cursor().pending,null); assert.equal(f.cursor().issuedOrdinal,1); assert.equal(f.calls().length,0);
});
for (const [mode,reason] of [['quota','quota_reached'],['refused','authority_changed'],['incomplete','interpretation_incomplete']])
  test(`B4b synthetic confirmed ${mode} remains blocked without elapsed-time or key reset`,{ timeout:10000 },async t => {
    const f = policyFixture(t); await f.invoke('initialize',{ start:'beginning' }); f.reply(mode);
    const failed = await f.invoke('run'); assert.equal(failed.status,'blocked'); assert.equal(failed.reason,reason);
    const before = readFileSync(f.cursorPath(),'utf8'); f.reply('complete');
    const again = await f.invoke('run',{ clock:Date.now()+999999,key:false });
    assert.equal(again.reason,reason); assert.equal(again.dispatchedParts,0); assert.equal(readFileSync(f.cursorPath(),'utf8'),before);
  });
test('B4b synthetic complete replies stop at32 parts with prepared continuation and stable ordinal',{ timeout:20000 },async t => {
  const f = policyFixture(t,{ rows:[claude('z'.repeat(4000*32+1))] }); await f.invoke('initialize',{ start:'beginning' });
  const first = await f.invoke('run'); assert.equal(first.reason,'work_limit'); assert.equal(first.completedParts,32);
  assert.equal(first.dispatchedParts,32); assert.equal(first.completedRecords,0); assert.equal(f.cursor().offset,0);
  assert.equal(f.cursor().pending.projection.part.index,32); assert.equal(f.cursor().pending.attempts,0); assert.equal(f.cursor().issuedOrdinal,1);
  const last = await f.invoke('run',{ key:false }); assert.equal(last.completedParts,1); assert.equal(last.completedRecords,1);
  assert.equal(f.cursor().pending,null); assert.equal(f.cursor().offset,statSync(f.sourcePath).size); assert.equal(f.cursor().issuedOrdinal,1);
});
test('B4b64 excluded records stop without consuming ordinals and resume the65th record',{ timeout:10000 },async t => {
  const rows = Array.from({ length:65 },(_,i) => ({ type:'progress',index:i })), f = policyFixture(t,{ rows });
  await f.invoke('initialize',{ start:'beginning' }); const first = await f.invoke('run');
  assert.equal(first.completedRecords,64); assert.equal(first.reason,'work_limit'); assert.equal(first.dispatchedParts,0);
  assert.equal(f.cursor().issuedOrdinal,0); assert.equal(f.cursor().pending,null); const next = await f.invoke('run');
  assert.equal(next.completedRecords,1); assert.equal(f.cursor().offset,statSync(f.sourcePath).size); assert.equal(f.calls().length,0);
});
test('B4b Claude EOF excludes assistants until an empty user boundary, then captures only the fresh turn',{ timeout:10000 },async t => {
  const f = policyFixture(t); await f.invoke('initialize');
  appendFileSync(f.sourcePath,[{ type:'assistant',message:{ content:[{ type:'text',text:'own-skill-output' }] } },claude(''),
    { type:'assistant',uuid:'fresh-assistant',message:{ content:[{ type:'text',text:'fresh ordinary reply' }] } }].map(JSON.stringify).join('\n')+'\n');
  const result = await f.invoke('run'); assert.equal(result.completedRecords,3); assert.equal(result.completedParts,1);
  assert.equal(result.dispatchedParts,1); assert.equal(f.cursor().issuedOrdinal,1);
  assert.deepEqual(f.cursor().selection,{ ownSkillTurn:false,awaitingUserBoundary:false });
});
test('B4b bounded scan distinguishes a partial actual EOF from an oversized record',{ timeout:10000 },async t => {
  const f = policyFixture(t,{ rows:[JSON.stringify(claude('partial'))] });
  f.writeSource([claude('partial')],{ partial:true }); await f.invoke('initialize',{ start:'beginning' });
  const partial = await f.invoke('run'); assert.equal(partial.reason,'partial_record'); assert.equal(f.cursor().issuedOrdinal,0);
  appendFileSync(f.sourcePath,'\n'); assert.equal((await f.invoke('run')).completedRecords,1);
  const g = policyFixture(t,{ rows:[] }); writeFileSync(g.sourcePath,Buffer.alloc(RECORD_LIMIT+1,32));
  await g.invoke('initialize',{ start:'beginning' }); const oversized = await g.invoke('run');
  assert.equal(oversized.reason,'record_limit'); assert.equal(oversized.dispatchedParts,0); assert.equal(g.cursor().offset,0);
  assert.equal(g.cursor().issuedOrdinal,0); assert.equal(g.cursor().blockedReason,'record_limit');
});
test('B4b source read accounting charges actual bytes and refuses beyond128MiB before a read',async () => {
  let calls = 0; const bytes = sourceBudget({ check() {} }), source = bytes.reader({ async read(buffer,offset,length) { calls++; return { bytesRead:length }; } });
  const buffer = Buffer.alloc(65536);
  for (let at = 0; at < READ_LIMIT; at += buffer.length) await source.read(buffer,0,buffer.length,at);
  assert.equal(bytes.consumed,READ_LIMIT); assert.equal(bytes.remaining,0); const before = calls;
  await assert.rejects(source.read(buffer,0,1,READ_LIMIT),{ reason:'work_limit' }); assert.equal(calls,before); assert.equal(bytes.exhausted,true);
});
test('B4b monotonic work exhaustion before dispatch preserves the prepared event without spending an attempt',{ timeout:10000 },async t => {
  const f = policyFixture(t); await f.invoke('initialize',{ start:'beginning' });
  const stopped = await f.invoke('run',{ exhaustAt:'prepared' }); assert.equal(stopped.reason,'work_limit'); assert.equal(stopped.dispatchedParts,0);
  const pending = f.cursor().pending; assert.equal(pending.attempts,0); assert.equal(pending.state,'prepared'); assert.equal(f.cursor().issuedOrdinal,1);
  assert.equal(existsSync(join(f.options.runtimeRoot,'adapters/local/observed.json')),false);
  const completed = await f.invoke('run'); assert.equal(completed.completedParts,1); assert.equal(f.observed().eventId,pending.projection.eventId);
  assert.equal(f.cursor().pending,null); assert.equal(f.cursor().issuedOrdinal,1);
});
test('B4b actual bounded source leaves proof reserve before dispatch and fresh pending skips the prior scan',{ timeout:90000 },async t => {
  const f = policyFixture(t), row = { ...claude('small selected text'),unrelated:'' }, length = RECORD_LIMIT-1000;
  row.unrelated = 'x'.repeat(length-Buffer.byteLength(JSON.stringify(row))-1); f.writeSource([row]);
  assert.equal(statSync(f.sourcePath).size,length); await f.invoke('initialize',{ start:'beginning' });
  const first = await f.invoke('run'); assert.equal(first.reason,'work_limit'); assert.equal(first.dispatchedParts,0);
  const pending = f.cursor().pending; assert.equal(pending.attempts,0); assert.equal(pending.state,'prepared');
  assert.equal(f.cursor().issuedOrdinal,1); assert.equal(f.cursor().offset,0);
  assert.equal(existsSync(join(f.options.runtimeRoot,'adapters/local/observed.json')),false);
  const completed = await f.invoke('run'); assert.equal(completed.completedParts,1); assert.equal(completed.completedRecords,1);
  assert.equal(f.observed().eventId,pending.projection.eventId); assert.equal(f.cursor().pending,null);
  assert.equal(f.cursor().offset,length); assert.equal(f.cursor().issuedOrdinal,1);
});
