import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { appendFileSync, readFileSync, readdirSync, writeFileSync, renameSync, unlinkSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { hostFixture } from './fixtures/local-host-workspace.mjs';
import { createLocalRawWorker } from '../raw/local-worker.mjs';
import { withWriteObserver } from '../private-state.mjs';
import { runLocalHostCli } from '../raw/local-host-cli.mjs';
import { FORMAT } from '../../codex/parser.mjs';
import { claude, codex, sessionId } from './fixtures/raw-fixtures.mjs';
import { lazyFixture } from './fixtures/local-setup-workspace.mjs';
import { stateLock } from '../state-lock.mjs';
import promises from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { spawnSync } from 'node:child_process';

for (const client of ['claude-code','codex']) test(`lazy ${client} legacy rearm_required with history completes by activate, not a new explicit action`,async t => {
  const f = await lazyFixture(t,client); await f.hook(); f.append('Synthetic legacy captured'); await f.hook('Stop');
  await f.invoke('disable'); f.append('Synthetic legacy off');
  const current = f.control(); assert.equal(f.core.setLocalCaptureControl({namespace:f.request.namespace,client,targetId:current.targetId,
    expectedStoreId:current.storeId,expectedRevision:current.revision,automaticCaptureEnabled:true,rawNoticeVersion:current.rawNoticeVersion}).ok,true);
  const path = join(f.request.installationDirectory,'installation.json'),record = JSON.parse(readFileSync(path));
  writeFileSync(path,JSON.stringify({...record,phase:'rearm_required'}));
  const { createLocalRawHost } = await import('../raw/local-host.mjs');
  const host = createLocalRawHost({profilePath:join(f.request.installationDirectory,'host-profile.json')});
  const before = readFileSync(f.cursorPath());
  assert.equal((await f.scoped(()=>host.rearm({sessionId,sourcePath:f.sourcePath,expectedRevision:0,actionId:randomUUID()}))).reason,'rearm_refused');
  assert.deepEqual(readFileSync(f.cursorPath()),before);
  assert.equal((await f.invoke('activate')).status,'active'); assert.equal((await f.hook('Stop')).status,'ready');
  assert.equal(f.cursor().issuedOrdinal,1); assert.equal(f.cursor().offset,statSync(f.sourcePath).size);
});

for (const client of ['claude-code','codex']) test(`lazy ${client} source reads are bounded anchors/header, never an off-period scan`,async t => {
  const f = await lazyFixture(t,client); await f.hook(); const oldEOF = statSync(f.sourcePath).size;
  await f.invoke('disable'); f.append('Synthetic paused '+ 'x'.repeat(200000)); await f.invoke('activate');
  const source = statSync(f.sourcePath),eof = source.size,open = promises.open,reads = [];
  try {
    promises.open = async (...args) => {
      const handle = await open(...args),info = await handle.stat();
      if (info.dev === source.dev && info.ino === source.ino) {
        const read = handle.read.bind(handle);
        handle.read = async (buffer,offset,length,position) => { reads.push({start:position,end:position+length}); return read(buffer,offset,length,position); };
      }
      return handle;
    }; syncBuiltinESMExports();
    assert.equal((await f.hook('Stop')).status,'ready');
  } finally { promises.open = open; syncBuiltinESMExports(); }
  assert.ok(reads.length>0);
  for (const {start,end} of reads) assert.ok(end <= Math.max(oldEOF,client === 'codex' ? 4096:0) || start >= eof-4096,
    `unexpected off-period read [${start},${end})`);
  assert.equal(f.cursor().offset,eof); assert.equal(f.cursor().issuedOrdinal,0);
});

for (const client of ['claude-code','codex']) test(`lazy ${client} predecessor history stays bounded and discarded authority refuses`,async t => {
  const f = await lazyFixture(t,client); await f.hook(); await f.invoke('disable'); await f.invoke('activate');
  const path = join(f.request.installationDirectory,'host-profile.json.activation.json'),record = JSON.parse(readFileSync(path));
  const oldest = record.predecessors[0];
  record.predecessors = [oldest,...Array.from({length:63},(_,index)=>({...oldest,expectedControlRevision:100+index}))];
  writeFileSync(path,JSON.stringify(record));
  await f.invoke('disable'); assert.equal((await f.invoke('activate')).status,'active');
  const after = JSON.parse(readFileSync(path)); assert.equal(after.predecessors.length,64);
  assert.ok(!after.predecessors.some(authority=>JSON.stringify(authority)===JSON.stringify(oldest)));
  const cursor = readFileSync(f.cursorPath()); assert.equal((await f.hook('Stop')).status,'blocked'); assert.deepEqual(readFileSync(f.cursorPath()),cursor);
});

for (const client of ['claude-code','codex']) for (const stage of ['pending','cursor','committed'])
test(`lazy ${client} actual SIGKILL after ${stage} recovers the same boundary`,async t => {
  const f = await lazyFixture(t,client); await f.hook(); await f.invoke('disable'); f.append('Synthetic off'); await f.invoke('activate');
  const path = f.cursorPath(),key = readFileSync(join(f.request.installationDirectory,'identity.key')),eof = statSync(f.sourcePath).size;
  const settings = join(f.root,'lazy-crash.json'); writeFileSync(settings,JSON.stringify({request:f.request,sourcePath:f.sourcePath,cursorPath:path,stage}),{mode:0o600});
  const script = `import{readFileSync}from'node:fs';const s=JSON.parse(readFileSync(process.argv[1]));
const{withWriteObserver}=await import(${JSON.stringify(fileURLToPath(new URL('../private-state.mjs',import.meta.url)))});
const{withLocalHostDependencies}=await import(${JSON.stringify(fileURLToPath(new URL('../raw/local-host.mjs',import.meta.url)))});
const{runLocalRawHook}=await import(${JSON.stringify(fileURLToPath(new URL('../raw/local-hook.mjs',import.meta.url)))});
const{binaryIdentity}=await import(${JSON.stringify(fileURLToPath(new URL('../../codex/qualification.mjs',import.meta.url)))});
const binary=s.request.installationDirectory.replace(/installation$/,'codex');
await withLocalHostDependencies({detectHost:async()=>({binaryPath:binary,identity:await binaryIdentity(binary),kind:'cli'})},()=>
withWriteObserver(({path})=>{if(path!==s.cursorPath&&path!==s.cursorPath.replace(/\\.json$/,'.rearm.json'))return;
const stage=path===s.cursorPath?'cursor':JSON.parse(readFileSync(path)).phase;if(stage===s.stage)process.kill(process.pid,'SIGKILL')},()=>
runLocalRawHook({installationDirectory:s.request.installationDirectory,event:'Stop',payload:{hook_event_name:'Stop',session_id:${JSON.stringify(sessionId)},transcript_path:s.sourcePath}})));
throw Error('synthetic lazy crash not reached');`;
  const result = spawnSync(process.execPath,['--input-type=module','-e',script,settings],{encoding:'utf8',timeout:15000,
    env:{PATH:'/usr/bin:/bin',HOME:join(f.request.installationDirectory,'home'),TMPDIR:f.root,NODE_NO_WARNINGS:'1',NODE_DISABLE_COMPILE_CACHE:'1'}});
  assert.equal(result.error,undefined); assert.equal(result.status,null,result.stderr); assert.equal(result.signal,'SIGKILL');
  f.append('Synthetic after actual crash'); const resumed = await f.hook('Stop'); assert.ok(['ready','progress'].includes(resumed.status));
  const receipt = JSON.parse(readFileSync(path.replace(/\.json$/,'.rearm.json')));
  assert.equal(receipt.phase,'committed'); assert.equal(receipt.revision,1); assert.equal(receipt.replacementCursor.offset,eof);
  assert.deepEqual(readFileSync(join(f.request.installationDirectory,'identity.key')),key);
  t.diagnostic(JSON.stringify({client,stage,status:result.status,signal:result.signal}));
});

for (const client of ['claude-code','codex']) for (const stage of ['pending','cursor','committed'])
test(`lazy ${client} failure before ${stage} rename leaves a retryable old or frozen state`,async t => {
  const f = await lazyFixture(t,client); await f.hook(); await f.invoke('disable'); f.append('Synthetic off'); await f.invoke('activate');
  const cursorPath = f.cursorPath(),receiptPath = cursorPath.replace(/\.json$/,'.rearm.json'),before = f.cursor(),eof = statSync(f.sourcePath).size;
  const rename = promises.rename; let fired = false;
  try {
    promises.rename = async (from,to) => {
      if (!fired && (stage === 'cursor' ? to === cursorPath : to === receiptPath && JSON.parse(readFileSync(from)).phase === stage)) {
        fired = true; throw Error('synthetic failure before lazy rename');
      }
      return rename(from,to);
    }; syncBuiltinESMExports();
    assert.equal((await f.hook('Stop')).status,'blocked'); assert.equal(fired,true);
  } finally { promises.rename = rename; syncBuiltinESMExports(); }
  f.append('Synthetic appended after interruption');
  assert.equal((await f.hook('Stop')).status,'ready');
  const receipt = JSON.parse(readFileSync(receiptPath)); assert.equal(receipt.phase,'committed'); assert.equal(receipt.revision,1);
  assert.equal(receipt.replacementCursor.offset,stage === 'pending' ? statSync(f.sourcePath).size:eof);
  assert.equal(f.cursor().issuedOrdinal,before.issuedOrdinal);
  f.append('Synthetic later capture'); assert.equal((await f.hook('Stop')).status,'progress');
  assert.equal(JSON.parse(readFileSync(receiptPath)).revision,1);
});

for (const client of ['claude-code','codex']) test(`lazy ${client} pending receipt blocks direct workers; a later fence prevents completing the cursor`,async t => {
  const f = await lazyFixture(t,client); await f.hook(); await f.invoke('disable'); f.append('Synthetic off'); await f.invoke('activate');
  const path = f.cursorPath(),receiptPath = path.replace(/\.json$/,'.rearm.json'); let fired = false;
  await withWriteObserver(({path:written}) => { if (!fired && written === path) { fired = true; throw Error('synthetic cursor cut'); } },()=>f.hook('Stop'));
  assert.equal(fired,true); assert.equal(JSON.parse(readFileSync(receiptPath)).phase,'pending');
  const configPath = join(f.request.installationDirectory,'capture.json'),config = JSON.parse(readFileSync(configPath));
  const direct = createLocalRawWorker({stateRoot:join(f.request.installationDirectory,'state'),identityKeyPath:join(f.request.installationDirectory,'identity.key'),
    nodeExecutable:process.execPath,runtimeRoot:root,configPath,expectedAuthority:config.authority,home:join(f.request.installationDirectory,'home'),env:{}});
  const result = await direct.run({sessionId,sourcePath:f.sourcePath,pluginRoot:client === 'claude-code' ? f.request.installation.pluginRoot:null,
    formatAuthority:client === 'codex' ? {format:FORMAT,sessionId,creatorVersion:'0.162.0',qualifiedCreatorVersion:'0.162.0'}:null});
  assert.equal(result.reason,'state_invalid');
  const {ok} = await import('./fixtures/local-setup-workspace.mjs');
  ok(f.core.fenceSession({namespace:f.request.namespace,client,sessionId:f.cursor().wireSessionId}));
  const cursorBytes = readFileSync(path),receiptBytes = readFileSync(receiptPath);
  assert.equal((await f.hook('Stop')).status,'blocked'); assert.deepEqual(readFileSync(path),cursorBytes); assert.deepEqual(readFileSync(receiptPath),receiptBytes);
});

for (const client of ['claude-code','codex']) for (const stage of ['pending','cursor','committed'])
test(`lazy ${client} durable ${stage} crash retries its one frozen boundary and receipt`,async t => {
  const f = await lazyFixture(t,client); await f.hook();
  f.append('Synthetic captured prefix'); assert.equal((await f.hook('Stop')).status,'progress');
  const before = f.cursor(),key = readFileSync(join(f.request.installationDirectory,'identity.key'));
  await f.invoke('disable'); f.append('Synthetic paused content'); await f.invoke('activate');
  const frozenEOF = statSync(f.sourcePath).size,path = f.cursorPath(),receiptPath = path.replace(/\.json$/,'.rearm.json'); let fired = false;
  const failed = await withWriteObserver(({path:written}) => {
    if (fired || ![path,receiptPath].includes(written)) return;
    const record = JSON.parse(readFileSync(written));
    if (stage === 'cursor' ? written === path : written === receiptPath && record.phase === stage) {
      fired = true; throw Error('synthetic lazy durable write ambiguity');
    }
  },() => f.hook('Stop'));
  assert.equal(fired,true); assert.equal(failed.status,'blocked');
  const receipt = JSON.parse(readFileSync(receiptPath)); assert.equal(receipt.replacementCursor.offset,frozenEOF);
  f.append('Synthetic append after crash');
  const resumed = await f.hook('Stop'); assert.ok(['ready','progress'].includes(resumed.status),JSON.stringify(resumed));
  const committed = JSON.parse(readFileSync(receiptPath)); assert.equal(committed.phase,'committed');
  assert.equal(committed.actionId,receipt.actionId); assert.equal(committed.revision,1);
  assert.equal(committed.replacementCursor.offset,frozenEOF); assert.equal(committed.replacementCursor.issuedOrdinal,before.issuedOrdinal);
  await f.hook('Stop'); const progressed = readFileSync(path);
  await f.hook('Stop'); assert.deepEqual(readFileSync(path),progressed);
  assert.equal(f.cursor().issuedOrdinal,before.issuedOrdinal+1);
  assert.equal(f.cursor().sessionKey,before.sessionKey); assert.deepEqual(readFileSync(join(f.request.installationDirectory,'identity.key')),key);
  const db = new DatabaseSync(f.request.databasePath,{readOnly:true});
  try {
    const text = db.prepare('SELECT sealed FROM raw_parts WHERE saved=1 ORDER BY rowid').all().map(row=>Buffer.from(row.sealed).toString()).join('');
    assert.equal(text,'Synthetic captured prefixSynthetic append after crash'); assert.equal(db.prepare('SELECT count(*) n FROM raw_messages').get().n,2);
  } finally { db.close(); }
});

for (const client of ['claude-code','codex']) test(`lazy ${client} known bounded predecessors survive several off/on cycles and hold the session lock`,async t => {
  const f = await lazyFixture(t,client); await f.hook(); const before = f.cursor();
  for (let i=0;i<3;i++) { await f.invoke('disable'); f.append('Synthetic off '+i); assert.equal((await f.setup()).status,'active'); }
  await stateLock(f.cursorPath().replace(/\.json$/,'.lock'),async () => assert.equal((await f.hook('Stop')).status,'busy'));
  assert.equal((await f.hook('Stop')).status,'ready'); assert.equal(f.cursor().sessionKey,before.sessionKey);
  assert.equal(f.cursor().issuedOrdinal,0); assert.equal(f.cursor().offset,statSync(f.sourcePath).size);
  const profilePath = join(f.request.installationDirectory,'host-profile.json');
  const { createLocalRawHost } = await import('../raw/local-host.mjs');
  assert.equal((await createLocalRawHost({profilePath}).rearm({sessionId,sourcePath:f.sourcePath,expectedRevision:0,actionId:randomUUID()})).reason,'rearm_refused');
});

for (const client of ['claude-code','codex']) for (const damage of ['partial','unknown','pending','deleted'])
test(`lazy ${client} ${damage} boundary refuses without sending content or rewriting its cursor`,async t => {
  const f = await lazyFixture(t,client); await f.hook();
  await f.invoke('disable'); f.append('Synthetic paused'); await f.invoke('activate');
  if (damage === 'partial') appendFileSync(f.sourcePath,'{"incomplete":');
  if (damage === 'unknown') { const cursor = f.cursor(); cursor.authorityCommitment = 'a'.repeat(64); writeFileSync(f.cursorPath(),JSON.stringify(cursor)); }
  if (damage === 'pending') {
    // A structurally valid pending cursor with no authoritative SQL high-water
    // remains a refusal; lazy rearm never reads its projected content.
    const cursor = f.cursor(); cursor.issuedOrdinal = 1;
    cursor.pending = {projection:{version:1,profile:'raw-producer-v1',client,wireSessionId:cursor.wireSessionId,generation:'initial',epoch:0,
      range:{start:cursor.offset,end:statSync(f.sourcePath).size},messageOrdinal:1,role:'user',sourceIdentity:'b'.repeat(64),contentIdentity:'c'.repeat(64),
      totalUnits:10,totalBytes:10,part:{index:1,start:1,end:10},eventId:'d'.repeat(64)},attempts:0,nextEligibleAt:null,lastAttemptAt:null,state:'prepared'};
    writeFileSync(f.cursorPath(),JSON.stringify(cursor));
  }
  if (damage === 'deleted') {
    const {ok} = await import('./fixtures/local-setup-workspace.mjs');
    ok(f.core.fenceSession({namespace:f.request.namespace,client,sessionId:f.cursor().wireSessionId}));
  }
  const before = readFileSync(f.cursorPath()); assert.equal((await f.hook('Stop')).status,'blocked');
  assert.deepEqual(readFileSync(f.cursorPath()),before);
  const db = new DatabaseSync(f.request.databasePath,{readOnly:true});
  try { assert.equal(db.prepare('SELECT count(*) n FROM raw_parts').get().n,0); } finally { db.close(); }
});

const root = resolve(fileURLToPath(new URL('../../../',import.meta.url)));
const ok = result => { assert.equal(result.ok,true,JSON.stringify(result)); return result.value; };
function rotate(f) {
  f.disable(); const current = ok(f.core.getLocalCaptureControl({ namespace:f.namespace,client:f.client }));
  return ok(f.core.setLocalCaptureControl({ namespace:f.namespace,client:f.client,targetId:current.targetId,
    expectedStoreId:current.storeId,expectedRevision:current.revision,automaticCaptureEnabled:true,rawNoticeVersion:current.rawNoticeVersion }));
}
const cursorPath = f => join(f.stateRoot,'sessions',readdirSync(join(f.stateRoot,'sessions')).find(name => /^[a-f0-9]{64}\.json$/.test(name)));
const cursor = f => JSON.parse(readFileSync(cursorPath(f),'utf8'));
const request = (f,expectedRevision = 0) => ({ expectedRevision,actionId:randomUUID(),...f.selection });
function append(f,text = 'Synthetic later source',id = randomUUID()) {
  const row = f.client === 'codex' ? codex(text):{ ...claude(text),uuid:id };
  appendFileSync(f.sourcePath,JSON.stringify(row)+'\n');
}
function worker(f,{ old = false } = {}) {
  const node = join(f.workspace.path,'synthetic-worker-node.mjs');
  writeFileSync(node,`#!${process.execPath}
import{spawn}from'node:child_process';
if(process.argv[2]==='--version')process.stdout.write(process.version+'\\n');else{
const child=spawn(${JSON.stringify(process.execPath)},['--import',${JSON.stringify(join(root,'adapters/local/test/fixtures/http.mjs'))},...process.argv.slice(2)],{shell:false,stdio:'inherit',env:{...process.env,SYNTHETIC_MODE:'empty',SYNTHETIC_TRACE:${JSON.stringify(f.trace)},SYNTHETIC_CONFIG:${JSON.stringify(f.configPath)},SYNTHETIC_CORE:${JSON.stringify(join(root,'core/index.mjs'))}}});
for(const s of['SIGTERM','SIGINT'])process.on(s,()=>child.kill(s));child.once('error',()=>{process.exitCode=1});child.once('close',c=>{process.exitCode=c??1})}
`,{ mode:0o700 });
  const authority = old ? f.config.authority:JSON.parse(readFileSync(f.configPath)).authority;
  const instance = createLocalRawWorker({ stateRoot:f.stateRoot,identityKeyPath:f.identityKeyPath,nodeExecutable:node,runtimeRoot:root,
    configPath:f.configPath,expectedAuthority:authority,home:f.profile.home,env:{ CAIRN_SYNTHETIC_API_KEY:'synthetic_key_secret' } });
  const context = { ...f.selection,pluginRoot:f.client === 'claude-code' ? f.pluginRoot:null,
    formatAuthority:f.client === 'codex' ? { format:FORMAT,sessionId:f.selection.sessionId,creatorVersion:'0.162.0',qualifiedCreatorVersion:'0.162.0' }:null };
  return { run:() => instance.run(context),initialize:start => instance.initialize({ ...context,start }) };
}
async function prepared(t,client = 'claude-code',start = 'eof') {
  const f = await hostFixture(t,{ client });
  assert.equal((await f.call('prepare')).status,'ready');
  assert.equal((await f.call('initialize',{ ...f.selection,start })).status,'ready'); return f;
}
function sql(f,work) { const db = new DatabaseSync(f.databasePath); try { return work(db); } finally { db.close(); } }

for (const client of ['claude-code','codex']) test(`RR02/05 ${client}: clean rearm skips frozen EOF and replay never rewinds actual later capture`,async t => {
  const f = await prepared(t,client), before = cursor(f), key = readFileSync(f.identityKeyPath), initial = await f.host.rearmStatus();
  assert.deepEqual(initial,{ version:'local-raw-rearm-status-v1',status:'ready',reason:null,revision:0,pending:false });
  rotate(f); append(f,'Synthetic paused source'); const input = request(f);
  const result = await f.call('rearm',input); assert.equal(result.status,'ready',JSON.stringify(result)); assert.equal(result.reason,'rearmed');
  assert.equal(result.revision,1); assert.equal(result.pending,false); assert.deepEqual(readFileSync(f.identityKeyPath),key);
  const adopted = cursor(f); assert.equal(adopted.issuedOrdinal,before.issuedOrdinal); assert.equal(adopted.wireSessionId,before.wireSessionId);
  assert.equal(adopted.offset,statSync(f.sourcePath).size); assert.equal(adopted.rearmRevision,1); assert.equal(f.calls().length,0); assert.equal(f.ledger(),null);
  append(f); const later = await worker(f).run(); assert.equal(later.completedRecords,1,JSON.stringify(later));
  assert.equal(later.completedParts,1); assert.equal(cursor(f).issuedOrdinal,1); assert.ok(f.calls().length > 0);
  const after = readFileSync(cursorPath(f)), calls = f.calls().length; let writes = 0;
  append(f,'Still later and not skipped by replay');
  const replay = await withWriteObserver(({ path }) => { if (path === cursorPath(f)) writes++; },() => f.call('rearm',input));
  assert.equal(replay.reason,'replayed',JSON.stringify(replay)); assert.equal(replay.revision,1); assert.equal(writes,0);
  assert.deepEqual(readFileSync(cursorPath(f)),after); assert.equal(f.calls().length,calls);
  assert.equal((await f.host.rearmStatus()).revision,1);
  const recordText = readFileSync(f.profilePath+'.rearm.json','utf8');
  for (const forbidden of [f.selection.sessionId,f.sourcePath,'Synthetic paused source','synthetic_key_secret']) assert.equal(recordText.includes(forbidden),false);
  assert.ok(Buffer.byteLength(recordText) < 65536);
});

for (const eligible of [true,false]) test(`RR03 closed continuation proves ${eligible ? 'completed interpretation':'no-eligible first part'}`,async t => {
  const f = await prepared(t,'claude-code','beginning');
  f.saveSource(); writeFileSync(f.sourcePath,JSON.stringify({ ...claude((eligible ? 'a':' ').repeat(4000)+'tail'),uuid:'synthetic-long-message' })+'\n');
  let stopped = false;
  const first = await withWriteObserver(({ path }) => {
    if (path === cursorPath(f) && cursor(f).pending?.projection.part.index === 1 && !stopped) { stopped = true; throw Error('synthetic post-publication failure'); }
  },() => worker(f).run());
  assert.equal(stopped,true); assert.equal(first.status,'blocked'); assert.equal(cursor(f).pending.projection.part.index,1);
  sql(f,db => { assert.equal(db.prepare('SELECT count(*) n FROM admission_claims WHERE state=\'completed\'').get().n,eligible ? 1:0); });
  rotate(f); const input = request(f), result = await f.call('rearm',input);
  assert.equal(result.reason,'rearmed',JSON.stringify(result)); assert.equal(cursor(f).pending,null); assert.equal(cursor(f).issuedOrdinal,1);
  sql(f,db => { const message = db.prepare('SELECT * FROM raw_messages').get(); assert.equal(message.reason,'capture_barrier'); assert.equal(message.reserved_bytes,0); assert.equal(message.next_index,1); });
  rotate(f); const repeated = await f.call('rearm',request(f,1));
  assert.equal(repeated.reason,'rearmed',JSON.stringify(repeated)); assert.equal(cursor(f).issuedOrdinal,1);
});

test('RR01 closed inputs/CLI and unchanged authority refuse without source or state mutation',async t => {
  const f = await prepared(t), before = readFileSync(cursorPath(f));
  assert.equal((await f.call('rearm',request(f))).reason,'rearm_refused');
  let invoked = 0; const invalid = request(f); Object.defineProperty(invalid,'actionId',{ get() { invoked++; throw Error(); } });
  assert.equal((await f.call('rearm',invalid)).reason,'invalid_input'); assert.equal(invoked,0);
  for (const revision of ['00','+1','-1','9007199254740992']) {
    const result = await runLocalHostCli(['--profile',f.profilePath,'rearm','--expected-revision',revision,'--action-id',randomUUID(),'--session',f.selection.sessionId,'--source',f.sourcePath]);
    assert.equal(result.exitCode,2); assert.equal(result.result.version,'local-raw-rearm-result-v1'); assert.equal(result.result.reason,'invalid_input');
  }
  assert.deepEqual(readFileSync(cursorPath(f)),before); assert.equal(f.calls().length,0);
});

for (const change of ['ordinal','deleted','partial','replacement','first-ids','binding','first-event','consent','projection','assembly','result']) test(`RR04/08 ${change} refuses`,async t => {
  const f = await prepared(t,'claude-code','beginning');
  assert.equal((await worker(f).run()).completedRecords,1); rotate(f);
  if (change === 'ordinal') { const value = cursor(f); value.issuedOrdinal++; writeFileSync(cursorPath(f),JSON.stringify(value)); }
  if (change === 'deleted') sql(f,db => { const row = db.prepare('SELECT * FROM raw_conversations').get(); db.prepare('INSERT INTO raw_session_fences VALUES(?,?,?,?,?)').run(row.owner_id,row.scope,row.project_id,row.client,row.session_key); });
  if (change === 'partial') appendFileSync(f.sourcePath,'{');
  if (change === 'replacement') { const bytes = readFileSync(f.sourcePath), old = statSync(f.sourcePath).ino;
    renameSync(f.sourcePath,f.sourcePath+'.original'); writeFileSync(f.sourcePath,bytes,{ mode:0o600 }); assert.notEqual(statSync(f.sourcePath).ino,old); }
  if (change === 'first-ids') sql(f,db => db.prepare('UPDATE raw_capture_events SET first_message_ids=?').run(JSON.stringify({ includes:true })));
  if (change === 'binding') sql(f,db => db.prepare('UPDATE raw_capture_events SET binding_digest=?').run('0'.repeat(64)));
  if (change === 'first-event') sql(f,db => db.prepare('UPDATE raw_messages SET first_event_id=?').run('synthetic-orphan'));
  if (change === 'consent') sql(f,db => db.prepare('UPDATE raw_capture_events SET local_consent_generation=?').run('synthetic-foreign-generation'));
  if (change === 'projection') sql(f,db => db.prepare('UPDATE raw_capture_events SET projection_digest=?').run('0'.repeat(64)));
  if (change === 'assembly') sql(f,db => db.prepare("UPDATE raw_messages SET assembly_state='pending'").run());
  if (change === 'result') sql(f,db => db.prepare('UPDATE raw_events SET result=?').run(JSON.stringify({ conversationId:'synthetic-foreign',revision:1,parts:[] })));
  const before = readFileSync(cursorPath(f)), calls = f.calls().length, result = await f.call('rearm',request(f));
  assert.equal(result.status,'blocked',JSON.stringify(result)); assert.deepEqual(readFileSync(cursorPath(f)),before); assert.equal(f.calls().length,calls);
});

test('RR07 second stale session adopts one predecessor; unrelated config cannot change',async t => {
  const f = await prepared(t), other = { ...f.selection,sessionId:'synthetic-other-session' };
  assert.equal((await f.call('initialize',other)).status,'ready'); rotate(f);
  assert.equal((await f.call('rearm',request(f))).reason,'rearmed');
  const second = { expectedRevision:1,actionId:randomUUID(),...other };
  assert.equal((await f.call('rearm',second)).reason,'rearmed');
  assert.equal((await f.host.rearmStatus()).revision,2);
  const config = JSON.parse(readFileSync(f.configPath)); config.usage.dailyCap++; writeFileSync(f.configPath,JSON.stringify(config));
  assert.equal((await f.call('rearm',{ expectedRevision:2,actionId:randomUUID(),...other })).status,'blocked');
});

test('RR08/09 direct worker rejects legacy downgrade/missing receipt and revoked no-work permission',async t => {
  const f = await prepared(t); rotate(f); const input = request(f); assert.equal((await f.call('rearm',input)).reason,'rearmed');
  const path = cursorPath(f), original = readFileSync(path), value = cursor(f); delete value.rearmRevision; writeFileSync(path,JSON.stringify(value));
  assert.equal((await worker(f).run()).reason,'state_invalid');
  writeFileSync(path,original); const receiptPath = path.replace(/\.json$/,'.rearm.json'), receipt = readFileSync(receiptPath);
  unlinkSync(receiptPath); assert.equal((await worker(f).run()).reason,'state_invalid');
  assert.equal((await f.call('rearm',input)).reason,'rearm_invalid');
  writeFileSync(receiptPath,receipt,{ mode:0o600 });
  f.disable(); const before = readFileSync(path); assert.equal((await worker(f).run()).reason,'authority_changed');
  assert.deepEqual(readFileSync(path),before); assert.equal(f.calls().length,0); assert.equal(f.ledger(),null);
});

for (const state of ['firstpart','incomplete','processing','quota_reached','recovery_exhausted']) test(`RR03 ${state} cannot discard a pending record`,async t => {
  const f = await prepared(t,'claude-code','beginning');
  writeFileSync(f.sourcePath,JSON.stringify({ ...claude('a'.repeat(4001)),uuid:'synthetic-refusal-message' })+'\n'); let stopped = false;
  await withWriteObserver(({ path })=>{ if(path===cursorPath(f)&&cursor(f).pending?.projection.part.index===1&&!stopped){ stopped=true;throw Error('synthetic stop after first part'); } },()=>worker(f).run());
  assert.equal(stopped,true); const value = cursor(f);
  if (state === 'firstpart') value.pending.projection.part = { index:0,start:0,end:4000 };
  if (state === 'incomplete' || state === 'processing') sql(f,db=>db.prepare("UPDATE admission_claims SET state='pending',token=?,lease_expires_at=?,memory_ids=NULL,suppressed_count=NULL")
    .run(randomUUID(),state === 'processing' ? Date.now()+60000:0));
  if (state === 'quota_reached') value.blockedReason = state;
  if (state === 'recovery_exhausted') { value.blockedReason=state; Object.assign(value.pending,{ attempts:4,state:'blocked',lastAttemptAt:Date.now(),nextEligibleAt:Date.now()+280000 }); }
  writeFileSync(cursorPath(f),JSON.stringify(value)); rotate(f);
  const before = readFileSync(cursorPath(f)), calls = f.calls().length, result = await f.call('rearm',request(f));
  assert.equal(result.status,'blocked',JSON.stringify(result)); assert.deepEqual(readFileSync(cursorPath(f)),before); assert.equal(f.calls().length,calls);
});

test('RR07 only one predecessor remains eligible after another authority transition',async t => {
  const f = await prepared(t), other = { ...f.selection,sessionId:'synthetic-two-generations-old' };
  assert.equal((await f.call('initialize',other)).status,'ready'); rotate(f);
  assert.equal((await f.call('rearm',request(f))).reason,'rearmed'); rotate(f);
  assert.equal((await f.call('rearm',request(f,1))).reason,'rearmed');
  assert.equal((await f.call('rearm',{ expectedRevision:2,actionId:randomUUID(),...other })).status,'blocked');
  assert.equal((await f.host.rearmStatus()).revision,2);
});

test('RR08 missing global record cannot reset a selected session rearm history',async t => {
  const f = await prepared(t); rotate(f); assert.equal((await f.call('rearm',request(f))).reason,'rearmed');
  unlinkSync(f.profilePath+'.rearm.json'); rotate(f);
  const before = readFileSync(cursorPath(f)), result = await f.call('rearm',request(f));
  assert.equal(result.reason,'rearm_invalid'); assert.deepEqual(readFileSync(cursorPath(f)),before);
  assert.equal(f.calls().length,0); assert.equal(f.ledger(),null);
});

test('RR08 restoring an older genuine global record cannot reuse a newer selected session revision',async t => {
  const f = await prepared(t), other = { ...f.selection,sessionId:'synthetic-newer-session-revision' };
  assert.equal((await f.call('initialize',other)).status,'ready'); rotate(f);
  assert.equal((await f.call('rearm',request(f))).reason,'rearmed');
  const older = readFileSync(f.profilePath+'.rearm.json');
  assert.equal((await f.call('rearm',{ expectedRevision:1,actionId:randomUUID(),...other })).reason,'rearmed');
  const latest = JSON.parse(readFileSync(f.profilePath+'.rearm.json')), selectedPath = join(f.stateRoot,'sessions',latest.action.sessionKey+'.json');
  const before = readFileSync(selectedPath); writeFileSync(f.profilePath+'.rearm.json',older); rotate(f);
  const result = await f.call('rearm',{ expectedRevision:1,actionId:randomUUID(),...other });
  assert.equal(result.reason,'rearm_invalid'); assert.deepEqual(readFileSync(selectedPath),before);
  assert.deepEqual(readFileSync(f.profilePath+'.rearm.json'),older); assert.equal(f.calls().length,0);
});
