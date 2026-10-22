import assert from 'node:assert/strict';
import test from 'node:test';
import { fixture,ns,ok,error,file,input,history,child,childHost,moduleURL } from '../testing/method-package-fixtures.mjs';

const readChild=`import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';
import {openMemoryCore} from ${JSON.stringify(moduleURL('core/contract.mjs'))};${childHost}
const [path,encoded]=process.argv.slice(1),p=JSON.parse(encoded),core=openMemoryCore({path,methodPackages:methods});
const call=(m,i)=>ok(core[m](i,token));
`;

test('M08 fresh-process version purge, replay after deletion and exactly-once durable effects with usage decrement',t=>{
  const f=fixture(t),firstInput=input('first',{title:'Synthetic purge title',submittedBy:'Synthetic purge label',files:[file('purge-path.md','Synthetic purge text.')]}),first=ok(f.call('importMethodVersion',firstInput));
  const secondInput=input('second',{package:first.package,expectedPackageRevision:1,basedOn:first.version,files:[file('second.md','Synthetic remaining text.')],
    change:{items:[{summary:'Synthetic purge change prose.',paths:['purge-path.md','second.md']}],reasonRefs:[]}});
  const second=ok(f.call('importMethodVersion',secondInput)),deletion={actionId:'delete-version',ref:first.version,expectedRevision:1};
  f.core.close();
  const deleted=JSON.parse(child(readChild+`
const receipt=call('deleteMethodVersion',p.deletion);assert.equal(receipt.revision,2);assert.equal(receipt.effectCount,1);
assert.deepEqual(call('deleteMethodVersion',p.deletion),receipt);core.close();console.log(JSON.stringify(receipt));
`,[f.path,JSON.stringify({deletion})]));
  assert.equal(deleted.state,'deleted');
  child(readChild+`
assert.deepEqual(call('importMethodVersion',p.firstInput),p.first);assert.deepEqual(call('importMethodVersion',p.secondInput),p.second);
assert.deepEqual(call('deleteMethodVersion',p.deletion),p.deleted);
assert.equal(call('getMethodVersion',{version:p.first.version,intent:'history'}).version,null);
for(const method of ['listMethodManifest','readMethodFile'])assert.equal(call(method,{version:p.first.version,intent:'history',...(method==='readMethodFile'?{path:'purge-path.md'}:{})}).status,'unavailable');
assert.equal(call('compareMethodVersions',{from:p.first.version,to:p.second.version}).status,'unavailable');
const effects=call('listMethodEffects',{namespace:p.ns}).effects;assert.equal(effects.length,1);assert.equal(effects[0].kind,'method_version_deleted');
assert.equal(call('getMethodPackageUsage',{namespace:p.ns}).retainedFileBytes,Buffer.byteLength('Synthetic remaining text.'));
core.close();const db=new DatabaseSync(path),row=db.prepare('SELECT * FROM method_versions WHERE id=?').get(p.first.version.versionId);
assert.equal(row.title,null);assert.equal(row.submitted_by,null);assert.equal(row.byte_count,0);assert.equal(row.revision,2);
assert.equal(db.prepare('SELECT count(*) n FROM method_files WHERE version_id=?').get(row.id).n,0);
assert.equal(db.prepare('SELECT count(*) n FROM method_changes').get().n,0);
const tables=['method_versions','method_files','method_changes','method_operations','method_effects'];
const retained=JSON.stringify(tables.map(t=>db.prepare('SELECT * FROM '+t).all()));
for(const text of ['Synthetic purge title','Synthetic purge label','purge-path.md','Synthetic purge text.','Synthetic purge change prose.'])assert.ok(!retained.includes(text),text);
db.close();
`,[f.path,JSON.stringify({deletion,deleted,firstInput,first,secondInput,second,ns})]);
});

test('M08 fresh-process terminal package purge, content-free history/effects, no resurrection and zero usage',t=>{
  const f=fixture(t),firstInput=input('first',{files:[file('first-secret.md','Synthetic first text.')]}),first=ok(f.call('importMethodVersion',firstInput));
  const secondInput=input('second',{package:first.package,expectedPackageRevision:1,basedOn:first.version,
    title:'Synthetic second title',submittedBy:'Synthetic second attribution',files:[file('second-secret.md','Synthetic second text.')],
    change:{items:[{summary:'Synthetic package purge prose.',paths:['first-secret.md','second-secret.md']}],reasonRefs:[]}}),second=ok(f.call('importMethodVersion',secondInput));
  const deletion={actionId:'delete-package',ref:first.package,expectedRevision:2};f.core.close();
  child(readChild+`const receipt=call('deleteMethodPackage',p.deletion);assert.equal(receipt.revision,3);assert.equal(receipt.effectCount,1);core.close();`,[f.path,JSON.stringify({deletion})]);
  child(readChild+`
assert.deepEqual(call('importMethodVersion',p.firstInput),p.first);assert.deepEqual(call('importMethodVersion',p.secondInput),p.second);
assert.equal(call('deleteMethodPackage',p.deletion).revision,3);
assert.equal(call('getMethodPackageUsage',{namespace:p.ns}).retainedFileBytes,0);
const history=call('listMethodVersions',{package:p.first.package}).versions;
assert.equal(history.length,2);assert.ok(history.every(v=>v.state==='deleted'&&v.title===undefined&&v.submittedBy===undefined));
for(const version of [p.first.version,p.second.version])assert.equal(call('getMethodVersion',{version,intent:'history'}).status,'unavailable');
const effects=call('listMethodEffects',{namespace:p.ns}).effects;assert.equal(effects.length,1);assert.equal(effects[0].kind,'method_package_deleted');
core.close();const db=new DatabaseSync(path);assert.equal(db.prepare('SELECT count(*) n FROM method_files').get().n,0);
assert.equal(db.prepare('SELECT count(*) n FROM method_changes').get().n,0);
const tombstones=JSON.stringify(db.prepare('SELECT * FROM method_versions').all());
for(const value of ['first-secret.md','second-secret.md','Synthetic first text.','Synthetic second text.','Synthetic second title','Synthetic second attribution','Synthetic package purge prose.'])assert.ok(!tombstones.includes(value));db.close();
`,[f.path,JSON.stringify({firstInput,first,secondInput,second,deletion,ns})]);
});

test('M08/M10 deletion CAS and failures roll back all purge/usage/effects; mutation stales existing cursors',t=>{
  const f=fixture(t),first=ok(f.call('importMethodVersion',input('first',{files:[file('long','x'.repeat(5000))]})));
  const cursor=ok(f.call('readMethodFile',{...history(first.version),path:'long'})).nextCursor;
  error(f.call('deleteMethodVersion',{actionId:'stale',ref:first.version,expectedRevision:2}),'revision_conflict');
  f.db.exec("CREATE TRIGGER fail_method_effect BEFORE INSERT ON method_effects BEGIN SELECT RAISE(ABORT,'synthetic_private_exception'); END");
  const deletion={actionId:'purge',ref:first.version,expectedRevision:1};error(f.call('deleteMethodVersion',deletion),'storage_error');
  assert.equal(f.db.prepare('SELECT count(*) n FROM method_files').get().n,1);
  assert.equal(ok(f.call('getMethodPackageUsage',{namespace:ns})).retainedFileBytes,5000);
  f.db.exec('DROP TRIGGER fail_method_effect');ok(f.call('deleteMethodVersion',deletion));
  error(f.call('readMethodFile',{...history(first.version),path:'long',cursor}),'cursor_stale');
  error(f.call('deleteMethodVersion',{...deletion,expectedRevision:2}),'action_conflict');
  const effects=ok(f.call('listMethodEffects',{namespace:ns,limit:1}));assert.equal(effects.effects.length,1);
});

test('M08 effect pages persist exactly once and remain content-free across restart',t=>{
  const f=fixture(t);for(let i=0;i<23;i++){
    const imported=ok(f.call('importMethodVersion',input('import-'+i)));
    const deletion={actionId:'delete-'+i,ref:imported.version,expectedRevision:1};ok(f.call('deleteMethodVersion',deletion));ok(f.call('deleteMethodVersion',deletion));
  }
  f.reopen();let cursor,ids=[];
  do{const page=ok(f.call('listMethodEffects',{namespace:ns,...(cursor?{cursor}:{})}));assert.ok(Buffer.byteLength(JSON.stringify({ok:true,value:page}))<=65536);
    ids.push(...page.effects.map(e=>e.effectId));cursor=page.nextCursor;}while(cursor);
  assert.equal(ids.length,23);assert.equal(new Set(ids).size,23);
  assert.ok(!JSON.stringify(f.db.prepare('SELECT * FROM method_effects').all()).includes('Synthetic method'));
});
