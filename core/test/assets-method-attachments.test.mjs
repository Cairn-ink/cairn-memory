import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';
import { syncBuiltinESMExports } from 'node:module';
import { spawn } from 'node:child_process';
import { existsSync,writeFileSync,readFileSync,openSync,closeSync } from 'node:fs';
import { join } from 'node:path';
import { openMemoryCore } from '../contract.mjs';
import { keyed } from '../private-card-input.mjs';
import { methodSnapshot } from '../method-package-input.mjs';
import { fixture,ns,project,ok,error,collect,pdf,child,childHost,moduleURL,corrupt } from '../testing/asset-fixtures.mjs';
import { mixedInput,textEntry,binaryEntry,attachmentBytes } from '../testing/asset-mixed-fixtures.mjs';
import { until } from '../testing/asset-race.mjs';
const history=version=>({version,intent:'history'});
const context={readSet:[ns],roleId:'reader'};
const adopt=(receipt,actionId='adopt',expectedRevision=null)=>({bindingNamespace:ns,actionId,package:receipt.package,version:receipt.version,roleId:'reader',expectedRevision,readSet:[ns]});
const disable=(receipt,actionId='disable',expectedRevision=1)=>({bindingNamespace:ns,actionId,package:receipt.package,roleId:'reader',expectedRevision,readSet:[ns]});

test('K04 legacy wire, manifest and action identities stay byte-for-byte compatible alongside mixed imports',t=>{
  const f=fixture(t,{methods:true}),legacy={namespace:ns,actionId:'legacy',title:'Synthetic',files:[{path:'SKILL.md',text:'legacy\n',mediaType:'text/plain'}]},receipt=ok(f.call('importMethodVersion',legacy));
  const identity=f.db.prepare('SELECT store_id,cursor_secret FROM store_metadata').get();
  const content=keyed(identity.cursor_secret,'method-file-content-v1',[identity.store_id,[ns,'legacy\n']]);
  assert.equal(receipt.version.manifestIdentity,keyed(identity.cursor_secret,'method-manifest-v1',[identity.store_id,[['SKILL.md',content,'text/plain']]]));
  assert.equal(f.db.prepare('SELECT payload_binding FROM method_operations WHERE action_id=?').get('legacy').payload_binding,
    keyed(identity.cursor_secret,'method-action-v1',[identity.store_id,['importMethodVersion',methodSnapshot(legacy)]]));
  const manifest=ok(f.call('listMethodManifest',history(receipt.version))).files;
  assert.deepEqual(manifest,[{path:'SKILL.md',byteCount:7,contentIdentity:content,mediaType:'text/plain'}]);
  assert.equal(Object.hasOwn(ok(f.call('getMethodVersion',history(receipt.version))).version,'manifestFormat'),false);
  assert.deepEqual(ok(f.call('importMethodVersion',legacy)),receipt);
  const mixed=ok(f.call('importMethodVersion',mixedInput()));
  assert.equal(ok(f.call('getMethodVersion',history(mixed.version))).version.manifestFormat,'mixed-v1');
  assert.equal(f.db.prepare('PRAGMA user_version').get().user_version,31);
});
test('K04 mixed manifests have unified positions, exclusive objects, separate accounting and exact fresh-process bytes',t=>{
  const f=fixture(t,{methods:true}),original=pdf(70000),request=mixedInput('ordered',{files:[binaryEntry('first.pdf',original),textEntry('SKILL.md','  sk-12345678901234567890\n'),binaryEntry('second.pdf',original)]}),receipt=ok(f.call('importMethodVersion',request));
  const manifest=collect(f,'listMethodManifest',history(receipt.version),'files');assert.deepEqual(manifest.map(file=>[file.kind,file.path]),[['binary','first.pdf'],['text','SKILL.md'],['binary','second.pdf']]);
  assert.equal(manifest[0].contentIdentity,manifest[2].contentIdentity);assert.equal(f.db.prepare('SELECT count(DISTINCT id) n FROM binary_objects').get().n,2);
  assert.deepEqual(f.db.prepare('SELECT position FROM method_files').all().map(row=>row.position),[1]);
  assert.equal(ok(f.call('getMethodPackageUsage',{namespace:ns})).retainedFileBytes,Buffer.byteLength('  [REDACTED]\n'));
  assert.equal(ok(f.call('getAssetUsage',{namespace:ns})).retainedBinaryBytes,140000);
  assert.deepEqual(attachmentBytes(f,receipt.version,'first.pdf'),original);assert.deepEqual(attachmentBytes(f,receipt.version,'second.pdf'),original);
  const scoped=ok(f.call('importMethodVersion',mixedInput('project',{namespace:project,files:[binaryEntry('same.pdf',original)]})));
  const scopedManifest=ok(f.call('listMethodManifest',history(scoped.version))).files;assert.notEqual(scopedManifest[0].contentIdentity,manifest[0].contentIdentity);
  child(`import assert from 'node:assert/strict';import {openMemoryCore} from ${JSON.stringify(moduleURL('core/contract.mjs'))};${childHost}
    const [path,version]=process.argv.slice(1),core=openMemoryCore({path,methodPackages:methods,assets:{version:'assets-local-v1',storage:'sqlite-blob-v1',authority}});
    try{for(const name of ['first.pdf','second.pdf']){const parts=[];let cursor;do{const page=ok(core.readMethodAttachmentBytes({version:JSON.parse(version),path:name,intent:'history',...(cursor?{cursor}:{})},token));parts.push(Buffer.from(page.bytes,'base64'));cursor=page.nextCursor;}while(cursor);const actual=Buffer.concat(parts),expected=Buffer.alloc(70000,0x61);expected.set(Buffer.from('%PDF-1.7'));assert.deepEqual(actual,expected);}}finally{core.close();}`,[f.path,JSON.stringify(receipt.version)]);
  assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(),[]);
});
test('K04 binary views and complete action bindings are private before callbacks; offsets survive callback mutation',t=>{
  const f=fixture(t,{methods:true}),backing=Buffer.concat([Buffer.from('outside'),pdf(33000),Buffer.from('outside')]),view=new Uint8Array(backing.buffer,backing.byteOffset+7,33000),expected=Buffer.from(view);
  let grants=0;f.trusted.state.authorizeHook=request=>{
    if(request.method!=='importMethodVersion')return;grants++;
    const visible=request.input.files[1].bytes;assert.deepEqual(Object.keys(visible).sort(),['byteCount','commitment']);assert.equal(visible.byteCount,33000);
    assert.equal(visible.commitment,request.payloadBinding);assert.ok(Object.isFrozen(visible));assert.equal(visible instanceof Uint8Array,false);backing.fill(0);
  };
  const request=mixedInput('offset',{files:[textEntry(),binaryEntry('reference.pdf',view)]}),receipt=ok(f.call('importMethodVersion',request));
  f.trusted.state.authorizeHook=null;assert.equal(grants,2);assert.deepEqual(attachmentBytes(f,receipt.version),expected);
  const copy={...request,files:[textEntry(),binaryEntry('reference.pdf',expected)]};assert.deepEqual(ok(f.call('importMethodVersion',copy)),receipt);
  const changed=Buffer.from(expected);changed[100]^=1;error(f.call('importMethodVersion',{...copy,files:[textEntry(),binaryEntry('reference.pdf',changed)]}),'action_conflict');
});
test('K04 later mixed imports prepare every input MAC before callbacks and BEGIN IMMEDIATE, including their base/change bindings',t=>{
  const f=fixture(t,{methods:true}),first=ok(f.call('importMethodVersion',mixedInput())),originalMAC=crypto.createHmac,originalExec=DatabaseSync.prototype.exec;
  let phase='prepare',calls=0;
  const mac=t.mock.method(crypto,'createHmac',function(...args){assert.equal(phase,'prepare');calls++;return originalMAC(...args);});syncBuiltinESMExports();
  const exec=t.mock.method(DatabaseSync.prototype,'exec',function(sql){if(sql==='BEGIN IMMEDIATE'){assert.equal(phase,'authorized');phase='transaction';}return originalExec.call(this,sql);});
  f.trusted.state.authorizeHook=()=>{assert.ok(['prepare','authorized'].includes(phase));phase='authorized';};
  try{const second=ok(f.call('importMethodVersion',mixedInput('later',{package:first.package,expectedPackageRevision:1,basedOn:first.version,change:{items:[{summary:'Supplied later edge',paths:['reference.pdf']}],reasonRefs:[]}})));assert.equal(second.ordinal,2);assert.ok(calls>0);}
  finally{f.trusted.state.authorizeHook=null;mac.mock.restore();syncBuiltinESMExports();exec.mock.restore();}
});
test('K04 mixed manifest/tag/path/media/binary and text bounds reject without partial quota, ledger or versions',t=>{
  const f=fixture(t,{methods:true});
  const bad=[{manifestFormat:'mixed-v2'},{files:[textEntry()]},{files:[{...binaryEntry(),text:'extra'}]},
    {files:[{...textEntry(),bytes:pdf()}]},{files:[binaryEntry('../x.pdf')]},{files:[binaryEntry('A.pdf'),binaryEntry('a.pdf')]},
    {files:[binaryEntry('x.png')]},{files:[binaryEntry('x.pdf',new Uint8Array())]},
    {files:[binaryEntry('x.pdf',new Uint8Array(new SharedArrayBuffer(8)))]},{files:[textEntry('x','\uD800'),binaryEntry()]},
    {files:[textEntry('x','x'.repeat(400001)),binaryEntry()]},{files:[...Array.from({length:256},(_,i)=>textEntry('f'+i,'')),binaryEntry()]},
    {files:[...Array.from({length:11},(_,i)=>textEntry('f'+i,'x'.repeat(400000))),binaryEntry()]},
    {title:new Uint8Array(1)},{change:{items:[{summary:new Uint8Array(1),paths:[]}],reasonRefs:[]}}];
  for(const [i,patch]of bad.entries())error(f.call('importMethodVersion',mixedInput('bad-'+i,patch)),patch.files?.[0]?.path?.startsWith('..')||i===5?'invalid_path':i===6?'unsupported_media':'invalid_input');
  const detached=new Uint8Array(new ArrayBuffer(8));structuredClone(detached,{transfer:[detached.buffer]});error(f.call('importMethodVersion',mixedInput('detached',{files:[binaryEntry('x.pdf',detached)]})),'invalid_input');
  error(f.call('importMethodVersion',mixedInput('entry-one-over',{files:[binaryEntry('x.pdf',pdf(33554433))]})),'invalid_input');
  const maximum=pdf(33554432);error(f.call('importMethodVersion',mixedInput('total-one-over',{files:[binaryEntry('a.pdf',maximum),binaryEntry('b.pdf',maximum),binaryEntry('c.pdf',pdf())]})),'invalid_input');
  for(const table of ['method_versions','method_operations','binary_objects','binary_owner_usage'])assert.equal(f.db.prepare('SELECT count(*) n FROM '+table).get().n,0,table);
  const valid=ok(f.call('importMethodVersion',mixedInput('max-entries',{files:[...Array.from({length:255},(_,i)=>textEntry('f'+i,'')),binaryEntry()]})));
  assert.equal(collect(f,'listMethodManifest',history(valid.version),'files').length,256);
});
test('K04/K12 method-only readers retain mixed metadata; binary import/delivery require separate method and asset grants',t=>{
  const f=fixture(t,{methods:true}),receipt=ok(f.call('importMethodVersion',mixedInput())),methodOnly=openMemoryCore({path:f.path,methodPackages:f.trusted.methods});t.after(()=>methodOnly.close());
  const call=(method,input)=>f.trusted.call(methodOnly,method,input);
  assert.equal(ok(call('getMethodVersion',history(receipt.version))).version.manifestFormat,'mixed-v1');assert.equal(ok(call('listMethodManifest',history(receipt.version))).files[1].kind,'binary');
  assert.equal(ok(call('readMethodFile',{...history(receipt.version),path:'SKILL.md'})).parts[0].text,'Synthetic method\n');
  error(call('readMethodFile',{...history(receipt.version),path:'reference.pdf'}),'unsupported_media');
  error(call('readMethodAttachmentBytes',{...history(receipt.version),path:'reference.pdf'}),'unsupported_media');error(call('importMethodVersion',mixedInput('no-assets')),'unsupported_media');
  let binaryAllowed=false,assetGrants=0;
  const authority={authorize(request,token){assetGrants++;return binaryAllowed?f.trusted.authority.authorize(request,token):null;},isCurrent:f.trusted.authority.isCurrent};
  const both=openMemoryCore({path:f.path,methodPackages:f.trusted.methods,assets:{...f.trusted.options,authority}});t.after(()=>both.close());
  const bothCall=(method,input)=>f.trusted.call(both,method,input),read={...history(receipt.version),path:'reference.pdf'};
  error(bothCall('readMethodAttachmentBytes',read),'authority_required');error(bothCall('importMethodVersion',mixedInput('denied')),'authority_required');
  binaryAllowed=true;const page=ok(bothCall('readMethodAttachmentBytes',read));assert.equal(assetGrants,3);
  binaryAllowed=false;error(bothCall('readMethodAttachmentBytes',{...read,cursor:page.nextCursor}),'authority_required');
});
test('K10 adoption changes stale current text/attachment streams and pins; history stays exact through switch and disable',t=>{
  const f=fixture(t,{methods:true}),first=ok(f.call('importMethodVersion',mixedInput('first',{files:[textEntry('SKILL.md','a'.repeat(9000)),binaryEntry('reference.pdf',pdf(80000))]}))),
    second=ok(f.call('importMethodVersion',mixedInput('second',{package:first.package,expectedPackageRevision:1,basedOn:first.version,files:[textEntry('SKILL.md','b'.repeat(9000)),binaryEntry('reference.pdf',pdf(80001))]})));
  ok(f.call('adoptMethodVersion',adopt(first)));const pin=ok(f.call('resolveMethod',{package:first.package,...context})).snapshot;
  const current={version:first.version,intent:'current',context,snapshot:pin},binary={...current,path:'reference.pdf'},text={...current,path:'SKILL.md'};
  const b=ok(f.call('readMethodAttachmentBytes',binary)),a=ok(f.call('readMethodFile',text));assert.equal(a.parts[0].text,'a'.repeat(4000));
  const hist={...binary,intent:'history'},h=ok(f.call('readMethodAttachmentBytes',hist));
  ok(f.call('adoptMethodVersion',adopt(second,'switch',1)));
  error(f.call('readMethodAttachmentBytes',{...binary,cursor:b.nextCursor}),'cursor_stale');error(f.call('readMethodFile',{...text,cursor:a.nextCursor}),'cursor_stale');
  error(f.call('readMethodAttachmentBytes',binary),'cursor_stale');error(f.call('readMethodAttachmentBytes',{version:first.version,path:'reference.pdf',intent:'current',context}),'method_version_unavailable');
  assert.equal(ok(f.call('readMethodAttachmentBytes',{...hist,cursor:h.nextCursor})).adoptionStatus,'newer-version-available');
  assert.deepEqual(attachmentBytes(f,first.version,'reference.pdf',{context,snapshot:pin}),pdf(80000));
  ok(f.call('disableMethodBinding',disable(first,'withdraw',2)));assert.equal(ok(f.call('readMethodAttachmentBytes',hist)).adoptionStatus,'withdrawn');
  assert.deepEqual(attachmentBytes(f,first.version,'reference.pdf',{context,snapshot:pin}),pdf(80000));
  const hidden=ok(f.call('readMethodAttachmentBytes',{...hist,context:{readSet:[project],roleId:'reader'}}));assert.deepEqual(hidden,{status:'unavailable',adoptionStatus:'unavailable'});
});
test('K10 an independent adopter commits between pages; current text and byte continuations stale together and history never retargets',async t=>{
  const f=fixture(t,{methods:true}),first=ok(f.call('importMethodVersion',mixedInput('before',{files:[textEntry('SKILL.md','before'.repeat(1500)),binaryEntry('reference.pdf',pdf(70000))]}))),
    second=ok(f.call('importMethodVersion',mixedInput('after',{package:first.package,expectedPackageRevision:1,basedOn:first.version,files:[textEntry('SKILL.md','after'.repeat(1800)),binaryEntry('reference.pdf',pdf(80000))]})));
  ok(f.call('adoptMethodVersion',adopt(first)));
  const ready=join(f.workspace.path,'adopter.ready'),start=join(f.workspace.path,'adopter.start'),output=join(f.workspace.path,'adopter.stdout'),errors=join(f.workspace.path,'adopter.stderr');
  const code=`import {openMemoryCore} from ${JSON.stringify(moduleURL('core/contract.mjs'))};import {writeFileSync,existsSync} from 'node:fs';import {setTimeout as delay} from 'node:timers/promises';${childHost}
    const [path,ready,start,input]=process.argv.slice(1),core=openMemoryCore({path,methodPackages:methods});try{writeFileSync(ready,String(process.pid));const deadline=Date.now()+15000;while(!existsSync(start)){if(Date.now()>deadline)throw Error('start deadline');await delay(5);}ok(core.adoptMethodVersion(JSON.parse(input),token));}finally{core.close();}`;
  const out=openSync(output,'wx'),err=openSync(errors,'wx'),env={...process.env};delete env.NODE_TEST_CONTEXT;
  let worker;try{worker=spawn(process.execPath,['--input-type=module','-e',code,f.path,ready,start,JSON.stringify(adopt(second,'external-switch',1))],{env,stdio:['ignore',out,err]});}finally{closeSync(out);closeSync(err);}
  const closed=new Promise(resolve=>{worker.once('error',error=>resolve({error}));worker.once('close',(code,signal)=>resolve({code,signal}));});
  f.workspace.defer(async()=>{if(worker.exitCode===null&&worker.signalCode===null)worker.kill('SIGKILL');await closed;});
  await until(()=>existsSync(ready),'independent adopter ready');assert.notEqual(Number(readFileSync(ready,'utf8')),process.pid);
  const snapshot=ok(f.call('resolveMethod',{package:first.package,...context})).snapshot,current={version:first.version,intent:'current',context,snapshot};
  const text=ok(f.call('readMethodFile',{...current,path:'SKILL.md'})),bytes=ok(f.call('readMethodAttachmentBytes',{...current,path:'reference.pdf'}));
  assert.equal(text.parts[0].text,'before'.repeat(1500).slice(0,4000));assert.deepEqual(Buffer.from(bytes.bytes,'base64'),pdf(70000).subarray(0,32768));
  writeFileSync(start,'go');assert.deepEqual(await closed,{code:0,signal:null},readFileSync(errors,'utf8'));
  error(f.call('readMethodFile',{...current,path:'SKILL.md',cursor:text.nextCursor}),'cursor_stale');
  error(f.call('readMethodAttachmentBytes',{...current,path:'reference.pdf',cursor:bytes.nextCursor}),'cursor_stale');
  assert.deepEqual(attachmentBytes(f,first.version,'reference.pdf',{context,snapshot}),pdf(70000));
  assert.equal(ok(f.call('readMethodFile',{...current,intent:'history',path:'SKILL.md'})).parts[0].text,'before'.repeat(1500).slice(0,4000));
});
test('K07/K10 authenticated attachment cursors bind exact paths, versions, scopes and grants; deletion precedes staleness',t=>{
  const f=fixture(t,{methods:true}),receipt=ok(f.call('importMethodVersion',mixedInput('cursors',{files:[binaryEntry('a.pdf'),binaryEntry('b.pdf')]}))),read={...history(receipt.version),path:'a.pdf'},first=ok(f.call('readMethodAttachmentBytes',read));
  error(f.call('readMethodAttachmentBytes',{...read,path:'b.pdf',cursor:first.nextCursor}),'invalid_cursor');
  error(f.call('readMethodAttachmentBytes',{...read,cursor:first.nextCursor+'x'}),'invalid_cursor');
  f.trusted.state.generation++;error(f.call('readMethodAttachmentBytes',{...read,cursor:first.nextCursor}),'invalid_cursor');f.trusted.state.generation--;
  ok(f.call('deleteMethodVersion',{actionId:'purge',ref:receipt.version,expectedRevision:1}));
  assert.deepEqual(ok(f.call('readMethodAttachmentBytes',{...read,cursor:first.nextCursor})),{status:'unavailable',adoptionStatus:'unavailable'});
  error(f.call('readMethodAttachmentBytes',{...read,cursor:first.nextCursor+'x'}),'invalid_cursor');
});
test('K04 mechanical mixed comparison uses kind, media and identity and attributes change items only to their stored edge',t=>{
  const f=fixture(t,{methods:true}),first=ok(f.call('importMethodVersion',mixedInput('first',{files:[textEntry('same','abc'),binaryEntry('image.pdf',pdf())]}))),
    second=ok(f.call('importMethodVersion',mixedInput('second',{package:first.package,expectedPackageRevision:1,basedOn:first.version,
      files:[textEntry('same','abc','text/plain'),binaryEntry('image.pdf',pdf(9)),binaryEntry('added.pdf',pdf())],change:{items:[{summary:'Supplied change',paths:['image.pdf']}],reasonRefs:[]}})));
  const diff=ok(f.call('compareMethodVersions',{from:first.version,to:second.version}));assert.deepEqual(diff.changes,[{path:'added.pdf',status:'added'},{path:'image.pdf',status:'changed'},{path:'same',status:'changed'}]);assert.equal(diff.items[0].summary,'Supplied change');
  const back=ok(f.call('compareMethodVersions',{from:second.version,to:first.version}));assert.deepEqual(back.items,[]);assert.equal(back.reason,'not-recorded');
  const third=ok(f.call('importMethodVersion',mixedInput('third',{package:first.package,expectedPackageRevision:2,basedOn:second.version,files:[textEntry('same','abc'),binaryEntry('image.pdf',pdf())]})));
  assert.equal(ok(f.call('compareMethodVersions',{from:first.version,to:third.version})).changes.find(item=>item.path==='image.pdf').status,'unchanged');
});
for(const attack of ['chunk','missing-final','total','identity'])test(`K03/K07 mixed attachment selected-chunk verification refuses ${attack} corruption`,t=>{
  const f=fixture(t,{methods:true}),receipt=ok(f.call('importMethodVersion',mixedInput())),object=f.db.prepare('SELECT * FROM binary_objects').get(),read={...history(receipt.version),path:'reference.pdf'};
  const first=ok(f.call('readMethodAttachmentBytes',read));
  if(attack==='chunk')corrupt(f.db,'binary_chunk_immutable','UPDATE binary_chunks SET bytes=? WHERE object_id=? AND chunk_index=1',Buffer.alloc(232),object.id);
  if(attack==='missing-final')f.db.prepare('DELETE FROM binary_chunks WHERE object_id=? AND chunk_index=1').run(object.id);
  if(attack==='total')corrupt(f.db,'binary_object_immutable','UPDATE binary_objects SET byte_count=byte_count-1 WHERE id=?',object.id);
  if(attack==='identity')corrupt(f.db,'method_mixed_immutable',"UPDATE method_mixed_entries SET content_identity=? WHERE version_id=? AND kind='binary'",'x'.repeat(43),receipt.version.versionId);
  error(f.call('readMethodAttachmentBytes',{...read,cursor:first.nextCursor}),'method_version_unavailable');
});
test('K10 requested attachment reads verify metadata without fetching any method text or unrelated chunks; all reads use query_only',t=>{
  const f=fixture(t,{methods:true}),receipt=ok(f.call('importMethodVersion',mixedInput())),prepare=DatabaseSync.prototype.prepare;let readConnection;
  const mock=t.mock.method(DatabaseSync.prototype,'prepare',function(sql){
    if(sql.includes('FROM method_mixed_entries')&&sql.startsWith('SELECT')){readConnection=this;assert.equal(this.prepare('PRAGMA query_only').get().query_only,1);assert.throws(()=>prepare.call(this,'UPDATE method_packages SET revision=revision+1').run());}
    if(sql.includes('FROM method_files')&&/\btext\b/.test(sql))throw Error('unexpected text fetch');
    return prepare.call(this,sql);
  });
  ok(f.call('readMethodAttachmentBytes',{...history(receipt.version),path:'reference.pdf'}));mock.mock.restore();assert.ok(readConnection);assert.equal(readConnection.prepare('PRAGMA query_only').get().query_only,0);
  f.db.prepare("UPDATE method_files SET text='CORRUPTED' WHERE version_id=?").run(receipt.version.versionId);
  assert.deepEqual(attachmentBytes(f,receipt.version),pdf(33000));error(f.call('getMethodVersion',history(receipt.version)),'method_version_unavailable');
});
test('K12 worst-case namespace UTF8 and escaped attachment paths keep the envelope and the opaque continuation within their ceilings',t=>{
  const f=fixture(t),token={},grants=new WeakMap(),authority={authorize(request,supplied){if(supplied!==token)return null;const grant={},{input,...binding}=request;grants.set(grant,{...binding,accessGeneration:1});return grant;},isCurrent(grant){return grants.get(grant)??null;}};
  const core=openMemoryCore({path:f.path,methodPackages:{version:'method-packages-local-v1',storage:'local-plain-v1',authority},assets:{version:'assets-local-v1',storage:'sqlite-blob-v1',authority}});t.after(()=>core.close());
  const namespace={ownerId:'界'.repeat(200),scope:'project',projectId:'界'.repeat(200)},path='\u0001'.repeat(508)+'.pdf';
  const call=(method,input)=>{const result=core[method](input,token);assert.ok(Buffer.byteLength(JSON.stringify(result))<=65536);return ok(result);};
  const imported=call('importMethodVersion',mixedInput('escaped-max',{namespace,files:[binaryEntry(path)]}));
  const first=call('readMethodAttachmentBytes',{version:imported.version,path,intent:'history'});
  assert.equal(first.byteCount,32768);assert.ok(first.nextCursor.length<=8192);
  const final=call('readMethodAttachmentBytes',{version:imported.version,path,intent:'history',cursor:first.nextCursor});assert.equal(final.byteCount,232);assert.equal(final.complete,true);
});
