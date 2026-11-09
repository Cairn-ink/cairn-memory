import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as delay } from 'node:timers/promises';
import { createLocalRawWorker } from '../raw/local-worker.mjs';
import { withWriteObserver } from '../private-state.mjs';
import { stateLock } from '../state-lock.mjs';
import { join } from 'node:path';
import { workerFixture } from './fixtures/local-worker-workspace.mjs';
import { claude, codex } from './fixtures/raw-fixtures.mjs';
import { redactSecrets } from '../redact.mjs';
import { lazyFixture } from './fixtures/local-setup-workspace.mjs';

for (const client of ['claude-code','codex']) for (const firstEvent of (client === 'codex' ? ['Stop','UserPromptSubmit']:['Stop']))
test(`lazy ${client} ${firstEvent} never captures the off period and resumes with the same ordinal/session`,async t => {
  const f = await lazyFixture(t,client); await f.hook();
  f.append('copper before disabling'); assert.equal((await f.hook('Stop')).status,'progress');
  const before = f.cursor(),keyPath = join(f.request.installationDirectory,'identity.key'),key = readFileSync(keyPath),control = f.control();
  await f.invoke('disable'); f.append('copper OFF PERIOD MUST NOT ARRIVE');
  await f.invoke('activate'); f.append('copper first post-enable boundary turn');
  assert.equal((await f.hook(firstEvent)).status,'ready');
  const adopted = f.cursor(); assert.equal(adopted.offset,statSync(f.sourcePath).size);
  for (const field of ['sessionKey','wireSessionId','issuedOrdinal']) assert.equal(adopted[field],before[field]);
  assert.deepEqual(readFileSync(keyPath),key); assert.equal(f.control().storeId,control.storeId); assert.equal(f.control().targetId,control.targetId);
  assert.notEqual(adopted.authorityCommitment,before.authorityCommitment);
  assert.deepEqual(readRaw({databasePath:f.request.databasePath}),{text:'copper before disabling',memories:0});
  f.append('copper captured after lazy boundary');
  assert.equal((await f.hook('Stop')).status,'progress'); assert.equal(f.cursor().issuedOrdinal,before.issuedOrdinal+1);
  assert.deepEqual(readRaw({databasePath:f.request.databasePath}),{text:'copper before disablingcopper captured after lazy boundary',memories:0});
  const after = readFileSync(f.cursorPath()); await f.hook('Stop'); assert.deepEqual(readFileSync(f.cursorPath()),after);
  await f.invoke('disable'); f.append('copper SECOND OFF PERIOD'); await f.invoke('activate');
  assert.equal((await f.hook('Stop')).status,'ready'); assert.equal(f.cursor().rearmRevision,2);
  f.append('copper second resumed capture'); assert.equal((await f.hook('Stop')).status,'progress');
  assert.equal(f.cursor().issuedOrdinal,before.issuedOrdinal+2);
  assert.equal(readRaw({databasePath:f.request.databasePath}).text,'copper before disablingcopper captured after lazy boundarycopper second resumed capture');
});

for (const client of ['claude-code','codex']) test(`lazy ${client} a prior receipt proves an unchanged historical high-water on another off/on`,async t => {
  const f = await lazyFixture(t,client); await f.hook(); f.append('copper original high-water'); await f.hook('Stop');
  const original = f.cursor();
  for (let index=1;index<=2;index++) {
    await f.invoke('disable'); f.append('copper off '+index); await f.invoke('activate');
    assert.equal((await f.hook('Stop')).status,'ready'); assert.equal(f.cursor().rearmRevision,index);
    assert.equal(f.cursor().issuedOrdinal,original.issuedOrdinal);
  }
  f.append('copper resumed'); assert.equal((await f.hook('Stop')).status,'progress');
  assert.equal(readRaw({databasePath:f.request.databasePath}).text,'copper original high-watercopper resumed');
});

test('lazy Codex prompt hook skips only paused EOF before the submitted turn is written',async t => {
  const f = await lazyFixture(t,'codex'); await f.hook();
  await f.invoke('disable'); f.append('copper paused'); await f.invoke('activate');
  assert.equal((await f.hook('UserPromptSubmit')).status,'ready');
  f.append('copper submitted after prompt boundary'); assert.equal((await f.hook('Stop')).status,'progress');
  assert.equal(readRaw({databasePath:f.request.databasePath}).text,'copper submitted after prompt boundary');
});

const call = async (f,action,options) => {
  const result = await f.runWorker(action,options).done;
  assert.equal(result.code,0,result.stderr); assert.equal(result.signal,null);
  assert.doesNotMatch(result.stdout+result.stderr,/synthetic_source_secret|synthetic_key_secret/);
  assert.equal(result.stdout.trim().split('\n').length,1); return JSON.parse(result.stdout);
};
async function initializeSelectedRows(f){
  const text=readFileSync(f.sourcePath,'utf8');
  if(f.client==='codex')writeFileSync(f.sourcePath,f.header,{mode:0o600});
  const result=await call(f,'initialize',{start:f.client==='codex'?'eof':'beginning'});
  if(f.client==='codex')writeFileSync(f.sourcePath,text,{mode:0o600});
  return result;
}
function readRaw(f) {
  const db = new DatabaseSync(f.databasePath,{ readOnly:true });
  try { return { text:Buffer.concat(db.prepare('SELECT p.sealed FROM raw_parts p JOIN raw_messages m ON m.conversation_id=p.conversation_id AND m.message_id=p.message_id WHERE p.saved=1 ORDER BY m.ordinal,p.part_index').all().map(row => Buffer.from(row.sealed))).toString(),
    memories:db.prepare('SELECT count(*) n FROM memories').get().n }; }
  finally { db.close(); }
}
for (const client of ['claude-code','codex']) test(`B4b ${client} fresh worker processes preserve whole-message redaction and exact multipart progress`,{ timeout:30000 },async t => {
  const text = 'x'.repeat(3995)+' sk-'+'a'.repeat(32)+'\n Ａ🙂 e\u0301 '.repeat(700), f = workerFixture(t,{ client,
    rows:[client === 'codex' ? codex(text) : claude(text)] });
  f.providerMode('memory');
  assert.equal((await initializeSelectedRows(f)).status,'ready');
  const result = await call(f,'run'); assert.equal(result.status,'progress'); assert.equal(result.hasPending,false);
  assert.ok(result.completedParts > 1); assert.equal(result.savedParts,result.completedParts); assert.equal(result.skippedParts,0);
  assert.equal(f.cursor().offset,statSync(f.sourcePath).size); assert.equal(f.cursor().issuedOrdinal,1);
  assert.deepEqual(readRaw(f),{ text:redactSecrets(text),memories:1 }); const usage = f.ledger().used, calls = f.calls().length;
  assert.equal((await call(f,'run',{ key:false })).status,'ready'); assert.equal(f.calls().length,calls); assert.equal(f.ledger().used,usage);
});
test('B4b lost ACK preserves exact event, cooldown and one keyless recovery submission across fresh processes',{ timeout:30000 },async t => {
  const text = 'synthetic_source_secret '+'長🙂'.repeat(3300), f = workerFixture(t,{ rows:[claude(text)] }), now = Date.now();
  await call(f,'initialize',{ start:'beginning',clock:now }); f.providerMode('drop-ack');
  const uncertain = await call(f,'run',{ clock:now }); assert.equal(uncertain.reason,'uncertain');
  const pending = f.cursor().pending; assert.equal(pending.attempts,1); assert.equal(f.cursor().offset,0);
  const used = f.ledger().used, calls = f.calls().length;
  assert.equal((await call(f,'run',{ key:false,clock:now+1000 })).dispatchedParts,0);
  assert.equal(f.cursor().pending.projection.eventId,pending.projection.eventId);
  f.providerMode('memory'); const recovered = await call(f,'run',{ key:false,clock:now+125001 });
  assert.equal(recovered.status,'progress'); assert.equal(recovered.dispatchedParts,1); assert.equal(recovered.completedParts,1);
  assert.equal(recovered.hasPending,true); assert.equal(f.cursor().pending.attempts,0);
  assert.equal(f.calls().length,calls); assert.equal(f.ledger().used,used);
  const continued = await call(f,'run',{ key:false,clock:now+125001 }); assert.equal(continued.hasPending,false);
  assert.deepEqual(readRaw(f),{ text:redactSecrets(text),memories:1 }); assert.equal(f.calls().length,calls); assert.equal(f.ledger().used,used);
});
test('B4b confirmed incomplete blocks permanently without automatic credential or elapsed-time retry',{ timeout:30000 },async t => {
  const f = workerFixture(t), now = Date.now(); await call(f,'initialize',{ start:'beginning' }); f.providerMode('provider-error');
  const failed = await call(f,'run'); assert.equal(failed.status,'blocked'); assert.equal(failed.reason,'interpretation_incomplete');
  const before = readFileSync(f.cursorPath(),'utf8'), calls = f.calls().length, used = f.ledger().used;
  assert.equal((await call(f,'initialize')).status,'blocked'); assert.equal(readFileSync(f.cursorPath(),'utf8'),before);
  f.providerMode('memory'); const repeated = await call(f,'run',{ clock:now+999999 }); assert.equal(repeated.reason,'interpretation_incomplete');
  assert.equal(f.calls().length,calls); assert.equal(f.ledger().used,used); assert.equal(readFileSync(f.cursorPath(),'utf8'),before);
});
test('B4b Raw cap quota skip on a complete200 advances and reports skipped, never provider quota',{ timeout:30000 },async t => {
  const f = workerFixture(t); f.config.raw.capBytes = 1; f.save(); f.providerMode('memory');
  await call(f,'initialize',{ start:'beginning' }); const result = await call(f,'run');
  assert.equal(result.status,'progress'); assert.equal(result.hasPending,false); assert.equal(result.savedParts,0); assert.equal(result.skippedParts,1);
  assert.equal(readRaw(f).memories,1); assert.equal(readRaw(f).text,''); assert.equal(f.cursor().offset,statSync(f.sourcePath).size);
  const db = new DatabaseSync(f.databasePath,{ readOnly:true });
  try { const skipped = db.prepare('SELECT saved,reason,sealed FROM raw_parts').all(); assert.equal(skipped.length,1);
    assert.equal(skipped[0].saved,0); assert.equal(skipped[0].reason,'quota_reached'); assert.equal(skipped[0].sealed,null); }
  finally { db.close(); }
});
test('B4b known no-PID failure reports blocked unavailable but retains a bounded recoverable pending event',{ timeout:30000 },async t => {
  const f = workerFixture(t); await call(f,'initialize',{ start:'beginning' }); f.providerMode('memory');
  const unavailable = await call(f,'run',{ unavailable:true }); assert.equal(unavailable.status,'blocked'); assert.equal(unavailable.reason,'unavailable');
  const pending = f.cursor().pending; assert.equal(pending.state,'unavailable'); assert.equal(pending.attempts,1);
  assert.equal(pending.nextEligibleAt,null); assert.equal(f.calls().length,0); assert.equal(f.ledger(),null);
  const recovered = await call(f,'run'); assert.equal(recovered.status,'progress'); assert.equal(recovered.dispatchedParts,1);
  assert.equal(recovered.hasPending,false); assert.equal(readRaw(f).memories,1);
});
test('B4b cancellation remains visibly cancelled while preserving uncertain pending after actual dispatch',{ timeout:10000 },async t => {
  const f = workerFixture(t), worker = createLocalRawWorker({ ...f.options,nodeExecutable:f.executable,env:{ CAIRN_SYNTHETIC_API_KEY:'synthetic_key_secret' } });
  await worker.initialize({ ...f.context,start:'beginning' }); f.providerMode('hang');
  const controller = new AbortController(), pending = worker.run(f.context,{ signal:controller.signal });
  try {
    for (let attempt = 0; attempt < 300 && f.calls().length < 2; attempt++) await delay(10);
    assert.equal(f.calls().length,2); controller.abort();
    const result = await pending; assert.equal(result.reason,'cancelled'); assert.equal(result.status,'waiting');
    assert.equal(result.completedParts,0); assert.equal(f.cursor().pending.state,'uncertain'); assert.equal(f.cursor().pending.attempts,1);
  } finally { controller.abort(); await pending; }
});
for (const phase of ['prepared','completed']) test(`B4b ${phase} cursor publication fault never overwrites a possibly published state`,{ timeout:10000 },async t => {
  const f = workerFixture(t), worker = createLocalRawWorker({ ...f.options,nodeExecutable:f.executable,env:{ CAIRN_SYNTHETIC_API_KEY:'synthetic_key_secret' } });
  await worker.initialize({ ...f.context,start:'beginning' }); f.providerMode('memory');
  let published, writesAfterFault = 0;
  const result = await withWriteObserver(({ path }) => {
    if (path !== f.cursorPath()) return;
    if (published) { writesAfterFault++; return; }
    const disk = f.cursor();
    if (phase === 'prepared' ? disk.pending?.attempts === 0 : disk.offset === statSync(f.sourcePath).size) {
      published = readFileSync(path,'utf8'); throw new Error('synthetic_after_publication');
    }
  },() => worker.run(f.context));
  assert.ok(published); assert.equal(writesAfterFault,0); assert.equal(readFileSync(f.cursorPath(),'utf8'),published);
  assert.equal(result.status,'blocked'); assert.equal(result.reason,'state_invalid');
  const disk = f.cursor(); assert.equal(disk.issuedOrdinal,1);
  if (phase === 'prepared') { assert.equal(disk.offset,0); assert.equal(disk.pending.attempts,0); assert.equal(disk.pending.state,'prepared'); assert.equal(f.calls().length,0); }
  else { assert.equal(disk.pending,null); assert.equal(disk.offset,statSync(f.sourcePath).size); assert.equal(readRaw(f).memories,1); }
});
test('B4b source refusal keeps a zero-attempt prepared pending valid and visibly blocked',{ timeout:10000 },async t => {
  const f = workerFixture(t), worker = createLocalRawWorker({ ...f.options,nodeExecutable:f.executable,env:{ CAIRN_SYNTHETIC_API_KEY:'synthetic_key_secret' } });
  await worker.initialize({ ...f.context,start:'beginning' }); const controller = new AbortController();
  await withWriteObserver(({ path }) => { if (path === f.cursorPath() && f.cursor().pending?.attempts === 0) controller.abort(); },
    () => worker.run(f.context,{ signal:controller.signal }));
  assert.equal(f.cursor().pending.attempts,0); const original = f.cursor().pending.projection.eventId;
  writeFileSync(f.sourcePath,readFileSync(f.sourcePath,'utf8').replace('synthetic_source_secret','synthetic_source_secreT'));
  const result = await worker.run(f.context); assert.equal(result.status,'blocked'); assert.equal(result.reason,'source_changed');
  assert.equal(f.cursor().blockedReason,'source_changed'); assert.equal(f.cursor().pending.attempts,0);
  assert.equal(f.cursor().pending.state,'prepared'); assert.equal(f.cursor().pending.projection.eventId,original); assert.equal(f.calls().length,0);
  assert.equal((await worker.initialize(f.context)).status,'blocked');
});
for (const scope of ['root','session']) test(`B4b cancellation during actual held ${scope} lock remains visible instead of busy`,{ timeout:5000 },async t => {
  const f = workerFixture(t), worker = createLocalRawWorker(f.options); await worker.initialize({ ...f.context,start:'beginning' });
  const before = readFileSync(f.cursorPath(),'utf8'), path = scope === 'root' ? join(f.stateRoot,'.root.lock') : f.cursorPath().replace(/\.json$/,'.lock');
  let entered, release; const ready = new Promise(resolve => { entered = resolve; }), hold = new Promise(resolve => { release = resolve; });
  const holding = stateLock(path,async () => { entered(); await hold; }); await ready;
  const controller = new AbortController();
  try {
    const running = worker.run(f.context,{ signal:controller.signal }); await delay(30); controller.abort(); const result = await running;
    assert.equal(result.reason,'cancelled'); assert.equal(result.status,'blocked'); assert.equal(result.dispatchedParts,0);
    assert.equal(readFileSync(f.cursorPath(),'utf8'),before);
  } finally { release(); await holding; }
});

for (const client of ['claude-code','codex']) test(`Raw-only ${client} real transport advances multiple multipart turns with a key and no provider`,{timeout:60000},async t => {
  const texts = ['copper '.repeat(1500),'silver '.repeat(1300),'gold '.repeat(1700)];
  const rows = texts.map((text,index) => {
    const row = client === 'codex' ? codex(text) : claude(text);
    if (client === 'codex') { row.payload.turn_id = 'turn-'+index; row.payload.item.id = 'message-'+index; }
    else row.uuid = 'message-'+index;
    return row;
  });
  const f = workerFixture(t,{client,rows}); f.config.interpretation = 'raw-only'; f.config.usage.dailyCap = 1; f.save();
  f.providerMode('provider-error');
  await initializeSelectedRows(f);
  const result = await call(f,'run',{key:true});
  assert.equal(result.status,'progress'); assert.equal(result.hasPending,false); assert.ok(result.completedParts>3);
  assert.equal(f.cursor().offset,statSync(f.sourcePath).size); assert.equal(f.cursor().issuedOrdinal,3);
  assert.equal(readRaw(f).memories,0); assert.equal(readRaw(f).text,texts.join(''));
  assert.equal(f.calls().length,0); assert.equal(f.ledger(),null);
  assert.equal((await call(f,'run',{key:false})).status,'ready');
});

test('bounded UUID backfill keeps a native worker part retryable until all hashes commit',async t=>{
  const f=await lazyFixture(t,'claude-code');await f.hook();f.append('copper source');await f.hook('Stop');
  const {openMemoryCore}=await import('../../../core/index.mjs'),core=openMemoryCore({path:f.request.databasePath,raw:true,rawSearch:false});t.after(()=>core.close());
  const db=new DatabaseSync(f.request.databasePath);t.after(()=>db.close());
  const row=db.prepare('SELECT * FROM raw_messages').get(),columns=Object.keys(row);
  const insert=db.prepare('INSERT INTO raw_messages('+columns.join(',')+') VALUES('+columns.map(()=>'?').join(',')+')');
  db.exec('BEGIN IMMEDIATE');for(let index=2;index<=300;index++)insert.run(...columns.map(key=>key==='message_id'?'synthetic-long-'+index:key==='ordinal'?index:row[key]));db.exec('COMMIT');
  const namespace=f.request.namespace,memory=core.admit({namespace,memory:{content:'Synthetic hidden fact',kind:'fact'},receipts:[{client:'claude-code',sessionId:'explicit-tool',eventId:'backfill-memory',role:'user',excerpt:'Synthetic hidden fact'}]}).value.memory;
  assert.equal(core.forget({namespace,memoryId:memory.id,expectedRevision:memory.revision}).ok,true);
  const path=join(f.request.sourceRoot,'control.jsonl'),changes={transcript_path:path,session_id:'22222222-2222-4222-8222-222222222222'};
  writeFileSync(path,'',{mode:0o600});assert.equal((await f.hook('SessionStart',changes)).status,'ready');
  f.append('copper unrelated after backfill',{path,at:new Date(Date.now()-172800000).toISOString()});
  for(const expected of [128,256]) {
    assert.equal((await f.hook('Stop',changes)).status,'waiting');
    assert.equal(db.prepare('SELECT count(*) n FROM local_raw_uuid_fences').get().n,expected);
    const {readdirSync}=await import('node:fs');
    const cursors=readdirSync(f.directory).filter(name=>/^[a-f0-9]{64}\.json$/.test(name)).map(name=>JSON.parse(readFileSync(join(f.directory,name))));
    const cursor=cursors.find(value=>value.pending!==null);assert.equal(cursor.blockedReason,null);assert.equal(cursor.pending.state,'prepared');assert.equal(cursor.pending.attempts,0);
  }
  assert.equal((await f.hook('Stop',changes)).status,'progress');assert.equal(db.prepare('SELECT count(*) n FROM local_raw_uuid_fences').get().n,300);
  assert.equal(db.prepare('SELECT count(*) n FROM raw_parts WHERE saved=1').get().n,2);
  assert.equal((await f.hook('Stop')).status,'blocked');
});
