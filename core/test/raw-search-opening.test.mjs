import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createHmac } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { openRawSearchStorage } from '../raw-search-storage.mjs';
import { openRawSearch } from '../raw-search-index.mjs';
import { sourceFixture, savedSource } from '../testing/raw-source-fixtures.mjs';
import { searchFixture, broker } from '../testing/raw-search-fixtures.mjs';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';

function clock(t) {
  const own=Object.getOwnPropertyDescriptor(performance,'now');let now=100;
  Object.defineProperty(performance,'now',{configurable:true,value:()=>now});
  t.after(()=>{if(own)Object.defineProperty(performance,'now',own);else delete performance.now;});
  return value=>{now=value;};
}
async function storageFixture(t) {
  const ws=createTestWorkspace(t,{prefix:'raw-opening-'});
  const options={directory:ws.path,identity:{storeId:'synthetic-store',fileIdentity:'1:2',ownerId:'synthetic-owner',readSet:[]},
    bind:(purpose,value)=>createHmac('sha256','synthetic-secret').update(JSON.stringify([purpose,value])).digest('base64url'),quotaBytes:1024*1024};
  const store=await openRawSearchStorage(options);ws.defer(()=>store.close());
  const path=join(ws.path,readdirSync(ws.path).find(name=>name.endsWith('.sqlite')));
  return {options,store,path};
}
test('Raw sidecar reopens through attestation without a whole-file check and retains seals across vacuum',async t=>{
  const {options,store,path}=await storageFixture(t);
  await store.publish(await store.stage({key:'one'}),null);
  const db=new DatabaseSync(path);t.after(()=>db.close());
  const before=db.prepare('SELECT stamp FROM product_attestation').get().stamp;
  await store.dropOwner();
  assert.ok(db.prepare('SELECT stamp FROM product_attestation').get().stamp>before);
  const prepare=DatabaseSync.prototype.prepare;
  DatabaseSync.prototype.prepare=function(sql){assert.doesNotMatch(sql,/PRAGMA (?:quick_check|integrity_check)/i);return prepare.call(this,sql);};
  t.after(()=>{DatabaseSync.prototype.prepare=prepare;});
  const reopened=await openRawSearchStorage(options);t.after(()=>reopened.close());
  assert.equal((await reopened.snapshot()).rows.length,0);
});
for(const damage of ['record','stamp','copy'])test(`Raw sidecar rejects an invalid attestation at reopen: ${damage}`,async t=>{
  const {options,store,path}=await storageFixture(t);await store.close();
  if(damage==='copy') {
    const {copySqliteFixture}=await import('../testing/content-safety-s2h-fixture.mjs');
    const target=path+'.copy';copySqliteFixture(path,target);
    const {renameSync}=await import('node:fs');renameSync(target,path);
  } else {
    const db=new DatabaseSync(path);
    try{db.exec(damage==='record'?"UPDATE product_attestation SET record='invalid'":"UPDATE product_attestation SET stamp=stamp+1");}finally{db.close();}
  }
  await assert.rejects(openRawSearchStorage(options),{code:'forged_index'});
});
test('legacy DELETE hints require explicit replacement without an unbounded reset',async t=>{
  const {options,store,path}=await storageFixture(t);
  await store.publish(await store.stage({key:'old'}),null);await store.close();
  const db=new DatabaseSync(path);
  db.exec("DROP TABLE product_attestation; WITH RECURSIVE n(i) AS (VALUES(2) UNION ALL SELECT i+1 FROM n WHERE i<5000) INSERT INTO segments SELECT i,'legacy-'||i,'{}','legacy',X'',1 FROM n");
  const before=db.prepare('SELECT count(*) AS n FROM segments').get();
  const schema=db.prepare('SELECT type,name,sql FROM sqlite_schema ORDER BY name').all();db.close();
  await assert.rejects(openRawSearchStorage(options),{code:'index_corrupt'});
  const after=new DatabaseSync(path);
  try {
    assert.deepEqual(after.prepare('SELECT count(*) AS n FROM segments').get(),before);
    assert.equal(before.n,5000);
    assert.deepEqual(after.prepare('SELECT type,name,sql FROM sqlite_schema ORDER BY name').all(),schema);
  } finally {after.close();}
});
for(const stage of ['prepare','step'])test(`Raw opening deadline stops before the next native ${stage} and closes the handle`,async t=>{
  const {options,store}=await storageFixture(t);await store.close();const set=clock(t);
  const prepare=DatabaseSync.prototype.prepare;let observed,steps=0;
  DatabaseSync.prototype.prepare=function(sql){
    const statement=prepare.call(this,sql);
    if(sql.startsWith('SELECT CAST(stamp AS TEXT)')) {
      observed=this;
      const get=statement.get;statement.get=function(...args){steps++;const result=get.apply(this,args);if(stage==='prepare')set(201);return result;};
      if(stage==='step')set(201);
    }
    return statement;
  };
  t.after(()=>{DatabaseSync.prototype.prepare=prepare;});
  await assert.rejects(openRawSearchStorage({...options,deadlineAt:200}),{code:'search_deadline'});
  assert.equal(steps,stage==='step'?0:1);assert.equal(observed.isOpen,false);
});
test('reused Raw publication checks the deadline before its prepared read and rolls back',async t=>{
  const {store}=await storageFixture(t),set=clock(t);
  const prepare=DatabaseSync.prototype.prepare;let observed,steps=0;
  DatabaseSync.prototype.prepare=function(sql){const statement=prepare.call(this,sql);
    if(sql==='SELECT * FROM header WHERE singleton=1') {
      observed=this;set(201);const get=statement.get;statement.get=function(...args){steps++;return get.apply(this,args);};
    }
    return statement;
  };
  t.after(()=>{DatabaseSync.prototype.prepare=prepare;});
  assert.throws(()=>store.publication({deadlineAt:200}),{code:'search_deadline'});
  assert.equal(steps,0);assert.equal(observed.isTransaction,false);
});
test('Raw factory opening shares one deadline through canonical statements and sidecar admission',async t=>{
  const f=sourceFixture(t),s=await searchFixture(f);await s.service.close();const set=clock(t);
  const prepare=DatabaseSync.prototype.prepare;let observed,steps=0;
  DatabaseSync.prototype.prepare=function(sql){const statement=prepare.call(this,sql);
    if(sql==='PRAGMA application_id') {
      observed=this;set(1101);const get=statement.get;statement.get=function(...args){steps++;return get.apply(this,args);};
    }
    return statement;
  };
  t.after(()=>{DatabaseSync.prototype.prepare=prepare;});
  await assert.rejects(openRawSearch(s.options),{code:'raw_search_unavailable'});
  assert.equal(steps,0);assert.equal(observed.isOpen,false);
});
test('explicit Raw maintenance requests only work turns with its own quantum',async t=>{
  const f=sourceFixture(t);await savedSource(f,'Synthetic copper telescope.');
  const requests=[],port=broker(),s=await searchFixture(f,{maintenanceTurn:{...port,createTurn(request){requests.push(request);return port.createTurn(request);}}});
  await s.maintain({maxMs:123});assert.ok(requests.length);
  for(const request of requests){assert.equal(request.phase,'work');assert.equal(request.maxMs,123);}
});
