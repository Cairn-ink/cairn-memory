import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import childProcess from 'node:child_process';
import { register, syncBuiltinESMExports } from 'node:module';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

// Test-only host substitution for malformed host outcomes. Real behavior is the
// default, including every capture, filesystem spy and transport-failure test.
register('data:text/javascript,'+encodeURIComponent(`
export async function load(url,context,next) {
  const result = await next(url,context);
  if (!url.endsWith('/integrations/client/raw/local-host.mjs')) return result;
  const source = String(result.source).replace('export function createLocalRawHost(', 'function actualLocalRawHost(');
  return {...result,source:source+'\\nexport function createLocalRawHost(...args) { return globalThis[Symbol.for("cairn.test.hook.host")]?.(...args) ?? actualLocalRawHost(...args); }'};
}`),import.meta.url);
const { lazyFixture } = await import('./fixtures/local-setup-workspace.mjs');
const { runLocalRawHook, hookReasons } = await import('../raw/local-hook.mjs');
const { events } = await import('../raw/local-setup-files.mjs');
const { withWriteObserver } = await import('../private-state.mjs');
const { sessionId } = await import('./fixtures/raw-fixtures.mjs');
const { reasons:workerReasons } = await import('../raw/local-worker-input.mjs');

const input = (f,event) => ({installationDirectory:f.request.installationDirectory,event,
  payload:{hook_event_name:event,session_id:sessionId,transcript_path:f.sourcePath}});
const hook = (f,event,options={}) => f.scoped(()=>runLocalRawHook(input(f,event),options));
const skip = {version:'local-raw-hook-v1',status:'ready',reason:'headless_skipped'};
function saved(f) {
  const db = new DatabaseSync(f.request.databasePath,{readOnly:true});
  try { return db.prepare('SELECT sealed FROM raw_parts WHERE saved=1 ORDER BY rowid').all().map(row=>Buffer.from(row.sealed).toString()).join(''); }
  finally { db.close(); }
}
function stateSnapshot(path) {
  const result = {};
  function visit(directory) {
    for (const name of fs.readdirSync(directory)) {
      const path = join(directory,name),info = fs.lstatSync(path);
      result[path] = {ino:info.ino,mtimeMs:info.mtimeMs,ctimeMs:info.ctimeMs,mode:info.mode,
        ...(info.isFile() ? {bytes:fs.readFileSync(path).toString('hex')}: {})};
      if (info.isDirectory()) visit(path);
    }
  }
  visit(path); return result;
}
for (const seeded of [false,true]) test(`headless Claude has no transcript or state access (existing state: ${seeded})`,async t => {
  const f = await lazyFixture(t,'claude-code');
  assert.deepEqual(events('claude-code'),['SessionStart','Stop','PreCompact']);
  if (seeded) { await f.hook(); f.append('Synthetic saved before headless'); await f.hook('Stop'); }
  const state = join(f.request.installationDirectory,'state'),before = stateSnapshot(state),accesses = [],writes = [];
  const inside = path => typeof path === 'string' && [f.request.sourceRoot,state].some(root=>path===root || path.startsWith(root+'/'));
  // Observe the real fs methods, including metadata probes and sync APIs. No
  // source open means no source FileHandle can escape observation of its reads.
  for (const [module,names] of [[fsp,['open','stat','lstat','realpath','readFile','readdir','access','mkdir','writeFile','rename','unlink','link','rm']],
    [fs,['openSync','statSync','lstatSync','realpathSync','readFileSync','readdirSync','accessSync','mkdirSync','writeFileSync','renameSync','unlinkSync']]]) {
    for (const name of names) {
      const original = module[name];
      t.mock.method(module,name,function(...args) {
        if (args.some(inside)) accesses.push({name,path:args.find(inside)});
        return Reflect.apply(original,this,args);
      });
    }
  }
  syncBuiltinESMExports();
  try {
    await withWriteObserver(value=>writes.push(value),async()=>{
      for (const event of events('claude-code')) {
        assert.deepEqual(await hook(f,event,{headless:true}),skip);
      }
    });
    assert.deepEqual(accesses,[],'no transcript/stat/read or session-state access');
    assert.deepEqual(writes,[],'no durable writes anywhere during skip');
  } finally { t.mock.restoreAll(); syncBuiltinESMExports(); }
  assert.deepEqual(stateSnapshot(state),before,'all state contents and metadata unchanged');
});

test('headless skip precedes host creation and status, but follows installation phase validation',async t => {
  const f = await lazyFixture(t,'claude-code'),key = Symbol.for('cairn.test.hook.host');
  globalThis[key] = () => { assert.fail('headless hook created a host'); };
  try { assert.deepEqual(await hook(f,'Stop',{headless:true}),skip); }
  finally { delete globalThis[key]; }
  await f.invoke('disable');
  assert.equal((await hook(f,'Stop',{headless:true})).reason,'authority_changed');
});

for (const options of [{},{headless:false}]) test(`interactive Claude saves turns with options ${JSON.stringify(options)}`,async t => {
  const f = await lazyFixture(t,'claude-code');
  assert.equal((await hook(f,'SessionStart',options)).status,'ready');
  f.append('Synthetic interactive capture');
  assert.equal((await hook(f,'Stop',options)).status,'progress');
  assert.equal(saved(f),'Synthetic interactive capture');
});
for (const headless of [undefined,null,0,1,'true',{},[]]) test(`headless type is strict: ${JSON.stringify(headless)}`,async t => {
  const f = await lazyFixture(t,'claude-code');
  assert.equal((await hook(f,'SessionStart',{headless})).reason,'invalid_input');
});

test('Codex never skips with headless true; fork still fences and exec is refused',async t => {
  const f = await lazyFixture(t,'codex');
  assert.equal((await hook(f,'SessionStart',{headless:true})).status,'ready');
  f.append('Synthetic Codex capture');
  assert.equal((await hook(f,'Stop',{headless:true})).status,'progress');
  assert.equal(saved(f),'Synthetic Codex capture');
  const fork = input(f,'SessionStart'); fork.payload.source = 'fork';
  assert.deepEqual(await f.scoped(()=>runLocalRawHook(fork,{headless:true})),
    {version:'local-raw-hook-v1',status:'blocked',reason:'capture_refused'});
  f.setExec(true);
  assert.equal((await hook(f,'Stop',{headless:true})).status,'blocked');
});

const cliPath = fileURLToPath(new URL('../raw/local-setup-cli.mjs',import.meta.url));
for (const entrypoint of [undefined,'sdk-cli','sdk-ts','sdk-py','sdk-future','cli','claude-vscode','unknown','SDK-cli','']) {
  test(`CLI entrypoint ${JSON.stringify(entrypoint)} skips only sdk- and stays silent`,async t => {
    const f = await lazyFixture(t,'claude-code'),env = {PATH:'/usr/bin:/bin',HOME:join(f.root,'synthetic-home'),
      TMPDIR:f.root,NODE_NO_WARNINGS:'1',NODE_DISABLE_COMPILE_CACHE:'1'};
    if (entrypoint !== undefined) env.CLAUDE_CODE_ENTRYPOINT = entrypoint;
    const skipped = typeof entrypoint === 'string' && entrypoint.startsWith('sdk-');
    const before = stateSnapshot(join(f.request.installationDirectory,'state'));
    const invoke = event => {
      const result = childProcess.spawnSync(process.execPath,[cliPath,'hook','--installation',f.request.installationDirectory,'--event',event],
        {env,input:JSON.stringify(input(f,event).payload),encoding:'utf8',timeout:30000});
      assert.equal(result.status,0,JSON.stringify(result)); assert.equal(result.signal,null);
      assert.equal(result.stdout,''); assert.equal(result.stderr,'');
    };
    invoke('SessionStart'); f.append('Synthetic CLI capture'); invoke('Stop');
    assert.equal(saved(f),skipped ? '':'Synthetic CLI capture');
    if (skipped) assert.deepEqual(stateSnapshot(join(f.request.installationDirectory,'state')),before);
  });
}
test('CLI reads exactly one environment key once and only in the hook branch',() => {
  const source = fs.readFileSync(cliPath,'utf8');
  assert.deepEqual(source.match(/process\s*\.\s*env\b[^;\n]*/g),['process.env.CLAUDE_CODE_ENTRYPOINT']);
  const start = source.indexOf('} else if (hook &&'),end = source.indexOf('// Fail open',start);
  assert.match(source.slice(start,end),/const value = process.env.CLAUDE_CODE_ENTRYPOINT;/);
});
test('headless reason is explicitly allow-listed',()=>assert.ok(hookReasons.includes('headless_skipped')));

test('real host and worker preserve blocked unavailable from a transport failing before delivery',async t => {
  const f = await lazyFixture(t,'claude-code'); await f.hook(); f.append('Synthetic unavailable turn');
  let calls = 0;
  t.mock.method(childProcess,'spawn',()=>{ calls++; throw new Error('Synthetic transport unavailable'); });
  syncBuiltinESMExports();
  try {
    assert.deepEqual(await hook(f,'Stop'),{version:'local-raw-hook-v1',status:'blocked',reason:'unavailable'});
    assert.ok(calls>0,'real transport attempted its subprocess');
  } finally { t.mock.restoreAll(); syncBuiltinESMExports(); }
  assert.equal(saved(f),'');
});
for (const missing of [false,true]) test(`host outcomes use canonical reason validation (missing source: ${missing})`,async t => {
  const f = await lazyFixture(t,'claude-code'),key = Symbol.for('cairn.test.hook.host');
  if (missing) fs.unlinkSync(f.sourcePath);
  let outcome;
  globalThis[key] = () => ({status:async()=>({status:'ready'}),markStart:async()=>outcome,initialize:async()=>outcome,run:async()=>outcome});
  try {
    for (const reason of [...workerReasons,'source_unqualified','unexpected_failure','unknown private text']) {
      outcome = {status:'blocked',reason};
      const result = await hook(f,'SessionStart');
      assert.equal(result.status,'blocked');
      assert.equal(result.reason,reason==='unknown private text' ? 'unexpected_failure':reason);
    }
    for (const status of ['ready',...(missing ? []:['progress'])]) {
      outcome = {status,reason:'initialized'};
      assert.equal((await hook(f,missing ? 'SessionStart':'Stop')).reason,null);
    }
  } finally { delete globalThis[key]; }
});
