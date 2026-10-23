import assert from 'node:assert/strict';
import test from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import urls from 'node:url';
import {syncBuiltinESMExports} from 'node:module';
import {join} from 'node:path';
import {existsSync,readFileSync,writeFileSync,unlinkSync,renameSync} from 'node:fs';
import {openDatabase} from '../database.mjs';
import {openMemoryCore} from '../contract.mjs';
import {pinStoreFile,storeIdentity,storeFenceOption,noncreatingStoreURI} from '../store-fence.mjs';
import {createTestWorkspace} from '../../tools/testing/workspace.mjs';
import {restoreHistoricalStore,host} from '../testing/method-package-fixtures.mjs';

function fixture(t,version=29){
  const workspace=createTestWorkspace(t),path=join(workspace.path,'store.sqlite');restoreHistoricalStore(path,version);
  const pin=pinStoreFile(path);workspace.defer(()=>pin.close());
  const db=new DatabaseSync(path,{readOnly:true});let identity;
  try{db.exec('BEGIN');identity=storeIdentity(db);db.exec('COMMIT');}finally{db.close();}
  return {workspace,path,pin,fence:storeFenceOption({version:'store-fence-v1',...pin.identity,...identity})};
}
test('H03 ordinary fenced opener is noncreating, writable and migrates a matching historical store through openMemoryCore',t=>{
  const f=fixture(t,18),trusted=host();
  const core=openMemoryCore({path:f.path,storeFence:f.fence,methodPackages:trusted.options});core.close();
  const db=new DatabaseSync(f.path,{readOnly:true});
  try{assert.equal(db.prepare('PRAGMA user_version').get().user_version,30);assert.equal(storeIdentity(db).storeId,f.fence.storeId);}
  finally{db.close();}
});

test('H03 mode=rw opens an existing store and refuses missing or disappeared files without recreation',t=>{
  const f=fixture(t),uri=noncreatingStoreURI(f.path);let db=new DatabaseSync(uri);db.close();
  const retained=f.path+'.retained';renameSync(f.path,retained);
  assert.throws(()=>new DatabaseSync(uri),error=>error.errcode===14);
  assert.ok(!existsSync(f.path));assert.ok(existsSync(retained));
  const missing=join(f.workspace.path,'missing-parent','missing.sqlite');
  assert.throws(()=>openDatabase(missing,{storeFence:f.fence}),{code:'method_not_found'});
  assert.ok(!existsSync(missing));assert.ok(!existsSync(join(f.workspace.path,'missing-parent')));
});

test('H03 disappearance after the filesystem check still cannot recreate the file at the SQLite open boundary',t=>{
  const f=fixture(t),bytes=readFileSync(f.path),retained=f.path+'.retained',original=urls.pathToFileURL;
  t.mock.method(urls,'pathToFileURL',path=>{
    if(path===f.path){renameSync(path,retained);}
    return original(path);
  });syncBuiltinESMExports();
  try{assert.throws(()=>openDatabase(f.path,{storeFence:f.fence,methodPackages:true}),error=>error.errcode===14);}
  finally{t.mock.restoreAll();syncBuiltinESMExports();}
  assert.ok(!existsSync(f.path));assert.deepEqual(readFileSync(retained),bytes);
});

for(const field of ['applicationId','userVersion','storeId'])test(`H03 ${field} mismatch rolls back inside the ordinary transaction before any initialization or migration`,t=>{
  const f=fixture(t),expected={...f.fence,[field]:field==='storeId'?'another-store':f.fence[field]+1},bytes=readFileSync(f.path),statements=[];
  const original=DatabaseSync.prototype.exec;
  t.mock.method(DatabaseSync.prototype,'exec',function(sql){statements.push(sql);return original.call(this,sql);});
  assert.throws(()=>openDatabase(f.path,{storeFence:expected,methodPackages:true}),{code:'unsupported_database'});
  assert.ok(statements.includes('BEGIN IMMEDIATE'));assert.ok(statements.includes('ROLLBACK'));
  assert.ok(!statements.some(sql=>/\b(?:CREATE|ALTER|INSERT|UPDATE|DELETE)\b/i.test(sql)));
  assert.deepEqual(readFileSync(f.path),bytes);
});

test('H03 identity is checked after BEGIN IMMEDIATE rather than only before acquiring the transaction',t=>{
  const f=fixture(t),original=DatabaseSync.prototype.exec;let changed,inside=false;
  t.mock.method(DatabaseSync.prototype,'exec',function(sql){
    if(sql==='BEGIN IMMEDIATE'&&!inside){
      inside=true;const other=new DatabaseSync(f.path);
      try{other.prepare('UPDATE store_metadata SET store_id=?').run('replacement-identity');}finally{other.close();}
      changed=readFileSync(f.path);
    }
    return original.call(this,sql);
  });
  assert.throws(()=>openDatabase(f.path,{storeFence:f.fence,methodPackages:true}),{code:'unsupported_database'});
  assert.ok(changed);assert.deepEqual(readFileSync(f.path),changed);
});

test('H03 replaced filesystem identity refuses before opening or migrating a different populated store',t=>{
  const f=fixture(t),retained=f.path+'.retained',bytes=readFileSync(f.path);renameSync(f.path,retained);restoreHistoricalStore(f.path,18);
  const replacement=readFileSync(f.path);
  assert.throws(()=>openDatabase(f.path,{storeFence:f.fence,methodPackages:true}),{code:'unsafe_database_file'});
  assert.deepEqual(readFileSync(f.path),replacement);assert.deepEqual(readFileSync(retained),bytes);
});

for(const suffix of ['-journal','-wal','-shm'])test(`H03 review pin refuses an existing ${suffix} auxiliary without opening SQLite`,t=>{
  const f=fixture(t),bytes=readFileSync(f.path);writeFileSync(f.path+suffix,'synthetic auxiliary');
  assert.throws(()=>pinStoreFile(f.path),{code:'unsafe_database_file'});
  assert.deepEqual(readFileSync(f.path),bytes);assert.equal(readFileSync(f.path+suffix,'utf8'),'synthetic auxiliary');
});

test('H03 review pin refuses WAL headers even after WAL companions have disappeared',t=>{
  const f=fixture(t),db=new DatabaseSync(f.path);db.exec('PRAGMA journal_mode=WAL');db.close();
  assert.equal(readFileSync(f.path)[18],2);assert.equal(readFileSync(f.path)[19],2);
  const bytes=readFileSync(f.path);
  assert.throws(()=>pinStoreFile(f.path),{code:'unsafe_database_file'});
  assert.deepEqual(readFileSync(f.path),bytes);
});

test('H03 fence cannot relax the validation-only managed opener or accept accessors',t=>{
  const f=fixture(t),trusted=host(),bytes=readFileSync(f.path);
  assert.throws(()=>openMemoryCore({path:f.path,storeFence:f.fence,existingStore:{version:'schema29-existing-v1',storeId:f.fence.storeId},methodPackages:trusted.options}),{code:'invalid_input'});
  const accessor={...f.fence};Object.defineProperty(accessor,'storeId',{get(){throw Error('must not execute');}});
  assert.throws(()=>openMemoryCore({path:f.path,storeFence:accessor}),{code:'invalid_input'});
  assert.deepEqual(readFileSync(f.path),bytes);
});
