import test from 'node:test';
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, statSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { Readable } from 'node:stream';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { DatabaseSync, StatementSync } from 'node:sqlite';
import { lazyFixture, ok, setupFixture } from './fixtures/local-setup-workspace.mjs';
import { workerFixture } from './fixtures/local-worker-workspace.mjs';
import { sessionId } from './fixtures/raw-fixtures.mjs';
import { stateLock } from '../state-lock.mjs';
import { withSessionIdentity } from '../raw/local-session-fence.mjs';
import { clearSessionStarts } from '../raw/local-session-start.mjs';
import { activateHostAuthority } from '../raw/local-host-rearm.mjs';
import { withLocalHostDependencies } from '../raw/local-host.mjs';
import { runLocalRawHook } from '../raw/local-hook.mjs';
import { runLocalSetupCli } from '../raw/local-setup-cli.mjs';
import { LocalHostError, readHostProfile, readHostConfiguration } from '../raw/local-host-profile.mjs';

const storeBusyBoundMs = 2000;
const overBoundHoldMs = 3 * storeBusyBoundMs;

// The lock lives in a separate process: a synchronous busy wait cannot
// release a lock via a timer on this test's own event loop.
async function locked(t,path,holdMs,check) {
  const child = fork(new URL(import.meta.url),['lock-child',path,String(holdMs)],
    { execArgv:[],stdio:['ignore','ignore','pipe','ipc'] });
  let stderr=''; child.stderr.on('data',chunk=>{stderr+=chunk;});
  const exited = new Promise((resolve,reject)=>{
    child.once('error',reject); child.once('exit',(code,signal)=>resolve({code,signal}));
  });
  t.after(async()=>{if(child.exitCode === null && child.signalCode === null)child.kill();await exited;});
  await new Promise((resolve,reject)=>{
    child.once('message',message=>message === 'ready' ? resolve():reject(Error('lock readiness')));
    exited.then(result=>reject(Error('lock child exited before ready: '+JSON.stringify(result)+stderr)));
  });
  // Begin the hold interval at the first SQL call, after any fixture, CLI
  // input or filesystem work. Runner startup speed cannot consume the lock.
  let started=false;
  const startHold = () => {
    if (!started) { started=true; child.send('check'); }
  };
  const mocks=['prepare','exec'].map(name=>{
    const original=DatabaseSync.prototype[name];
    return t.mock.method(DatabaseSync.prototype,name,function(...args){
      startHold();
      return original.apply(this,args);
    });
  });
  try { return await check(startHold); }
  finally {
    for(const mock of mocks)mock.mock.restore();
    startHold();
    assert.deepEqual(await exited,{code:0,signal:null},stderr);
  }
}
if (process.argv[2] === 'lock-child') {
  const db = new DatabaseSync(process.argv[3]);
  db.exec('PRAGMA journal_mode=DELETE; BEGIN EXCLUSIVE');
  process.once('message',()=>setTimeout(()=>{db.exec('ROLLBACK');db.close();process.disconnect();},Number(process.argv[4])));
  process.send('ready');
} else {

function stateFiles(f, directory) {
  const root = join(f.request.installationDirectory,'state',directory);
  if (!existsSync(root)) return [];
  return readdirSync(root).filter(name => /^[a-f0-9]{64}\.json$/.test(name)).map(name => join(root,name));
}
function startRecord(f) {
  const files = stateFiles(f,'starts');
  assert.equal(files.length,1);
  return JSON.parse(readFileSync(files[0],'utf8'));
}
function savedRows(f) {
  const db = new DatabaseSync(f.request.databasePath,{ readOnly:true });
  try {
    return db.prepare(`SELECT m.ordinal,m.role,p.part_index,p.sealed FROM raw_messages m JOIN raw_parts p
      ON m.conversation_id=p.conversation_id AND m.message_id=p.message_id
      WHERE p.saved=1 ORDER BY m.ordinal,p.part_index`).all().map(({sealed,...row}) => ({...row,text:Buffer.from(sealed).toString()}));
  } finally { db.close(); }
}
async function realBusyStart(t,f) {
  const nativeBusy = [], mapped = [];
  const methods = [[DatabaseSync.prototype,'prepare'],[StatementSync.prototype,'get']];
  const spies = methods.map(([target,name]) => {
    const original = target[name];
    return t.mock.method(target,name,function(...args) {
      try { return original.apply(this,args); }
      catch (error) {
        if (error.code === 'ERR_SQLITE_ERROR' && (error.errcode & 0xff) === 5) nativeBusy.push(error.stack);
        throw error;
      }
    });
  });
  // Observe the actual host error as it is constructed. The hook intentionally
  // continues to publish authority_changed when status is blocked.
  Object.defineProperty(LocalHostError.prototype,'reason',{
    configurable:true,
    set(reason) {
      if (reason === 'store_invalid') mapped.push(new Error().stack);
      Object.defineProperty(this,'reason',{value:reason,writable:true,enumerable:true,configurable:true});
    },
  });
  try {
    await locked(t,f.request.databasePath,overBoundHoldMs,async () => {
      const start = performance.now();
      const outcome = await f.hook();
      const elapsed = performance.now() - start;
      const fromHookSnapshot = stack => stack.includes('at databaseSnapshot') && stack.includes('at async runLocalRawHook');
      t.diagnostic(JSON.stringify({ holdMs:overBoundHoldMs,elapsed,outcome,nativeBusy,mapped }));
      assert.ok(nativeBusy.some(fromHookSnapshot),'SessionStart must observe native SQLITE_BUSY in databaseSnapshot');
      assert.ok(mapped.some(fromHookSnapshot),'databaseSnapshot must map the native BUSY to store_invalid');
      assert.ok(elapsed >= storeBusyBoundMs,`SessionStart returned after ${elapsed} ms`);
      assert.deepEqual(outcome,{version:'local-raw-hook-v1',status:'blocked',reason:'authority_changed'});
    });
  } finally {
    delete LocalHostError.prototype.reason;
    for (const spy of spies) spy.mock.restore();
  }
}

test('1. real busy SessionStart recovers from the first message',async t => {
  const f = await lazyFixture(t,'claude-code');
  unlinkSync(f.sourcePath);
  await realBusyStart(t,f);
  const startFiles = stateFiles(f,'starts');
  assert.deepEqual(stateFiles(f,'sessions'),[]);
  const initialStart = startFiles.length && startRecord(f);
  assert.ok(!initialStart || initialStart.version === 'local-raw-start-attempt-v1');
  const control = await lazyFixture(t,'claude-code');
  unlinkSync(control.sourcePath);
  assert.equal((await control.hook()).status,'ready');
  for (const text of ['Synthetic first copper turn','Synthetic second copper turn']) {
    f.append(text);
    control.append(text);
  }
  const recovered = await f.hook('Stop');
  const controlStop = await control.hook('Stop');
  const controlRows = savedRows(control);
  assert.equal(controlStop.status,'progress',JSON.stringify(controlStop));
  assert.equal(controlRows.length,2);
  t.diagnostic(JSON.stringify({recovered, saved:savedRows(f).length, controlSaved:controlRows.length}));
  assert.deepEqual({ outcome:recovered,rows:savedRows(f) },{
    outcome:{version:'local-raw-hook-v1',status:'progress',reason:null},rows:controlRows,
  });
  assert.equal(startFiles.length,1);
  assert.deepEqual(Object.keys(initialStart).sort(),['authority','kind','source','version']);
  assert.equal(initialStart.kind,'fresh');
  assert.match(initialStart.authority,/^[a-f0-9]{64}$/);
  assert.match(initialStart.source,/^[a-f0-9]{64}$/);
  assert.equal(startRecord(f).version,'local-raw-start-v1');
});

const profilePath = f => join(f.request.installationDirectory,'host-profile.json');
const configPath = f => join(f.request.installationDirectory,'capture.json');
const selection = f => ({sessionId,sourcePath:f.sourcePath});
async function selectedIdentity(f,work) {
  const profile = await readHostProfile(profilePath(f));
  return withSessionIdentity(profile,await readHostConfiguration(profile),selection(f),work);
}
function hookInput(f,event) {
  return {installationDirectory:f.request.installationDirectory,event,
    payload:{hook_event_name:event,session_id:sessionId,transcript_path:f.sourcePath}};
}
async function busySessionStart(f,afterDispatch) {
  return selectedIdentity(f,identity => stateLock(identity.lockPath,() =>
    withLocalHostDependencies({ checkpoint:async stage => {
      if (stage === 'after_dispatch') await afterDispatch?.();
    } },() => runLocalRawHook(hookInput(f,'SessionStart')))));
}
async function loseStart(f,{present = false} = {}) {
  if (!present) unlinkSync(f.sourcePath);
  const outcome = await busySessionStart(f);
  assert.deepEqual({status:outcome.status,reason:outcome.reason},{status:'busy',reason:'state_busy'});
  const attempt = startRecord(f);
  assert.equal(attempt.version,'local-raw-start-attempt-v1');
  assert.equal(attempt.kind,present ? 'present':'fresh');
  return attempt;
}
function setConsent(f,automaticCaptureEnabled,rawNoticeVersion = f.control().rawNoticeVersion) {
  const { targetId,storeId,revision } = f.control();
  return ok(f.core.setLocalCaptureControl({namespace:f.request.namespace,client:f.request.client,targetId,
    expectedStoreId:storeId,expectedRevision:revision,automaticCaptureEnabled,rawNoticeVersion}));
}
function setPause(f,paused) {
  const { namespace } = f.request;
  const { generation } = ok(f.core.getCaptureControl({namespace}));
  return ok(f.core.setCapturePaused({namespace,expectedGeneration:generation,paused}));
}
function setRaw(f,enabled) {
  const { namespace:{ownerId},client } = f.request;
  const { revision } = ok(f.core.getRawCaptureControl({ownerId,client}));
  return ok(f.core.setRawCaptureControl({ownerId,client,expectedRevision:revision,enabled}));
}
function noSavedSession(f) {
  assert.deepEqual(stateFiles(f,'sessions'),[]);
  assert.deepEqual(savedRows(f),[]);
}
async function cli(f,event) {
  const stdout = [], stderr = [];
  const original = process.stderr.write;
  process.stderr.write = bytes => { stderr.push(Buffer.from(bytes)); return true; };
  try {
    const exitCode = await runLocalSetupCli(['hook','--installation',f.request.installationDirectory,'--event',event],{
      stdin:Readable.from([JSON.stringify(hookInput(f,event).payload)]),
      stdout:{write:bytes => stdout.push(Buffer.from(bytes))},
    });
    return {stdout:Buffer.concat(stdout),stderr:Buffer.concat(stderr),exitCode};
  } finally { process.stderr.write = original; }
}
const silent = {stdout:Buffer.alloc(0),stderr:Buffer.alloc(0),exitCode:0};

test('2. disabled capture refuses a lost start without replacing the attempt',async t => {
  const f = await lazyFixture(t,'claude-code');
  const attempt = await loseStart(f);
  f.append('Synthetic blocked turn');
  setConsent(f,false);
  assert.equal((await f.hook('Stop')).reason,'authority_changed');
  assert.deepEqual(startRecord(f),attempt);
  noSavedSession(f);
});

test('2. busy Stop is silent and leaves a retryable attempt',async t => {
  const f = await lazyFixture(t,'claude-code');
  const attempt = await loseStart(f);
  f.append('Synthetic retry turn');
  await locked(t,f.request.databasePath,overBoundHoldMs,async () => {
    assert.deepEqual(await cli(f,'Stop'),silent);
    assert.deepEqual(startRecord(f),attempt);
    assert.deepEqual(stateFiles(f,'sessions'),[]);
  });
  assert.equal((await f.hook('Stop')).status,'progress');
  assert.deepEqual(savedRows(f).map(row => row.text),['Synthetic retry turn']);
});

test('2. a busy in-lock permission check leaves the attempt unpromoted',async t => {
  const f = workerFixture(t);
  const initial = await f.runWorker('markStart',{start:'eof'}).done;
  assert.equal(initial.code,0,initial.stderr);
  assert.equal(JSON.parse(initial.stdout).status,'ready');
  const starts = join(f.stateRoot,'starts');
  const path = join(starts,readdirSync(starts)[0]);
  const marker = JSON.parse(readFileSync(path,'utf8'));
  const attempt = JSON.stringify({...marker,version:'local-raw-start-attempt-v1',kind:'fresh'});
  writeFileSync(path,attempt);
  await locked(t,f.config.databasePath,overBoundHoldMs,async startHold => {
    startHold();
    const stopped = await f.runWorker('run').done;
    assert.equal(stopped.code,0,stopped.stderr);
    assert.equal(JSON.parse(stopped.stdout).reason,'config_invalid');
    assert.equal(readFileSync(path,'utf8'),attempt);
    assert.deepEqual(readdirSync(join(f.stateRoot,'sessions')),[]);
  });
});

test('3. a session fence prevents recovery',async t => {
  const f = await lazyFixture(t,'claude-code');
  const attempt = await loseStart(f);
  f.append('Synthetic fenced turn');
  await selectedIdentity(f,({wireSessionId}) => ok(f.core.fenceSession({
    namespace:f.request.namespace,client:f.request.client,sessionId:wireSessionId,
  })));
  assert.equal((await f.hook('Stop')).reason,'rearm_refused');
  assert.deepEqual(startRecord(f),attempt);
  noSavedSession(f);
});

const authorityWindows = [
  ['pause and resume','expectedNamespaceGeneration',(f,during) => { setPause(f,true); during(); setPause(f,false); }],
  ['consent off and on','expectedConsentGeneration',(f,during) => { setConsent(f,false); during(); setConsent(f,true); }],
  ['Raw off and on','expectedRawRevision',(f,during) => { setRaw(f,false); during(); setRaw(f,true); }],
  ['control revision','expectedControlRevision',(f,during) => { setConsent(f,true,null); during(); setConsent(f,true,'local-plain-v1'); }],
];
for (const [name,field,change] of authorityWindows) test(`4. ${name} prevents beginning recovery`,async t => {
  const f = await lazyFixture(t,'claude-code');
  const attempt = await loseStart(f);
  const oldAuthority = JSON.parse(readFileSync(configPath(f))).authority;
  f.append('Synthetic before change');
  change(f,() => f.append('Synthetic during change'));
  assert.equal((await f.hook('Stop')).reason,'authority_changed');
  noSavedSession(f);
  await activateHostAuthority(profilePath(f),() => {});
  const authority = JSON.parse(readFileSync(configPath(f))).authority;
  assert.notEqual(authority[field],oldAuthority[field]);
  assert.equal((await f.hook('Stop')).reason,'state_invalid');
  assert.deepEqual(startRecord(f),attempt);
  noSavedSession(f);
  assert.equal((await f.hook()).status,'ready');
  f.append('Synthetic after new boundary');
  assert.equal((await f.hook('Stop')).status,'progress');
  assert.deepEqual(savedRows(f).map(row => row.text),['Synthetic after new boundary']);
});

test('4b. pause and resume between identity reads cannot recover pre-resume messages',async t => {
  const f = await lazyFixture(t,'claude-code');
  unlinkSync(f.sourcePath);
  const before = readFileSync(configPath(f));
  let changed = false;
  const outcome = await busySessionStart(f,() => {
    setPause(f,true);
    f.append('Synthetic pre-resume turn');
    setPause(f,false);
    changed = true;
  });
  assert.equal(changed,true);
  assert.equal(outcome.reason,'state_busy');
  assert.deepEqual(readFileSync(configPath(f)),before);
  const attemptWritten = stateFiles(f,'starts').length === 1;
  t.diagnostic(JSON.stringify({attemptWritten}));
  assert.equal(attemptWritten,true);
  assert.equal(startRecord(f).kind,'fresh');
  assert.equal((await f.hook('Stop')).reason,'authority_changed');
  noSavedSession(f);
  await activateHostAuthority(profilePath(f),() => {});
  assert.equal((await f.hook('Stop')).reason,'state_invalid');
  noSavedSession(f);
  assert.equal((await f.hook()).status,'ready');
  f.append('Synthetic newly admitted turn');
  assert.equal((await f.hook('Stop')).status,'progress');
  assert.deepEqual(savedRows(f).map(row => row.text),['Synthetic newly admitted turn']);
});

test('5. racing Stop and PreCompact recover once',async t => {
  const f = await lazyFixture(t,'claude-code');
  await loseStart(f);
  f.append('Synthetic racing turn');
  const outcomes = await Promise.all([f.hook('Stop'),f.hook('PreCompact')]);
  assert.ok(outcomes.some(outcome => outcome.status === 'progress'),JSON.stringify(outcomes));
  assert.equal(startRecord(f).version,'local-raw-start-v1');
  assert.equal(stateFiles(f,'sessions').length,1);
  assert.equal(f.cursor().issuedOrdinal,1);
  assert.deepEqual(savedRows(f).map(row => row.text),['Synthetic racing turn']);
});

test('6. late successful or busy SessionStart leaves the recovered cursor and marker unchanged',async t => {
  const f = await lazyFixture(t,'claude-code');
  await loseStart(f);
  f.append('Synthetic recovered turn');
  assert.equal((await f.hook('Stop')).status,'progress');
  const marker = stateFiles(f,'starts')[0];
  const markerBytes = readFileSync(marker), cursorBytes = readFileSync(f.cursorPath());
  assert.equal((await f.hook()).status,'ready');
  assert.equal((await busySessionStart(f)).reason,'state_busy');
  assert.deepEqual(readFileSync(marker),markerBytes);
  assert.deepEqual(readFileSync(f.cursorPath()),cursorBytes);
});

test('7. missing SessionStart remains state_invalid',async t => {
  const f = await lazyFixture(t,'claude-code');
  assert.equal((await f.hook('Stop')).reason,'state_invalid');
  assert.deepEqual(stateFiles(f,'starts'),[]);
  noSavedSession(f);
});

test('7. authority_changed at SessionStart does not authorize beginning recovery',async t => {
  const f = await lazyFixture(t,'claude-code');
  unlinkSync(f.sourcePath);
  setConsent(f,true,null);
  setConsent(f,true,'local-plain-v1');
  assert.equal((await f.hook()).reason,'authority_changed');
  assert.deepEqual(stateFiles(f,'starts'),[]);
  await activateHostAuthority(profilePath(f),() => {});
  f.append('Synthetic unauthorized history');
  assert.equal((await f.hook('Stop')).reason,'state_invalid');
  noSavedSession(f);
});

test('7. headless and prepared SessionStart write no attempt',async t => {
  const active = await lazyFixture(t,'claude-code');
  assert.equal((await runLocalRawHook(hookInput(active,'SessionStart'),{headless:true})).reason,'headless_skipped');
  assert.deepEqual(stateFiles(active,'starts'),[]);
  assert.equal((await active.hook('Stop')).reason,'state_invalid');
  noSavedSession(active);
  const prepared = await setupFixture(t);
  prepared.request.interpretationConsent = false;
  assert.equal((await prepared.setup()).status,'prepared');
  assert.equal((await prepared.hook()).reason,'authority_changed');
  assert.deepEqual(stateFiles(prepared,'starts'),[]);
  assert.equal((await prepared.invoke('activate')).status,'active');
  assert.equal((await prepared.hook('Stop')).reason,'state_invalid');
  noSavedSession(prepared);
});

test('8. present attempt starts at the current EOF and waits for a user boundary',async t => {
  const f = await lazyFixture(t,'claude-code');
  const attempt = await loseStart(f,{present:true});
  f.append('Synthetic history between hooks');
  const eof = statSync(f.sourcePath).size;
  assert.equal((await f.hook('Stop')).status,'ready');
  assert.equal(f.cursor().offset,eof);
  assert.equal(f.cursor().issuedOrdinal,0);
  assert.deepEqual(f.cursor().selection,{ownSkillTurn:true,awaitingUserBoundary:true});
  assert.deepEqual(startRecord(f),attempt);
  assert.deepEqual(savedRows(f),[]);
  f.append('Synthetic first new user boundary');
  assert.equal((await f.hook('Stop')).status,'progress');
  assert.deepEqual(savedRows(f).map(row => row.text),['Synthetic first new user boundary']);
});

for (const reason of ['cancelled','work_limit']) test(`9. ${reason} keeps the hook result and does not record an attempt`,async t => {
  const f = await lazyFixture(t,'claude-code');
  unlinkSync(f.sourcePath);
  const controller = new AbortController(), now = performance.now.bind(performance);
  let advance = 0, fired = false;
  const clock = t.mock.method(performance,'now',() => now() + advance);
  const checkpoint = stage => {
    if (stage !== 'before_dispatch') return;
    fired = true;
    if (reason === 'cancelled') controller.abort();
    else advance = 200000;
  };
  let outcome;
  try {
    outcome = await withLocalHostDependencies({checkpoint},() => runLocalRawHook(hookInput(f,'SessionStart'),{signal:controller.signal}));
  } finally { clock.mock.restore(); }
  assert.equal(fired,true);
  assert.deepEqual(outcome,{version:'local-raw-hook-v1',status:'blocked',reason});
  const output = await withLocalHostDependencies({checkpoint(stage) {
    if (stage === 'before_dispatch') throw new LocalHostError(reason);
  }},() => cli(f,'SessionStart'));
  assert.deepEqual(output,silent);
  // The qualification run compares these serialized hook results and output bytes.
  t.diagnostic(JSON.stringify({outcome,stdout:output.stdout.toString('base64'),stderr:output.stderr.toString('base64'),exitCode:output.exitCode}));
  assert.deepEqual(stateFiles(f,'starts'),[]);
  f.append('Synthetic timed-out turn');
  assert.equal((await f.hook('Stop')).reason,'state_invalid');
  noSavedSession(f);
});

const badAttempts = [
  ['extra field',value => JSON.stringify({...value,extra:true})],
  ['wrong version',value => JSON.stringify({...value,version:'unknown'})],
  ['wrong kind',value => JSON.stringify({...value,kind:'unknown'})],
  ['truncated JSON',value => JSON.stringify(value).slice(0,-1)],
  ['duplicate field',value => '{"kind":"fresh",'+JSON.stringify(value).slice(1)],
  ['wrong source',value => JSON.stringify({...value,source:'0'.repeat(64)})],
];
for (const [name,change] of badAttempts) test(`10. strict attempt parsing rejects ${name}`,async t => {
  const f = await lazyFixture(t,'claude-code'), attempt = await loseStart(f);
  writeFileSync(stateFiles(f,'starts')[0],change(attempt));
  f.append('Synthetic malformed-attempt history');
  assert.equal((await f.hook('Stop')).reason,'state_invalid');
  noSavedSession(f);
});

test('11. busy SessionStart has identical output when the attempt write fails',async t => {
  const f = await lazyFixture(t,'claude-code');
  unlinkSync(f.sourcePath);
  const link = fs.link;
  let injected = false;
  await locked(t,f.request.databasePath,overBoundHoldMs,async () => {
    fs.link = async (from,to) => {
      if (to.startsWith(join(f.request.installationDirectory,'state','starts')+'/')) {
        injected = true;
        throw Error('synthetic attempt publication failure');
      }
      return link(from,to);
    };
    syncBuiltinESMExports();
    let failed;
    try { failed = await cli(f,'SessionStart'); }
    finally { fs.link = link; syncBuiltinESMExports(); }
    assert.equal(injected,true);
    assert.deepEqual(stateFiles(f,'starts'),[]);
    const succeeded = await cli(f,'SessionStart');
    assert.equal(startRecord(f).kind,'fresh');
    assert.deepEqual(failed,succeeded);
    assert.deepEqual(succeeded,silent);
  });
});

const tempName = 'a'.repeat(64)+'.json.tmp-123-00000000-0000-0000-0000-000000000000';
test('12. uninstall clears attempts and regular temp files, with exact marker matching',async t => {
  const f = await lazyFixture(t,'claude-code');
  await loseStart(f);
  const starts = join(f.request.installationDirectory,'state','starts');
  writeFileSync(join(starts,tempName),'synthetic temporary bytes',{mode:0o600});
  assert.equal((await f.invoke('disable')).status,'disabled');
  assert.deepEqual(readdirSync(starts),[]);
  const moduleText = readFileSync(new URL('../raw/local-session-start.mjs',import.meta.url),'utf8');
  assert.match(moduleText,/return text !== undefined && text === binding\(identity,context\);/);
});

for (const [name,create] of [
  ['unexpected name',path => writeFileSync(path,'synthetic',{mode:0o600})],
  ['temp-pattern symlink',path => symlinkSync('synthetic-missing-target',path)],
  ['temp-pattern directory',path => mkdirSync(path,{mode:0o700})],
]) test(`12. uninstall refuses the ${name}`,async t => {
  const f = await lazyFixture(t,'claude-code');
  const state = join(f.request.installationDirectory,'state'), starts = join(state,'starts');
  mkdirSync(starts,{mode:0o700});
  const path = join(starts,name === 'unexpected name' ? 'unexpected.json':tempName);
  create(path);
  await assert.rejects(clearSessionStarts(state),{reason:'state_invalid'});
  assert.equal((await f.invoke('disable')).status,'blocked');
  assert.ok(lstatSync(path));
});

test('13. promoted marker bytes match the original SessionStart for the same identity',async t => {
  const f = await lazyFixture(t,'claude-code');
  unlinkSync(f.sourcePath);
  assert.equal((await f.hook()).status,'ready');
  const path = stateFiles(f,'starts')[0], original = readFileSync(path);
  unlinkSync(path);
  assert.equal((await busySessionStart(f)).reason,'state_busy');
  assert.equal(startRecord(f).kind,'fresh');
  f.append('Synthetic marker byte parity');
  assert.equal((await f.hook('Stop')).status,'progress');
  assert.deepEqual(readFileSync(path),original);
});

test('14. configured authority rewritten between identity reads leaves no attempt',async t => {
  const f = await lazyFixture(t,'claude-code');
  unlinkSync(f.sourcePath);
  const before = JSON.parse(readFileSync(configPath(f))).authority;
  const outcome = await busySessionStart(f,async () => {
    setPause(f,true);
    setPause(f,false);
    await activateHostAuthority(profilePath(f),() => {});
  });
  assert.equal(outcome.reason,'state_busy');
  assert.notDeepEqual(JSON.parse(readFileSync(configPath(f))).authority,before);
  assert.deepEqual(stateFiles(f,'starts'),[]);
  f.append('Synthetic history under old configuration');
  assert.equal((await f.hook('Stop')).reason,'state_invalid');
  noSavedSession(f);
});
}
