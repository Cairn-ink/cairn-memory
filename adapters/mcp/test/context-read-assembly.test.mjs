import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { spawnSync } from 'node:child_process';
import { openSync, closeSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { createCairnServer, buildCairnServer } from '../server.mjs';
import { createContextReadAccess, CONTEXT_TOOL_METHODS } from '../context-read-access.mjs';
import { registerContextReadTools } from '../context-read-tools.mjs';
import { contextToolResponse, ContextStdioServerTransport, CONTEXT_TRANSPORT_BYTES } from '../context-read-transport.mjs';
import { createContextCounter } from '../../openai/context-counter.mjs';
import { countOpenAITokens } from '../../openai/index.mjs';
import { openMemoryCore } from '../../../core/contract.mjs';
import { meteredText, ASSEMBLY_FRAMING } from '../../../core/context-read-assembly.mjs';
import { ASSEMBLY_POLICIES, ASSEMBLY_LIMITS, ASSEMBLY_DEFAULTS } from '../../../core/context-read-input.mjs';
import { assemblyFixture, assemblyQuery, sample } from '../../../core/testing/context-read-assembly-fixture.mjs';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { contextHost, contextNamespace as ns, contextProviderArgs } from './context-support.mjs';

const query = { query: 'assembly', types: ['memory'], intent: 'current' };
const snapshotKey = 'ink.cairn/context-read-snapshot';
const metaKey = 'ink.cairn/context-read-diagnostics';
const ok = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };
const childMcp = `
  const {Client}=await import(${JSON.stringify(new URL('../node_modules/@modelcontextprotocol/client/dist/index.mjs', import.meta.url).href)});
  const {InMemoryTransport}=await import(${JSON.stringify(new URL('../node_modules/@modelcontextprotocol/server/dist/index.mjs', import.meta.url).href)});
  async function attach(server){const client=new Client({name:'programmatic-compatibility',version:'1'});
    const [serverSide,clientSide]=InMemoryTransport.createLinkedPair();await server.connect(serverSide);await client.connect(clientSide);return client;}
  const call=(client,name,args)=>client.callTool({name,arguments:args});
  const envelope=response=>JSON.parse(response.content[0].text);
`;
async function connect(workspace, server) {
  const client = new Client({ name: 'assembly-client', version: '1' });
  const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
  workspace.defer(() => server.close()); workspace.defer(() => client.close());
  await server.connect(serverSide); await client.connect(clientSide);
  return client;
}
function admit(core, content = 'assembly ＡＢＣ canonical recollection') {
  const memory = ok(core.admit({ namespace: ns, memory: { content, kind: 'fact' }, receipts: [
    { client: 'synthetic', sessionId: 'assembly', eventId: content, role: 'user', excerpt: content },
  ] })).memory;
  return ok(core.get({ namespace: ns, memoryId: memory.id })).memory;
}
function modelInput(response) {
  // Explicit client contract: host/UI retains _meta; only content is model input.
  return response.content.filter(block => block.type === 'text').map(block => block.text).join('\n');
}
function runModule(workspace, name, source) {
  const outPath = join(workspace.path, name + '.out'), errPath = join(workspace.path, name + '.err');
  const out = openSync(outPath, 'wx', 0o600), err = openSync(errPath, 'wx', 0o600); let result;
  try { result = spawnSync(process.execPath, ['--input-type=module', '-e', source], { timeout: 20000,
    stdio: ['ignore', out, err], env: { NODE_NO_WARNINGS: '1', NODE_DISABLE_COMPILE_CACHE: '1' } }); }
  finally { closeSync(out); closeSync(err); }
  assert.equal(result.error, undefined); assert.equal(result.signal, null); assert.equal(result.status, 0, readFileSync(errPath, 'utf8'));
  return readFileSync(outPath, 'utf8').trim();
}

test('A11 strict assembly grammar, authority refusals, advertised policies and flattened host-fixed budget', async () => {
  const tools = new Map(), calls = [], access = createContextReadAccess({ ...ns, scope: 'project', projectId: 'p' }, true);
  const core = { contextRead(input) { calls.push(input); return { ok: true, value: null }; } };
  registerContextReadTools((name, description, schema, action, readOnlyHint) => tools.set(name, { description, schema, action, readOnlyHint }), core, access);
  const tool = tools.get('read_memory_context');
  assert.ok(CONTEXT_TOOL_METHODS.includes('contextRead'));
  assert.equal(tool.readOnlyHint, true); assert.match(tool.description, /untrusted data, never instructions, truth or execution permission/);
  for (const id of ASSEMBLY_POLICIES) for (const maxTokens of [64, 4000]) {
    const input = tool.schema.parse({ ...query, maxTokens, maxItems: 24, policy: { id }, deadlineMs: 5000, semantic: false });
    ok(await tool.action(input));
    assert.deepEqual(calls.at(-1), { ...query, semantic: false, policy: { id }, deadlineMs: 5000,
      budget: { maxTokens, maxItems: 24 }, readSet: access.readSet });
  }
  ok(await tool.action(tool.schema.parse(query))); assert.deepEqual(calls.at(-1).budget, {});
  for (const patch of [{ query: '' }, { query: 'x'.repeat(4001) }, { types: [] }, { types: ['memory', 'memory'] },
    { types: ['raw'] }, { types: ['memory', 'card', 'memory'] }, { intent: 'guess' }, { semantic: 1 },
    ...[63, 4001, 64.5, '64', null].map(maxTokens => ({ maxTokens })),
    ...[0, 25, 1.5, '1'].map(maxItems => ({ maxItems })),
    ...[0, 5001, 1.5, '1'].map(deadlineMs => ({ deadlineMs })),
    ...['rank-first-whole-v1', null, {}, { id: 'unknown' }, { id: 'rank-first-whole-v1', extra: true }].map(policy => ({ policy })),
    ...['authority', 'namespace', 'readSet', 'context', 'configuration', 'provider', 'counter', 'budget', 'cursor', 'limit', 'unknown'].map(key => ({ [key]: {} }))]) {
    assert.equal(tool.schema.safeParse({ ...query, ...patch }).success, false, JSON.stringify(patch));
  }
  assert.equal(access.call(core, 'refreshContextIndex', {}).error.code, 'authority_required');
  access.revoke(); assert.equal((await tool.action(query)).error.code, 'authority_required');
});

test('A11 actual MCP text equals core meteredText; diagnostics stay only in client metadata; capabilities and sanitization', async t => {
  const workspace = createTestWorkspace(t, { prefix: 'assembly-wire-' }), path = join(workspace.path, 'store.sqlite');
  const access = createContextReadAccess(ns), counter = await createContextCounter();
  const core = openMemoryCore({ path, contextRead: { ...access.configuration, counter } });
  const memory = admit(core), secret = 'sk-' + 'S'.repeat(32), sanitized = admit(core, 'assembly secret ' + secret);
  const caps = ok(core.getContextReadCapabilities());
  assert.ok(caps.methods.includes('contextRead')); assert.ok(!caps.unsupported.includes('assembly'));
  assert.deepEqual(caps.assembly, { representation: 'representation-v2', defaults: ASSEMBLY_DEFAULTS, policies: [...ASSEMBLY_POLICIES],
    defaultPolicy: 'rank-first-whole-v1', counter: { id: 'tiktoken-o200k_base' }, limits: { ...ASSEMBLY_LIMITS } });
  let envelope, supplied;
  const wrapped = { ...core, async contextRead(input, token) { supplied = input; envelope = await core.contextRead(input, token); return envelope; } };
  const client = await connect(workspace, buildCairnServer({ path, binding: ns, core: wrapped, context: access }));
  const tool = (await client.listTools()).tools.find(tool => tool.name === 'read_memory_context');
  assert.equal(tool.annotations.readOnlyHint, true); assert.equal(tool.annotations.openWorldHint, true);
  assert.deepEqual(Object.keys(tool.inputSchema.properties), ['query', 'types', 'intent', 'semantic', 'maxTokens', 'maxItems', 'policy', 'deadlineMs']);
  for (const id of ASSEMBLY_POLICIES) {
    const response = await client.callTool({ name: tool.name, arguments: { ...query, maxTokens: 4000, maxItems: 2, policy: { id } } });
    const value = ok(envelope);
    assert.deepEqual(response.content, [{ type: 'text', text: meteredText(value.metered) }]);
    assert.deepEqual(Object.keys(response).sort(), ['_meta', 'content', 'isError']);
    assert.deepEqual(response._meta, { [metaKey]: value.diagnostics, [snapshotKey]: value.snapshot });
    assert.equal(response.isError, false); assert.equal(value.metered.framing, ASSEMBLY_FRAMING);
    assert.equal(countOpenAITokens(modelInput(response)), value.diagnostics.budget.used);
    assert.ok(value.diagnostics.budget.used <= 4000);
    assert.equal(modelInput(response).includes('diagnostics'), false);
    assert.equal(modelInput(response).includes('counterCalls'), false);
    assert.equal(modelInput(response).includes(secret), false);
    assert.deepEqual(value.metered.items.map(item => item.body).sort(), [memory.content, sanitized.content].sort());
    assert.ok(value.metered.items.some(item => item.body.includes('[REDACTED]')));
  }
  const successful = supplied;
  for (const field of ['authority', 'namespace', 'readSet', 'configuration', 'unknown']) {
    assert.equal((await client.callTool({ name: tool.name, arguments: { ...query, [field]: {} } })).isError, true);
    assert.equal(supplied, successful, 'invalid fields never reach core');
  }
  const refused = await client.callTool({ name: tool.name, arguments: { ...query, maxTokens: 64 } });
  assert.deepEqual(refused, contextToolResponse(envelope, { assembly: true })); assert.equal(refused.isError, false);
  assert.deepEqual(JSON.parse(refused.content[0].text).value.items, []);
  assert.equal(refused._meta[snapshotKey], null);
  wrapped.contextRead = () => { throw Error(secret); };
  const thrown = await client.callTool({ name: tool.name, arguments: query });
  assert.equal(JSON.parse(thrown.content[0].text).error.code, 'memory_operation_failed');
  assert.equal(JSON.stringify(thrown).includes(secret), false);
});

test('A11 explicit programmatic counter is immediately ready and independent of a legacy model', async t => {
  t.mock.method(globalThis, 'fetch', () => assert.fail('network/provider call'));
  const counter = await createContextCounter();
  for (const text of ['', 'synthetic ASCII', '資料庫 𠀁𠀂', 'ＡＢＣ１２', '<|endoftext|>', ASSEMBLY_FRAMING]) {
    assert.equal(counter.countTokens(text), countOpenAITokens(text));
  }
  assert.throws(() => counter.countTokens(null), { code: 'token_count_unavailable' });
  for (const model of [undefined, { countTokens() { assert.fail('legacy model counter'); } }]) {
    const workspace = createTestWorkspace(t, { prefix: 'assembly-api-' }), path = join(workspace.path, 'store.sqlite');
    const seed = openMemoryCore({ path }); admit(seed); seed.close();
    const server = createCairnServer({ path, namespace: ns, contextRead: 'context-read-v1', contextCounter: counter, model });
    assert.equal(await server.contextCounterReady, true);
    const client = await connect(workspace, server);
    const response = await client.callTool({ name: 'read_memory_context', arguments: query });
    const value = ok(JSON.parse(response.content[0].text));
    assert.equal(response._meta[metaKey].counter.id, 'tiktoken-o200k_base'); assert.equal(response._meta[metaKey].policy.id, 'rank-first-whole-v1');
    assert.equal(response._meta[metaKey].budget.used, countOpenAITokens(response.content[0].text));
    assert.equal(response._meta[metaKey].budget.maxTokens, 1500); assert.equal(response._meta[metaKey].budget.maxItems, 12);
    assert.equal(value.items.length, 1);
  }
});

test('A01/A11 original programmatic call shape preserves §13 while loading; assembly succeeds after awaitable readiness', t => {
  const workspace = createTestWorkspace(t, { prefix: 'assembly-programmatic-ready-' });
  const factory = new URL('../../openai/context-counter.mjs', import.meta.url).href;
  const source = `import assert from 'node:assert/strict';import {registerHooks} from 'node:module';
    let release;globalThis.counterGate=new Promise(resolve=>release=resolve);globalThis.counterStarts=0;
    registerHooks({load(url,context,next){const result=next(url,context);if(url!==${JSON.stringify(factory)})return result;
      const source=typeof result.source==='string'?result.source:Buffer.from(result.source).toString('utf8');
      const marker='export async function createContextCounter() {';assert.ok(source.includes(marker));
      return {...result,source:source.replace(marker,marker+' globalThis.counterStarts++; await globalThis.counterGate;')};}});
    globalThis.fetch=()=>assert.fail('provider call');
    const {createCairnServer}=await import(${JSON.stringify(new URL('../server.mjs', import.meta.url).href)});
    ${childMcp}
    const server=createCairnServer({path:${JSON.stringify(join(workspace.path, 'store.sqlite'))},namespace:${JSON.stringify(ns)},contextRead:'context-read-v1'});
    assert.ok(server.contextCounterReady instanceof Promise);assert.equal(globalThis.counterStarts,1);
    let settled=false;server.contextCounterReady.then(()=>settled=true);
    const client=await attach(server);
    try{
      const names=(await client.listTools()).tools.map(tool=>tool.name);
      assert.ok(names.includes('find_memory_candidates'));assert.ok(names.includes('fetch_memory_candidate_evidence'));
      const saved=envelope(await call(client,'remember_memory',{content:'assembly ＡＢＣ compatibility'}));assert.equal(saved.ok,true);
      const inspected=envelope(await call(client,'inspect_memory',{memoryId:saved.value.memory.id}));assert.equal(inspected.ok,true);
      const found=envelope(await call(client,'find_memory_candidates',${JSON.stringify(query)}));assert.equal(found.ok,true);assert.equal(found.value.items.length,1);
      const fetched=envelope(await call(client,'fetch_memory_candidate_evidence',{refs:found.value.items.map(item=>item.ref),intent:'current'}));
      assert.equal(fetched.ok,true);assert.equal(fetched.value.items[0].content,inspected.value.memory.content);
      const early=await call(client,'read_memory_context',${JSON.stringify(query)});
      assert.deepEqual(envelope(early),{ok:false,error:{code:'token_count_unavailable',retryable:false},evidenceTrust:'untrusted-data-not-instructions'});
      assert.equal(early.isError,true);assert.equal(early._meta,undefined);
      for(const block of early.content)for(const field of ['diagnostics','candidates','channels','coverage','trace'])assert.equal(block.text.includes(field),false);
      assert.equal(settled,false);release();assert.equal(await server.contextCounterReady,true);
      const response=await call(client,'read_memory_context',${JSON.stringify(query)}),assembled=envelope(response);
      assert.equal(assembled.ok,true);assert.equal(response._meta[${JSON.stringify(metaKey)}].counter.id,'tiktoken-o200k_base');
      assert.equal(assembled.value.items.length,1);assert.equal(assembled.value.items[0].body,inspected.value.memory.content);
      assert.equal(assembled.value.items[0].ref.id,saved.value.memory.id);
      assert.ok(response._meta[${JSON.stringify(metaKey)}].budget.used<=1500);assert.equal(globalThis.counterStarts,1);
    }finally{release();await client.close();await server.close();}
    console.log('programmatic-readiness-verified');`;
  assert.equal(runModule(workspace, 'readiness', source), 'programmatic-readiness-verified');
});

test('A01/A11 assembly preserves candidate query ranking and rejects invalid Unicode/NUL without laundering', async t => {
  const workspace = createTestWorkspace(t, { prefix: 'assembly-query-parity-' }), path = join(workspace.path, 'store.sqlite');
  const seed = openMemoryCore({ path }), apple = admit(seed, 'apple ordinary'); admit(seed, '[REDACTED] ordinary'); seed.close();
  const client = await connect(workspace, createCairnServer({ path, namespace: ns, contextRead: 'context-read-v1', contextCounter: await createContextCounter() }));
  const input = { ...query, query: 'apple sk-' + 'S'.repeat(32), semantic: false, deadlineMs: 5000 };
  const found = ok(JSON.parse((await client.callTool({ name: 'find_memory_candidates', arguments: { ...input, limit: 24 } })).content[0].text));
  const assembled = ok(JSON.parse((await client.callTool({ name: 'read_memory_context', arguments: { ...input, maxTokens: 4000, maxItems: 24 } })).content[0].text));
  assert.deepEqual(assembled.items.map(item => [item.ref.id, item.ref.rev]), found.items.map(item => [item.ref.memoryId, item.ref.revision]));
  assert.deepEqual(found.items.map(item => item.ref.memoryId), [apple.id]);
  for (const invalid of ['api_key=abcdefgh\0', 'api_key=abcdefgh\ud800', '\udc00', 'apple\0']) {
    for (const name of ['find_memory_candidates', 'read_memory_context']) {
      const response = await client.callTool({ name, arguments: { ...query, query: invalid } });
      assert.equal(response.isError, true);
      assert.deepEqual(JSON.parse(response.content[0].text), { ok: false, error: { code: 'invalid_input', retryable: false }, evidenceTrust: 'untrusted-data-not-instructions' });
    }
  }
});

test('A11 real MCP assembly failures isolate candidate diagnostics; §13 error text is unchanged', async t => {
  for (const semantic of [true, false]) {
    const workspace = createTestWorkspace(t, { prefix: 'assembly-error-meta-' });
    const path = semantic ? join(workspace.path, 'store.sqlite') : ':memory:';
    const access = createContextReadAccess(ns), counter = await createContextCounter();
    const core = openMemoryCore({ path, contextRead: { ...access.configuration, counter } }); admit(core);
    let envelope, candidateEnvelope;
    const wrapped = { ...core,
      async contextRead(input, token) { envelope = await core.contextRead(input, token); return envelope; },
      async findCandidates(input, token) { candidateEnvelope = await core.findCandidates(input, token); return candidateEnvelope; } };
    const client = await connect(workspace, buildCairnServer({ path, binding: ns, core: wrapped, context: access }));
    const response = await client.callTool({ name: 'read_memory_context', arguments: { ...query, semantic } });
    const code = semantic ? 'invalid_input' : 'index_unavailable';
    assert.equal(envelope.error.code, code); assert.ok(envelope.error.details.candidates);
    assert.deepEqual(response.content, [{ type: 'text', text: JSON.stringify({ ok: false,
      error: { code, retryable: envelope.error.retryable }, evidenceTrust: 'untrusted-data-not-instructions' }) }]);
    assert.equal(response.isError, true);
    assert.deepEqual(response._meta, { [metaKey]: { candidates: envelope.error.details.candidates } });
    for (const block of response.content) for (const field of ['candidates', 'channels', 'coverage', 'trace']) assert.equal(block.text.includes(field), false);
    assert.ok(Buffer.byteLength(JSON.stringify(envelope)) <= 65536);
    assert.ok(Buffer.byteLength(JSON.stringify(response)) <= CONTEXT_TRANSPORT_BYTES);
    const legacy = await client.callTool({ name: 'find_memory_candidates', arguments: { ...query, semantic } });
    assert.deepEqual(legacy, contextToolResponse(candidateEnvelope)); assert.equal(legacy._meta, undefined);
    assert.ok(JSON.parse(legacy.content[0].text).error.details.channels);
  }
});

test('A11 CLI keyless and keyed context startup inject the counter without dispatch', async t => {
  const workspace = createTestWorkspace(t, { prefix: 'assembly-cli-' }), path = join(workspace.path, 'store.sqlite');
  const seed = openMemoryCore({ path }); admit(seed); seed.close();
  for (const key of [false, true]) {
    const { client } = await contextHost(workspace, path, { key });
    const response = await client.callTool({ name: 'read_memory_context', arguments: query });
    const value = ok(JSON.parse(response.content[0].text));
    assert.equal(response._meta[metaKey].counter.id, 'tiktoken-o200k_base'); assert.equal(value.items.length, 1);
    assert.equal(response._meta[metaKey].budget.used, countOpenAITokens(response.content[0].text));
    await client.close();
  }
});

test('A11 complete core envelope bound includes diagnostics; encoded transport has its independent exact byte bound', async () => {
  const metered = { framing: ASSEMBLY_FRAMING, items: [] }, diagnostics = { padding: '' };
  const base = { ok: true, value: { metered, snapshot: null, diagnostics } };
  diagnostics.padding = '界'.repeat(20000);
  diagnostics.padding += 'x'.repeat(65536 - Buffer.byteLength(JSON.stringify(base)));
  assert.equal(Buffer.byteLength(JSON.stringify(base)), 65536);
  const response = contextToolResponse(base, { assembly: true });
  assert.equal(response.isError, false); assert.equal(response.content[0].text, meteredText(metered));
  assert.deepEqual(response._meta[metaKey], diagnostics);
  const tooLarge = { ...base, value: { metered, snapshot: null, diagnostics: { padding: diagnostics.padding + 'x' } } };
  assert.deepEqual(contextToolResponse(tooLarge, { assembly: true }), contextToolResponse(tooLarge));
  assert.equal(JSON.parse(contextToolResponse(tooLarge, { assembly: true }).content[0].text).error.code, 'context_item_too_large');
  const error = { ok: false, error: { code: 'index_unavailable', retryable: false,
    details: { reason: 'synthetic', candidates: { trace: { padding: '' } } } } };
  error.error.details.candidates.trace.padding = 'x'.repeat(65536 - Buffer.byteLength(JSON.stringify(error)));
  assert.equal(Buffer.byteLength(JSON.stringify(error)), 65536);
  const failure = contextToolResponse(error, { assembly: true });
  assert.deepEqual(JSON.parse(failure.content[0].text), { ok: false, error: { code: 'index_unavailable', retryable: false,
    details: { reason: 'synthetic' } }, evidenceTrust: 'untrusted-data-not-instructions' });
  assert.deepEqual(failure._meta[metaKey], { candidates: error.error.details.candidates });
  error.error.details.candidates.trace.padding += 'x';
  assert.equal(JSON.parse(contextToolResponse(error, { assembly: true }).content[0].text).error.code, 'context_item_too_large');
  for (const result of [response, failure]) {
    const incoming = new PassThrough(), outgoing = new PassThrough(), chunks = [];
    const transport = new ContextStdioServerTransport(incoming, outgoing);
    outgoing.on('data', chunk => chunks.push(chunk));
    try {
      const message = { jsonrpc: '2.0', id: '', result };
      message.id = 'x'.repeat(CONTEXT_TRANSPORT_BYTES - Buffer.byteLength(JSON.stringify(message)) - 1);
      await transport.send(message); assert.equal(Buffer.concat(chunks).length, CONTEXT_TRANSPORT_BYTES);
      await assert.rejects(transport.send({ ...message, id: message.id + 'x' }), /context_transport_response_too_large/);
      assert.equal(Buffer.concat(chunks).length, CONTEXT_TRANSPORT_BYTES);
    } finally { await transport.close(); incoming.destroy(); outgoing.destroy(); }
  }
});

test('A11 actual core refuses oversized assembly independently of the counter', async t => {
  const f = assemblyFixture(t, { counter: { id: 'synthetic-all-fit', countTokens: () => 0 } });
  f.seed(sample.items.map(item => ({ ...item, receipts: item.receipts.map((source, i) => ({ ...source,
    excerpt: String(i).padStart(2, '0') + '界'.repeat(790) })) })));
  const result = await f.call('contextRead', assemblyQuery({ budget: { maxTokens: 4000, maxItems: 24 } }));
  assert.equal(result.error.code, 'context_item_too_large');
  assert.deepEqual(contextToolResponse(result, { assembly: true }), contextToolResponse(result));
});

test('A11 check-config never resolves tokenizer/WASM, links SQLite or opens a database; flag-off server import/startup is tokenizer-free', t => {
  const workspace = createTestWorkspace(t, { prefix: 'assembly-check-' }), path = join(workspace.path, 'missing', 'store.sqlite');
  const source = `import assert from 'node:assert/strict';
    import {registerHooks} from 'node:module'; import {existsSync} from 'node:fs';
    let sqliteAllowed=false,tokenizerResolutions=0;
    registerHooks({resolve(specifier,context,next){
      if(specifier==='node:sqlite'&&!sqliteAllowed)throw Error('SQLite linked before check returned');
      if(specifier==='tiktoken'||specifier.includes('/tiktoken/')||specifier.endsWith('.wasm')||specifier.endsWith('/openai/index.mjs')){
        tokenizerResolutions++;throw Error('Unexpected tokenizer package/WASM load');}return next(specifier,context);}});
    globalThis.fetch=()=>assert.fail('provider call');
    const {start}=await import(${JSON.stringify(new URL('../cli.mjs', import.meta.url).href)});
    const env=Object.defineProperty({},'OPENAI_API_KEY',{get(){assert.fail('key lookup');}});
    const logs=[],log=console.log;console.log=value=>logs.push(JSON.parse(value));
    for(const provider of [[],${JSON.stringify(contextProviderArgs)}])await start(['--check-config','--db',${JSON.stringify(path)},'--owner',${JSON.stringify(ns.ownerId)},'--context-read','context-read-v1',...provider],env);
    console.log=log;assert.equal(tokenizerResolutions,0);assert.equal(existsSync(${JSON.stringify(join(workspace.path, 'missing'))}),false);
    for(const [i,result] of logs.entries())assert.deepEqual(result,{ok:true,mode:'configuration-check',contextRead:'context-read-v1',contextReadPersonal:false,
      scope:'personal',provider:i?{provider:'openai',model:'text-embedding-3-small',dimensions:8,maxRequests:20,maxUsd:.1}:null,preset:i?'rrf-k10':'rrf-k60-d12',
      modelKeyInspected:false,databaseOpened:false,providerContacted:false,automaticCapture:false});
    sqliteAllowed=true;const {createCairnServer}=await import(${JSON.stringify(new URL('../server.mjs', import.meta.url).href)});
    assert.equal(tokenizerResolutions,0);
    const plain=createCairnServer({path:${JSON.stringify(join(workspace.path, 'plain.sqlite'))},namespace:${JSON.stringify(ns)}});
    await plain.close();assert.equal(tokenizerResolutions,0);console.log('check-and-laziness-verified');`;
  assert.equal(runModule(workspace, 'check', source), 'check-and-laziness-verified');
});

test('A01/A11 missing tokenizer preserves programmatic retrieval, settles readiness false and refuses only assembly; CLI still fails clearly', t => {
  const workspace = createTestWorkspace(t, { prefix: 'assembly-missing-tokenizer-' }), missing = join(workspace.path, 'missing.sqlite');
  const source = `import assert from 'node:assert/strict';import {existsSync} from 'node:fs';import {registerHooks} from 'node:module';
    let resolutions=0;const unhandled=[];process.on('unhandledRejection',error=>unhandled.push(error));
    registerHooks({resolve(specifier,context,next){if(specifier==='tiktoken'){
      resolutions++;throw Object.assign(Error('synthetic package absent'),{code:'ERR_MODULE_NOT_FOUND'});}return next(specifier,context);}});
    globalThis.fetch=()=>assert.fail('provider call');
    const {createCairnServer,createContextCounter}=await import(${JSON.stringify(new URL('../server.mjs', import.meta.url).href)});
    ${childMcp}
    assert.equal(resolutions,0);
    const plain=createCairnServer({path:${JSON.stringify(join(workspace.path, 'plain.sqlite'))},namespace:${JSON.stringify(ns)}});
    assert.equal(plain.contextCounterReady,undefined);await plain.close();assert.equal(resolutions,0);
    const server=createCairnServer({path:${JSON.stringify(missing)},namespace:${JSON.stringify(ns)},contextRead:'context-read-v1'});
    const client=await attach(server);
    try{
      assert.equal(await server.contextCounterReady,false);assert.equal(resolutions,1);
      const saved=envelope(await call(client,'remember_memory',{content:'assembly still retrievable'}));assert.equal(saved.ok,true);
      const found=envelope(await call(client,'find_memory_candidates',${JSON.stringify(query)}));assert.equal(found.ok,true);
      assert.deepEqual(found.value.items.map(item=>item.ref.memoryId),[saved.value.memory.id]);
      const fetched=envelope(await call(client,'fetch_memory_candidate_evidence',{refs:found.value.items.map(item=>item.ref),intent:'current'}));assert.equal(fetched.ok,true);
      for(let i=0;i<2;i++){
        const refused=await call(client,'read_memory_context',${JSON.stringify(query)});
        assert.deepEqual(envelope(refused),{ok:false,error:{code:'token_count_unavailable',retryable:false},evidenceTrust:'untrusted-data-not-instructions'});
        assert.equal(refused.isError,true);assert.equal(refused._meta,undefined);
        for(const block of refused.content)for(const field of ['diagnostics','candidates','channels','coverage','trace','synthetic package absent'])assert.equal(block.text.includes(field),false);
      }
      await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(unhandled,[]);assert.equal(resolutions,1);
    }finally{await client.close();await server.close();}
    await assert.rejects(createContextCounter(),{code:'context_tokenizer_unavailable'});assert.equal(resolutions,2);
    const {start}=await import(${JSON.stringify(new URL('../cli.mjs', import.meta.url).href)}),errors=[],error=console.error;
    console.error=value=>errors.push(value);
    await assert.rejects(start(['--db',${JSON.stringify(join(workspace.path, 'cli-missing.sqlite'))},'--owner',${JSON.stringify(ns.ownerId)},'--context-read','context-read-v1'],{}),/context_tokenizer_unavailable/);
    console.error=error;assert.equal(resolutions,3);assert.equal(existsSync(${JSON.stringify(join(workspace.path, 'cli-missing.sqlite'))}),false);
    assert.deepEqual(errors,['cairn_context_tokenizer_unavailable: check the documented tiktoken runtime dependency']);
    console.log('missing-tokenizer-verified');`;
  assert.equal(runModule(workspace, 'missing', source), 'missing-tokenizer-verified');
});

test('A15 raw compact descriptors, SDK schema, mixed expansion and caller prefix-vector refusals', async () => {
  const tools = new Map(), calls = [], access = createContextReadAccess({ ...ns, scope: 'project', projectId: 'p' }, true);
  registerContextReadTools((name, description, schema, action) => tools.set(name, { description, schema, action }),
    { fetchCandidateEvidence(input) { calls.push(input); return { ok: true, value: input }; } }, access);
  const tool = tools.get('fetch_memory_candidate_evidence');
  const ref = { ns: 0, type: 'memory', id: 'memory', rev: 1, f: 'abcdefgh' };
  const full = { type: 'card', namespace: access.readSet[1], cardId: 'card', revision: 2, bodyRevision: 1 };
  const parsed = tool.schema.parse({ refs: [ref, full], intent: 'current' });
  ok(await tool.action(parsed));
  assert.deepEqual(calls[0], { refs: [
    { type: 'memory', namespace: access.readSet[0], memoryId: 'memory', revision: 1 }, full,
  ], intent: 'current', fences: ['abcdefgh', null], readSet: access.readSet });
  const { f: unused, ...missing } = ref;
  let getters = 0;
  const accessor = { ...ref }; Object.defineProperty(accessor, 'ns', { enumerable: true, get() { getters++; return 0; } });
  const nonenumerable = { ...ref }; Object.defineProperty(nonenumerable, 'ns', { value: 0 });
  assert.equal(tool.schema.safeParse({ refs: [nonenumerable], intent: 'current' }).success, true, 'own data may be non-enumerable');
  for (const bad of [missing, ...['', 'short', '123456789', '!!!!abcd'].map(f => ({ ...ref, f })),
    ...[-1, .5, Number.MAX_SAFE_INTEGER + 1].map(ns => ({ ...ref, ns })), accessor,
    Object.assign(Object.create({ ns: 0 }), { type: 'memory', id: 'memory', rev: 1, f: 'abcdefgh' }),
    { ...ref, namespace: ns }, { ...ref, memoryId: 'memory' }, { ...ref, bodyRev: 1 },
    { ...ref, type: 'card' }, JSON.parse('{"ns":0,"type":"memory","id":"memory","rev":1,"f":"abcdefgh","__proto__":{}}'),
    { ...ref, constructor: 'no' }, { ...ref, prototype: 'no' },
  ]) {
    assert.equal(tool.schema.safeParse({ refs: [bad], intent: 'current' }).success, false);
  }
  assert.equal(getters, 0, 'descriptor validation never invokes compact getters');
  for (const input of [{ refs: [ref], intent: 'current', fences: [ref.f] }, { refs: [full], intent: 'current', fences: [null] },
    { snapshot: 'opaque', fences: [ref.f] }]) {
    assert.equal(tool.schema.safeParse(input).success, false);
    assert.equal((await tool.action(input)).error.code, 'invalid_input');
  }
  assert.equal(calls.length, 1);
  assert.equal((await tool.action(tool.schema.parse({ refs: [{ ...ref, ns: 2 }], intent: 'current' }))).error.code, 'invalid_input');
  assert.equal(calls.length, 1);
  access.revoke();
  assert.equal((await tool.action(parsed)).error.code, 'authority_required'); assert.equal(calls.length, 1);
});

function assemblyTools(core, access) {
  const tools = new Map();
  registerContextReadTools((name, description, schema, action) => tools.set(name, { description, schema, action }), core, access);
  return tools;
}
function confirmedCard(f, namespace, memory) {
  const draft = ok(f.host.call(f.core, 'createCardDraft', { namespace, actionId: 'draft-' + namespace.scope, drafting: 'authored', input: {
    title: 'assembly Card', body: 'Canonical Card body.',
    ...(memory ? { sourcePolicy: 'retained-receipts-v1', memoryRefs: [
      { type: 'memory', namespace, memoryId: memory.id, revision: memory.revision }] } :
    { authoredInput: { text: 'Canonical note.', occurredAt: null } }),
  } }));
  return ok(f.host.call(f.core, 'confirmCardDraft', { namespace, cardId: draft.id, expectedRevision: draft.revision,
    actionId: 'confirm-' + namespace.scope, applicability: 'current' }));
}

test('A14–A17 actual listed description, one/two namespace compact round trips, canonical metadata and host snapshots', async t => {
  for (const two of [false, true]) {
    const f = assemblyFixture(t, { cards: true, counter: { id: 'fit', countTokens: () => 1 } });
    const access = createContextReadAccess({ ownerId: 'synthetic-u5a', scope: 'project', projectId: 'test' }, two);
    const core = f.reopen({ ...access.configuration, counter: { id: 'fit', countTokens: () => 1 } });
    for (const namespace of access.readSet) { const memory = f.admit('assembly own body ' + namespace.scope, namespace); confirmedCard(f, namespace, memory); }
    const tools = assemblyTools(core, access), fetchTool = tools.get('fetch_memory_candidate_evidence');
    const client = await connect(f.workspace, buildCairnServer({ path: f.path, binding: access.namespace, core, context: access }));
    const listed = (await client.listTools()).tools.find(tool => tool.name === 'read_memory_context');
    assert.ok(listed.description.includes("`sameAsBody` means this receipt's excerpt equals this item's body verbatim"));
    assert.ok(listed.description.includes(JSON.stringify(ASSEMBLY_DEFAULTS)));
    assert.match(listed.description, /snapshot_stale means re-run read_memory_context/);
    for (const intent of ['current', 'history']) {
      const response = await client.callTool({ name: 'read_memory_context', arguments: { ...query, types: ['memory', 'card'], intent, maxTokens: 4000 } });
      const value = ok(JSON.parse(modelInput(response))), diagnostics = response._meta[metaKey], snapshot = response._meta[snapshotKey];
      assert.equal(value.items.length, two ? 4 : 2);
      assert.deepEqual(Object.keys(value), ['framing', 'items']); assert.equal(response.content.length, 1); assert.equal(response.structuredContent, undefined);
      assert.equal(modelInput(response).includes(snapshot), false);
      const fences = JSON.parse(Buffer.from(snapshot.split('.')[0], 'base64url')).fences;
      assert.ok(fences.every(fence => !modelInput(response).includes(fence)));
      assert.deepEqual(value.items.map(item => item.ref.f), fences.map(fence => fence.slice(0, 8)));
      const compactResponse = await client.callTool({ name: 'fetch_memory_candidate_evidence', arguments: { refs: value.items.map(item => item.ref), intent } });
      const compact = ok(JSON.parse(compactResponse.content[0].text));
      const canonical = ok(await fetchTool.action(fetchTool.schema.parse({ refs: diagnostics.items.map(item => item.ref), intent })));
      assert.deepEqual(compact, canonical);
      assert.deepEqual(compactResponse, contextToolResponse({ ok: true, value: canonical }));
      assert.deepEqual(ok(await fetchTool.action(fetchTool.schema.parse({ snapshot }))), canonical);
      const mixed = value.items.map((item, i) => i % 2 ? diagnostics.items[i].ref : item.ref);
      assert.deepEqual(ok(await fetchTool.action(fetchTool.schema.parse({ refs: mixed, intent }))), canonical);
      value.items.forEach((item, i) => {
        assert.deepEqual(compact.items[i].ref, diagnostics.items[i].ref);
        assert.deepEqual(item.ref.ns, access.readSet.findIndex(ns => JSON.stringify(ns) === JSON.stringify(compact.items[i].ref.namespace)));
        if (item.ref.type === 'memory') {
          assert.equal(item.metadata, undefined); assert.equal(item.sourceAccess, undefined); assert.equal(item.sourcesComplete, undefined);
          assert.deepEqual(item.sources, [{ index: 0, role: 'user', sameAsBody: true }]);
          assert.equal(JSON.stringify(item).split(JSON.stringify(item.body)).length, 2, 'body appears only once');
          assert.equal(diagnostics.items[i].sources[0].kind, 'sameAsBody');
          assert.equal(compact.items[i].provenance.sources.length, 1);
          assert.equal(JSON.stringify(compact.items[i].provenance).includes(item.body), false);
        } else {
          assert.deepEqual(Object.keys(item.metadata), ['support', 'origin']);
          assert.equal(item.sourceAccess, 'unsupported'); assert.equal(item.sourcesComplete, false);
        }
      });
    }
  }
});

function place(f, memoryId, title) {
  const namespace = { ownerId: 'synthetic-u5a', scope: 'project', projectId: 'test' };
  return ok(f.core.applyPlacement({ namespace, proposal: { items: [{ memoryId, parentIds: [], newL1: { title, parentL2Ids: [] } }] },
    expectedMemoryRevisions: [{ memoryId, revision: ok(f.core.get({ namespace, memoryId })).memory.revision }],
    expectedIndexRevision: f.db.prepare('SELECT epoch FROM namespace_epochs WHERE owner_id=? AND scope=? AND project_id=?')
      .get(namespace.ownerId, namespace.scope, namespace.projectId).epoch }));
}

test('A15 every mutation × intent pins eligibility, revisions, generations and both refetch-path error precedences', async t => {
  const cases = [
    ['correction', 'memory', true, 'revision_conflict', 'revision_conflict'],
    ['filing', 'memory', true, 'revision_conflict', 'revision_conflict'],
    ['supersession', 'memory', true, 'evidence_unavailable', 'revision_conflict'],
    ['forget', 'memory', true, 'evidence_unavailable', 'evidence_unavailable'],
    ['deletion', 'memory', false, 'evidence_unavailable', 'evidence_unavailable'],
    ['receipt', 'memory', false, 'snapshot_stale', 'snapshot_stale'],
    ['support', 'card', false, 'evidence_unavailable', 'snapshot_stale'],
    ['support-revision', 'card', false, 'evidence_unavailable', 'revision_conflict'],
    ['applicability', 'card', false, 'evidence_unavailable', 'snapshot_stale'],
    ['applicability-revision', 'card', false, 'evidence_unavailable', 'revision_conflict'],
    ['edit-current', 'card', false, 'revision_conflict', 'revision_conflict'],
    ['edit-ineligible', 'card', false, 'evidence_unavailable', 'revision_conflict'],
    ['parent-move', 'memory', true, null, null],
  ];
  for (const [change, type, generationsChange, currentCode, historyCode] of cases) for (const intent of ['current', 'history']) await t.test(change + '/' + intent, async () => {
    const f = assemblyFixture(t, { cards: true, counter: { id: 'fit', countTokens: () => 1 } });
    const namespace = { ownerId: 'synthetic-u5a', scope: 'project', projectId: 'test' };
    const access = createContextReadAccess(namespace), core = f.reopen({ ...access.configuration, counter: { id: 'fit', countTokens: () => 1 } });
    const memory = f.admit('assembly original mutation target');
    if (change === 'parent-move') place(f, memory.id, 'First parent');
    const card = type === 'card' ? confirmedCard(f, namespace, memory) : null;
    const tools = assemblyTools(core, access), fetchTool = tools.get('fetch_memory_candidate_evidence');
    const delivered = ok(await tools.get('read_memory_context').action({ ...query, types: [type], intent, maxTokens: 4000 }));
    const compact = delivered.metered.items[0].ref, full = delivered.diagnostics.items[0].ref;
    const before = ok(await fetchTool.action(fetchTool.schema.parse({ refs: [full], intent })));
    assert.deepEqual(ok(await fetchTool.action(fetchTool.schema.parse({ refs: [compact], intent }))), before);
    const generations = () => ({ memory: f.db.prepare('SELECT epoch FROM namespace_epochs WHERE owner_id=? AND scope=? AND project_id=?')
      .get(namespace.ownerId, namespace.scope, namespace.projectId).epoch,
    card: f.db.prepare('SELECT generation FROM card_epochs WHERE owner_id=? AND scope=? AND project_id=?')
      .get(namespace.ownerId, namespace.scope, namespace.projectId)?.generation ?? 1 });
    const oldGenerations = generations();
    const receipt = { client: 'synthetic', sessionId: 'mutation', eventId: change, role: 'user', excerpt: 'post-mutation source' };
    if (change === 'correction') ok(f.core.correct({ namespace, memoryId: memory.id, expectedRevision: memory.revision,
      content: 'assembly post-mutation corrected', kind: 'fact', receipt }));
    if (change === 'filing') place(f, memory.id, 'New parent');
    if (change === 'supersession') ok(f.core.supersede({ namespace, memoryId: memory.id, expectedRevision: memory.revision,
      replacement: { content: 'assembly post-mutation replacement', kind: 'fact' }, receipts: [receipt] }));
    if (change === 'forget') ok(f.core.forget({ namespace, memoryId: memory.id, expectedRevision: memory.revision }));
    if (['deletion', 'receipt', 'support', 'support-revision'].includes(change)) f.writer.prepare('DELETE FROM receipts WHERE memory_id=?').run(memory.id);
    if (change === 'deletion') f.writer.prepare('DELETE FROM memories WHERE id=?').run(memory.id);
    if (change.endsWith('-revision') || change.startsWith('edit-')) {
      f.writer.prepare('UPDATE private_cards SET revision=revision+1 WHERE id=?').run(card.id);
    }
    if (change.startsWith('applicability')) f.writer.prepare("UPDATE card_applicability_reviews SET applicability='historical',reviewed_revision=? WHERE card_id=?")
      .run(card.revision + Number(change.endsWith('-revision')), card.id);
    if (change.startsWith('edit-')) {
      f.writer.prepare("UPDATE private_cards SET body='post-mutation Card',body_revision=body_revision+1 WHERE id=?").run(card.id);
      if (change === 'edit-current') f.writer.prepare('UPDATE card_applicability_reviews SET reviewed_revision=? WHERE card_id=?').run(card.revision + 1, card.id);
    }
    if (change === 'parent-move') place(f, memory.id, 'Second parent');
    const afterGenerations = generations();
    assert.equal(JSON.stringify(afterGenerations) !== JSON.stringify(oldGenerations), generationsChange, 'namespace generations pinned');
    if (type === 'memory') {
      const row = f.db.prepare('SELECT revision,currentness,review_state,filing_status,deleted FROM memories WHERE id=?').get(memory.id);
      const expectedRevision = full.revision + Number(['correction', 'filing', 'supersession', 'forget'].includes(change));
      if (change === 'deletion') assert.equal(row, undefined);
      else {
        assert.equal(row.revision, expectedRevision, 'Memory revision pinned');
        assert.equal(row.currentness, change === 'supersession' ? 'historical' : 'current');
        assert.equal(row.review_state, 'none'); assert.equal(row.deleted, change === 'forget' ? 1 : 0);
        assert.equal(row.filing_status, ['filing', 'parent-move'].includes(change) ? 'filed' : 'unfiled');
      }
    } else {
      const row = f.db.prepare('SELECT revision,body_revision FROM private_cards WHERE id=?').get(card.id);
      assert.equal(row.revision, card.revision + Number(change.endsWith('-revision') || change.startsWith('edit-')));
      assert.equal(row.body_revision, card.bodyRevision + Number(change.startsWith('edit-')));
      const latest = { ...full, revision: row.revision, bodyRevision: row.body_revision };
      const item = ok(await fetchTool.action(fetchTool.schema.parse({ refs: [latest], intent: 'history' }))).items[0];
      assert.equal(item.state, 'confirmed');
      assert.equal(item.support.status, change.startsWith('support') ? 'unavailable' : 'eligible');
      assert.equal(item.support.applicability, change.startsWith('applicability') ? 'historical' :
        ['support-revision', 'edit-ineligible'].includes(change) ? 'unknown' : 'current');
    }
    const expectedCode = intent === 'current' ? currentCode : historyCode;
    const fetched = await fetchTool.action(fetchTool.schema.parse({ refs: [compact], intent }));
    const snapshotFetched = await fetchTool.action(fetchTool.schema.parse({ snapshot: delivered.snapshot }));
    if (expectedCode === null) {
      assert.equal(JSON.stringify(ok(fetched).items), JSON.stringify(before.items), 'parent-only moves preserve byte-identical canonical evidence');
    } else {
      assert.deepEqual(fetched, { ok: false, error: { code: expectedCode, retryable: false } });
      assert.equal(JSON.stringify(contextToolResponse(fetched)).includes('post-mutation'), false);
    }
    const snapshotCode = generationsChange || expectedCode === 'snapshot_stale' ? 'snapshot_stale' : expectedCode;
    assert.deepEqual(snapshotFetched, { ok: false, error: { code: snapshotCode, retryable: false } });
  });
});

test('A15 compact prefixes detect one-character changes, re-derive authority, and canonicalize reversed core read sets', async t => {
  const f = assemblyFixture(t), namespace = { ownerId: 'synthetic-u5a', scope: 'project', projectId: 'test' };
  const access = createContextReadAccess(namespace, true), core = f.reopen({ ...access.configuration, counter: { id: 'fit', countTokens: () => 1 } });
  for (const ns of access.readSet) f.admit('assembly ' + ns.scope, ns);
  const tools = assemblyTools(core, access), tool = tools.get('fetch_memory_candidate_evidence');
  const value = ok(await access.call(core, 'contextRead', { ...assemblyQuery(), readSet: [...access.readSet].reverse() }));
  value.metered.items.forEach((item, i) => assert.deepEqual(access.readSet[item.ref.ns], value.diagnostics.items[i].ref.namespace));
  const ref = value.metered.items[0].ref, bad = { ...ref, f: (ref.f[0] === 'a' ? 'b' : 'a') + ref.f.slice(1) };
  assert.deepEqual(await tool.action(tool.schema.parse({ refs: [bad], intent: 'current' })), { ok: false, error: { code: 'snapshot_stale', retryable: false } });
  const foreign = createContextReadAccess({ ...namespace, ownerId: 'other-host' }, true);
  f.admit('assembly FOREIGN_HOST_FIXTURE', foreign.readSet[0]);
  const other = f.reopen({ ...foreign.configuration, counter: { id: 'fit', countTokens: () => 1 } });
  const otherTool = assemblyTools(other, foreign).get('fetch_memory_candidate_evidence');
  assert.equal((await otherTool.action(otherTool.schema.parse({ refs: [ref], intent: 'current' }))).error.code, 'evidence_unavailable');
  const revoked = createContextReadAccess(namespace, true);
  let checks = 0;
  const authority = { authorize: revoked.configuration.authority.authorize, isCurrent(grant, request) {
    if (++checks === 3) revoked.revoke();
    return revoked.configuration.authority.isCurrent(grant, request);
  } };
  const during = f.reopen({ authority, counter: { id: 'fit', countTokens: () => 1 } });
  const duringTool = assemblyTools(during, revoked).get('fetch_memory_candidate_evidence');
  assert.equal((await duringTool.action(duringTool.schema.parse({ refs: [ref], intent: 'current' }))).error.code, 'scope_changed');
  assert.equal((await duringTool.action(duringTool.schema.parse({ refs: [ref], intent: 'current' }))).error.code, 'authority_required');
});
