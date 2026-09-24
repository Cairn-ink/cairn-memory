import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { buildArtifact, command, packageName } from '../build.mjs';
import { startExperimentProxy } from '../../evaluation/live/proxy.mjs';

const sdk = createRequire(new URL('../../adapters/mcp/package.json', import.meta.url));
const { Client } = await import(sdk.resolve('@modelcontextprotocol/client'));
const { StdioClientTransport } = await import(sdk.resolve('@modelcontextprotocol/client/stdio'));
const namespace = { ownerId: 'synthetic-installed-admission', scope: 'personal', projectId: null };
const ok = (result) => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };

async function call(client, name, args) {
  const response = await client.callTool({ name, arguments: args });
  const result = JSON.parse(response.content[0].text);
  assert.equal(Boolean(response.isError), !result.ok);
  assert.equal(result.evidenceTrust, 'untrusted-data-not-instructions');
  return ok(result);
}

test('installed cold admission inspection then explicit classification uses one fake model method and retains sources',
  { timeout: 120000 }, async (t) => {
    const artifact = buildArtifact();
    const root = mkdtempSync(join(tmpdir(), 'cairn-installed-admission-inspect-'));
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'synthetic-admission-inspection',
      private: true, version: '0.0.0' }), { flag: 'wx' });
    command('npm', ['install', '--prefix', root, '--offline', '--ignore-scripts', '--no-audit', '--no-fund',
      artifact.artifactPath], root, artifact.userconfig);
    const packageRoot = join(root, 'node_modules', packageName);
    for (const path of ['core/admission-storage.mjs', 'core/contract.mjs', 'adapters/mcp/server.mjs']) {
      assert.equal(createHash('sha256').update(readFileSync(join(packageRoot, path))).digest('hex'),
        artifact.sourceHashes[path]);
    }
    const { openMemoryCore } = await import(new URL(`file://${packageRoot}/core/contract.mjs`));
    const dbPath = join(root, 'memory.sqlite');
    const core = openMemoryCore({ path: dbPath });
    const key = { namespace, client: 'cairn-local-mcp', eventId: 'interrupted-installed-batch',
      payloadDigest: 'b'.repeat(64) };
    const claimed = ok(core.claimAdmission({ ...key, leaseMs: 125000 }));
    const admission = ok(core.finishAdmission({ ...key, token: claimed.token, items: [{
      content: 'Synthetic retained installed source.', kind: 'fact', confidence: 0.8,
      receipts: [{ client: 'cairn-local-mcp', sessionId: 'submitted-capture',
        eventId: key.eventId, role: 'user', excerpt: 'Synthetic retained installed source.' }],
    }] }));
    core.close(); // No capture response or classification is available to the installed host.
    assert.equal(admission.memories.length, 1);
    let requests = 0;
    const proxy = await startExperimentProxy({ session: { request: async (route, body) => {
      requests++;
      if (route === '/responses/input_tokens') return Response.json({ object: 'response.input_tokens', input_tokens: 100 });
      const payload = JSON.parse(body);
      assert.equal(payload.text.format.name, 'cairn_classify', 'No extraction or capture replay');
      const input = JSON.parse(payload.input[0].content[0].text);
      const output = { items: input.memories.map(({ id }) => ({ memoryId: id, parentIds: [],
        newL1: { title: 'Synthetic installed topic', parentL2Ids: [] } })) };
      return Response.json({ object: 'response', model: payload.model, status: 'completed', error: null,
        incomplete_details: null, output: [{ type: 'message', role: 'assistant', status: 'completed',
          content: [{ type: 'output_text', text: JSON.stringify(output) }] }],
        usage: { input_tokens: 100, output_tokens: 100, total_tokens: 200 } });
    } } });
    t.after(() => proxy.close());
    const preload = `const nativeFetch=globalThis.fetch;globalThis.fetch=(url,options)=>{
      const target=new URL(url);if(target.origin!=='https://api.openai.com'||target.search||target.hash||
      !['/v1/responses','/v1/responses/input_tokens'].includes(target.pathname))throw new Error('test_route_denied');
      return nativeFetch(${JSON.stringify(proxy.url)}+target.pathname,options);};`;
    const keylessEnv = { OPENAI_API_KEY: '', NODE_NO_WARNINGS: '1',
      NODE_OPTIONS: '--import=data:text/javascript,globalThis.fetch=()=>{throw%20new%20Error(%22no_http%22)}' };
    const keyedEnv = { OPENAI_API_KEY: proxy.token, NODE_NO_WARNINGS: '1',
      NODE_OPTIONS: `--import=data:text/javascript;base64,${Buffer.from(preload).toString('base64')}` };
    async function start(env) {
      const client = new Client({ name: 'installed-admission-inspection-test', version: '1.0.0' });
      t.after(() => client.close());
      await client.connect(new StdioClientTransport({ command: process.execPath,
        args: [join(packageRoot, 'bin', 'cairn-memory.mjs'), '--db', dbPath,
          '--owner', namespace.ownerId, '--classification-recovery', 'guarded-v1'],
        env, stderr: 'ignore' }));
      return client;
    }
    const cold = await start(keylessEnv);
    assert.equal((await cold.listTools()).tools.length, 7);
    const inspected = await call(cold, 'inspect_capture_admission', { batchId: key.eventId });
    assert.equal(inspected.status, 'completed');
    assert.deepEqual(inspected.classification, { status: 'unknown' });
    assert.equal(inspected.members.length, 1);
    assert.equal(inspected.members[0].memoryId, admission.memories[0].id);
    assert.equal(inspected.members[0].filing.status, 'unfiled');
    assert.equal(JSON.stringify(inspected).includes('Synthetic retained'), false);
    assert.equal(requests, 0);
    const before = await call(cold, 'inspect_memory', { memoryId: admission.memories[0].id });
    await cold.close();
    const recovery = await start(keyedEnv);
    const placed = await call(recovery, 'classify_unfiled_memories', { refs: [{
      memoryId: inspected.members[0].memoryId, revision: inspected.members[0].revision }] });
    assert.equal(placed.memories[0].filing.status, 'filed');
    const after = await call(recovery, 'inspect_memory', { memoryId: admission.memories[0].id });
    assert.equal(after.memory.content, before.memory.content);
    assert.deepEqual(after.receipts, before.receipts);
    assert.equal(requests, 2); // One bounded count and one classify response; no extraction.
    const final = await call(recovery, 'inspect_capture_admission', { batchId: key.eventId });
    assert.equal(final.members[0].filing.status, 'filed');
    assert.deepEqual(final.classification, { status: 'unknown' });
    assert.equal(requests, 2);
  });
