import { createHash } from 'node:crypto';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, openSync, closeSync, readdirSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';
import { installedMethods, fileCommand } from './fixtures/method-packages.mjs';
import { installedImportClosure } from './fixtures/installed-import-closure.mjs';
import { host, cardOptions, ns, ok, importMethod, adopt } from '../../core/test/card-current-fixture.mjs';

const root=fileURLToPath(new URL('../../',import.meta.url));
const walk=(dir,prefix='')=>readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(join(dir,e.name),prefix+e.name+'/'):[prefix+e.name]).sort();
function child(workspace,name,source,args=[]){
 const output=join(workspace.path,name+'.out'),error=join(workspace.path,name+'.err'),out=openSync(output,'wx',0o600),err=openSync(error,'wx',0o600);let result;
 try{result=spawnSync(process.execPath,['--input-type=module','-e',source,...args],{stdio:['ignore',out,err],timeout:30000});}finally{closeSync(out);closeSync(err);}
 assert.equal(result.error,undefined);assert.equal(result.signal,null);assert.equal(result.status,0,readFileSync(error,'utf8'));console.log(JSON.stringify({child:name,exit:result.status}));return readFileSync(output,'utf8');
}
test('C12/C26 actual installed closure and frozen old refusal; no-declaration bytes across feature-off method mutations',async t=>{
 const w=createTestWorkspace(t,{prefix:'installed-card-current-'}),installed=await installedMethods(w),h=host();
 const {openMemoryCore}=await import(pathToFileURL(join(installed.root,'core/contract.mjs')));
 const entries=['core/index.mjs','core/contract.mjs','adapters/mcp/cli.mjs','adapters/local/cli.mjs','integrations/client/raw/local-host-cli.mjs'];
 const source=installedImportClosure(root,entries),actual=installedImportClosure(installed.root,entries),manifest=JSON.parse(readFileSync(join(root,'packaging/artifact-files.json')));
 assert.deepEqual(source.required,actual.required);assert.deepEqual(source.required.filter(p=>!manifest.includes(p)),[]);
 const added=manifest.filter(p=>/^core\/card-current-.*\.mjs$|^adapters\/mcp\/card-current-.*\.mjs$/.test(p));assert.equal(added.length,6);assert.ok(added.every(p=>source.eager.includes(p)));
 const derived=[...new Set([...source.required,...manifest,'bin/cairn-memory.mjs','README.md','THIRD_PARTY_NOTICES.md','licenses/tiktoken-LICENSE','package.json','npm-shrinkwrap.json'])].sort();
 const archive=fileCommand(w,'tar',['-tzf',installed.artifact.artifactPath],w.path,installed.artifact.userconfig).trim().split('\n').map(p=>p.replace(/^package\//,'')).sort();assert.deepEqual(derived,archive);assert.deepEqual(walk(installed.root),derived);
 console.log(JSON.stringify({C26:{sourceClosure:source.required.length,installedClosure:actual.required.length,manifest:manifest.length,newRuntime:added.length,derived:derived.length,archive:archive.length,filesystem:walk(installed.root).length,diff:0,packExit:0,installExit:0}}));
 const frozen=JSON.parse(readFileSync(join(root,'packaging/test/fixtures/role-profile-pre-v32.json')));assert.equal(createHash('sha256').update(readFileSync(join(root,'packaging/test/fixtures/role-profile-pre-v32.tgz'))).digest('hex'),frozen.sha256);
 const oldDir=join(w.path,'frozen');mkdirSync(oldDir);fileCommand(w,'tar',['-xzf',join(root,'packaging/test/fixtures/role-profile-pre-v32.tgz'),'-C',oldDir],w.path,installed.artifact.userconfig);
 assert.deepEqual(walk(join(oldDir,'package')),frozen.files);
 const old=pathToFileURL(join(oldDir,'package/core/contract.mjs')).href;
 const upgraded=join(w.path,'v33.sqlite');openMemoryCore({path:upgraded,privateCards:cardOptions(h.authority),methodPackages:h.methods}).close();const bytes=readFileSync(upgraded);
 child(w,'frozen-refusal',`import assert from 'node:assert/strict';const {openMemoryCore}=await import(${JSON.stringify(old)});assert.throws(()=>openMemoryCore({path:process.argv[1]}),e=>e.code==='unsupported_database');`,[upgraded]);assert.deepEqual(readFileSync(upgraded),bytes);
 const path=join(w.path,'control.sqlite'),c=openMemoryCore({path,privateCards:cardOptions(h.authority,false),methodPackages:h.methods});w.defer(()=>c.close());
 const call=(m,input)=>ok(c[m](input,{}));const v1=call('importMethodVersion',importMethod());call('adoptMethodVersion',adopt(v1));
 const draft=call('createCardDraft',{namespace:ns,actionId:'draft',drafting:'authored',input:{authoredInput:{text:'Source',occurredAt:null},title:'Finance',body:'Finance fact'}});
 const card=call('confirmCardDraft',{namespace:ns,cardId:draft.id,expectedRevision:1,actionId:'confirm',applicability:'current'}),ref={type:'card',namespace:ns,cardId:card.id,revision:card.revision,bodyRevision:card.bodyRevision};
 for(let i=0;i<2;i++){const d=call('createCardDraft',{namespace:ns,actionId:'extra-'+i,drafting:'authored',input:{authoredInput:{text:'Source '+i,occurredAt:null},title:'Finance '+i,body:'Finance fact '+i}});call('confirmCardDraft',{namespace:ns,cardId:d.id,expectedRevision:1,actionId:'extra-confirm-'+i,applicability:'current'});}
 const contextual=openMemoryCore({path,privateCards:cardOptions(h.authority,false),methodPackages:h.methods,contextRead:h.context});w.defer(()=>contextual.close());
 const candidateInput={readSet:[ns],query:'Finance',types:['card'],intent:'current',limit:1,deadlineMs:5000};
 const initial=ok(await contextual.findCandidates(candidateInput,{}));assert.ok(initial.nextCursor);
 const continued=JSON.stringify(ok(await contextual.findCandidates({...candidateInput,cursor:initial.nextCursor},{})));
 const fetched=ok(contextual.fetchCandidateEvidence({readSet:[ns],refs:[ref],intent:'current'},{})),fetchedBytes=JSON.stringify(fetched);
 const assembled=JSON.stringify(ok(await contextual.contextRead({readSet:[ns],query:'Finance',types:['card'],intent:'current',deadlineMs:5000},{})).metered);
 const probe=(modulePath)=>`const {openMemoryCore}=await import(${JSON.stringify(modulePath)});const ns=${JSON.stringify(ns)},ref=${JSON.stringify(ref)};const authority={authorize({input,...r}){return {...r,accessGeneration:1};},isCurrent(g){return g;}};const c=openMemoryCore({path:process.argv[1],privateCards:${JSON.stringify(cardOptions(null,false)).replace('"authority":null','"authority":authority')}});const results=[c.getPrivateCardCapabilities(),...['getCard','listCards','fetchEvidence','selectEvidence'].map((m,i)=>c[m]([{namespace:ns,cardId:ref.cardId},{namespace:ns,states:['confirmed']},{namespace:ns,refs:[ref],intent:'current'},{namespace:ns,query:'Finance',types:['card'],intent:'current'}][i],{}))];console.log(JSON.stringify(results));c.close();`;
 const current=pathToFileURL(join(installed.root,'core/contract.mjs')).href;
 const baseline=child(w,'frozen-control',probe(old),[path]);assert.equal(child(w,'current-control',probe(current),[path]),baseline);
 const v2=call('importMethodVersion',{...importMethod('v2','Version two'),package:v1.package,expectedPackageRevision:1,basedOn:v1.version});
 for(const [index,mutate]of [()=>{},()=>call('adoptMethodVersion',adopt(v2,'adopt-v2',null,ns,1,[ns])),()=>call('disableMethodBinding',{bindingNamespace:ns,package:v1.package,roleId:null,readSet:[ns],expectedRevision:2,actionId:'disable'}),()=>call('deleteMethodVersion',{ref:v1.version,expectedRevision:1,actionId:'delete'})].entries()){
  mutate();assert.equal(JSON.stringify(ok(await contextual.findCandidates({...candidateInput,cursor:initial.nextCursor},{}))),continued);assert.equal(JSON.stringify(ok(contextual.fetchCandidateEvidence({readSet:[ns],snapshot:fetched.snapshot},{}))),fetchedBytes);assert.equal(JSON.stringify(ok(await contextual.contextRead({readSet:[ns],query:'Finance',types:['card'],intent:'current',deadlineMs:5000},{})).metered),assembled);assert.equal(child(w,'control-'+index,probe(current),[path]),baseline);assert.equal(child(w,'frozen-'+index,probe(old),[path]),baseline);
 }
});
