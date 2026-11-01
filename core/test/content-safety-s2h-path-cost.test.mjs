import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const probe=fileURLToPath(new URL('../testing/content-safety-s2h-path-cost-probe.mjs',import.meta.url));
const frozen=JSON.parse(readFileSync(new URL('./fixtures/content-safety-s2h-path-counts.json',import.meta.url),'utf8'));
const cache=new Map(),observedFrozenKeys=new Set();
function measure(kind,v,n,facts=0,absent=false,mode='lexical',limit=12) {
 const key=JSON.stringify([...arguments]);if(cache.has(key))return cache.get(key);
 const child=spawnSync(process.execPath,[probe,kind,String(v),String(n),String(facts),absent?'absent':'match',mode,String(limit)],{encoding:'utf8',timeout:120000,maxBuffer:16*1024*1024});
 assert.equal(child.status,0,child.stderr+'\n'+child.stdout.slice(-5000));
 const emitted=child.stdout.split('\n').filter(s=>s.startsWith('{')).map(s=>JSON.parse(s));
 const identities={memory:['scope.get','scope.list','scope.search','sourceSnapshot','get','list','map','fetch','recall','session'],topic:['readTopicMembers','readTopicOverview'],card:['getCard','listCards'],raw:['getConversation:1','getConversation:4']};
 if(['context','status'].includes(kind)){
  const expected=['current-first','current-repeat','history-first','history-repeat'];
  assert.deepEqual(emitted.filter(r=>r.phase==='query').map(r=>r.label).sort(),expected.sort(),'exact context method/case/cell records');
  for(const row of emitted.filter(r=>r.phase==='query'))assert.equal(row.method,kind==='context'?'contextRead':'getContextIndexStatus');
 } else assert.deepEqual(emitted.map(r=>kind==='raw'?r.method+':'+r.limit:r.method).sort(),identities[kind].toSorted(),'exact public method/case/cell records');
 const rows=emitted.filter(r=>r.phase===undefined||r.phase==='query');
 if(absent)for(const row of rows){
  if(kind==='status')continue;
  if(kind==='memory'&&row.method==='get'){assert.equal(row.ok,false);assert.equal(row.error,'memory_not_found');continue;}
  assert.equal(row.ok,true,'no-hit read succeeds: '+JSON.stringify(row));assert.equal(row.empty,true,'correctly empty no-hit DTO: '+JSON.stringify(row));
 }

 const result=rows.map(r=>({...r,statements:r.totalExecuted??r.total??r.count,begin:r.begin??r.begins??r.sqlSummary?.filter(s=>/^BEGIN/.test(s.sql)).reduce((n,s)=>n+s.exec,0)}));
 assert.ok(result.length);for(const row of result)assert.equal(row.node,process.version);cache.set(key,result);return result;
}
for(const [v,base] of [[34,18],[38,23],[48,33]])for(const kind of ['topic','memory','context','status',...(v===34?[]:['card']),...(v===48?['raw']:[])]) {
 test(`R2 all paths v${v} ${kind}: exact counts and BEGIN, constant zero-fact overhead`,async t=>{
  await new Promise(setImmediate);
  const sizes=kind==='topic'?[12,24,300,600]:kind==='memory'?[6,12,24,300]:kind==='card'?[1,4]:kind==='raw'?[1]:kind==='status'?[24]:[24,300,600];
  const records=[];
  for(const n of sizes)for(const mode of kind==='context'?['lexical','semantic']:['lexical'])for(const limit of kind==='memory'?[1,12,24]:kind==='context'?[1,12]:[12]) {
   const legacy=measure(kind,base,n,0,false,mode,limit),current=measure(kind,v,n,0,false,mode,limit);
   assert.equal(current.length,legacy.length);
   for(const row of [...legacy,...current]){if(kind==='memory'&&row.method==='sourceSnapshot'&&row.case==='overflow'){assert.equal(row.ok,false);assert.equal(row.error,'context_item_too_large');}else assert.notEqual(row.ok,false,JSON.stringify(row));}
   for(const [i,row]of current.entries()) {
    const old=legacy[i],ports=kind==='raw'?row.opened:kind==='context'?row.counterCalls:row.portCalls??0;
    if(kind==='memory'){
     assert.equal(row.portCalls,old.portCalls,'safety adds no counter/provider invocations');
     assert.equal(row.portCalls,row.counterCalls+row.providerCalls,'all caller invocations are counted');
     const count=re=>row.safety.filter(s=>re.test(s.q)).reduce((n,s)=>n+s.c,0);
     const proofs=row.case==='overflow'?3:2;
     assert.equal(count(/SELECT schema_version AS cookie/),proofs,'exact entry/delivery/refusal proofs: '+JSON.stringify({method:row.method,n,limit}));
     assert.equal(count(/^SELECT epoch_hi,epoch_lo FROM owner_suppression_epochs/),ports+proofs,'one epoch per actual caller invocation, plus fixed entry/delivery/refusal proofs');
    }
    if(kind==='context'){
     const epochs=row.sqlSummary.filter(s=>/SELECT epoch_hi,epoch_lo FROM owner_suppression_epochs WHERE owner_id=\?/.test(s.sql)).reduce((n,s)=>n+s.executions,0);
     const headers=row.sqlSummary.filter(s=>/SELECT schema_version AS cookie/.test(s.sql)).reduce((n,s)=>n+s.executions,0);
     assert.equal(epochs,ports+2,'one epoch per counter invocation, plus entry and delivery');assert.equal(headers,2,'no per-port header reads');
     const observations=row.safetyTrace.filter(s=>/FROM owner_suppression_epochs/.test(s.sql));
     assert.equal(observations[0].transaction,true,'the proof is inside the existing read transaction');
     assert.ok(observations.slice(1,ports+1).every(s=>s.transaction===false),'post-counter observations use fresh autocommit snapshots');
    }
    records.push({v,base,kind,n,mode,limit,method:row.kind??(kind==='raw'?row.limit:['context','status'].includes(kind)?row.method+':'+row.label:row.method),case:row.case,...(kind==='memory'&&row.method==='recall'?{legacyHeaders:old.safety.filter(s=>/SELECT schema_version AS cookie/.test(s.q)).reduce((n,s)=>n+s.c,0)}:{}),legacy:[old.statements,old.begin],after:[row.statements,row.begin],ports});
   }
  }
  t.diagnostic('R2_PATH_COUNTS '+JSON.stringify(records));
  for(const row of records){
   const key=JSON.stringify([row.kind,row.v,row.n,row.mode,row.limit,row.method??null]);
   observedFrozenKeys.add(key);
   assert.deepEqual([row.legacy,row.after,row.ports],frozen.zero[key],'exact statement, BEGIN and port counts: '+key);
   const delta=row.after[0]-row.legacy[0]-row.ports;assert.ok(row.after[0]<=row.legacy[0]+6+row.ports,'R2-A1 same-engine ceiling, e9 11-01 17:15: '+JSON.stringify(row));
   if(row.legacyHeaders!==undefined)assert.equal(delta+row.legacyHeaders,4,'recall replaces legacy repeated header reads with four fixed proof/fence statements');
   if(row.method==='recall'||kind==='topic')assert.ok(row.after[1]<=row.legacy[1],'R2-A1 BEGIN <= same-engine legacy: '+JSON.stringify(row));
   else assert.equal(row.after[1],row.legacy[1],JSON.stringify(row));}
  // Port count is fixed by assembly: two counts per selected body/source plus
  // two whole-assembly counts, with a final retained-payload count.
  if(kind==='context')for(const row of records)assert.equal(row.ports,4*row.limit+2,'safety adds no counter invocations');
  // n12/n24 is the paired per-item fixture. Every other population retains
  // its exact pin and ceiling; compare its overhead with E1 separated.
  const corpus=new Map();for(const row of records){if(row.method!=='recall'&&kind!=='topic')continue;const key=JSON.stringify([row.method,row.mode,row.case,row.limit]);const net=row.after[0]-row.legacy[0]-row.ports;if(corpus.has(key))assert.ok(net<=corpus.get(key),'R2-A1 non-E1 corpus overhead does not grow: '+JSON.stringify(row));corpus.set(key,net);}
  const group=new Map();for(const row of records){const r2a1=row.method==='recall'||kind==='topic';if(r2a1&&![12,24].includes(row.n))continue;const key=JSON.stringify([row.method,row.mode,row.case,...(r2a1?[row.limit]:[])]);const delta=row.after[0]-row.legacy[0]-(r2a1?0:row.ports);if(group.has(key)){if(row.method==='recall'||kind==='topic')assert.ok(delta<=group.get(key),'R2-A1 slope <= same-engine legacy, e9 11-01 17:15: '+JSON.stringify(row));else assert.equal(delta,group.get(key),'zero per-item/corpus delta');}group.set(key,delta);}
 });
}

for(const v of [34,38,48])for(const kind of ['topic','memory','context',...(v===34?[]:['card']),...(v===48?['raw']:[]),'status'])
test(`R2 all paths v${v} ${kind}: five-fact slope and corpus-independent no-hit`,async t=>{
 await new Promise(setImmediate);
 const sizes=kind==='card'?[1,4]:kind==='memory'?[12,24]:kind==='raw'?[1,4]:[300,600];
 const records=[];
 for(const [index,n]of sizes.entries())for(const absent of [false,true])for(const mode of kind==='context'?['lexical','semantic']:['lexical']) {
  const limit=kind==='memory'?(index===0?12:24):12;
  const corpus=kind==='memory'&&absent?(index===0?300:600):n;
  const rows=measure(kind,v,corpus,5,absent,mode,limit);
  const zero=measure(kind,v,corpus,0,absent,mode,limit);
  if(!absent)for(const row of rows){if(kind==='memory'&&row.method==='sourceSnapshot'&&row.case==='overflow'){assert.equal(row.ok,false);assert.equal(row.error,'context_item_too_large');}else assert.notEqual(row.ok,false,JSON.stringify(row));}
  for(const [i,row]of rows.entries())records.push({n,absent,mode,method:row.kind??(kind==='raw'?row.limit:['context','status'].includes(kind)?row.method+':'+row.label:row.method)??kind,
   five:[row.statements,row.begin],zero:[zero[i].statements,zero[i].begin],ports:row.opened??row.portCalls??row.counterCalls??0});
 }
 t.diagnostic('R2_PATH_FACT_COUNTS '+JSON.stringify({v,kind,records}));
 if(kind==='raw')assert.equal(new Set(records.filter(r=>!r.absent).map(r=>r.five[0]-r.zero[0])).size,1,'five facts add no per-opened-part growth');
 const methods=new Set(records.map(r=>JSON.stringify([r.method,r.mode])));
 for(const key of methods){
  const [method,mode]=JSON.parse(key);
  const hit=records.filter(r=>!r.absent&&r.method===method&&r.mode===mode),miss=records.filter(r=>r.absent&&r.method===method&&r.mode===mode);
  assert.equal(hit.length,2);assert.equal(miss.length,2);
  assert.equal(hit[1].five[0]-hit[0].five[0],hit[1].zero[0]-hit[0].zero[0],JSON.stringify({method,hit}));
  assert.equal(miss[0].five[0],miss[1].five[0],JSON.stringify({method,miss}));
  assert.equal(miss[0].five[1],miss[1].five[1]);
 }
});

test('R2 path inventory has exactly the complete frozen method/case/cell key set',()=>{
 assert.deepEqual([...observedFrozenKeys].sort(),Object.keys(frozen.zero).sort(),'no omitted version, method, case or stale frozen record');
});
