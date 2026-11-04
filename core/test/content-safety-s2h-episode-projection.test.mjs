import { costMatrixGate as familyGate } from '../testing/receipt-event-time-gates.mjs';
import { costGateFamilies, costFamilyLabel, costFamilyFixture } from '../testing/receipt-event-time-gates.mjs';
import { assertIntegratedCostPin } from '../testing/content-safety-s2h-deferred-cost.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { safetyFixture, ns, ok, receipt } from '../testing/content-safety-s2h-fixture.mjs';
import { openCostMemoryCore as openMemoryCore } from '../testing/content-safety-cost-hosts.mjs';
import { createMemoryRuntime } from '../runtime.mjs';
import { batch } from '../testing/episode-helpers.mjs';
import { measureContentRead } from '../testing/content-safety-cost-meter.mjs';
import { assertCostGateCell, assertCostGateCases } from '../testing/content-safety-s2h-cost-inventory.mjs';
import { transaction } from '../database.mjs';
import { writeContentSuppressionInside } from '../content-suppression-storage.mjs';
const counts=JSON.parse(readFileSync(new URL('./fixtures/content-safety-s2h-deferred-counts.json',import.meta.url),'utf8'));
// Identity-census classification: the new Episode/source/Memory/Raw ids and
// namespace fields in the projection are internal read evidence. The local
// receipt identity and Raw fact targets are validator inputs. None is a new
// writer acknowledgement field; the shared acknowledgement guard is unchanged.
const sha=value=>createHash('sha256').update(value).digest('hex');
const range={since:'2026-01-01T00:00:00.000Z',until:'2026-12-31T00:00:00.000Z',timeBasis:'receipt',limit:1};
async function setup(t,base=33,safety=true,family='safety') {
 const f=costFamilyFixture(t,base,family);if(safety)await f.migrate();const db=f.connect();let ports=0;
 const core=openMemoryCore({path:f.path,model:{contextWindow:8192,countTokens(){ports++;return 1;}}}),runtime=createMemoryRuntime({path:f.path,sessionEpisodes:{mode:'episode-v1'}});
 t.after(()=>{runtime.close();core.close();db.close();});return {...f,db,core,runtime,ports:()=>ports};
}
function publish(f,name='one',client='synthetic') {
 const input={...batch(name,'Synthetic bounded Episode source '+name,'session-'+name),client},r=f.runtime.reserveEpisodeBatch(ns,input);
 const writer=f.runtime.claimEpisodeWriter(ns,{episodeId:r.episodeId,generation:'initial'}),claim=f.runtime.claimEpisodeDraft(ns,{episodeId:r.episodeId,generation:'initial',writerToken:writer.token,trigger:'batch',watermark:r.position});
 const field=value=>({value,anchors:[{sourceIndex:0,start:0,end:input.view.messages[0].content.length}]});
 f.runtime.commitEpisodeDraft(ns,{episodeId:r.episodeId,token:claim.token,sources:[{eventId:input.eventId,messageId:input.view.messages[0].id}],
  result:{type:field('work'),language:'en',gist:field('Synthetic Episode gist '+name),outcome:null,nextStep:field('Review evidence'),disposition:null},dispositions:[{eventId:input.eventId,omitted:0}],
  modelMetadata:{adapter:'scripted',model:null,profile:null,promptVersion:'storage-test',digest:sha('prompt'),portVersion:'episode-v1'}});
 f.runtime.releaseEpisodeWriter(ns,{episodeId:r.episodeId,token:writer.token});
 f.db.prepare('UPDATE session_episodes SET first_received_at=?,last_received_at=? WHERE id=?').run('2026-06-01T00:00:00.000Z','2026-06-01T00:00:00.000Z',r.episodeId);
 return r.episodeId;
}
const completeProjection=familyGate('S2h-3 Episode projection matrices',costGateFamilies().length*6);
const completeNontrivial=familyGate('S2h-3 Episode nontrivial matrices',costGateFamilies().length*2);
const paired=new Map();
for(const family of costGateFamilies())for(const base of [18,23,33])for(const n of [12,24])test(`Episode projection cost v${base} n${n}${costFamilyLabel(family,base)}`,async t=>{
 const records=[];
 for(const [safety,facts]of [[false,0],[true,0],[true,5]]) {
  const f=await setup(t,base,safety,family);let id;for(let i=0;i<n;i++){
   ok(f.core.admit({namespace:ns,memory:{content:'Synthetic projection Memory '+i,kind:'fact'},receipts:[receipt('projection-'+i)]}));
   id=publish(f,'cost-'+i);
  }
  if(facts)transaction(f.db,()=>{for(let i=0;i<facts;i++)writeContentSuppressionInside(f.db,{namespace:ns,kind:'memory',key:'unrelated-'+i,reason:'purge',actionId:'fact-'+i});});
  assertCostGateCell(f.db,base,safety,facts,ns.ownerId,{family,testName:t.name,n});
  const rows=[];
  for(const [method,input,variant]of [['getEpisode',{namespace:ns,episodeId:id},'hit'],['listEpisodes',{namespace:ns,...range},'hit'],['listEpisodes',{namespace:{...ns,projectId:'absent'},...range},'absent'],['sessionStartContext',{namespace:ns,groups:{nextSteps:true,procedural:false}},'nextSteps']]) {
   const row=await measureContentRead(method,variant,()=>f.core[method](input),f.ports);assert.equal(row.result.ok,true,JSON.stringify(row.result));rows.push(row);
   if(method==='listEpisodes'&&variant==='hit'){assert.ok(row.result.value.nextCursor);const page=await measureContentRead(method,'cursor',()=>f.core[method]({...input,cursor:row.result.value.nextCursor}),f.ports);assert.equal(page.result.ok,true);rows.push(page);}
  }
  assertCostGateCases('episode-projection',rows);
  records.push({safety,facts,rows});
 }
 const legacy=records[0];
 for(const current of records.slice(1))for(const [i,row]of current.rows.entries()) {
  const old=legacy.rows[i],key=JSON.stringify([family,base,current.facts,row.method,row.variant]);
  const smaller=paired.get(key);
  if(n===12)paired.set(key,[row,old]);
  await t.test(`${row.method}:${row.variant} facts=${current.facts}`,()=>{
   assert.equal(row.ports,old.ports);
   // Fail-before: get/list hit ceilings and nextSteps ceiling/slope. Controls:
   // BEGIN, absent ceilings and get/list paired slopes already pass on the base.
   assert.ok(row.statements<=old.statements+6+row.ports,'R2-A1 ceiling '+key+' S='+row.statements+' L='+old.statements+' E1='+row.ports);
   assert.ok(row.begin<=old.begin,'R2-A1 BEGIN '+key);
   const pin=counts.episodeProjection?.[JSON.stringify([base,n,current.facts,row.method,row.variant])];
   if(family==='safety')assert.deepEqual([row.statements,row.begin,row.ports],pin,'downward exact Episode projection pin '+key);
   assertIntegratedCostPin(row,old,{family,base,n,facts:current.facts,testName:t.name});
  });
  if(n===24)await t.test(`${row.method}:${row.variant} facts=${current.facts} paired slope`,()=>{const [small,baseline]=smaller;assert.ok((row.statements-row.ports)-(small.statements-small.ports)<=old.statements-baseline.statements,'paired slope net of E1 '+key);});
 }
 // New immutable-main fixture; the existing unmigrated inventory stays intact.
 assert.match(counts.episodeLegacy?.mainSha,/^26f9e467[0-9a-f]{32}$/);
 for(const row of legacy.rows){const pin=counts.episodeLegacy.caps[JSON.stringify([base,n,row.method,row.variant])];assert.deepEqual([row.statements,row.begin,row.hostInvocations],pin,'new legacy main pin');}
 completeProjection(t.name);
});

function calls(f,id) {
 return [()=>f.core.getEpisode({namespace:ns,episodeId:id,sourceLimit:1}),
  ()=>f.core.listEpisodes({namespace:ns,...range}),
  ()=>f.core.sessionStartContext({namespace:ns,groups:{nextSteps:true,procedural:false}})];
}
async function refusal(t,mutate,{code,client='synthetic'}={}) {
 const f=await setup(t),id=publish(f,'proof',client);await mutate(f,id);
 for(const call of calls(f,id)){const r=call();assert.equal(r.ok,false,JSON.stringify(r));if(code)assert.equal(r.error.code,code);assert.doesNotMatch(JSON.stringify(r),/Synthetic (bounded|Episode)/);}
}
// Controls: these public denials already held on the base. Count assertions in
// the cost matrix prove the new implementation supplies them without extra SQL.
for(const kind of ['deleted','foreign','missing'])test(`Episode projection control: ${kind} origin`,async t=>{
 await refusal(t,(f,id)=>{
  const other=publish(f,'origin');
  f.db.prepare('UPDATE episode_sources SET origin_episode_id=? WHERE episode_id=?').run(other,id);
  if(kind==='deleted')f.db.prepare('UPDATE session_episodes SET deleted=1 WHERE id=?').run(other);
  if(kind==='foreign')f.db.prepare('UPDATE session_episodes SET owner_id=? WHERE id=?').run('foreign',other);
  if(kind==='missing'){f.db.exec('PRAGMA foreign_keys=OFF');f.db.prepare('UPDATE episode_sources SET origin_episode_id=? WHERE episode_id=?').run('missing',id);}
 },{code:'revision_conflict'});
});
for(const reason of ['user_forget','correction_supersession'])for(const malformed of [false,true])test(`Episode projection control: matching receipt parent ${reason}${malformed?' before malformed digest':''}`,async t=>{
 await refusal(t,(f,id)=>{
  const s=f.db.prepare('SELECT s.*,e.client,e.session_key FROM episode_sources s JOIN session_episodes e ON e.id=s.origin_episode_id WHERE s.episode_id=?').get(id);
  const receipt={client:s.client,sessionId:s.session_key,eventId:s.message_id,role:s.role,excerpt:s.text};
  const m=ok(f.core.admit({namespace:ns,memory:{content:'Synthetic receipt parent',kind:'fact'},receipts:[receipt]})).memory;
  transaction(f.db,()=>writeContentSuppressionInside(f.db,{namespace:ns,kind:'memory',key:m.id,reason,actionId:'deny-parent',...(reason==='correction_supersession'?{matchMode:'revision-through',sourceVersion:JSON.stringify(['memory-revision-through-v1',m.revision])}:{})}));
  if(malformed)f.db.prepare('UPDATE episode_sources SET digest=? WHERE episode_id=?').run('0'.repeat(64),id);
 },{code:'source_excluded'});
});
// Fail-before: the old Episode reader accepted a corrupt stored source digest.
test('Episode projection refuses malformed digest',async t=>{await refusal(t,f=>f.db.prepare('UPDATE episode_sources SET digest=?').run('0'.repeat(64)));});
// Fail-before: publication is bounded to sixteen; stored overflow must refuse.
test('Episode projection refuses the seventeenth source',async t=>{await refusal(t,(f,id)=>{
 const s=f.db.prepare('SELECT * FROM episode_sources WHERE episode_id=?').get(id);
 for(let i=0;i<16;i++)f.db.prepare('INSERT INTO episode_sources VALUES(?,?,?,?,?,?,?,?,?,?)').run(randomUUID(),id,s.origin_episode_id,s.event_id,'extra-'+i,s.digest,s.role,s.text,s.truncated,s.ordinal);
});});
// Control: proof must cover sources outside get's returned source page.
test('Episode projection control: whole closure outside the source page',async t=>{await refusal(t,(f,id)=>{
 const s=f.db.prepare('SELECT * FROM episode_sources WHERE episode_id=?').get(id),other=publish(f,'outside');
 f.db.prepare('INSERT INTO episode_sources VALUES(?,?,?,?,?,?,?,?,?,?)').run('zzzz-outside',id,other,'outside','outside',s.digest,s.role,s.text,0,2);
 f.db.prepare('UPDATE session_episodes SET deleted=1 WHERE id=?').run(other);
});});

function rawRoot(f,id,representation='exact') {
 const s=f.db.prepare('SELECT s.*,e.client,e.session_key FROM episode_sources s JOIN session_episodes e ON e.id=s.origin_episode_id WHERE s.episode_id=?').get(id);
 const secret=f.db.prepare('SELECT secret FROM episode_identity').get().secret;
 const hmac=v=>createHmac('sha256',Buffer.from(secret,'hex')).update(JSON.stringify(v)).digest('hex');
 const session=representation==='exact'?s.session_key:'s1:'+hmac(['episode-v1',ns.ownerId,ns.scope,ns.projectId,s.client,s.session_key]),conversation=randomUUID();
 f.db.prepare('INSERT INTO raw_conversations VALUES(?,?,?,?,?,?,1,?,?)').run(conversation,ns.ownerId,ns.scope,ns.projectId,s.client,session,range.since,range.since);
 f.db.prepare("INSERT INTO raw_messages(conversation_id,message_id,ordinal,role,total_units,total_bytes,assembly_state,first_event_id) VALUES(?,?,1,?,?,?,'complete',?)").run(conversation,s.message_id,s.role,s.text.length,Buffer.byteLength(s.text),'raw-event');
 return {s,session,conversation,sourceKey:hmac(['raw-source-v1',s.role,s.text])};
}
// Controls: the base already enforces both Raw session aliases, ambiguity,
// map-known refusal and exact/whole-message exclusions.
for(const representation of ['exact','hashed'])for(const action of ['allow','fence','exact','whole','known','ambiguous','raw-fact'])test(`Episode projection Raw control: ${representation} ${action}`,async t=>{
 const f=await setup(t),id=publish(f,'raw','codex'),r=rawRoot(f,id,representation);
 if(action==='fence')f.db.prepare('INSERT INTO raw_session_fences VALUES(?,?,?,?,?)').run(ns.ownerId,ns.scope,ns.projectId,r.s.client,r.session);
 if(['exact','known'].includes(action))f.db.prepare("INSERT INTO raw_source_maps VALUES(?,?,?,?,?,'exact')").run(r.conversation,r.s.message_id,action==='known'?'other':r.sourceKey,0,4);
 if(['exact','whole'].includes(action))f.db.prepare('INSERT INTO raw_source_exclusions VALUES(?,?,?,?,1)').run(r.conversation,r.s.message_id,0,1);
 if(action==='ambiguous')rawRoot(f,id,representation==='exact'?'hashed':'exact');
 if(action==='raw-fact')transaction(f.db,()=>writeContentSuppressionInside(f.db,{namespace:ns,kind:'raw',key:r.conversation,matchMode:'span',messageId:r.s.message_id,start:0,end:1,reason:'privacy_erase',actionId:'raw-denial'}));
 for(const call of calls(f,id)){const result=call();assert.equal(result.ok,action==='allow',JSON.stringify(result));assert.doesNotMatch(JSON.stringify(result),/episode_read_proof|identity_secret|source_headers|sourceKey|identity_available|identityAvailable|key_present/);assert.ok(!JSON.stringify(result).includes(f.db.prepare('SELECT secret FROM episode_identity').get().secret));}
});
// Controls: metadata/output fields stay closed, including successful nextSteps.
test('Episode projection control: no internal proof or secret in output',async t=>{
 const f=await setup(t),id=publish(f),secret=f.db.prepare('SELECT secret FROM episode_identity').get().secret;
 for(const call of calls(f,id)){const r=ok(call());assert.doesNotMatch(JSON.stringify(r),/episode_read_proof|identity_secret|source_headers|sourceKey|identity_available|identityAvailable|key_present/);assert.ok(!JSON.stringify(r).includes(secret));}
});
// Control: a stale cursor must win over malformed later Episode evidence.
test('Episode projection control: stale cursor precedes malformed source',async t=>{
 const f=await setup(t);const id=publish(f,'first');publish(f,'second');
 // Keep the corrupted source on the later page, independent of random UUIDs.
 f.db.prepare('UPDATE session_episodes SET first_received_at=? WHERE id=?').run('2026-05-01T00:00:00.000Z',id);
 const cursor=ok(f.core.listEpisodes({namespace:ns,...range})).nextCursor;assert.ok(cursor);
 f.db.prepare('UPDATE namespace_epochs SET epoch=epoch+1').run();
 f.db.prepare('UPDATE episode_sources SET digest=? WHERE episode_id=?').run('0'.repeat(64),id);
 const r=f.core.listEpisodes({namespace:ns,...range,cursor});assert.equal(r.ok,false);assert.equal(r.error.code,'cursor_stale');
});
// Control: the receipt's canonical SHA256 identity is checked before facts.
test('Episode projection control: malformed matching receipt digest',async t=>{await refusal(t,(f,id)=>{
 const s=f.db.prepare('SELECT s.*,e.client,e.session_key FROM episode_sources s JOIN session_episodes e ON e.id=s.origin_episode_id WHERE s.episode_id=?').get(id);
 const m=ok(f.core.admit({namespace:ns,memory:{content:'Synthetic malformed receipt parent',kind:'fact'},receipts:[{client:s.client,sessionId:s.session_key,eventId:s.message_id,role:s.role,excerpt:'Synthetic different excerpt'}]})).memory;
 f.db.prepare('UPDATE receipts SET excerpt=? WHERE memory_id=?').run(s.text,m.id);
});});
// Control: a matching receipt's tombstoned parent denies even without a fact.
test('Episode projection control: deleted matching Memory parent',async t=>{await refusal(t,(f,id)=>{
 const s=f.db.prepare('SELECT s.*,e.client,e.session_key FROM episode_sources s JOIN session_episodes e ON e.id=s.origin_episode_id WHERE s.episode_id=?').get(id);
 const m=ok(f.core.admit({namespace:ns,memory:{content:'Synthetic deleted receipt parent',kind:'fact'},receipts:[{client:s.client,sessionId:s.session_key,eventId:s.message_id,role:s.role,excerpt:s.text}]})).memory;
 f.db.prepare('UPDATE memories SET deleted=1,content=NULL WHERE id=?').run(m.id);
});});
const rawPairs=new Map();
for(const family of costGateFamilies())for(const n of [12,24])test(`Episode nontrivial source cost v33 n${n}${costFamilyLabel(family,33)}`,async t=>{
 const records=[];
 for(const [safety,facts]of [[false,0],[true,0],[true,5]]) {
  const f=await setup(t,33,safety,family);let id;
  for(let i=0;i<n;i++){
   id=publish(f,'nontrivial-'+i,'codex');
   const s=f.db.prepare('SELECT s.*,e.client,e.session_key FROM episode_sources s JOIN session_episodes e ON e.id=s.origin_episode_id WHERE s.episode_id=?').get(id);
   const receipt={client:s.client,sessionId:s.session_key,eventId:s.message_id,role:s.role,excerpt:s.text};
   const m=ok(f.core.admit({namespace:ns,memory:{content:'Synthetic nontrivial parent '+i,kind:'fact'},receipts:[receipt]})).memory;
   const r=rawRoot(f,id,i%2?'hashed':'exact');
   f.db.prepare("INSERT INTO raw_source_maps VALUES(?,?,?,?,?,'exact')").run(r.conversation,r.s.message_id,r.sourceKey,0,4);
   // Include stored Raw ancestry for the matching receipt's Memory parent.
   const rid=f.db.prepare('SELECT id FROM receipts WHERE memory_id=?').get(m.id).id;
   f.db.prepare("INSERT OR IGNORE INTO raw_receipt_lineage VALUES(?,?,?,?,?,'exact')").run(rid,r.conversation,r.s.message_id,0,4);
  }
  if(facts)transaction(f.db,()=>{for(let i=0;i<facts;i++)writeContentSuppressionInside(f.db,{namespace:ns,kind:'memory',key:'unrelated-'+i,reason:'purge',actionId:'fact-'+i});});
  assertCostGateCell(f.db,33,safety,facts,ns.ownerId,{family,testName:t.name,n});
  const rows=[];
  for(const [method,input,variant]of [['getEpisode',{namespace:ns,episodeId:id},'hit'],['listEpisodes',{namespace:ns,...range},'hit'],['sessionStartContext',{namespace:ns,groups:{nextSteps:true,procedural:false}},'nextSteps']]){
   const row=await measureContentRead(method,variant,()=>f.core[method](input),f.ports);assert.equal(row.result.ok,true,JSON.stringify(row.result));rows.push(row);
  }
  assertCostGateCases('episode-nontrivial',rows);
  records.push({facts,rows});
 }
 for(const row of records[0].rows)assert.deepEqual([row.statements,row.begin,row.hostInvocations],counts.episodeLegacy.nontrivial[JSON.stringify([n,row.method])],'nontrivial legacy main pin');
 for(const current of records.slice(1))for(const [i,row]of current.rows.entries()){
  const old=records[0].rows[i],key=JSON.stringify([family,current.facts,row.method]);
  const small=rawPairs.get(key);if(n===12)rawPairs.set(key,[row,old]);
  await t.test(`${row.method} facts=${current.facts}`,()=>{
   assert.ok(row.statements<=old.statements+6+row.ports,'nontrivial R2-A1 ceiling '+key);
   assert.ok(row.begin<=old.begin,'nontrivial BEGIN '+key);assert.equal(row.ports,old.ports);
   if(family==='safety')assert.deepEqual([row.statements,row.begin,row.ports],counts.episodeNontrivial?.[JSON.stringify([n,current.facts,row.method])],'nontrivial downward exact pin');
   assertIntegratedCostPin(row,old,{family,base:33,n,facts:current.facts,testName:t.name});
  });
  if(n===24)await t.test(`${row.method} facts=${current.facts} paired slope`,()=>assert.ok(row.statements-row.ports-(small[0].statements-small[0].ports)<=old.statements-small[1].statements,'nontrivial paired slope net of E1'));
 }
 completeNontrivial(t.name);
});
// Control: list's lookahead row is validated even though it is not delivered.
test('Episode projection control: denied source on list lookahead',async t=>{
 const f=await setup(t),first=publish(f,'visible'),second=publish(f,'lookahead'),origin=publish(f,'denied-origin');
 for(const [id,time]of [[first,'2026-03-01T00:00:00.000Z'],[second,'2026-02-01T00:00:00.000Z'],[origin,'2026-01-01T00:00:00.000Z']])f.db.prepare('UPDATE session_episodes SET first_received_at=? WHERE id=?').run(time,id);
 f.db.prepare('UPDATE episode_sources SET origin_episode_id=? WHERE episode_id=?').run(origin,second);
 f.db.prepare('UPDATE session_episodes SET deleted=1 WHERE id=?').run(origin);
 const r=f.core.listEpisodes({namespace:ns,...range});assert.equal(r.ok,false);assert.equal(r.error.code,'revision_conflict');assert.doesNotMatch(JSON.stringify(r),/Synthetic/);
});

// Control: a missing identity secret is incomplete proof, never an empty Raw set.
test('Episode projection control: missing identity secret refuses',async t=>{
 const f=await setup(t),id=publish(f,'missing-identity','codex');rawRoot(f,id);
 f.db.prepare('DELETE FROM episode_identity WHERE singleton=1').run();
 for(const call of calls(f,id)){const r=call();assert.equal(r.ok,false);assert.doesNotMatch(JSON.stringify(r),/Synthetic/);}
});

// Controls: the public namespace boundary wins over malformed later evidence
// on all three surfaces, including Session nextSteps.
for(const malformed of ['overflow','missing-secret'])test(`Episode projection control: namespace denial before ${malformed}`,async t=>{
 const f=await setup(t),id=publish(f,'namespace-denial','codex');
 if(malformed==='overflow'){
  const s=f.db.prepare('SELECT * FROM episode_sources WHERE episode_id=?').get(id);
  for(let i=0;i<16;i++)f.db.prepare('INSERT INTO episode_sources VALUES(?,?,?,?,?,?,?,?,?,?)').run(randomUUID(),id,s.origin_episode_id,s.event_id,'extra-'+i,s.digest,s.role,s.text,s.truncated,s.ordinal);
 }else f.db.prepare('DELETE FROM episode_identity WHERE singleton=1').run();
 transaction(f.db,()=>writeContentSuppressionInside(f.db,{namespace:ns,kind:'namespace',matchMode:'namespace',reason:'privacy_erase',actionId:'deny-namespace'}));
 for(const call of calls(f,id)){const r=call();assert.equal(r.ok,false);assert.equal(r.error.code,'memory_not_found');}
});

// Controls: the old validator checks every origin, then matching receipt
// parents, before it needs the Raw identity secret.
for(const denial of ['origin','receipt'])test(`Episode projection control: ${denial} denial before missing secret`,async t=>{
 await refusal(t,(f,id)=>{
  if(denial==='origin'){
   const origin=publish(f,'deleted-origin');
   f.db.prepare('UPDATE episode_sources SET origin_episode_id=? WHERE episode_id=?').run(origin,id);
   f.db.prepare('UPDATE session_episodes SET deleted=1 WHERE id=?').run(origin);
  }else{
   const s=f.db.prepare('SELECT s.*,e.client,e.session_key FROM episode_sources s JOIN session_episodes e ON e.id=s.origin_episode_id WHERE s.episode_id=?').get(id);
   const m=ok(f.core.admit({namespace:ns,memory:{content:'Synthetic denied parent before identity',kind:'fact'},receipts:[{client:s.client,sessionId:s.session_key,eventId:s.message_id,role:s.role,excerpt:s.text}]})).memory;
   transaction(f.db,()=>writeContentSuppressionInside(f.db,{namespace:ns,kind:'memory',key:m.id,reason:'user_forget',actionId:'deny-before-identity'}));
  }
  f.db.prepare('DELETE FROM episode_identity WHERE singleton=1').run();
 },{client:'codex',code:denial==='origin'?'revision_conflict':'source_excluded'});
});

// Controls: native SQLite row materialization already refuses integers outside
// JavaScript's exact range. A JSON projection must retain that refusal.
for(const field of ['memory-revision','ancestry-span'])test(`Episode projection control: exact integer range ${field}`,async t=>{
 await refusal(t,(f,id)=>{
  const s=f.db.prepare('SELECT s.*,e.client,e.session_key FROM episode_sources s JOIN session_episodes e ON e.id=s.origin_episode_id WHERE s.episode_id=?').get(id);
  const m=ok(f.core.admit({namespace:ns,memory:{content:'Synthetic exact-range parent',kind:'fact'},receipts:[{client:s.client,sessionId:s.session_key,eventId:s.message_id,role:s.role,excerpt:s.text}]})).memory;
  if(field==='memory-revision')f.db.prepare('UPDATE memories SET revision=? WHERE id=?').run(9007199254740992n,m.id);
  else{
   const r=rawRoot(f,id),rid=f.db.prepare('SELECT id FROM receipts WHERE memory_id=?').get(m.id).id;
   f.db.prepare("INSERT INTO raw_receipt_lineage VALUES(?,?,?,?,?,'exact')").run(rid,r.conversation,r.s.message_id,9007199254740992n,9007199254740993n);
  }
 },{client:'codex'});
});

// Fix-round regressions replay against the staged predecessor, not main.
// 4096 is the control; 4097 failed before by refusing a clean Episode.
for(const facts of [4096,4097])test(`Episode fix F1: ${facts} unrelated facts retain indexed acceptance`,async t=>{
 const f=await setup(t),id=publish(f,'fact-boundary');
 transaction(f.db,()=>{for(let i=0;i<facts;i++)writeContentSuppressionInside(f.db,{namespace:ns,kind:'memory',key:'unrelated-'+i,reason:'purge',actionId:'boundary-'+i});});
 for(const call of calls(f,id))assert.equal(call().ok,true,'valid Episode remains available at '+facts+' facts');
});
async function projectionRows(f,query) {
 const {createEpisodeReadProjection}=await import('../episode-reads.mjs');
 const {installedContentLayout}=await import('../content-safety-schema.mjs');
 installedContentLayout(f.db);
 return transaction(f.db,()=>{
  const p=createEpisodeReadProjection({db:f.db,epoch:()=>1})(ns,query);
  return {rows:f.db.prepare(p.query.sql).all(...p.query.params),query:p.query};
 });
}
const selectEpisodes=()=>({sql:'SELECT * FROM session_episodes WHERE owner_id=? AND scope=? AND project_id=? AND deleted=0 ORDER BY id LIMIT 51',params:[ns.ownerId,ns.scope,ns.projectId]});
function materializedRows(rows) {
 let count=0;
 for(const row of rows)for(const s of JSON.parse(row.episode_read_proof)){
  count++;for(const r of s.receipts){count++;count+=r.ancestry.length;}
  for(const r of s.raw){count++;count+=r.maps.length;}
 }
 return count;
}
// F2 fail-before: the predecessor has no input bound and no incomplete marker.
// The no-match namespace must retain public acceptance via fallback.
for(const inputKind of ['memories','receipts'])test(`Episode fix F2: bounded ${inputKind} input before matching receipts`,async t=>{
 const f=await setup(t),id=publish(f,'no-match');
 const m=ok(f.core.admit({namespace:ns,memory:{content:'Synthetic namespace input',kind:'fact'},receipts:[receipt('unmatched')]})).memory;
 const columns=f.db.prepare('PRAGMA table_info(memories)').all().map(r=>r.name);
 const insert=f.db.prepare(`INSERT INTO memories(${columns.join(',')}) SELECT ${columns.map(c=>c==='id'?'?':c==='fingerprint'?'?':c).join(',')} FROM memories WHERE id=?`);
 transaction(f.db,()=>{
  if(inputKind==='memories')for(let i=0;i<4100;i++)insert.run('input-'+i,'fingerprint-'+i,m.id);
  else {
   const add=f.db.prepare('INSERT INTO receipts VALUES(?,?,?,?,?,?,?,?,?)');
   for(let i=0;i<4100;i++)add.run('input-receipt-'+i,m.id,sha('input-'+i),'unmatched','unmatched','input-'+i,'user','Synthetic unrelated receipt',range.since);
  }
 });
 const {rows}=await projectionRows(f,selectEpisodes());
 assert.equal(rows[0].episode_read_incomplete,1,'namespace input over bound explicitly requests fallback');
 const stats=JSON.parse(rows[0].episode_read_stats);
 assert.equal(stats.memories,inputKind==='memories'?4097:1,'LIMIT bounds examined Memory inputs, not matching receipts');
 assert.ok(stats.receipts<=4097);
 if(inputKind==='receipts')assert.equal(stats.receipts,4097,'receipt LIMIT also precedes identity matching');
 for(const call of calls(f,id))assert.equal(call().ok,true,'no truncated negative proof; old validator finishes');
});
// A complete proof at exactly 4096 charged rows is a control. More than 4096
// is a required refusal. F3 fail-before concerns bounded SQL materialization.
async function ancestryFixture(t,n,{fanout=false}={}) {
 const f=await setup(t),id=publish(f,'ancestry','codex'),root=rawRoot(f,id);
 const m=ok(f.core.admit({namespace:ns,memory:{content:'Synthetic shared parent',kind:'fact'},receipts:[{
  client:root.s.client,sessionId:root.s.session_key,eventId:root.s.message_id,role:root.s.role,excerpt:root.s.text}]})).memory;
 const rid=f.db.prepare('SELECT id FROM receipts WHERE memory_id=?').get(m.id).id;
 // Admission attached its whole-message anchor while the root still matched.
 // Replace it with exactly n controlled ancestry rows for boundary accounting.
 f.db.prepare('DELETE FROM raw_receipt_lineage WHERE receipt_id=?').run(rid);
 // Keep ancestry independent of a candidate Raw root, so the exact charge is
 // one source + one matching receipt + n ancestry rows.
 f.db.prepare('UPDATE raw_conversations SET session_key=? WHERE id=?').run('ancestry-only',root.conversation);
 f.db.prepare('UPDATE raw_messages SET total_units=?,total_bytes=? WHERE conversation_id=? AND message_id=?').run(n+100,n+100,root.conversation,root.s.message_id);
 transaction(f.db,()=>{
  const add=f.db.prepare("INSERT INTO raw_receipt_lineage VALUES(?,?,?,?,?,'exact')");
  for(let i=0;i<n;i++)add.run(rid,root.conversation,root.s.message_id,i,i+1);
  if(fanout){
   const source=f.db.prepare('SELECT * FROM episode_sources WHERE episode_id=?').get(id);
   const copy=f.db.prepare('INSERT INTO episode_sources VALUES(?,?,?,?,?,?,?,?,?,?)');
   const episodeCols=f.db.prepare('PRAGMA table_info(session_episodes)').all().map(r=>r.name);
   const clone=f.db.prepare(`INSERT INTO session_episodes(${episodeCols.join(',')}) SELECT ${episodeCols.map(c=>c==='id'?'?':c==='session_key'?'?':c).join(',')} FROM session_episodes WHERE id=?`);
   for(let e=0;e<13;e++){
    const target=e?'fanout-'+e:id;if(e)clone.run(target,'s1:'+sha('fanout-session-'+e),id);
    for(let i=e?0:1;i<16;i++)copy.run('fanout-source-'+e+'-'+i,target,id,source.event_id,source.message_id,source.digest,source.role,source.text,0,source.ordinal);
   }
  }
 });
 return {...f,id};
}
for(const n of [4094,4095])test(`Episode fix F3 control: shared proof rows ${n+2}`,async t=>{
 const f=await ancestryFixture(t,n),{rows}=await projectionRows(f,selectEpisodes());
 if(n===4094){assert.equal(materializedRows(rows),4096,JSON.stringify({stats:rows[0].episode_read_stats,overflow:rows[0].episode_read_overflow}));assert.equal(f.core.listEpisodes({namespace:ns,...range}).ok,true);}
 else {assert.ok(materializedRows(rows)<=4097,'no oversized nested evidence on overflow');assert.equal(f.core.listEpisodes({namespace:ns,...range}).ok,false);}
});
test('Episode fix F3: repeated ancestry is bounded across all candidates and sources',async t=>{
 const f=await ancestryFixture(t,80,{fanout:true}),{rows}=await projectionRows(f,selectEpisodes());
 assert.equal(rows.length,13);
 assert.ok(materializedRows(rows)<=4097,'aggregate nested materialization stays within the shared row allowance');
 const stats=JSON.parse(rows[0].episode_read_stats);
 assert.equal(stats.rows,4097,'enumeration stops at the first shared overflow witness');
 assert.equal(stats.sources,208);assert.equal(stats.parents,208);assert.equal(stats.ancestry,3681);
 assert.ok(rows.every(r=>r.episode_read_overflow===1));
 assert.equal(f.core.listEpisodes({namespace:ns,...range,limit:50}).ok,false);
});
// F4 fail-before on the staged projection, control on the original native path.
// The oversized ordinal is outside get's first source page (including lookahead).
for(const native of [true,false])test(`Episode fix F4: oversized source ordinal ${native?'native control':'projection'}`,async t=>{
 const f=await setup(t),id=publish(f,'ordinal'),s=f.db.prepare('SELECT * FROM episode_sources WHERE episode_id=?').get(id);
 f.db.prepare('UPDATE episode_sources SET id=? WHERE episode_id=?').run('a-first',id);
 f.db.prepare('UPDATE session_episodes SET record=replace(record,?,?) WHERE id=?').run(s.id,'a-first',id);
 for(const [key,ordinal]of [['b-lookahead',s.ordinal],['z-oversized',9007199254740992n]])f.db.prepare('INSERT INTO episode_sources VALUES(?,?,?,?,?,?,?,?,?,?)')
  .run(key,id,id,s.event_id,s.message_id,s.digest,s.role,s.text,0,ordinal);
 if(native){
  // The exact old native closure materialization, on a migrated layout.
  assert.throws(()=>f.db.prepare(`SELECT s.*,e.client AS origin_client,e.session_key AS origin_session,
    e.owner_id,e.scope,e.project_id,e.deleted FROM episode_sources s
    LEFT JOIN session_episodes e ON e.id=s.origin_episode_id WHERE s.episode_id=?`).all(id),
   e=>e.code==='ERR_OUT_OF_RANGE');
 }else for(const [i,call]of calls(f,id).entries())await t.test(['get','list','nextSteps'][i],()=>{
  assert.equal(call().ok,false,'unsafe source ordinal must refuse throughout the closure');
 });
});
// F5 fail-before: instrument the real metadata function entry, using a fresh
// module copy with the same native dependencies. No production callback seam.
for(const surface of ['list','get'])test(`Episode fix F5: ${surface} metadata receives only the closed Episode row`,async t=>{
 const f=await setup(t),id=publish(f,'metadata');
 const {createEpisodeReadProjection}=await import('../episode-reads.mjs');
 const {installedContentLayout}=await import('../content-safety-schema.mjs');installedContentLayout(f.db);
 const probe=Symbol.for('synthetic-episode-metadata-input');let seen=0;
 globalThis[probe]=row=>{
  seen++;assert.ok(Object.keys(row).every(k=>!/^episode_read_|proof|secret|source_headers|sourceKey|identity/.test(k)),
   'proof and secret fields must be stripped before metadata');
  assert.ok(!Object.values(row).includes('Synthetic private key'));
 };
 t.after(()=>delete globalThis[probe]);
 const load=async(name,change)=>{
  const url=new URL('../'+name,import.meta.url);
  const source=change(readFileSync(url,'utf8')).replace(/from '(\.\/[^']+)'/g,(_,p)=>"from '"+new URL(p,url).href+"'");
  return import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
 };
 const {createEpisodeReads}=await load('episode-reads.mjs',s=>s.replace('episodeMetadata,','episodeMetadata as baseEpisodeMetadata,')+
  "\nfunction episodeMetadata(ns,row){globalThis[Symbol.for('synthetic-episode-metadata-input')](row);return baseEpisodeMetadata(ns,row);}");
 const {createEpisodeStorage}=await load('episode-storage.mjs',s=>s.replace('export function episodeMetadata(ns, row) {',
  "export function episodeMetadata(ns, row) { globalThis[Symbol.for('synthetic-episode-metadata-input')](row);"));
 const epoch=()=>1,baseProjection=createEpisodeReadProjection({db:f.db,epoch});
 const episodeProjection=(namespace,q,expected)=>baseProjection(namespace,{...q,sql:`SELECT x.*,'Synthetic private key' AS identity_secret FROM (${q.sql}) x`},expected);
 const read=createEpisodeReads({db:f.db,epoch,episodeProjection,assertEpisodeRead(){}});
 if(surface==='list')read(ns,'listEpisodes',{...range,client:null},null);
 const storage=createEpisodeStorage({db:f.db,epoch,episodeProjection,assertEpisodeRead(){},stagedEvidence:{touch(){}}});
 if(surface==='get')storage.inspect(ns,{episodeId:id},Object.fromEntries(['source','memory','policy','keep'].map(k=>[k,{limit:1}])));
 assert.equal(seen,1,'the production metadata boundary was inspected');
});
// Controls on the staged predecessor: fallback must retain ancestry denials,
// including when neither the scoped fact set nor receipt input fits its cache.
for(const overflow of ['facts','namespace'])test(`Episode fix fallback control: denied ancestry with ${overflow} overflow`,async t=>{
 const f=await ancestryFixture(t,1);
 const anchor=f.db.prepare('SELECT conversation_id,message_id FROM raw_receipt_lineage LIMIT 1').get();
 transaction(f.db,()=>{
  if(overflow==='facts')for(let i=0;i<4096;i++)writeContentSuppressionInside(f.db,{namespace:ns,kind:'memory',key:'unrelated-'+i,reason:'purge',actionId:'fallback-'+i});
  else {
   const m=f.db.prepare('SELECT id FROM memories LIMIT 1').get(),columns=f.db.prepare('PRAGMA table_info(memories)').all().map(r=>r.name);
   const insert=f.db.prepare(`INSERT INTO memories(${columns.join(',')}) SELECT ${columns.map(c=>c==='id'?'?':c==='fingerprint'?'?':c).join(',')} FROM memories WHERE id=?`);
   for(let i=0;i<4100;i++)insert.run('fallback-input-'+i,'fallback-fingerprint-'+i,m.id);
  }
  writeContentSuppressionInside(f.db,{namespace:ns,kind:'raw',key:anchor.conversation_id,matchMode:'span',messageId:anchor.message_id,start:0,end:1,reason:'privacy_erase',actionId:'fallback-ancestry-denial'});
 });
 for(const call of calls(f,f.id))assert.equal(call().ok,false,'indexed completion preserves Raw ancestry denial');
});
