import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { buildArtifact, command, packageName } from '../build.mjs';
import { startExperimentProxy } from '../../evaluation/live/proxy.mjs';
import { rationaleModel } from '../../core/testing/rationale-model.mjs';

const sdk = createRequire(new URL('../../adapters/mcp/package.json', import.meta.url));
const { Client } = await import(sdk.resolve('@modelcontextprotocol/client'));
const { StdioClientTransport } = await import(sdk.resolve('@modelcontextprotocol/client/stdio'));
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const ok = (result) => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };
async function completedWithin(promise, label) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`synthetic_late_phase_not_completed:${label}`)), 5000);
    })]);
  } finally { clearTimeout(timer); }
}

test('H5 installed CLI and core bound capture, preserve partial admission, and recover explicitly',
  { timeout: 120000 }, async (t) => {
    const artifact = buildArtifact();
    const root = mkdtempSync(join(tmpdir(), 'cairn-installed-deadline-'));
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'synthetic-installed-deadline',
      private: true, version: '0.0.0' }), { flag: 'wx' });
    command('npm', ['install', '--prefix', root, '--offline', '--ignore-scripts', '--no-audit', '--no-fund',
      artifact.artifactPath], root, artifact.userconfig);
    const installed = join(root, 'node_modules', packageName);
    for (const path of ['adapters/mcp/cli.mjs', 'adapters/mcp/server.mjs',
      'core/capture-deadline.mjs', 'core/contract.mjs']) {
      assert.equal(createHash('sha256').update(readFileSync(join(installed, path))).digest('hex'),
        artifact.sourceHashes[path]);
    }
    const dbPath = join(root, 'memory.sqlite');
    const fake = rationaleModel();
    const methods = [];
    let classifyCount = 0;
    let finishLateExtract;
    let finishLateClassify;
    const lateExtract = new Promise((resolve) => { finishLateExtract = resolve; });
    const lateClassify = new Promise((resolve) => { finishLateClassify = resolve; });
    const proxy = await startExperimentProxy({ session: { request: async (route, body) => {
      if (route === '/responses/input_tokens') return Response.json({ object: 'response.input_tokens', input_tokens: 100 });
      assert.equal(route, '/responses');
      const payload = JSON.parse(body);
      const method = payload.text.format.name.replace(/^cairn_/u, '');
      methods.push(method);
      const input = JSON.parse(payload.input[0].content[0].text);
      let output;
      if (method === 'extract') {
        output = fake.extract({ input });
        if (input.messages.some(({ content }) => content.includes('PRE_STALL'))) {
          await wait(1500); finishLateExtract();
        }
      } else if (method === 'qualifyCandidates') {
        const qualified = fake.qualifyCandidates({ input });
        output = { qualifications: Object.fromEntries(qualified.qualifications.map((entry) =>
          [`item_${entry.itemIndex}`, entry])) };
      } else if (method === 'classify') {
        classifyCount++;
        output = { items: input.memories.map(({ id }) => ({ memoryId: id, parentIds: [],
          newL1: { title: 'Synthetic installed filing', parentL2Ids: [] } })) };
        if (classifyCount === 1) { await wait(1500); finishLateClassify(); }
      } else assert.fail(`unexpected synthetic method ${method}`);
      return Response.json({ object: 'response', model: payload.model, status: 'completed', error: null,
        incomplete_details: null, output: [{ type: 'message', role: 'assistant', status: 'completed',
          content: [{ type: 'output_text', text: JSON.stringify(output) }] }],
        usage: { input_tokens: 100, output_tokens: 100, total_tokens: 200 } });
    } } });
    const preload = `const nativeFetch=globalThis.fetch;globalThis.fetch=(url,options)=>{
      const target=new URL(url);if(target.origin!=='https://api.openai.com'||target.search||target.hash||
      !['/v1/responses','/v1/responses/input_tokens'].includes(target.pathname))throw new Error('synthetic_route_denied');
      return nativeFetch(${JSON.stringify(proxy.url)}+target.pathname,options);};`;
    const keyless = { OPENAI_API_KEY: '', NODE_NO_WARNINGS: '1',
      NODE_OPTIONS: '--import=data:text/javascript,globalThis.fetch=()=>{throw%20new%20Error(%22no_http%22)}' };
    const keyed = { OPENAI_API_KEY: proxy.token, NODE_NO_WARNINGS: '1',
      NODE_OPTIONS: `--import=data:text/javascript;base64,${Buffer.from(preload).toString('base64')}` };
    const clients = [];
    t.after(async () => {
      try { for (const client of clients) await client.close(); }
      finally { await proxy.close(); rmSync(root, { recursive: true, force: true }); }
    });
    async function start({ capture = false, env = keyless } = {}) {
      const client = new Client({ name: 'installed-deadline-test', version: '1.0.0' });
      clients.push(client);
      await client.connect(new StdioClientTransport({ command: process.execPath,
        args: [join(installed, 'bin', 'cairn-memory.mjs'), '--db', dbPath,
          '--owner', 'installed-deadline-owner', '--classification-recovery', 'guarded-v1',
          ...(capture ? ['--capture-qualification', 'source-bound-v2', '--capture-deadline-ms', '1000'] : [])],
        env, stderr: 'ignore' }));
      return client;
    }
    async function call(client, name, args = {}) {
      const response = await client.callTool({ name, arguments: args }, undefined, { timeout: 15000 });
      const result = JSON.parse(response.content[0].text);
      assert.equal(Boolean(response.isError), !result.ok);
      return result;
    }
    const first = await start({ capture: true, env: keyed });
    const pre = await call(first, 'capture_memory', { batchId: 'installed-pre',
      messages: [{ role: 'user', content: 'PRE_STALL synthetic pre-admission source.' }] });
    assert.equal(pre.ok, false); assert.equal(pre.error.code, 'model_timeout');
    assert.deepEqual(methods, ['extract'], 'the pre-admission model phase was reached exactly once');
    assert.deepEqual(ok(await call(first, 'inspect_memory')).memories, []);
    await completedWithin(lateExtract, 'extract');
    assert.deepEqual(ok(await call(first, 'inspect_memory')).memories, []);
    const preDb = new DatabaseSync(dbPath, { readOnly: true });
    assert.equal(preDb.prepare('SELECT count(*) AS n FROM memories').get().n, 0);
    assert.equal(preDb.prepare('SELECT count(*) AS n FROM receipts').get().n, 0);
    preDb.close();
    const partial = ok(await call(first, 'capture_memory', { batchId: 'installed-partial',
      messages: [{ role: 'user', content: 'Synthetic retained source for installed partial admission.' }] }));
    assert.equal(partial.admission.memories.length, 1);
    assert.equal(partial.classification.status, 'failed');
    assert.equal(partial.classification.error.code, 'model_timeout');
    assert.deepEqual(methods, ['extract', 'extract', 'qualifyCandidates', 'classify']);
    const memoryId = partial.admission.memories[0].id;
    const before = ok(await call(first, 'inspect_memory', { memoryId }));
    assert.equal(before.receipts.length, 1);
    await first.close();
    await completedWithin(lateClassify, 'classify');
    const db = new DatabaseSync(dbPath, { readOnly: true });
    const journalBefore = db.prepare('SELECT * FROM capture_initial_classification').all();
    db.close();
    assert.equal(journalBefore.length, 1); assert.equal(journalBefore[0].status, 'failed');
    const cold = await start();
    const inspected = ok(await call(cold, 'inspect_capture_admission',
      { batchId: 'installed-partial', includeInitialClassification: true }));
    assert.deepEqual(inspected.initialClassification, { status: 'failed' });
    assert.deepEqual(inspected.classification, { status: 'unknown' });
    assert.equal(inspected.members[0].filing.status, 'unfiled');
    assert.equal(JSON.stringify(inspected).includes('retained source'), false);
    assert.deepEqual(ok(await call(cold, 'inspect_memory', { memoryId })).receipts, before.receipts);
    assert.equal(methods.length, 4, 'cold inspection makes no model request');
    await cold.close();
    const recovery = await start({ env: keyed });
    const placed = ok(await call(recovery, 'classify_unfiled_memories', { refs: [{ memoryId,
      revision: inspected.members[0].revision }] }));
    assert.equal(placed.memories[0].filing.status, 'filed');
    assert.deepEqual(methods, ['extract', 'extract', 'qualifyCandidates', 'classify', 'classify']);
    const after = ok(await call(recovery, 'inspect_memory', { memoryId }));
    assert.equal(after.memory.content, before.memory.content);
    assert.deepEqual(after.receipts, before.receipts);
    assert.deepEqual(ok(await call(recovery, 'inspect_capture_admission',
      { batchId: 'installed-partial', includeInitialClassification: true })).initialClassification,
    { status: 'unknown' }, 'current revision differs from the original capture outcome');
    const check = new DatabaseSync(dbPath, { readOnly: true });
    assert.deepEqual(check.prepare('SELECT * FROM capture_initial_classification').all(), journalBefore);
    check.close();
  });
