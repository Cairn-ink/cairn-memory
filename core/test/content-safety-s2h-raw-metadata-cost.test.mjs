import { assertCostGateCases, assertCostGateCell, assertCostGateCells, costGatePopulations, unmigratedCostOnly } from '../testing/content-safety-s2h-cost-inventory.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { openCostRawCaptureCore as openRawCaptureCore } from '../testing/content-safety-cost-hosts.mjs';
import { cardHost } from '../testing/raw-source-fixtures.mjs';
import { request, splitRaw, localPlainPort } from '../testing/raw-capture-fixtures.mjs';
import { safetyFixture, ns, ok } from '../testing/content-safety-s2h-fixture.mjs';
import { measureContentRead } from '../testing/content-safety-cost-meter.mjs';
import { transaction } from '../database.mjs';
import { writeContentSuppressionInside } from '../content-suppression-storage.mjs';
for(const n of [1,12])test(`R2 Raw metadata ${n} conversations, cursor and successful empty pages`,async t=>{
 const records=[];
 for(const [safety,facts]of costGatePopulations()) {
  const f=safetyFixture(t,33);if(safety)await f.migrate();const db=f.connect(),h=cardHost();
  const core=openRawCaptureCore({path:f.path,privateCards:h.options,model:{contextWindow:8192,countTokens:()=>1,extract:()=>({items:[]})}},
   {mode:'raw-v1',port:localPlainPort(),sources:true,readPolicy:()=>({generation:'synthetic',reason:null})});t.after(()=>{core.close();db.close();});
  let conversationId;
  for(let i=0;i<n;i++)conversationId=ok(await core.captureRaw(request(splitRaw('Synthetic retained metadata '+i)[0],{namespace:ns,client:'codex',sessionId:'metadata-'+i,eventId:'metadata-'+i}))).raw.conversationId;
  const expectedRevision=db.prepare('SELECT revision FROM raw_conversations WHERE id=?').get(conversationId).revision;
  if(facts)transaction(db,()=>{for(let i=0;i<facts;i++)writeContentSuppressionInside(db,{namespace:ns,kind:'memory',key:'unrelated-'+i,reason:'purge',actionId:'fact-'+i});});
  assertCostGateCell(db,33,safety,facts,ns.ownerId,{testName:t.name,n});
  const other={...ns,scope:'project',projectId:'absent'};
  const cases=[['getRawUsage',{ownerId:ns.ownerId},'hit'],['getRawUsage',{ownerId:'absent-owner'},'absent'],['listRawConversations',{namespace:ns,client:'codex',limit:1},'hit'],
   ['listRawConversations',{namespace:other,client:'codex',limit:1},'absent'],['previewDeleteConversation',{namespace:ns,conversationId,expectedRevision},'hit'],['listRawEffects',{namespace:ns},'empty-effects']];
  if(n>1){const first=ok(core.listRawConversations({namespace:ns,client:'codex',limit:1}));assert.ok(first.nextCursor);cases.push(['listRawConversations',{namespace:ns,client:'codex',limit:1,cursor:first.nextCursor},'cursor']);}
  const measured=[];
  for(const [method,input,variant]of cases){const row=await measureContentRead(method,variant,()=>core[method](input));assert.equal(row.result.ok,true,method+' '+JSON.stringify(row.result));
   if(variant==='absent'){if(method==='getRawUsage'){assert.equal(row.result.value.savedBytes,0);assert.ok(row.result.value.clients.every(c=>c.conversationCount===0));}else assert.deepEqual(row.result.value.conversations,[]);}
   if(variant==='empty-effects')assert.deepEqual(row.result.value.effects,[]);
   measured.push({...row,result:undefined});
  }
  assert.deepEqual(measured.map(r=>[r.method,r.variant]),cases.map(([m,,v])=>[m,v]));assertCostGateCases('raw-metadata-'+n,measured);records.push({safety,facts,n,records:measured});
 }
 t.diagnostic('R3_RAW_METADATA_COUNTS '+JSON.stringify(records));
 if(assertCostGateCells(records))return;
 const [legacy,zero,five]=records;
 for(const current of [zero,five])for(const [i,row]of current.records.entries()){
  const old=legacy.records[i];assert.equal(row.begin,old.begin);
  const expected=row.method==='getRawUsage'?(row.variant==='absent'?5:current.facts?6:5):current.facts?6:4;
  assert.equal(row.statements-old.statements,expected,row.method+' '+row.variant);
 }
});
