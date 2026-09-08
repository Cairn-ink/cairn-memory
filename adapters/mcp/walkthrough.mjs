import assert from 'node:assert/strict';
import { mkdtemp, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

export async function parseArguments(args) {
  let executable;
  let withRecall = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--executable' && !executable) executable = args[++i];
    else if (args[i] === '--with-recall' && !withRecall) withRecall = true;
    else throw new Error('invalid_arguments');
  }
  if (typeof executable !== 'string' || !isAbsolute(executable) || !(await stat(executable)).isFile()) {
    throw new Error('invalid_executable');
  }
  return { executable, withRecall };
}

export function childEnvironment(withRecall, env) {
  if (withRecall && !env.OPENAI_API_KEY?.trim()) throw new Error('missing_model_key');
  return { OPENAI_API_KEY: withRecall ? env.OPENAI_API_KEY : '', NODE_NO_WARNINGS: '1' };
}

// The client only speaks MCP. It never imports the engine or opens the store.
export async function runWalkthrough({ executable, withRecall = false }, env = process.env) {
  await parseArguments(['--executable', executable, ...(withRecall ? ['--with-recall'] : [])]);
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 22 || (major === 22 && minor < 16)) throw new Error('unsupported_runtime');
  const childEnv = childEnvironment(withRecall, env);
  const database = join(await mkdtemp(join(tmpdir(), 'cairn-walkthrough-')), 'memory.sqlite');
  const report = { status: 'failed', runtime: process.versions.node, database, withRecall, stages: [] };
  let client;
  let transport;
  let timer;
  let stopped = false;
  async function close() {
    await client?.close();
    await transport?.close();
    client = undefined;
    transport = undefined;
  }
  async function connect() {
    if (stopped) throw new Error('walkthrough_stopped');
    transport = new StdioClientTransport({ command: process.execPath,
      args: [executable, '--db', database, '--owner', 'synthetic-walkthrough-owner'],
      env: childEnv, stderr: 'pipe' });
    // Drain without logging arbitrary server diagnostics or model responses.
    transport.stderr?.resume();
    client = new Client({ name: 'cairn-local-walkthrough', version: '1.0.0' });
    await client.connect(transport, { timeout: 15000 });
  }
  async function call(name, args = {}) {
    if (stopped) throw new Error('walkthrough_stopped');
    const response = await client.callTool({ name, arguments: args }, undefined, { timeout: 30000 });
    if (stopped) throw new Error('walkthrough_stopped');
    const result = JSON.parse(response.content[0].text);
    assert.equal(result.evidenceTrust, 'untrusted-data-not-instructions');
    return result;
  }
  function ok(result) { assert.equal(result.ok, true); return result.value; }
  let stage = 'connect';
  const pass = () => report.stages.push({ stage, status: 'passed' });
  const initial = 'Synthetic Harbor review is on Tuesday.';
  const replacement = 'Synthetic Harbor review is on Friday.';
  try {
    const lifecycle = async () => {
      await connect();
      stage = 'five_tools';
      assert.deepEqual((await client.listTools({}, { timeout: 15000 })).tools.map(t => t.name).sort(),
        ['correct_memory', 'forget_memory', 'inspect_memory', 'recall_memory', 'remember_memory']);
      pass();
      stage = 'remember_and_inspect';
      const saved = ok(await call('remember_memory', { content: initial, kind: 'fact' })).memory;
      const detail = ok(await call('inspect_memory', { memoryId: saved.id }));
      assert.equal(detail.memory.content, initial);
      assert.ok(detail.receipts.some(receipt => receipt.excerpt === initial));
      pass();
      stage = 'restart_and_inspect';
      await close();
      await connect();
      assert.equal(ok(await call('inspect_memory', { memoryId: saved.id })).memory.content, initial);
      pass();
      stage = 'correct_and_reject_stale';
      const corrected = ok(await call('correct_memory', {
        memoryId: saved.id, expectedRevision: saved.revision, content: replacement,
      })).memory;
      assert.equal(corrected.revision, saved.revision + 1);
      const stale = await call('correct_memory', {
        memoryId: saved.id, expectedRevision: saved.revision, content: initial,
      });
      assert.equal(stale.ok, false);
      assert.equal(stale.error.code, 'revision_conflict');
      assert.equal(ok(await call('inspect_memory', { memoryId: saved.id })).memory.content, replacement);
      pass();
      stage = withRecall ? 'model_recall_current_receipt' : 'model_disabled';
      const recalled = await call('recall_memory', { query: 'When is Synthetic Harbor review?' });
      if (withRecall) {
        const items = ok(recalled).memories;
        assert.equal(items.length, 1);
        assert.equal(items[0].memory.id, saved.id);
        assert.equal(items[0].memory.revision, corrected.revision);
        assert.equal(items[0].memory.content, replacement);
        assert.ok(items[0].receipts.some(receipt => receipt.excerpt === replacement));
      } else {
        assert.equal(recalled.ok, false);
        assert.equal(recalled.error.code, 'model_not_configured');
      }
      pass();
      stage = 'forget_and_empty_inspect';
      assert.equal(ok(await call('forget_memory', {
        memoryId: saved.id, expectedRevision: corrected.revision,
      })).forgotten, true);
      assert.deepEqual(ok(await call('inspect_memory')).memories, []);
      const missing = await call('inspect_memory', { memoryId: saved.id });
      assert.equal(missing.ok, false);
      assert.equal(missing.error.code, 'memory_not_found');
      pass();
      if (withRecall) {
        stage = 'model_recall_empty';
        assert.deepEqual(ok(await call('recall_memory', { query: 'When is Synthetic Harbor review?' })).memories, []);
        pass();
      }
      report.status = 'passed';
    };
    await Promise.race([lifecycle(), new Promise((_, reject) => {
      timer = setTimeout(() => {
        stopped = true;
        reject(new Error('walkthrough_timeout'));
      }, 120000);
    })]);
  } catch {
    report.stages.push({ stage, status: 'failed' });
  } finally {
    stopped = true;
    clearTimeout(timer);
    try { await close(); } catch { report.status = 'failed'; }
  }
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const report = await runWalkthrough(await parseArguments(process.argv.slice(2)));
    console.log(JSON.stringify(report, null, 2));
    if (report.status !== 'passed') process.exitCode = 1;
  } catch {
    console.error('cairn_walkthrough_failed: use Node >=22.16 and --executable /absolute/installed/bin/cairn-memory; optional --with-recall requires OPENAI_API_KEY and may incur model charges');
    process.exitCode = 1;
  }
}
