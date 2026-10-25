import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,writeFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {Ledger} from '../ledger.mjs';
import {GuardedTransport,FakeTransport} from '../transport.mjs';
import {responseRequest} from '../requests.mjs';
import {hash,canonical} from '../common.mjs';
import {plan} from './fixtures.mjs';

function scratch(t){const dir=mkdtempSync('evaluation/hr3/harness/artifacts/recheck-test-');t.after(()=>rmSync(dir,{recursive:true,force:true}));return dir;}
const request=id=>({id,operation:'reader',body:responseRequest('reader',{})});
for(const defect of ['deleted','empty','valid-prefix','configuration-replaced','configuration-missing'])test('recheck ledger '+defect+' stops before reservation and dispatch',async t=>{
 const path=join(scratch(t),'ledger.jsonl'),ledger=new Ledger(path,{plan});
 const prefix=readFileSync(path);ledger.reserve(request('accepted'));const before=readFileSync(path);
 if(defect==='deleted')rmSync(path);
 else if(defect==='empty')writeFileSync(path,'');
 else if(defect==='valid-prefix')writeFileSync(path,prefix);
 else {
  const events=before.toString().trim().split('\n').map(JSON.parse);
  if(defect==='configuration-replaced')events[0].configuration.limits.operational--;
  else events.shift();
  let prior='';writeFileSync(path,events.map(({digest,...data})=>{const e={...data,prior};prior=hash(e);return canonical({...e,digest:prior});}).join('\n')+'\n');
 }
 const damaged=existsSync(path)?readFileSync(path):null;let calls=0;
 const guard=new GuardedTransport({async send(r){calls++;return new FakeTransport().send(r);}},ledger);
 await assert.rejects(guard.send(request('blocked')),/accounting_mismatch:ledger_/);
 assert.equal(calls,0);assert.throws(()=>ledger.reserve(request('also-blocked')),/ledger_/);
 assert.deepEqual(existsSync(path)?readFileSync(path):null,damaged,'must not append a reservation to damaged evidence');
});

test('recheck ledger durable head rejects a valid-prefix rollback after restart',t=>{
 const path=join(scratch(t),'ledger.jsonl'),ledger=new Ledger(path,{plan}),prefix=readFileSync(path);
 ledger.reserve(request('accepted'));writeFileSync(path,prefix);
 assert.throws(()=>new Ledger(path,{plan}),/ledger_/);
});

for(const defect of ['head-missing','head-stale','restored-after-rejection'])test('recheck ledger '+defect+' cannot clear an accepted stop',async t=>{
 const path=join(scratch(t),'ledger.jsonl'),ledger=new Ledger(path,{plan}),head=readFileSync(path+'.head.json');
 ledger.reserve(request('accepted'));const journal=readFileSync(path);
 if(defect==='head-missing')rmSync(path+'.head.json');
 else if(defect==='head-stale')writeFileSync(path+'.head.json',head);
 else {rmSync(path);assert.throws(()=>ledger.snapshot(),/ledger_journal_missing/);assert.equal(JSON.parse(readFileSync(path+'.head.json')).blockedReason,undefined);assert.throws(()=>ledger.reserve(request('persist-missing-journal')),/ledger_journal_missing/);writeFileSync(path,journal);}
 let calls=0;const guard=new GuardedTransport({async send(){calls++;}},ledger);
 await assert.rejects(guard.send(request('blocked')),/accounting_mismatch:ledger_/);assert.equal(calls,0);
 assert.throws(()=>new Ledger(path,{plan}),/ledger_/);
});
test('recheck ledger valid forward progress survives restart with the same durable head',t=>{
 const path=join(scratch(t),'ledger.jsonl'),ledger=new Ledger(path,{plan});ledger.reserve(request('one'));
 const restarted=new Ledger(path,{plan});restarted.reserve(request('two'));
 assert.deepEqual(ledger.snapshot(),restarted.snapshot());assert.equal(ledger.snapshot().reservations,2);
 const head=JSON.parse(readFileSync(path+'.head.json'));assert.equal(head.bytes,readFileSync(path).length);assert.equal(head.head,ledger.read().at(-1).digest);assert.equal(head.records,ledger.read().length);
});

import {spawnSync} from 'node:child_process';
import {mkdirSync} from 'node:fs';
const depsURL=new URL('../dependencies.mjs',import.meta.url).href;
for(const kind of ['mcp','tokenizer'])test('recheck dependencies: unapproved '+kind+' installation is rejected before import or journal',t=>{
 const dir=scratch(t),root=join(dir,'node_modules'),pkg=kind==='tokenizer'?'tiktoken':'zod',specifier=kind==='tokenizer'?'tiktoken':'zod/v4',marker=join(dir,'IMPORTED');mkdirSync(join(root,pkg),{recursive:true});
 writeFileSync(join(root,pkg,'package.json'),JSON.stringify({type:'module',exports:kind==='tokenizer'? './index.mjs':{'./v4':'./index.mjs'}}));
 writeFileSync(join(root,pkg,'index.mjs'),`import {writeFileSync} from 'node:fs';writeFileSync(${JSON.stringify(marker)},'imported');export default {};`);
 const old=process.env.HR3_RECHECK_OLD_DEPENDENCIES?readFileSync(new URL('./fixtures/dependencies-feb05af6.mjs.txt',import.meta.url),'utf8'):null;
 const source=`import assert from 'node:assert/strict';import {existsSync} from 'node:fs';import {registerHooks} from 'node:module';import {pathToFileURL} from 'node:url';import {resolve} from 'node:path';
 ${old?old.replace(/^import .*\n/gm,'').replace('export function useInstalledDependencies','function useInstalledDependencies').replace('export async function tokenCounter','async function tokenCounter'):`import {useInstalledDependencies} from ${JSON.stringify(depsURL)};`}
 let blocked=false;try{useInstalledDependencies({${kind}:${JSON.stringify(root)}});}catch(error){assert.match(error.message,/unapproved_dependency_path/);blocked=true;}
 if(!blocked)await import(${JSON.stringify(specifier)});
 console.log(JSON.stringify({blocked,imported:existsSync(${JSON.stringify(marker)}),journalCreated:existsSync(${JSON.stringify(join(dir,'ledger.jsonl'))})}));
 assert.equal(blocked,true);assert.equal(existsSync(${JSON.stringify(marker)}),false);assert.equal(existsSync(${JSON.stringify(join(dir,'ledger.jsonl'))}),false);`;
 const r=spawnSync(process.execPath,['--input-type=module','-e',source],{encoding:'utf8'});assert.equal(r.status,0,r.stdout+"\n"+r.stderr);
});
test('recheck dependencies: runner rejects a foreign resolver before creating its output directory',t=>{
 const dir=scratch(t),foreign=join(dir,'foreign.mjs'),marker=join(dir,'IMPORTED'),out=join(dir,'out');writeFileSync(foreign,`import {writeFileSync} from 'node:fs';writeFileSync(${JSON.stringify(marker)},'bad');`);
 const source=`import assert from 'node:assert/strict';import {registerHooks} from 'node:module';import {pathToFileURL} from 'node:url';import {resolve} from 'node:path';import {existsSync} from 'node:fs';import {useInstalledDependencies} from ${JSON.stringify(depsURL)};
 useInstalledDependencies();registerHooks({resolve(s,c,next){if(s==='tiktoken')return {url:pathToFileURL(resolve(${JSON.stringify(foreign)})).href,shortCircuit:true};return next(s,c);}});
 const {run}=await import('./evaluation/hr3/harness/runner.mjs');let calls=0;
 await assert.rejects(run({inputs:'not-read',out:${JSON.stringify(out)},transport:{async send(){calls++;}}}),/dependency_resolution_mismatch:tokenizer/);
 assert.equal(calls,0);assert.equal(existsSync(${JSON.stringify(marker)}),false);assert.equal(existsSync(${JSON.stringify(out)}),false);`;
 const r=spawnSync(process.execPath,['--input-type=module','-e',source],{encoding:'utf8'});assert.equal(r.status,0,r.stdout+"\n"+r.stderr);
});
test('recheck dependencies: execution and closure use the same approved configuration',async()=>{
 const {verifyInstalledDependencies,APPROVED_DEPENDENCIES}=await import('../dependencies.mjs');const {runtimeClosure}=await import('../runtime-closure.mjs');const closure=runtimeClosure();
 assert.deepEqual(verifyInstalledDependencies(),APPROVED_DEPENDENCIES);assert.deepEqual(closure.dependencyConfiguration,APPROVED_DEPENDENCIES);assert.deepEqual(closure.externalRoots,Object.values(APPROVED_DEPENDENCIES));
});

test('recheck context embeddings: all nine cases measure and validate both channels',async()=>{
 let module;if(process.env.HR3_RECHECK_OLD_CONTEXT){const url=new URL('../context-certification.mjs',import.meta.url).href;let source=readFileSync(new URL('./fixtures/context-certification-feb05af6.mjs.txt',import.meta.url),'utf8');source=source.replace(/from '(\.\/[^']+)'/g,(_,p)=>'from '+JSON.stringify(new URL(p,url).href)).replace(/import\('(\.\/[^']+)'\)/g,(_,p)=>'import('+JSON.stringify(new URL(p,url).href)+')').replaceAll('import.meta.url',JSON.stringify(url));module=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));}else module=await import('../context-certification.mjs');const r=await module.contextConformance({measurementOnly:true});assert.ok(r.embeddingMeasurements?.length>0);
 for(const c of r.cases)for(const channel of ['research','product']){const rows=r.embeddingMeasurements.filter(m=>m.language===c.language&&m.contextMode===c.mode&&m.channel===channel);assert.ok(rows.length>0,c.language+'/'+c.mode+'/'+channel);for(const m of rows){assert.equal(m.units,m.inputUnits.reduce((a,b)=>a+b,0));assert.equal(m.maxInputUnits,Math.max(...m.inputUnits));assert.match(m.bodySHA256,/^[a-f0-9]{64}$/);assert.ok(m.requestBytes>0&&m.requestBytes<=2097152);assert.ok(m.maxInputUnits<=8192&&m.units<=300000);}}
});
test('recheck context embeddings: context samples participate in every maximum and cumulative projection',async()=>{
 const {measureEmbedding,summarizeEmbeddings}=await import('../embedding-measurement-a4.mjs');const prior={research:11,product:13};
 const base=['research','product'].map(channel=>measureEmbedding(['a'],{family:'base',channel}));
 const context=measureEmbedding(['語'.repeat(2000)],{family:'context',channel:'product'}),a=summarizeEmbeddings(base,prior),b=summarizeEmbeddings([...base,context],prior);
 assert.ok(b.maxInputUnits>a.maxInputUnits);assert.ok(b.maxRequestUnits>a.maxRequestUnits);assert.ok(b.maxRequestBytes>a.maxRequestBytes);assert.ok(b.cumulativeProjection.product.projectedCompleteRunUnits>a.cumulativeProjection.product.projectedCompleteRunUnits);assert.equal(b.unitsByChannel.product,a.unitsByChannel.product+context.units);
 assert.throws(()=>measureEmbedding(['語'.repeat(3000)],{family:'too-large',channel:'product'}),/embedding_bound/);
});

import {runInNewContext} from 'node:vm';
function freezeOutput(source,closure){
 const h='evaluation/hr3/harness',integration='evaluation/hr3/integration',disk=[h+'/runner.mjs',integration+'/adapters.mjs'],v={status:'PASS_OFFLINE_PENDING_PRIMARY_FREEZE',commands:[]};let output;
 const certificate={status:'PASS',sources:{},runtimeClosureSHA256:hash(closure.files)};
 const read=p=>{
  if(p===h+'/reports/a4-verification.json')return Buffer.from(JSON.stringify(v));
  if(p===h+'/reports/budget-a4.json')return Buffer.from(JSON.stringify({availableCarryFits:true,sources:{},accountingGate:{completeThirdPilotMerged:true}}));
  if(['cap-certification-a4','request-certification-a4','context-certification-a4','embedding-certification-a4','conformance-certification-a4','privacy-scan-a4'].some(n=>p===h+'/reports/'+n+'.json'))return Buffer.from(JSON.stringify(certificate));
  return readFileSync(p);
 };
 const readdir=dir=>disk.filter(p=>p.startsWith(dir+'/')).map(p=>({name:p.slice(dir.length+1),isDirectory:()=>false}));
 const globals={assert,readFileSync:read,readdirSync:readdir,writeFileSync:()=>{throw Error('freeze replay must remain memory-only');},existsSync:()=>true,
  execFileSync:(cmd)=>{assert.equal(cmd,'git');return disk.join('\0')+'\0';},runtimeClosure:()=>closure,hash,
  atomicJSON:(p,value)=>{assert.equal(p,h+'/freeze.json');output=JSON.parse(JSON.stringify(value));},process:{stdout:{write(){}}}};
 runInNewContext(source.replace(/^import .*\n/gm,''),globals,{timeout:10000});assert.ok(output);return output;
}
test('recheck freeze output: original producer omits runtime members while current output hashes their actual bytes',async()=>{
 const fixture=new URL('./fixtures/freeze-dd01b643.mjs.txt',import.meta.url),old=readFileSync(fixture,'utf8'),current=readFileSync(new URL('../freeze-a4.mjs',import.meta.url),'utf8');
 const pins=JSON.parse(readFileSync(new URL('./fixtures/recheck-baselines.json',import.meta.url)));assert.equal(hash(old),pins['evaluation/hr3/harness/test/fixtures/freeze-dd01b643.mjs.txt']);
 const {runtimeClosure}=await import('../runtime-closure.mjs');const closure=runtimeClosure(),before=freezeOutput(old,closure),after=freezeOutput(current,closure);
 const required=['evaluation/hr3/scorer/slots.mjs','evaluation/hr3/scorer/contract.mjs','evaluation/hr3/generator/slots.mjs','evaluation/hr3/runner/cli-real.mjs','evaluation/hr3/runner/openai-transport.mjs','core/context-read-assembly.mjs','adapters/mcp/server.mjs',Object.keys(closure.externalFiles).find(p=>p.endsWith('.wasm'))];
 for(const p of required){assert.equal(before.hashes[p],undefined,p);assert.equal(after.hashes[p]?.sha256,hash(readFileSync(p)),p);}
 for(const [p,spec]of Object.entries(closure.files))assert.equal(after.hashes[p]?.sha256,spec.sha256,p);
 assert.deepEqual(after.runtimeClosure.dependencyConfiguration,closure.dependencyConfiguration);
 writeFileSync('evaluation/hr3/harness/reports/recheck-freeze-output.json',JSON.stringify({status:'PASS',method:'Execute actual old/current freeze producers in an isolated VM with identical read-only inputs and an in-memory output sink; never run primary freeze or write freeze.json.',originalCommit:'dd01b643',originalSourceSHA256:hash(old),currentSourceSHA256:hash(current),oldHashCount:Object.keys(before.hashes).length,newHashCount:Object.keys(after.hashes).length,previouslyOmittedMembers:required,allRuntimeBytesVerified:Object.keys(closure.files).length},null,2)+'\n');
});

test('recheck ledger carried exposure cannot disappear with the journal',async t=>{
 const path=join(scratch(t),'ledger.jsonl'),ledger=new Ledger(path,{plan,carryForward:'evaluation/hr3/harness/reports/a4-carry-forward.json'});assert.equal(ledger.snapshot().total,2136861040);rmSync(path);let calls=0;
 await assert.rejects(new GuardedTransport({async send(){calls++;}},ledger).send(request('blocked')),/accounting_mismatch:ledger_journal_missing/);assert.equal(calls,0);assert.equal(existsSync(path),false);
 assert.equal(JSON.parse(readFileSync(path+'.head.json')).blockedReason,'ledger_journal_missing');
});
test('recheck ledger memory anchor rejects rewinding both files within the process',t=>{
 const path=join(scratch(t),'ledger.jsonl'),ledger=new Ledger(path,{plan}),journal=readFileSync(path),head=readFileSync(path+'.head.json');ledger.reserve(request('accepted'));writeFileSync(path,journal);writeFileSync(path+'.head.json',head);
 assert.throws(()=>ledger.reserve(request('blocked')),/ledger_history_rollback/);
});
test('recheck ledger uncheckpointed complete append stops instead of replaying after restart',t=>{
 const path=join(scratch(t),'ledger.jsonl'),ledger=new Ledger(path,{plan}),head=readFileSync(path+'.head.json');ledger.reserve(request('accepted'));writeFileSync(path+'.head.json',head);
 assert.throws(()=>new Ledger(path,{plan}),/ledger_head_mismatch/);
});
test('recheck embedding certificate: context requests are merged before maxima and cumulative projections',()=>{
 const r=JSON.parse(readFileSync('evaluation/hr3/harness/reports/request-certification-a4.json')),measurements=r.contextCoverage.embeddingMeasurements;
 assert.ok(measurements?.length>0);assert.equal(r.embeddings.contextRequests,measurements.length);assert.equal(r.embeddings.contextCasesMeasured,9);assert.equal(r.embeddings.contextMeasurementsIncludedBeforeProjection,true);
 const grouped=new Map();for(const m of measurements){const k=m.family+'/'+m.channel;grouped.set(k,(grouped.get(k)??0)+m.units);assert.ok(r.embeddings.maxInputUnits>=m.maxInputUnits);assert.ok(r.embeddings.maxRequestUnits>=m.units);assert.ok(r.embeddings.maxRequestBytes>=m.requestBytes);}
 for(const [key,units]of grouped){const channel=key.split('/').at(-1);assert.ok(r.embeddings.cumulativeProjection[channel].maxMeasuredFamilyUnits>=units);}
});
test('recheck baseline snapshots match pinned committed producer bytes',()=>{
 const pins=JSON.parse(readFileSync(new URL('./fixtures/recheck-baselines.json',import.meta.url)));
 for(const [p,digest]of Object.entries(pins))assert.equal(hash(readFileSync(p)),digest,p);
});
