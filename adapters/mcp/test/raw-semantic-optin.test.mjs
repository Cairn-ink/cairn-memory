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

// The shared provider arguments cap a process at 20 embedding requests. This
// test is not about that cap: its readiness loop and the server's background
// refresh spend a load-dependent number of requests, so it uses its own cap.
// The cap itself is pinned by the request-cap tests below.
const providerArgs = maxRequests => contextProviderArgs.map((arg, index, args) =>
  args[index - 1] === '--context-embed-max-requests' ? String(maxRequests) : arg);

async function start(t, mode, { maxRequests = 1000, id = 'synthetic-optin-' + mode, rawSearch = true } = {}) {
  t.mock.method(globalThis,'fetch',() => assert.fail('recording embedder must never contact a provider'));
  const workspace = createTestWorkspace(t), path = join(workspace.path,'store.sqlite');
  const host = cardHost(), writer = openMemoryCore({path,raw:true,privateCards:host.options});
  ok(await writer.captureRaw(request(splitRaw(rawText)[0],{namespace})));
  ok(writer.admit({namespace,memory:{content:memoryText,kind:'fact'},receipts:[{client:'synthetic',sessionId:'s',eventId:'m',role:'user',excerpt:memoryText}]}));
  const draft = ok(host.call(writer,'createCardDraft',{namespace,actionId:'draft',drafting:'authored',input:{title:cardText,body:cardText,authoredInput:{text:'Synthetic card support',occurredAt:null}}}));
  ok(host.call(writer,'confirmCardDraft',{namespace,cardId:draft.id,expectedRevision:draft.revision,actionId:'confirm',applicability:'current'}));
  await writer.close();
  const flags = mode === 'raw-flag' ? ['--raw-semantic'] : mode.startsWith('explicit-provider') ? providerArgs(maxRequests) : [];
  const parsed = parseConfiguration(['--db',path,'--owner',namespace.ownerId,...flags,...(mode.endsWith('off') ? ['--no-context-semantic'] : []),
    ...(rawSearch ? [] : ['--no-raw-search'])]);
  const {contextProvider,...config} = parsed;
  // Use the real ambient-key configuration and policy, replacing only its port.
  const automatic = createContextEmbedding(contextProvider,{OPENAI_API_KEY:'synthetic-not-a-key'});
  const base = createFakeEmbedder({dimensions:8}), calls = [];
  const embedder = {...base,id,async embed(texts,controls) {
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
  if (rawSearch) assert.ok(rawManager, 'observe the actual manager from real MCP construction');
  workspace.defer(() => server.close()); await server.contextCounterReady;
  const client = new Client({name:'synthetic-optin',version:'1'}), [a,b] = InMemoryTransport.createLinkedPair();
  workspace.defer(() => client.close()); await server.connect(a); await client.connect(b);
  return { client, server, rawManager, rawEmbedding, embedder, calls, automatic };
}

for (const mode of ['ambient','raw-flag','explicit-provider','off','explicit-provider-off']) test(`real MCP Raw semantic boundary: ${mode}`, { timeout:60000 }, async t => {
  const { client, server, rawManager, rawEmbedding, embedder, calls, automatic } = await start(t, mode);
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

// A spent request cap is designed behaviour: semantic queries are refused as
// budget_denied without a provider call, and reads still succeed lexically.
// Raw search is off here so that only Memory/Card maintenance and these
// queries spend the cap, and every check starts once Memory/Card vectors are
// published: before that a query reports partial coverage and dispatches
// nothing. Once spent, the cap stays spent; a busy slot would clear.
async function capQuery(client, query) {
  const value = ok(await contextCall(client,'find_memory_candidates',{query,types:['memory','card'],intent:'current'}));
  return { value, text: JSON.stringify(value) };
}
const semanticState = text => text.match(/"semantic":\{"state":"([a-z_]+)"/)?.[1];
const deniedChannel = '"semantic":{"state":"budget_denied","causes":["budget_denied"]}';

// Probe with fresh queries until one is embedded with the semantic channel
// ready. Partial coverage dispatches nothing, so waiting costs no requests.
async function untilSemanticReady(client, calls) {
  for (let turn = 0; turn < 100; turn++) {
    const query = 'copper atlas readiness ' + turn, { text } = await capQuery(client, query);
    const state = semanticState(text);
    if (state === 'ready' && calls.some(call => call.texts.includes(query))) return;
    // A probe may also meet the background refresh holding the single slot.
    assert.ok(['partial_coverage', 'stale_index', 'unavailable', 'budget_denied'].includes(state), 'only startup states before readiness: ' + text);
    await delay(150);
  }
  assert.fail('Memory/Card semantic search never became ready');
}

test('request cap spent: semantic queries are denied as budget_denied with no provider call', { timeout:60000 }, async t => {
  const { client, server, calls } = await start(t, 'explicit-provider', { maxRequests: 12, id: 'synthetic-optin-cap-12', rawSearch: false });
  await untilSemanticReady(client, calls);
  // With Raw search off every granted request reaches the recording embedder,
  // so calls.length counts the requests spent. Spend the rest of the cap with
  // fresh queries; a refusal before then can only be a briefly busy slot.
  for (let turn = 0; turn < 60 && calls.length < 12; turn++) {
    const query = 'copper atlas spend ' + turn, { text } = await capQuery(client, query);
    if (calls.some(call => call.texts.includes(query))) assert.equal(semanticState(text), 'ready', text);
    else { assert.equal(semanticState(text), 'budget_denied', text); await delay(100); }
  }
  assert.equal(calls.length, 12, 'exactly the cap of 12 provider calls');
  const before = calls.length;
  // Spent, the cap refuses every later query, with no provider call.
  for (const query of ['copper atlas after-cap-1', 'copper atlas after-cap-2']) {
    await delay(500);
    const { text } = await capQuery(client, query);
    assert.ok(text.includes(deniedChannel), 'cap stays spent: ' + text);
    assert.ok(!calls.some(call => call.texts.includes(query)), 'a denied query never reaches the provider');
  }
  assert.equal(calls.length, before, 'no provider call after the cap is spent');
  await client.close(); await server.close();
});

test('request cap not reached: the same semantic query is embedded and ready', { timeout:60000 }, async t => {
  const { client, server, calls } = await start(t, 'explicit-provider', { maxRequests: 1000, id: 'synthetic-optin-cap-1000', rawSearch: false });
  await untilSemanticReady(client, calls);
  const query = 'copper atlas after-cap-1', { text } = await capQuery(client, query);
  assert.equal(semanticState(text), 'ready', 'semantic channel ready below the cap: ' + text);
  assert.ok(calls.some(call => call.texts.includes(query)), 'query embedded below the cap');
  await client.close(); await server.close();
});
