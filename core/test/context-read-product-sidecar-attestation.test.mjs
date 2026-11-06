import '../testing/context-product-test-clock.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { createHmac } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { fixture, ns, ok } from '../testing/context-read-fixture.mjs';
import { configured } from '../testing/context-product-owner-fixture.mjs';
import { selection } from '../testing/context-product-verification-fixture.mjs';
import { productSidecar, PRODUCT_SIDECAR_SUFFIX, PRODUCT_SIDECAR_FORMAT } from '../context-product-sidecar.mjs';
import { openContextProductFacade } from '../context-read-facade.mjs';
import { accessDigest } from '../context-product-validation.mjs';
import { createProductSqlitePolicy } from '../context-product-sqlite.mjs';
import { nativeObserver } from '../context-product-telemetry.mjs';
import { sqliteFileStat } from '../sqlite-journal-probe.mjs';
// Keep the fail-before test runnable against the engine before this module exists.
const seals=await import('../context-product-sidecar-attestation.mjs').catch(()=>({}));
const stamp=path=>{const s=sqliteFileStat(path);return [s.dev,s.ino,s.size,s.mtimeNs,s.ctimeNs].join(':');};
function sql(path,work){const db=new DatabaseSync(path);try{return work(db);}finally{db.close();}}
function child(code,...args){const r=childProcess.spawnSync(process.execPath,['--input-type=module','-e',code,...args],{encoding:'utf8',env:{},timeout:10000});assert.equal(r.status,0,r.stderr);assert.equal(r.error,undefined);return r.stdout;}
function setup(t,{build=true,mode='DELETE'}={}) {
  const f=fixture(t),first=f.admit('attestation first canary'),second=f.admit('attestation second canary');
  const path=f.path+PRODUCT_SIDECAR_SUFFIX,p=selection,access=accessDigest({ownerId:ns.ownerId,namespaces:{readSet:[ns]}});
  const children=[],statements=[],commits=[],transactions=new WeakMap(),sideDatabases=new WeakSet();
  let clock=0,delayChecks=false,checks=0,storage,hook=()=>{},afterExec=()=>{};
  const base=nativeObserver(),observer={...base,creation(work){return base.creation(()=>{const report=work();children.push(report);return report;});}};
  const sqlite=createProductSqlitePolicy({observer,now:()=>clock});sqlite.start(Infinity);
  const facade=openContextProductFacade(f.path,{sqlite});
  const prepare=DatabaseSync.prototype.prepare,exec=DatabaseSync.prototype.exec;
  t.mock.method(DatabaseSync.prototype,'prepare',function(text){
    if(text.includes('FROM product_metadata'))sideDatabases.add(this);
    const statement=Reflect.apply(prepare,this,[text]),database=this;
    return new Proxy(statement,{get(target,key){const value=Reflect.get(target,key,target);if(typeof value!=='function')return value;
      return (...args)=>{
        if(['get','all','iterate','run'].includes(key)){
          statements.push(text);hook(text,key,database);
          if(text==='PRAGMA quick_check'||text==='PRAGMA foreign_key_check'){checks++;if(delayChecks)clock+=1500;}
          if(sideDatabases.has(database)&&text.startsWith('INSERT INTO product_attestation')&&key==='run'){
            const tx=transactions.get(database);assert.ok(tx,'seal write belongs to a transaction');tx.sealed=true;tx.stamp=args[0];
          }
        }
        return Reflect.apply(value,target,args);
      };}});
  });
  t.mock.method(DatabaseSync.prototype,'exec',function(text){
    const writing=sideDatabases.has(this)&&transactions.has(this);
    if(sideDatabases.has(this)){
      if(text==='BEGIN IMMEDIATE')transactions.set(this,{sealed:false});
      if(text==='COMMIT'&&transactions.has(this)){
        const tx=transactions.get(this);
        if(seals.validSidecarAttestation)assert.equal(tx?.sealed,true,'every parent sidecar COMMIT includes a seal update');
        commits.push(tx);transactions.delete(this);
      }
      if(text==='ROLLBACK')transactions.delete(this);
    }
    const result=Reflect.apply(exec,this,[text]);afterExec(text,this,writing);return result;
  });
  const options={path:f.path,db:facade.port.db,identity:facade.port.identity,features:facade.port.features,observer,sqlite,writable:true,sidecarJournalMode:mode,now:()=>clock};
  const s={f,path,p,access,first,second,facade,children,statements,commits,
    get storage(){return storage;},get clock(){return clock;},get checks(){return checks;},
    setHook(fn){hook=fn;},afterExec(fn){afterExec=fn;},setClock(n){clock=n;},delayChecks(){delayChecks=true;},
    open(write=true){storage?.close();storage=productSidecar({...options,writable:write});return storage;},
    observe(){return storage.observe(p,access);},
    finish(){for(let i=0;i<100;i++){storage.refresh(p,access,{maxItems:32,maxMs:1000});const r=s.observe();if(r.publication)return r;}assert.fail('bounded rebuild converges');},
    close(){storage?.close();storage=null;},
    row(){return sql(path,db=>seals.readSidecarAttestation(db));},
    valid(){return seals.validSidecarAttestation(facade.port.identity.cursorSecret,s.row(),seals.sidecarAttestationFile(path),PRODUCT_SIDECAR_FORMAT);}};
  f.workspace.defer(()=>{s.close();facade.close();});s.open();if(build)s.finish();return s;
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

test('structural: initialization, work, GC, vector writes, reset and publication all seal their commits',t=>{
  const s=setup(t,{build:false});s.storage.admit(2000);const first=s.row().stamp;s.finish();
  s.f.admit('delta attestation canary');s.finish();
  s.storage.vectors(db=>db.exec('DELETE FROM vector_work'),true);
  s.storage.reset();s.finish();
  assert.ok(s.commits.length>10);assert.ok(s.commits.every(tx=>tx.sealed));
  assert.equal(new Set(s.commits.map(tx=>tx.stamp)).size,s.commits.length);
  assert.equal(s.row().stamp,s.commits.length);assert.equal(first,1);assert.equal(s.valid(),true);
  assert.ok(s.statements.some(text=>text.startsWith('INSERT INTO validation_records')),'publication was exercised');
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
  s.setHook(text=>{if(!injected&&text==='SELECT * FROM product_metadata WHERE singleton=1'){injected=true;throw Object.assign(Error('synthetic corrupt'),{code:'ERR_SQLITE_ERROR',errcode:11});}});
  s.open();assert.throws(()=>s.storage.admit(2000),{code:'index_unavailable'});
  assert.equal(injected,true);const report=replacementCalls(s).at(-1);assert.equal(wholeChecks(report),2);assert.equal(report.value.error,'ESTALE');
});

test('SQLITE_CORRUPT continues into repair when the child confirms corruption',t=>{
  const s=setup(t);s.close();let injected=false;
  s.setHook(text=>{if(!injected&&text==='SELECT * FROM product_metadata WHERE singleton=1'){injected=true;throw Object.assign(Error('synthetic corrupt'),{code:'ERR_SQLITE_ERROR',errcode:11});}});
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
    for(const value of [secret,derived.toString('hex'),derived.toString('base64'),derived.toString('base64url')])assert.equal(serialized.includes(value),false);
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
  let lookups=0;s.setHook(text=>{if(/FROM product_attestation WHERE singleton=1/.test(text))lookups++;});
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
  'SELECT CAST(stamp AS TEXT) AS stamp,typeof(stamp) AS stampType,record FROM product_attestation WHERE singleton=1'])
test(`opening deadline stops at the statement boundary after ${boundary}`,t=>{
  const s=setup(t);s.close();let expired=false,journals=0;const after=[];
  s.setHook(text=>{
    if(expired&&!['ROLLBACK','PRAGMA query_only'].some(prefix=>text.startsWith(prefix)))after.push(text);
    if(text===boundary&&(boundary!=='PRAGMA journal_mode'||++journals===2)){expired=true;s.setClock(2000);}
  });
  s.open();assert.throws(()=>s.storage.admit(2000),{code:'read_timeout'});
  assert.equal(expired,true);assert.deepEqual(after,[],'no subsequent storage statement starts after cutoff');
});

