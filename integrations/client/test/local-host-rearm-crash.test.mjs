import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { appendFileSync, readFileSync, readdirSync, writeFileSync, statSync } from 'node:fs';
import fs from 'node:fs';
import promises from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { spawn } from 'node:child_process';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hostFixture } from './fixtures/local-host-workspace.mjs';
import { withWriteObserver } from '../private-state.mjs';
import { createLocalRawWorker } from '../raw/local-worker.mjs';
import { claude } from './fixtures/raw-fixtures.mjs';
import { stateLock } from '../state-lock.mjs';

const root = resolve(fileURLToPath(new URL('../../../',import.meta.url)));
const ok = result => { assert.equal(result.ok,true,JSON.stringify(result)); return result.value; };
const paths = f => ({ global:f.profilePath+'.rearm.json',cursor:join(f.stateRoot,'sessions',readdirSync(join(f.stateRoot,'sessions')).find(name=>/^[a-f0-9]{64}\.json$/.test(name))) });
const cursor = f => JSON.parse(readFileSync(paths(f).cursor));
const request = (f,expectedRevision = 0,selection = f.selection) => ({ expectedRevision,actionId:randomUUID(),...selection });
function rotate(f) {
  f.disable(); const current = ok(f.core.getLocalCaptureControl({ namespace:f.namespace,client:f.client }));
  ok(f.core.setLocalCaptureControl({ namespace:f.namespace,client:f.client,targetId:current.targetId,expectedStoreId:current.storeId,
    expectedRevision:current.revision,automaticCaptureEnabled:true,rawNoticeVersion:current.rawNoticeVersion }));
}
async function fixture(t,{ second = false } = {}) {
  const f = await hostFixture(t);
  assert.equal((await f.call('prepare')).status,'ready'); assert.equal((await f.call('initialize')).status,'ready');
  if (second) assert.equal((await f.call('initialize',{ ...f.selection,sessionId:'synthetic-other-session' })).status,'ready');
  rotate(f); return f;
}
function stageFor(f,path) {
  const record = JSON.parse(readFileSync(path));
  if (path === f.profilePath+'.rearm.json') return record.phase === 'pending' ? 'global-pending':'global-ready';
  if (path.endsWith('.rearm.json')) return record.phase === 'pending' ? 'session-pending':'session-committed';
  if (path === paths(f).cursor) return 'cursor';
  if (path === f.configPath) return 'config';
  if (path === f.profilePath) return 'profile';
  if (path === f.profilePath+'.prepared.json') return 'preparation';
  return null;
}
function direct(f,selection = f.selection) {
  const config = JSON.parse(readFileSync(f.configPath));
  const worker = createLocalRawWorker({ stateRoot:f.stateRoot,identityKeyPath:f.identityKeyPath,nodeExecutable:process.execPath,
    runtimeRoot:root,configPath:f.configPath,expectedAuthority:config.authority,home:f.profile.home,env:{} });
  return worker.run({ ...selection,pluginRoot:f.pluginRoot,formatAuthority:null });
}

for (const stage of ['global-pending','session-pending','cursor','session-committed','config','profile','preparation','global-ready']) {
  test(`RR06 durable ${stage} ambiguity resumes the exact frozen EOF`,async t => {
    const f = await fixture(t), input = request(f), frozenEOF = statSync(f.sourcePath).size; let fired = false;
    const first = await withWriteObserver(({ path }) => {
      if (!fired && stageFor(f,path) === stage) { fired = true; throw Error('synthetic durable publication ambiguity'); }
    },() => f.call('rearm',input));
    assert.equal(fired,true); assert.equal(first.status,'blocked');
    const status = await f.host.rearmStatus(); assert.equal(status.revision,stage === 'global-ready' ? 1:0);
    assert.equal(status.pending,stage !== 'global-ready');
    const durable = JSON.parse(readFileSync(paths(f).global)); assert.equal(durable.action.replacementCursor.offset,frozenEOF);
    appendFileSync(f.sourcePath,JSON.stringify({ ...claude('Synthetic append after interruption'),uuid:randomUUID() })+'\n');
    const resumed = await f.call('rearm',input);
    assert.equal(resumed.reason,'replayed',JSON.stringify(resumed)); assert.equal(resumed.revision,1);
    assert.equal(cursor(f).offset,frozenEOF); assert.equal(cursor(f).issuedOrdinal,0); assert.equal(f.calls().length,0); assert.equal(f.ledger(),null);
    const before = readFileSync(paths(f).cursor); assert.equal((await f.call('rearm',request(f))).reason,'stale_revision');
    assert.deepEqual(readFileSync(paths(f).cursor),before);
  });
}

for (const mechanism of ['rename-after-publication','directory-fsync-after-rename']) test(`RR06 actual ${mechanism} failure is inspected, never rolled back`,async t => {
  const f = await fixture(t), input = request(f); let fired = false;
  const originalRename = promises.rename;
  const handle = await promises.open(f.profilePath,'r'), prototype = Object.getPrototypeOf(handle), originalSync = prototype.sync;
  await handle.close();
  try {
    if (mechanism === 'rename-after-publication') {
      promises.rename = async (...args) => { await originalRename(...args);
        if (!fired && args[1] === paths(f).cursor) { fired = true; throw Error('synthetic rename reported failure after publication'); } };
      syncBuiltinESMExports();
    } else prototype.sync = async function(...args) {
      if (!fired && cursor(f).rearmRevision === 1) { fired = true; throw Error('synthetic directory fsync failure after cursor rename'); }
      return originalSync.apply(this,args);
    };
    const failed = await f.call('rearm',input); assert.equal(fired,true); assert.equal(failed.status,'blocked');
    assert.equal(cursor(f).rearmRevision,1);
  } finally { promises.rename = originalRename; prototype.sync = originalSync; syncBuiltinESMExports(); }
  const resumed = await f.call('rearm',input); assert.equal(resumed.reason,'replayed',JSON.stringify(resumed));
  assert.equal(f.calls().length,0); assert.equal(f.ledger(),null);
});

for (const stage of ['global-pending','session-committed','global-ready']) test(`RR06 actual process SIGKILL at ${stage} resumes without new identity`,async t => {
  const f = await fixture(t), input = request(f), key = readFileSync(f.identityKeyPath);
  const settings = join(f.workspace.path,'crash-settings.json'); writeFileSync(settings,JSON.stringify({ profilePath:f.profilePath,input,stage }),{ mode:0o600 });
  const source = `import{readFileSync}from'node:fs';const s=JSON.parse(readFileSync(process.argv[1]));
const{createLocalRawHost}=await import(${JSON.stringify(fileURLToPath(new URL('../raw/local-host.mjs',import.meta.url)))});
const{withWriteObserver}=await import(${JSON.stringify(fileURLToPath(new URL('../private-state.mjs',import.meta.url)))});
await withWriteObserver(({path})=>{if(!path.endsWith('.rearm.json'))return;const r=JSON.parse(readFileSync(path));
const stage=path===s.profilePath+'.rearm.json'?'global-'+r.phase:'session-'+r.phase;if(stage===s.stage)process.kill(process.pid,'SIGKILL')},()=>createLocalRawHost({profilePath:s.profilePath}).rearm(s.input));throw Error('synthetic crash checkpoint not reached');`;
  const child = spawn(process.execPath,['--input-type=module','-e',source,settings],{ cwd:f.workspace.path,stdio:['ignore','pipe','pipe'],
    env:{ PATH:'/usr/bin:/bin',HOME:f.profile.home,TMPDIR:f.workspace.path,TMP:f.workspace.path,TEMP:f.workspace.path,NODE_NO_WARNINGS:'1',NODE_DISABLE_COMPILE_CACHE:'1' } });
  let stderr = ''; child.stderr.on('data',bytes=>{ stderr += bytes; });
  const done = new Promise((resolve,reject)=>{ child.once('error',reject); child.once('close',(code,signal)=>resolve({ code,signal })); });
  f.workspace.defer(async()=>{ if(child.exitCode===null&&child.signalCode===null)child.kill('SIGTERM');await done; });
  const result = await done; assert.equal(result.code,null,stderr); assert.equal(result.signal,'SIGKILL'); t.diagnostic(JSON.stringify({ stage,...result }));
  const resumed = await f.call('rearm',input); assert.equal(resumed.reason,'replayed',JSON.stringify(resumed));
  assert.deepEqual(readFileSync(f.identityKeyPath),key); assert.equal(f.calls().length,0);
});

test('RR06/07 second stale session pending receipt blocks direct worker before source despite fresh global config',async t => {
  const f = await fixture(t,{ second:true }); assert.equal((await f.call('rearm',request(f))).reason,'rearmed');
  const other = { ...f.selection,sessionId:'synthetic-other-session' }, input = request(f,1,other); let fired = false;
  const failed = await withWriteObserver(({ path }) => {
    if (!fired && path.endsWith('.json') && !path.endsWith('.rearm.json') && !path.endsWith('.claim.json') &&
      path.startsWith(join(f.stateRoot,'sessions')) && JSON.parse(readFileSync(path)).rearmRevision === 2) {
      fired = true; throw Error('synthetic interruption after second cursor publication');
    }
  },() => f.call('rearm',input));
  assert.equal(failed.status,'blocked'); assert.equal(fired,true);
  let reads = 0; globalThis[Symbol.for('cairn.host.observe')] = kind=>{ if(kind==='source')reads++; };
  try { const result = await direct(f,other); assert.equal(result.reason,'state_invalid'); assert.equal(reads,0); }
  finally { delete globalThis[Symbol.for('cairn.host.observe')]; }
  assert.equal((await f.call('run',f.selection)).status,'blocked');
  assert.equal((await f.call('rearm',input)).reason,'replayed');
});

test('RR06 terminal second-session receipt prevents rewind after direct-worker progress while global action is pending',async t => {
  const f = await fixture(t,{ second:true }); assert.equal((await f.call('rearm',request(f))).reason,'rearmed');
  const other = { ...f.selection,sessionId:'synthetic-other-session' }, input = request(f,1,other); let fired = false;
  const failed = await withWriteObserver(({ path }) => {
    if (!fired && path.endsWith('.rearm.json') && path !== paths(f).global) {
      const receipt = JSON.parse(readFileSync(path));
      if (receipt.revision === 2 && receipt.phase === 'committed') { fired = true; throw Error('synthetic terminal publication ambiguity'); }
    }
  },() => f.call('rearm',input));
  assert.equal(fired,true); assert.equal(failed.status,'blocked');
  appendFileSync(f.sourcePath,JSON.stringify({ type:'progress',synthetic:true })+'\n');
  const progressed = await direct(f,other); assert.equal(progressed.completedRecords,1,JSON.stringify(progressed));
  const global = JSON.parse(readFileSync(paths(f).global)), selectedPath = join(f.stateRoot,'sessions',global.action.sessionKey+'.json');
  const after = readFileSync(selectedPath); assert.ok(JSON.parse(after).offset > global.action.replacementCursor.offset); let writes = 0;
  const resumed = await withWriteObserver(({ path })=>{ if(path===selectedPath)writes++; },()=>f.call('rearm',input));
  assert.equal(resumed.reason,'replayed',JSON.stringify(resumed)); assert.equal(writes,0); assert.deepEqual(readFileSync(selectedPath),after);
});

test('RR07 same-session lock excludes rearm while unrelated sessions retain independent locks',async t => {
  const f = await fixture(t), path = paths(f).cursor.replace(/\.json$/,'.lock');
  await stateLock(path,async()=>{
    const result = await f.call('rearm',request(f)); assert.equal(result.status,'busy'); assert.equal(result.reason,'state_busy');
  });
  assert.equal((await f.call('rearm',request(f))).reason,'rearmed');
});

test('RR06 source-close rejection zeroes the key and exposes only fixed failure without rolling back durable ready',async t => {
  const f = await fixture(t), input = request(f), source = statSync(f.sourcePath);
  const originalOpen = promises.open, originalFill = Buffer.prototype.fill;
  let installed = false, rejected = false, zeroedAfterClose = 0, result;
  try {
    promises.open = async (...args) => {
      const handle = await originalOpen(...args), info = await handle.stat();
      if (!installed && info.isFile() && info.dev === source.dev && info.ino === source.ino) {
        installed = true; const close = handle.close.bind(handle);
        handle.close = async () => { await close(); rejected = true; throw Error('synthetic_close_failure_prose_should_not_escape'); };
      }
      return handle;
    };
    Buffer.prototype.fill = function(value,...args) {
      if (rejected && value === 0 && this.length === 32) zeroedAfterClose++;
      return originalFill.call(this,value,...args);
    };
    syncBuiltinESMExports(); result = await f.call('rearm',input);
  } finally { promises.open = originalOpen; Buffer.prototype.fill = originalFill; syncBuiltinESMExports(); }
  assert.equal(installed,true); assert.equal(rejected,true); assert.ok(zeroedAfterClose > 0,'installation key must be zeroed even after source close rejects');
  assert.deepEqual(result,{ version:'local-raw-rearm-result-v1',status:'blocked',reason:'unexpected_failure',revision:null,pending:null });
  assert.doesNotMatch(JSON.stringify(result),/synthetic_close_failure_prose|source\.jsonl|synthetic_key_secret/);
  assert.deepEqual(await f.host.rearmStatus(),{ version:'local-raw-rearm-status-v1',status:'ready',reason:null,revision:1,pending:false });
  const before = readFileSync(paths(f).cursor); let writes = 0;
  const replay = await withWriteObserver(({ path })=>{if(path===paths(f).cursor)writes++;},()=>f.call('rearm',input));
  assert.equal(replay.reason,'replayed'); assert.equal(writes,0); assert.deepEqual(readFileSync(paths(f).cursor),before);
  assert.equal(f.calls().length,0); assert.equal(f.ledger(),null);
});
