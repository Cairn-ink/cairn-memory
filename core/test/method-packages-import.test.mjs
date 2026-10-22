import assert from 'node:assert/strict';
import test from 'node:test';
import { redactSecrets } from '../../plugins/cairn-memory/lib/redact.mjs';
import { fixture,ns,project,foreign,ok,error,file,input,history,collect } from '../testing/method-package-fixtures.mjs';
const count = (f,table) => f.db.prepare(`SELECT count(*) n FROM ${table}`).get().n;
const importState = f => ['method_packages','method_versions','method_files','method_changes','method_operations','method_owner_usage','method_epochs']
  .map(table=>[table,f.db.prepare(`SELECT * FROM ${table}`).all()]);

test('M02/M10 exact formatting, redaction and post-redaction identities; pre-redaction action conflict',t=>{
  const f=fixture(t,{model:{extract(){throw Error('model_must_not_run');}}});
  const text='  Synthetic\r\nＡ e\u0301 😀\t\napi_key=sk-abcdefghijklmnopqrstuvwxyz012345\n';
  const firstInput=input('first',{files:[file('SKILL.md',text)]}),first=ok(f.call('importMethodVersion',firstInput));
  const saved=collect(f,'readMethodFile',{...history(first.version),path:'SKILL.md'},'parts').map(p=>p.text).join('');
  assert.equal(saved,redactSecrets(text));assert.notEqual(saved,text);
  const manifest=collect(f,'listMethodManifest',history(first.version),'files');
  assert.equal(manifest[0].byteCount,Buffer.byteLength(saved));assert.match(manifest[0].contentIdentity,/^[A-Za-z0-9_-]{43}$/);
  const second=ok(f.call('importMethodVersion',input('second',{files:[file('SKILL.md',saved)]})));
  assert.equal(collect(f,'listMethodManifest',history(second.version),'files')[0].contentIdentity,manifest[0].contentIdentity);
  error(f.call('importMethodVersion',{...firstInput,files:[file('SKILL.md',saved)]}),'action_conflict');
  assert.deepEqual(ok(f.call('importMethodVersion',firstInput)),first);
  assert.equal(ok(f.call('getMethodPackageUsage',{namespace:ns})).retainedFileBytes,Buffer.byteLength(saved)*2);
  const ledger=JSON.stringify(f.db.prepare('SELECT * FROM method_operations').all());assert.ok(!ledger.includes('api_key'));
});

test('M02 immutable versions, explicit basedOn and package CAS, deleted bases and terminal packages',t=>{
  const f=fixture(t),first=ok(f.call('importMethodVersion',input()));
  const before=f.db.prepare('SELECT * FROM method_files WHERE version_id=?').all(first.version.versionId);
  for(const patch of [{package:first.package},{package:first.package,expectedPackageRevision:1},
    {package:first.package,expectedPackageRevision:0,basedOn:first.version}])error(f.call('importMethodVersion',input('bad',patch)),'invalid_input');
  error(f.call('importMethodVersion',input('stale',{package:first.package,expectedPackageRevision:2,basedOn:first.version})),'revision_conflict');
  const secondInput=input('second',{package:first.package,expectedPackageRevision:1,basedOn:first.version,files:[file('SKILL.md','Synthetic version two.')]});
  const second=ok(f.call('importMethodVersion',secondInput));assert.equal(second.ordinal,2);assert.equal(second.packageRevision,2);
  assert.deepEqual(f.db.prepare('SELECT * FROM method_files WHERE version_id=?').all(first.version.versionId),before);
  assert.deepEqual(ok(f.call('getMethodVersion',history(second.version))).version.basedOn,first.version);
  ok(f.call('deleteMethodVersion',{actionId:'delete-base',ref:first.version,expectedRevision:1}));
  error(f.call('importMethodVersion',input('deleted-base',{package:first.package,expectedPackageRevision:3,basedOn:first.version})),'method_version_unavailable');
  ok(f.call('deleteMethodPackage',{actionId:'delete-package',ref:first.package,expectedRevision:3}));
  error(f.call('importMethodVersion',input('terminal',{package:first.package,expectedPackageRevision:4,basedOn:second.version})),'method_version_unavailable');
  assert.deepEqual(ok(f.call('importMethodVersion',secondInput)),second);
});

test('M02/M10 manifest paths, prefixes, Unicode and media refuse atomically with exact errors',t=>{
  const f=fixture(t);
  for(const path of ['/absolute','C:/drive','c:drive','https:link','file:///tmp/x','a//b','a/./b','a/../b','a/','../a','a\\b','a\0b','x'.repeat(513),'']){
    const before=importState(f);error(f.call('importMethodVersion',input('bad-path',{files:[file(path)]})),'invalid_path');assert.deepEqual(importState(f),before);
  }
  for(const paths of [['A.md','a.md'],['Ä.md','ä.md'],['same','same']])error(f.call('importMethodVersion',input('collision',{files:paths.map(path=>file(path))})),'invalid_path');
  for(const text of ['\ud800','\udfff','x\0y','x'.repeat(100001)])error(f.call('importMethodVersion',input('bad-text',{files:[file('text',text)]})),'invalid_input');
  error(f.call('importMethodVersion',input('bad-media',{files:[file('x','text','application/octet-stream')]})),'unsupported_media');
  for(const files of [[],Array.from({length:65},(_,i)=>file('p'+i)),Array.from({length:11},(_,i)=>file('p'+i,'x'.repeat(100000)))])error(f.call('importMethodVersion',input('too-many',{files})),'invalid_input');
  error(f.call('importMethodVersion',input('title',{title:'x'.repeat(201)})),'invalid_input');
  error(f.call('importMethodVersion',input('label',{submittedBy:'x'.repeat(201)})),'invalid_input');
  assert.equal(count(f,'method_packages'),0);assert.equal(count(f,'method_operations'),0);
  const allowed=ok(f.call('importMethodVersion',input('literal-percent',{files:[file('%2e%2e/literal'),file('directory/name:literal')]})));
  assert.equal(collect(f,'listMethodManifest',history(allowed.version),'files')[0].path,'%2e%2e/literal');
});

test('M02/M10 maximum 64-file manifest, million-unit version, 512-unit path and empty text persist',t=>{
  const f=fixture(t),files=Array.from({length:64},(_,i)=>file(i===0?'p'.repeat(512):'file-'+i,i<10?'界'.repeat(100000):'',
    ['text/markdown','text/plain','application/json','application/yaml','text/csv'][i%5]));
  const receipt=ok(f.call('importMethodVersion',input('max',{title:'T'.repeat(200),submittedBy:'S'.repeat(200),files})));
  const manifest=collect(f,'listMethodManifest',history(receipt.version),'files');assert.equal(manifest.length,64);
  assert.equal(manifest.reduce((n,item)=>n+item.byteCount,0),3_000_000);
  assert.equal(ok(f.call('getMethodPackageUsage',{namespace:ns})).retainedFileBytes,3_000_000);
  assert.deepEqual(ok(f.call('readMethodFile',{...history(receipt.version),path:'file-63'})).parts,[]);
});

test('M10 exact package/version caps count retained tombstones and failures do not consume ordinals',t=>{
  const f=fixture(t);let first=ok(f.call('importMethodVersion',input('v1'))),latest=first;
  for(let i=2;i<=128;i++)latest=ok(f.call('importMethodVersion',input('v'+i,{package:first.package,expectedPackageRevision:i-1,basedOn:first.version})));
  assert.equal(latest.ordinal,128);
  const before=importState(f);error(f.call('importMethodVersion',input('over-version',{package:first.package,expectedPackageRevision:128,basedOn:first.version})),'package_limit_reached');assert.deepEqual(importState(f),before);
  for(let i=2;i<=256;i++)ok(f.call('importMethodVersion',input('p'+i)));
  error(f.call('importMethodVersion',input('over-package')),'package_limit_reached');
  assert.equal(count(f,'method_packages'),256);assert.equal(count(f,'method_versions'),383);
  ok(f.call('deleteMethodPackage',{actionId:'purge',ref:first.package,expectedRevision:128}));
  error(f.call('importMethodVersion',input('over-tombstones')),'package_limit_reached');
});

test('M10 owner quota reservation is atomic across namespaces; namespace usage does not disclose aggregate',t=>{
  const f=fixture(t);f.db.prepare('INSERT INTO method_owner_usage VALUES(?,?)').run(ns.ownerId,49_999_995);
  ok(f.call('importMethodVersion',input('fit',{namespace:project,files:[file('x','12345')]})));
  const before=importState(f);error(f.call('importMethodVersion',input('over',{files:[file('x','x')]})),'quota_reached');assert.deepEqual(importState(f),before);
  const usage=ok(f.call('getMethodPackageUsage',{namespace:ns}));assert.equal(usage.retainedFileBytes,0);assert.ok(!JSON.stringify(usage).includes('50000000')||usage.limitBytes===50_000_000);
  const version=ok(f.call('listMethodVersions',{package:ok(f.call('listMethodPackages',{namespace:project})).packages[0].ref})).versions[0];
  ok(f.call('deleteMethodVersion',{actionId:'free',ref:version.ref,expectedRevision:1}));
  ok(f.call('importMethodVersion',input('freed',{files:[file('x','12345')]})));
});

test('M02/M09 foreign package/base refs are indistinguishable from missing and imports never join by names',t=>{
  const f=fixture(t),a=ok(f.call('importMethodVersion',input('a'))),b=ok(f.call('importMethodVersion',input('b')));
  assert.notEqual(a.package.packageId,b.package.packageId);
  error(f.call('importMethodVersion',input('foreign',{package:{...a.package,namespace:project},expectedPackageRevision:1,basedOn:a.version})),'method_not_found');
  error(f.call('importMethodVersion',input('other-package',{package:a.package,expectedPackageRevision:1,basedOn:b.version})),'method_not_found');
  error(f.call('importMethodVersion',input('missing',{package:{...a.package,packageId:'missing'},expectedPackageRevision:1,basedOn:{...a.version,packageId:'missing'}})),'method_not_found');
});

test('M02/M10 legal maximum change metadata fits its separate input budget and exact bounds refuse atomically',t=>{
  const f=fixture(t,{cards:true});
  const files=Array.from({length:64},(_,i)=>file('a'.repeat(508)+String(i).padStart(4,'0'),''));
  const first=ok(f.call('importMethodVersion',input('first',{files})));
  const next=files.map((entry,i)=>({...entry,path:'b'+entry.path.slice(1),text:i<10?'x'.repeat(100000):''}));
  const paths=[...files,...next].map(entry=>entry.path);
  const change={items:Array.from({length:32},()=>({summary:'s'.repeat(500),paths})),reasonRefs:[]};
  const candidate=input('max-change',{package:first.package,expectedPackageRevision:1,basedOn:first.version,files:next,change});
  const second=ok(f.call('importMethodVersion',candidate));assert.equal(second.ordinal,2);
  for(const patch of [{items:[...change.items,change.items[0]],reasonRefs:[]},{items:[{summary:'s'.repeat(501),paths:[]}],reasonRefs:[]},
    {items:[{summary:'bad',paths:['missing-file']}],reasonRefs:[]}]){
    const before=importState(f);error(f.call('importMethodVersion',input('bad-change',{package:first.package,expectedPackageRevision:2,basedOn:first.version,change:patch})),patch.items[0]?.paths?.[0]==='missing-file'?'invalid_path':'invalid_input');assert.deepEqual(importState(f),before);
  }
  const reasons=Array.from({length:16},(_,i)=>ok(f.call('submitSourceNote',{namespace:ns,actionId:'reason-'+i,text:'Synthetic reason '+i,occurredAt:null})).source);
  ok(f.call('importMethodVersion',input('16-reasons',{change:{items:[],reasonRefs:reasons}})));
  error(f.call('importMethodVersion',input('17-reasons',{change:{items:[],reasonRefs:[...reasons,reasons[0]]}})),'invalid_input');
});
