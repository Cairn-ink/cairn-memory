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
import { withSourceReadObserver } from '../../../integrations/codex/source.mjs';
import { fixture as codexFixture, session, header, item } from '../../../integrations/codex/test/helpers.mjs';
import { createHostedTransport } from '../../../integrations/client/transport-hosted.mjs';
import { sessionContext } from './hosted-fixtures.mjs';

const hook = fileURLToPath(new URL('../scripts/hook.mjs', import.meta.url));
const id = 'HOST_CONVERSATION_CANARY';
const rejection = { error: 'Invalid session-start payload.', issues: [
  { code: 'unrecognized_keys', keys: ['session_id'], path: [], message: 'synthetic' },
] };

async function claude(t, legacy) {
  const ws = createTestWorkspace(t, { prefix: 'session-start-hook-' });
  const home = join(ws.path, 'home'); const root = join(home, 'data');
  await mkdir(root, { recursive: true, mode: 0o700 });
  const log = join(ws.path, 'requests.jsonl');
  const preload = join(ws.path, 'fetch.mjs');
  await writeFile(preload, `import { appendFile } from 'node:fs/promises';
const legacy = ${legacy};
globalThis.fetch = async (url, wire) => {
  const body = JSON.parse(wire.body);
  await appendFile(process.env.CAIRN_TEST_REQUEST_LOG, JSON.stringify({url, body})+'\\n');
  return legacy && Object.hasOwn(body, 'session_id') ?
    Response.json(${JSON.stringify(rejection)}, {status:400}) :
    Response.json(${JSON.stringify(sessionContext())});
};\n`);
  const env = { PATH: process.env.PATH, HOME: home, TMPDIR: process.env.TMPDIR,
    NODE_OPTIONS: process.env.NODE_OPTIONS, CAIRN_TEST_REAL_HOME: process.env.CAIRN_TEST_REAL_HOME,
    CLAUDE_PLUGIN_DATA: root, CLAUDE_PLUGIN_OPTION_TELEMETRY: 'false',
    CLAUDE_PLUGIN_OPTION_API_ENDPOINT: 'https://synthetic.invalid',
    CLAUDE_PLUGIN_OPTION_API_TOKEN: 'synthetic-token', CAIRN_TEST_REQUEST_LOG: log };
  let sequence = 0;
  async function run(input, overrides = {}) {
    const stem = join(ws.path, `hook-${++sequence}`);
    await writeFile(stem + '.in', JSON.stringify(input), {mode:0o600});
    const descriptors = [openSync(stem + '.in', 'r'), openSync(stem + '.out', 'wx', 0o600),
      openSync(stem + '.err', 'wx', 0o600)];
    const child = spawn(process.execPath, ['--import', preload, hook, 'start'], {
      env: { ...env, ...overrides }, stdio: descriptors,
    });
    for (const fd of descriptors) closeSync(fd);
    const done = new Promise((resolve, reject) => {
      child.once('error', reject); child.once('close', resolve);
    });
    ws.defer(async () => { if (child.exitCode === null) child.kill(); await done; });
    assert.equal(await done, 0);
    assert.equal(await readFile(stem + '.out', 'utf8'), '');
    assert.equal(await readFile(stem + '.err', 'utf8'), '');
  }
  async function requests() {
    try { return (await readFile(log, 'utf8')).trim().split('\n').map(JSON.parse); }
    catch (e) { if (e.code === 'ENOENT') return []; throw e; }
  }
  return { run, requests, root };
}

for (const legacy of [false, true]) {
  test(`Claude SessionStart sends only the host id to ${legacy ? 'old' : 'new'} server, quietly honors pause`, async t => {
    const f = await claude(t, legacy);
    await f.run({ session_id: id, prompt: 'MODEL_ID_CANARY', conversation_id: 'EXTRA_ID_CANARY' });
    const first = await f.requests();
    assert.deepEqual(first.map(x => x.body), legacy ? [{ version: 1, session_id: id }, { version: 1 }] :
      [{ version: 1, session_id: id }]);
    assert.ok(first.every(x => x.url.endsWith('/api/memory/session-start')));
    for (const session_id of [undefined, '', null, 123, 'x'.repeat(201), '\ud800', 'line\nbreak']) {
      await f.run({ session_id, prompt: 'MODEL_ID_CANARY' });
      assert.deepEqual((await f.requests()).at(-1).body, {version:1});
    }
    const count = (await f.requests()).length;
    await setPaused(f.root, true);
    await f.run({session_id:id});
    assert.equal((await f.requests()).length, count);
    await setPaused(f.root, false);
    await f.run({session_id:id}, {CLAUDE_PLUGIN_OPTION_API_TOKEN:''});
    assert.equal((await f.requests()).length, count);
  });
  test(`Codex SessionStart passes the host session_id to ${legacy ? 'old' : 'new'} server even without a transcript`, async t => {
    const f = await codexFixture(t, {text:header()+item('Synthetic preference')});
    await runWorker(f.binding, {guard:f.guard, transport:f.transport});
    const captureSessionId = f.calls[0].session_id;
    assert.notEqual(captureSessionId, session);
    const requests = []; const original = globalThis.fetch;
    globalThis.fetch = async (_, wire) => {
      const body = JSON.parse(wire.body); requests.push(body);
      return legacy && Object.hasOwn(body, 'session_id') ? Response.json(rejection, {status:400}) :
        Response.json(sessionContext());
    };
    f.ws.defer(() => { globalThis.fetch = original; });
    const port = createHostedTransport({ root:f.root, endpoint:'https://synthetic.invalid', token:'synthetic-token' });
    const options = { clientOptions:{ home:f.home, root:f.root, usesClaude:false, env:{} },
      targetId:f.binding.targetId,
      sessionStart:(request, {signal, dispatch}) => port.sessionStart(request, {countTokens:()=>100}, signal, dispatch) };
    const input = {hook_event_name:'SessionStart', session_id:session, cwd:'/synthetic', transcript_path:null,
      prompt:'MODEL_ID_CANARY', conversation_id:'EXTRA_ID_CANARY'};
    const result = await handleHook(input, options);
    assert.equal(result.output, ''); assert.equal(result.status, 'complete');
    assert.deepEqual(requests, legacy ? [{version:1,session_id:captureSessionId,max_tokens:1500,max_chars:6000},
      {version:1,max_tokens:1500,max_chars:6000}] :
      [{version:1,session_id:captureSessionId,max_tokens:1500,max_chars:6000}]);
    const count = requests.length;
    await setPaused(f.root, true);
    assert.equal((await handleHook(input, options)).status, 'paused');
    assert.equal(requests.length, count);
    await setPaused(f.root, false);
    assert.equal((await handleHook(input, {...options, sessionStart:undefined, launch:()=>{}})).status, 'source_unavailable');
    assert.equal(requests.length, count);
    assert.equal((await handleHook({...input, session_id:''}, options)).status, 'capture_unavailable');
    assert.equal(requests.length, count);
    // The supplied read port must preserve the existing one-byte capture
    // boundary, even when a source is present after pause/resume.
    let bytes = 0;
    assert.equal((await withSourceReadObserver(({start,end}) => bytes += end-start,
      () => handleHook({...input,transcript_path:f.path}, options))).status, 'complete');
    assert.equal(bytes, 1);
    assert.equal(requests[count].session_id, captureSessionId);
    assert.equal((await handleHook(input, {...options, sessionStart:() => {throw new Error(session);}})).output, '');
  });
}
