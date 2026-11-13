import { CARD_METHODS, CARD_READS } from '../private-card-input.mjs';
import { CARD_CURRENT_METHODS } from '../card-current-input.mjs';
import { METHOD_METHODS, METHOD_READS } from '../method-package-input.mjs';
import { ASSET_METHODS, ASSET_READS } from '../asset-input.mjs';
import { ROLE_WRITES } from '../role-profile-input.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { openMemoryCore } from '../index.mjs';
import { contentSafetyFacade } from '../content-safety-boundary.mjs';
import { transaction } from '../database.mjs';
import { contentSafetyInventory } from '../content-safety-migration.mjs';
import { writeContentSuppressionInside } from '../content-suppression-storage.mjs';
import { CONTENT_WRITE_METHODS, CONTENT_TERMINAL_FIELDS, contentWriteMethodClass } from '../content-write-context.mjs';
import { sourceDigest } from '../procedural-storage.mjs';
import { rationaleModel } from '../testing/rationale-model.mjs';
import { cardHost } from '../testing/raw-source-fixtures.mjs';
import { safetyFixture, ns, ok, receipt } from '../testing/content-safety-s2h-fixture.mjs';

const inventory=JSON.parse(readFileSync(new URL('./fixtures/content-safety-facades.json',import.meta.url),'utf8'));
const admit=(core,text,kind='fact')=>ok(core.admit({namespace:ns,memory:{content:text,kind},receipts:[receipt(text)]})).memory;
const fact=(db,kind,key,actionId='pre-existing')=>transaction(db,()=>writeContentSuppressionInside(db,{namespace:ns,kind,key,reason:'privacy_erase',actionId}));
async function setup(t,patch={}) {
  const f=safetyFixture(t);await f.migrate();const core=openMemoryCore({path:f.path,...patch}),db=f.connect();
  t.after(()=>{core.close();db.close();});return {...f,core,db};
}
function unchanged(db,invoke) {
  const before=contentSafetyInventory(db);const result=invoke();assert.equal(result.ok,false,JSON.stringify(result));
  assert.ok(['evidence_unavailable','source_unavailable','memory_not_found','memory_suppressed','revision_conflict'].includes(result.error.code));
  assert.equal(contentSafetyInventory(db),before,'denied acknowledgement rolled back all canonical, audit, epoch and fact writes');return result;
}

test('r4 write acknowledgement: explicit promotion rolls back a suppressed held predecessor',async t=>{
  let content='Synthetic earlier active context',kind='context';
  const model={...rationaleModel(),extract:()=>({items:[{content,kind,confidence:.8,sourceIndices:[0]}]})};
  const f=await setup(t,{model,decisionReview:'required-v1'});
  const capture=event=>({namespace:ns,client:'synthetic',sessionId:'ordered',eventId:event,causal:{streamId:'stream',sequence:event==='first'?1:2},messages:[{id:event,role:'user',content:'Synthetic direct source'}]});
  const previous=ok(await f.core.capture(capture('first'))).admission.memories[0];
  content='Synthetic chosen replacement';kind='decision';
  model.reconcile=()=>({transitions:[{replacementIndex:0,predecessorIndex:0,evidenceIndices:[0],relation:'supersedes',valueChange:'changed',adoption:'explicit'}]});
  ok(await f.core.capture(capture('second')));
  assert.equal(f.db.prepare("SELECT count(*) n FROM confirmation_supersessions WHERE status='pending'").get().n,1);
  fact(f.db,'memory',previous.id);
  unchanged(f.db,()=>f.core.admit({namespace:ns,memory:{content,kind},receipts:[receipt('explicit-promotion')]}));
  assert.deepEqual({...f.db.prepare('SELECT revision,currentness FROM memories WHERE id=?').get(previous.id)},{revision:previous.revision,currentness:'current'});
  assert.equal(f.db.prepare("SELECT count(*) n FROM confirmation_supersessions WHERE status='pending'").get().n,1);
});

test('r4 write acknowledgement: procedural receipt anchors deny before tag commit',async t=>{
  const f=await setup(t),memory=admit(f.core,'Synthetic procedural instruction','instruction');
  const r=f.db.prepare('SELECT * FROM receipts WHERE memory_id=?').get(memory.id);fact(f.db,'receipt',r.id);
  unchanged(f.db,()=>f.core.setProceduralMemory({namespace:ns,memoryId:memory.id,expectedRevision:memory.revision,expectedTagRevision:0,
    procedural:{anchors:[{receiptId:r.id,digest:sourceDigest(r.excerpt),start:0,end:4}]}}));
  assert.equal(f.db.prepare('SELECT count(*) n FROM procedural_tags').get().n,0);
});

test('r4 write acknowledgement: confirmation replay denies its confirmationReceiptId',async t=>{
  const f=await setup(t,{decisionReview:'required-v1'}),memory=admit(f.core,'Synthetic waiting decision','decision');
  f.db.prepare("UPDATE memories SET review_state='awaiting' WHERE id=?").run(memory.id);
  const input={namespace:ns,memoryId:memory.id,expectedRevision:memory.revision,actionId:'confirmation',receipt:receipt('confirmation')};
  const result=ok(f.core.confirm(input));assert.ok(result.confirmationReceiptId);fact(f.db,'receipt',result.confirmationReceiptId);
  unchanged(f.db,()=>f.core.confirm(input));
  assert.equal(f.db.prepare('SELECT count(*) n FROM confirmation_actions').get().n,1);
});

// Every inventory write name crosses this exact facade -> native transaction
// path. The populated mutation deliberately differs from its acknowledgement:
// the reference-only probe catches checks which inspect only the return value.
// Domain-specific input/replay/terminal behavior is exercised separately above
// and by the writer integration matrix, rather than mocked predicates.
for(const [facade,methods]of Object.entries(inventory))for(const [method,classification]of Object.entries(methods)) {
  if(classification.kind!=='gated'||classification.operation!=='write')continue;
  test(`r4 mechanical write ${facade}.${method}: positive transaction control`,async t=>{
    const f=await setup(t),memory=admit(f.core,'Synthetic positive reference');
    const api=contentSafetyFacade({[method](){return transaction(f.db,()=>{
      f.db.prepare("UPDATE memories SET updated_at='synthetic-committed' WHERE id=?").run(memory.id);
      return {ok:true,value:{memoryId:memory.id,revision:memory.revision}};
    });}}, {check(){}});
    ok(api[method]({namespace:ns}));assert.equal(f.db.prepare('SELECT updated_at FROM memories WHERE id=?').get(memory.id).updated_at,'synthetic-committed');
  });
  for(const referenceOnly of [false,true])test(`r4 mechanical write ${facade}.${method}: ${referenceOnly?'committed reference':'acknowledgement'} refusal and rollback`,async t=>{
    const f=await setup(t),memory=admit(f.core,'Synthetic populated reference'),r=f.db.prepare('SELECT * FROM receipts WHERE memory_id=?').get(memory.id);
    fact(f.db,'receipt',r.id);
    const api=contentSafetyFacade({[method](){return transaction(f.db,()=>{
      if(referenceOnly)f.db.prepare("INSERT INTO procedural_tags VALUES(?,1,1,'explicit',?)").run(memory.id,JSON.stringify([{receiptId:r.id,digest:sourceDigest(r.excerpt),start:0,end:4}]));
      else f.db.prepare("UPDATE memories SET updated_at='synthetic-uncommitted' WHERE id=?").run(memory.id);
      return referenceOnly?{ok:true,value:{changed:true}}:{ok:true,value:{confirmationReceiptId:r.id}};
    });}}, {check(){},failure:error=>({ok:false,error:{code:error.code}})});
    unchanged(f.db,()=>api[method]({namespace:ns}));
  });
}

test('r4 write inventory has a closed operation and terminal-target classification',()=>{
  const listed=new Set();
  for(const method of [...CARD_METHODS.filter(name=>!CARD_READS.has(name)),...CARD_CURRENT_METHODS,...METHOD_METHODS.filter(name=>!METHOD_READS.has(name)),...ASSET_METHODS.filter(name=>!ASSET_READS.has(name)),...ROLE_WRITES])assert.ok(CONTENT_WRITE_METHODS.includes(method),method+' must be a guarded write');
  for(const [facade,methods]of Object.entries(inventory))for(const [method,value]of Object.entries(methods))if(value.kind==='gated'){
    assert.ok(['read','write','maintenance'].includes(value.operation),facade+'.'+method);
    assert.equal(contentWriteMethodClass(method),value.operation==='write'?'write':'read',facade+'.'+method+' dispatch class');
    if(value.operation==='write'){assert.ok(CONTENT_WRITE_METHODS.includes(method));listed.add(method);assert.equal(value.terminalField,CONTENT_TERMINAL_FIELDS[method]??null);}
  }
  assert.deepEqual([...listed].sort(),[...CONTENT_WRITE_METHODS].sort());
});

for(const field of ['opaqueId','opaqueIds','opaqueRef','opaqueRefs','unknownSourceId'])test(`r4 write walker refuses unclassified ${field} and rolls back`,async t=>{
  const f=await setup(t),memory=admit(f.core,'Synthetic unknown reference');
  const api=contentSafetyFacade({admit(){return transaction(f.db,()=>{f.db.prepare("UPDATE memories SET updated_at='uncommitted' WHERE id=?").run(memory.id);return {ok:true,value:{[field]:field.endsWith('s')?[memory.id]:memory.id}};});}},
    {check(){},failure:error=>({ok:false,error:{code:error.code}})});
  unchanged(f.db,()=>api.admit({namespace:ns}));
});

for(const method of ['forget','cancelCardDraft','deleteKnowledgeCard','deleteSourceNote'])test(`r4 terminal ${method} succeeds with its own pre-existing fact`,async t=>{
  if(method==='forget'){
    const f=await setup(t),memory=admit(f.core,'Synthetic terminal Memory');fact(f.db,'memory',memory.id);
    assert.equal(ok(f.core.forget({namespace:ns,memoryId:memory.id,expectedRevision:memory.revision})).forgotten,true);
    assert.equal(f.db.prepare('SELECT deleted FROM memories WHERE id=?').get(memory.id).deleted,1);return;
  }
  const f=safetyFixture(t,23);await f.migrate();const host=cardHost(),core=openMemoryCore({path:f.path,privateCards:host.options}),db=f.connect();t.after(()=>{core.close();db.close();});
  const call=(name,input)=>host.call(core,name,{namespace:ns,...input});
  const source=ok(call('submitSourceNote',{actionId:'note',text:'Synthetic terminal note',occurredAt:null})).source;
  if(method==='deleteSourceNote'){
    fact(db,'submitted-note',source.sourceId);ok(call(method,{actionId:'terminal',sourceId:source.sourceId,expectedRevision:source.revision}));
    assert.equal(db.prepare('SELECT state FROM card_notes WHERE id=?').get(source.sourceId).state,'deleted');return;
  }
  let card=ok(call('createCardDraft',{actionId:'draft',drafting:'authored',input:{title:'Synthetic title',body:'Synthetic body',sources:[source]}}));
  if(method==='deleteKnowledgeCard')card=ok(call('confirmCardDraft',{actionId:'confirmation',cardId:card.id,expectedRevision:card.revision}));
  fact(db,'card',card.id);ok(call(method,{actionId:'terminal',cardId:card.id,expectedRevision:card.revision}));
  assert.equal(db.prepare('SELECT state FROM private_cards WHERE id=?').get(card.id).state,method==='cancelCardDraft'?'cancelled':'deleted');
});

for(const mode of ['version','revision-through'])test(`r4 pre-operation ${mode} facts validate bound acknowledgement revisions after mutation`,async t=>{
  const f=await setup(t),memory=admit(f.core,'Synthetic bound predecessor');
  transaction(f.db,()=>writeContentSuppressionInside(f.db,{namespace:ns,kind:'memory',key:memory.id,matchMode:mode,
    sourceVersion:JSON.stringify([mode==='version'?'memory-revision-v1':'memory-revision-through-v1',memory.revision]),reason:'privacy_erase',actionId:'bound'}));
  const api=contentSafetyFacade({supersede(){return transaction(f.db,()=>{
    f.db.prepare('UPDATE memories SET revision=revision+1 WHERE id=?').run(memory.id);
    return {ok:true,value:{predecessor:{memoryId:memory.id,revision:memory.revision}}};
  });}}, {check(){},failure:error=>({ok:false,error:{code:error.code}})});
  unchanged(f.db,()=>api.supersede({namespace:ns}));
  assert.equal(f.db.prepare('SELECT revision FROM memories WHERE id=?').get(memory.id).revision,memory.revision);
});

test('r4 own terminal exemptions do not exempt other previously suppressed audit identities',async t=>{
  const f=await setup(t),target=admit(f.core,'Synthetic terminal target'),other=admit(f.core,'Synthetic other audit identity');
  const r=f.db.prepare('SELECT id FROM receipts WHERE memory_id=?').get(other.id);fact(f.db,'receipt',r.id);
  const api=contentSafetyFacade({forget(){return transaction(f.db,()=>{
    writeContentSuppressionInside(f.db,{namespace:ns,kind:'memory',key:target.id,reason:'user_forget',actionId:'own-terminal'});
    f.db.prepare('UPDATE memories SET deleted=1,content=NULL,revision=revision+1 WHERE id=?').run(target.id);
    return {ok:true,value:{forgotten:true,reviewEffects:{confirmationReceiptId:r.id}}};
  });}}, {check(){},failure:error=>({ok:false,error:{code:error.code}})});
  unchanged(f.db,()=>api.forget({namespace:ns}));
  assert.equal(f.db.prepare('SELECT deleted FROM memories WHERE id=?').get(target.id).deleted,0);
});

test('r4 live facade inventory: every write refuses a populated nonterminal namespace identity',async t=>{
  const {createMemoryRuntime}=await import('../runtime.mjs');
  const {openMemoryStore}=await import('../index.mjs');
  const {createPrivateCardFacade}=await import('../private-card-facade.mjs');
  const {createMethodPackageFacade}=await import('../method-package-facade.mjs');
  const {createAssetFacade}=await import('../asset-facade.mjs');
  const {createRoleProfileFacade}=await import('../role-profile-facade.mjs');
  const f=safetyFixture(t,33);await f.migrate();
  const authority={authorize(request){const {input,...binding}=request;return {...binding,accessGeneration:1};},isCurrent:grant=>grant};
  const privateCards={version:'private-cards-local-v1',source:'submitted-note-v1',storage:'local-plain-v1',disclosure:'explicit-submitted-note-v1',authority,currentDependencies:{version:'card-current-dependencies-v1'}};
  const methodPackages={version:'method-packages-local-v1',storage:'local-plain-v1',authority},assets={version:'assets-local-v1',storage:'sqlite-blob-v1',authority};
  const roleProfiles={version:'role-profiles-local-v1',storage:'local-plain-v1',authority,attribution:{actorId:'synthetic',agentId:'synthetic'}};
  const config={path:f.path,privateCards,methodPackages,assets,roleProfiles};
  const core=openMemoryCore({...config,contextRead:{version:'context-read-v1',authority,counter:{id:'synthetic',countTokens:()=>1}},rawConversations:{mode:'off',readPolicy:()=>({generation:'synthetic',reason:null})}}),runtime=createMemoryRuntime(config),store=openMemoryStore({path:f.path}),db=f.connect();
  t.after(()=>{core.close();runtime.close();store.close();db.close();});
  const memory=admit(core,'Synthetic populated live write','instruction'),source=ok(core.submitSourceNote({namespace:ns,actionId:'note',text:'Synthetic populated note',occurredAt:null},{})).source;
  const card=ok(core.createCardDraft({namespace:ns,actionId:'card',drafting:'authored',input:{title:'Synthetic populated title',body:'Synthetic populated body',sources:[source]}},{}));
  db.prepare('INSERT INTO raw_conversations VALUES(?,?,?,?,?,?,1,?,?)').run('synthetic-live-raw',ns.ownerId,ns.scope,ns.projectId,'codex','synthetic-session','synthetic','synthetic');
  const receiptId=db.prepare('SELECT id FROM receipts WHERE memory_id=?').get(memory.id).id;
  const handles={core,runtime,cards:createPrivateCardFacade(runtime.privateCards,privateCards,runtime.ready,{prepare(){assert.fail('denied writer reached retained Raw source');}}),
    methods:createMethodPackageFacade(runtime.methodPackages,methodPackages,runtime.ready,assets),assets:createAssetFacade(runtime.assets,assets,runtime.ready),
    roles:createRoleProfileFacade(runtime.roleProfiles,roleProfiles,{path:f.path}),scope:store.scope({ownerId:ns.ownerId,projectId:ns.projectId})};
  for(const [name,handle]of Object.entries(handles))assert.deepEqual(Object.keys(handle).filter(k=>typeof handle[k]==='function').sort(),Object.keys(inventory[name]).sort(),name+' has a new unclassified method');
  transaction(db,()=>writeContentSuppressionInside(db,{namespace:ns,kind:'namespace',matchMode:'namespace',reason:'privacy_erase',actionId:'nonterminal-namespace'}));
  const input={namespace:ns,ownerId:ns.ownerId,memoryId:memory.id,expectedRevision:memory.revision,cardId:card.id,sourceId:source.sourceId,
    receiptId,conversationId:'synthetic-live-raw',actionId:'denied-write',readSet:[ns],memory:{content:'Synthetic populated call',kind:'fact'},receipts:[receipt('populated')]};
  const before=contentSafetyInventory(db);let count=0;
  for(const [name,handle]of Object.entries(handles))for(const [method,classification]of Object.entries(inventory[name]))if(classification.operation==='write'){
    let result,error;try{
      result=await (name==='runtime'?handle[method](ns,input):name==='scope'?handle[method](method==='remember'?{content:'Synthetic populated call',kind:'fact',receipt:receipt('scope')}:memory.id,input,memory.revision):handle[method](input,{}));
    }catch(cause){error=cause;}
    assert.ok(error||result?.ok===false,name+'.'+method+' acknowledged erased namespace');
    assert.ok(['memory_not_found','evidence_unavailable'].includes(error?.code??result.error.code),name+'.'+method);
    assert.equal(contentSafetyInventory(db),before,name+'.'+method+' committed during refusal');
    if(result)for(const id of [memory.id,card.id,source.sourceId,receiptId,'synthetic-live-raw'])assert.equal(JSON.stringify(result).includes(id),false);
    count++;
  }
  assert.equal(count,135);t.diagnostic('LIVE_WRITE_DENIALS '+count);
});

test('r4 terminal rejection and its verified replay exempt only their own held replacement',async t=>{
  let content='Synthetic active predecessor',kind='context';
  const model={...rationaleModel(),extract:()=>({items:[{content,kind,confidence:.8,sourceIndices:[0]}]})};
  const f=await setup(t,{model,decisionReview:'required-v1'});
  const capture=event=>({namespace:ns,client:'synthetic',sessionId:'rejection',eventId:event,causal:{streamId:'stream',sequence:event==='first'?1:2},messages:[{id:event,role:'user',content:'Synthetic direct source'}]});
  ok(await f.core.capture(capture('first')));content='Synthetic held rejection';kind='decision';
  model.reconcile=()=>({transitions:[{replacementIndex:0,predecessorIndex:0,evidenceIndices:[0],relation:'supersedes',valueChange:'changed',adoption:'explicit'}]});
  const replacement=ok(await f.core.capture(capture('second'))).admission.memories[0];
  fact(f.db,'memory',replacement.id);
  const input={namespace:ns,memoryId:replacement.id,expectedRevision:replacement.revision,actionId:'reject-own'};
  const result=ok(f.core.reject(input));assert.equal(result.forgotten,true);
  assert.equal(result.reviewEffects.transitions[0].replacement.memoryId,replacement.id);
  const before=contentSafetyInventory(f.db);assert.deepEqual(ok(f.core.reject(input)),result);assert.equal(contentSafetyInventory(f.db),before);
});

test('r4 every literal identity-shaped acknowledgement field and projection occurrence requires classification',()=>{
  // Admission envelope validation adds literal applicationId (1) and storeId
  // (2): public schema/store binding fields with closed types, never secrets or
  // writer acknowledgement identities. The sidecar decision-table comment's
  // two 'invalid:' labels are counted as key:invalid by this textual census;
  // neither is an executable field. The acknowledgement guard stays unchanged.
  // Offline layout upgrade adds literal:storeId (1): a public store-binding
  // field with a closed identifier type, never a secret or a writer
  // acknowledgement identity. Property access and the returned shorthand
  // reuse that validated binding; neither adds a textual census occurrence.
  // Include projections after storage returns, and string keys used by computed
  // objects. A new occurrence of an existing name also requires review.
  // R2 round 2: selected-row namespace validation adds existing owner/project
  // keys; Memory selection adds an existing memoryId; the redundant Raw
  // per-port fact projection is removed. These are reads, not new ack fields.
  // R3: admission scope and Card source memo keys reuse canonical read proofs;
  // the two internal counter/embedding wrapper ids are configuration metadata.
  // Main merge: the B3 comparison module is a read-side manifest. Its ids are
  // the envelope id, store binding, observation input and fence-row columns.
  // The sidecar adds the comparison store binding, base generation ids and two
  // reason strings; the pump adds a reservation id. None is an ack field.
  // Main a69cc979: verificationMeter's term_id names the private posting column
  // sized for a bounded statistics-reset SELECT. It is not a canonical content
  // identity or a field returned by a writer acknowledgement.
  // Main 80bc3474 (#530): context-read-sidecar's uid (2) and gid (1), and
  // context-product-sidecar's uid (1), are file-stat owner/group fields used
  // by protection predicates. context-product-attribution's validation_invalid
  // (1) is a failure-reason string. None is a canonical content identity or a
  // field returned by a writer acknowledgement.
  // Composite 93bfa28c (#534, #535, #536):
  // uid/gid protection predicates move from the sidecars to the shared journal
  // probe: sidecar uid counts are now 1/0; probe uid/gid counts are 3/1.
  // These are file-stat owner/group fields, not canonical content identities.
  // The pump's new windowId reconciles a private semantic accounting quantum;
  // the worker's three windowId results bind reservation/settlement accounting.
  // They identify budget windows, not retained content or writer acknowledgements.
  // Main 6d8ced65 (#538):
  // Publication reuse compares the private vector generation id with the
  // authenticated record (key:id 4 -> 5). The new oversized-state check uses
  // the private invalid-evidence marker (literal:invalid 7 -> 8). Neither is
  // a canonical content identity or a writer acknowledgement field.
  // Attribution guard:
  // failureSelected is private read-only state and adds no identity-shaped
  // occurrence, canonical identity or writer acknowledgement field.
  // The terminal writer and acknowledgement field guard are unchanged.
  // B1 control: the semantic read fence adds private owner/store/operation bindings;
  // its accounting callback allowlist names owner/domain/ledger identities.
  // The sidecar document id is projected only into a request-local read proof.
  // These nine occurrences are read/IPC/accounting metadata, not writer ack
  // fields; the terminal writer and structural acknowledgement guard are unchanged.
  // These changes retain the native guard's fail-closed walker.
  // B2b: batchRefs lists and canonical Memory/receipt JSON fields are
  // private read projections inside existing snapshots. The receipt source
  // ref uses the existing typed source union and binding. No writer or
  // acknowledgement field is added; the native fail-closed walker is unchanged.
  // Maintenance turn seam: pumpId and windowId are opaque scheduler identifiers
  // of a pump and its budget window, carried in the maintenance-turn request
  // to the host's pre-quantum port. Neither is a canonical content identity or
  // a writer acknowledgement field.
  // Foreign-binding repair: the read-only disposal check adds one
  // validation_invalid failure-reason string in context-product-sidecar (6 -> 7).
  // It is not a canonical content identity or a writer acknowledgement field.
  // Optional Raw identities bind read candidates, source proofs, publications,
  // provider metadata and private maintenance budget windows. They add no
  // canonical writer acknowledgement fields. Returned reader methods check
  // canonical denials independently of these hints.
  // Sidecar attestation: three attestation_invalid literals select the private
  // open refusal, repair classification and child recheck verdict. They are
  // failure-reason strings, with no writer acknowledgement field or guard change.
  // Card lineage: actorId/actor_id and host_action_id bind trusted Card authorization
  // requests and private audit rows. Card/source/namespace ids in the lineage
  // module, Card storage and offline migration bind retained provenance and
  // canonical read refs; the observation messageId matches retained Raw facts.
  // Generated base DDL repeats existing JSON field names; safety_header_invalid
  // is a trigger error string. The final output boundary checks the existing
  // effectId/actionId/affectedIds projection against canonical audit rows.
  // The native guard's added Card/source ids and literal id classify captured
  // changes and validate the approved causal invalidation; they add no public
  // acknowledgement field or terminal exemption. Keep that guard unchanged.
  // Dated Memory + Raw assembly: source-turn/session ids and inline Raw refs
  // are private read projections. No writer acknowledgement or native guard
  // changes; delivery validates canonical Memory and prepared Raw separately.
  // Local Raw search projects only the fixed owner's namespace into its private
  // manager. Ordinary Raw capture reconstructs existing message/event/session
  // identities before journal registration. Pin these existing projections;
  // neither adds acknowledgement fields or changes the native write guard.
  // Recall's recency keyset adds one private last-position id in the signed
  // cursor boundary. It adds no writer acknowledgement or terminal exemption.
  const expected=JSON.parse(readFileSync(new URL('./fixtures/content-safety-write-fields.json',import.meta.url),'utf8'));
  const files=JSON.parse(readFileSync(new URL('../../packaging/artifact-files.json',import.meta.url),'utf8'));
  const actual={};
  for(const file of files.filter(name=>name.endsWith('.mjs'))){
    const source=readFileSync(new URL('../../'+file,import.meta.url),'utf8'),fields={};
    for(const [kind,matches]of [['key',[...source.matchAll(/\b([A-Za-z_$][A-Za-z0-9_$]*)\s*:/g)].map(m=>m[1])],['literal',[...source.matchAll(/(['"])([A-Za-z_$][A-Za-z0-9_$]*)\1/g)].map(m=>m[2])]])
      for(const field of matches)if(/[iI]ds?$|Refs?$/.test(field)){const key=kind+':'+field;fields[key]=(fields[key]??0)+1;}
    if(Object.keys(fields).length)actual[file]=Object.fromEntries(Object.entries(fields).sort(([a],[b])=>a.localeCompare(b,'en')));
  }
  assert.deepEqual(actual,expected,'new identity-shaped field/projection: classify it and update the shared guard before accepting the census');
});
