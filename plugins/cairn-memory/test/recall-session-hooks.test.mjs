import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { openSync, closeSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { setPaused } from '../lib/control-state.mjs';
import { handleHook } from '../../../integrations/codex/hook.mjs';
import { runWorker } from '../../../integrations/codex/worker.mjs';
import { fixture as codexFixture, session, header, item } from '../../../integrations/codex/test/helpers.mjs';
import { createHostedTransport } from '../../../integrations/client/transport-hosted.mjs';

const hook = fileURLToPath(new URL('../scripts/hook.mjs', import.meta.url));
const id = 'HOST_CONVERSATION_CANARY';
const rejection = { error: 'Invalid recall payload.', issues: [
  { code: 'unrecognized_keys', keys: ['session_id'], path: [], message: 'synthetic' },
] };

async function claude(t, legacy) {
  const ws = createTestWorkspace(t, { prefix: 'recall-session-hook-' });
  const home = join(ws.path, 'home'); const root = join(home, 'data');
  await mkdir(root, { recursive: true, mode: 0o700 });
  const transcript=join(home,'synthetic.jsonl');
  await writeFile(transcript,JSON.stringify({type:'user',uuid:'synthetic-message',message:{content:'Synthetic capture'}})+'\n');
  const log = join(ws.path, 'requests.jsonl');
  const preload = join(ws.path, 'fetch.mjs');
  await writeFile(preload, `import { appendFile } from 'node:fs/promises';
import crypto from 'node:crypto';
import { syncBuiltinESMExports } from 'node:module';
crypto.randomUUID = () => '11111111-1111-4111-8111-111111111111';
syncBuiltinESMExports();
const legacy = ${legacy};
globalThis.fetch = async (url, wire) => {
  const body = JSON.parse(wire.body);
  await appendFile(process.env.CAIRN_TEST_REQUEST_LOG, JSON.stringify({url, body})+'\\n');
  if (url.endsWith('/capture')) return Response.json({duplicate:false,memoryCount:1});
  return legacy && Object.hasOwn(body, 'session_id') ?
    Response.json(${JSON.stringify(rejection)}, {status:400}) :
    Response.json(${JSON.stringify({memories:[{id:'12345678-1234-4234-8234-123456789abc',content:'Synthetic remembered work',kind:'fact',scope:'personal',projectId:null,origin:'explicit',confidence:1,createdAt:'2026-10-01T00:00:00Z',updatedAt:'2026-10-01T00:00:00Z',receipts:[{client:'claude-code',sessionId:'source-session',eventId:'source-event',role:'user',excerpt:'Synthetic source',createdAt:'2026-10-01T00:00:00Z'}]}]})});
};\n`);
  const env = { PATH: process.env.PATH, HOME: home, TMPDIR: process.env.TMPDIR,
    NODE_OPTIONS: process.env.NODE_OPTIONS, CAIRN_TEST_REAL_HOME: process.env.CAIRN_TEST_REAL_HOME,
    CLAUDE_PLUGIN_DATA: root, CLAUDE_PLUGIN_OPTION_TELEMETRY: 'false',
    CLAUDE_PLUGIN_OPTION_API_ENDPOINT: 'https://synthetic.invalid',
    CLAUDE_PLUGIN_OPTION_API_TOKEN: 'synthetic-token', CAIRN_TEST_REQUEST_LOG: log };
  let sequence = 0;
  async function run(input, overrides = {}, action = 'recall') {
    const stem = join(ws.path, `hook-${++sequence}`);
    await writeFile(stem + '.in', JSON.stringify(input), {mode:0o600});
    const descriptors = [openSync(stem + '.in', 'r'), openSync(stem + '.out', 'wx', 0o600),
      openSync(stem + '.err', 'wx', 0o600)];
    const child = spawn(process.execPath, ['--import', preload, hook, action], {
      env: { ...env, ...overrides }, stdio: descriptors,
    });
    for (const fd of descriptors) closeSync(fd);
    const done = new Promise((resolve, reject) => {
      child.once('error', reject); child.once('close', resolve);
    });
    ws.defer(async () => { if (child.exitCode === null) child.kill(); await done; });
    assert.equal(await done, 0);
    const stdout = await readFile(stem + '.out', 'utf8');
    assert.equal(await readFile(stem + '.err', 'utf8'), '');
    assert.ok(!stdout.includes(id));
    return stdout;
  }
  async function requests() {
    try { return (await readFile(log, 'utf8')).trim().split('\n').map(JSON.parse); }
    catch (e) { if (e.code === 'ENOENT') return []; throw e; }
  }
  return { run, requests, root, transcript };
}

for (const legacy of [false, true]) {
  test(`Claude injects recall from ${legacy ? 'old' : 'new'} server with host id, no startup read or nested lock`, async t => {
    const f = await claude(t, legacy);
    const input = { session_id:id, cwd:'/synthetic', prompt:'Synthetic question', conversation_id:'MODEL_ID_CANARY' };
    assert.equal(await f.run(input, {}, 'start'), '');
    assert.deepEqual(await f.requests(), []);
    const output = JSON.parse(await f.run(input));
    assert.equal(output.hookSpecificOutput.hookEventName, 'UserPromptSubmit');
    assert.match(output.hookSpecificOutput.additionalContext, /Synthetic remembered work/);
    const first = await f.requests();
    assert.equal(first.length, legacy ? 2 : 1);
    assert.equal(first[0].body.session_id, id);
    assert.ok(first.every(x => x.url.endsWith('/api/memory/recall')));
    assert.ok(!JSON.stringify(first).includes('MODEL_ID_CANARY'));
    const {session_id:_,...withoutId}=first[0].body;
    if (legacy) assert.deepEqual(first[1].body, withoutId);
    for (const session_id of [undefined, '', null, 123, 'x'.repeat(201), '中文', 'a😀', '\ud800', 'line\nbreak', 'a\n', 'with space', 'with/slash']) {
      assert.match(await f.run({...input,session_id}), /Synthetic remembered work/);
      assert.deepEqual((await f.requests()).at(-1).body, withoutId);
    }
    assert.equal(await f.run({...input,transcript_path:f.transcript}, {}, 'capture'), '');
    assert.ok((await f.requests()).at(-1).url.endsWith('/capture'));
    assert.equal((await f.requests()).at(-1).body.session_id,id);
    const count = (await f.requests()).length;
    await setPaused(f.root, true);
    assert.equal(await f.run(input), '');
    assert.equal((await f.requests()).length, count);
    await setPaused(f.root, false);
    assert.equal(await f.run(input, {CLAUDE_PLUGIN_OPTION_API_TOKEN:''}), '');
    assert.equal((await f.requests()).length, count);
  });
}

for (const legacy of [false, true]) {
  test(`Claude personal recall without cwd reaches context on ${legacy ? 'old' : 'new'} servers`, async t => {
    const f = await claude(t, legacy);
    for (const cwd of [undefined, '']) {
      for (const session_id of [id, undefined]) {
        const before = (await f.requests()).length;
        const input = {prompt:'Synthetic question',
          ...(cwd === undefined ? {} : {cwd}),
          ...(session_id === undefined ? {} : {session_id})};
        const stdout = await f.run(input);
        assert.notEqual(stdout, '', 'personal recall must inject memories even without cwd');
        assert.match(JSON.parse(stdout).hookSpecificOutput.additionalContext, /Synthetic remembered work/);
        const sent = (await f.requests()).slice(before);
        const expected = {query:'Synthetic question', limit:6,
          ...(session_id === undefined ? {} : {session_id})};
        assert.deepEqual(sent.map(request => request.body), legacy && session_id !== undefined ?
          [expected, {query:'Synthetic question', limit:6}] : [expected]);
        assert.ok(sent.every(request => request.url.endsWith('/api/memory/recall')));
      }
    }
  });
}

test('Codex keeps prompt recall disabled; its hosted recall port uses capture wire identity and omits invalid ids', async t => {
  const f=await codexFixture(t, {text:header()+item('Synthetic preference')});
  await runWorker(f.binding, {guard:f.guard,transport:f.transport});
  const wireId=f.calls[0].session_id;
  const requests=[];const original=globalThis.fetch;
  globalThis.fetch=async (_,wire)=>{requests.push(JSON.parse(wire.body));return Response.json({memories:[]});};
  f.ws.defer(()=>{globalThis.fetch=original;});
  const options={clientOptions:{home:f.home,root:f.root,usesClaude:false,env:{}},targetId:f.binding.targetId,launch:()=>{throw new Error('unexpected capture');}};
  const input={hook_event_name:'UserPromptSubmit',session_id:session,cwd:'/synthetic',transcript_path:f.path,prompt:'Synthetic question'};
  assert.equal((await handleHook(input,options)).status,'context_unavailable');
  assert.deepEqual(requests,[]);
  const port=createHostedTransport({root:f.root,endpoint:'https://synthetic.invalid',token:'synthetic-token'});
  assert.equal((await port.recall('Synthetic',{sessionId:wireId})).status,'complete');
  assert.deepEqual(requests[0],{query:'Synthetic',limit:6,session_id:wireId});
  assert.notEqual(wireId,session);
  for(const sessionId of [undefined,'',null,'中文','a😀','a\n','bad/id','x'.repeat(201)]) {
    assert.equal((await port.recall('Synthetic',{sessionId})).status,'complete');
    assert.deepEqual(requests.at(-1),{query:'Synthetic',limit:6});
  }
});
