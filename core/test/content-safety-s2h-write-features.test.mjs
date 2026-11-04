import { model as episodeModel } from '../testing/episode-capture-helpers.mjs';
import { openRawCaptureCore } from '../raw-capture.mjs';
import { request, splitRaw, localPlainPort } from '../testing/raw-capture-fixtures.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { openMemoryCore } from '../index.mjs';
import { transaction } from '../database.mjs';
import { contentSafetyInventory } from '../content-safety-migration.mjs';
import { writeContentSuppressionInside } from '../content-suppression-storage.mjs';
import { safetyFixture, ns, ok, receipt } from '../testing/content-safety-s2h-fixture.mjs';
import { derivativeInput } from '../testing/asset-mixed-fixtures.mjs';

async function setup(t) {
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
  const f=await setup(t),calls=[];
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

for(const method of ['importMethodVersion','publishRoleProfileRelease'])test(`r4 actual ${method} rolls back a suppressed note or Memory reason`,async t=>{
  const f=await setup(t);
  const memory=ok(f.core.admit({namespace:ns,memory:{content:'Synthetic reason',kind:'fact'},receipts:[receipt('reason')]})).memory;
  const note=ok(f.call('submitSourceNote',{namespace:ns,actionId:'note',text:'Synthetic reason note',occurredAt:null})).source;
  const ref=method==='importMethodVersion'?note:{type:'memory',namespace:ns,memoryId:memory.id,revision:memory.revision};
  transaction(f.db,()=>writeContentSuppressionInside(f.db,{namespace:ns,kind:method==='importMethodVersion'?'submitted-note':'memory',key:method==='importMethodVersion'?note.sourceId:memory.id,reason:'privacy_erase',actionId:'reason-erased'}));
  const before=contentSafetyInventory(f.db),result=f.call(method,method==='importMethodVersion'?methodInput('suppressed',{change:{items:[],reasonRefs:[ref]}}):roleInput('suppressed',null,null,{changeReason:{text:'Synthetic reason',reasonRefs:[ref]}}));
  assert.equal(result.ok,false);assert.equal(contentSafetyInventory(f.db),before);
});

for(const target of ['raw','receipt'])test(`r4 Raw deletion succeeds with its own pre-existing ${target} fact`,async t=>{
  const f=safetyFixture(t,33);await f.migrate();
  const core=openRawCaptureCore({path:f.path,model:{contextWindow:8192,countTokens:()=>1,extract:()=>({items:[{content:'Synthetic terminal interpretation',kind:'fact',confidence:.8,sourceIndices:[0]}]})}},
    {mode:'raw-v1',deletion:true,port:localPlainPort(),readPolicy:()=>({generation:'synthetic',reason:null})});
  const db=f.connect();t.after(()=>{core.close();db.close();});
  const saved=ok(await core.captureRaw(request(splitRaw('Synthetic terminal Raw')[0],{namespace:ns,eventId:'terminal'})));
  const conversationId=saved.raw.conversationId,memory=ok(saved.interpretation).admission.memories[0];
  if(target==='receipt')ok(core.admit({namespace:ns,memory:{content:'Synthetic terminal interpretation',kind:'fact'},receipts:[receipt('independent')]}));
  const r=db.prepare('SELECT id FROM receipts WHERE memory_id=? ORDER BY created_at,id LIMIT 1').get(memory.id);
  transaction(db,()=>writeContentSuppressionInside(db,{namespace:ns,kind:target,key:target==='raw'?conversationId:r.id,reason:'privacy_erase',actionId:'terminal-target'}));
  ok(core.deleteConversation({namespace:ns,conversationId,expectedRevision:db.prepare('SELECT revision FROM raw_conversations WHERE id=?').get(conversationId).revision,actionId:'terminal-delete'}));
  assert.equal(db.prepare('SELECT count(*) n FROM raw_conversations WHERE id=?').get(conversationId).n,0);
  assert.equal(db.prepare('SELECT count(*) n FROM receipts WHERE id=?').get(r.id).n,0);
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

test('r4 an ordinary capture never adopts a trusted maintainer connection as its mutation handle',async t=>{
  const f=safetyFixture(t);await f.migrate();const db=f.connect();let inserts=0;
  const core=openMemoryCore({path:f.path,model:{contextWindow:8192,countTokens:()=>1,extract(){
    transaction(db,()=>writeContentSuppressionInside(db,{namespace:{ownerId:'synthetic-other-owner',scope:'owner',projectId:''},kind:'owner',matchMode:'owner',reason:'account_erasure',actionId:'trusted-maintenance'}));inserts++;
    return {items:[]};
  }}});t.after(()=>{core.close();db.close();});
  ok(await core.capture({namespace:ns,client:'synthetic',sessionId:'maintenance',eventId:'maintenance',messages:[{id:'message',role:'user',content:'Synthetic independent capture'}]}));
  assert.equal(inserts,1);assert.equal(db.prepare("SELECT count(*) n FROM content_suppressions WHERE owner_id='synthetic-other-owner'").get().n,1);
});

test('r4 deleting a note preserves automatic invalidation of its confirmed dependent Card',async t=>{
  const f=await setup(t);
  const source=ok(f.call('submitSourceNote',{namespace:ns,actionId:'confirmed-note',text:'Synthetic confirmed contributor',occurredAt:null})).source;
  let card=ok(f.call('createCardDraft',{namespace:ns,actionId:'confirmed-draft',drafting:'authored',input:{title:'Synthetic dependent',body:'Synthetic retained body',sources:[source]}}));
  card=ok(f.call('confirmCardDraft',{namespace:ns,actionId:'confirmed-card',cardId:card.id,expectedRevision:card.revision}));
  ok(f.call('deleteSourceNote',{namespace:ns,actionId:'delete-confirmed-note',sourceId:source.sourceId,expectedRevision:source.revision}));
  assert.equal(f.db.prepare('SELECT state FROM card_notes WHERE id=?').get(source.sourceId).state,'deleted');
  assert.equal(f.db.prepare('SELECT revision FROM private_cards WHERE id=?').get(card.id).revision,card.revision+1);
});
