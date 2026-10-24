import test from 'node:test';
import assert from 'node:assert/strict';
import fs, { existsSync, readFileSync, writeFileSync, openSync, closeSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { reviewCard } from '../review-card.mjs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseConfiguration, start } from '../cli.mjs';
import { createCairnServer } from '../server.mjs';
import { registerCardCurrentTools, CARD_CURRENT_TOOL_NAMES } from '../card-current-tools.mjs';
import { fixture, ns, ok } from '../../../core/test/card-current-fixture.mjs';
const flags=['--private-cards','local-v1','--method-packages','local-v1','--private-card-current-dependencies','local-v1'];
const cli=new URL('../cli.mjs',import.meta.url).pathname;
test('C26 closed host-fixed configuration and approval-only MCP schemas; check-config opens nothing',async t=>{
 const scripts=JSON.parse(readFileSync(new URL('../../../package.json',import.meta.url))).scripts;assert.equal(Object.hasOwn(scripts,'measure:card-dependencies'),false);assert.ok(scripts['measure:card-current-dependencies']);
 const base=['--db','/synthetic/card-current.sqlite','--owner','owner'];assert.equal(parseConfiguration([...base,...flags]).privateCardCurrentDependencies,'local-v1');
 for(const tail of [flags.slice(4),flags.slice(2),[...flags,'--private-card-current-dependencies','local-v1'],[...flags.slice(0,-1),'bad']])assert.throws(()=>parseConfiguration([...base,...tail]));
 const logs=[];t.mock.method(console,'log',text=>logs.push(JSON.parse(text)));await start(['--check-config',...base,...flags],Object.defineProperty({},'OPENAI_API_KEY',{get(){assert.fail('key read');}}));
 assert.equal(logs[0].privateCardCurrentDependencies,'local-v1');assert.equal(logs[0].databaseOpened,false);assert.equal(existsSync(base[1]),false);
 const tools=new Map();registerCardCurrentTools((name,description,schema,action)=>tools.set(name,{schema,action}));assert.equal(tools.size,2);
 const input={actionId:'review',cardId:'card',expectedRevision:2,expectedDependencyRevision:null,roleId:'finance',packages:[{type:'method-package',namespace:ns,packageId:'package'}]};
 for(const name of CARD_CURRENT_TOOL_NAMES){const {schema,action}=tools.get(name);assert.equal(schema.safeParse(input).success,true);assert.equal(action(input).error.code,'approval_required');for(const field of ['namespace','readSet','authority','humanConfirmed','configuration'])assert.equal(schema.safeParse({...input,[field]:ns}).success,false);}
 assert.throws(()=>createCairnServer({path:base[1],namespace:ns,privateCardCurrentDependencies:'local-v1'}));
});
function command(f,name,args,program=process.execPath){
 const outPath=join(f.dir,name+'.out'),errPath=join(f.dir,name+'.err'),out=openSync(outPath,'wx',0o600),err=openSync(errPath,'wx',0o600);let r;
 try{r=spawnSync(program,args,{stdio:['ignore',out,err],timeout:30000});}finally{closeSync(out);closeSync(err);}
 assert.equal(r.error,undefined);assert.equal(r.signal,null);return {exit:r.status,stdout:readFileSync(outPath,'utf8'),stderr:readFileSync(errPath,'utf8')};
}
test('C26 dependency authoring refuses protocol input and --yes; real independent terminal declares and revalidates without changing text/revisions',t=>{
 const f=fixture(t),ref=f.card({declare:false}),before=ok(f.call('getCard',{namespace:ns,cardId:ref.cardId})).card,packages=join(f.dir,'packages.json');writeFileSync(packages,JSON.stringify([f.v1.package]));
 const args=[cli,'review-card','--db',f.path,'--owner','owner','--card',ref.cardId,'--revision','2','--dependencies',packages,'--role','finance','--dependency-revision','null','--dependency-operation','declare'];
 assert.equal(command(f,'pipe',args).exit,1);assert.equal(command(f,'yes',[...args,'--yes','true']).exit,1);
 const driver=new URL('./fixtures/card-current-pty.py',import.meta.url).pathname;
 const phrase=`CONFIRM ${ref.cardId} 2 DEPENDENCIES null declare`;
 const declared=command(f,'terminal',[driver,phrase,process.execPath,...args],'/usr/bin/python3');assert.equal(declared.exit,0,declared.stderr);const record=JSON.parse(declared.stdout);assert.equal(record.code,0,record.output);assert.equal(record.answered,true);assert.match(record.output,/observations/);assert.match(record.output,/expectedDependencyRevision/);
 f.change();const revalidate=[...args];revalidate[revalidate.indexOf('--dependency-revision')+1]='1';revalidate[revalidate.indexOf('--dependency-operation')+1]='revalidate';
 const checked=command(f,'revalidate',[driver,`CONFIRM ${ref.cardId} 2 DEPENDENCIES 1 revalidate`,process.execPath,...revalidate],'/usr/bin/python3');assert.equal(checked.exit,0,checked.stderr);const done=JSON.parse(checked.stdout);assert.equal(done.code,0,done.output);
 const after=ok(f.call('getCard',{namespace:ns,cardId:ref.cardId})).card;assert.equal(after.support.currentDependency.revision,2);assert.equal(after.support.currentDependency.status,'current');for(const field of ['title','body','revision','bodyRevision'])assert.equal(after[field],before[field]);
 console.log(JSON.stringify({C26:{terminalDeclareExit:record.code,terminalRevalidateExit:done.code}}));
});


test('C12 new binary U3 terminal adoption and disable with dependency authoring off derive the same fence',t=>{
 const f=fixture(t),ref=f.card(),driver=new URL('./fixtures/card-current-pty.py',import.meta.url).pathname;
 for(const [operation,revision]of [['adopt','1'],['disable','2']]){
  const args=[cli,'methods',operation,'--db',f.path,'--owner','owner','--binding-namespace','personal','--package',JSON.stringify(f.v1.package),'--role','*','--expected-revision',revision,...(operation==='adopt'?['--version',JSON.stringify(f.v2.version)]:[])];
  const result=command(f,'u3-'+operation,[driver,'__DISPLAYED__',process.execPath,...args],'/usr/bin/python3');assert.equal(result.exit,0,result.stderr);const done=JSON.parse(result.stdout);assert.equal(done.code,0,done.output);
  const card=ok(f.call('getCard',{namespace:ns,cardId:ref.cardId})).card;assert.equal(card.support.currentDependency.status,'needs-review');if(operation==='disable')assert.ok(card.support.currentDependency.reasons.includes('binding_disabled'));
  console.log(JSON.stringify({C12:{operation,exit:done.code}}));
 }
});


test('review-card bounds dependency-file descriptor reads and rejects oversized and non-regular files',t=>{
 const f=fixture(t),path=join(f.dir,'oversized.json');writeFileSync(path,' '.repeat(1024*1024));
 const args=file=>['--db',f.path,'--owner','owner','--card','synthetic','--revision','2','--dependencies',file,'--dependency-revision','null'];
 const originalRead=fs.readSync,originalOpen=fs.openSync,originalClose=fs.closeSync;
 let selected,requested=0,read=0,closed=0;
 t.mock.method(fs,'openSync',function(file,...rest){const fd=originalOpen.call(this,file,...rest);if(file===path)selected=fd;return fd;});
 t.mock.method(fs,'readSync',function(fd,buffer,offset,length,...rest){if(fd===selected)requested+=length;const n=originalRead.call(this,fd,buffer,offset,length,...rest);if(fd===selected)read+=n;return n;});
 t.mock.method(fs,'closeSync',function(fd){if(fd===selected)closed++;return originalClose.call(this,fd);});
 syncBuiltinESMExports();
 try {
  assert.throws(()=>reviewCard(args(path)),/invalid_review_configuration/);assert.equal(requested,32769);assert.equal(read,32769);assert.equal(closed,1);assert.throws(()=>fs.fstatSync(selected),{code:'EBADF'});
  const fifo=join(f.dir,'dependencies.fifo'),made=spawnSync('mkfifo',[fifo],{stdio:'ignore'});
  const special=made.status===0?fifo:'/dev/zero';assert.equal(fs.lstatSync(special).isFile(),false);
  assert.throws(()=>reviewCard(args(special)),/invalid_review_configuration/);assert.equal(requested,32769);assert.equal(closed,1);
  assert.throws(()=>reviewCard(args(f.dir)),/invalid_review_configuration/);
 } finally {fs.readSync=originalRead;fs.openSync=originalOpen;fs.closeSync=originalClose;syncBuiltinESMExports();}
});
