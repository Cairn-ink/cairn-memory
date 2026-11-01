import { assertCostGateCases } from './content-safety-s2h-cost-inventory.mjs';
// Run the existing cost fixtures against one production revision. The native
// fixture seam selects legacy populations; child probes keep their usual inputs.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
export const nativeCostFiles = ['card','catalog','context','cursor','embedded-semantic','embedded-local-guard','metadata','raw-metadata','role','runtime','port']
 .map(name=>'core/test/content-safety-s2h-'+name+'-cost.test.mjs');
const root=fileURLToPath(new URL('../../',import.meta.url));
export const nativeCostKey = row => JSON.stringify(['native',row.testName,row.base,row.n??null,row.semantic??null,row.method,row.variant]);
export const childCostKey = (job,row) => JSON.stringify(['child',job,row.method,row.variant??row.label??row.kind??row.limit??null,row.case??null]);
export const costTriple = row => [row.statements??row.totalExecuted??row.total??row.count,
 row.begin??row.begins??row.sqlSummary?.filter(s=>/^BEGIN/.test(s.sql)).reduce((n,s)=>n+(s.exec??s.executions),0),
 row.hostInvocations];
function child(args,extraEnv={}) {
 const env={...process.env,...extraEnv};delete env.NODE_TEST_CONTEXT;
 const result=spawnSync(process.execPath,args,{cwd:root,env,encoding:'utf8',timeout:1800000,maxBuffer:128*1024*1024});
 assert.equal(result.error,undefined,'unmigrated probe execution');assert.equal(result.signal,null,'unmigrated probe signal');
 assert.equal(result.status,0,'unmigrated probe exit: '+JSON.stringify(args)+'\n'+result.stderr+'\n'+result.stdout.slice(-12000));
 return result.stdout;
}
function assertProbeCases(job,rows) {
 const file=job.args[0],kind=job.args[1];
 if(file.endsWith('/content-safety-s2h-topic-cost-probe.mjs')){
  assertCostGateCases('topic-public-'+(job.args[4]==='absent'?'absent':'hit'),rows);return;
 }
 if(file.endsWith('/content-safety-s2h-cost-probe.mjs')){
  const cursor=job.args[5]!=='absent'&&Number(job.args[2])>12;
  assert.deepEqual(rows.map(r=>[r.method,r.label]),['current-first','current-repeat',...(cursor?['current-cursor']:[]),'history-first','history-repeat',...(cursor?['history-cursor']:[])].map(label=>['findCandidates',label]),'exact product query cases: '+job.id);return;
 }
 if(kind==='evidence'||kind==='maintenance'){
  assertCostGateCases(kind==='evidence'?'product-evidence':'product-maintenance',rows);return;
 }
 const expected={memory:['scope.get','scope.list','scope.search','sourceSnapshot','get','list','map','fetch','recall','session'],topic:['readTopicMembers','readTopicOverview'],card:['getCard','listCards'],raw:['getConversation:1','getConversation:4']};
 if(kind==='context'||kind==='status')assert.deepEqual(rows.map(r=>[r.method,r.label]),['current-first','current-repeat','history-first','history-repeat'].map(label=>[kind==='context'?'contextRead':'getContextIndexStatus',label]),'exact context cases: '+job.id);
 else assert.deepEqual(rows.map(r=>kind==='raw'?r.method+':'+r.limit:r.method).sort(),expected[kind].toSorted(),'exact method cases: '+job.id);
 for(const row of rows){
  if(kind==='memory'&&job.args[5]!=='absent'&&Number(job.args[3])===600&&['sourceSnapshot','map','recall','session'].includes(row.method)){
   assert.equal(row.ok,false,'existing bounded index refusal: '+job.id+' '+row.method);
   assert.equal(row.error,'index_unavailable','same refusal as both main engines: '+job.id+' '+row.method);continue;
  }
  if(kind==='memory'&&row.method==='get'&&job.args[5]==='absent'){assert.equal(row.ok,false);assert.equal(row.error,'memory_not_found');continue;}
  if(kind==='memory'&&row.method==='sourceSnapshot'&&row.case==='overflow'){assert.equal(row.ok,false);// The existing sourceSnapshot population bound refuses the 600-row fixture
   // before its per-request limit check; both main engines have this result.
   assert.equal(row.error,Number(job.args[3])===600?'index_unavailable':'context_item_too_large','exact bounded sourceSnapshot refusal: '+job.id);continue;}
  assert.equal(row.ok,true,'successful probe: '+job.id+' '+row.method);
  if(job.args[5]==='absent'&&kind!=='status')assert.equal(row.empty,true,'correctly empty unmigrated result: '+job.id+' '+row.method);
 }
}
export function collectUnmigratedCosts(jobs,outcomes) {
 const records=[],seen=new Set();
 const add=(key,row)=>{assert.ok(!seen.has(key),'duplicate unmigrated cell: '+key);seen.add(key);const counts=costTriple(row);assert.ok(counts.every(Number.isSafeInteger),'all three costs are measured: '+key);assert.ok(counts[2]>=(row.ports??row.portCalls??row.opened??row.counterCalls??0),'all E1 ports are included in the host census: '+key);records.push({key,counts});};
 const output=child(['--test','--test-concurrency=1','--test-reporter=tap','--test-name-pattern=^(?!R2 product )',...nativeCostFiles],{CAIRN_S2H_UNMIGRATED_ONLY:'1',CAIRN_S2H_CELL_REPORT:'1'});
 for(const line of output.split('\n'))if(line.startsWith('# {"tag":"R3_NATIVE_CELL"')){
  const row=JSON.parse(line.slice(2));assert.equal(row.node,process.version);assert.equal(row.safety,false);assert.equal(row.facts,0);add(nativeCostKey(row),row);
 }
 for(const job of jobs){
  const output=child(job.args,{CAIRN_S2H_UNMIGRATED_ONLY:'0',CAIRN_S2H_CELL_REPORT:'0'});
  const rows=output.split('\n').filter(s=>s.startsWith('{')).map(s=>JSON.parse(s))
   .filter(row=>row.tag!=='R3_NATIVE_CELL'&&[undefined,'query','maintenance'].includes(row.phase));
  assert.ok(rows.length,'nonempty probe: '+job.id);assertProbeCases(job,rows);
  for(const row of rows){assert.equal(row.node,process.version);const key=childCostKey(job.id,row);
   assert.ok(Object.hasOwn(outcomes,key),'pinned main outcome: '+key);
   assert.deepEqual([row.ok??null,row.error??null,row.empty??null],outcomes[key],'same success/refusal/empty result as main: '+key);add(key,row);}
 }
 return records.toSorted((a,b)=>a.key<b.key?-1:a.key>b.key?1:0);
}
