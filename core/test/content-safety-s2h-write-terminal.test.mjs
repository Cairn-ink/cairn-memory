import { model as episodeModel } from '../testing/episode-capture-helpers.mjs';
import { derivativeInput } from '../testing/asset-mixed-fixtures.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { openMemoryCore } from '../index.mjs';
import { openRawCaptureCore } from '../raw-capture.mjs';
import { cardHost } from '../testing/raw-source-fixtures.mjs';
import { interpretation, input as episodeInput } from '../testing/episode-capture-helpers.mjs';
import { options as episodeOptions } from '../testing/episode-helpers.mjs';
import { request, splitRaw, localPlainPort } from '../testing/raw-capture-fixtures.mjs';
import { safetyFixture, ns, ok, receipt } from '../testing/content-safety-s2h-fixture.mjs';

async function setup(t, { raw = false, episodes = false } = {}) {
  const f = safetyFixture(t, 33); await f.migrate();
  const host = cardHost(), config = { path: f.path, privateCards: host.options,
    ...(episodes ? { ...episodeOptions, sessionEpisodes: { mode: 'episode-v1', draftEveryBatches: 2 } } : {}),
    model: { contextWindow: 8192, countTokens: () => 1, interpretEpisode: interpretation,
      extract: () => ({ items: episodes ? [] : [{ content: 'Synthetic terminal interpretation', kind: 'fact', confidence: .8, sourceIndices: [0] }] }) } };
  const core = raw ? openRawCaptureCore(config, { mode: 'raw-v1', sources: true, deletion: true,
    port: localPlainPort(), readPolicy: () => ({ generation: 'synthetic', reason: null }) }) : openMemoryCore(config);
  const db = f.connect(); t.after(() => { core.close(); db.close(); });
  return { ...f, core, db, call: (method, input) => host.call(core, method, { namespace: ns, ...input }) };
}
function draft(f, source) {
  return ok(f.call('createCardDraft', { actionId: 'draft', drafting: 'authored', input: {
    title: 'Synthetic terminal Card', body: 'Synthetic terminal body',
    ...(source.type === 'memory' ? { memoryRefs: [source], sourcePolicy: 'retained-receipts-v1' } : { sources: [source] }) } }));
}
const confirm = (f, card) => ok(f.call('confirmCardDraft', { actionId: 'confirm', cardId: card.id, expectedRevision: card.revision }));
const memoryRef = memory => ({ type: 'memory', namespace: ns, memoryId: memory.id, revision: memory.revision });
function invalidated(f, card) {
  assert.equal(f.db.prepare('SELECT revision FROM private_cards WHERE id=?').get(card.id).revision, card.revision + 1);
  assert.equal(ok(f.call('getCard', { cardId: card.id })).card, null);
}

test('r5 real v48 forgetEpisode deletes an interpreted episode without a Raw conversation', async t => {
  const f = await setup(t, { episodes: true });
  for (const n of [1, 2]) ok(await f.core.capture({ ...episodeInput(n, 'synthetic-terminal-session'), namespace: ns }));
  assert.equal(f.db.prepare('SELECT count(*) n FROM raw_conversations').get().n, 0);
  const range = { namespace: ns, since: '1901-02-03T00:00:00.000Z', until: '1901-02-04T00:00:00.000Z', timeBasis: 'event' };
  const listed = ok(f.core.listEpisodes(range)); assert.equal(listed.items.length, 1);
  const episode = listed.items[0];
  const result = f.core.forgetEpisode({ namespace: ns, episodeId: episode.id, expectedRevision: episode.revision });
  assert.equal(result.ok, true, JSON.stringify(result)); assert.equal(result.value.forgotten, true);
  assert.equal(f.db.prepare('SELECT deleted FROM session_episodes WHERE id=?').get(episode.id).deleted, 1);
  assert.deepEqual(f.db.prepare('SELECT DISTINCT source_type FROM raw_deletion_effects').all().map(row => row.source_type), ['episode']);
  const hidden = f.core.getEpisode({ namespace: ns, episodeId: episode.id });
  assert.equal(hidden.ok, false); assert.equal(hidden.error.code, 'episode_not_found');
  assert.equal(ok(f.core.listEpisodes(range)).items.length, 0);
});

for (const method of ['cancelCardDraft', 'deleteKnowledgeCard']) test(`r5 real v48 terminal ${method}`, async t => {
  const f = await setup(t), source = ok(f.call('submitSourceNote', { actionId: 'note', text: 'Synthetic terminal source', occurredAt: null })).source;
  let card = draft(f, source); if (method === 'deleteKnowledgeCard') card = confirm(f, card);
  ok(f.call(method, { actionId: 'terminal', cardId: card.id, expectedRevision: card.revision }));
  assert.equal(f.db.prepare('SELECT state FROM private_cards WHERE id=?').get(card.id).state, method === 'cancelCardDraft' ? 'cancelled' : 'deleted');
  assert.equal(f.db.prepare("SELECT count(*) n FROM content_suppressions WHERE kind='card' AND stable_key=? AND reason='purge'").get(card.id).n, 1);
});

test('r5 real v48 note deletion invalidates its confirmed dependent', async t => {
  const f = await setup(t), source = ok(f.call('submitSourceNote', { actionId: 'note', text: 'Synthetic terminal source', occurredAt: null })).source;
  const card = confirm(f, draft(f, source));
  ok(f.call('deleteSourceNote', { actionId: 'terminal', sourceId: source.sourceId, expectedRevision: source.revision }));
  assert.equal(f.db.prepare('SELECT state FROM card_notes WHERE id=?').get(source.sourceId).state, 'deleted'); invalidated(f, card);
});

test('r5 real v48 Memory forget invalidates its confirmed dependent', async t => {
  const f = await setup(t), memory = ok(f.core.admit({ namespace: ns, memory: { content: 'Synthetic terminal Memory', kind: 'fact' }, receipts: [receipt('terminal')] })).memory;
  const card = confirm(f, draft(f, memoryRef(memory)));
  assert.equal(ok(f.core.forget({ namespace: ns, memoryId: memory.id, expectedRevision: memory.revision })).forgotten, true);
  assert.equal(f.db.prepare('SELECT deleted FROM memories WHERE id=?').get(memory.id).deleted, 1); invalidated(f, card);
});

// These call the public writers, without replacing the mutation or decorating
// its acknowledgement. Correction excludes old Raw spans; deleting a Raw
// conversation removes a receipt or forgets the Memory according to support.
for (const operation of ['receipt-removal', 'Raw-exclusion', 'Raw-deletion']) test(`r5 real v48 terminal ${operation}`, async t => {
  const f = await setup(t, { raw: true }), part = splitRaw('Synthetic terminal Raw evidence.')[0];
  const saved = ok(await f.core.captureRaw(request(part, { namespace: ns, client: 'codex', sessionId: 'synthetic-terminal', eventId: 'terminal' })));
  let memory = ok(saved.interpretation).admission.memories[0];
  if (operation === 'receipt-removal') memory = ok(f.core.admit({ namespace: ns,
    memory: { content: 'Synthetic terminal interpretation', kind: 'fact' }, receipts: [receipt('independent')] })).memory;
  const card = confirm(f, draft(f, memoryRef(memory))), conversationId = saved.raw.conversationId;
  if (operation === 'Raw-exclusion') {
    ok(f.core.correct({ namespace: ns, memoryId: memory.id, expectedRevision: memory.revision,
      content: 'Synthetic corrected terminal interpretation', kind: 'fact', receipt: receipt('corrected') }));
    assert.equal(f.db.prepare('SELECT count(*) n FROM raw_source_exclusions WHERE conversation_id=?').get(conversationId).n, 1);
    assert.equal(f.db.prepare("SELECT count(*) n FROM content_suppressions WHERE kind='raw' AND match_mode='span' AND stable_key=?").get(conversationId).n, 1);
  } else {
    const revision = f.db.prepare('SELECT revision FROM raw_conversations WHERE id=?').get(conversationId).revision;
    const result = ok(f.core.deleteConversation({ namespace: ns, conversationId, expectedRevision: revision, actionId: 'terminal-delete' }));
    assert.equal(f.db.prepare('SELECT count(*) n FROM raw_conversations WHERE id=?').get(conversationId).n, 0);
    assert.deepEqual(f.db.prepare('SELECT DISTINCT source_type FROM raw_deletion_effects').all().map(row => row.source_type), ['conversation']);
    assert.equal(f.db.prepare('SELECT deleted FROM memories WHERE id=?').get(memory.id).deleted, operation === 'Raw-deletion' ? 1 : 0);
    assert.equal(result.removedReceipts, 1);
    if (operation === 'receipt-removal') assert.equal(f.db.prepare('SELECT count(*) n FROM receipts WHERE memory_id=?').get(memory.id).n, 1);
  }
  invalidated(f, card);
});

// Positive storage/feature-cell controls carried from write-features.
async function featureSetup(t) {
  const f=safetyFixture(t,33);await f.migrate();
  const authority={authorize(request){const {input,...binding}=request;return {...binding,accessGeneration:1};},isCurrent:grant=>grant};
  const core=openMemoryCore({path:f.path,
    privateCards:{version:'private-cards-local-v1',source:'submitted-note-v1',storage:'local-plain-v1',disclosure:'explicit-submitted-note-v1',authority,currentDependencies:{version:'card-current-dependencies-v1'}},
    methodPackages:{version:'method-packages-local-v1',storage:'local-plain-v1',authority},assets:{version:'assets-local-v1',storage:'sqlite-blob-v1',authority},
    roleProfiles:{version:'role-profiles-local-v1',storage:'local-plain-v1',authority,attribution:{actorId:'synthetic',agentId:'synthetic'}}});
  const db=f.connect();t.after(()=>{core.close();db.close();});
  return {...f,core,db,call:(method,input)=>core[method](input,{})};
}
const methodInput=(actionId,patch={})=>({namespace:ns,actionId,title:'Synthetic method',files:[{path:'guide.txt',text:'Synthetic instructions',mediaType:'text/plain'}],...patch});
const roleInput=(actionId,head=null,revision=null,patch={})=>({namespace:ns,roleKey:'synthetic',actionId,expectedCurrentRelease:head,expectedRegistryRevision:revision,fields:{duties:['Synthetic duty'],requiredOutputs:['Synthetic report']},...patch});

test('r4 actual method, asset and role writes preserve canonical metadata acknowledgements on v48',async t=>{
  const f=await featureSetup(t),calls=[];
  const call=(method,input)=>{const value=ok(f.call(method,input));calls.push(method);return value;};
  const first=call('importMethodVersion',methodInput('method-one'));
  const second=call('importMethodVersion',methodInput('method-two',{package:first.package,expectedPackageRevision:1,basedOn:first.version,change:{items:[],reasonRefs:[]}}));
  const binding={bindingNamespace:ns,package:first.package,version:second.version,readSet:[ns],roleId:null,expectedRevision:null,actionId:'adopt'};
  call('adoptMethodVersion',binding);
  call('disableMethodBinding',{bindingNamespace:ns,package:first.package,readSet:[ns],roleId:null,expectedRevision:1,actionId:'disable'});
  call('deleteMethodVersion',{actionId:'version-delete',ref:first.version,expectedRevision:1});
  call('deleteMethodPackage',{actionId:'package-delete',ref:first.package,expectedRevision:3});
  const asset=call('importAssetVersion',{namespace:ns,actionId:'asset',title:'Synthetic asset',filename:'synthetic.pdf',mediaType:'application/pdf',bytes:Buffer.from('%PDF-1.7')});
  const derivative=call('createAssetDerivative',derivativeInput(asset.version,'derivative'));
  call('deleteAssetDerivative',{actionId:'derivative-delete',ref:derivative.derivative,expectedRevision:1});
  call('deleteAssetVersion',{actionId:'asset-version-delete',ref:asset.version,expectedRevision:1});
  call('deleteAsset',{actionId:'asset-delete',ref:asset.asset,expectedRevision:2});
  const profile=call('publishRoleProfileRelease',roleInput('role-one'));
  const next=call('publishRoleProfileRelease',roleInput('role-two',profile.release,1));
  call('disableRoleProfile',{namespace:ns,roleKey:'synthetic',actionId:'role-disable',expectedCurrentRelease:next.release,expectedRegistryRevision:2});
  call('deleteRoleProfileRelease',{namespace:ns,roleKey:'synthetic',actionId:'role-delete',expectedCurrentRelease:next.release,expectedRegistryRevision:3,release:profile.release,expectedRevision:1});
  assert.equal(calls.length,15);assert.equal(new Set(calls).size,13);
  assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(),[]);
});

for(const base of [18,33])test(`r4 existing episode/staged-capture writes remain usable at safety base ${base}`,async t=>{
  const f=safetyFixture(t,base);await f.migrate();const db=f.connect(),core=openMemoryCore({path:f.path,model:episodeModel(),
    sessionEpisodes:{mode:'episode-v1',draftEveryBatches:2},captureEvidence:'staged-v1',captureQualification:'source-bound-v2'});
  t.after(()=>{core.close();db.close();});
  for(let i=1;i<=2;i++)ok(await core.capture({namespace:ns,client:'synthetic',sessionId:'episode',eventId:'event-'+i,episodeContext:{clientLabel:'Synthetic client',generation:'initial',origin:'ordinary'},
    messages:[{id:'message-'+i,role:'user',content:'Synthetic episode evidence '+i,occurredAt:'2025-02-03T04:05:06.789Z'}]}));
  assert.equal(db.prepare('SELECT count(*) n FROM episode_sources').get().n,1);
  assert.equal(db.prepare('SELECT count(*) n FROM session_episodes WHERE observed=2 AND covered=1').get().n,1);
});

