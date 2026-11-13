import assert from 'node:assert/strict';
import test from 'node:test';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { parseConfiguration } from '../cli.mjs';
import { createCairnServer } from '../server.mjs';
import { createContextEmbedding, DEFAULT_CONTEXT_PROVIDER } from '../context-read-provider.mjs';
import { contextHost, contextCall } from './context-support.mjs';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { createFakeEmbedder } from '../../../core/context-read-embedder.mjs';
import { setTimeout as delay } from 'node:timers/promises';
import { registerContextReadTools } from '../context-read-tools.mjs';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';

const namespace = { ownerId: 'synthetic-default-owner', scope: 'personal', projectId: null };
test('CLI defaults, opt-outs and help advertise preferred reads', () => {
  const base = ['--db', '/synthetic/store.sqlite', '--owner', namespace.ownerId];
  assert.equal(parseConfiguration(base).contextRead, 'context-read-v1');
  assert.equal(parseConfiguration(base).rawSemantic, undefined);
  assert.equal(parseConfiguration([...base, '--raw-semantic']).rawSemantic, true);
  assert.equal(parseConfiguration([...base, '--raw-semantic', '--no-context-semantic']).contextSemantic, false);
  assert.equal(parseConfiguration([...base, '--no-context-read']).contextRead, false);
  assert.equal(parseConfiguration([...base, '--no-raw']).raw, false);
  assert.equal(parseConfiguration([...base, '--no-context-semantic']).contextSemantic, false);
  assert.throws(() => parseConfiguration([...base, '--no-context-read', '--context-read', 'context-read-v1']));
  const result = spawnSync(process.execPath, [new URL('../cli.mjs', import.meta.url).pathname, '--help'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  for (const name of ['--no-context-read', '--no-raw', '--raw-semantic', 'find_memory_candidates', 'read_memory_context']) assert.ok(result.stdout.includes(name));
});
test('keyless server starts with context tools, and explicit off removes them', async t => {
  const workspace = createTestWorkspace(t);
  for (const enabled of [true, false]) {
    const server = createCairnServer({ path: join(workspace.path, String(enabled) + '.sqlite'), namespace,
      ...(enabled ? {} : { contextRead: false }) });
    t.after(() => server.close());
    if (enabled) assert.equal(await server.contextCounterReady, true);
    // The pinned SDK stores the registered tool inventory here.
    const names = Object.keys(server._registeredTools);
    assert.equal(names.includes('find_memory_candidates'), enabled);
    assert.equal(names.includes('read_memory_context'), enabled);
    assert.ok(names.includes('recall_memory'));
  }
});
test('embedding configuration is automatic with a key and absent without one; semantic false wins', async () => {
  assert.equal(createContextEmbedding(undefined, {}), undefined);
  assert.equal(createContextEmbedding(DEFAULT_CONTEXT_PROVIDER, {}), undefined);
  const embedding = createContextEmbedding(undefined, { OPENAI_API_KEY: 'synthetic-not-a-key' });
  assert.ok(embedding.embedder);
  assert.equal(embedding.policy.maxRequests, DEFAULT_CONTEXT_PROVIDER.maxRequests);
  assert.equal(embedding.policy.maxRequests, Number.MAX_SAFE_INTEGER);
  assert.equal(embedding.policy.maxUsd, 1);
  const explicit = createContextEmbedding({ ...DEFAULT_CONTEXT_PROVIDER, maxRequests: 7, maxUsd: 0.02 },
    { OPENAI_API_KEY: 'synthetic-not-a-key' });
  assert.equal(explicit.policy.maxRequests, 7);
  assert.equal(explicit.policy.maxUsd, 0.02);
  const actions = new Map();
  registerContextReadTools((name, description, schema, action) => actions.set(name, action), {},
    { readSet: [namespace], call: (_core, _method, input) => input }, { semantic: true });
  const find = actions.get('find_memory_candidates');
  assert.equal(find({ query: 'synthetic', types: ['memory'], intent: 'current' }).semantic, true);
  assert.equal(find({ query: 'synthetic', types: ['memory'], intent: 'current', semantic: false }).semantic, false);
});

test('default CLI tools read BM25 without a key even with explicit OpenAI options', async t => {
  const workspace = createTestWorkspace(t);
  const host = await contextHost(workspace, join(workspace.path, 'keyless.sqlite'), { enabled:null, provider:true, key:false });
  const names = (await host.client.listTools()).tools.map(tool => tool.name);
  assert.ok(names.includes('read_memory_context'));
  const found = await contextCall(host.client, 'find_memory_candidates', { query:'synthetic', types:['memory'], intent:'current' });
  assert.equal(found.ok, true, JSON.stringify(found));
  assert.equal(found.value.channels.semantic.state, 'disabled');
});

test('programmatic dependent tools inherit the contextRead default', async t => {
  const workspace = createTestWorkspace(t);
  const server = createCairnServer({ path:join(workspace.path, 'roles.sqlite'), namespace,
    methodPackages:'local-v1', roleProfiles:'local-v1' });
  workspace.defer(() => server.close());
  assert.equal(await server.contextCounterReady, true);
  assert.ok(Object.keys(server._registeredTools).includes('read_role_task_context'));
  assert.ok(Object.keys(server._registeredTools).includes('read_memory_context'));
});

test('automatic embedding refresh supports a Raw-free Memory-only store; semantic off removes its provider', async t => {
  const workspace = createTestWorkspace(t);
  for (const enabled of [true, false]) {
    let calls = 0;
    const base = createFakeEmbedder({ dimensions:8 });
    const embedder = { ...base, async embed(...args) { calls++; return base.embed(...args); } };
    const server = createCairnServer({ path:join(workspace.path, 'embedding-'+enabled+'.sqlite'), namespace, raw:false,
      contextSemantic:enabled, contextEmbedding:{ embedder, policy:{family:'hosted',maxRequests:100,maxUsd:1,maxConcurrent:1,estimateUsd:()=>0} } });
    t.after(() => server.close());
    await server.contextCounterReady;
    const client = new Client({name:'synthetic-embedding-default',version:'1'}), [a,b] = InMemoryTransport.createLinkedPair();
    t.after(() => client.close());
    await server.connect(a); await client.connect(b);
    await contextCall(client, 'remember_memory', { content:'Synthetic stellar atlas' });
    if (enabled) {
      for (let quantum = 0; quantum < 8 && !calls; quantum++) await delay(1100);
      assert.ok(calls > 0, 'bounded background refresh must embed the supported Memory type');
      const found = await contextCall(client, 'find_memory_candidates', {query:'stellar atlas',types:['memory'],intent:'current'});
      assert.equal(found.ok, true, JSON.stringify(found));
      assert.equal(found.value.channels.semantic.state, 'ready');
    } else {
      const found = await contextCall(client, 'find_memory_candidates', {query:'stellar atlas',types:['memory'],intent:'current',semantic:true});
      assert.equal(found.ok, false);
      assert.equal(found.error.code, 'invalid_input');
      assert.equal(calls, 0);
    }
    await client.close(); await server.close();
  }
});

// Public defaults and setup disclosure must explain both transmission and opt-out.
test('defaults text discloses semantic sends and explicit Raw opt-in', () => {
  const text = readFileSync(new URL('../../../docs/defaults.md',import.meta.url),'utf8');
  for (const literal of ['Raw document and query embeddings are both off','raw_semantic_not_enabled','--raw-semantic','--no-context-semantic','memories and search text','estimated US$1 per server run']) assert.ok(text.includes(literal),literal);
});
