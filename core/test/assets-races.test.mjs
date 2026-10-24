import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync,writeFileSync } from 'node:fs';
import { fixture,ns,project,input,pdf,ok,error,child } from '../testing/asset-fixtures.mjs';
import { race,launch,until } from '../testing/asset-race.mjs';
const metadata=value=>Object.fromEntries(Object.entries(value).filter(([key])=>key!=='bytes'));
const counts=db=>Object.fromEntries(['assets','asset_versions','binary_objects','binary_chunks','binary_owner_usage','asset_operations','asset_effects'].map(table=>[table,db.prepare('SELECT count(*) n FROM '+table).get().n]));
function consistent(f){
  assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(),[]);
  assert.equal(f.db.prepare('SELECT coalesce(sum(byte_count),0) n FROM binary_owner_usage').get().n,f.db.prepare('SELECT coalesce(sum(byte_count),0) n FROM binary_objects').get().n);
  assert.equal(f.db.prepare("SELECT count(*) n FROM asset_versions v LEFT JOIN binary_objects o ON o.id=v.object_id WHERE v.state='available' AND o.id IS NULL").get().n,0);
}
test('K05 process killed immediately before COMMIT leaves no binary rows, quota, receipts or effects',async t=>{
  const f=fixture(t),before=counts(f.db),worker=launch(f,{method:'importAssetVersion',input:{...metadata(input()),byteCount:100000},killBeforeCommit:true});
  await until(()=>existsSync(worker.config.ready),'kill child ready');writeFileSync(worker.config.start,'go');
  await until(()=>existsSync(worker.config.beforeCommit),'kill child has staged complete mutation');
  assert.ok(!existsSync(worker.config.result));worker.child.kill('SIGKILL');assert.deepEqual(await worker.closed,{code:null,signal:'SIGKILL'});
  f.reopen();assert.deepEqual(counts(f.db),before);consistent(f);
  child(`import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';const db=new DatabaseSync(process.argv[1]);try{for(const table of ['assets','asset_versions','binary_objects','binary_chunks','binary_owner_usage','asset_operations','asset_effects'])assert.equal(db.prepare('SELECT count(*) n FROM '+table).get().n,0);assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);}finally{db.close();}`,[f.path]);
});
test('K06 independent concurrent version imports have exactly one CAS winner, atomic ordinals and durable replay/effects',async t=>{
  const f=fixture(t),first=ok(f.call('importAssetVersion',input())),operations=['a','b'].map(id=>({method:'importAssetVersion',input:{...metadata(input('race-'+id,{asset:first.asset,expectedAssetRevision:1})),byteCount:33000}}));
  const results=await race(f,operations),winner=results.findIndex(result=>result.ok);assert.notEqual(winner,-1);assert.equal(results.filter(result=>result.ok).length,1);
  error(results[1-winner],'revision_conflict');assert.equal(results[winner].value.ordinal,2);assert.equal(results[winner].value.assetRevision,2);
  const retry={...operations[winner].input,bytes:pdf(33000)};delete retry.byteCount;
  assert.deepEqual(ok(f.call('importAssetVersion',retry)),results[winner].value);
  assert.equal(f.db.prepare('SELECT count(*) n FROM asset_versions').get().n,2);assert.equal(f.db.prepare('SELECT count(*) n FROM asset_effects').get().n,2);consistent(f);
});
test('K06 independent owner quota reservations across namespaces commit exactly once without partial rows', {timeout:90000},async t=>{
  const f=fixture(t),max=33554432,seed=pdf(max);
  for(let i=0;i<5;i++)ok(f.call('importAssetVersion',input('seed-'+i,{bytes:seed})));
  const operations=['a','b'].map(id=>({method:'importAssetVersion',input:{...metadata(input('quota-'+id,{namespace:id==='a'?ns:project})),byteCount:20000000}}));
  const results=await race(f,operations);assert.equal(results.filter(result=>result.ok).length,1);error(results.find(result=>!result.ok),'quota_reached');
  assert.equal(f.db.prepare('SELECT byte_count FROM binary_owner_usage').get().byte_count,5*max+20000000);
  assert.equal(f.db.prepare('SELECT count(*) n FROM assets').get().n,6);assert.equal(f.db.prepare('SELECT count(*) n FROM asset_versions').get().n,6);
  assert.equal(f.db.prepare('SELECT count(*) n FROM asset_operations').get().n,6);assert.equal(f.db.prepare('SELECT count(*) n FROM asset_effects').get().n,6);consistent(f);
  const winner=results.find(result=>result.ok).value,loser=results.findIndex(result=>!result.ok);
  ok(f.call('deleteAsset',{actionId:'quota-release',ref:winner.asset,expectedRevision:1}));
  assert.equal(f.db.prepare('SELECT byte_count FROM binary_owner_usage').get().byte_count,5*max);
  const retry={...operations[loser].input,bytes:pdf(20000000)};delete retry.byteCount;ok(f.call('importAssetVersion',retry));
  assert.equal(f.db.prepare('SELECT byte_count FROM binary_owner_usage').get().byte_count,5*max+20000000);consistent(f);
  const remaining=200000000-(5*max+20000000);
  ok(f.call('importAssetVersion',input('fill-to-boundary',{bytes:pdf(remaining-3)})));
  const exact=ok(f.call('importAssetVersion',input('exact-owner-limit',{filename:'tiny.jpg',mediaType:'image/jpeg',bytes:Buffer.from('ffd8ff','hex')})));
  assert.equal(f.db.prepare('SELECT byte_count FROM binary_owner_usage').get().byte_count,200000000);
  ok(f.call('deleteAsset',{actionId:'release-three',ref:exact.asset,expectedRevision:1}));
  const before=counts(f.db);
  error(f.call('importAssetVersion',input('one-over-owner-limit',{filename:'tiny.ttf',mediaType:'font/ttf',bytes:Buffer.from('00010000','hex')})),'quota_reached');
  assert.deepEqual(counts(f.db),before);assert.equal(f.db.prepare('SELECT byte_count FROM binary_owner_usage').get().byte_count,199999997);consistent(f);
});
for(const kind of ['deleteAsset','deleteAssetVersion'])test(`K06 import versus ${kind} is linearizable; no late child resurrects or double releases`,async t=>{
  const f=fixture(t),first=ok(f.call('importAssetVersion',input()));
  const operations=[{method:'importAssetVersion',input:{...metadata(input('race-import',{asset:first.asset,expectedAssetRevision:1})),byteCount:33000}},
    {method:kind,input:{actionId:'race-delete',ref:kind==='deleteAsset'?first.asset:first.version,expectedRevision:1}}];
  const results=await race(f,operations);
  if(kind==='deleteAsset') {
    assert.equal(results.filter(result=>result.ok).length,1);error(results.find(result=>!result.ok),'revision_conflict');
    if(results[1].ok){assert.equal(f.db.prepare('SELECT count(*) n FROM binary_objects').get().n,0);assert.equal(f.db.prepare('SELECT byte_count FROM binary_owner_usage').get().byte_count,0);}
  } else {
    assert.equal(results[1].ok,true);if(!results[0].ok)error(results[0],'revision_conflict');
    assert.equal(f.db.prepare('SELECT byte_count FROM binary_owner_usage').get().byte_count,results[0].ok?33000:0);
  }
  const parent=f.db.prepare('SELECT * FROM assets').get();
  if(parent.state==='available')ok(f.call('deleteAsset',{actionId:'final-purge',ref:first.asset,expectedRevision:parent.revision}));
  const tombstone=f.db.prepare('SELECT * FROM assets').get();
  error(f.call('importAssetVersion',input('late-child',{asset:first.asset,expectedAssetRevision:tombstone.revision})),'asset_version_unavailable');
  for(const [i,result]of results.entries())if(result.ok){const value={...operations[i].input};if(value.byteCount){value.bytes=pdf(value.byteCount);delete value.byteCount;}assert.deepEqual(ok(f.call(operations[i].method,value)),result.value);}
  assert.equal(f.db.prepare('SELECT count(*) n FROM binary_objects').get().n,0);assert.equal(f.db.prepare('SELECT byte_count FROM binary_owner_usage').get().byte_count,0);consistent(f);
});
test('K07 independent deletion linearizes between complete chunk pages; a valid continuation then reports unavailable',async t=>{
  const f=fixture(t),original=pdf(327680),receipt=ok(f.call('importAssetVersion',input('paged',{bytes:original})));
  const worker=launch(f,{method:'deleteAssetVersion',input:{actionId:'concurrent-delete',ref:receipt.version,expectedRevision:1}});
  await until(()=>existsSync(worker.config.ready),'deleter ready');
  const first=ok(f.call('readAssetBytes',{version:receipt.version}));assert.deepEqual(Buffer.from(first.bytes,'base64'),original.subarray(0,32768));
  writeFileSync(worker.config.start,'go');let cursor=first.nextCursor;
  while(cursor&&!existsSync(worker.config.result)) {
    const page=ok(f.call('readAssetBytes',{version:receipt.version,cursor}));
    if(page.status==='unavailable')break;
    assert.deepEqual(Buffer.from(page.bytes,'base64'),original.subarray(page.index*32768,(page.index+1)*32768));cursor=page.nextCursor;
    await new Promise(resolve=>setTimeout(resolve,1));
  }
  assert.deepEqual(await worker.closed,{code:0,signal:null},worker.diagnostics());
  assert.deepEqual(ok(f.call('readAssetBytes',{version:receipt.version,cursor:first.nextCursor})),{status:'unavailable'});
  assert.deepEqual(ok(f.call('readAssetBytes',{version:receipt.version})),{status:'unavailable'});
});
