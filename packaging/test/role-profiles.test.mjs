import test, {before,after} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,readdirSync,openSync,closeSync,writeFileSync,mkdirSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {createTestWorkspace} from '../../tools/testing/workspace.mjs';
import {installedMethods,fileCommand} from './fixtures/method-packages.mjs';
import {installedImportClosure} from './fixtures/installed-import-closure.mjs';
import {roleHost,roleCall} from './fixtures/role-profile-host.mjs';
import {roleLegacyProbe} from '../../adapters/mcp/test/fixtures/role-profile-legacy-probe.mjs';
import {removeReviewedRoleHelpAdditions} from '../../adapters/mcp/test/fixtures/role-profile-help-compat.mjs';

const root=fileURLToPath(new URL('../../',import.meta.url)),ns={ownerId:'owner',scope:'personal',projectId:null},project={...ns,scope:'project',projectId:'project'};
const ok=r=>{assert.equal(r.ok,true,JSON.stringify(r));return r.value;};
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const baseFixture=JSON.parse(readFileSync(new URL('./fixtures/role-profile-pre-v32.json',import.meta.url)));
const walk=(dir,prefix='')=>readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(join(dir,e.name),prefix+e.name+'/'):[prefix+e.name]).sort();
let workspace,installed,writer,coreModule,token,authority;
before(async()=>{
  workspace=createTestWorkspace(null,{prefix:'installed-role-'});installed=await installedMethods(workspace);
  coreModule=await import(pathToFileURL(join(installed.root,'core/contract.mjs')));
  token={};const grants=new WeakMap();authority={authorize(request,supplied){if(supplied!==token)return null;const grant={}, {input,...binding}=request;grants.set(grant,{...binding,accessGeneration:1});return grant;},isCurrent(grant){return grants.get(grant)??null;}};
  writer=coreModule.openMemoryCore({path:installed.path,methodPackages:{version:'method-packages-local-v1',storage:'local-plain-v1',authority},
    assets:{version:'assets-local-v1',storage:'sqlite-blob-v1',authority}});workspace.defer(()=>writer.close());
});
after(async()=>{await workspace?.cleanup();});
const mutate=(method,input)=>ok(writer[method](input,token));
const publish=(roleKey,fields,head=null,revision=null,actionId='publish-'+roleKey)=>({roleKey,fields,expectedCurrentRelease:head,expectedRegistryRevision:revision,actionId});
const fields=pkg=>({duties:['Review canonical records'],requiredOutputs:['Report sourced decisions'],methods:pkg?[pkg]:[],related:[],appliesTo:'Synthetic workflow'});
const adopt=(v,actionId,expectedRevision=null,roleId=null,bindingNamespace=ns,readSet=[ns])=>({actionId,bindingNamespace,package:v.package,version:v.version,readSet,roleId,expectedRevision});
const importText=(actionId,text='Original guidance')=>({namespace:ns,actionId,title:'Synthetic method',files:[{path:'guide.txt',text,mediaType:'text/plain'}]});
async function tool(client,name,args){return ok((await roleCall(client,name,args)).envelope);}
const read=(client,input)=>tool(client,'read_role_task_context',input);
function child(name,source,args=[]){
  const outPath=join(workspace.path,name+'.out'),errPath=join(workspace.path,name+'.err'),out=openSync(outPath,'wx',0o600),err=openSync(errPath,'wx',0o600);let result;
  try{result=spawnSync(process.execPath,['--input-type=module','-e',source,...args],{timeout:20000,stdio:['ignore',out,err],env:{NODE_NO_WARNINGS:'1',NODE_DISABLE_COMPILE_CACHE:'1'}});}finally{closeSync(out);closeSync(err);}
  assert.equal(result.error,undefined);assert.equal(result.signal,null,readFileSync(errPath,'utf8'));assert.equal(result.status,0,readFileSync(errPath,'utf8'));
  return readFileSync(outPath,'utf8');
}

test('C06 actual tgz source/import closure, independent tar enumeration, installed filesystem and manifest hashes',()=>{
  const entries=['core/index.mjs','core/contract.mjs','adapters/mcp/cli.mjs','adapters/local/cli.mjs','integrations/client/raw/local-host-cli.mjs'];
  const source=installedImportClosure(root,entries),actual=installedImportClosure(installed.root,entries),manifest=JSON.parse(readFileSync(join(root,'packaging/artifact-files.json')));
  assert.deepEqual(actual.required,source.required);assert.deepEqual(source.required.filter(p=>!manifest.includes(p)),[]);
  const added=manifest.filter(p=>/^core\/(?:role-(?:profile|context)-.*|task-receipt)\.mjs$|^adapters\/mcp\/role-profile-.*\.mjs$/.test(p));
  assert.equal(added.filter(p=>p.startsWith('core/')).length,9);assert.equal(added.filter(p=>p.startsWith('adapters/')).length,4);
  for(const p of added){assert.ok(source.eager.includes(p),p);assert.ok(installed.artifact.files.includes(p));}
  assert.equal(manifest.filter(p=>p==='docs/role-profiles-local.md').length,1);
  // Derive archive closure from runtime imports plus the explicit shipped assets,
  // package metadata and transformed packaging files; enumerate tar independently.
  const derived=[...new Set([...source.required,...manifest,'bin/cairn-memory.mjs','README.md','THIRD_PARTY_NOTICES.md','licenses/tiktoken-LICENSE','package.json','npm-shrinkwrap.json'])].sort();
  const archive=fileCommand(workspace,'tar',['-tzf',installed.artifact.artifactPath],workspace.path,installed.artifact.userconfig).trim().split('\n').map(p=>p.replace(/^package\//,'')).sort();
  assert.deepEqual(archive,derived);assert.deepEqual(walk(installed.root),derived);
  assert.deepEqual(JSON.parse(readFileSync(join(installed.root,'package.json'))).files.sort(),derived);
  for(const p of manifest)assert.equal(sha(readFileSync(join(installed.root,p))),sha(readFileSync(join(root,p))),p);
  console.log(JSON.stringify({C06:{sourceClosure:source.required.length,installedClosure:actual.required.length,manifest:manifest.length,derived:derived.length,archive:archive.length,installedFilesystem:walk(installed.root).length,newCore:9,newMcp:4,diff:0,packExit:0,installExit:0}}));
});

test('C05 frozen 0416ef3c pre-v32 installed closure refuses v32',async()=>{
  const tgz=fileURLToPath(new URL('./fixtures/role-profile-pre-v32.tgz',import.meta.url));
  assert.equal(baseFixture.base,'0416ef3c');assert.equal(sha(readFileSync(tgz)),baseFixture.sha256);
  const dir=join(workspace.path,'old-binary');mkdirSync(dir);writeFileSync(join(dir,'package.json'),'{"name":"synthetic-old","version":"0.0.0","private":true}');
  fileCommand(workspace,'npm',['install','--prefix',dir,'--offline','--ignore-scripts','--no-audit','--no-fund',tgz],dir,installed.artifact.userconfig);
  const old=join(dir,'node_modules','cairn-memory-local-preview'),files=walk(old);
  assert.deepEqual(files,baseFixture.files);for(const [p,hash]of Object.entries(baseFixture.sourceHashes))assert.equal(sha(readFileSync(join(old,p))),hash,p);
  const rolePath=join(workspace.path,'upgraded.sqlite');
  const c=coreModule.openMemoryCore({path:rolePath,roleProfiles:{version:'role-profiles-local-v1',storage:'local-plain-v1',authority,attribution:{actorId:'a',agentId:'b'}}});
  const input={...publish('finance',fields()),namespace:ns};ok(c.publishRoleProfileRelease(input,token));c.close();
  const bytes=readFileSync(rolePath);
  child('old-refusal',`import assert from 'node:assert/strict';const {openMemoryCore}=await import(${JSON.stringify(pathToFileURL(join(old,'core/contract.mjs')).href)});
    assert.throws(()=>openMemoryCore({path:process.argv[1]}),e=>e.code==='unsupported_database');console.log('old installed opener refused v32');`,[rolePath]);
  let oldTransportExit;
  await assert.rejects(()=>roleHost(workspace,join(old,'bin/cairn-memory.mjs'),rolePath,{enabled:false,onExit:r=>oldTransportExit=r.code}),/cairn_mcp_transport_error/);
  assert.equal(oldTransportExit,0); // Frozen serveStdio reports factory refusal through transport closure.
  assert.deepEqual(readFileSync(rolePath),bytes);
  console.log(JSON.stringify({C05:{oldInstalledFiles:files.length,oldOpenerExit:0,oldTransportExit,oldHandshakeRefused:true}}));
});

test('C05 pinned 4aa9327b installed flag-off bytes remain identical; feature-off v32 writers retain guards and fences',async()=>{
  const expected=JSON.parse(readFileSync(new URL('../../adapters/mcp/test/fixtures/role-profile-pre-u5c1.json',import.meta.url)));
  assert.equal(expected.base,'4aa9327b');assert.equal(expected.archive.base,expected.base);
  const tgz=fileURLToPath(new URL('./fixtures/role-profile-flag-off.tgz',import.meta.url));
  assert.equal(sha(readFileSync(tgz)),expected.archive.sha256);
  const dir=join(workspace.path,'flag-off-binary');mkdirSync(dir);writeFileSync(join(dir,'package.json'),'{"name":"synthetic-flag-off","version":"0.0.0","private":true}');
  fileCommand(workspace,'npm',['install','--prefix',dir,'--offline','--ignore-scripts','--no-audit','--no-fund',tgz],dir,installed.artifact.userconfig);
  const baseline=join(dir,'node_modules','cairn-memory-local-preview'),files=walk(baseline);
  assert.deepEqual(files,expected.archive.files);
  for(const [p,hash]of Object.entries(expected.archive.sourceHashes))assert.equal(sha(readFileSync(join(baseline,p))),hash,p);
  // Reproduce the unmodified pin first. Only current help may omit the exact
  // reviewed additions; every other current value still matches the pin.
  const legacy=join(workspace.path,'flag-off-probe');mkdirSync(legacy);
  assert.deepEqual(await roleLegacyProbe(baseline,legacy),expected.value);
  const current=join(workspace.path,'current-probe');mkdirSync(current);
  const actual=await roleLegacyProbe(installed.root,current);
  actual.cli.stdout[0]=removeReviewedRoleHelpAdditions(actual.cli.stdout[0]);
  assert.deepEqual(actual,expected.value);
  const rolePath=join(workspace.path,'feature-off.sqlite');
  const c=coreModule.openMemoryCore({path:rolePath,roleProfiles:{version:'role-profiles-local-v1',storage:'local-plain-v1',authority,attribution:{actorId:'a',agentId:'b'}}});
  const head=ok(c.publishRoleProfileRelease({...publish('finance',fields()),namespace:ns},token));c.close();
  const off=coreModule.openMemoryCore({path:rolePath});assert.equal(off.publishRoleProfileRelease,undefined);
  const admitted=ok(off.admit({namespace:ns,memory:{content:'Synthetic canonical record',kind:'fact'},receipts:[{client:'s',sessionId:'s',eventId:'e',role:'user',excerpt:'Synthetic canonical record'}]}));
  const relatedClient=await roleHost(workspace,installed.entry,rolePath);
  await tool(relatedClient,'publish_role_profile_release',publish('related',{...fields(),related:[{type:'memory',namespace:ns,memoryId:admitted.memory.id,revision:1}]}));
  const relatedReceipt=(await read(relatedClient,{mode:'now',roleKey:'related'})).receipt;
  ok(off.correct({namespace:ns,memoryId:admitted.memory.id,expectedRevision:1,content:'Corrected record',kind:'fact',receipt:{client:'s',sessionId:'s',eventId:'f',role:'user',excerpt:'Corrected record'}}));off.close();
  assert.equal((await read(relatedClient,{mode:'then',receipt:relatedReceipt})).profile.release.fields,null);
  assert.equal((await read(relatedClient,{mode:'now',roleKey:'related'})).profile.release.fields,null);
  await relatedClient.close();
  const db=new DatabaseSync(rolePath);try{assert.throws(()=>db.prepare('DELETE FROM role_profile_releases').run());assert.throws(()=>db.prepare("UPDATE role_profiles SET revision=0").run());assert.equal(db.prepare("SELECT current_release_id FROM role_profiles WHERE role_key='finance'").get().current_release_id,head.release.releaseId);}finally{db.close();}
  console.log(JSON.stringify({C05:{flagOffBase:expected.base,baselineInstalledFiles:files.length,baselineModes:5,flagOffDiff:0}}));
});

test('C01/C02/C03/C07 installed MCP three-role workflow, two-client CAS, restart and second-process exact-version continuation',{timeout:90000},async()=>{
  const binaryBytes=Buffer.from('%PDF-1.7 synthetic original attachment'),text='x'.repeat(3999)+'😀\noriginal tail';
  const coo=mutate('importMethodVersion',importText('coo-method')),cto=mutate('importMethodVersion',importText('cto-method'));
  const finance=mutate('importMethodVersion',{namespace:ns,actionId:'finance-method',title:'Finance',manifestFormat:'mixed-v1',files:[{kind:'text',path:'guide.txt',text,mediaType:'text/plain'},{kind:'binary',path:'attachment.pdf',bytes:binaryBytes,mediaType:'application/pdf'}]});
  for(const [role,v]of [['coo',coo],['cto',cto],['finance',finance]])mutate('adoptMethodVersion',adopt(v,'adopt-'+role));
  let a=await roleHost(workspace,installed.entry,installed.path,{assets:true}),b=await roleHost(workspace,installed.entry,installed.path,{assets:true});
  const heads={};for(const [role,v]of [['coo',coo],['cto',cto],['finance',finance]])heads[role]=await tool(a,'publish_role_profile_release',publish(role,fields(v.package)));
  const before={};for(const role of ['coo','cto','finance'])before[role]=await read(a,{mode:'now',roleKey:role});
  const barrier=await tool(a,'disable_role_profile',{roleKey:'empty-barrier',actionId:'empty-disable',expectedCurrentRelease:null,expectedRegistryRevision:null});
  assert.equal(barrier.registry.revision,1);assert.equal(barrier.registry.currentRelease,null);
  assert.equal((await read(a,{mode:'now',roleKey:'empty-barrier'})).profile.applicability,'withdrawn');
  assert.equal((await roleCall(b,'publish_role_profile_release',publish('empty-barrier',fields()))).envelope.error.code,'revision_conflict');
  await tool(a,'publish_role_profile_release',publish('empty-barrier',fields(),null,barrier.registry.revision,'after-barrier'));
  const manifestInput={version:finance.version,intent:'history',roleId:'finance'};
  const originalManifest=(await tool(a,'list_method_manifest',manifestInput)).files;
  const manifestHash=sha(Buffer.from(JSON.stringify(originalManifest)));
  const receipt=before.finance.receipt;assert.deepEqual(before.finance.profile.release.fields,fields(finance.package));
  assert.equal(before.finance.profile.release.actorId,'cairn-local-mcp');assert.equal(before.finance.profile.release.agentId,'cairn-local-mcp');
  const v2=mutate('importMethodVersion',{namespace:ns,actionId:'finance-v2',title:'Finance v2',package:finance.package,basedOn:finance.version,expectedPackageRevision:1,manifestFormat:'mixed-v1',files:[{kind:'text',path:'guide.txt',text:'replacement guidance',mediaType:'text/plain'},{kind:'binary',path:'attachment.pdf',bytes:Buffer.from('%PDF-1.7 replacement'),mediaType:'application/pdf'}],change:{items:[{summary:'Synthetic finance revision',paths:['guide.txt']}]}});
  assert.deepEqual((await read(a,{mode:'now',roleKey:'finance'})).methods[0].version,finance.version);
  const thenBefore=await read(a,{mode:'then',receipt});assert.equal(thenBefore.methods[0].adoptionStatus,'current');
  // Switch adoption in an actual second process between then and file calls.
  child('adoption-switch',`const {openMemoryCore}=await import(${JSON.stringify(pathToFileURL(join(installed.root,'core/contract.mjs')).href)});
    const authority={authorize(r){const {input,...g}=r;return {...g,accessGeneration:1};},isCurrent(g){return g;}};
    const core=openMemoryCore({path:process.argv[1],methodPackages:{version:'method-packages-local-v1',storage:'local-plain-v1',authority}});
    const r=core.adoptMethodVersion(JSON.parse(process.argv[2]),{});if(!r.ok)throw Error(JSON.stringify(r));core.close();console.log('adopted');`,[installed.path,JSON.stringify(adopt(v2,'finance-switch',1))]);
  const then=await read(a,{mode:'then',receipt});assert.equal(then.receipt,receipt);assert.deepEqual(then.methods[0].version,finance.version);assert.equal(then.methods[0].adoptionStatus,'newer-version-available');
  const fileInput={mode:'file',receipt,package:finance.package,path:'guide.txt'};
  let page=(await read(a,fileInput)).file,assembled=page.parts.map(p=>p.text).join('');assert.equal(assembled.length,3999);
  while(page.nextRange){page=(await read(a,{...fileInput,range:page.nextRange})).file;assembled+=page.parts.map(p=>p.text).join('');}
  assert.equal(assembled,text);assert.equal(sha(Buffer.from(assembled)),sha(Buffer.from(text)));
  const metadata=(await read(a,{...fileInput,path:'attachment.pdf'})).file;assert.equal(metadata.kind,'binary');assert.deepEqual(metadata.version,finance.version);assert.deepEqual(metadata.parts,[]);
  assert.equal(metadata.contentIdentity,originalManifest.find(f=>f.path==='attachment.pdf').contentIdentity);
  assert.equal(page.contentIdentity,originalManifest.find(f=>f.path==='guide.txt').contentIdentity);
  assert.equal(sha(Buffer.from(JSON.stringify((await tool(a,'list_method_manifest',manifestInput)).files))),manifestHash);
  const attachment=mutate('readMethodAttachmentBytes',{version:metadata.version,path:metadata.path,intent:'history',context:{readSet:[ns],roleId:'finance'}});
  assert.deepEqual(Buffer.from(attachment.bytes,'base64'),binaryBytes);assert.equal(sha(Buffer.from(attachment.bytes,'base64')),sha(binaryBytes));
  const contest=await Promise.all([roleCall(a,'publish_role_profile_release',publish('finance',fields(finance.package),heads.finance.release,1,'cas-a')),
    roleCall(b,'publish_role_profile_release',publish('finance',fields(finance.package),heads.finance.release,1,'cas-b'))]);
  assert.equal(contest.filter(r=>r.envelope.ok).length,1);assert.equal(contest.find(r=>!r.envelope.ok).envelope.error.code,'revision_conflict');
  const winning=ok(contest.find(r=>r.envelope.ok).envelope);
  const updated=await read(a,{mode:'then',receipt});assert.equal(updated.profile.applicability,'newer-release-available');
  const comparison=await read(a,{mode:'compare',roleKey:'finance',from:heads.finance.release,to:winning.release});assert.equal(comparison.comparison.reason.status,'not-recorded');
  const methodComparison=await read(a,{mode:'compare',roleKey:'finance',from:finance.version,to:v2.version});assert.equal(methodComparison.comparison.items[0].summary,'Synthetic finance revision');
  await a.close();await b.close();a=await roleHost(workspace,installed.entry,installed.path,{assets:true});
  const now=await read(a,{mode:'now',roleKey:'finance'});assert.deepEqual(now.methods[0].version,v2.version);assert.deepEqual(now.profile.release.ref,winning.release);
  for(const role of ['coo','cto']){const unchanged=await read(a,{mode:'now',roleKey:role});assert.deepEqual(unchanged.profile.release,before[role].profile.release);assert.deepEqual(unchanged.methods,before[role].methods);}
  const refreshed=await read(a,{mode:'refresh',receipt});assert.notEqual(refreshed.receipt,receipt);assert.deepEqual(refreshed.methods,now.methods);
  // Project override keeps finance v1 while personal default uses v2.
  mutate('adoptMethodVersion',adopt(finance,'project-finance',null,'finance',project,[ns,project]));
  const p=await roleHost(workspace,installed.entry,installed.path,{project:'project',personal:true});
  const projectRead=await read(p,{mode:'now',roleKey:'finance'});assert.deepEqual(projectRead.methods[0].version,finance.version);
  await p.close();
  // A project-only host must retain an inaccessible package identity without scope expansion.
  mutate('adoptMethodVersion',adopt(v2,'project-only-binding',null,'project-only',project,[ns,project]));
  const restricted=await roleHost(workspace,installed.entry,installed.path,{project:'project'});
  await tool(restricted,'publish_role_profile_release',publish('project-only',fields(finance.package)));
  const unavailable=await read(restricted,{mode:'now',roleKey:'project-only'});
  assert.equal(unavailable.methods[0].status,'unavailable');assert.deepEqual(unavailable.methods[0].package,finance.package);assert.equal(unavailable.methods[0].manifest,null);
  assert.deepEqual(JSON.parse(unavailable.receipt).p.readSet,[project]);
  assert.equal((await read(restricted,{mode:'file',receipt:unavailable.receipt,package:finance.package,path:'guide.txt'})).file,null);
  await restricted.close();
  const h=await read(a,{mode:'now',roleKey:'finance',history:{profile:winning.release.profile}});assert.equal(h.history.rows.length,2);
  const disabled=await tool(a,'disable_role_profile',{roleKey:'finance',actionId:'withdraw',expectedCurrentRelease:winning.release,expectedRegistryRevision:2});
  assert.equal((await read(a,{mode:'then',receipt})).profile.applicability,'withdrawn');
  assert.equal((await read(a,fileInput)).file.parts[0].text,text.slice(0,3999));
  mutate('disableMethodBinding',(({version,...input})=>input)(adopt(v2,'withdraw-method',2)));
  assert.equal((await read(a,{mode:'then',receipt})).methods[0].adoptionStatus,'withdrawn');
  await a.close();a=await roleHost(workspace,installed.entry,installed.path,{assets:true});
  assert.equal(sha(Buffer.from(JSON.stringify((await tool(a,'list_method_manifest',manifestInput)).files))),manifestHash);
  const afterRestart=(await read(a,{...fileInput,path:'attachment.pdf'})).file;
  assert.deepEqual(afterRestart.version,finance.version);
  assert.equal(sha(Buffer.from(mutate('readMethodAttachmentBytes',{version:afterRestart.version,path:afterRestart.path,intent:'history',context:{readSet:[ns],roleId:'finance'}}).bytes,'base64')),sha(binaryBytes));
  assert.equal((await read(a,fileInput)).file.parts[0].text,text.slice(0,3999));

  const restored=await tool(a,'publish_role_profile_release',publish('finance',fields(finance.package),disabled.registry.currentRelease,disabled.registry.revision,'restore'));
  assert.deepEqual((await read(a,{mode:'now',roleKey:'finance'})).profile.release.fields,fields(finance.package));
  const foreign=await roleHost(workspace,installed.entry,installed.path,{owner:'foreign'});
  assert.equal((await roleCall(foreign,'read_role_task_context',{mode:'then',receipt})).envelope.error.code,'scope_changed');await foreign.close();
  // Independent recount includes the complete escaped receipt and all framing.
  const response=(await roleCall(a,'read_role_task_context',{mode:'now',roleKey:'finance'})).response,parsed=JSON.parse(response.content[0].text);
  const sorted=v=>Array.isArray(v)?v.map(sorted):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort((a,b)=>Buffer.compare(Buffer.from(a),Buffer.from(b))).map(k=>[k,sorted(v[k])])):v;
  const expected=JSON.stringify(sorted(parsed));assert.equal(expected,response.content[0].text);
  const {createContextCounter}=await import(pathToFileURL(join(installed.root,'adapters/openai/context-counter.mjs'))),counter=await createContextCounter();
  assert.equal(response._meta['ink.cairn/context-read-diagnostics'].budget.used,counter.countTokens(expected));assert.equal(parsed.value.receipt.length>0,true);
  const diag=response._meta['ink.cairn/context-read-diagnostics'];
  const independentCore=Buffer.byteLength(JSON.stringify(sorted({ok:true,value:{metered:parsed.value,diagnostics:diag}})));
  const independentTransport=JSON.stringify({content:[{type:'text',text:expected}],isError:false,_meta:{'ink.cairn/context-read-diagnostics':diag}});
  assert.equal(Buffer.byteLength(independentTransport),Buffer.byteLength(JSON.stringify(response)));assert.ok(independentCore<=65536);assert.ok(Buffer.byteLength(independentTransport)<=262144);

  assert.equal(response.content.length,1);assert.deepEqual(Object.keys(response._meta),['ink.cairn/context-read-diagnostics']);assert.equal(expected.includes('diagnostics'),false);
  // Delete exact original target: all continuations cease delivering bytes.
  mutate('deleteMethodVersion',{actionId:'delete-finance-v1',ref:finance.version,expectedRevision:1});
  assert.equal((await read(a,fileInput)).file,null);assert.equal((await read(a,{...fileInput,path:'attachment.pdf'})).file,null);
  assert.equal(mutate('readMethodAttachmentBytes',{version:finance.version,path:'attachment.pdf',intent:'history',context:{readSet:[ns],roleId:'finance'}}).status,'unavailable');
  await tool(a,'delete_role_profile_release',{roleKey:'finance',actionId:'delete-release',release:heads.finance.release,expectedRevision:1,expectedCurrentRelease:restored.release,expectedRegistryRevision:restored.registry.revision});
  const deleted=await read(a,{mode:'then',receipt});assert.equal(deleted.profile.release.fields,null);
  await a.close();
  console.log(JSON.stringify({installedMcp:{C01:true,C02:true,C03:true,C07:true,adoptionChildExit:0,manifestSha256:manifestHash,exactTextSha256:sha(Buffer.from(assembled)),exactBinarySha256:sha(binaryBytes),receiptBytes:Buffer.byteLength(receipt),counterUsed:response._meta['ink.cairn/context-read-diagnostics'].budget.used,coreBytes:independentCore,transportBytes:Buffer.byteLength(independentTransport)}}));
});
