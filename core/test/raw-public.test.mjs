import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openMemoryCore } from '../index.mjs';
import { openDatabase } from '../database.mjs';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';
import { rationaleModel } from '../testing/rationale-model.mjs';
import { cardHost } from '../testing/raw-source-fixtures.mjs';
import { rawNamespace as ns, localPlainPort, splitRaw, rawRequest } from '../testing/raw-fixtures.mjs';

const ok = result => { assert.equal(result.ok,true,JSON.stringify(result)); return result.value; };
const denied = (value,code) => { assert.equal(value.ok,false); assert.equal(value.error.code,code); };
const policy = () => ({ generation:'synthetic-notice',reason:null });
const raw = patch => ({ mode:'raw-v1',capBytes:1000000,port:localPlainPort(),readPolicy:policy,...patch });
function fixture(t,{ rawOptions = raw(),model:overrides = {},privateCards } = {}) {
  const workspace = createTestWorkspace(t,{ prefix:'raw-public-' }), path = join(workspace.path,'store.sqlite'), calls = [];
  const model = { ...rationaleModel(method => calls.push(method)),...overrides };
  let core;
  workspace.defer(() => core?.close());
  const reopen = (options = rawOptions) => {
    core?.close(); core = openMemoryCore({ path,model,...(privateCards ? { privateCards } : {}),rawConversations:options }); return core;
  };
  reopen();
  const db = new DatabaseSync(path); workspace.defer(() => db.close());
  return { workspace,path,model,calls,db,reopen,get core() { return core; } };
}
async function readAll(core,conversationId,namespace = ns) {
  let cursor, text = '',last;
  do {
    last = ok(await core.getConversation({ namespace,conversationId,limit:2,...(cursor ? { cursor } : {}) }));
    assert.ok(Buffer.byteLength(JSON.stringify(last))<=65536);
    text += last.messages.flatMap(message => message.parts.filter(part => part.saved).map(part => part.text)).join('');
    cursor = last.nextCursor;
  } while (cursor);
  return { text,last };
}

test('B1-01 public Raw configuration rejects before creating or upgrading SQLite',t => {
  const workspace = createTestWorkspace(t,{ prefix:'raw-public-invalid-' }); let getters = 0;
  const accessor = Object.defineProperty({ readPolicy:policy },'mode',{ enumerable:true,get() { getters++; return 'off'; } });
  const symbol = { mode:'off',readPolicy:policy,[Symbol('extra')]:1 };
  const hidden = Object.defineProperty({ mode:'off',readPolicy:policy },'extra',{ value:1 });
  const bad = [null,undefined,true,[],{},new Date(),Object.create({ mode:'off',readPolicy:policy }),
    { mode:'off' },{ readPolicy:policy },{ mode:'other',readPolicy:policy },{ mode:'off',readPolicy:1 },accessor,symbol,hidden,
    ...[undefined,null,0,-1,1.1,Infinity,Number.MAX_SAFE_INTEGER+1].map(capBytes => ({ mode:'off',readPolicy:policy,capBytes })),
    { mode:'raw-v1',readPolicy:policy,port:localPlainPort() },
    ...['sources','lineage','deletion'].map(key => ({ mode:'off',readPolicy:policy,[key]:true }))];
  for (const [index,value] of bad.entries()) {
    const path = join(workspace.path,`bad-${index}.sqlite`);
    assert.throws(() => openMemoryCore({ path,rawConversations:value }),{ code:'invalid_input' });
    assert.equal(existsSync(path),false);
  }
  const path = join(workspace.path,'getter.sqlite');
  assert.throws(() => openMemoryCore({ path,get rawConversations() { getters++; return raw(); } }),{ code:'invalid_input' });
  assert.equal(existsSync(path),false); assert.equal(getters,0);
  const existing = join(workspace.path,'existing.sqlite'), db = openDatabase(existing);
  try {
    const before = db.prepare('PRAGMA user_version').get().user_version;
    assert.throws(() => openMemoryCore({ path:existing,rawConversations:{ ...raw(),capBytes:undefined } }),{ code:'invalid_input' });
    assert.equal(db.prepare('PRAGMA user_version').get().user_version,before);
    assert.equal(db.prepare("SELECT count(*) n FROM sqlite_master WHERE name='raw_parts'").get().n,0);
  } finally { db.close(); }
});

test('B1-01 malformed ports and own/inherited port accessors never execute or create a store',t => {
  const workspace = createTestWorkspace(t,{ prefix:'raw-public-port-invalid-' }); let getters = 0;
  const ports = [undefined,null,1,{}, { ...localPlainPort(),version:'other' },{ ...localPlainPort(),openRaw:null }];
  for (const name of ['version','sealRaw','openRaw']) for (const inherited of [false,true]) {
    const value = localPlainPort(); delete value[name];
    const owner = inherited ? Object.getPrototypeOf(Object.setPrototypeOf(value,{})):value;
    Object.defineProperty(owner,name,{ get() { getters++; throw Error('Synthetic private getter'); } }); ports.push(value);
  }
  ports.push(new Proxy({}, { getOwnPropertyDescriptor() { throw Error('Synthetic private proxy'); } }));
  for (const [index,port] of ports.entries()) for (const mode of ['raw-v1','off']) {
    const path = join(workspace.path,`${index}-${mode}.sqlite`);
    assert.throws(() => openMemoryCore({ path,rawConversations:raw({ mode,port }) }),{ code:'raw_crypto_unavailable',message:'raw_crypto_unavailable' });
    assert.equal(existsSync(path),false);
  }
  assert.equal(getters,0);
  const path = join(workspace.path,'missing.sqlite');
  const options = raw(); delete options.port;
  assert.throws(() => openMemoryCore({ path,rawConversations:options }),{ code:'raw_crypto_unavailable' });
  assert.equal(existsSync(path),false);
});

test('B1-01 omission stays ordinary; explicit null-prototype off configuration is valid',t => {
  const workspace = createTestWorkspace(t,{ prefix:'raw-public-default-' });
  const core = openMemoryCore({ path:join(workspace.path,'ordinary.sqlite') }); workspace.defer(() => core.close());
  for (const method of ['captureRaw','getConversation','getRawUsage','deleteConversation','resolveSourceReferences']) assert.equal(core[method],undefined);
  const off = openMemoryCore({ path:join(workspace.path,'off.sqlite'),rawConversations:Object.assign(Object.create(null),{ mode:'off',readPolicy:policy }) });
  workspace.defer(() => off.close());
  assert.equal(typeof off.captureRaw,'function'); assert.equal(typeof off.deleteConversation,'function'); assert.equal(off.getCard,undefined);
  assert.equal(off.resolveSourceReferences,undefined);
});

test('B1-01 class receiver, opaque key state and config/function snapshots survive caller mutation',async t => {
  let seals = 0, opens = 0, opaqueReads = 0;
  class Port {
    #key = Buffer.from('synthetic opaque key');
    version = 'raw-seal-v1';
    sealRaw({ text }) { assert.equal(this.#key.toString(),'synthetic opaque key'); seals++; return { format:'local-plain-v1',keyVersion:null,sealed:Buffer.from(text) }; }
    openRaw({ sealed }) { assert.equal(this.#key.toString(),'synthetic opaque key'); opens++; return { text:Buffer.from(sealed).toString() }; }
  }
  const port = new Port(); Object.defineProperty(port,'opaque',{ get() { opaqueReads++; throw Error('Do not inspect host key slots'); } });
  const options = raw({ port }), f = fixture(t,{ rawOptions:options });
  options.mode='off'; options.capBytes=1; options.readPolicy=() => { throw Error('Changed policy slot'); }; options.port={};
  port.version='changed'; port.sealRaw=port.openRaw=() => { throw Error('Changed method slots'); };
  const input = rawRequest(splitRaw('Synthetic snapshotted source.')[0]);
  const saved = ok(await f.core.captureRaw(input)); assert.equal(saved.raw.parts[0].saved,true);
  assert.equal((await readAll(f.core,saved.raw.conversationId)).text,input.messages[0].content);
  assert.equal(seals,1); assert.equal(opens,1); assert.equal(opaqueReads,0);
});

for (const client of ['claude-code','codex']) test(`B1-03/04 ${client}: exact paged Raw, first/middle/final replay and off reopen`,async t => {
  const f = fixture(t), text = '  Ａ🙂\t\n'.repeat(2000), parts = splitRaw(text); let conversationId, firstCalls;
  for (const [index,part] of parts.entries()) {
    const input = rawRequest(part,{ client }), saved = ok(await f.core.captureRaw(input)); ok(saved.interpretation);
    conversationId=saved.raw.conversationId;
    if (index===0) firstCalls=f.calls.length;
    else { assert.equal(f.calls.length,firstCalls); assert.equal(saved.interpretation.value.reason,'continuation'); }
    const before = ok(f.core.getRawUsage({ ownerId:ns.ownerId }));
    assert.deepEqual(ok(await f.core.captureRaw(input)).raw,saved.raw);
    const overlap = ok(await f.core.captureRaw({ ...input,eventId:input.eventId+'-overlap' })); ok(overlap.interpretation);
    assert.equal(f.calls.length,firstCalls); assert.deepEqual(ok(f.core.getRawUsage({ ownerId:ns.ownerId })),before);
    if (index===0 || index===Math.floor(parts.length/2)) f.reopen();
  }
  assert.ok(firstCalls>0); assert.equal((await readAll(f.core,conversationId)).text,text);
  const savedUsage = ok(f.core.getRawUsage({ ownerId:ns.ownerId }));
  assert.equal(savedUsage.savedBytes,Buffer.byteLength(text)); assert.equal(savedUsage.reservedBytes,0);
  f.reopen({ mode:'off',port:localPlainPort(),readPolicy:() => { throw Error('Reads must not ask capture policy'); } });
  assert.deepEqual(ok(f.core.getRawUsage({ ownerId:ns.ownerId })),savedUsage);
  assert.equal((await readAll(f.core,conversationId)).text,text);
  f.reopen({ mode:'off',readPolicy:policy });
  denied(await f.core.getConversation({ namespace:ns,conversationId }),'raw_crypto_unavailable');
  const absent = ok(await f.core.getConversation({ namespace:{ ...ns,ownerId:'foreign' },conversationId }));
  assert.equal(absent.conversation,null);
});

for (const reason of ['off','quota','model']) test(`B1-03/04 ${reason}: Raw disposition stays separate from interpretation`,async t => {
  const f = fixture(t,{ rawOptions:raw(reason==='off' ? { mode:'off' }:reason==='quota' ? { capBytes:1 }:{}),
    ...(reason==='model' ? { model:{ extract() { throw Error('Synthetic private model failure'); } } }: {}) });
  const result = ok(await f.core.captureRaw(rawRequest(splitRaw('Synthetic interpretation input.')[0])));
  if (reason==='model') { assert.equal(result.raw.parts[0].saved,true); assert.equal(result.interpretation.ok,false); }
  else { assert.equal(result.raw.parts[0].saved,false); assert.equal(result.raw.parts[0].reason,reason==='off' ? 'raw_disabled':'quota_reached'); ok(result.interpretation); }
  assert.equal(JSON.stringify(result).includes('Synthetic private model failure'),false);
});

for (const barrier of ['pause','project','client','session']) test(`B1-05 public ${barrier} fence from another connection wins during sealing`,async t => {
  const namespace = barrier==='project' ? { ...ns,scope:'project',projectId:'synthetic-project' }:ns;
  let f,writer;
  const port = localPlainPort(), original = port.sealRaw;
  port.sealRaw = async value => {
    if (barrier==='pause') ok(writer.setCapturePaused({ namespace,expectedGeneration:'initial',paused:true }));
    if (barrier==='project') ok(writer.setProjectCapture({ namespace,expectedGeneration:'initial',enabled:false }));
    if (barrier==='client') ok(writer.setRawCaptureControl({ ownerId:ns.ownerId,client:'claude-code',expectedRevision:0,enabled:false }));
    if (barrier==='session') ok(writer.fenceSession({ namespace,client:'claude-code',sessionId:'synthetic-session' }));
    return original(value);
  };
  f=fixture(t,{ rawOptions:raw({ port }) }); writer=openMemoryCore({ path:f.path,rawConversations:raw({ mode:'off' }) }); f.workspace.defer(() => writer.close());
  const result = await f.core.captureRaw(rawRequest(splitRaw('Synthetic fenced source.')[0],{ namespace }));
  assert.equal(result.ok,false); assert.equal(f.calls.length,0);
  assert.equal(f.db.prepare('SELECT count(*) n FROM raw_parts').get().n,0);
});

test('B1-05 bare Raw supports an authorized authored Card; public deletion invalidates its source',async t => {
  const host = cardHost(), f = fixture(t,{ privateCards:host.options,model:{ extract:() => ({ items:[] }) } });
  const saved = ok(await f.core.captureRaw(rawRequest(splitRaw('Synthetic retained source without a Memory.')[0])));
  assert.equal(f.db.prepare('SELECT count(*) n FROM memories').get().n,0);
  const view = ok(await f.core.getConversation({ namespace:ns,conversationId:saved.raw.conversationId }));
  const input = { namespace:ns,anchors:[{ rawAnchor:{ conversationId:saved.raw.conversationId,messageId:'message',start:0,end:9,precision:'exact' },
    expectedConversationRevision:view.conversation.revision }] };
  denied(await f.core.resolveSourceReferences(input,{}),'authority_required');
  const sources = ok(await host.call(f.core,'resolveSourceReferences',input)).sources;
  const draft = ok(host.call(f.core,'createCardDraft',{ namespace:ns,actionId:'draft',drafting:'authored',input:{ sources,title:'Synthetic title',body:'Synthetic authored body.' } }));
  const confirmed = ok(host.call(f.core,'confirmCardDraft',{ namespace:ns,cardId:draft.id,expectedRevision:draft.revision,actionId:'confirm' }));
  const deletion = { namespace:ns,conversationId:saved.raw.conversationId,expectedRevision:view.conversation.revision,actionId:'delete' };
  ok(f.core.deleteConversation(deletion));
  f.reopen(raw({ mode:'off' }));
  const retained = ok(host.call(f.core,'getCard',{ namespace:ns,cardId:confirmed.id })).card;
  assert.equal(retained.body,'Synthetic authored body.'); assert.equal(retained.support.status,'unavailable');
  denied(await host.call(f.core,'getSource',{ namespace:ns,source:sources[0] }),'source_unavailable');
  denied(await f.core.captureRaw(rawRequest(splitRaw('Synthetic late resurrection.')[0],{ eventId:'late' })),'conversation_deleted');
});

test('B1-05 public feature-off forgetting keeps Raw but excludes support and purges a dependent draft',async t => {
  const host = cardHost(), f = fixture(t,{ privateCards:host.options });
  const text = 'Synthetic retained Memory support.', saved = ok(await f.core.captureRaw(rawRequest(splitRaw(text)[0])));
  const memory = ok(saved.interpretation).admission.memories[0];
  const view = ok(await f.core.getConversation({ namespace:ns,conversationId:saved.raw.conversationId }));
  const sources = ok(await host.call(f.core,'resolveSourceReferences',{ namespace:ns,anchors:[{
    rawAnchor:{ conversationId:saved.raw.conversationId,messageId:'message',start:0,end:9,precision:'exact' },
    expectedConversationRevision:view.conversation.revision,
  }] })).sources;
  const draft = ok(host.call(f.core,'createCardDraft',{ namespace:ns,actionId:'forget-dependent',drafting:'authored',input:{
    sources,title:'Synthetic dependent draft',body:'Synthetic independently authored body.',
  } }));
  const off = openMemoryCore({ path:f.path }); f.workspace.defer(() => off.close());
  ok(off.forget({ namespace:ns,memoryId:memory.id,expectedRevision:memory.revision }));
  assert.equal((await readAll(f.core,saved.raw.conversationId)).text,text);
  f.reopen(raw({ mode:'off' }));
  denied(await host.call(f.core,'getSource',{ namespace:ns,source:sources[0] }),'source_excluded');
  assert.equal(ok(host.call(f.core,'getCard',{ namespace:ns,cardId:draft.id })).card,null);
});

test('B1-01 callback callability is preflighted but asynchronous results refuse at registration',async t => {
  let checks = 0;
  const f = fixture(t,{ rawOptions:raw({ readPolicy:async () => { checks++; return policy(); } }) });
  assert.equal(checks,0);
  denied(await f.core.captureRaw(rawRequest(splitRaw('Synthetic invalid policy result.')[0])),'invalid_identifier');
  assert.equal(f.db.prepare('SELECT count(*) n FROM raw_events').get().n,0);
  assert.equal(f.calls.length,0);
});
