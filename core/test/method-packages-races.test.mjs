import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { closeSync, existsSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { fixture,ns,project,ok,error,file,input,child,childHost,moduleURL } from '../testing/method-package-fixtures.mjs';

async function until(predicate,label) {
  const deadline=Date.now()+15000;
  while(!predicate()) {
    if(Date.now()>deadline)throw Error('race_barrier_timeout: '+label);
    await delay(5);
  }
}
async function race(f,operations) {
  const start=join(f.workspace.path,'start'),workers=[];
  for(const [index,operation] of operations.entries()) {
    const stem=join(f.workspace.path,'writer-'+index),configuration=stem+'.json';
    const paths={ready:stem+'.ready',entered:stem+'.entered',result:stem+'.result'};
    writeFileSync(configuration,JSON.stringify({path:f.path,...operation,...paths,start}),{mode:0o600});
    const stdout=stem+'.stdout',stderr=stem+'.stderr',out=openSync(stdout,'wx',0o600),err=openSync(stderr,'wx',0o600);
    // These writers are independent processes, not node:test workers. Match
    // the owned runner's environment fence before their fixture imports node:test.
    const environment={...globalThis.process.env};delete environment.NODE_TEST_CONTEXT;
    let process;
    try{process=spawn(globalThis.process.execPath,[fileURLToPath(new URL('../testing/method-package-race-child.mjs',import.meta.url)),configuration],{env:environment,stdio:['ignore',out,err]});}
    finally{closeSync(out);closeSync(err);}
    const closed=new Promise(resolve=>{
      process.once('error',error=>resolve({error}));
      process.once('close',(code,signal)=>resolve({code,signal}));
    });
    const worker={process,closed,stdout,stderr,...paths};workers.push(worker);
    f.workspace.defer(async()=>{if(process.exitCode===null && process.signalCode===null)process.kill('SIGKILL');await closed;});
  }
  await until(()=>workers.every(worker=>existsSync(worker.ready)),'both writers opened');
  assert.equal(new Set(workers.map(worker=>readFileSync(worker.ready,'utf8'))).size,operations.length,'independent processes');
  assert.ok(workers.every(worker=>!existsSync(worker.result)),'both children wait before invoking the API');
  // Force both calls past the final authority fence while a third connection
  // holds the write lock. They then compete for the same BEGIN IMMEDIATE lock.
  f.db.exec('BEGIN IMMEDIATE');
  try {
    writeFileSync(start,'go',{flag:'wx',mode:0o600});
    await until(()=>workers.every(worker=>existsSync(worker.entered)),'both writers attempting transactions');
    assert.ok(workers.every(worker=>!existsSync(worker.result)),'neither writer can commit before release');
  } finally {f.db.exec('COMMIT');}
  const results=await Promise.all(workers.map(async worker=>{
    const state=await worker.closed;
    const diagnostics=readFileSync(worker.stderr,'utf8')+readFileSync(worker.stdout,'utf8');
    assert.equal(state.error,undefined,String(state.error));assert.equal(state.signal,null,diagnostics);assert.equal(state.code,0,diagnostics);
    const saved=JSON.parse(readFileSync(worker.result,'utf8'));assert.equal(saved.checks,2);return saved.outcome;
  }));
  return results;
}
const count=(f,table)=>f.db.prepare('SELECT count(*) n FROM '+table).get().n;
const rows=(f,table)=>f.db.prepare('SELECT * FROM '+table+' ORDER BY rowid').all();
function consistent(f) {
  const total=f.db.prepare('SELECT coalesce(sum(byte_count),0) n FROM method_files').get().n;
  assert.equal(f.db.prepare('SELECT coalesce(sum(byte_count),0) n FROM method_versions').get().n,total);
  assert.equal(f.db.prepare('SELECT coalesce(sum(byte_count),0) n FROM method_owner_usage').get().n,total);
  assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(),[]);
  assert.equal(f.db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
  assert.equal(f.db.prepare('SELECT count(*) n FROM method_files f LEFT JOIN method_versions v ON v.id=f.version_id WHERE v.id IS NULL OR v.state<>\'available\'').get().n,0);
  assert.equal(f.db.prepare('SELECT count(*) n FROM method_changes c LEFT JOIN method_versions v ON v.id=c.to_id WHERE v.id IS NULL OR v.state<>\'available\'').get().n,0);
  return total;
}
function replayFresh(f,operations,expected) {
  child(`import assert from 'node:assert/strict';import {openMemoryCore} from ${JSON.stringify(moduleURL('core/contract.mjs'))};${childHost}
    const [path,encoded,wanted]=process.argv.slice(1),core=openMemoryCore({path,methodPackages:methods});
    try{const actual=JSON.parse(encoded).map(({method,input})=>core[method](input,token));assert.deepEqual(actual,JSON.parse(wanted));}finally{core.close();}`,
  [f.path,JSON.stringify(operations),JSON.stringify(expected)]);
}

test('M04/M10 concurrent independent writers reserve owner quota across namespaces atomically',{timeout:60000},async t=>{
  const f=fixture(t);
  // Populate the entire near-cap baseline through public imports, so the
  // committed counter must equal real retained file bytes, without seed drift.
  const full=Array.from({length:10},(_,i)=>file('full-'+i,'界'.repeat(100000)));
  for(let i=0;i<16;i++)ok(f.call('importMethodVersion',input('baseline-'+i,{files:full})));
  const remainder=[...Array.from({length:6},(_,i)=>file('remainder-'+i,'界'.repeat(100000))),file('two-byte','é'.repeat(99997)),file('one-byte','x')];
  ok(f.call('importMethodVersion',input('baseline-last',{files:remainder})));
  assert.equal(consistent(f),49_999_995);
  const baseline={packages:rows(f,'method_packages').length,versions:rows(f,'method_versions').length,files:count(f,'method_files'),operations:rows(f,'method_operations').length};
  const operations=[ns,project].map((namespace,i)=>({method:'importMethodVersion',input:input('quota-'+i,{namespace,files:[file('five','12345')]})}));
  const results=await race(f,operations),winner=results.findIndex(result=>result.ok),loser=1-winner;
  assert.ok(winner===0||winner===1);ok(results[winner]);error(results[loser],'quota_reached');
  assert.equal(consistent(f),50_000_000);
  for(const table of ['packages','versions','files','operations'])assert.equal(count(f,'method_'+table),baseline[table]+1,table+' has no loser partial row');
  assert.equal(rows(f,'method_effects').length,0);replayFresh(f,operations,results);
  assert.equal(rows(f,'method_operations').length,baseline.operations+1);
  const imported=results[winner].value,remove={method:'deleteMethodVersion',input:{actionId:'free-winner',ref:imported.version,expectedRevision:1}};
  const removed=f.call(remove.method,remove.input);ok(removed);
  assert.equal(consistent(f),49_999_995);
  const retried=f.call(operations[loser].method,operations[loser].input);assert.equal(ok(retried).ordinal,1);
  assert.equal(consistent(f),50_000_000);
  replayFresh(f,[operations[winner],remove,operations[loser]],[results[winner],removed,retried]);
  assert.equal(rows(f,'method_effects').length,1);assert.equal(rows(f,'method_effects')[0].kind,'method_version_deleted');
  assert.equal(rows(f,'method_versions').find(row=>row.id===imported.version.versionId).state,'deleted');
  assert.equal(f.db.prepare('SELECT count(*) n FROM method_files WHERE version_id=?').get(imported.version.versionId).n,0);
  consistent(f);
});

for(const kind of ['Package','Version'])test(`M04/M08 independent import races deleteMethod${kind} on the same target`,{timeout:30000},async t=>{
  const f=fixture(t),first=ok(f.call('importMethodVersion',input('first',{files:[file('first','first')]})));
  const importing={method:'importMethodVersion',input:input('racing-import',{package:first.package,expectedPackageRevision:1,basedOn:first.version,files:[file('second','second')],change:{items:[{summary:'Synthetic change',paths:['first','second']}],reasonRefs:[]}})};
  const deleting={method:'deleteMethod'+kind,input:{actionId:'racing-delete',ref:kind==='Package'?first.package:first.version,expectedRevision:1}};
  const results=await race(f,[importing,deleting]),[imported,deleted]=results;
  assert.ok(imported.ok||deleted.ok,'at least one writer commits');
  const pkg=rows(f,'method_packages')[0],versions=rows(f,'method_versions');
  const effects=rows(f,'method_effects'),operations=rows(f,'method_operations');
  assert.equal(pkg.next_ordinal,imported.ok?3:2);
  assert.equal(versions.length,imported.ok?2:1);
  assert.equal(operations.length,1+Number(imported.ok)+Number(deleted.ok));
  if(kind==='Package') {
    assert.notEqual(imported.ok,deleted.ok,'package lifecycle CAS has exactly one winner');
    error(imported.ok?deleted:imported,'revision_conflict');
    assert.equal(pkg.revision,2);assert.equal(pkg.state,deleted.ok?'deleted':'available');
    assert.equal(effects.length,Number(deleted.ok));assert.equal(consistent(f),deleted.ok?0:11);
    assert.equal(rows(f,'method_changes').length,imported.ok?1:0);
  } else {
    ok(deleted);if(!imported.ok)error(imported,'revision_conflict');
    assert.equal(pkg.revision,imported.ok?3:2);assert.equal(pkg.state,'available');
    assert.equal(versions.find(row=>row.id===first.version.versionId).state,'deleted');
    assert.equal(effects.length,1);assert.equal(consistent(f),imported.ok?6:0);
    assert.equal(rows(f,'method_changes').length,0,'purge removes change prose touching the deleted base');
  }
  if(effects.length)assert.equal(effects[0].kind,'method_'+kind.toLowerCase()+'_deleted');
  replayFresh(f,[importing,deleting],results);
  assert.deepEqual(rows(f,'method_effects'),effects);assert.deepEqual(rows(f,'method_operations'),operations);
  assert.deepEqual(rows(f,'method_packages')[0],pkg);consistent(f);
});

test('M04 competing imports of one package have one CAS winner and no ordinal gaps',{timeout:30000},async t=>{
  const f=fixture(t),first=ok(f.call('importMethodVersion',input('first',{files:[file('first','a')]})));
  const operations=['left','right'].map(actionId=>({method:'importMethodVersion',input:input(actionId,{package:first.package,expectedPackageRevision:1,basedOn:first.version,files:[file('second','b')]})}));
  const results=await race(f,operations),winner=results.findIndex(result=>result.ok);assert.ok(winner>=0);
  assert.equal(ok(results[winner]).ordinal,2);error(results[1-winner],'revision_conflict');
  assert.deepEqual(rows(f,'method_versions').map(row=>row.ordinal),[1,2]);
  assert.equal(rows(f,'method_packages')[0].next_ordinal,3);assert.equal(rows(f,'method_packages')[0].revision,2);
  assert.equal(rows(f,'method_operations').length,2);assert.equal(count(f,'method_files'),2);assert.equal(rows(f,'method_effects').length,0);
  replayFresh(f,operations,results);assert.equal(rows(f,'method_operations').length,2);assert.equal(consistent(f),2);
});
