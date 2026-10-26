import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { fixture,ns,input,ok,error,collect,child,childHost,moduleURL,corrupt } from '../testing/asset-fixtures.mjs';
import { derivativeInput as derive } from '../testing/asset-mixed-fixtures.mjs';
const content=(f,ref)=>{let text='',cursor;do{const page=ok(f.call('readAssetDerivative',{ref,...(cursor?{cursor}:{})}));assert.equal(page.status,'available');for(const part of page.parts){assert.ok(part.end-part.start<=4000);text+=part.text;}cursor=page.nextCursor;}while(cursor);return text;};
test('K08/K12 derivatives redact without reformatting, retain exact versioned provenance and never inherit',t=>{
  const f=fixture(t),first=ok(f.call('importAssetVersion',input())),raw='  Heading\n\n\tkey: sk-12345678901234567890\n'+ '😀'.repeat(5000);
  const request=derive(first.version,'derive',{text:raw,language:'zh-Hant'}),receipt=ok(f.call('createAssetDerivative',request));
  assert.equal(content(f,receipt.derivative),raw.replace('sk-12345678901234567890','[REDACTED]'));
  let listed=collect(f,'listAssetDerivatives',{version:first.version},'derivatives');assert.equal(listed.length,1);
  assert.equal(listed[0].historical,false);assert.equal(listed[0].sourceOrdinal,1);assert.equal(listed[0].greatestImportedOrdinal,1);
  assert.deepEqual(listed[0].provenance,{version:'asset-derivative-provenance-v1',source:first.version,method:{kind:'user-provided'}});
  const second=ok(f.call('importAssetVersion',input('second',{asset:first.asset,expectedAssetRevision:1})));
  assert.deepEqual(collect(f,'listAssetDerivatives',{version:second.version},'derivatives'),[]);
  listed=collect(f,'listAssetDerivatives',{version:first.version},'derivatives');assert.equal(listed[0].historical,true);assert.equal(listed[0].greatestImportedOrdinal,2);
  assert.deepEqual(ok(f.call('createAssetDerivative',request)),receipt);f.reopen();assert.equal(content(f,receipt.derivative),raw.replace('sk-12345678901234567890','[REDACTED]'));
  assert.equal(ok(f.call('getAssetUsage',{namespace:ns})).retainedDerivativeBytes,Buffer.byteLength(content(f,receipt.derivative)));
});
test('K08 supplied audio/video intervals are ordered, bounded, safe integers and explicitly unverified',t=>{
  const f=fixture(t),audio=ok(f.call('importAssetVersion',input('audio',{filename:'x.wav',mediaType:'audio/wav',bytes:Buffer.from('RIFF0000WAVE')})));
  const timecodes=Array.from({length:256},(_,i)=>({startMs:i*10,endMs:i*10+10}));
  const receipt=ok(f.call('createAssetDerivative',derive(audio.version,'intervals',{kind:'transcript',timecodes})));
  const page=ok(f.call('readAssetDerivative',{ref:receipt.derivative}));assert.equal(page.derivative.alignment,'user-supplied-unverified');
  assert.equal(page.derivative.provenance.alignment,'user-supplied-unverified');assert.deepEqual(page.derivative.timecodes,timecodes);
  for(const [i,bad]of [[...timecodes,{startMs:2560,endMs:2560}],[{startMs:-1,endMs:0}],[{startMs:2,endMs:1}],
    [{startMs:0,endMs:10},{startMs:9,endMs:11}],[{startMs:0.1,endMs:1}],[{startMs:0,endMs:Number.MAX_SAFE_INTEGER+1}],
    [{startMs:0,endMs:1,alignment:'verified'}]].entries())error(f.call('createAssetDerivative',derive(audio.version,'bad-'+i,{timecodes:bad})),'invalid_input');
  const pdf=ok(f.call('importAssetVersion',input('pdf')));error(f.call('createAssetDerivative',derive(pdf.version,'wrong-media',{timecodes:[]})),'invalid_input');
});
test('K04/K08 derivative kind, Unicode, NUL, BCP47, provenance and text one-over bounds refuse atomically',t=>{
  const f=fixture(t),source=ok(f.call('importAssetVersion',input()));
  for(const kind of ['caption','transcript','description','alt-text'])ok(f.call('createAssetDerivative',derive(source.version,kind,{kind,text:'x'.repeat(20000)})));
  const count=f.db.prepare('SELECT count(*) n FROM asset_derivatives').get().n,usage=f.db.prepare('SELECT byte_count FROM binary_owner_usage').get().byte_count;
  const invalid=[{text:'x'.repeat(20001)},{text:'\uD800'},{text:'NUL\0'},{kind:'ocr'},{language:'en_US'},{language:'a'.repeat(36)},
    {method:{kind:'generated'}},{method:{kind:'user-provided',model:'none'}},{provenance:{}},{expectedVersionRevision:0}];
  for(const [i,patch]of invalid.entries())error(f.call('createAssetDerivative',derive(source.version,'bad-'+i,patch)),'invalid_input');
  error(f.call('createAssetDerivative',derive(source.version,'cas',{expectedVersionRevision:2})),'revision_conflict');
  assert.equal(f.db.prepare('SELECT count(*) n FROM asset_derivatives').get().n,count);assert.equal(f.db.prepare('SELECT byte_count FROM binary_owner_usage').get().byte_count,usage);
  assert.equal(ok(f.call('readAssetDerivative',{ref:ok(f.call('createAssetDerivative',derive(source.version,'empty',{text:''}))).derivative})).complete,true);
});
test('K08 BCP47 accepts extlangs, grandfathered/private-use tags and extensions beyond Intl locales, without duplicate variants/singletons',t=>{
  const f=fixture(t),source=ok(f.call('importAssetVersion',input()));
  for(const language of ['zh-cmn-Hans-CN','en-US','de-DE-1901','en-Latn-US-u-ca-gregory','x-supplied','i-klingon','en-x-private']) {
    const d=ok(f.call('createAssetDerivative',derive(source.version,'language-'+language,{language})));
    assert.equal(ok(f.call('readAssetDerivative',{ref:d.derivative})).derivative.language,language);
  }
  for(const [i,language]of ['en-abcde-abcde','en-u-foo-u-bar','x','en-','en-1234a1234','en-u','en-x','123','a-foo','en-abcdefghi'].entries())
    error(f.call('createAssetDerivative',derive(source.version,'invalid-language-'+i,{language})),'invalid_input');
});
test('K09 derivative deletion purges once, keeps tombstones in the 32 limit, and replays after restart in a fresh process',t=>{
  const f=fixture(t),source=ok(f.call('importAssetVersion',input())),request=derive(source.version),first=ok(f.call('createAssetDerivative',request));
  const deletion={actionId:'delete-derivative',ref:first.derivative,expectedRevision:1},removed=ok(f.call('deleteAssetDerivative',deletion));
  assert.deepEqual(removed,{id:first.derivative.derivativeId,revision:2,state:'deleted',effectCount:1});
  const row=f.db.prepare('SELECT * FROM asset_derivatives').get();for(const key of ['kind','text','provenance','language','timecodes'])assert.equal(row[key],null);assert.equal(row.byte_count,0);
  assert.equal(ok(f.call('getAssetUsage',{namespace:ns})).retainedDerivativeBytes,0);assert.deepEqual(ok(f.call('readAssetDerivative',{ref:first.derivative})),{status:'unavailable'});
  for(let i=1;i<32;i++)ok(f.call('createAssetDerivative',derive(source.version,'d-'+i,{text:'é'})));
  error(f.call('createAssetDerivative',derive(source.version,'too-many')),'asset_limit_reached');
  error(f.call('createAssetDerivative',{...request,text:'changed'}),'action_conflict');
  const effectCount=f.db.prepare('SELECT count(*) n FROM asset_effects').get().n;
  child(`import assert from 'node:assert/strict';import {openMemoryCore} from ${JSON.stringify(moduleURL('core/contract.mjs'))};${childHost}
    const [path,create,receipt,remove,removed]=process.argv.slice(1),core=openMemoryCore({path,assets:{version:'assets-local-v1',storage:'sqlite-blob-v1',authority}});
    try{assert.deepEqual(ok(core.createAssetDerivative(JSON.parse(create),token)),JSON.parse(receipt));assert.deepEqual(ok(core.deleteAssetDerivative(JSON.parse(remove),token)),JSON.parse(removed));assert.deepEqual(ok(core.readAssetDerivative({ref:JSON.parse(receipt).derivative},token)),{status:'unavailable'});}finally{core.close();}`,
    [f.path,JSON.stringify(request),JSON.stringify(first),JSON.stringify(deletion),JSON.stringify(removed)]);
  assert.equal(f.db.prepare('SELECT count(*) n FROM asset_effects').get().n,effectCount);
  ok(f.call('deleteAsset',{actionId:'parent-delete',ref:source.asset,expectedRevision:1}));
  assert.equal(f.db.prepare('SELECT byte_count FROM binary_owner_usage').get().byte_count,0);assert.equal(f.db.prepare("SELECT count(*) n FROM asset_derivatives WHERE state='deleted'").get().n,32);
  assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(),[]);
});
test('K07/K08/K12 derivative cursors authenticate before lookup, deletion wins staleness and fresh authority fences every page',t=>{
  const f=fixture(t),source=ok(f.call('importAssetVersion',input())),d=ok(f.call('createAssetDerivative',derive(source.version,'paged',{text:'\u0001'.repeat(20000)})));
  const first=ok(f.call('readAssetDerivative',{ref:d.derivative}));assert.ok(Buffer.byteLength(JSON.stringify({ok:true,value:first}))<=65536);assert.equal(first.parts[0].end,4000);
  error(f.call('readAssetDerivative',{ref:d.derivative,cursor:first.nextCursor+'x'}),'invalid_cursor');
  f.trusted.state.enabled=false;error(f.call('readAssetDerivative',{ref:d.derivative,cursor:first.nextCursor}),'authority_required');f.trusted.state.enabled=true;
  f.trusted.state.generation++;error(f.call('readAssetDerivative',{ref:d.derivative,cursor:first.nextCursor}),'invalid_cursor');f.trusted.state.generation--;
  ok(f.call('deleteAssetVersion',{actionId:'source-delete',ref:source.version,expectedRevision:1}));
  assert.deepEqual(ok(f.call('readAssetDerivative',{ref:d.derivative,cursor:first.nextCursor})),{status:'unavailable'});
  error(f.call('readAssetDerivative',{ref:d.derivative,cursor:first.nextCursor+'x'}),'invalid_cursor');
});
test('K08/K12 derivative metadata and identity corruption refuse delivery; every derivative read uses query_only and emits no effects',t=>{
  const f=fixture(t),source=ok(f.call('importAssetVersion',input())),d=ok(f.call('createAssetDerivative',derive(source.version)));
  const effects=f.db.prepare('SELECT count(*) n FROM asset_effects').get().n;
  for(const [method,input]of [['readAssetDerivative',{ref:d.derivative}],['listAssetDerivatives',{version:source.version}]]) {
    const exec=DatabaseSync.prototype.exec;let connection;
    const mock=t.mock.method(DatabaseSync.prototype,'exec',function(sql){const result=exec.call(this,sql);if(sql==='BEGIN'){
      connection=this;assert.equal(this.prepare('PRAGMA query_only').get().query_only,1);this.prepare('UPDATE assets SET revision=revision+1').run();}return result;});
    error(f.call(method,input),'storage_error');mock.mock.restore();assert.ok(connection);assert.equal(connection.isTransaction,false);assert.equal(connection.prepare('PRAGMA query_only').get().query_only,0);
  }
  ok(f.call('readAssetDerivative',{ref:d.derivative}));ok(f.call('listAssetDerivatives',{version:source.version}));
  assert.equal(f.db.prepare('SELECT count(*) n FROM asset_effects').get().n,effects);
  corrupt(f.db,'asset_derivative_immutable',"UPDATE asset_derivatives SET text=? WHERE id=?",'X'.repeat('Synthetic description'.length),d.derivative.derivativeId);
  error(f.call('readAssetDerivative',{ref:d.derivative}),'asset_version_unavailable');error(f.call('listAssetDerivatives',{version:source.version}),'asset_version_unavailable');
  ok(f.call('deleteAssetDerivative',{actionId:'purge-corrupt',ref:d.derivative,expectedRevision:1}));assert.equal(f.db.prepare('SELECT byte_count FROM binary_owner_usage').get().byte_count,8);
});
test('K12 worst-case derivative provenance/interval lists trim by envelope bytes and every maximum text part fits',t=>{
  const f=fixture(t),source=ok(f.call('importAssetVersion',input('audio',{filename:'x.wav',mediaType:'audio/wav',bytes:Buffer.from('RIFF0000WAVE')}))),
    timecodes=Array.from({length:256},(_,i)=>({startMs:Number.MAX_SAFE_INTEGER-256+i,endMs:Number.MAX_SAFE_INTEGER-256+i}));
  for(let i=0;i<21;i++)ok(f.call('createAssetDerivative',derive(source.version,'worst-'+i,{timecodes,text:'\u0001'.repeat(20000),language:'x-supplied'})));
  let cursor,count=0,pages=0;
  do{const response=f.call('listAssetDerivatives',{version:source.version,...(cursor?{cursor}:{})});assert.ok(Buffer.byteLength(JSON.stringify(response))<=65536);
    const page=ok(response);if(!pages)assert.ok(page.derivatives.length<20);count+=page.derivatives.length;cursor=page.nextCursor;pages++;}while(cursor);
  assert.equal(count,21);assert.ok(pages>1);const ref=ok(f.call('listAssetDerivatives',{version:source.version,limit:1})).derivatives[0].ref;
  let parts=0;cursor=undefined;
  do{const response=f.call('readAssetDerivative',{ref,...(cursor?{cursor}:{})});assert.ok(Buffer.byteLength(JSON.stringify(response))<=65536);const page=ok(response);assert.equal(page.parts[0].text.length,4000);parts++;cursor=page.nextCursor;}while(cursor);
  assert.equal(parts,5);
});
