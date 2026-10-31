import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const probe=fileURLToPath(new URL('../testing/content-safety-s2h-path-cost-probe.mjs',import.meta.url));
const frozen=JSON.parse(readFileSync(new URL('./fixtures/content-safety-s2h-path-counts.json',import.meta.url),'utf8'));
const cache=new Map();
function measure(kind,v,n,facts=0,absent=false,mode='lexical',limit=12) {
 const key=JSON.stringify([...arguments]);if(cache.has(key))return cache.get(key);
 const child=spawnSync(process.execPath,[probe,kind,String(v),String(n),String(facts),absent?'absent':'match',mode,String(limit)],{encoding:'utf8',timeout:120000,maxBuffer:16*1024*1024});
 assert.equal(child.status,0,child.stderr+'\n'+child.stdout.slice(-5000));
 const rows=child.stdout.split('\n').filter(s=>s.startsWith('{')).map(s=>JSON.parse(s)).filter(r=>r.phase===undefined||r.label==='current-repeat');
 const result=rows.map(r=>({...r,statements:r.totalExecuted??r.total??r.count,begin:r.begin??r.begins??r.sqlSummary?.filter(s=>/^BEGIN/.test(s.sql)).reduce((n,s)=>n+s.exec,0)}));
 assert.ok(result.length);for(const row of result)assert.equal(row.node,process.version);cache.set(key,result);return result;
}
for(const [v,base] of [[34,18],[38,23],[48,33]])for(const kind of ['topic','memory','context','status',...(v===34?[]:['card']),...(v===48?['raw']:[])]) {
 test(`R2 all paths v${v} ${kind}: exact counts and BEGIN, constant zero-fact overhead`,async t=>{
  await new Promise(setImmediate);
  const sizes=kind==='topic'?[12,24,300,600]:kind==='memory'?[12,24,300]:kind==='card'?[1,4]:kind==='raw'?[1]:kind==='status'?[24]:[24,300,600];
  const records=[];
  for(const n of sizes)for(const mode of kind==='context'?['lexical','semantic']:['lexical'])for(const limit of kind==='memory'?[1,12,24]:kind==='context'?[1,12]:[12]) {
   const legacy=measure(kind,base,n,0,false,mode,limit),current=measure(kind,v,n,0,false,mode,limit);
   assert.equal(current.length,legacy.length);
   for(const row of [...legacy,...current])assert.notEqual(row.ok,false,JSON.stringify(row));
   for(const [i,row]of current.entries()) {
    const old=legacy[i],ports=kind==='raw'?row.opened:kind==='context'?row.counterCalls:row.portCalls??0;
    if(kind==='memory')assert.equal(row.portCalls,old.portCalls,'safety adds no session counter invocations');
    if(kind==='context'){
     const epochs=row.sqlSummary.filter(s=>/SELECT epoch_hi,epoch_lo FROM owner_suppression_epochs WHERE owner_id=\?/.test(s.sql)).reduce((n,s)=>n+s.executions,0);
     const headers=row.sqlSummary.filter(s=>/SELECT schema_version AS cookie/.test(s.sql)).reduce((n,s)=>n+s.executions,0);
     assert.equal(epochs,ports+2,'one epoch per counter invocation, plus entry and delivery');assert.equal(headers,2,'no per-port header reads');
     const observations=row.safetyTrace.filter(s=>/FROM owner_suppression_epochs/.test(s.sql));
     assert.equal(observations[0].transaction,true,'the proof is inside the existing read transaction');
     assert.ok(observations.slice(1,ports+1).every(s=>s.transaction===false),'post-counter observations use fresh autocommit snapshots');
    }
    records.push({v,base,kind,n,mode,limit,method:row.method??row.kind??row.limit,legacy:[old.statements,old.begin],after:[row.statements,row.begin],ports});
   }
  }
  t.diagnostic('R2_PATH_COUNTS '+JSON.stringify(records));
  for(const row of records){
   const key=JSON.stringify([row.kind,row.v,row.n,row.mode,row.limit,row.method??null]);
   assert.deepEqual([row.legacy,row.after,row.ports],frozen.zero[key],'exact statement, BEGIN and port counts: '+key);
   const delta=row.after[0]-row.legacy[0]-row.ports;assert.ok(delta<=6,JSON.stringify(row));assert.equal(row.after[1],row.legacy[1],JSON.stringify(row));}
  // Port count is fixed by assembly: two counts per selected body/source plus
  // two whole-assembly counts, with a final retained-payload count.
  if(kind==='context')for(const row of records)assert.equal(row.ports,4*row.limit+2,'safety adds no counter invocations');
  const group=new Map();for(const row of records){const key=JSON.stringify([row.method,row.mode]);const delta=row.after[0]-row.legacy[0]-row.ports;if(group.has(key))assert.equal(delta,group.get(key),'zero per-item/corpus delta');else group.set(key,delta);}
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
  if(!absent)for(const row of rows)assert.notEqual(row.ok,false,JSON.stringify(row));
  for(const [i,row]of rows.entries())records.push({n,absent,mode,method:row.method??row.kind??row.limit??kind,
   five:[row.statements,row.begin],zero:[zero[i].statements,zero[i].begin],ports:row.opened??row.counterCalls??row.portCalls??0});
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
