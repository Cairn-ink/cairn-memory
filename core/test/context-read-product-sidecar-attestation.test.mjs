import '../testing/context-product-test-clock.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { createHmac, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';
import { openMemoryCore } from '../index.mjs';
import { createMaintenancePumpRuntime, maintenancePumpDiagnostic, maintenancePumpPhaseDiagnostic } from '../context-product-pump.mjs';
import { createMaintenanceAttribution } from '../context-product-attribution.mjs';
import { verificationBound } from '../context-product-verification-batch.mjs';
import { fixture, ns, ok } from '../testing/context-read-fixture.mjs';
import { configured } from '../testing/context-product-owner-fixture.mjs';
import { selection } from '../testing/context-product-verification-fixture.mjs';
import { productSidecar, productFile, canonicalProductIdentity, PRODUCT_SIDECAR_SUFFIX, PRODUCT_SIDECAR_FORMAT } from '../context-product-sidecar.mjs';
import { openContextProductFacade } from '../context-read-facade.mjs';
import { accessDigest, canonicalJson, digest, signedRecord, verifiedRecord } from '../context-product-validation.mjs';
import { createProductSqlitePolicy } from '../context-product-sqlite.mjs';
import { nativeObserver } from '../context-product-telemetry.mjs';
import { createExclusiveSqliteFile, sqliteFileStat } from '../sqlite-journal-probe.mjs';
// Keep the fail-before test runnable against the engine before this module exists.
const seals=await import('../context-product-sidecar-attestation.mjs').catch(()=>({}));
const stamp=path=>{const s=sqliteFileStat(path);return [s.dev,s.ino,s.size,s.mtimeNs,s.ctimeNs].join(':');};
function sql(path,work){const db=new DatabaseSync(path);try{return work(db);}finally{db.close();}}
function child(code,...args){const r=childProcess.spawnSync(process.execPath,['--input-type=module','-e',code,...args],{encoding:'utf8',env:{},timeout:10000});assert.equal(r.status,0,r.stderr);assert.equal(r.error,undefined);return r.stdout;}
function setup(t,{build=true,mode='DELETE',batching=false,state=new SharedArrayBuffer(8),factory=productSidecar,attribution,rendezvous}={}) {
  const stackLimit=Error.stackTraceLimit;Error.stackTraceLimit=64;t.after(()=>{Error.stackTraceLimit=stackLimit;});
  const f=fixture(t),first=f.admit('attestation first canary'),second=f.admit('attestation second canary');
  const path=f.path+PRODUCT_SIDECAR_SUFFIX,p=selection,access=accessDigest({ownerId:ns.ownerId,namespaces:{readSet:[ns]}});
  const children=[],statements=[],executed=[],commits=[],transactions=new WeakMap(),sideDatabases=new WeakSet();
  let clock=0,delayChecks=false,checks=0,storage,hook=()=>{},prepared=statement=>statement,afterExec=()=>{},onFiles=()=>{};
  const base=nativeObserver(),observer={...base,creation(work){return base.creation(()=>{const report=work();children.push(report);return report;});}};
  const sqlite=createProductSqlitePolicy({observer,now:()=>clock}),files=sqlite.files;
  sqlite.files=file=>{const check=files(file);return options=>{check(options);if(file===path)onFiles();};};sqlite.start(Infinity);
  const facade=openContextProductFacade(f.path,{sqlite});
  const prepare=DatabaseSync.prototype.prepare,exec=DatabaseSync.prototype.exec;
  t.mock.method(DatabaseSync.prototype,'prepare',function(text){
    if(text.includes('FROM product_metadata'))sideDatabases.add(this);
    const statement=Reflect.apply(prepare,this,[text]),database=this;
    const wrapped=new Proxy(statement,{get(target,key){const value=Reflect.get(target,key,target);if(typeof value!=='function')return value;
      return (...args)=>{
        if(['get','all','iterate','run'].includes(key)){
          statements.push(text);transactions.get(database)?.sql.push(text);hook(text,key,database);
          if(text==='PRAGMA quick_check'||text==='PRAGMA foreign_key_check'){checks++;if(delayChecks)clock+=1500;}
          if(sideDatabases.has(database)&&text.startsWith('INSERT INTO product_attestation')&&key==='run'){
            const tx=transactions.get(database);assert.ok(tx,'seal write belongs to a transaction');tx.sealed=true;tx.stamp=args[0];
          }
        }
        return Reflect.apply(value,target,args);
      };}});return prepared(wrapped,text);
  });
  t.mock.method(DatabaseSync.prototype,'exec',function(text){
    executed.push(text);
    const writing=sideDatabases.has(this)&&transactions.has(this);
    if(sideDatabases.has(this)){
      if(text==='BEGIN IMMEDIATE')transactions.set(this,{sealed:false,sql:[],site:new Error().stack});
      if(text==='COMMIT'&&transactions.has(this)){
        const tx=transactions.get(this);
        if(seals.validSidecarAttestation)assert.equal(tx?.sealed,true,'every parent sidecar COMMIT includes a seal update');
        commits.push(tx);transactions.delete(this);
      }
      if(text==='ROLLBACK')transactions.delete(this);
    }
    if(text!=='BEGIN IMMEDIATE'&&text!=='COMMIT'&&text!=='ROLLBACK')transactions.get(this)?.sql.push(text);
    const result=Reflect.apply(exec,this,[text]);afterExec(text,this,writing);return result;
  });
  const options={path:f.path,db:facade.port.db,identity:facade.port.identity,features:facade.port.features,observer,sqlite,writable:true,sidecarJournalMode:mode,verificationBatching:batching,verificationBatchState:state,attribution,rendezvous,now:()=>clock};
  const s={f,path,p,access,first,second,facade,children,statements,executed,commits,state,
    get storage(){return storage;},get clock(){return clock;},get checks(){return checks;},
    setPrepareHook(fn){prepared=fn;},setHook(fn){hook=fn;},afterExec(fn){afterExec=fn;},onFiles(fn){onFiles=fn;},setClock(n){clock=n;},delayChecks(){delayChecks=true;},
    open(write=true){storage?.close();storage=factory({...options,writable:write});return storage;},
    observe(){return storage.observe(p,access);},
    finish(picked=p){for(let i=0;i<100;i++){storage.refresh(picked,access,{maxItems:32,maxMs:1000});const r=storage.observe(picked,access);if(r.publication)return r;}assert.fail('bounded rebuild converges');},
    close(){storage?.close();storage=null;},
    row(){return sql(path,db=>seals.readSidecarAttestation(db));},
    valid(){return seals.validSidecarAttestation(facade.port.identity.cursorSecret,s.row(),seals.sidecarAttestationFile(path),PRODUCT_SIDECAR_FORMAT);}};
  f.workspace.defer(()=>{s.close();facade.close();});s.open();if(build)s.finish();return s;
}
// Construct a healthy pre-upgrade WAL layout. Dropping a table also changes
// SQLite's cookie; rebind the test certificates to the resulting legacy schema
// so the fixture does not accidentally start with a foreign-binding defect.
function legacyWal(s,missing) {
  sql(s.path,db=>{
    db.exec(missing==='table'?'DROP TABLE product_attestation':'DELETE FROM product_attestation');
    if(missing!=='table')return;
    const secret=s.facade.port.identity.cursorSecret,file=seals.sidecarAttestationFile(s.path);
    const sidecar={device:file.device,inode:file.inode,incarnation:db.prepare('SELECT incarnation FROM product_metadata WHERE singleton=1').get().incarnation,
      schemaVersion:db.prepare('PRAGMA schema_version').get().schema_version};
    for(const [purpose,table,key]of [['validation','validation_records','publication'],['progress','progress_records','generation']]){
      for(const row of db.prepare(`SELECT ${key} AS id,record FROM ${table}`).all()){
        const {mac,...record}=verifiedRecord(secret,purpose,row.record);
        if(purpose==='validation')record.sidecar=sidecar;else record.sidecarIdentityDigest=digest({format:PRODUCT_SIDECAR_FORMAT,...sidecar});
        db.prepare(`UPDATE ${table} SET record=? WHERE ${key}=?`).run(signedRecord(secret,purpose,record),row.id);
      }
    }
  });
}
function replacementCalls(s){return s.children.filter(r=>r.events.some(e=>e.begin?.database==='incumbent'));}
function wholeChecks(report){return report.events.filter(e=>e.outcome?.database==='incumbent'&&e.outcome.stage==='execute'&&e.outcome.statement==='context_evidence').length;}
function spawnHook(t,hook){const original=childProcess.spawnSync;t.mock.method(childProcess,'spawnSync',(command,args,options)=>{
  if(args[2]?.includes('const replacing ='))return hook(original,command,[...args],options);
  return original(command,args,options);
});syncBuiltinESMExports();t.after(()=>{t.mock.restoreAll();syncBuiltinESMExports();});}

test('fail-before: injected slow whole-file checks cannot recur on attested cold admission',t=>{
  const s=setup(t);s.close();s.delayChecks();const outcomes=[];
  for(let n=0;n<2;n++){s.setClock(0);s.open();try{s.storage.admit(1000);outcomes.push('admitted');}catch(e){outcomes.push(e.code);}s.close();}
  t.diagnostic(JSON.stringify({coldAdmissions:outcomes,wholeFileStatements:s.checks}));
  assert.deepEqual(outcomes,['admitted','admitted']);assert.equal(s.checks,0,'attested open never executes either whole-file PRAGMA');
});

test('match: normal maintenance seals every commit and a cold open returns identical lexical rows',t=>{
  const s=setup(t),before=s.observe(),rows=s.storage.lexical(s.p,before.publication,'canary').rows;
  const row=s.row();assert.equal(s.valid(),true);assert.ok(row.stamp>1);
  s.open();s.storage.admit(2000);assert.equal(s.checks,0);assert.equal(replacementCalls(s).length,0);
  const after=s.observe();assert.deepEqual(after.dto,before.dto);assert.deepEqual(s.storage.lexical(s.p,after.publication,'canary').rows,rows);
  assert.deepEqual(s.row(),row,'read admission does not rewrite a matching seal');
});

test('interrupted first reset write discards the bootstrap exception',t=>{
  const s=setup(t,{build:false});let interrupted=false;
  s.setHook(text=>{
    if(!interrupted&&text==='SELECT stamp FROM product_attestation WHERE singleton=1'){
      interrupted=true;throw Object.assign(Error('synthetic first write failure'),{code:'storage_error'});
    }
  });
  assert.throws(()=>s.storage.reset(),{code:'storage_error'});
  assert.equal(interrupted,true);assert.equal(s.row(),null);
  s.setHook(()=>{});s.storage.admit(2000);
  assert.equal(replacementCalls(s).length,1,'the next operation replaces the unsigned file');assert.equal(s.valid(),true);
});

for(const damage of ['legacy','missing','mac','stamp','identity'])test(`${damage}: refuse old candidates, replace, rebuild and publish`,t=>{
  const s=setup(t),before=s.observe().publication;s.close();
  if(damage==='identity')child("import {copyFileSync,renameSync} from 'node:fs';copyFileSync(process.argv[1],process.argv[1]+'.successor');renameSync(process.argv[1]+'.successor',process.argv[1]);",s.path);
  else sql(s.path,db=>db.exec(damage==='legacy'?'DROP TABLE product_attestation':damage==='missing'?'DELETE FROM product_attestation':damage==='mac'?"UPDATE product_attestation SET record=replace(record,'mac','bad')":'UPDATE product_attestation SET stamp=stamp+1'));
  s.open(false);const refused=s.observe();assert.equal(refused.dto.lexical.state,'unavailable');assert.equal(refused.publication,null);assert.equal(refused.dto.coverage.status,'unavailable');
  assert.equal(refused.dto.coverage.byType.memory.eligible,null);s.open();s.storage.admit(2000);
  if(damage==='legacy')assert.equal(s.checks,0,'DELETE missing-table admission runs zero whole-file statements');
  const empty=s.observe();assert.equal(empty.publication,null);assert.notEqual(empty.dto.lexical.state,'ready');assert.equal(empty.dto.coverage.status,'unavailable');
  assert.equal(replacementCalls(s).length,1);assert.equal(wholeChecks(replacementCalls(s)[0]),0);assert.equal(s.valid(),true);
  const after=s.finish();assert.notEqual(after.publication.generation.id,before.generation.id);
  assert.deepEqual(s.storage.lexical(s.p,after.publication,'canary').rows.map(r=>r.ref.memoryId).sort(),[s.first.id,s.second.id].sort());
});

test('public status on an unverified sidecar never reports ready or coverage',async t=>{
  const s=setup(t);s.close();sql(s.path,db=>db.exec('DELETE FROM product_attestation'));
  const service=configured(t,s.f.path,[ns],{service:true}),h=await service.open();
  try{const status=ok(await h.getContextIndexStatus({readSet:[ns],types:['memory'],intent:'current',deadlineMs:5000},service.token));
    assert.equal(status.lexical.state,'unavailable');assert.equal(status.coverage.status,'unavailable');assert.equal(status.coverage.byType.memory.eligible,null);
  }finally{await h.close();}
});

test('crash before COMMIT rolls back the stamp and retains a matching seal',t=>{
  const s=setup(t),before=s.row();s.close();
  child("import {DatabaseSync} from 'node:sqlite';const db=new DatabaseSync(process.argv[1]);db.exec('BEGIN IMMEDIATE;UPDATE product_attestation SET stamp=stamp+1;UPDATE documents SET token_length=token_length+1');process.exit(0);",s.path);
  s.open();s.storage.admit(2000);assert.deepEqual(s.row(),before);assert.equal(s.valid(),true);assert.equal(replacementCalls(s).length,0);assert.equal(s.checks,0);
});

test('a rejected engine COMMIT rolls back its completed seal write with the data',t=>{
  const s=setup(t),before=s.row(),exec=DatabaseSync.prototype.exec;let rejected;
  t.mock.method(DatabaseSync.prototype,'exec',function(text){
    if(text==='COMMIT'&&!rejected&&this.prepare('PRAGMA application_id').get().application_id===0x43525032){
      const row=seals.readSidecarAttestation(this);
      if(row.stamp>before.stamp){
        assert.equal(seals.validSidecarAttestation(s.facade.port.identity.cursorSecret,row,seals.sidecarAttestationFile(s.path),PRODUCT_SIDECAR_FORMAT),true,'the new seal was written before the rejected COMMIT');
        rejected=row;throw Object.assign(Error('synthetic commit rejection'),{code:'storage_error'});
      }
    }
    return Reflect.apply(exec,this,[text]);
  });
  s.f.admit('rollback with a completed seal write');
  assert.throws(()=>s.storage.refresh(s.p,s.access,{maxItems:32,maxMs:1000}),{code:'storage_error'});
  assert.ok(rejected);assert.deepEqual(s.row(),before,'ROLLBACK restores the exact earlier stamp and MAC');
  s.open();s.storage.admit(2000);assert.equal(s.valid(),true);assert.equal(replacementCalls(s).length,0);
});

test('a published no-op refresh adds no write transaction and retains its seal',t=>{
  const s=setup(t),before=s.row(),commits=s.commits.length,publication=s.observe().publication;
  s.storage.refresh(s.p,s.access,{maxItems:32,maxMs:1000});
  assert.equal(s.commits.length,commits,'optional vacuums cannot create seal-only commits');
  assert.deepEqual(s.row(),before);assert.deepEqual(s.observe().publication,publication);assert.equal(s.valid(),true);
});

for(const mode of ['DELETE','WAL'])test(`SIGKILL after autocommit vacuum retains matching logical content and seal ${mode}`,t=>{
  const s=setup(t,{mode});
  // Allocate then release overflow pages in an existing sealed write. The
  // committed metadata, schema and published corpus remain identical.
  s.storage.vectors(db=>{
    const kind=db.prepare('SELECT kind FROM product_metadata WHERE singleton=1').get().kind;
    const update=db.prepare('UPDATE product_metadata SET kind=? WHERE singleton=1');
    update.run('x'.repeat(1024*1024));update.run(kind);
  },true);
  const logical=db=>({schema:db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name").all(),
    cookie:db.prepare('PRAGMA schema_version').get().schema_version,
    tables:db.prepare("SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name").all().map(({name})=>
      [name,db.prepare('SELECT * FROM "'+name.replaceAll('"','""')+'"').all().sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))])});
  const before=sql(s.path,logical),seal=s.row(),file=seals.sidecarAttestationFile(s.path),publication=s.observe().publication;
  s.close();
  sql(s.path,db=>{
    const free=db.prepare('PRAGMA freelist_count').get().freelist_count;assert.ok(free>32);
    db.exec('BEGIN IMMEDIATE');db.exec('PRAGMA incremental_vacuum(32)');
    assert.ok(db.prepare('PRAGMA freelist_count').get().freelist_count<free,'incremental vacuum can share an explicit transaction');
    db.exec('ROLLBACK');assert.equal(db.prepare('PRAGMA freelist_count').get().freelist_count,free,'physical reclamation rolls back too');
  });
  const code="import {DatabaseSync} from 'node:sqlite';const db=new DatabaseSync(process.argv[1]);const before=db.prepare('PRAGMA freelist_count').get().freelist_count;db.exec('PRAGMA incremental_vacuum(32)');const after=db.prepare('PRAGMA freelist_count').get().freelist_count;process.stdout.write(JSON.stringify({before,after,transaction:db.isTransaction}),()=>process.kill(process.pid,'SIGKILL'));";
  const killed=childProcess.spawnSync(process.execPath,['--input-type=module','-e',code,s.path],{encoding:'utf8',env:{},timeout:10000});
  assert.equal(killed.error,undefined);assert.equal(killed.status,null);assert.equal(killed.signal,'SIGKILL','the vacuum process was killed and reaped before a later write');
  const result=JSON.parse(killed.stdout);assert.ok(result.after<result.before,'the interrupted process actually reclaimed pages');assert.equal(result.transaction,false);
  // Let the engine perform the first cold open/recovery after the kill.
  s.open();s.storage.admit(2000);assert.deepEqual(s.row(),seal);assert.equal(s.valid(),true);
  assert.deepEqual(seals.sidecarAttestationFile(s.path),file);assert.deepEqual(sql(s.path,logical),before);
  assert.deepEqual(s.observe().publication,publication);assert.equal(replacementCalls(s).length,0);assert.equal(s.checks,0);
});

for(const batching of [false,true])test(`structural: every write class seals its commits, batching=${batching}`,t=>{
  const s=setup(t,{build:false,batching});
  // Enough rows keep verification out of comparison's opportunistic tail.
  for(let i=0;i<70;i++)s.f.admit('structural verification row '+i);
  s.storage.admit(2000);const first=s.row().stamp;s.finish();
  if(batching)new Int32Array(s.state)[1]=15; // Exercise the remembered fallback for every verification phase.
  s.f.admit('delta attestation canary');s.finish();
  let retired;
  s.storage.vectors(db=>{
    retired=Number(db.prepare("INSERT INTO vector_generations(id,lexical_generation,owner,projection,identity,epoch,lexical,state,published) VALUES('retire',-1,?,'retire','identity',1,'lexical','{}',0)").run(ns.ownerId).lastInsertRowid);
    db.prepare("INSERT INTO vector_rows VALUES(?,1,'item',1,1,'representation',NULL,x'00')").run(retired);
  },true);
  assert.equal(sql(s.path,db=>db.prepare('SELECT count(*) n FROM vector_rows WHERE generation=?').get(retired).n),1);
  s.finish();assert.equal(sql(s.path,db=>db.prepare('SELECT count(*) n FROM vector_generations WHERE storage_id=?').get(retired).n),0);
  const other={...s.p,readSet:[{...ns,scope:'project',projectId:'retention'}]};s.finish(other);
  s.storage.reset();s.finish();
  const reached=new Set();
  for(const tx of s.commits){
    const has=prefix=>tx.sql.some(q=>q.startsWith(prefix));
    if(tx.sql.filter(q=>!q.includes('product_attestation')).length===0)reached.add('bootstrap');
    if(has('INSERT OR IGNORE INTO selections'))reached.add('selection');
    if(has('DELETE FROM selections WHERE projection'))reached.add('selection-retention');
    if(has('INSERT INTO generations'))reached.add('generation');
    if(has('UPDATE generations SET incarnation'))reached.add('comparison');
    if(has('DELETE FROM generations WHERE id'))reached.add('lexical-retirement');
    if(has('DELETE FROM vector_generations WHERE storage_id'))reached.add('vector-retirement');
    if(has('INSERT INTO vector_generations'))reached.add('vector-write');
    if(has('INSERT INTO validation_records'))reached.add('publication');
    if(has('DELETE FROM vector_publications;'))reached.add('reset');
    if(has('SAVEPOINT verification_chunk'))reached.add('batched-verification');
    if(tx.site.includes('legacyVerification'))reached.add('fallback-verification');
    if(!has('SAVEPOINT verification_chunk')&&!tx.site.includes('legacyVerification')&&has('UPDATE statistics SET verified_df'))reached.add('unbatched-verification');
  }
  const expected=['bootstrap','selection','selection-retention','generation','comparison','lexical-retirement','vector-retirement','vector-write','publication','reset',
    ...(batching?['batched-verification','fallback-verification']:['unbatched-verification'])];
  for(const kind of expected)assert.ok(reached.has(kind),'write class actually reached: '+kind);
  assert.ok(s.commits.every(tx=>tx.sealed));assert.equal(new Set(s.commits.map(tx=>tx.stamp)).size,s.commits.length);
  assert.equal(s.row().stamp,s.commits.length);assert.equal(first,1);assert.equal(s.valid(),true);
  t.diagnostic('write classes: '+[...reached].sort().join(', '));
});

for(const race of ['attestation','stamp'])test(`child exclusion refuses a concurrent ${race} change with ESTALE`,t=>{
  const s=setup(t);s.close();sql(s.path,db=>db.exec('DELETE FROM product_attestation'));
  let intercepted=0;
  spawnHook(t,(spawn,command,args,options)=>{
    if(args[4]==='replace-product-cache'){
      intercepted++;const init=JSON.parse(args[6]);assert.equal(init.expectedAttestation,'missing');
      sql(s.path,db=>{db.exec('BEGIN IMMEDIATE');seals.writeSidecarAttestation(db,s.facade.port.identity.cursorSecret,seals.sidecarAttestationFile(s.path),PRODUCT_SIDECAR_FORMAT);db.exec('COMMIT');});
      if(race==='attestation'){init.expectedStamp=stamp(s.path);args[6]=JSON.stringify(init);}
    }
    return spawn(command,args,options);
  });
  s.open();assert.throws(()=>s.storage.admit(2000),{code:'index_unavailable'});assert.equal(intercepted,1);
  assert.equal(s.children.at(-1).value.error,'ESTALE');assert.equal(s.children.at(-1).value.published,false);assert.equal(s.valid(),true);
});

test('corrupt verdict still executes the incumbent whole-file checks',t=>{
  const s=setup(t);s.close();let injected=false;
  s.setHook(text=>{if(!injected&&text.includes('FROM product_metadata')){injected=true;throw Object.assign(Error('synthetic corrupt'),{code:'ERR_SQLITE_ERROR',errcode:11});}});
  s.open();assert.throws(()=>s.storage.admit(2000),{code:'index_unavailable'});
  assert.equal(injected,true);const report=replacementCalls(s).at(-1);assert.equal(wholeChecks(report),2);assert.equal(report.value.error,'ESTALE');
});

test('SQLITE_CORRUPT continues into repair when the child confirms corruption',t=>{
  const s=setup(t);s.close();let injected=false;
  s.setHook(text=>{if(!injected&&text.includes('FROM product_metadata')){injected=true;throw Object.assign(Error('synthetic corrupt'),{code:'ERR_SQLITE_ERROR',errcode:11});}});
  spawnHook(t,(spawn,command,args,options)=>{
    if(args[4]==='replace-product-cache')args[2]=args[2].replace(".get().quick_check!=='ok'", ".get().quick_check!=='synthetic corrupt'");
    return spawn(command,args,options);
  });
  s.open();s.storage.admit(2000);assert.equal(replacementCalls(s).length,1);assert.equal(wholeChecks(replacementCalls(s)[0]),1);assert.equal(s.observe().publication,null);assert.equal(s.valid(),true);
});

test('crash after replacement before the first parent write leaves missing and re-replaces once',t=>{
  const s=setup(t);s.close();sql(s.path,db=>db.exec('DELETE FROM product_attestation'));let crashed=false;
  spawnHook(t,(spawn,command,args,options)=>{
    const result=spawn(command,args,options);
    if(args[4]==='replace-product-cache'&&!crashed){crashed=true;s.setClock(2100);}
    return result;
  });
  s.open();assert.throws(()=>s.storage.admit(2000),{code:'read_timeout'});s.close();assert.equal(s.row(),null);
  s.setClock(0);s.open(false);assert.equal(s.observe().dto.lexical.state,'unavailable');
  s.open();s.storage.admit(2000);assert.equal(replacementCalls(s).length,2);assert.equal(s.valid(),true);assert.equal(s.observe().publication,null);
  assert.ok(s.finish().publication);
});

test('child argv, input and environment carry no store or derived key material',t=>{
  const s=setup(t);s.close();sql(s.path,db=>db.exec('DELETE FROM product_attestation'));let inspected=0;
  const secret=s.facade.port.identity.cursorSecret,derived=createHmac('sha256',secret).update('sidecar-attestation-v1').digest();
  spawnHook(t,(spawn,command,args,options)=>{
    const serialized=JSON.stringify({command,args,options});
    for(const key of [Buffer.from(secret),derived])for(const value of [key.toString(),key.toString('hex'),key.toString('base64'),key.toString('base64url'),JSON.stringify([...key]),JSON.stringify(key)]) {
      assert.equal(serialized.includes(value),false,'key material must stay outside every child channel');
      assert.equal(serialized.includes(JSON.stringify(value).slice(1,-1)),false,'escaped key material must stay outside every child channel');
    }
    const init=JSON.parse(args[6]);assert.deepEqual(Object.keys(init).sort(),['attestation','autoVacuum','expectedAttestation','expectedStamp','incarnation','journalMode','profile','sql','storeId']);
    assert.deepEqual(options.env,{});assert.equal(options.input,undefined);inspected++;
    return spawn(command,args,options);
  });
  s.open();s.storage.admit(2000);assert.equal(inspected,1);assert.equal(s.valid(),true);
});

test('bounded rebuild honours an intervening forget and replacement discards old progress',t=>{
  const s=setup(t,{build:false});s.storage.refresh(s.p,s.access,{maxItems:1,maxMs:1000});
  const old=s.observe().dto.lexical.progress;s.close();assert.ok(old);
  ok(s.f.core.forget({namespace:ns,memoryId:s.first.id,expectedRevision:s.first.revision}));
  sql(s.path,db=>db.exec('DELETE FROM product_attestation'));s.open();s.storage.admit(2000);
  assert.equal(s.observe().dto.lexical.progress,null);const rebuilt=s.finish();
  const refs=s.storage.lexical(s.p,rebuilt.publication,'canary').rows.map(r=>r.ref.memoryId);
  assert.deepEqual(refs,[s.second.id]);assert.equal(replacementCalls(s).length,1);
});


test('a replacement COMMIT overrun settles durably and the next cold admission needs no replacement',t=>{
  const s=setup(t);s.close();sql(s.path,db=>db.exec('DELETE FROM product_attestation'));let overrun=false;
  s.afterExec((text,database,writing)=>{if(text==='COMMIT'&&writing&&!overrun){overrun=true;s.setClock(2100);}});
  s.open();assert.throws(()=>s.storage.admit(2000),{code:'read_timeout'});s.close();
  assert.equal(overrun,true);assert.equal(s.valid(),true);assert.equal(replacementCalls(s).length,1);
  s.setClock(0);s.open();s.storage.admit(2000);assert.equal(replacementCalls(s).length,1);assert.ok(s.finish().publication);
});

for(const value of ['9007199254740992','9223372036854775807','-1',"'unreadable'",'1.5'])test(`invalid stored stamp ${value} replaces and rebuilds`,t=>{
  const s=setup(t);s.close();
  // Temporarily use ANY to create values that a damaged file can contain, then
  // restore the exact expected schema before the engine opens the file.
  const changeType=type=>sql(s.path,db=>{
    db.enableDefensive?.(false);db.exec('PRAGMA writable_schema=ON');
    db.prepare("UPDATE sqlite_schema SET sql=replace(sql,?,?) WHERE name='product_attestation'")
      .run(type==='ANY'?'stamp INTEGER NOT NULL':'stamp ANY NOT NULL',type==='ANY'?'stamp ANY NOT NULL':'stamp INTEGER NOT NULL');
    const version=db.prepare('PRAGMA schema_version').get().schema_version;
    db.exec('PRAGMA schema_version='+(version+1));
  });
  changeType('ANY');sql(s.path,db=>db.exec('PRAGMA ignore_check_constraints=ON;UPDATE product_attestation SET stamp='+value));changeType('INTEGER');
  s.open(false);assert.equal(s.observe().publication,null);
  s.open();s.storage.admit(2000);
  assert.equal(replacementCalls(s).length,1);assert.equal(wholeChecks(replacementCalls(s)[0]),0);
  assert.equal(s.valid(),true);assert.ok(s.finish().publication);
});

test('malformed singleton schema is refused before any seal lookup in parent or child',t=>{
  const s=setup(t);s.close();sql(s.path,db=>db.exec(`DROP TABLE product_attestation;
    CREATE TABLE product_attestation(singleton INTEGER,stamp INTEGER,record TEXT);
    WITH RECURSIVE n(i) AS (VALUES(2) UNION ALL SELECT i+1 FROM n WHERE i<1001)
    INSERT INTO product_attestation SELECT i,1,'invalid' FROM n;`));
  let lookups=0;s.setHook(text=>{if(/FROM product_attestation WHERE singleton=1|JOIN product_attestation/.test(text))lookups++;});
  spawnHook(t,(spawn,command,args,options)=>{
    if(args[4]==='replace-product-cache'){
      // Even an exact-row verdict raced against incompatible schema must not
      // query that schema. The child must refuse this changed basis.
      const init=JSON.parse(args[6]);init.expectedAttestation='missing';args[6]=JSON.stringify(init);
    }
    return spawn(command,args,options);
  });
  s.open();let refusal;try{s.storage.admit(2000);}catch(error){refusal=error;}
  assert.equal(lookups,0,'no unindexed parent lookup');
  const report=replacementCalls(s).at(-1);assert.ok(report);
  const reads=report.events.filter(e=>e.begin?.database==='incumbent'&&e.begin.stage==='execute'&&e.begin.statement==='context_metadata');
  // schema and header checks only; no metadata or seal lookup on damaged schema.
  assert.equal(reads.length,0);assert.equal(refusal?.code,'index_unavailable');assert.equal(report.value.error,'ESTALE');
});

for(const boundary of ['PRAGMA journal_mode','PRAGMA application_id','PRAGMA user_version',
  'SELECT m.*,CAST(a.stamp AS TEXT) AS attestation_stamp,typeof(a.stamp) AS attestation_type,a.record AS attestation_record,a.singleton AS attestation_present FROM product_metadata m LEFT JOIN product_attestation a ON a.singleton=1 WHERE m.singleton=1'])
test(`opening deadline stops at the statement boundary after ${boundary}`,t=>{
  const s=setup(t);s.close();let expired=false,journals=0;const after=[];
  s.setHook(text=>{
    if(expired&&!['ROLLBACK','PRAGMA query_only'].some(prefix=>text.startsWith(prefix)))after.push(text);
    const atBoundary=text===boundary||boundary.includes('LEFT JOIN product_attestation')&&text==='SELECT stamp,record FROM product_attestation WHERE singleton=1';
    if(atBoundary&&(boundary!=='PRAGMA journal_mode'||++journals===2)){expired=true;s.setClock(2000);}
  });
  s.open();assert.throws(()=>s.storage.admit(2000),{code:'read_timeout'});
  assert.equal(expired,true);assert.deepEqual(after,[],'no subsequent storage statement starts after cutoff');
});

test('child initialization refuses unknown fields and mistyped known fields before spawning',t=>{
  const s=setup(t);s.close();sql(s.path,db=>db.exec('DELETE FROM product_attestation'));
  let payload,spawns=0;spawnHook(t,(spawn,command,args,options)=>{
    spawns++;if(args[4]==='replace-product-cache')payload=JSON.parse(args[6]);return spawn(command,args,options);
  });
  s.open();s.storage.admit(2000);assert.ok(payload);const before=spawns;
  const secret=s.facade.port.identity.cursorSecret,derived=createHmac('sha256',secret).update('sidecar-attestation-v1').digest();
  for(const bytes of [Buffer.from(secret),derived])for(const leak of [bytes.toString(),bytes.toString('hex'),bytes.toString('base64'),bytes.toString('base64url'),[...bytes],bytes.toJSON()]){
    assert.throws(()=>createExclusiveSqliteFile(s.path,undefined,{...payload,extra:leak}),{name:'TypeError',message:'invalid_cache_initialization'});
  }
  for(const patch of [{storeId:[]},{attestation:{...payload.attestation,extra:'x'}},
    {attestation:{...payload.attestation,schema:[{...payload.attestation.schema[0],extra:'x'}]}},
    {attestation:{...payload.attestation,applicationId:'1'}},{sql:{}},{expectedAttestation:[]}])
    assert.throws(()=>createExclusiveSqliteFile(s.path,undefined,{...payload,...patch}),{name:'TypeError',message:'invalid_cache_initialization'});
  assert.equal(spawns,before,'rejected payloads reach no child channel');
});

for(const missing of ['table','row'])test(`legacy WAL missing ${missing} checks once, seals in place and reopens without whole-file statements`,t=>{
  const s=setup(t,{mode:'WAL'}),publication=s.observe().publication,file=seals.sidecarAttestationFile(s.path);s.close();
  legacyWal(s,missing);
  s.open();s.storage.admit(2000);assert.equal(s.checks,2);assert.equal(replacementCalls(s).length,0);
  assert.equal(s.valid(),true);assert.deepEqual(seals.sidecarAttestationFile(s.path),file);
  s.open();s.storage.admit(2000);assert.equal(s.checks,2,'attested WAL open adds zero whole-file statements');
  // A dropped table changes the schema cookie, so ordinary bounded maintenance
  // revalidates/rebuilds the inner publication as needed.
  assert.ok(s.finish().publication);if(missing==='row')assert.deepEqual(s.observe().publication,publication);
});

test('corrupt legacy WAL retains main non-DELETE refusal',t=>{
  const s=setup(t,{mode:'WAL'});s.close();sql(s.path,db=>db.exec('DELETE FROM product_attestation'));
  s.setHook(text=>{if(text==='PRAGMA quick_check')throw Object.assign(Error('synthetic corrupt legacy WAL'),{code:'ERR_SQLITE_ERROR',errcode:11});});
  s.open();assert.throws(()=>s.storage.admit(2000),{code:'index_unavailable',reason:'storage_unavailable'});
  assert.equal(replacementCalls(s).length,0);assert.equal(s.row(),null);
});

for(const damage of ['mac','stamp'])test(`present invalid WAL ${damage} refuses with zero whole-file statements`,t=>{
  const s=setup(t,{mode:'WAL'});s.close();sql(s.path,db=>db.exec(damage==='mac'?"UPDATE product_attestation SET record='invalid'":'PRAGMA ignore_check_constraints=ON;UPDATE product_attestation SET stamp=9223372036854775807'));
  s.open();assert.throws(()=>s.storage.admit(2000),{code:'index_unavailable',reason:'storage_unavailable'});
  assert.equal(s.checks,0);assert.equal(replacementCalls(s).length,0);
});

for(const missing of ['table','row'])test(`legacy WAL SIGKILL before sealing COMMIT leaves missing ${missing} and checks again`,t=>{
  const s=setup(t,{mode:'WAL'});s.close();legacyWal(s,missing);
  const code=`
    import {DatabaseSync} from 'node:sqlite';
    import {writeSync} from 'node:fs';
    import {productSidecar} from ${JSON.stringify(new URL('../context-product-sidecar.mjs',import.meta.url).href)};
    import {openContextProductFacade} from ${JSON.stringify(new URL('../context-read-facade.mjs',import.meta.url).href)};
    import {createProductSqlitePolicy} from ${JSON.stringify(new URL('../context-product-sqlite.mjs',import.meta.url).href)};
    const sqlite=createProductSqlitePolicy({now:()=>0});sqlite.start(Infinity);
    const facade=openContextProductFacade(process.argv[1],{sqlite});
    let checks=0,sealed=false;const prepare=DatabaseSync.prototype.prepare,exec=DatabaseSync.prototype.exec;
    DatabaseSync.prototype.prepare=function(sql){const statement=prepare.call(this,sql);return new Proxy(statement,{get(target,key){
      const value=Reflect.get(target,key,target);if(typeof value!=='function')return value;
      return (...args)=>{if(key==='get'&&['PRAGMA quick_check','PRAGMA foreign_key_check'].includes(sql))checks++;
        if(key==='run'&&sql.startsWith('INSERT INTO product_attestation'))sealed=true;
        return Reflect.apply(value,target,args);};}});};
    DatabaseSync.prototype.exec=function(sql){
      if(sql==='COMMIT'&&sealed){writeSync(1,JSON.stringify({checks,transaction:this.isTransaction}));process.kill(process.pid,'SIGKILL');}
      return exec.call(this,sql);
    };
    const storage=productSidecar({path:process.argv[1],db:facade.port.db,identity:facade.port.identity,features:facade.port.features,
      sqlite,writable:true,sidecarJournalMode:'WAL',now:()=>0});
    storage.admit(2000);throw Error('must die before sealing commit');`;
  const killed=childProcess.spawnSync(process.execPath,['--input-type=module','-e',code,s.f.path],{encoding:'utf8',env:{},timeout:10000});
  assert.equal(killed.error,undefined);assert.equal(killed.signal,'SIGKILL',killed.stderr);assert.equal(killed.status,null);
  assert.deepEqual(JSON.parse(killed.stdout),{checks:2,transaction:true});
  assert.equal(s.row(),null,'native crash rollback leaves the seal missing');
  s.open();s.storage.admit(2000);assert.equal(s.checks,2);assert.equal(s.valid(),true);assert.equal(replacementCalls(s).length,0);
  s.open();s.storage.admit(2000);assert.equal(s.checks,2,'only the retry runs whole-file checks');
});

test('cold admission folds the seal lookup into the existing singleton metadata read',t=>{
  const s=setup(t);s.close();const before=s.statements.length;s.open();s.storage.admit(2000);
  const opening=s.statements.slice(before);
  assert.equal(opening.filter(q=>q.includes('LEFT JOIN product_attestation')).length,1);
  assert.equal(opening.filter(q=>q.includes('FROM product_attestation')).length,0,'no standalone cold seal lookup');
  assert.equal(s.checks,0);assert.equal(s.valid(),true);
});

test('a stored CHECK violation in a legacy WAL cache is refused by the one-time integrity check',t=>{
  const s=setup(t,{mode:'WAL'});s.close();legacyWal(s,'row');
  sql(s.path,db=>db.exec('PRAGMA ignore_check_constraints=ON;UPDATE documents SET token_length=-1'));
  s.open();assert.throws(()=>s.storage.admit(2000),{code:'index_unavailable',reason:'storage_unavailable'});
  assert.equal(s.checks,1,'quick_check detects the stored violation before foreign_key_check');
  assert.equal(replacementCalls(s).length,0);assert.equal(s.row(),null);
});

test('legacy WAL table upgrade preserves purge checkpoints and selection metadata byte for byte',t=>{
  const s=setup(t,{mode:'WAL'});
  const body={ownerId:ns.ownerId,storeId:s.facade.port.identity.storeId,
    canonicalIdentity:s.facade.port.read(()=>canonicalProductIdentity(s.f.path,s.facade.port.db)),sidecarIdentity:productFile(s.path),epoch:7,deleted:11,complete:false};
  const record=canonicalJson({body,mac:createHmac('sha256',s.facade.port.identity.cursorSecret)
    .update('context-read-product-v1.1/vector-purge\0'+canonicalJson(body)).digest('base64url')});
  s.storage.vectors(db=>db.prepare('INSERT INTO vector_purge_checkpoints VALUES(?,?,?)').run(ns.ownerId,7,record),true);
  s.close();legacyWal(s,'table');
  const retained=()=>sql(s.path,db=>({checkpoint:db.prepare('SELECT * FROM vector_purge_checkpoints').all(),selections:db.prepare('SELECT * FROM selections ORDER BY projection').all()}));
  const before=retained();assert.equal(before.checkpoint.length,1);assert.equal(before.selections.length,1);
  s.open();s.storage.admit(2000);
  assert.deepEqual(retained(),before,'schema-independent metadata must survive first sealing commit');
  assert.equal(s.checks,2);assert.equal(s.valid(),true);assert.ok(s.finish().publication);
});

// Test-only source observation of private gate state, following the opening
// probe. The production module and its hooks remain unchanged. All native SQL
// still passes through setup's statement observer and the real estimator runs.
async function firstSealProbe(t) {
  const url=new URL('../context-product-sidecar.mjs',import.meta.url);
  let source=readFileSync(url,'utf8');
  const replace=(from,to)=>{assert.ok(source.includes(from),from);source=source.replace(from,to);};
  replace('const costs=checkpointCost(now),',`const originalCosts=checkpointCost(now), costs={...originalCosts,admit(...args){const admitted=originalCosts.admit(...args);probe('estimate',{admitted});return admitted;}},`);
  replace('  function failed(error, wasWritable) {',`  const probe=(event,details={})=>attribution?.probe?.({event,workQuantumActive:!!workQuantum,checkpointAttempted,...details});
  function failed(error, wasWritable) {`);
  replace('if(bootstrap&&(bootstrapCommit||legacyWalMissing)){',`if(bootstrap&&(bootstrapCommit||legacyWalMissing)){
      probe('first-seal',{bootstrapCommit,legacyWalMissing,sideMode});`);
  replace("    const began=now(),beginning=attribution?.start('begin');",`    probe('write',{kind,checkpoint,estimate:workQuantum?originalCosts.admit(workQuantum,started):true});
    const began=now(),beginning=attribution?.start('begin');`);
  replace('if(error!==checkpointYield)throw error;',"if(error!==checkpointYield)throw error;probe('yield');");
  source=source.replace(/(['"])(\.\/[^'"]+\.mjs)\1/g,(_,quote,ref)=>JSON.stringify(new URL(ref,url).href));
  source=source.replaceAll('import.meta.url',JSON.stringify(url.href));
  const module=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
  const events=[],attribution=createMaintenanceAttribution();attribution.probe=event=>events.push(event);
  return {factory:module.productSidecar,attribution,events};
}

for(const replaced of [false,true])test(`first-seal setup: standalone ${replaced?'replaced':'new'} cache cannot be denied`,async t=>{
  const probe=await firstSealProbe(t),s=setup(t,{build:false,...probe});
  if(replaced){s.storage.admit(2000);s.close();sql(s.path,db=>db.exec('UPDATE product_attestation SET stamp=stamp+1'));s.open();probe.events.length=0;}
  s.storage.admit(2000);
  const openings=probe.events.filter(e=>e.event==='first-seal');
  assert.equal(openings.length,1);assert.equal(openings[0].workQuantumActive,false);assert.equal(openings[0].checkpointAttempted,false);
  const writes=probe.events.filter(e=>e.event==='write');assert.equal(writes.length,1);assert.equal(writes[0].checkpoint,false);assert.equal(writes[0].checkpointAttempted,false);
  assert.equal(s.valid(),true);assert.equal(replacementCalls(s).length,Number(replaced));
  t.diagnostic(JSON.stringify({openings,writes,replacements:replacementCalls(s).length}));
});

for(const missing of ['table','row'])test(`first-seal setup: direct refresh WAL missing ${missing} preserves and prices work admission`,async t=>{
  const probe=await firstSealProbe(t),s=setup(t,{mode:'WAL',...probe});s.close();legacyWal(s,missing);s.open();
  // Make real work necessary for either legacy layout.
  s.f.admit('first seal work after upgrade');probe.events.length=0;
  let opening=false;
  s.afterExec((text,db,writing)=>{if(opening&&text==='COMMIT'&&writing){s.setClock(700);opening=false;}});
  s.setHook(text=>{if(text.startsWith('INSERT INTO product_attestation')&&!probe.events.some(e=>e.event==='write'&&e.checkpoint))opening=true;});
  assert.doesNotThrow(()=>s.storage.refresh(s.p,s.access,{maxItems:32,maxMs:1000}));
  const openings=probe.events.filter(e=>e.event==='first-seal');assert.equal(openings.length,1);
  assert.equal(openings[0].workQuantumActive,true);assert.equal(openings[0].checkpointAttempted,false);
  const writes=probe.events.filter(e=>e.event==='write'),setupWrite=writes[0],work=writes.filter(e=>e.checkpoint);
  assert.equal(setupWrite.checkpoint,false);assert.equal(setupWrite.checkpointAttempted,false);
  assert.ok(work.length>0,'the first real work transaction retains its exemption');assert.equal(work[0].estimate,false,'the actual estimator would deny the first work transaction');
  assert.equal(work.length,1,'a second work transaction is priced and denied');
  assert.ok(probe.events.some(e=>e.event==='estimate'&&!e.admitted),'real estimator refuses later work');
  assert.equal(s.checks,2);assert.equal(replacementCalls(s).length,0);assert.equal(s.valid(),true);
  t.diagnostic(JSON.stringify({openings,writes,estimates:probe.events.filter(e=>e.event==='estimate'),wholeFileStatements:s.checks}));
});

for(const [remove,denySeal] of [[false,false],[true,false],[true,true]])test(`first-seal setup: mid-turn WAL reconnect is bounded, out-of-band removal=${remove}, priced yield=${denySeal}`,async t=>{
  let staging=true;
  const probe=await firstSealProbe(t),s=setup(t,{build:false,mode:'WAL',batching:true,...probe,rendezvous:point=>{if(staging&&point==='checkpoint')s.setClock(900);}});
  for(let i=0;i<70;i++)s.f.admit('reconnect verification '+i);
  // Start with durable comparison work and unfinished verification.
  s.storage.admit(2000);
  s.storage.refresh(s.p,s.access,{maxItems:1024,maxMs:1000});
  assert.ok(probe.events.some(e=>e.event==='write'&&e.kind==='comparison'));
  staging=false;s.setClock(0);probe.events.length=0;
  let injected=false,removed=false,rolledBack=false;
  s.setHook(text=>{
    if(!injected&&text.startsWith('SELECT count(*) AS n,coalesce(sum(')){injected=true;throw verificationBound;}
    if(removed&&denySeal&&text==='PRAGMA foreign_key_check')s.setClock(700);
  });
  s.afterExec((text,db,writing)=>{
    if(text.startsWith('ROLLBACK TO verification_chunk'))rolledBack=true;
    if(text==='ROLLBACK'&&writing&&rolledBack&&remove&&!removed){sql(s.path,d=>d.exec('DELETE FROM product_attestation'));removed=true;}
  });
  assert.doesNotThrow(()=>s.storage.refresh(s.p,s.access,{maxItems:32,maxMs:1000}));
  assert.equal(injected,true);assert.equal(rolledBack,true);assert.equal(removed,remove);
  const openings=probe.events.filter(e=>e.event==='first-seal');
  assert.equal(openings.length,Number(remove),'only out-of-band removal can reach the mid-turn first seal');
  if(remove){assert.equal(openings[0].workQuantumActive,true);assert.equal(openings[0].checkpointAttempted,true);}
  assert.equal(replacementCalls(s).length,0);
  const missing=s.row()===null;assert.equal(missing,denySeal);
  if(missing)assert.ok(probe.events.some(e=>e.event==='yield'),'missing seal can only remain on a checkpoint yield');
  const checks=s.checks;s.setHook(()=>{});s.afterExec(()=>{});s.setClock(0);
  assert.doesNotThrow(()=>s.storage.refresh(s.p,s.access,{maxItems:32,maxMs:1000}));
  assert.equal(s.checks-checks,missing?2:0,'next opening checks missing once');assert.equal(s.valid(),true);assert.equal(replacementCalls(s).length,0);
  t.diagnostic(JSON.stringify({openings,injected,removed,missing,wholeFileStatements:s.checks,replacements:replacementCalls(s).length}));
});

for(const replaced of [false,true])test(`first-seal setup: DELETE ${replaced?'replacement':'initialization'} inside refresh uses its existing data write`,async t=>{
  const probe=await firstSealProbe(t),s=setup(t,{build:false,...probe});
  if(replaced){s.storage.admit(2000);s.close();sql(s.path,db=>db.exec('UPDATE product_attestation SET stamp=stamp+1'));s.open();}
  probe.events.length=0;
  assert.doesNotThrow(()=>s.storage.refresh(s.p,s.access,{maxItems:32,maxMs:1000}));
  assert.equal(probe.events.filter(e=>e.event==='first-seal').length,0,'neither opening first-seal caller is reachable for DELETE within a work turn');
  assert.equal(s.valid(),true);assert.equal(replacementCalls(s).length,Number(replaced));
});

// Standalone admission has no data transaction into which the first seal can
// fold. Census all parent transactions, including canonical/lifecycle reads;
// creation-child transactions are outside this in-process statement observer.
function standaloneAdmission(t) {
  const workspace=createTestWorkspace(t),path=join(workspace.path,'canonical.sqlite');
  const core=openMemoryCore({path});core.close();
  const executed=[],base=nativeObserver();let replacements=0;
  const observer={...base,invoke(stage,label,work){
    if(stage==='execute'&&label==='transaction'&&productFile(path+PRODUCT_SIDECAR_SUFFIX,true))replacements++;
    return base.invoke(stage,label,work);
  }};
  const exec=DatabaseSync.prototype.exec;
  t.mock.method(DatabaseSync.prototype,'exec',function(text){executed.push(text);return Reflect.apply(exec,this,[text]);});
  let facade,storage;
  const close=()=>{storage?.close();storage=null;facade?.close();facade=null;};
  const open=()=>{close();facade=openContextProductFacade(path,{});storage=productSidecar({path,db:facade.port.db,identity:facade.port.identity,features:facade.port.features,writable:true,observer,now:()=>0});};
  const census=()=>({begin:executed.filter(q=>q.startsWith('BEGIN')).length,commit:executed.filter(q=>q==='COMMIT').length,writeBegin:executed.filter(q=>q==='BEGIN IMMEDIATE').length});
  workspace.defer(close);open();
  return {path:path+PRODUCT_SIDECAR_SUFFIX,executed,open,close,census,get replacements(){return replacements;},get storage(){return storage;}};
}

for(const kind of ['new','replaced','matched'])test(`standalone first-seal census: ${kind}`,t=>{
  const s=standaloneAdmission(t);
  if(kind!=='new'){
    s.storage.admit(2000);s.close();
    if(kind==='replaced')sql(s.path,db=>db.exec('UPDATE product_attestation SET stamp=stamp+1'));
    s.open();
  }
  s.executed.length=0;
  s.storage.admit(2000);
  const actual=s.census(),expected=kind==='matched'?{begin:4,commit:3,writeBegin:0}:kind==='new'?{begin:6,commit:4,writeBegin:1}:{begin:7,commit:4,writeBegin:1};
  t.diagnostic(JSON.stringify({kind,actual,expected,replacements:s.replacements}));
  assert.deepEqual(actual,expected,'absolute parent transaction census');
  // The refused incumbent read rolls back: replacement adds one read BEGIN
  // to the fresh case, with no extra read COMMIT. Omission controls pin the
  // unsealed baseline separately from the one retained sealing transaction.
  const baseline=kind==='matched'?{begin:4,commit:3,writeBegin:0}:kind==='new'?{begin:5,commit:3,writeBegin:0}:{begin:6,commit:3,writeBegin:0};
  assert.deepEqual(Object.fromEntries(Object.keys(actual).map(k=>[k,actual[k]-baseline[k]])),kind==='matched'?{begin:0,commit:0,writeBegin:0}:{begin:1,commit:1,writeBegin:1},'only the retained first-seal transaction is added');
  assert.equal(s.replacements,Number(kind==='replaced'));
});

// Existing legacy WAL is a second one-time first-open exception. Counts
// include canonical/lifecycle reads; the creation child is not involved.
for(const missing of ['row','table'])test(`standalone legacy WAL migration census: missing ${missing}`,t=>{
  const s=setup(t,{mode:'WAL'});s.close();legacyWal(s,missing);s.open();
  s.executed.length=0;const checksBefore=s.checks;s.storage.admit(2000);
  const actual={begin:s.executed.filter(q=>q.startsWith('BEGIN')).length,
    commit:s.executed.filter(q=>q==='COMMIT').length,writeBegin:s.executed.filter(q=>q==='BEGIN IMMEDIATE').length};
  const expected=missing==='row'?{begin:5,commit:4,writeBegin:1}:{begin:6,commit:5,writeBegin:1};
  t.diagnostic(JSON.stringify({missing,baseline:{begin:4,commit:3,writeBegin:0},actual,wholeFileStatements:s.checks-checksBefore}));
  assert.deepEqual(actual,expected,'absolute standalone legacy migration transaction census');
  assert.equal(s.checks-checksBefore,2);assert.equal(replacementCalls(s).length,0);assert.equal(s.valid(),true);
  assert.equal(Boolean(s.observe().publication),missing==='row','admission alone does not republish retired schema-bound pointers');
});

for(const [mode,replaced] of [['DELETE',false],['DELETE',true],['WAL',false]])test(`failed first-seal COMMIT: ${mode} ${replaced?'replacement':'new'} rolls back, clears bootstrap and recovers once`,t=>{
  const s=setup(t,{build:false,mode});
  if(replaced){s.storage.admit(2000);s.close();sql(s.path,db=>db.exec('UPDATE product_attestation SET stamp=stamp+1'));s.open();}
  const exec=DatabaseSync.prototype.exec;
  let rejected=0,rolledBack=0,seal;
  t.mock.method(DatabaseSync.prototype,'exec',function(text){
    if(text==='COMMIT'&&!rejected&&this.prepare('PRAGMA application_id').get().application_id===0x43525032){
      seal=seals.readSidecarAttestation(this);
      if(seal){
        assert.equal(seal.stamp,1);assert.equal(seals.validSidecarAttestation(s.facade.port.identity.cursorSecret,seal,seals.sidecarAttestationFile(s.path),PRODUCT_SIDECAR_FORMAT),true);
        rejected++;throw Object.assign(new Error('synthetic first-seal COMMIT rejection'),{code:'storage_error'});
      }
    }
    if(text==='ROLLBACK'&&rejected&&this.prepare('PRAGMA application_id').get().application_id===0x43525032)rolledBack++;
    return Reflect.apply(exec,this,[text]);
  });
  assert.throws(()=>s.storage.admit(2000),error=>error.constructor===Error&&error.code==='storage_error');
  assert.equal(rejected,1);assert.equal(rolledBack,1);const firstSealRollbacks=rolledBack;assert.equal(s.row(),null,'no row or half-written seal survives rollback');
  const signedWrites=s.statements.filter(q=>/^INSERT(?: OR \w+)? INTO (progress_records|validation_records|publications)\b/.test(q));
  assert.deepEqual(signedWrites,[],'no checkpoint or publication signing write was executed');
  const unsigned=sql(s.path,db=>({tables:db.prepare("SELECT count(*) n FROM sqlite_schema WHERE type='table' AND name='product_attestation'").get().n,
    seals:db.prepare('SELECT count(*) n FROM product_attestation').get().n,
    checkpoints:db.prepare('SELECT count(*) n FROM progress_records').get().n,
    validations:db.prepare('SELECT count(*) n FROM validation_records').get().n,
    publications:db.prepare('SELECT count(*) n FROM publications').get().n}));
  assert.deepEqual(unsigned,{tables:1,seals:0,checkpoints:0,validations:0,publications:0});
  assert.equal(replacementCalls(s).length,Number(replaced));assert.equal(s.checks,0);
  // Retry on this same sidecar instance: admit()'s finally must have cleared
  // the bootstrap identity. A leaked exception would skip replacement/checks.
  s.storage.admit(2000);
  assert.equal(replacementCalls(s).length,mode==='DELETE'?1+Number(replaced):0);
  assert.equal(s.checks,mode==='WAL'?2:0,'WAL missing row runs quick_check and foreign_key_check exactly once');
  assert.equal(s.valid(),true);assert.equal(s.row().stamp,1);
  assert.equal(s.observe().publication,null,'admission signs no publication');
  const checks=s.checks,replacements=replacementCalls(s).length;s.open();s.storage.admit(2000);
  assert.equal(s.checks,checks);assert.equal(replacementCalls(s).length,replacements,'matching cold admission cannot start a retry loop');
  const rebuilt=s.finish();assert.ok(rebuilt.publication);assert.equal(replacementCalls(s).length,replacements);
  t.diagnostic(JSON.stringify({mode,replaced,errorClass:'Error',code:'storage_error',rejected,firstSealRollbacks,totalSidecarRollbacks:rolledBack,signedWrites,unsigned,wholeFileStatements:s.checks,replacements}));
});

// Interleave a separate SQLite connection precisely after the opening read
// commits, before sealing acquires its writer reservation.
for(const damage of [false,true])test(`WAL sealing gap: second connection ${damage?'violates CHECK and is refused':'commits valid data before the checked seal'}`,t=>{
  const failures=[],attribution=createMaintenanceAttribution();
  const capture=attribution.captureFailure;attribution.captureFailure=error=>{failures.push(error.reason);capture(error);};
  const s=setup(t,{mode:'WAL',attribution});s.close();legacyWal(s,'row');
  const other=new DatabaseSync(s.path);t.after(()=>other.close());other.exec('PRAGMA busy_timeout=0');
  let injected=false,opening=false;
  s.setHook(text=>{if(text.includes('LEFT JOIN product_attestation'))opening=true;});
  s.afterExec((text,database)=>{
    if(text==='COMMIT'&&opening&&!injected){
      injected=true;
      other.exec('PRAGMA ignore_check_constraints=ON;BEGIN IMMEDIATE');
      other.exec(damage?"INSERT INTO product_metadata SELECT 2,store_id,profile,incarnation,kind FROM product_metadata WHERE singleton=1":"UPDATE product_metadata SET kind=kind||' gap' WHERE singleton=1");
      other.exec('COMMIT;PRAGMA ignore_check_constraints=OFF');assert.equal(database.isTransaction,false);
    }
  });
  s.open();
  if(damage){
    const fail=s.storage.admit;
    assert.throws(()=>fail(2000),{code:'index_unavailable',reason:'storage_unavailable'});
    assert.ok(failures.includes('corrupt'),'whole-file failure retains the corrupt classification before WAL refusal');
    assert.equal(s.row(),null,'a state changed after the opening read must never receive a seal');
    const check=other.prepare('PRAGMA quick_check').all();assert.ok(check.some(r=>r.quick_check.includes('CHECK constraint failed')));
  }else{
    s.storage.admit(2000);assert.equal(s.valid(),true);assert.equal(s.checks,2);
    s.open();s.storage.admit(2000);assert.equal(s.checks,2,'matching next open has zero whole-file statements');
  }
  assert.equal(injected,true);assert.equal(replacementCalls(s).length,0);
  t.diagnostic(JSON.stringify({damage,injected,sealed:s.row()!==null,checks:s.checks}));
});

test('WAL sealing lock: a second connection is busy during both whole-file checks',t=>{
  const s=setup(t,{mode:'WAL'});s.close();legacyWal(s,'row');
  const other=new DatabaseSync(s.path);t.after(()=>other.close());other.exec('PRAGMA busy_timeout=0');
  const attempts=[];
  s.setHook((text,key,database)=>{
    if(!['PRAGMA quick_check','PRAGMA foreign_key_check'].includes(text))return;
    assert.equal(database.isTransaction,true);
    assert.throws(()=>other.exec('BEGIN IMMEDIATE'),error=>{attempts.push({text,code:error.errcode&255});return (error.errcode&255)===5;});
    assert.equal(other.isTransaction,false,'second writer has not committed');
  });
  s.open();s.storage.admit(2000);assert.equal(attempts.length,2);assert.equal(s.valid(),true);
  other.exec('BEGIN IMMEDIATE;UPDATE product_metadata SET singleton=1 WHERE singleton=1;COMMIT');
  t.diagnostic(JSON.stringify({attempts,sealed:s.valid()}));
});

test('WAL sealing gap: legacy binding authentication shares the retirement transaction',t=>{
  const s=setup(t,{mode:'WAL'});s.close();legacyWal(s,'table');
  const other=new DatabaseSync(s.path);t.after(()=>other.close());other.exec('PRAGMA busy_timeout=0');
  const exec=DatabaseSync.prototype.exec;let opening=false,injected=false;
  s.setHook(text=>{if(text==='PRAGMA user_version')opening=true;});
  t.mock.method(DatabaseSync.prototype,'exec',function(text){
    if(opening&&!injected&&text==='BEGIN IMMEDIATE'){
      injected=true;other.exec("BEGIN IMMEDIATE;UPDATE validation_records SET record='unauthenticated';COMMIT");
    }
    return Reflect.apply(exec,this,[text]);
  });
  s.open();assert.throws(()=>s.storage.admit(2000),{code:'index_unavailable',reason:'validation_invalid'});
  assert.equal(injected,true);assert.equal(s.row(),null,'DDL and seal rolled back with refused retirement');
  assert.equal(other.prepare("SELECT count(*) n FROM validation_records WHERE record='unauthenticated'").get().n,1,'unauthenticated record was never retired');
  assert.equal(replacementCalls(s).length,0);
});


test('reused-handle opening deadline: expired file guard permits zero subsequent statements',t=>{
  const s=setup(t);s.storage.admit(2000);
  let expired=false;const statements=[];
  s.onFiles(()=>{if(!expired){expired=true;s.setClock(2000);s.executed.length=0;s.statements.length=0;}});
  s.setHook(text=>{if(expired)statements.push(text);});
  assert.throws(()=>s.storage.admit(2000),{code:'read_timeout'});
  assert.equal(expired,true);
  // Lifecycle release and query_only restoration are cleanup, not new work.
  assert.deepEqual(s.executed.filter(q=>q!=='ROLLBACK'&&!q.startsWith('PRAGMA query_only=')),[],'no BEGIN after cutoff');
  assert.deepEqual(statements,[],'no query_only read, schema_version or other statement after cutoff');
  t.diagnostic(JSON.stringify({expired,statements,executed:s.executed}));
});


test("numeric TEXT stamp '1' mismatches the valid integer 1 seal, replaces and rebuilds",t=>{
  const s=setup(t,{build:false});s.storage.admit(2000);assert.equal(s.row().stamp,1);s.close();
  const schema=sql(s.path,db=>db.prepare("SELECT sql FROM sqlite_schema WHERE name='product_attestation'").get().sql);
  const rewrite=type=>sql(s.path,db=>{
    db.enableDefensive?.(false);db.exec('PRAGMA writable_schema=ON');
    db.prepare("UPDATE sqlite_schema SET sql=? WHERE name='product_attestation'").run(type==='ANY'?schema.replace('stamp INTEGER NOT NULL','stamp ANY NOT NULL'):schema);
    db.exec('PRAGMA schema_version='+(db.prepare('PRAGMA schema_version').get().schema_version+1));
  });
  rewrite('ANY');sql(s.path,db=>db.exec("UPDATE product_attestation SET stamp='1'"));rewrite('INTEGER');
  const damaged=sql(s.path,db=>({schema:db.prepare("SELECT sql FROM sqlite_schema WHERE name='product_attestation'").get().sql,
    ...db.prepare('SELECT CAST(stamp AS TEXT) stamp,typeof(stamp) stampType FROM product_attestation').get()}));
  assert.deepEqual(damaged,{schema,stamp:'1',stampType:'text'},'exact STRICT INTEGER schema with a numeric TEXT payload');
  assert.equal(s.valid(),false,'numeric TEXT cannot authenticate against integer 1');
  s.open(false);assert.equal(s.observe().publication,null);
  s.open();s.storage.admit(2000);assert.equal(replacementCalls(s).length,1);assert.equal(wholeChecks(replacementCalls(s)[0]),0);
  assert.equal(s.valid(),true);assert.ok(s.finish().publication);
});

function firstSealCommitFault(t,s) {
  const exec=DatabaseSync.prototype.exec,error=Object.assign(new Error('synthetic persistent first-seal COMMIT rejection'),{code:'storage_error'});
  let armed=true,rejected=0;
  t.mock.method(DatabaseSync.prototype,'exec',function(text){
    if(armed&&text==='COMMIT'&&this.prepare('PRAGMA application_id').get().application_id===0x43525032){
      const seal=seals.readSidecarAttestation(this);
      if(seal?.stamp===1){
        assert.equal(seals.validSidecarAttestation(s.facade.port.identity.cursorSecret,seal,seals.sidecarAttestationFile(s.path),PRODUCT_SIDECAR_FORMAT),true);
        rejected++;throw error;
      }
    }
    return Reflect.apply(exec,this,[text]);
  });
  return {error,get rejected(){return rejected;},disarm(){armed=false;}};
}
function sealRows(s) {
  return sql(s.path,db=>Object.fromEntries([['seals','product_attestation'],['checkpoints','progress_records'],['validations','validation_records'],['publications','publications']]
    .map(([key,table])=>[key,db.prepare(`SELECT count(*) n FROM ${table}`).get().n])));
}
function unsignedState(s) {
  const rows=sealRows(s);assert.deepEqual(rows,{seals:0,checkpoints:0,validations:0,publications:0});
  const observed=s.observe();assert.equal(observed.publication,null);assert.notEqual(observed.dto.lexical.state,'ready');assert.equal(observed.dto.coverage.status,'unavailable');
  assert.throws(()=>s.storage.lexical(s.p,observed.publication,'canary'),{code:'index_unavailable',reason:'missing'});
  const signing=s.statements.filter(q=>/^INSERT(?: OR \w+)? INTO (progress_records|validation_records|publications)\b/.test(q));
  assert.deepEqual(signing,[],'no checkpoint, validation or publication signing writes');
  return {rows,publication:null,lexical:observed.dto.lexical.state,coverage:observed.dto.coverage.status,lexicalRead:'missing',signing:signing.length};
}
// Start DELETE with an existing unsigned empty cache, so every measured
// admission must replace it. WAL starts with no cache and seals in place.
function persistentCache(t,mode) {
  const s=setup(t,{build:false,mode});
  if(mode==='DELETE'){s.storage.admit(2000);s.close();sql(s.path,db=>db.exec('DELETE FROM product_attestation'));s.open();}
  s.statements.length=0;return s;
}
for(const mode of ['DELETE','WAL'])test(`persistent first-seal COMMIT: standalone ${mode} fails closed three times then publishes`,t=>{
  const s=persistentCache(t,mode),fault=firstSealCommitFault(t,s),attempts=[];
  for(let n=1;n<=3;n++){
    const checksBefore=s.checks;
    assert.throws(()=>s.storage.admit(2000),error=>error===fault.error);
    assert.equal(fault.rejected,n);assert.equal(replacementCalls(s).length,mode==='DELETE'?n:0);
    assert.equal(s.checks,mode==='WAL'?2*(n-1):0);
    const checksThisAttempt=s.checks-checksBefore;
    assert.equal(checksThisAttempt,mode==='WAL'&&n>1?2:0);
    attempts.push({attempt:n,replacements:replacementCalls(s).length,checks:s.checks,checksThisAttempt,...unsignedState(s)});
  }
  fault.disarm();s.storage.admit(2000);
  assert.equal(replacementCalls(s).length,mode==='DELETE'?4:0);assert.equal(s.checks,mode==='WAL'?6:0);
  assert.equal(s.valid(),true);assert.equal(s.row().stamp,1);assert.equal(s.observe().publication,null);
  const admitted={replacements:replacementCalls(s).length,checks:s.checks,rows:sealRows(s)};
  assert.deepEqual(admitted.rows,{seals:1,checkpoints:0,validations:0,publications:0});
  assert.ok(s.finish().publication);
  t.diagnostic(JSON.stringify({mode,attempts,recovery:{...admitted,rebuiltRows:sealRows(s),served:s.observe().dto.lexical.state}}));
});

test('persistent first-seal COMMIT: lexical pump stops once per host start without quarantine, then publishes',async t=>{
  const s=persistentCache(t,'DELETE'),fault=firstSealCommitFault(t,s),service=configured(t,s.f.path,[ns],{service:true});
  let time=0,serial=0,admissions=0,work=0;const timers=new Map(),receipts=new WeakMap();
  const renew=createMaintenancePumpRuntime({now:()=>time,
    setTimer:(fn,ms)=>{const id=++serial;timers.set(id,{fn,at:time+ms});return id;},clearTimer:id=>timers.delete(id),
    open:async()=>{s.open();return {close:async()=>s.close()};},
    admit:async(handle,input)=>{admissions++;try{s.storage.admit(input.budget.maxMs);const r={ok:true,value:null};receipts.set(r,'admitted');return r;}
      catch(error){return {ok:false,error:{code:error.code}};}},
    work:async(handle,input)=>{work++;const progress=s.storage.refresh(s.p,s.access,input.budget);return {ok:true,value:{status:s.observe().publication?'complete':'catching_up',progress}};},
    receiptOf:r=>receipts.get(r),observedAt:()=>time,phasesOf:()=>undefined});
  const start=()=>renew({supervisor:service.supervisor,id:randomUUID(),serviceCredential:service.token,
    window:{id:'persistent-seal',endsAtMonoMs:60000,usedItems:0,usedMs:0},budgets:{maxItems:2048,maxMs:60000},
    quantum:{maxItems:32,maxMs:1000},pollMs:25,renewalMs:20000,projections:[{options:service.options,types:['memory']}]});
  const next=async()=>{const [id,timer]=[...timers].sort((a,b)=>a[1].at-b[1].at)[0]??[];assert.ok(timer,'pump scheduled a turn');timers.delete(id);time=Math.max(time,timer.at);await timer.fn();};
  const attempts=[];
  for(let n=1;n<=3;n++){
    const pump=start();t.after(()=>pump.close());await next();const terminal=await pump.completion;
    assert.equal(terminal.error,'storage_error');assert.equal(admissions,n,'one admission per host pump start');assert.equal(fault.rejected,n);
    assert.equal(replacementCalls(s).length,n,'one replacement per host pump start');assert.equal(work,0);
    assert.equal(maintenancePumpPhaseDiagnostic(terminal).projections[0].phases.admission.count,1);
    const diagnostic=maintenancePumpDiagnostic(terminal).admission;assert.deepEqual(diagnostic,[null,null]);
    assert.equal(timers.size,0,'terminal pump schedules no automatic retry');
    s.open(false);attempts.push({start:n,admissions,retries:admissions-n,replacements:replacementCalls(s).length,diagnostic,...unsignedState(s)});s.close();await pump.close();
  }
  fault.disarm();const pump=start();t.after(()=>pump.close());await next();
  assert.equal(admissions,4);assert.equal(replacementCalls(s).length,4);assert.equal(s.valid(),true);
  const admitted={admissions,replacements:replacementCalls(s).length,rows:sealRows(s)};
  assert.deepEqual(admitted.rows,{seals:1,checkpoints:0,validations:0,publications:0});
  for(let n=0;n<100&&!s.observe().publication;n++)await next();
  assert.ok(s.observe().publication,'a new host pump seals and completes bounded rebuild');assert.equal(admissions,4);assert.equal(pump.getStatus().error,null);
  const recovery={...admitted,work,rebuiltRows:sealRows(s),served:s.observe().dto.lexical.state};await pump.close();
  t.diagnostic(JSON.stringify({attempts,recovery}));
});

for(const boundary of ['publication binding','resident metadata','binding iterator'])test(`opening deadline between prepare and execution: ${boundary}`,t=>{
  const s=setup(t);
  if(boundary==='resident metadata')s.storage.admit(2000);else s.open();
  let expired=false,lateGets=0,lateSteps=0;
  s.setPrepareHook((statement,text)=>{
    const matched=boundary==='publication binding'?text.startsWith('SELECT 1 FROM publications p LEFT JOIN validation_records'):
      boundary==='resident metadata'?text==='SELECT * FROM product_metadata WHERE singleton=1':
      text==='SELECT substr(record,1,16385) AS record FROM validation_records ORDER BY publication';
    if(!matched)return statement;
    // The clock advances only after native prepare completed. For iteration,
    // advance when next is retrieved, immediately before its first invocation.
    if(boundary!=='binding iterator'){s.setClock(2000);expired=true;}
    return new Proxy(statement,{get(target,key){const value=Reflect.get(target,key,target);if(typeof value!=='function')return value;
      return(...args)=>{
        if(key==='get'&&s.clock>=2000)lateGets++;
        const result=Reflect.apply(value,target,args);
        if(key!=='iterate')return result;
        let wrapped;wrapped=new Proxy(result,{get(iterator,method){
          if(method==='next'){s.setClock(2000);expired=true;}
          const step=Reflect.get(iterator,method,iterator);if(typeof step!=='function')return step;
          return(...values)=>{
            if(method==='next'&&s.clock>=2000)lateSteps++;
            const value=Reflect.apply(step,iterator,values);
            return value===iterator?wrapped:value;
          };
        }});return wrapped;
      };
    }});
  });
  assert.throws(()=>s.storage.admit(2000),{code:'read_timeout'});
  t.diagnostic(JSON.stringify({boundary,expired,lateGets,lateSteps}));
  assert.equal(expired,true,'the targeted native boundary was reached');
  assert.equal(lateGets,0,'no native get after prepare exhausted the deadline');
  assert.equal(lateSteps,0,'no native iterator next after expiry');
});
