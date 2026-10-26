import assert from 'node:assert/strict';
import test from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import {join} from 'node:path';
import {readTransaction,transaction,isConnectionDiscarded,STORAGE_BUSY_TIMEOUT_MS} from '../database.mjs';
import {MemoryStoreError} from '../validation.mjs';
import {createTestWorkspace} from '../../tools/testing/workspace.mjs';
import {bindingFixture,ns,ok,error,input,adoption,context} from '../testing/method-binding-fixtures.mjs';

function database(t){
  const workspace=createTestWorkspace(t),db=new DatabaseSync(join(workspace.path,'read.sqlite'),{timeout:STORAGE_BUSY_TIMEOUT_MS});
  workspace.defer(()=>{if(db.isOpen)db.close();});db.exec('CREATE TABLE sample(n INTEGER); INSERT INTO sample VALUES(1)');return db;
}
const queryOnly=db=>db.prepare('PRAGMA query_only').get().query_only;
for(const previous of [0,1])for(const refused of [false,true])test(`C02 deferred reads restore query_only=${previous}, refusal=${refused}`,t=>{
  const db=database(t),statements=[],exec=db.exec.bind(db);db.exec('PRAGMA query_only='+previous);
  t.mock.method(db,'exec',sql=>{statements.push(sql);return exec(sql);});
  const perform=()=>readTransaction(db,()=>{
    assert.equal(queryOnly(db),1);assert.equal(db.isTransaction,true);
    assert.throws(()=>db.prepare('UPDATE sample SET n=2').run(),failure=>failure.errcode===8);
    assert.throws(()=>readTransaction(db,()=>1),{code:'storage_error'});
    assert.throws(()=>transaction(db,()=>1),{code:'storage_error'});
    if(refused)throw new MemoryStoreError('invalid_cursor');
    return {n:db.prepare('SELECT n FROM sample').get().n};
  });
  if(refused)assert.throws(perform,{code:'invalid_cursor'});else assert.deepEqual(perform(),{n:1});
  assert.equal(queryOnly(db),previous);assert.equal(db.isTransaction,false);
  assert.ok(statements.includes('BEGIN'));assert.ok(!statements.includes('BEGIN IMMEDIATE'));
  assert.equal(statements.includes('ROLLBACK'),refused);
  assert.equal(db.prepare('PRAGMA busy_timeout').get().timeout,5000);
});

for(const boundary of ['enable','BEGIN','COMMIT'])test(`C02 ${boundary} failure restores state and preserves the original SQLite error`,t=>{
  const db=database(t),exec=db.exec.bind(db),statements=[],failure=Object.assign(Error('synthetic busy'),{code:'ERR_SQLITE_ERROR',errcode:5});let fired=false;
  t.mock.method(db,'exec',sql=>{statements.push(sql);if(!fired&&sql===(boundary==='enable'?'PRAGMA query_only=ON':boundary)){fired=true;throw failure;}return exec(sql);});
  assert.throws(()=>readTransaction(db,()=>({value:1})),value=>value===failure);
  assert.equal(queryOnly(db),0);assert.equal(db.isTransaction,false);assert.equal(isConnectionDiscarded(db),false);
  assert.equal(statements.includes('ROLLBACK'),boundary==='COMMIT');
  db.prepare('UPDATE sample SET n=3').run();assert.equal(readTransaction(db,()=>db.prepare('SELECT n FROM sample').get()).n,3);
});

test('C02 a caller-owned transaction survives refusal without rollback or pragma changes',t=>{
  const db=database(t);db.exec('BEGIN');db.prepare('UPDATE sample SET n=2').run();
  assert.throws(()=>readTransaction(db,()=>1),{code:'storage_error'});
  assert.equal(db.isTransaction,true);assert.equal(queryOnly(db),0);assert.equal(db.prepare('SELECT n FROM sample').get().n,2);db.exec('ROLLBACK');
  assert.equal(db.prepare('SELECT n FROM sample').get().n,1);
});

for(const boundary of ['ROLLBACK','restore'])test(`C02 failed ${boundary} cleanup restores what it can and discards the connection`,t=>{
  const db=database(t),exec=db.exec.bind(db),statements=[];
  t.mock.method(db,'exec',sql=>{statements.push(sql);if(sql===(boundary==='restore'?'PRAGMA query_only=OFF':'ROLLBACK'))throw Error('synthetic cleanup failure');return exec(sql);});
  assert.throws(()=>readTransaction(db,()=>{throw new MemoryStoreError('method_not_found');}),/synthetic cleanup failure/);
  assert.ok(statements.includes('PRAGMA query_only=OFF'));assert.equal(isConnectionDiscarded(db),true);assert.equal(db.isOpen,false);
  assert.throws(()=>readTransaction(db,()=>1),{code:'store_closed'});
});

test('C02 failed native close still poisons the connection and prevents further transactions',t=>{
  const db=database(t),exec=db.exec.bind(db),close=db.close.bind(db);
  const execMock=t.mock.method(db,'exec',sql=>{if(sql==='PRAGMA query_only=OFF')throw Error('restore failed');return exec(sql);});
  const closeMock=t.mock.method(db,'close',()=>{throw Error('close failed');});
  assert.throws(()=>readTransaction(db,()=>1),/restore failed/);
  assert.equal(isConnectionDiscarded(db),true);assert.throws(()=>transaction(db,()=>1),{code:'storage_error'});
  assert.throws(()=>readTransaction(db,()=>1),{code:'store_closed'});execMock.mock.restore();closeMock.mock.restore();close();
});

test('C02 asynchronous callbacks and escaping promises or iterators cannot own a read connection',t=>{
  let ran=false;const db=database(t);
  assert.throws(()=>readTransaction(db,async()=>{ran=true;}),{code:'storage_error'});assert.equal(ran,false);assert.equal(queryOnly(db),0);
  for(const make of [()=>Promise.resolve(1),db=>({rows:db.prepare('SELECT n FROM sample').iterate()}),
    db=>new Map([['rows',db.prepare('SELECT n FROM sample').iterate()]]),
    db=>({[Symbol('rows')]:db.prepare('SELECT n FROM sample').iterate()})]){
    const connection=database(t);assert.throws(()=>readTransaction(connection,()=>make(connection)),{code:'storage_error'});
    assert.equal(isConnectionDiscarded(connection),true);assert.equal(connection.isOpen,false);
  }
});

const operations=receipt=>[
  ['getMethodVersion',{version:receipt.version,intent:'history'}],['listMethodManifest',{version:receipt.version,intent:'history'}],
  ['readMethodFile',{version:receipt.version,intent:'history',path:'SKILL.md'}],['listMethodPackages',{namespace:ns}],
  ['listMethodVersions',{package:receipt.package}],['compareMethodVersions',{from:receipt.version,to:receipt.version}],
  ['listMethodEffects',{namespace:ns}],['getMethodPackageUsage',{namespace:ns}],
  ['resolveMethod',{package:receipt.package,...context()}],['resolveMethodsForRole',context()],
  ['listMethodBindingEvents',{bindingNamespace:ns}],['checkMethodReasonRefs',{namespace:ns,reasonRefs:[]}],
];
for(let index=0;index<12;index++)test(`C02 every method read rejects forced writes and restores its connection: ${operations({})[index][0]}`,t=>{
  const f=bindingFixture(t),receipt=ok(f.call('importMethodVersion',input()));ok(f.call('adoptMethodVersion',adoption(receipt)));
  const [method,args]=operations(receipt)[index],exec=DatabaseSync.prototype.exec;let injected=false,connection,writeError;
  const mock=t.mock.method(DatabaseSync.prototype,'exec',function(sql){
    const result=exec.call(this,sql);
    if(!injected&&sql==='BEGIN'){
      connection=this;injected=true;assert.equal(this.prepare('PRAGMA query_only').get().query_only,1);
      try{this.prepare('UPDATE method_packages SET revision=revision+100').run();}catch(failure){writeError=failure;throw failure;}
    }
    return result;
  });
  error(f.call(method,args),'storage_error');mock.mock.restore();
  assert.equal(injected,true);assert.equal(writeError.errcode,8);assert.equal(queryOnly(connection),0);assert.equal(connection.isTransaction,false);
  assert.equal(f.db.prepare('SELECT revision FROM method_packages').get().revision,1);
  ok(f.call(method,args));
  ok(f.call('disableMethodBinding',{bindingNamespace:ns,package:receipt.package,roleId:'reviewer',readSet:[ns],expectedRevision:1,actionId:'after-read'}));
});

test('C02 refusals restore the method connection and host authority callbacks run outside its transaction',t=>{
  const f=bindingFixture(t),receipt=ok(f.call('importMethodVersion',input()));let connection;
  const prepare=DatabaseSync.prototype.prepare,mock=t.mock.method(DatabaseSync.prototype,'prepare',function(sql){if(sql==='PRAGMA query_only')connection=this;return prepare.call(this,sql);});
  ok(f.call('getMethodVersion',{version:receipt.version,intent:'history'}));
  f.state.hook=()=>{assert.equal(connection.isTransaction,false);assert.equal(queryOnly(connection),0);};
  for(const [args,code] of [[{version:receipt.version,intent:'history',path:'missing'},'method_not_found'],
    [{version:receipt.version,intent:'history',path:'SKILL.md',cursor:'invalid'},'invalid_cursor']]){
    error(f.call('readMethodFile',args),code);assert.equal(queryOnly(connection),0);assert.equal(connection.isTransaction,false);
  }
  mock.mock.restore();
});
