#!/usr/bin/env node
// Offline native history probe. Assistant rows are synthetic inputs, NOT model
// output. Only initialize, thread/start, thread/resume and history reads run;
// thread/start creates an idle thread, whereas turn/start would call a model.
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

const args = process.argv.slice(2);
const option = name => args[args.indexOf(name) + 1];
if (!args.includes('--binary') || !args.includes('--out')) throw new Error('usage: --binary <native-codex> --out <new-private-directory>');
const binary = resolve(option('--binary')), root = resolve(option('--out'));
await mkdir(root, { mode: 0o700 }); // refuse to reuse a home/config/session directory
const home = join(root, 'home'), codexHome = join(home, '.codex'), cwd = join(root, 'project');
for (const path of [home, codexHome, cwd]) await mkdir(path, { recursive: true, mode: 0o700 });
await writeFile(join(codexHome, 'config.toml'), [
  'model = "synthetic-offline"', 'model_provider = "offline"',
  '[model_providers.offline]', 'name = "No-model history probe"',
  'base_url = "http://192.0.2.1:9/v1"', 'wire_api = "responses"', 'requires_openai_auth = false',
  '[analytics]', 'enabled = false', '[feedback]', 'enabled = false',
  '[features]', 'hooks = false', 'plugins = false', 'apps = false', 'memories = false', '',
].join('\n'), { mode: 0o600 });
const env = { HOME: home, CODEX_HOME: codexHome, PATH: '/usr/bin:/bin', LANG: 'C.UTF-8' };
const rpc = [], exits = []; let stderr = '';
async function server(work) {
  const child = spawn(binary, ['app-server', '--listen', 'stdio://'], { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
  const exit = new Promise((done, reject) => { child.on('error', reject); child.on('close', (code, signal) => done({ code, signal })); });
  let next = 0, buffer = ''; const pending = new Map();
  const watchdog = setTimeout(() => child.kill('SIGKILL'), 60000);
  child.stderr.on('data', chunk => { stderr += chunk; });
  child.stdout.on('data', chunk => {
    buffer += chunk;
    for (;;) {
      const newline = buffer.indexOf('\n'); if (newline < 0) break;
      const row = JSON.parse(buffer.slice(0, newline)); buffer = buffer.slice(newline + 1);
      rpc.push(row); pending.get(row.id)?.(row); pending.delete(row.id);
    }
  });
  async function call(method, params) {
    const id = ++next; rpc.push({ direction: 'request', id, method, params });
    let timer;
    const reply = new Promise(done => {
      pending.set(id, done); timer = setTimeout(() => done({ error: { message: 'native_rpc_timeout' } }), 15000);
    });
    child.stdin.write(JSON.stringify({ id, method, params }) + '\n');
    const answer = await reply; clearTimeout(timer); pending.delete(id);
    if (answer.error) throw new Error(JSON.stringify(answer.error));
    return answer.result;
  }
  try {
    const init = await call('initialize', { clientInfo: { name: 'codex_exec', version: '1' }, capabilities: { experimentalApi: true } });
    if (!init.userAgent.includes('/0.162.0 ')) throw new Error('requires_native_0.162.0');
    child.stdin.write('{"method":"initialized"}\n'); await work(call);
  } finally {
    child.stdin.end(); const result = await exit; clearTimeout(watchdog); exits.push(result);
    if (result.code !== 0) throw new Error('native_exit: ' + JSON.stringify(result));
  }
}
const sessions = [];
await server(async call => {
  for (const name of ['partial-final', 'interrupted', 'unknown']) {
    const result = await call('thread/start', { cwd, approvalPolicy: 'never', sandbox: 'read-only', modelProvider: 'offline', model: 'synthetic-offline' });
    sessions.push({ name, id: result.thread.id, path: result.thread.path });
  }
});
for (const { name, id, path } of sessions) {
  // Idle native thread/start is lazy: create its disk history explicitly from
  // schema/serde-shaped synthetic records, then ask native resume to index it.
  const timestamp = '2026-10-09T00:00:00.000Z', turn = 'synthetic-' + name;
  const event = payload => ({ timestamp, type: 'event_msg', payload });
  const agent = (type, itemId, text, phase) => event({ type, thread_id: id, turn_id: turn,
    item: { type: 'AgentMessage', id: itemId, content: [{ type: 'Text', text }], phase }, started_at_ms: 1,
    ...(type === 'item_completed' ? { completed_at_ms: 2 } : {}) });
  const rows = [
    { timestamp, type: 'session_meta', payload: { session_id: id, id, timestamp, cwd, runtime_workspace_roots: [cwd],
      originator: 'codex_exec', cli_version: '0.162.0', source: 'exec', thread_source: 'user', model_provider: 'offline',
      base_instructions: { text: 'Synthetic instructions.' }, history_mode: 'paginated', context_window: { window_id: randomUUID() } } },
    event({ type: 'task_started', turn_id: turn, model_context_window: null }),
    event({ type: 'item_completed', thread_id: id, turn_id: turn, item: { type: 'UserMessage', id: 'user-' + name,
      content: [{ type: 'text', text: 'Synthetic question.', text_elements: [] }] }, completed_at_ms: 1 }),
    agent('item_started', 'partial-' + name, '', 'partial_answer'),
    event({ type: 'agent_message_content_delta', thread_id: id, turn_id: turn, item_id: 'partial-' + name, delta: 'First stable section.' }),
    agent('item_completed', 'partial-' + name, 'First stable section.', name === 'unknown' ? 'future_answer' : 'partial_answer'),
  ];
  if (name !== 'unknown') rows.push(
    { timestamp, type: 'response_item', payload: { type: 'message', id: 'partial-' + name, role: 'assistant',
      content: [{ type: 'output_text', text: 'First stable section.' }], phase: 'partial_answer' } },
    event({ type: 'agent_message', message: 'First stable section.', phase: 'partial_answer' }));
  if (name === 'partial-final') rows.push(agent('item_completed', 'final-' + name, 'Second terminal section.', 'final_answer'),
    event({ type: 'task_complete', turn_id: turn, last_agent_message: 'Second terminal section.' }));
  else rows.push(agent('item_started', 'unfinished-' + name, 'UNFINISHED_CANARY', 'partial_answer'),
    event({ type: 'turn_aborted', turn_id: turn, reason: 'interrupted' }));
  rows.forEach((row, ordinal) => { row.ordinal = ordinal; });
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const bytes = rows.map(row => JSON.stringify(row)).join('\n') + '\n';
  await writeFile(path, bytes, { mode: 0o600 }); await writeFile(join(root, name + '.jsonl'), bytes, { mode: 0o600 });
}
const cases = [];
await server(async call => {
  for (const { name, id, path } of sessions) {
    await call('thread/resume', { threadId: id, path, excludeTurns: false });
    const turns = await call('thread/turns/list', { threadId: id, itemsView: 'full' });
    const items = await call('thread/items/list', { threadId: id });
    cases.push({ name, turns, items });
    await writeFile(join(root, name + '-native-resumed.jsonl'), await readFile(path), { mode: 0o600 });
  }
});
for (const [name, expected] of [['partial-final', ['partial_answer', 'final_answer']], ['interrupted', ['partial_answer']], ['unknown', []]]) {
  const actual = cases.find(row => row.name === name).items.data.filter(row => row.item.type === 'agentMessage');
  if (JSON.stringify(actual.map(row => row.item.phase)) !== JSON.stringify(expected)) throw new Error('native_history_disagrees: ' + name);
}
await writeFile(join(root, 'history-results.json'), JSON.stringify({ version: '0.162.0', exits, cases }, null, 2) + '\n', { mode: 0o600 });
await writeFile(join(root, 'history-rpc.json'), JSON.stringify(rpc, null, 2) + '\n', { mode: 0o600 });
await writeFile(join(root, 'history-stderr.log'), stderr, { mode: 0o600 });
console.log(JSON.stringify({ version: '0.162.0', nativeExits: exits.map(row => row.code), cases: cases.map(row => row.name), modelCalls: 0 }));
