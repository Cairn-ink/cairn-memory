import assert from 'node:assert/strict';
import childProcess, { fork, spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { basename, dirname, join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { DatabaseSync, StatementSync } from 'node:sqlite';
import { Readable } from 'node:stream';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { lazyFixture, ok } from './fixtures/local-setup-workspace.mjs';
import { workerFixture } from './fixtures/local-worker-workspace.mjs';
import { sessionId } from './fixtures/raw-fixtures.mjs';
import { stateLock } from '../state-lock.mjs';
import { withSessionIdentity } from '../raw/local-session-fence.mjs';
import { activateHostAuthority } from '../raw/local-host-rearm.mjs';
import { createLocalRawHost, withLocalHostDependencies } from '../raw/local-host.mjs';
import { runLocalRawHook } from '../raw/local-hook.mjs';
import { readHostProfile, readHostConfiguration } from '../raw/local-host-profile.mjs';
import { runLocalSetupCli } from '../raw/local-setup-cli.mjs';

const attemptVersion = 'local-raw-start-attempt-v1';
const markerVersion = 'local-raw-start-v1';
const ready = hookOutcome('ready',null);
const stateInvalid = hookOutcome('blocked','state_invalid');
const silent = { stdout:'',stderr:'',exitCode:0 };
const permissionQuery = 'SELECT 1 FROM raw_owner_usage WHERE owner_id=? AND cap_bytes!=?';

function hookOutcome(status,reason) {
  return { version:'local-raw-hook-v1',status,reason };
}
const profilePath = f => join(f.request.installationDirectory,'host-profile.json');
const createTranscript = f => writeFileSync(f.sourcePath,'',{ mode:0o600 });
function startFiles(f) {
  const starts = join(f.request.installationDirectory,'state','starts');
  if (!existsSync(starts)) return [];
  return readdirSync(starts).map(name => join(starts,name));
}
function startFile(f) {
  const files = startFiles(f);
  assert.equal(files.length,1,'one SessionStart record');
  return files[0];
}
function hookInput(f,event = 'SessionStart') {
  return { installationDirectory:f.request.installationDirectory,event,
    payload:{ hook_event_name:event,session_id:sessionId,transcript_path:f.sourcePath } };
}
function savedRows(f) {
  const db = new DatabaseSync(f.request.databasePath,{ readOnly:true });
  try {
    return db.prepare(`SELECT m.ordinal,m.role,p.part_index,p.sealed FROM raw_messages m JOIN raw_parts p
      ON m.conversation_id=p.conversation_id AND m.message_id=p.message_id
      WHERE p.saved=1 ORDER BY m.ordinal,p.part_index`).all()
      .map(({ sealed,...row }) => ({ ...row,text:Buffer.from(sealed).toString() }));
  } finally { db.close(); }
}

async function cli(f,event = 'SessionStart') {
  const stdout = [], stderr = [], write = process.stderr.write;
  process.stderr.write = bytes => { stderr.push(Buffer.from(bytes)); return true; };
  try {
    const exitCode = await runLocalSetupCli(['hook','--installation',f.request.installationDirectory,'--event',event],{
      stdin:Readable.from([JSON.stringify(hookInput(f,event).payload)]),
      stdout:{ write:bytes => stdout.push(Buffer.from(bytes)) },
    });
    return { stdout:Buffer.concat(stdout).toString('base64'),stderr:Buffer.concat(stderr).toString('base64'),exitCode };
  } finally { process.stderr.write = write; }
}

async function stopStart(t,f,{ check,reason,run = null,busy = false }) {
  const controller = new AbortController(), now = performance.now.bind(performance);
  let shift = 0, permissionCalls = 0, fired = false, nativeBusy = false;
  const stop = () => {
    assert.equal(fired,false);
    fired = true;
    if (reason === 'work_limit') shift = 200000;
    else if (run === cli) process.emit('SIGTERM');
    else controller.abort();
  };
  const clock = t.mock.method(performance,'now',() => now()+shift);
  const probes = [[DatabaseSync.prototype,'prepare'],[DatabaseSync.prototype,'exec'],
    [StatementSync.prototype,'get'],[StatementSync.prototype,'all']].map(([target,name]) => {
    const original = target[name];
    return t.mock.method(target,name,function(...args) {
      try {
        const result = original.apply(this,args);
        if (name === 'prepare' && args[0] === permissionQuery && ++permissionCalls === check) stop();
        return result;
      } catch (error) {
        if (busy && !nativeBusy && error.code === 'ERR_SQLITE_ERROR' && (error.errcode & 0xff) === 5) {
          nativeBusy = true;
          stop();
        }
        throw error;
      }
    });
  });
  try {
    const outcome = await withLocalHostDependencies({ checkpoint(stage) {
      if (check === stage) stop();
    } },() => run === cli ? cli(f) : runLocalRawHook(hookInput(f),{ signal:controller.signal }));
    assert.equal(fired,true,`reached ${check}`);
    assert.equal(nativeBusy,busy);
    return outcome;
  } finally {
    clock.mock.restore();
    for (const probe of probes) probe.mock.restore();
  }
}

// The previous recovery test's separate SQLite holder lets a native busy wait
// run on the hook's thread while the holder controls the release.
async function whileStoreBusy(t,f,work) {
  const child = fork(new URL(import.meta.url),['lock-child',f.request.databasePath],
    { execArgv:[],stdio:['ignore','ignore','pipe','ipc'] });
  let stderr = '';
  child.stderr.on('data',chunk => { stderr += chunk; });
  const exited = new Promise((resolve,reject) => {
    child.once('error',reject);
    child.once('exit',(code,signal) => resolve({ code,signal }));
  });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill();
    await exited;
  });
  await new Promise((resolve,reject) => {
    child.once('message',message => message === 'ready' ? resolve() : reject(Error('lock readiness')));
    exited.then(result => reject(Error('holder exited before ready: '+JSON.stringify(result)+stderr)),reject);
  });
  try { return await work(); }
  finally {
    child.send('release');
    assert.deepEqual(await exited,{ code:0,signal:null },stderr);
  }
}
if (process.argv[2] === 'lock-child') {
  const db = new DatabaseSync(process.argv[3]);
  db.exec('PRAGMA journal_mode=DELETE; BEGIN EXCLUSIVE');
  process.once('message',() => {
    db.exec('ROLLBACK');
    db.close();
    process.disconnect();
  });
  process.send('ready');
} else {

// The keyless CLI eagerly imports the provider. Keep the real transport and
// SQLite capture, and make any use of the provider or network fail on sight.
const captureCli = fileURLToPath(new URL('../../../adapters/local/cli.mjs',import.meta.url));
const provider = new URL('../../../adapters/local/guarded-model.mjs',import.meta.url).href;
const loader = 'data:text/javascript,'+encodeURIComponent(`
  export function load(url,context,next) {
    if (url === ${JSON.stringify(provider)}) return { format:'module',shortCircuit:true,
      source:'export function guardedModel(){throw Error("unexpected provider call")}' };
    return next(url,context);
  }
`);
const preload = 'data:text/javascript,'+encodeURIComponent(`
  import { register } from 'node:module';
  register(${JSON.stringify(loader)});
  globalThis.fetch = () => { throw Error('unexpected provider call'); };
`);
const spawn = childProcess.spawn;
test.before(() => {
  childProcess.spawn = (executable,args,options) => spawn(executable,
    executable === process.execPath && args[0] === captureCli ? ['--import',preload,...args] : args,options);
  syncBuiltinESMExports();
});
test.after(() => {
  childProcess.spawn = spawn;
  syncBuiltinESMExports();
});

const cases = [
  ['1. status permission deadline',1,'work_limit',true],
  ['1. dispatch permission deadline',2,'work_limit',true],
  // The fence read uses the same SQL snapshot helper and is outside the four checks.
  ['1. fresh permission deadline',4,'work_limit',true],
  ['1. in-lock permission deadline',5,'work_limit',true],
  ['2. in-lock permission cancellation',5,'cancelled',true],
  ['3. deadline outside permissions in the fence read',3,'work_limit',false],
  ['3. deadline outside permissions before dispatch','before_dispatch','work_limit',false],
  ['3. cancellation outside permissions','before_dispatch','cancelled',false],
];
for (const [name,check,reason,staged] of cases) test(name,async t => {
  const f = await lazyFixture(t,'claude-code');
  unlinkSync(f.sourcePath);
  const expected = hookOutcome('blocked',check === 1 ? 'authority_changed' : reason);
  const outcome = check === 1
    ? await whileStoreBusy(t,f,() => stopStart(t,f,{ check,reason,busy:true }))
    : await stopStart(t,f,{ check,reason });
  assert.deepEqual(outcome,expected);
  t.diagnostic(JSON.stringify({ case:name,outcome }));

  const attempt = startFiles(f);
  if (staged && attempt.length) {
    const record = JSON.parse(readFileSync(attempt[0]));
    assert.deepEqual(Object.keys(record).sort(),['authority','kind','source','version']);
    assert.equal(record.version,attemptVersion);
    assert.equal(record.kind,'fresh');
  }
  if (!staged) assert.deepEqual(attempt,[]);

  const control = await lazyFixture(t,'claude-code');
  unlinkSync(control.sourcePath);
  assert.deepEqual(await control.hook(),ready);
  createTranscript(f);
  createTranscript(control);
  for (const text of ['Synthetic first turn','Synthetic second turn']) {
    f.append(text);
    control.append(text);
  }
  assert.deepEqual(await control.hook('Stop'),hookOutcome('progress',null));
  const controlRows = savedRows(control);
  assert.deepEqual(controlRows.map(row => row.text),['Synthetic first turn','Synthetic second turn']);
  assert.deepEqual(await f.hook('Stop'),staged ? hookOutcome('progress',null) : stateInvalid);
  assert.deepEqual(savedRows(f),staged ? controlRows : []);
  if (staged) assert.equal(attempt.length,1,'the timed-out start recorded an attempt');
});

for (const [name,check,reason,staged] of cases) test(`4. hook output for ${name.slice(3)}`,async t => {
  const f = await lazyFixture(t,'claude-code');
  unlinkSync(f.sourcePath);
  const directory = join(f.request.installationDirectory,'state','starts')+'/';
  const link = fs.link;
  let injected = false, failed;
  fs.link = async (from,to) => {
    if (to.startsWith(directory)) {
      injected = true;
      throw Error('synthetic attempt publication failure');
    }
    return link(from,to);
  };
  syncBuiltinESMExports();
  try { failed = await stopStart(t,f,{ check,reason,run:cli }); }
  finally { fs.link = link; syncBuiltinESMExports(); }
  assert.deepEqual(startFiles(f),[]);
  const output = await stopStart(t,f,{ check,reason,run:cli });
  assert.deepEqual(failed,output);
  assert.deepEqual(output,silent);
  t.diagnostic(JSON.stringify({ case:name,output,failed }));
  assert.equal(injected,staged);
  assert.equal(startFiles(f).length,staged ? 1 : 0);
});

async function staleAttempt(f) {
  const profile = await readHostProfile(profilePath(f));
  const config = await readHostConfiguration(profile);
  const selection = { sessionId,sourcePath:f.sourcePath };
  const outcome = await withSessionIdentity(profile,config,selection,identity =>
    stateLock(identity.lockPath,() => runLocalRawHook(hookInput(f))));
  assert.deepEqual(outcome,hookOutcome('busy','state_busy'));
  const path = startFile(f);
  const attempt = JSON.parse(readFileSync(path));
  assert.equal(attempt.version,attemptVersion);
  assert.equal(attempt.kind,'present');
  return { path,attempt };
}

test('5. Stop leaves an earlier attempt in place once a cursor exists',async t => {
  const f = await lazyFixture(t,'claude-code'), control = await lazyFixture(t,'claude-code');
  assert.deepEqual(await f.hook(),ready);
  assert.deepEqual(await control.hook(),ready);
  for (const fixture of [f,control]) {
    fixture.append('Synthetic saved turn');
    assert.deepEqual(await fixture.hook('Stop'),hookOutcome('progress',null));
  }
  const { path } = await staleAttempt(f);
  const cursor = readFileSync(f.cursorPath()), controlCursor = readFileSync(control.cursorPath());
  const rows = savedRows(control);
  assert.deepEqual(rows.map(row => row.text),['Synthetic saved turn']);
  assert.deepEqual(await f.hook('Stop'),await control.hook('Stop'));
  assert.deepEqual(readFileSync(f.cursorPath()),cursor);
  assert.deepEqual(readFileSync(control.cursorPath()),controlCursor);
  assert.deepEqual(savedRows(f),rows);
  assert.deepEqual(savedRows(control),rows);
  assert.equal(existsSync(path),true,'Stop never deletes start files');
});

test('5. a legitimate start marker and existing cursor survive Stop',async t => {
  const f = workerFixture(t,{ rows:[] });
  const run = async (action,options) => {
    const result = await f.runWorker(action,options).done;
    assert.equal(result.code,0,result.stderr);
    return JSON.parse(result.stdout);
  };
  assert.equal((await run('markStart',{ start:'eof' })).status,'ready');
  const starts = join(f.stateRoot,'starts'), path = join(starts,readdirSync(starts)[0]);
  const marker = readFileSync(path);
  assert.equal(JSON.parse(marker).version,markerVersion);
  await run('run');
  const cursor = readFileSync(f.cursorPath());
  await run('run');
  assert.deepEqual(readFileSync(f.cursorPath()),cursor);
  assert.deepEqual(readFileSync(path),marker);
});

for (const [name,change] of [
  ['extra field',attempt => ({ ...attempt,extra:true })],
  ['wrong version',attempt => ({ ...attempt,version:'unknown' })],
]) for (const withCursor of [true,false]) test(`6. ${name} survives Stop with cursor = ${withCursor}`,async t => {
  const f = await lazyFixture(t,'claude-code');
  if (!withCursor) unlinkSync(f.sourcePath);
  assert.deepEqual(await f.hook(),ready);
  let path, attempt, cursor;
  if (withCursor) {
    ({ path,attempt } = await staleAttempt(f));
    cursor = readFileSync(f.cursorPath());
  } else {
    path = startFile(f);
    attempt = { ...JSON.parse(readFileSync(path)),version:attemptVersion,kind:'fresh' };
    createTranscript(f);
    f.append('Synthetic malformed-attempt history');
  }
  const malformed = JSON.stringify(change(attempt));
  writeFileSync(path,malformed);
  assert.deepEqual(await f.hook('Stop'),withCursor ? ready : stateInvalid);
  assert.equal(readFileSync(path,'utf8'),malformed);
  if (withCursor) assert.deepEqual(readFileSync(f.cursorPath()),cursor);
  else assert.deepEqual(readdirSync(f.directory),[]);
  assert.deepEqual(savedRows(f),[]);
});

function setPause(f,paused) {
  const { namespace } = f.request;
  const { generation } = ok(f.core.getCaptureControl({ namespace }));
  ok(f.core.setCapturePaused({ namespace,expectedGeneration:generation,paused }));
}
function setConsent(f,automaticCaptureEnabled,rawNoticeVersion = f.control().rawNoticeVersion) {
  const { namespace,client } = f.request;
  const { targetId,storeId,revision } = f.control();
  ok(f.core.setLocalCaptureControl({ namespace,client,targetId,expectedStoreId:storeId,
    expectedRevision:revision,automaticCaptureEnabled,rawNoticeVersion }));
}
function setRaw(f,enabled) {
  const { namespace:{ ownerId },client } = f.request;
  const { revision } = ok(f.core.getRawCaptureControl({ ownerId,client }));
  ok(f.core.setRawCaptureControl({ ownerId,client,expectedRevision:revision,enabled }));
}
for (const [name,field,change] of [
  ['pause and resume','expectedNamespaceGeneration',(f,during) => { setPause(f,true); during(); setPause(f,false); }],
  ['consent off and on','expectedConsentGeneration',(f,during) => { setConsent(f,false); during(); setConsent(f,true); }],
  ['Raw off and on','expectedRawRevision',(f,during) => { setRaw(f,false); during(); setRaw(f,true); }],
  ['control revision','expectedControlRevision',(f,during) => { setConsent(f,true,null); during(); setConsent(f,true,'local-plain-v1'); }],
]) test(`7. ${name} prevents a staged attempt from recovering old messages`,async t => {
  const f = await lazyFixture(t,'claude-code');
  unlinkSync(f.sourcePath);
  assert.deepEqual(await stopStart(t,f,{ check:5,reason:'cancelled' }),hookOutcome('blocked','cancelled'));
  const path = startFile(f), attempt = readFileSync(path);
  const configPath = join(f.request.installationDirectory,'capture.json');
  const oldAuthority = JSON.parse(readFileSync(configPath)).authority;
  createTranscript(f);
  f.append('Synthetic before change');
  change(f,() => f.append('Synthetic during change'));
  assert.deepEqual(await f.hook('Stop'),hookOutcome('blocked','authority_changed'));
  assert.deepEqual(savedRows(f),[]);
  await activateHostAuthority(profilePath(f),() => {});
  assert.notEqual(JSON.parse(readFileSync(configPath)).authority[field],oldAuthority[field]);
  assert.deepEqual(await f.hook('Stop'),stateInvalid);
  assert.deepEqual(readFileSync(path),attempt);
  assert.deepEqual(readdirSync(f.directory),[]);
  assert.deepEqual(savedRows(f),[]);
  assert.deepEqual(await f.hook(),ready);
  f.append('Synthetic after new boundary');
  assert.deepEqual(await f.hook('Stop'),hookOutcome('progress',null));
  assert.deepEqual(savedRows(f).map(row => row.text),['Synthetic after new boundary']);
});

function onPermission(t,check,observe) {
  let calls = 0, reached = false;
  const prepare = DatabaseSync.prototype.prepare;
  t.mock.method(DatabaseSync.prototype,'prepare',function(sql) {
    if (sql === permissionQuery && ++calls === check) {
      reached = true;
      observe();
    }
    return prepare.call(this,sql);
  });
  return () => assert.equal(reached,true,'reached the in-lock permission query');
}

test('R1 records a host-only cutoff inside a successful worker permission check',async t => {
  const f = await lazyFixture(t,'claude-code');
  writeFileSync(f.sourcePath,'{"type"');
  let elapsed = 0;
  const clock = t.mock.method(performance,'now',() => elapsed);
  const reached = onPermission(t,5,() => { elapsed = 14000; });
  try {
    const outcome = await withLocalHostDependencies({ deadlineMs:15000 },() => runLocalRawHook(hookInput(f)));
    assert.deepEqual(outcome,hookOutcome('blocked','work_limit'));
    reached();
  } finally { clock.mock.restore(); }
  assert.equal(startFiles(f).length,1,'the host-only cutoff recorded an attempt');
  assert.equal(JSON.parse(readFileSync(startFile(f))).kind,'present');
  writeFileSync(f.sourcePath,'');
  f.append('Synthetic history already present at recovery');
  assert.deepEqual(await f.hook('Stop'),ready);
  assert.equal(f.cursor().offset,readFileSync(f.sourcePath).length);
  assert.deepEqual(savedRows(f),[]);
});

test('R2 does not stage a cancellation first seen during session-lock release',async t => {
  const f = await lazyFixture(t,'claude-code');
  const profile = await readHostProfile(profilePath(f)), config = await readHostConfiguration(profile);
  const lockPath = await withSessionIdentity(profile,config,{ sessionId,sourcePath:f.sourcePath },identity => identity.lockPath);
  const controller = new AbortController();
  let elapsed = 0, released = false;
  t.mock.method(performance,'now',() => elapsed);
  const reached = onPermission(t,5,() => { elapsed = 14000; throw Error('synthetic snapshot failure'); });
  const unlink = fs.unlink;
  fs.unlink = async path => {
    if (path === lockPath) {
      released = true;
      controller.abort();
    }
    return unlink(path);
  };
  syncBuiltinESMExports();
  try {
    const outcome = await withLocalHostDependencies({ deadlineMs:15000 },
      () => runLocalRawHook(hookInput(f),{ signal:controller.signal }));
    assert.deepEqual(outcome,hookOutcome('blocked','cancelled'));
    reached();
    assert.equal(released,true,'reached session-lock release');
  } finally { fs.unlink = unlink; syncBuiltinESMExports(); }
  assert.deepEqual(startFiles(f),[],'the cancellation during unlock did not record an attempt');
});

function standaloneHost(f) {
  const url = new URL('../raw/local-host-cli.mjs',import.meta.url);
  const attempt = startFiles(f)[0] ?? '';
  const inject = `data:text/javascript,${encodeURIComponent(`
    import fs from 'node:fs/promises';
    import { syncBuiltinESMExports } from 'node:module';
    import { performance } from 'node:perf_hooks';
    import { DatabaseSync } from 'node:sqlite';
    let elapsed = 0, checks = 0;
    Object.defineProperty(performance,'now',{ value:() => elapsed });
    const prepare = DatabaseSync.prototype.prepare, unlink = fs.unlink;
    DatabaseSync.prototype.prepare = function(sql) {
      if (sql === ${JSON.stringify(permissionQuery)} && ++checks === 4) elapsed = 152900;
      return prepare.call(this,sql);
    };
    fs.unlink = path => {
      if (path === ${JSON.stringify(attempt)} ||
          path.startsWith('/proc/self/fd/') && path.endsWith(${JSON.stringify('/'+basename(attempt))})) {
        elapsed += 200;
        throw Error('synthetic delayed sweep');
      }
      return unlink(path);
    };
    syncBuiltinESMExports();
  `)}`;
  const { status,signal,stdout,stderr,error } = spawnSync(process.execPath,
    ['--no-warnings','--import',inject,fileURLToPath(url),'--profile',profilePath(f),
      'run','--session',sessionId,'--source',f.sourcePath],{ timeout:10000 });
  assert.equal(error,undefined);
  return { status,signal,stdout,stderr };
}

test('R3 preserves the partial-record hook and CLI outcomes near the host cutoff',async t => {
  const f = await lazyFixture(t,'claude-code');
  assert.deepEqual(await f.hook(),ready);
  appendFileSync(f.sourcePath,'{"type"');
  const host = createLocalRawHost({ profilePath:profilePath(f) });
  const selection = { sessionId,sourcePath:f.sourcePath };
  const now = performance.now.bind(performance);
  let elapsed = 0, attempt;
  t.mock.method(performance,'now',() => now()+elapsed);
  const nearCutoff = work => {
    elapsed = 0;
    return withLocalHostDependencies({ deadlineMs:15000,checkpoint(stage) {
      if (stage === 'before_dispatch') elapsed = 11500;
    } },work);
  };
  const unlink = fs.unlink;
  fs.unlink = async path => {
    if (isAttemptPath(path,attempt)) {
      elapsed += 2000;
      throw Error('synthetic delayed sweep');
    }
    return unlink(path);
  };
  syncBuiltinESMExports();
  try {
    const expectedHost = await nearCutoff(() => host.run(selection));
    const expectedHook = await nearCutoff(() => runLocalRawHook(hookInput(f,'Stop')));
    const expectedCli = await nearCutoff(() => cli(f,'Stop'));
    const expectedStandalone = standaloneHost(f);
    assert.deepEqual(expectedHook,hookOutcome('waiting','partial_record'));
    assert.deepEqual(expectedCli,silent);
    assert.equal(expectedStandalone.status,3);
    assert.deepEqual(expectedStandalone.stdout,Buffer.from(JSON.stringify(expectedHost)+'\n'));
    assert.deepEqual(expectedStandalone.stderr,Buffer.alloc(0));
    ({ path:attempt } = await staleAttempt(f));
    const actualHost = await nearCutoff(() => host.run(selection));
    const actualHook = await nearCutoff(() => runLocalRawHook(hookInput(f,'Stop')));
    const actualCli = await nearCutoff(() => cli(f,'Stop'));
    const actualStandalone = standaloneHost(f);
    assert.deepEqual({
      host:JSON.stringify(actualHost),hook:JSON.stringify(actualHook),native:actualCli,standalone:actualStandalone,
    },{
      host:JSON.stringify(expectedHost),hook:JSON.stringify(expectedHook),native:expectedCli,standalone:expectedStandalone,
    },'an earlier attempt leaves the waiting result and CLI bytes unchanged');
    assert.ok(existsSync(attempt),'Stop left the attempt in place');
    t.diagnostic(JSON.stringify({ host:actualHost,hook:actualHook,native:actualCli,
      standalone:{ status:actualStandalone.status,signal:actualStandalone.signal,
        stdout:actualStandalone.stdout.toString('base64'),stderr:actualStandalone.stderr.toString('base64') } }));
  } finally { fs.unlink = unlink; syncBuiltinESMExports(); }
});

function isAttemptPath(path,attempt) {
  return attempt && (path === attempt || path.startsWith('/proc/self/fd/') && basename(path) === basename(attempt));
}



async function busyStart(f,count = 1) {
  const profile = await readHostProfile(profilePath(f));
  const config = await readHostConfiguration(profile);
  const selection = { sessionId,sourcePath:f.sourcePath };
  return withSessionIdentity(profile,config,selection,identity =>
    stateLock(identity.lockPath,() => Promise.all(Array.from({ length:count },() => runLocalRawHook(hookInput(f))))));
}

test('9. concurrent SessionStarts leave one complete attempt',async t => {
  const f = await lazyFixture(t,'claude-code');
  const outcomes = await busyStart(f,4);
  assert.deepEqual(outcomes,Array(4).fill(hookOutcome('busy','state_busy')));
  const files = startFiles(f);
  assert.equal(files.length,1,'one attempt file and no temporary files');
  const attempt = JSON.parse(readFileSync(files[0]));
  assert.deepEqual(Object.keys(attempt).sort(),['authority','kind','source','version']);
  assert.equal(attempt.version,attemptVersion);
  assert.equal(attempt.kind,'present');
});

}
