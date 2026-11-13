import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { lazyFixture } from './fixtures/local-setup-workspace.mjs';
import { sessionId } from './fixtures/raw-fixtures.mjs';
import { runLocalRawHook } from '../raw/local-hook.mjs';

const base = (f,event) => ({hook_event_name:event,session_id:sessionId,transcript_path:f.sourcePath});
function rows(f) {
  const db = new DatabaseSync(f.request.databasePath,{readOnly:true});
  try {
    return {
      messages:db.prepare('SELECT count(*) n FROM raw_messages').get().n,
      text:db.prepare('SELECT sealed FROM raw_parts WHERE saved=1 ORDER BY rowid').all().map(row=>Buffer.from(row.sealed).toString()).join(''),
    };
  } finally { db.close(); }
}
const invoke = (f,event,payload) => f.scoped(()=>runLocalRawHook({installationDirectory:f.request.installationDirectory,event,payload}));

function nativeStart(f) {
  return {...base(f,'SessionStart'),context_tokens:12000,cwd:f.root,estimated_cache_write_usd:0.031,
    prompt_cache_likely_expired:false,scratchpad_dir:join(f.root,'scratchpad'),seconds_since_last_response:4.5,source:'startup'};
}
function nativeStop(f) {
  return {...base(f,'Stop'),background_tasks:[],cwd:f.root,effort:'high',last_assistant_message:'Synthetic reply',
    permission_mode:'default',prompt_id:'synthetic-prompt',scratchpad_dir:join(f.root,'scratchpad'),session_crons:[],stop_hook_active:false};
}

test('Claude Code 2.1.322 SessionStart and Stop key sets capture a synthetic turn',async t => {
  const f = await lazyFixture(t,'claude-code');
  assert.equal((await invoke(f,'SessionStart',nativeStart(f))).status,'ready');
  f.append('Synthetic current native turn');
  assert.equal((await invoke(f,'Stop',nativeStop(f))).status,'progress');
  assert.deepEqual(rows(f),{messages:1,text:'Synthetic current native turn'});
  f.append('Synthetic precompact turn');
  assert.equal((await f.hook('PreCompact',{scratchpad_dir:join(f.root,'scratchpad'),context_tokens:42000,
    estimated_cache_write_usd:0.1,future_metadata:{nested:[1,null,{enabled:true}]},trigger:'auto',custom_instructions:'Synthetic instructions'})).status,'progress');
  assert.deepEqual(rows(f),{messages:2,text:'Synthetic current native turnSynthetic precompact turn'});
});

for (const client of ['claude-code','codex']) for (const [kind,value] of Object.entries({
  number:123.5,string:'x'.repeat(70000),boolean:true,null:null,array:[1,'synthetic',null],object:{nested:{items:[false,42]}},
})) test(`${client} ignores a future ${kind} field on SessionStart and Stop`,async t => {
  const f = await lazyFixture(t,client),extra = {future_native_field:value};
  assert.equal((await f.hook('SessionStart',extra)).status,'ready');
  f.append('Synthetic future field turn');
  assert.equal((await f.hook('Stop',extra)).status,'progress');
  assert.deepEqual(rows(f),{messages:1,text:'Synthetic future field turn'});
});

for (const client of ['claude-code','codex']) test(`${client} ignores native task and cron rows and accepts an unknown source`,async t => {
  const f = await lazyFixture(t,client);
  const extra = {background_tasks:[{id:'synthetic-task',status:'running',future:{cost:3},progress:0.25}],
    session_crons:[{id:'synthetic-cron',schedule:'synthetic',future:[{enabled:true}],count:2}],source:'future-native-source'};
  assert.equal((await f.hook('SessionStart',extra)).status,'ready');
  f.append('Synthetic task row turn');
  assert.equal((await f.hook('Stop',extra)).status,'progress');
  assert.deepEqual(rows(f),{messages:1,text:'Synthetic task row turn'});
});

test('ignored properties are never read, reflected recursively or forwarded',async t => {
  const f = await lazyFixture(t,'claude-code');
  const extra = {};
  Object.defineProperty(extra,'future_native_field',{get(){assert.fail('ignored getter read');}});
  extra.background_tasks = new Proxy({}, {ownKeys(){assert.fail('ignored rows inspected');}});
  extra.session_crons = null;
  const start = {...base(f,'SessionStart')};
  Object.defineProperties(start,Object.getOwnPropertyDescriptors(extra));
  assert.equal((await invoke(f,'SessionStart',start)).status,'ready');
  f.append('Synthetic ignored properties');
  const stop = {...base(f,'Stop')}; Object.defineProperties(stop,Object.getOwnPropertyDescriptors(extra));
  assert.equal((await invoke(f,'Stop',stop)).status,'progress');
  assert.deepEqual(rows(f),{messages:1,text:'Synthetic ignored properties'});
});

test('Codex fork source keeps its capture fence',async t => {
  const f = await lazyFixture(t,'codex');
  assert.deepEqual(await f.hook('SessionStart',{source:'fork',future_native_field:{nested:true}}),
    {version:'local-raw-hook-v1',status:'blocked',reason:'capture_refused'});
  f.append('Synthetic fenced fork');
  assert.equal((await f.hook('Stop')).status,'blocked');
  assert.deepEqual(rows(f),{messages:0,text:''});
});

const refused = {
  'wrong event':p=>({...p,hook_event_name:'PreCompact'}),
  'missing session':({session_id,...p})=>p,
  'empty session':p=>({...p,session_id:''}),
  'oversized session':p=>({...p,session_id:'s'.repeat(201)}),
  'control character session':p=>({...p,session_id:'synthetic\n'}),
  'untrimmed session':p=>({...p,session_id:' synthetic'}),
  'malformed session':p=>({...p,session_id:'\ud800'}),
  'relative transcript':p=>({...p,transcript_path:'relative.jsonl'}),
  'non-string source':p=>({...p,source:42}),
  'oversized source':p=>({...p,source:'x'.repeat(65537)}),
  'populated array':p=>Object.assign([],p),
  'null-prototype array':p=>Object.assign(Object.setPrototypeOf([],null),p),
  'proxy':p=>new Proxy(p,{getPrototypeOf(){assert.fail('proxy reflected');}}),
  'array':()=>[],
  'null':()=>null,
  'string':()=>'synthetic',
  'number':()=>42,
  'boolean':()=>false,
  'non-plain object':p=>Object.assign(Object.create({}),p),
  'used accessor':p=>Object.defineProperty(p,'session_id',{get(){assert.fail('used getter read');}}),
};
for (const [name,change] of Object.entries(refused)) test(`refuses ${name} without capturing`,async t => {
  const f = await lazyFixture(t,'claude-code');
  assert.equal((await invoke(f,'SessionStart',change(base(f,'SessionStart')))).reason,'event_refused');
  assert.equal((await f.hook()).status,'ready'); f.append('Synthetic refused turn');
  const before = readFileSync(f.cursorPath());
  assert.equal((await invoke(f,'Stop',change(base(f,'Stop')))).reason,'event_refused');
  assert.deepEqual(readFileSync(f.cursorPath()),before);
  assert.deepEqual(rows(f),{messages:0,text:''});
});

// Exercise process.stdin, the CLI reader and fail-open exit through a child,
// with only the existing fixture's synthetic host identity injected.
function cli(f,event,input) {
  const modulePath = name => fileURLToPath(new URL(name,import.meta.url));
  const script = `
import { binaryIdentity } from ${JSON.stringify(modulePath('../../codex/qualification.mjs'))};
import { withLocalHostDependencies } from ${JSON.stringify(modulePath('../raw/local-host.mjs'))};
import { runLocalSetupCli } from ${JSON.stringify(modulePath('../raw/local-setup-cli.mjs'))};
const binaryPath=process.argv[1],identity=await binaryIdentity(binaryPath);
process.exitCode=await withLocalHostDependencies({detectHost:async()=>({binaryPath,identity,kind:'cli'})},
()=>runLocalSetupCli(process.argv.slice(2)));
`;
  const result = spawnSync(process.execPath,['--input-type=module','-e',script,f.binary,
    'hook','--installation',f.request.installationDirectory,'--event',event],{input,encoding:'utf8',timeout:30000,
    env:{PATH:'/usr/bin:/bin',HOME:join(f.root,'synthetic-home'),TMPDIR:f.root,NODE_NO_WARNINGS:'1',NODE_DISABLE_COMPILE_CACHE:'1'}});
  assert.equal(result.error,undefined); assert.equal(result.signal,null); assert.equal(result.status,0,result.stderr);
  assert.equal(result.stdout,''); assert.equal(result.stderr,'');
}

test('CLI captures a Stop with about 200 KB of JSON-escaped assistant text',async t => {
  const f = await lazyFixture(t,'claude-code');
  cli(f,'SessionStart',JSON.stringify(nativeStart(f))); f.append('Synthetic large reply turn');
  const message = '"\\\n'.repeat(34000),encoded = JSON.stringify({...nativeStop(f),last_assistant_message:message});
  assert.ok(Buffer.byteLength(encoded)>200000 && Buffer.byteLength(encoded)<210000);
  cli(f,'Stop',encoded);
  assert.deepEqual(rows(f),{messages:1,text:'Synthetic large reply turn'});
});

test('CLI accepts exactly 8 MiB, refuses one byte over, and next Stop recovers the skipped turn',async t => {
  const f = await lazyFixture(t,'claude-code'); cli(f,'SessionStart',JSON.stringify(nativeStart(f)));
  const limit = 8388608,empty = JSON.stringify({...nativeStop(f),last_assistant_message:''});
  const bounded = empty.replace('"last_assistant_message":""','"last_assistant_message":"'+'x'.repeat(limit-Buffer.byteLength(empty))+'"');
  assert.equal(Buffer.byteLength(bounded),limit);
  f.append('Synthetic bounded turn'); cli(f,'Stop',bounded);
  assert.deepEqual(rows(f),{messages:1,text:'Synthetic bounded turn'});
  f.append('Synthetic refused turn'); const before = readFileSync(f.cursorPath());
  cli(f,'Stop',bounded+' ');
  assert.deepEqual(readFileSync(f.cursorPath()),before);
  assert.deepEqual(rows(f),{messages:1,text:'Synthetic bounded turn'});
  f.append('Synthetic recovery turn'); cli(f,'Stop',JSON.stringify(nativeStop(f)));
  assert.deepEqual(rows(f),{messages:3,text:'Synthetic bounded turnSynthetic refused turnSynthetic recovery turn'});
  assert.equal(f.cursor().offset,statSync(f.sourcePath).size);
});

test('CLI ignores deeply nested and numerous unused values; invalid UTF-8 still fails open',async t => {
  const f = await lazyFixture(t,'claude-code'); cli(f,'SessionStart',JSON.stringify(nativeStart(f)));
  f.append('Synthetic structural extras');
  const before = readFileSync(f.cursorPath()); cli(f,'Stop',Buffer.from([0xff]));
  assert.deepEqual(readFileSync(f.cursorPath()),before); assert.deepEqual(rows(f),{messages:0,text:''});
  const nested = '['.repeat(80)+'null'+']'.repeat(80);
  const input = JSON.stringify(nativeStop(f)).slice(0,-1)+',"future_nested":'+nested+',"future_array":['+'null,'.repeat(100001)+'null]}';
  cli(f,'Stop',input);
  assert.deepEqual(rows(f),{messages:1,text:'Synthetic structural extras'});
});

test('a refused SessionStart provides no position for a later Stop to recover',async t => {
  const f = await lazyFixture(t,'claude-code');
  assert.equal((await f.hook('SessionStart',{hook_event_name:'wrong'})).reason,'event_refused');
  f.append('Synthetic turn without a start');
  assert.equal((await f.hook('Stop')).status,'blocked');
  assert.deepEqual(rows(f),{messages:0,text:''});
  assert.equal((await f.hook()).status,'ready');
  f.append('Synthetic later initialized turn');
  assert.equal((await f.hook('Stop')).status,'progress');
  assert.deepEqual(rows(f),{messages:1,text:'Synthetic later initialized turn'});
});

for (const client of ['claude-code','codex']) for (const source of [null,'x'.repeat(65536)]) test(`${client} accepts ${source === null ? 'null as absent' : '65536 source characters'}`,async t => {
  const f = await lazyFixture(t,client);
  assert.equal((await f.hook('SessionStart',{source})).status,'ready');
  f.append('Synthetic bounded source turn');
  assert.equal((await f.hook('Stop',{source})).status,'progress');
  assert.deepEqual(rows(f),{messages:1,text:'Synthetic bounded source turn'});
});
