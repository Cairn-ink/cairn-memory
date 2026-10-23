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
import { ASSEMBLY_POLICIES, ASSEMBLY_LIMITS } from '../../../core/context-read-input.mjs';
import { assemblyFixture, assemblyQuery, sample } from '../../../core/testing/context-read-assembly-fixture.mjs';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { contextHost, contextNamespace as ns, contextProviderArgs } from './context-support.mjs';

const query = { query: 'assembly', types: ['memory'], intent: 'current' };
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
  assert.deepEqual(caps.assembly, { representation: 'representation-v1', policies: [...ASSEMBLY_POLICIES],
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
    assert.deepEqual(response._meta, { [metaKey]: value.diagnostics });
    assert.equal(response.isError, false); assert.equal(value.metered.framing, ASSEMBLY_FRAMING);
    assert.equal(countOpenAITokens(modelInput(response)), value.diagnostics.budget.used);
    assert.ok(value.diagnostics.budget.used <= 4000);
    assert.equal(modelInput(response).includes('diagnostics'), false);
    assert.equal(modelInput(response).includes('counterCalls'), false);
    assert.equal(modelInput(response).includes(secret), false);
    assert.deepEqual(value.metered.items.map(item => item.body.text).sort(), [memory.content, sanitized.content].sort());
    assert.ok(value.metered.items.some(item => item.body.text.includes('[REDACTED]')));
  }
  const successful = supplied;
  for (const field of ['authority', 'namespace', 'readSet', 'configuration', 'unknown']) {
    assert.equal((await client.callTool({ name: tool.name, arguments: { ...query, [field]: {} } })).isError, true);
    assert.equal(supplied, successful, 'invalid fields never reach core');
  }
  const refused = await client.callTool({ name: tool.name, arguments: { ...query, maxTokens: 64 } });
  assert.deepEqual(refused, contextToolResponse(envelope)); assert.equal(refused.isError, true);
  assert.equal(refused._meta, undefined);
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
    assert.equal(value.counter.id, 'tiktoken-o200k_base'); assert.equal(value.policy.id, 'rank-first-whole-v1');
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
      assert.equal(assembled.ok,true);assert.equal(assembled.value.counter.id,'tiktoken-o200k_base');
      assert.equal(assembled.value.items.length,1);assert.equal(assembled.value.items[0].body.text,inspected.value.memory.content);
      assert.equal(assembled.value.items[0].ref.memoryId,saved.value.memory.id);
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
  assert.deepEqual(assembled.items.map(item => item.ref), found.items.map(item => item.ref));
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
    assert.equal(value.counter.id, 'tiktoken-o200k_base'); assert.equal(value.items.length, 1);
    assert.equal(response._meta[metaKey].budget.used, countOpenAITokens(response.content[0].text));
    await client.close();
  }
});

test('A11 complete core envelope bound includes diagnostics; encoded transport has its independent exact byte bound', async () => {
  const metered = { framing: ASSEMBLY_FRAMING, items: [], snapshot: null }, diagnostics = { padding: '' };
  const base = { ok: true, value: { metered, diagnostics } };
  diagnostics.padding = '界'.repeat(20000);
  diagnostics.padding += 'x'.repeat(65536 - Buffer.byteLength(JSON.stringify(base)));
  assert.equal(Buffer.byteLength(JSON.stringify(base)), 65536);
  const response = contextToolResponse(base, { assembly: true });
  assert.equal(response.isError, false); assert.equal(response.content[0].text, meteredText(metered));
  assert.deepEqual(response._meta[metaKey], diagnostics);
  const tooLarge = { ...base, value: { metered, diagnostics: { padding: diagnostics.padding + 'x' } } };
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
