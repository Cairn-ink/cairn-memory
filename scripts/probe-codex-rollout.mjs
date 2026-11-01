#!/usr/bin/env node
// Offline native writes, distinct from synthetic seeded history readback.
import { isolateProbe } from './codex-probe-isolation.mjs';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { collectEvidence } from '../integrations/codex/schema-evidence.mjs';
import { parseLine, verifyHeader } from '../integrations/codex/parser.mjs';

const isolation = isolateProbe();
const args = process.argv.slice(2), option = name => args[args.indexOf(name) + 1];
if (!args.includes('--binary') || !args.includes('--out')) throw new Error('usage: --binary <native> --out <new-private-dir>');
const binary = resolve(option('--binary')), root = resolve(option('--out'));
await mkdir(root, { mode: 0o700 });
const home = join(root, 'home'), codexHome = join(home, '.codex'), cwd = join(root, 'project');
for (const path of [home, codexHome, cwd]) await mkdir(path, { recursive: true, mode: 0o700 });
const env = { HOME: home, CODEX_HOME: codexHome, PATH: '/usr/bin:/bin', LANG: 'C.UTF-8' };
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const qa = name => [{ role: 'user', content: 'Synthetic question ' + name + '.' },
  { role: 'assistant', content: 'Synthetic answer ' + name + '.' }];
const expected = { final: qa('final'), 'two-turns': [...qa('two-turns'), ...qa('two-turns')],
  'partial-final': [{ role: 'user', content: 'Synthetic question partial-final.' },
    { role: 'assistant', content: 'First stable section.' }, { role: 'assistant', content: 'Second terminal section.' }],
  resume: [...qa('resume'), ...qa('resume')], interrupted: [{ role: 'user', content: 'Synthetic question interrupted.' }],
  tool: qa('tool'), 'hooks-recall': qa('hooks-recall'), 'compaction-before': [...qa('compaction-before'), ...qa('compaction-after')] };
const save = (name, value) => writeFile(join(root, name), typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
const evidence = await collectEvidence(binary, join(root, 'evidence'));
// Negative marker evidence is distinct from a strict successful collection.
const historical = JSON.parse(await readFile(new URL('../integrations/codex/test/fixtures/binary-0.162.0/format.json', import.meta.url)));
const binaryBytes = await readFile(binary), markerPresence = {};
for (const marker of new Set([...historical.serdeMarkers, ...evidence.evidence.serdeMarkers])) {
  const offset = binaryBytes.indexOf(Buffer.from(marker));
  markerPresence[marker] = { offset, ...(offset < 0 ? {} : { excerpt: marker }) };
}
await save('marker-presence.json', markerPresence);
const requests = [], rpc = [], exits = [], cases = [], bestEffort = [];
let activeCase, serial = 0, interruptedReady, stderr = '', unexpected = [];
const sockets = new Set();
const mock = createServer(async (request, response) => {
  const chunks = []; for await (const chunk of request) chunks.push(chunk);
  const body = Buffer.concat(chunks).toString();
  requests.push({ case: activeCase, method: request.method, url: request.url, body: JSON.parse(body || '{}') });
  if (request.method !== 'POST' || request.url !== '/v1/responses') {
    unexpected.push({ method: request.method, url: request.url }); response.writeHead(404).end(); return;
  }
  response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
  const id = 'response-' + ++serial;
  const emit = (type, fields) => response.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...fields })}\n\n`);
  const item = (suffix, text, phase = 'final_answer') => ({ type: 'message', id: id + suffix,
    role: 'assistant', status: 'completed', content: [{ type: 'output_text', text, annotations: [] }], phase });
  emit('response.created', { response: { id, status: 'in_progress', output: [] } });
  if (activeCase === 'interrupted') {
    const pending = item('-unfinished', 'UNFINISHED_CANARY', 'partial_answer');
    emit('response.output_item.added', { output_index: 0, item: { ...pending, status: 'in_progress', content: [] } });
    emit('response.output_text.delta', { item_id: pending.id, output_index: 0, content_index: 0, delta: 'UNFINISHED_CANARY' });
    interruptedReady?.(); return; // turn/interrupt must cancel this held stream.
  }
  let output;
  if (activeCase === 'tool' && !requests.filter(row => row.case === 'tool').slice(0, -1).length) {
    output = [{ type: 'function_call', id: id + '-tool', call_id: id + '-call', name: 'synthetic_function', arguments: '{"value":"benign"}', status: 'completed' }];
  } else output = activeCase === 'partial-final' ? [item('-partial', 'First stable section.', 'partial_answer'), item('-final', 'Second terminal section.')] :
    [item('-final', activeCase === 'compaction' ? 'Synthetic checkpoint summary.' : 'Synthetic answer ' + activeCase + '.')];
  for (const [index, completed] of output.entries()) {
    emit('response.output_item.added', { output_index: index, item: { ...completed, status: 'in_progress', ...(completed.type === 'message' ? { content: [] } : { arguments: '' }) } });
    if (completed.type === 'message') emit('response.output_text.delta', { item_id: completed.id, output_index: index, content_index: 0, delta: completed.content[0].text });
    emit('response.output_item.done', { output_index: index, item: completed });
  }
  emit('response.completed', { response: { id, status: 'completed', output, usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 } } });
  response.end();
});
mock.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
await new Promise(done => mock.listen(0, '127.0.0.1', done));
const config = [
  'model = "synthetic-offline"', 'model_provider = "offline"', 'compact_prompt = "SYNTHETIC_CHECKPOINT_PROMPT"',
  '[model_providers.offline]', 'name = "Offline rollout probe"',
  `base_url = "http://127.0.0.1:${mock.address().port}/v1"`, 'wire_api = "responses"', 'requires_openai_auth = false',
  'supports_websockets = false', 'request_max_retries = 0', 'stream_max_retries = 0',
  '[analytics]', 'enabled = false', '[feedback]', 'enabled = false',
  '[features]', 'hooks = true', 'plugins = false', 'apps = false', 'memories = false', '',
].join('\n');
await writeFile(join(codexHome, 'config.toml'), config, { mode: 0o600 });

async function server(work) {
  const child = spawn(binary, ['app-server', '--listen', 'stdio://'], { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
  const exit = new Promise((done, reject) => { child.once('error', reject); child.once('close', (code, signal) => done({ code, signal })); });
  const pending = new Map(), notifications = []; let next = 0, buffer = '';
  const watchdog = setTimeout(() => child.kill('SIGKILL'), 90000);
  child.stderr.on('data', chunk => { stderr += chunk; });
  child.stdout.on('data', chunk => {
    buffer += chunk;
    for (;;) {
      const newline = buffer.indexOf('\n'); if (newline < 0) break;
      const row = JSON.parse(buffer.slice(0, newline)); buffer = buffer.slice(newline + 1); rpc.push(row);
      if (row.method === 'item/tool/call' && row.id !== undefined) {
        const reply = { id: row.id, result: { contentItems: [{ type: 'inputText', text: 'SYNTHETIC_TOOL_OK' }], success: true } };
        rpc.push({ direction: 'response', ...reply }); child.stdin.write(JSON.stringify(reply) + '\n');
      }
      else if (row.id !== undefined && pending.has(row.id)) { pending.get(row.id)(row); pending.delete(row.id); }
      else notifications.push(row);
    }
  });
  async function call(method, params) {
    const id = ++next; rpc.push({ direction: 'request', id, method, params }); let timer;
    const reply = new Promise(done => { pending.set(id, done); timer = setTimeout(() => done({ error: { message: 'native_rpc_timeout: ' + method } }), 20000); });
    child.stdin.write(JSON.stringify({ id, method, params }) + '\n');
    const answer = await reply; clearTimeout(timer); pending.delete(id);
    if (answer.error) throw new Error(JSON.stringify(answer.error)); return answer.result;
  }
  async function wait(method, predicate = () => true) {
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      const index = notifications.findIndex(row => row.method === method && predicate(row.params));
      if (index >= 0) return notifications.splice(index, 1)[0].params;
      await new Promise(done => setTimeout(done, 10));
    }
    throw new Error('native_notification_timeout: ' + method);
  }
  try {
    await call('initialize', { clientInfo: { name: 'codex-tui', version: '1' }, capabilities: { experimentalApi: true } });
    child.stdin.write('{"method":"initialized"}\n'); await work({ call, wait });
  } finally {
    child.stdin.end(); const result = await exit; clearTimeout(watchdog); exits.push(result);
    if (result.code !== 0) throw new Error('native_exit: ' + JSON.stringify(result));
  }
}
const threads = new Map();
async function start(call, name, extra = {}) {
  activeCase = name;
  const result = await call('thread/start', { cwd, approvalPolicy: 'never', sandbox: 'read-only',
    modelProvider: 'offline', model: 'synthetic-offline', historyMode: 'paginated',
    baseInstructions: 'Synthetic offline instructions.', developerInstructions: 'Use only the synthetic input.', ...extra });
  threads.set(name, result.thread); return result.thread;
}
async function turn({ call, wait }, thread, name) {
  activeCase = name;
  const result = await call('turn/start', { threadId: thread.id, input: [{ type: 'text', text: 'Synthetic question ' + name + '.', text_elements: [] }] });
  const completed = await wait('turn/completed', params => params.turn.id === result.turn.id);
  if (completed.turn.status !== 'completed') throw new Error('turn_failed: ' + JSON.stringify(completed));
}
let failure;
try {
  await server(async api => {
    for (const name of ['final', 'two-turns', 'partial-final', 'resume']) {
      const thread = await start(api.call, name); await turn(api, thread, name);
      if (name === 'two-turns') await turn(api, thread, name);
    }
    const thread = await start(api.call, 'interrupted');
    let ready; const streamed = new Promise(done => { ready = done; }); interruptedReady = ready;
    const begun = await api.call('turn/start', { threadId: thread.id, input: [{ type: 'text', text: 'Synthetic question interrupted.' }] });
    let timer;
    try { await Promise.race([streamed, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('interrupt_stream_timeout')), 15000); })]); }
    finally { clearTimeout(timer); }
    await api.call('turn/interrupt', { threadId: thread.id, turnId: begun.turn.id });
    await api.wait('turn/completed', params => params.turn.id === begun.turn.id);
    const tool = await start(api.call, 'tool', { dynamicTools: [{ name: 'synthetic_function', description: 'Return a benign synthetic value.', inputSchema: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'], additionalProperties: false } }] });
    await turn(api, tool, 'tool');
  });
  await server(async api => {
    const thread = threads.get('resume'); activeCase = 'resume';
    await api.call('thread/resume', { threadId: thread.id, path: thread.path }); await turn(api, thread, 'resume');
  });
  const hookScript = join(root, 'hook.sh');
  const canary = 'SYNTHETIC_CONTEXT_CANARY';
  await writeFile(hookScript, "#!/bin/sh\ncat >/dev/null\nprintf '%s\\n' '" + JSON.stringify({ hookSpecificOutput: {
    hookEventName: 'UserPromptSubmit', additionalContext: canary } }) + "'\n", { mode: 0o700 });
  const hookCommand = "/bin/sh '" + hookScript.replaceAll("'", "'\\''") + "'";
  const emptyHookScript = join(root, 'empty-hook.sh');
  await writeFile(emptyHookScript, "#!/bin/sh\ncat >/dev/null\nprintf '%s\\n' '{}'\n", { mode: 0o700 });
  const emptyHookCommand = "/bin/sh '" + emptyHookScript.replaceAll("'", "'\\''") + "'";
  const hookEntries = { UserPromptSubmit: [{ hooks: [
    { type: 'command', command: hookCommand, timeout: 3, additionalContextLimit: 0 } ] }] };
  for (const event of ['SessionStart', 'Stop', 'PreCompact']) hookEntries[event] = [{ hooks: [
    { type: 'command', command: emptyHookCommand, timeout: 3 } ] }];
  await writeFile(join(codexHome, 'hooks.json'), JSON.stringify({ hooks: hookEntries }), { mode: 0o600 });
  let trustedHooks;
  await server(async api => {
    const inventory = await api.call('hooks/list', { cwds: [cwd] }); await save('hooks-untrusted.json', inventory);
    const hooks = inventory.data.flatMap(entry => entry.hooks);
    if (hooks.length !== 4 || hooks.some(hook => ![hookCommand, emptyHookCommand].includes(hook.command) || hook.trustStatus !== 'untrusted')) throw new Error('unexpected_disposable_hook');
    trustedHooks = hooks;
  });
  await writeFile(join(codexHome, 'config.toml'), config + trustedHooks.map(hook =>
    `\n[hooks.state.${JSON.stringify(hook.key)}]\ntrusted_hash = ${JSON.stringify(hook.currentHash)}\n`).join(''), { mode: 0o600 });
  await server(async api => {
    const inventory = await api.call('hooks/list', { cwds: [cwd] }); await save('hooks-trusted.json', inventory);
    const hooks = inventory.data.flatMap(entry => entry.hooks);
    if (hooks.length !== 4 || hooks.some(hook => !trustedHooks.some(old => old.key === hook.key) || hook.trustStatus !== 'trusted')) throw new Error('hook_trust_not_reloaded');
    const thread = await start(api.call, 'hooks-recall'); await turn(api, thread, 'hooks-recall');
  });
  const placementRequests = requests.filter(row => row.case === 'hooks-recall');
  const placements = placementRequests.flatMap((request, requestIndex) => (request.body.input ?? []).flatMap((item, inputIndex) =>
    JSON.stringify(item).includes(canary) ? [{ requestIndex, inputIndex, role: item.role, item }] : []));
  if (placements.length !== 1 || placements[0].role !== 'developer') throw new Error('recall_placement_changed_requires_A7_review');
  await save('recall-placement.json', { origin: 'trusted UserPromptSubmit hookSpecificOutput.additionalContext', canary, placements });
  await server(async api => {
    const thread = await start(api.call, 'compaction-before'); await turn(api, thread, 'compaction-before');
    activeCase = 'compaction';
    try {
      await api.call('thread/compact/start', { threadId: thread.id });
      await api.wait('item/completed', params => params.item.type === 'contextCompaction');
      await turn(api, thread, 'compaction-after');
      bestEffort.push({ case: 'h', produced: true });
    } catch (error) { bestEffort.push({ case: 'h', produced: false, reason: error.message }); }
  });
  // The protocol exposes initial dynamicTools, but no definition-replacement
  // RPC. Inspect the generated public protocol rather than inventing a method.
  const protocol = await readFile(join(root, 'evidence/schema/codex_app_server_protocol.schemas.json'), 'utf8');
  bestEffort.push({ case: 'f2', produced: false, reason: protocol.includes('replace_dynamic_tools') ?
    'Replacement string present; no evidenced public invocation.' : 'No public replace_dynamic_tools RPC in generated protocol; initial tools and invocation do not prove replacement.' });
} catch (error) { failure = error.stack; }
finally {
  const inventory = { topLevel: new Set(), eventMsg: new Set(), item: new Set(), content: new Set() };
  for (const [name, thread] of threads) {
    try { const bytes = await readFile(thread.path); await save(name + '.jsonl', bytes.toString());
      const lines = bytes.toString().trim().split('\n'), sessionId = JSON.parse(lines[0]).payload.id, messages = [];
      verifyHeader(Buffer.from(lines[0]), sessionId, { qualifiedCreatorVersion: evidence.version });
      let start = 0;
      for (const line of lines) {
        const row = JSON.parse(line); inventory.topLevel.add(row.type);
        if (row.type === 'event_msg') inventory.eventMsg.add(row.payload.type);
        const item = row.type === 'event_msg' ? row.payload.item : row.type === 'response_item' ? row.payload : undefined;
        if (item?.type) inventory.item.add(item.type);
        if (Array.isArray(item?.content)) for (const part of item.content) if (part.type) inventory.content.add(part.type);
        const end = start + Buffer.byteLength(line) + 1;
        const parsed = parseLine(Buffer.from(line), { sessionId, wireSessionId: 'a'.repeat(64), epoch: 0, start, end });
        if (parsed.message) messages.push({ role: parsed.message.role, content: parsed.message.content }); start = end;
      }
      if (messages.some(message => /SYNTHETIC_CONTEXT_CANARY|UNFINISHED_CANARY|SYNTHETIC_TOOL_OK|Synthetic checkpoint summary/u.test(message.content))) throw new Error('excluded_content_captured');
      if (name !== 'compaction-before' || bestEffort.some(row => row.case === 'h' && row.produced)) assert.deepEqual(messages, expected[name]);
      cases.push({ name, path: name + '.jsonl', sha256: sha(bytes), messages, unsupportedFormat: 0 });
    } catch (error) { cases.push({ name, error: error.message }); }
  }
  const hookNotifications = rpc.filter(row => ['hook/started', 'hook/completed'].includes(row.method));
  const hooksPersisted = ['hook_started', 'hook_completed'].every(type => inventory.eventMsg.has(type));
  // Contract section 18.3(g), v0.20: native notifications prove execution.
  // Persisted lifecycle rows remain inventoried; their absence is not failure.
  const starts = hookNotifications.filter(row => row.method === 'hook/started');
  const completed = hookNotifications.filter(row => row.method === 'hook/completed');
  const hookKey = row => JSON.stringify([row.params.threadId, row.params.turnId, row.params.run.id]);
  if (!starts.length || !starts.every(row => completed.some(done => hookKey(done) === hookKey(row)))) failure ??= 'required_hook_execution_missing';
  if (Object.keys(expected).filter(name => name !== 'compaction-before').some(name => !cases.some(row => row.name === name && !row.error))) failure ??= 'required_case_missing';
  if (cases.some(row => row.error)) failure ??= 'produced_case_parse_failed';
  await save('hook-notifications.json', hookNotifications);
  for (const socket of sockets) socket.destroy(); await new Promise(done => mock.close(done));
  await save('rpc.json', rpc); await save('requests.json', requests); await save('stderr.log', stderr);
  await save('manifest.json', { version: evidence.version, isolation, scriptSha256: sha(await readFile(new URL(import.meta.url))),
    isolationScriptSha256: sha(await readFile(new URL('./codex-probe-isolation.mjs', import.meta.url))),
    exits, cases, bestEffort, hookLifecycle: { notifications: hookNotifications.length, persisted: hooksPersisted,
      started: starts.length, completed: completed.length,
      absentRolloutEvents: ['hook_started', 'hook_completed'].filter(type => !inventory.eventMsg.has(type)) },
    inventory: Object.fromEntries(Object.entries(inventory).map(([key, values]) => [key, [...values].sort()])),
    absent: ['world_state', 'security_risk_score', 'dynamic_tools_updated'].filter(type => !inventory.topLevel.has(type)),
    mockRequests: requests.length, unexpected, modelCalls: 0, ...(failure ? { failure } : {}) });
}
if (failure) throw new Error(failure);
if (unexpected.length) throw new Error('unexpected_mock_request');
console.log(JSON.stringify({ version: evidence.version, nativeExits: exits, mockRequests: requests.length, modelCalls: 0 }));
