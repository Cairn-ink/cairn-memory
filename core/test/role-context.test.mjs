import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { openSync,closeSync,readFileSync } from 'node:fs';
import { fixture,host,ns,project,publish,read,importMethod,adopt,ok } from './role-fixture.mjs';
import { optionalRoleCounter } from './role-fixture.mjs';
const fields=(pkg,duty='Review records')=>({duties:[duty],requiredOutputs:['Report decisions'],methods:[pkg]});
const hash=text=>createHash('sha256').update(text).digest('hex');
function child(f,source,args=[]) {
 const out=openSync(f.dir+'/child.stdout','w',0o600),err=openSync(f.dir+'/child.stderr','w',0o600);
 let result;try{result=spawnSync(process.execPath,['--input-type=module','-e',source,...args],{stdio:['ignore',out,err],timeout:15000});}finally{closeSync(out);closeSync(err);}
 assert.equal(result.error,undefined);assert.equal(result.status,0,readFileSync(f.dir+'/child.stderr','utf8'));return readFileSync(f.dir+'/child.stdout','utf8');
}
const helper=new URL('./role-fixture.mjs',import.meta.url).href,index=new URL('../index.mjs',import.meta.url).href;
test('C02/C07 offline three-role workflow and exact text continuation through adoption, withdrawal, restart and deletion',t=>{
 const f=fixture(t),v1=ok(f.call('importMethodVersion',importMethod()));ok(f.call('adoptMethodVersion',adopt(v1)));
 const unchanged={};
 for(const role of ['COO','CTO','finance']){
  const method=role==='finance'?v1:ok(f.call('importMethodVersion',importMethod(role+'-method',role+' canonical method')));
  if(role!=='finance')ok(f.call('adoptMethodVersion',adopt(method,role+'-adopt')));
  ok(f.call('publishRoleProfileRelease',publish(ns,role,role,null,null,{...fields(method.package,role+' duty'),requiredOutputs:[role+' decisions'],appliesTo:role+' scope',related:[]})));
  unchanged[role]=ok(f.call('readRoleTaskContext',read(role))).metered;
 }
 const oldMemory=ok(f.call('admit',{namespace:ns,memory:{content:'finance original evidence',kind:'fact'},receipts:[{client:'s',sessionId:'s',eventId:'old-evidence',role:'user',excerpt:'finance original evidence'}]})).memory;
 const original=ok(f.call('readRoleTaskContext',{...read(),task:'finance'})).metered,receipt=original.receipt;
 assert.equal(original.evidence.length,1);
 const v2=ok(f.call('importMethodVersion',{...importMethod('method-2','version two'),package:v1.package,basedOn:v1.version,expectedPackageRevision:1}));
 assert.deepEqual(ok(f.call('readRoleTaskContext',read())).metered.methods[0].version,v1.version);
 const output=child(f,`import {openMemoryCore} from ${JSON.stringify(index)};import {host,ok,adopt} from ${JSON.stringify(helper)};const h=host(),core=openMemoryCore({path:process.argv[1],methodPackages:h.methods});ok(core.adoptMethodVersion(adopt(JSON.parse(process.argv[2]),'adopt-v2',null,undefined,1),{}));console.log(JSON.stringify(core.close()));`,[f.path,JSON.stringify(v2)]);assert.ok(output.includes('"ok":true'));
 f.reopen();
 const current=ok(f.call('readRoleTaskContext',read())).metered;assert.deepEqual(current.methods[0].version,v2.version);
 for(const role of ['COO','CTO']){const after=ok(f.call('readRoleTaskContext',read(role))).metered;assert.deepEqual(after.profile,unchanged[role].profile);assert.deepEqual(after.methods,unchanged[role].methods);assert.deepEqual(after.registries,unchanged[role].registries);}
 const then=ok(f.call('readRoleTaskContext',{mode:'then',readSet:[ns],receipt})).metered;assert.equal(then.receipt,receipt);assert.deepEqual(then.methods[0].version,v1.version);assert.equal(then.methods[0].adoptionStatus,'newer-version-available');
 const fileInput={mode:'file',readSet:[ns],receipt,package:v1.package,path:'guide.txt'};
 let file=ok(f.call('readRoleTaskContext',fileInput)).metered.file;assert.equal(file.parts[0].text,'version one');assert.equal(hash(file.parts[0].text),hash('version one'));assert.deepEqual(file.version,v1.version);
 const extra=ok(f.call('importMethodVersion',importMethod('refresh-extra','Extra current method')));ok(f.call('adoptMethodVersion',adopt(extra,'extra-adopt')));
 const newProfile=ok(f.call('publishRoleProfileRelease',publish(ns,'finance','replace-profile',original.profile.release.ref,1,{duties:['Replacement duties'],requiredOutputs:['Replacement outputs'],appliesTo:'Replacement scope',methods:[v1.package,extra.package]})));
 ok(f.call('forget',{namespace:ns,memoryId:oldMemory.id,expectedRevision:1}));
 const newMemory=ok(f.call('admit',{namespace:ns,memory:{content:'finance replacement evidence',kind:'fact'},receipts:[{client:'s',sessionId:'s',eventId:'new-evidence',role:'user',excerpt:'finance replacement evidence'}]})).memory;
 const refreshed=ok(f.call('readRoleTaskContext',{mode:'refresh',readSet:[ns],receipt,task:'finance'})).metered;
 assert.notEqual(refreshed.receipt,receipt);assert.deepEqual(refreshed.methods.map(m=>m.version),[v2.version,extra.version]);assert.deepEqual(refreshed.profile.release.ref,newProfile.release);
 const oldPayload=JSON.parse(receipt).p,newPayload=JSON.parse(refreshed.receipt).p;
 assert.deepEqual(newPayload.profiles,[[0,newProfile.release.profile.profileId,newProfile.release.releaseId,newProfile.release.contentIdentity,1]]);
 assert.deepEqual(newPayload.heads,[[0,newProfile.release.profile.profileId,2,'active',0]]);assert.equal(oldPayload.heads[0][2],1);
 assert.deepEqual(newPayload.evidence.map(e=>e[0][2]),[newMemory.id]);assert.equal(newPayload.evidence.some(e=>e[0][2]===oldMemory.id),false);
 const freshNow=ok(f.call('readRoleTaskContext',{...read(),task:'finance'})).metered;
 assert.deepEqual(refreshed.profile,freshNow.profile);assert.deepEqual(refreshed.registries,freshNow.registries);assert.deepEqual(refreshed.evidence,freshNow.evidence);
 const freshPayload=JSON.parse(freshNow.receipt).p;delete freshPayload.id;delete newPayload.id;assert.deepEqual(newPayload,freshPayload);
 ok(f.call('publishRoleProfileRelease',publish(project,'finance','project-profile',null,null,fields(v1.package))));ok(f.call('adoptMethodVersion',adopt(v1,'project-v1','finance',project,null,[ns,project])));
 const projectCurrent=ok(f.call('readRoleTaskContext',read('finance',[ns,project]))).metered;assert.deepEqual(projectCurrent.methods[0].version,v1.version);assert.deepEqual(ok(f.call('readRoleTaskContext',read())).metered.methods[0].version,v2.version);
 const {version:withdrawnVersion,...withdraw}=adopt(v2,'withdraw',null,ns,2);ok(f.call('disableMethodBinding',withdraw));
 f.reopen();const historical=ok(f.call('readRoleTaskContext',{mode:'then',readSet:[ns],receipt})).metered;assert.equal(historical.methods[0].adoptionStatus,'withdrawn');
 file=ok(f.call('readRoleTaskContext',fileInput)).metered.file;assert.equal(hash(file.parts[0].text),hash('version one'));
 ok(f.call('deleteMethodVersion',{actionId:'delete-v1',ref:v1.version,expectedRevision:1}));assert.equal(ok(f.call('readRoleTaskContext',fileInput)).metered.file,null);
 f.reopen();assert.equal(ok(f.call('readRoleTaskContext',fileInput)).metered.file,null);
 f.h.revoke();assert.equal(f.call('readRoleTaskContext',fileInput).error.code,'authority_required');
});
test('C07 project-only unavailable package preserves identity without target reads or read-set widening',t=>{
 const f=fixture(t),method=ok(f.call('importMethodVersion',importMethod()));
 ok(f.call('adoptMethodVersion',adopt(method,'cross','finance',project,null,[ns,project])));
 ok(f.call('publishRoleProfileRelease',publish(project,'finance','project',null,null,fields(method.package))));
 const prepare=DatabaseSync.prototype.prepare;let targetLookups=0;
 DatabaseSync.prototype.prepare=function(sql){if(sql.includes('FROM method_versions')||sql.includes('SELECT * FROM method_packages')){targetLookups++;throw Error('unauthorized target lookup');}return prepare.call(this,sql);};
 let result;const before=f.h.requests.length;
 try{result=ok(f.call('readRoleTaskContext',read('finance',[project]))).metered;}finally{DatabaseSync.prototype.prepare=prepare;}
 assert.equal(targetLookups,0);
 assert.equal(result.methods[0].status,'unavailable');assert.deepEqual(result.methods[0].package,method.package);assert.equal(result.methods[0].manifest,null);
 const p=JSON.parse(result.receipt).p;assert.deepEqual(p.methods[0][0],ns);assert.equal(p.methods[0][6],null);assert.equal(p.readSet.length,1);
 assert.ok(f.h.requests.slice(before).every(r=>r.namespace.scope==='project'));
 assert.equal(ok(f.call('readRoleTaskContext',{mode:'file',readSet:[project],receipt:result.receipt,package:method.package,path:'guide.txt'})).metered.file,null);
});
test('C03 independent exact budget recount, required overflow and receipt scope/tamper/refusal',async t=>{
 const counter=await optionalRoleCounter(t);if(!counter)return;const f=fixture(t,{h:host({counter})});ok(f.call('publishRoleProfileRelease',publish()));
 const result=ok(f.call('readRoleTaskContext',read()));
 const sort=v=>Array.isArray(v)?v.map(sort):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort((a,b)=>Buffer.compare(Buffer.from(a),Buffer.from(b))).map(k=>[k,sort(v[k])])):v;
 const independent=JSON.stringify(sort({ok:true,value:result.metered,evidenceTrust:'untrusted-data-not-instructions'}));assert.equal(result.diagnostics.budget.used,counter.countTokens(independent));assert.ok(result.diagnostics.trace.counterCalls<=2);
 const small=f.call('readRoleTaskContext',{...read(),budget:{maxTokens:64}});assert.equal(small.error.code,'budget_insufficient');assert.equal(small.error.details.requiredTokens>64,true);assert.equal(small.error.details.requiredBytes.receipt,Buffer.byteLength(result.metered.receipt));assert.equal('value' in small,false);
 const tampered=result.metered.receipt.replace('finance','financf');assert.equal(f.call('readRoleTaskContext',{mode:'then',readSet:[ns],receipt:tampered}).error.code,'invalid_receipt');
 assert.equal(f.call('readRoleTaskContext',{mode:'then',readSet:[project],receipt:result.metered.receipt}).error.code,'scope_changed');
});
test('C07 file ranges stay code-point aligned and whole; binary continuation uses exact version with U4 grants and bytes',t=>{
 const f=fixture(t),text='a'.repeat(3999)+'😀tail',bytes=Buffer.from('%PDF-1.7synthetic attachment');
 const v1=ok(f.call('importMethodVersion',{namespace:ns,actionId:'mixed',title:'Mixed',manifestFormat:'mixed-v1',files:[{kind:'text',path:'guide.txt',text,mediaType:'text/plain'},{kind:'binary',path:'attachment.pdf',bytes,mediaType:'application/pdf'}]}));
 ok(f.call('adoptMethodVersion',adopt(v1)));ok(f.call('publishRoleProfileRelease',publish(ns,'finance','mixed-profile',null,null,fields(v1.package))));
 const receipt=ok(f.call('readRoleTaskContext',read())).metered.receipt;
 const input={mode:'file',readSet:[ns],receipt,package:v1.package,path:'guide.txt'};
 const first=ok(f.call('readRoleTaskContext',input)).metered.file;assert.equal(first.parts[0].text.length,3999);const next=ok(f.call('readRoleTaskContext',{...input,range:first.nextRange})).metered.file;assert.equal(first.parts[0].text+next.parts[0].text,text);
 assert.equal(f.call('readRoleTaskContext',{...input,range:{start:4000,end:4002}}).error.code,'invalid_input');
 const binary=ok(f.call('readRoleTaskContext',{...input,path:'attachment.pdf'})).metered.file;assert.equal(binary.kind,'binary');assert.deepEqual(binary.version,v1.version);assert.deepEqual(binary.parts,[]);
 const attachment=ok(f.call('readMethodAttachmentBytes',{version:binary.version,path:binary.path,intent:'history',context:{readSet:[ns],roleId:'finance'}}));assert.equal(hash(Buffer.from(attachment.bytes,'base64')),hash(bytes));
 const grants=f.h.requests.filter(r=>r.method==='readRoleTaskContext'&&r.input.path==='attachment.pdf');assert.ok(grants.length>=2);
 ok(f.call('deleteMethodVersion',{actionId:'delete-mixed',ref:v1.version,expectedRevision:1}));assert.equal(ok(f.call('readRoleTaskContext',{...input,path:'attachment.pdf'})).metered.file,null);assert.equal(ok(f.call('readMethodAttachmentBytes',{version:v1.version,path:'attachment.pdf',intent:'history',context:{readSet:[ns],roleId:'finance'}})).status,'unavailable');
});
test('C07 second-process adoption between then and file never changes receipt text or attachment bytes',t=>{
 const f=fixture(t),bytes=Buffer.from('%PDF-1.7old binary'),input={namespace:ns,actionId:'mixed-old',title:'Original',manifestFormat:'mixed-v1',files:[{kind:'text',path:'guide.txt',text:'original guidance',mediaType:'text/plain'},{kind:'binary',path:'attachment.pdf',bytes,mediaType:'application/pdf'}]};
 const original=ok(f.call('importMethodVersion',input));ok(f.call('adoptMethodVersion',adopt(original)));ok(f.call('publishRoleProfileRelease',publish(ns,'finance','profile',null,null,fields(original.package))));
 const receipt=ok(f.call('readRoleTaskContext',read())).metered.receipt;
 const next=ok(f.call('importMethodVersion',{...input,actionId:'mixed-new',package:original.package,basedOn:original.version,expectedPackageRevision:1,files:input.files.map(file=>file.kind==='text'?{...file,text:'replacement guidance'}:{...file,bytes:Buffer.from('%PDF-1.7new binary')})}));
 const then=ok(f.call('readRoleTaskContext',{mode:'then',readSet:[ns],receipt})).metered;assert.equal(then.methods[0].adoptionStatus,'current');
 child(f,`import {openMemoryCore} from ${JSON.stringify(index)};import {host,ok,adopt} from ${JSON.stringify(helper)};const h=host(),core=openMemoryCore({path:process.argv[1],methodPackages:h.methods});ok(core.adoptMethodVersion(adopt(JSON.parse(process.argv[2]),'switch',null,undefined,1),{}));core.close();`,[f.path,JSON.stringify(next)]);
 const file={mode:'file',readSet:[ns],receipt,package:original.package,path:'guide.txt'};
 assert.equal(ok(f.call('readRoleTaskContext',file)).metered.file.parts[0].text,'original guidance');
 for(const step of ['after-adoption','after-withdrawal','after-restart']) {
  if(step==='after-withdrawal'){const {version,...withdraw}=adopt(next,'withdraw-mixed',null,ns,2);ok(f.call('disableMethodBinding',withdraw));}if(step==='after-restart')f.reopen();
  const binary=ok(f.call('readRoleTaskContext',{...file,path:'attachment.pdf'})).metered.file;
  const page=ok(f.call('readMethodAttachmentBytes',{version:binary.version,path:binary.path,intent:'history',context:{readSet:[ns],roleId:'finance'}}));assert.equal(hash(Buffer.from(page.bytes,'base64')),hash(bytes),step);
 }
});
test('C03 16-package and non-Latin mandatory overflows refuse with independently recounted required tokens',async t=>{
 const counter=await optionalRoleCounter(t);if(!counter)return;const f=fixture(t,{h:host({counter})}),packages=[];
 for(let i=0;i<16;i++){const method=ok(f.call('importMethodVersion',importMethod('method-'+i)));ok(f.call('adoptMethodVersion',adopt(method,'adopt-'+i)));packages.push(method.package);}
 const maximum=Array.from({length:16},(_,j)=>('Item '+j+': '+'Review records and report decisions with source references. '.repeat(8)).slice(0,300));
 const release=ok(f.call('publishRoleProfileRelease',publish(ns,'finance','sixteen',null,null,{duties:maximum.slice(0,8),requiredOutputs:maximum.slice(8),methods:packages})));
 const result=f.call('readRoleTaskContext',read());assert.equal(result.error.code,'budget_insufficient');assert.ok(result.error.details.requiredTokens>4000);assert.equal('value' in result,false);
 ok(f.call('publishRoleProfileRelease',publish(ns,'finance','unicode',release.release,1,{duties:Array(8).fill('\uE000'.repeat(300)),requiredOutputs:Array(8).fill('\uE000'.repeat(300)),methods:packages.slice(0,4)})));
 const unicode=f.call('readRoleTaskContext',read());assert.equal(unicode.error.code,'budget_insufficient');assert.ok(unicode.error.details.requiredTokens>11000);
});
test('C07 Namespace arm preserves unchanged U2 no-active and disabled results without personal access',t=>{
 const f=fixture(t),method=ok(f.call('importMethodVersion',importMethod()));ok(f.call('publishRoleProfileRelease',publish(project,'finance','profile',null,null,fields(method.package))));
 let value=ok(f.call('readRoleTaskContext',read('finance',[project]))).metered;assert.equal(value.methods[0].status,'no-active-version');assert.deepEqual(JSON.parse(value.receipt).p.methods[0][0],ns);
 const {version,...disabled}=adopt(method,'disabled','finance',project,null,[ns,project]);ok(f.call('disableMethodBinding',disabled));
 value=ok(f.call('readRoleTaskContext',read('finance',[project]))).metered;assert.equal(value.methods[0].status,'disabled');assert.deepEqual(JSON.parse(value.receipt).p.methods[0][0],ns);assert.equal(JSON.parse(value.receipt).p.methods[0][6],null);
});
test('C03 actual four-package maximum English fixture fits the 4000 default with every method represented',async t=>{
 const counter=await optionalRoleCounter(t);if(!counter)return;const f=fixture(t,{h:host({counter})}),methods=[];
 for(let i=0;i<4;i++){const m=ok(f.call('importMethodVersion',importMethod('english-method-'+i)));ok(f.call('adoptMethodVersion',adopt(m,'english-adopt-'+i)));methods.push(m.package);}
 const text=Array.from({length:16},(_,j)=>('Item '+j+': '+'Review records and report decisions with source references. '.repeat(8)).slice(0,300));
 ok(f.call('publishRoleProfileRelease',publish(ns,'finance','english',null,null,{duties:text.slice(0,8),requiredOutputs:text.slice(8),methods})));
 const result=ok(f.call('readRoleTaskContext',read()));assert.equal(result.diagnostics.budget.maxTokens,4000);assert.equal(result.metered.methods.length,4);assert.deepEqual(result.metered.profile.release.fields.duties,text.slice(0,8));assert.ok(result.diagnostics.budget.used<=4000);
});
test('C07 separate U4 revocation refuses binary metadata and exact attachment continuation while role grants remain current',t=>{
 const role=host(),binary=host(),f=fixture(t,{h:role,assets:binary.assets}),bytes=Buffer.from('%PDF-1.7scoped binary');
 const method=ok(f.call('importMethodVersion',{namespace:ns,actionId:'scoped-mixed',title:'Mixed',manifestFormat:'mixed-v1',files:[{kind:'text',path:'guide.txt',text:'text remains readable',mediaType:'text/plain'},{kind:'binary',path:'attachment.pdf',bytes,mediaType:'application/pdf'}]}));
 ok(f.call('adoptMethodVersion',adopt(method)));ok(f.call('publishRoleProfileRelease',publish(ns,'finance','scoped-profile',null,null,fields(method.package))));
 const receipt=ok(f.call('readRoleTaskContext',read())).metered.receipt,input={mode:'file',readSet:[ns],receipt,package:method.package,path:'attachment.pdf'};
 ok(f.call('readRoleTaskContext',input));binary.revoke();
 assert.equal(f.call('readRoleTaskContext',input).error.code,'authority_required');
 assert.equal(f.call('readMethodAttachmentBytes',{version:method.version,path:'attachment.pdf',intent:'history',context:{readSet:[ns],roleId:'finance'}}).error.code,'authority_required');
 assert.equal(ok(f.call('readRoleTaskContext',{...input,path:'guide.txt'})).metered.file.parts[0].text,'text remains readable');
});
test('C01 no-profile is absence; then preserves an empty original selection after first publication',t=>{
 const f=fixture(t),empty=ok(f.call('readRoleTaskContext',read())).metered;assert.equal(empty.profile.applicability,'no-profile');assert.equal(empty.profile.release,null);
 const first=ok(f.call('publishRoleProfileRelease',publish())),historical=ok(f.call('readRoleTaskContext',{mode:'then',readSet:[ns],receipt:empty.receipt})).metered;
 assert.equal(historical.profile.applicability,'newer-release-available');assert.equal(historical.profile.release,null);assert.equal(historical.receipt,empty.receipt);
 const refreshed=ok(f.call('readRoleTaskContext',{mode:'refresh',readSet:[ns],receipt:empty.receipt})).metered;assert.deepEqual(refreshed.profile.release.ref,first.release);assert.equal(refreshed.profile.applicability,'current');
});
