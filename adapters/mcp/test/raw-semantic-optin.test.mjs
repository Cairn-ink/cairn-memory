import assert from 'node:assert/strict';
import test from 'node:test';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { RAW_MANAGER_OBSERVER } from './fixtures/raw-semantic-observer.mjs';
// Load the production graph only after registering the observation hook.
const { openMemoryCore } = await import('../../../core/index.mjs');
const { createFakeEmbedder } = await import('../../../core/context-read-embedder.mjs');
const { cardHost, ok, request, splitRaw } = await import('../../../core/testing/raw-source-fixtures.mjs');
const { createTestWorkspace } = await import('../../../tools/testing/workspace.mjs');
const { createCairnServer } = await import('../server.mjs');
const { parseConfiguration } = await import('../cli.mjs');
const { createContextEmbedding } = await import('../context-read-provider.mjs');
const { contextProviderArgs, contextCall } = await import('./context-support.mjs');

const namespace = { ownerId:'synthetic-optin',scope:'personal',projectId:null };
const rawText = 'Synthetic raw-only cobalt telescope conversation';
const memoryText = 'Synthetic memory-only copper atlas';
const cardText = 'Synthetic card-only silver compass';
const query = 'cobalt telescope';

for (const mode of ['ambient','raw-flag','explicit-provider','off','explicit-provider-off']) test(`real MCP Raw semantic boundary: ${mode}`, { timeout:60000 }, async t => {
  t.mock.method(globalThis,'fetch',() => assert.fail('recording embedder must never contact a provider'));
  const workspace = createTestWorkspace(t), path = join(workspace.path,'store.sqlite');
  const host = cardHost(), writer = openMemoryCore({path,raw:true,privateCards:host.options});
  ok(await writer.captureRaw(request(splitRaw(rawText)[0],{namespace})));
  ok(writer.admit({namespace,memory:{content:memoryText,kind:'fact'},receipts:[{client:'synthetic',sessionId:'s',eventId:'m',role:'user',excerpt:memoryText}]}));
  const draft = ok(host.call(writer,'createCardDraft',{namespace,actionId:'draft',drafting:'authored',input:{title:cardText,body:cardText,authoredInput:{text:'Synthetic card support',occurredAt:null}}}));
  ok(host.call(writer,'confirmCardDraft',{namespace,cardId:draft.id,expectedRevision:draft.revision,actionId:'confirm',applicability:'current'}));
  await writer.close();
  const flags = mode === 'raw-flag' ? ['--raw-semantic'] : mode.startsWith('explicit-provider') ? contextProviderArgs : [];
  const parsed = parseConfiguration(['--db',path,'--owner',namespace.ownerId,...flags,...(mode.endsWith('off') ? ['--no-context-semantic'] : [])]);
  const {contextProvider,...config} = parsed;
  // Use the real ambient-key configuration and policy, replacing only its port.
  const automatic = createContextEmbedding(contextProvider,{OPENAI_API_KEY:'synthetic-not-a-key'});
  const base = createFakeEmbedder({dimensions:8}), calls = [];
  const embedder = {...base,id:'synthetic-optin-'+mode,async embed(texts,controls) {
    calls.push({texts:[...texts],raw:/core\/raw-search-(?:index|maintenance)\.mjs/.test(new Error().stack)});
    return base.embed(texts,controls);
  }};
  const stackLimit = Error.stackTraceLimit; Error.stackTraceLimit = 50; t.after(() => { Error.stackTraceLimit = stackLimit; });
  let rawManager, rawEmbedding, server;
  globalThis[RAW_MANAGER_OBSERVER] = (manager, embedding) => {
    assert.equal(rawManager, undefined, 'MCP and core must reuse one Raw manager');
    rawManager = manager; rawEmbedding = embedding;
  };
  try { server = createCairnServer({...config,privateCards:'local-v1',contextCounter:{id:'synthetic-counter',countTokens:text=>Buffer.byteLength(text)},contextEmbedding:{embedder,policy:automatic.policy}}); }
  finally { delete globalThis[RAW_MANAGER_OBSERVER]; }
  assert.ok(rawManager, 'observe the actual manager from real MCP construction');
  workspace.defer(() => server.close()); await server.contextCounterReady;
  const client = new Client({name:'synthetic-optin',version:'1'}), [a,b] = InMemoryTransport.createLinkedPair();
  workspace.defer(() => client.close()); await server.connect(a); await client.connect(b);
  const enabled = !mode.endsWith('off'), rawEnabled = enabled && mode !== 'ambient';
  let response;
  for (let turn=0;turn<24;turn++) {
    await delay(300);
    ok(await rawManager.methods.maintainRawSearch({namespace}));
    ok(await rawManager.methods.searchRaw({namespace,query}));
    response = await client.callTool({name:'read_memory_context',arguments:{query,types:['memory','card'],intent:'current'}});
    const envelope = JSON.parse(response.content[0].text); assert.equal(envelope.ok,true,JSON.stringify(envelope));
    const text = JSON.stringify(envelope);
    const documentsReady = calls.some(c => c.texts.some(s => s.includes(memoryText))) && calls.some(c => c.texts.some(s => s.includes(cardText)));
    const rawReady = calls.some(c => c.raw && c.texts.includes(query)) && calls.some(c => c.texts.some(s => s.includes(rawText)));
    if (text.includes(rawText) && (!enabled || documentsReady && (!rawEnabled || rawReady))) break;
  }
  assert.ok(JSON.stringify(response).includes(rawText),'three-layer reads must still find saved Raw through BM25');
  if (!rawEnabled) assert.equal(rawEmbedding, undefined, 'Raw must not receive an embedder without opt-in');
  else { assert.deepEqual({ ...rawEmbedding.embedder, embed: embedder.embed }, embedder); assert.equal(rawEmbedding.policy, automatic.policy); }
  const rawCalls = calls.filter(c => c.raw || c.texts.some(s => s.includes(rawText)));
  if (rawEnabled) {
    assert.ok(rawCalls.some(c => c.texts.some(s => s.includes(rawText))),'Raw documents embedded');
    assert.ok(rawCalls.some(c => c.raw && c.texts.includes(query)),'Raw query embedded');
  } else assert.deepEqual(rawCalls,[],'ambient key and semantic off must never send Raw documents or queries');
  if (enabled) {
    for (const text of [memoryText,cardText]) assert.ok(calls.some(c => c.texts.some(s => s.includes(text))),'Memory and Card semantic refresh remains enabled');
    const memoryQuery='copper atlas synthetic-query-sentinel';
    let found;
    for(let turn=0;turn<12;turn++){
      found=ok(await contextCall(client,'find_memory_candidates',{query:memoryQuery,types:['memory','card'],intent:'current'}));
      if(calls.some(c=>c.texts.includes(memoryQuery)))break;
      await delay(1100);
    }
    assert.ok(calls.some(c => c.texts.includes(memoryQuery)),'Memory/Card query embedding remains enabled: '+JSON.stringify(found));
  } else assert.deepEqual(calls,[],'semantic off disables every provider call');
  if (!rawEnabled) {
    const status = ok(await rawManager.methods.getRawSearchStatus({namespace}));
    assert.deepEqual(status.semantic,{state:'bm25-only',reason:enabled ? 'raw_semantic_not_enabled' : 'disabled'});
    assert.equal(status.embeddingBudget,null);
    assert.equal(ok(await rawManager.methods.searchRaw({namespace,query})).semantic.reason,status.semantic.reason);
  }
  await client.close(); await server.close();
});
