import { runFile } from './asset-support.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync,writeFileSync,readFileSync,renameSync,unlinkSync,linkSync,symlinkSync,readdirSync,chmodSync,openSync,closeSync,existsSync,lstatSync,readlinkSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { STORAGE_BUSY_TIMEOUT_MS } from '../../../core/database.mjs';
import { fixture,ns,input,pdf,ok,bytes,restoreV30 } from '../../../core/testing/asset-fixtures.mjs';
import { host,call,review,phrase,receipt,cli } from './asset-support.mjs';
import { parseConfiguration } from '../cli.mjs';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';

// Independent pathname-based observation, never the fixture's retained handle.
function storeState(path){
  const stat=lstatSync(path,{bigint:true}),bytes=readFileSync(path),db=new DatabaseSync(path,{readOnly:true,timeout:STORAGE_BUSY_TIMEOUT_MS});
  let schema,tables,identity;
  try{
    db.exec('BEGIN');
    identity={applicationId:db.prepare('PRAGMA application_id').get().application_id,userVersion:db.prepare('PRAGMA user_version').get().user_version};
    schema=db.prepare('SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name').all();
    tables=schema.filter(row=>row.type==='table').map(({name})=>({name,rows:db.prepare('SELECT * FROM "'+name.replaceAll('"','""')+'"').all()}));
    db.exec('COMMIT');
  }finally{db.close();}
  const companions=['-journal','-wal','-shm'].map(suffix=>{
    let stat;try{stat=lstatSync(path+suffix);}catch(error){if(error.code==='ENOENT')return {suffix,absent:true};throw error;}
    return {suffix,mode:stat.mode,...(stat.isSymbolicLink()?{link:readlinkSync(path+suffix)}:{bytes:readFileSync(path+suffix)})};
  });
  return {file:{dev:stat.dev,ino:stat.ino,mode:stat.mode,size:stat.size},bytes,identity,schema,tables,companions};
}

const base=f=>['--db',f.path,'--owner',ns.ownerId];
async function approve(f,args,options={}){const terminal=review(f.workspace,args,options),prompt=await terminal.prompt;terminal.answer(phrase(prompt.output));const done=await terminal.done;assert.equal(done.code,0,done.output);return {saved:ok(receipt(done.output)),prompt:prompt.output};}

test('L01/L03 fixed host configuration and five strict read tools; no byte or mutation grants',{timeout:30000},async t=>{
  const f=fixture(t,{methods:true}),saved=ok(f.call('importAssetVersion',input())),d=ok(f.call('createAssetDerivative',{actionId:'d',version:saved.version,expectedVersionRevision:1,kind:'caption',text:'first supplied text',method:{kind:'user-provided'}}));
  ok(f.call('importAssetVersion',input('v2',{asset:saved.asset,expectedAssetRevision:1})));
  assert.equal(parseConfiguration([...base(f),'--assets','local-v1']).assets,'local-v1');assert.throws(()=>parseConfiguration([...base(f),'--assets','bad']));
  const plain=await host(f.workspace,f.path,{assets:false}),selected=await host(f.workspace,f.path),ordinary=(await plain.client.listTools()).tools,tools=(await selected.client.listTools()).tools;
  assert.equal(ordinary.length,5);assert.equal(tools.length,10);assert.deepEqual(tools.filter(v=>ordinary.some(x=>x.name===v.name)),ordinary);
  const requests={list_assets:{},list_asset_versions:{asset:saved.asset},get_asset_version:{version:saved.version},list_asset_derivatives:{version:saved.version},read_asset_derivative:{ref:d.derivative}};
  assert.deepEqual(tools.filter(v=>!ordinary.some(x=>x.name===v.name)).map(v=>v.name).sort(),Object.keys(requests).sort());
  for(const [name,args]of Object.entries(requests)){
    const response=ok(await call(selected.client,name,args));assert.ok(!JSON.stringify(response).includes('base64'));
    for(const key of ['authority','namespace','readSet','context','configuration','bytes','unknown'])assert.equal((await selected.client.callTool({name,arguments:{...args,[key]:{}}})).isError,true,name+' '+key);
    if(name!=='list_assets'){const key=Object.keys(args)[0],foreign={...args,[key]:{...args[key],namespace:{...ns,ownerId:'foreign'}}};assert.equal((await call(selected.client,name,foreign)).error.code,'authority_required');}
  }
  const read=ok(await call(selected.client,'read_asset_derivative',{ref:d.derivative}));assert.equal(read.derivative.historical,true);assert.equal(read.derivative.sourceOrdinal,1);assert.equal(read.derivative.greatestImportedOrdinal,2);
  await plain.client.close();await selected.client.close();
  const scoped=await host(f.workspace,f.path,{project:'project',enabled:true,personal:true});
  assert.equal((await call(scoped.client,'get_asset_version',{version:saved.version})).error.code,'authority_required');
  assert.deepEqual(ok(await call(scoped.client,'list_assets')).assets,[]);await scoped.client.close();
});
test('L02 real PTY import, derivative, CAS delete and export exact bytes',{timeout:30000},async t=>{
  const f=fixture(t),file=join(f.workspace.path,'sample.pdf'),text=join(f.workspace.path,'text.txt');writeFileSync(file,pdf(65537));writeFileSync(text,'\ufeffUser supplied\r\ntext');
  const imported=await approve(f,['import',...base(f),'--file',file,'--title','Untrusted\x1b[31m title']);assert.ok(!imported.prompt.includes('\x1b'));assert.match(imported.prompt,/byteCount/);
  assert.deepEqual(bytes(f,imported.saved.version),readFileSync(file));
  const d=await approve(f,['derive',...base(f),'--version',JSON.stringify(imported.saved.version),'--kind','description','--text-file',text,'--language','en']);
  assert.equal(ok(f.call('readAssetDerivative',{ref:d.saved.derivative})).parts[0].text,'\ufeffUser supplied\r\ntext');
  const out=join(f.workspace.path,'exported.pdf'),r=runFile(f.workspace,['assets','export',...base(f),'--version',JSON.stringify(imported.saved.version),'--out',out]);assert.equal(r.code,0,r.output);assert.deepEqual(readFileSync(out),readFileSync(file));
  await approve(f,['delete',...base(f),'--ref',JSON.stringify(d.saved.derivative),'--expected-revision','1']);
  assert.equal(ok(f.call('readAssetDerivative',{ref:d.saved.derivative})).status,'unavailable');
  const terminal=review(f.workspace,['delete',...base(f),'--ref',JSON.stringify(imported.saved.asset),'--expected-revision','1']),prompt=await terminal.prompt;
  ok(f.call('importAssetVersion',input('advance',{asset:imported.saved.asset,expectedAssetRevision:1})));terminal.answer(phrase(prompt.output));const done=await terminal.done;assert.equal(done.code,1);assert.equal(receipt(done.output).error.code,'revision_conflict');
});
for(const attack of ['wrong','eof','file-replace','hardlink','store-delete','store-replace','schema','schema-definition'])test('L02 post-review '+attack+' refuses with no imported rows',{timeout:30000},async t=>{
  const f=fixture(t),file=join(f.workspace.path,'input.pdf');writeFileSync(file,pdf());
  const terminal=review(f.workspace,['import',...base(f),'--file',file,'--title','review']),prompt=await terminal.prompt;
  if(attack==='file-replace'){renameSync(file,file+'.old');writeFileSync(file,pdf());}
  if(attack==='hardlink')linkSync(file,file+'.link');
  let replacementBefore,originalBefore;const original=f.path+'.original';
  if(attack==='store-delete'){linkSync(f.path,original);unlinkSync(f.path);originalBefore=storeState(original);}
  if(attack==='store-replace'){
    renameSync(f.path,original);restoreV30(f.path);
    // Baselines follow the deliberate attack, before the approved reopen.
    replacementBefore=storeState(f.path);originalBefore=storeState(original);
  }
  if(attack==='schema')f.db.exec('PRAGMA user_version=30');
  if(attack==='schema-definition'){const row=f.db.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND tbl_name='assets' ORDER BY name LIMIT 1").get();assert.ok(row);f.db.exec('DROP TRIGGER '+row.name);}
  if(attack==='eof')terminal.eof();else terminal.answer(attack==='wrong'?'WRONG':phrase(prompt.output));
  const done=await terminal.done;assert.equal(done.code,1,done.output);assert.equal(receipt(done.output).ok,false);
  if(attack==='store-delete'){
    assert.throws(()=>lstatSync(f.path),{code:'ENOENT'},'the deleted pathname must never be recreated, even as a dangling symlink');
    for(const suffix of ['-journal','-wal','-shm'])assert.throws(()=>lstatSync(f.path+suffix),{code:'ENOENT'});
  }
  if(replacementBefore)assert.deepEqual(storeState(f.path),replacementBefore,'replacement bytes, identity, schema, rows and companions stay unchanged');
  if(originalBefore)assert.deepEqual(storeState(original),originalBefore,'independent reads of the retained original stay unchanged');
  assert.equal(f.db.prepare('SELECT count(*) n FROM assets').get().n,0);
});
for(const kind of ['symlink','hardlink','fifo','utf8','signature'])test('L02 descriptor input rejects '+kind+' before mutation',{timeout:30000},async t=>{
  const f=fixture(t),file=join(f.workspace.path,kind==='utf8'?'input.txt':'input.pdf');
  if(kind==='symlink')symlinkSync('/etc/passwd',file);
  else if(kind==='hardlink'){writeFileSync(file+'.outside',pdf());linkSync(file+'.outside',file);}
  else if(kind==='fifo'){const r=spawnSync('/usr/bin/mkfifo',[file],{stdio:'ignore'});assert.equal(r.status,0);}
  else writeFileSync(file,Buffer.from([255,254]));
  let args=['import',...base(f),'--file',file,'--title','rejected'];
  if(kind==='utf8'){const saved=ok(f.call('importAssetVersion',input()));args=['derive',...base(f),'--version',JSON.stringify(saved.version),'--kind','caption','--text-file',file];}
  const done=await review(f.workspace,args).done;assert.equal(done.code,1,done.output);assert.equal(receipt(done.output).ok,false);
});
test('L02 no TTY, yes, pre-v31 refusals and migration approval fence',{timeout:30000},async t=>{
  const w=createTestWorkspace(t,{prefix:'asset-pre-v31-'}),path=join(w.path,'old.sqlite');restoreV30(path);const f={path,workspace:w},file=join(w.path,'a.pdf');writeFileSync(file,pdf());
  const args=['import',...base(f),'--file',file,'--title','upgrade'];
  for(const extra of [[],['--yes']]){const result=runFile(w,['assets',...args,...extra]);assert.equal(result.code,1);assert.equal(JSON.parse(result.output).error.code,'approval_required');}
  const before=readFileSync(path),terminal=review(w,args),prompt=await terminal.prompt;assert.match(prompt.output,/"to": 31/);terminal.answer('WRONG');assert.equal((await terminal.done).code,1);assert.deepEqual(readFileSync(path),before);
  const fake={type:'asset-version',namespace:ns,assetId:'a',versionId:'b',contentIdentity:'x'.repeat(43)};
  for(const tail of [['derive','--version',JSON.stringify(fake),'--kind','caption','--text-file',file],['delete','--ref',JSON.stringify(fake),'--expected-revision','1']]){const done=await review(w,[...tail,...base(f)]).done;assert.equal(done.code,1);assert.equal(receipt(done.output).error.code,'asset_not_found');}
  const ex=runFile(w,['assets','export',...base(f),'--version',JSON.stringify(fake),'--out',join(w.path,'out')]);assert.equal(ex.code,1);assert.equal(JSON.parse(ex.output).error.code,'asset_not_found');assert.deepEqual(readFileSync(path),before);
  await approve(f,args);const db=new DatabaseSync(path,{readOnly:true});try{assert.equal(db.prepare('PRAGMA user_version').get().user_version,31);}finally{db.close();}
});
test('L01/L03 attachments local-v1 preserves flag-off refusal, imports exclusive binary metadata and SVG',{timeout:30000},async t=>{
  const f=fixture(t,{methods:true}),directory=join(f.workspace.path,'package');mkdirSync(directory);writeFileSync(join(directory,'SKILL.md'),'submitted');writeFileSync(join(directory,'image.svg'),'<svg/>');writeFileSync(join(directory,'a.pdf'),pdf(32769));
  const args=['import',...base(f),'--dir',directory,'--title','mixed'];
  const refused=await review(f.workspace,args,{group:'methods'}).done;assert.equal(refused.code,1);assert.equal(receipt(refused.output).error.code,'unsupported_media');
  const imported=await approve(f,[...args,'--attachments','local-v1'],{group:'methods'});assert.match(imported.prompt,/"exclusive": true/);
  const server=await host(f.workspace,f.path,{enabled:true,assets:false}),manifest=ok(await call(server.client,'list_method_manifest',{version:imported.saved.version,intent:'history'}));
  assert.equal(manifest.files.find(v=>v.path==='a.pdf').kind,'binary');assert.equal(manifest.files.find(v=>v.path==='image.svg').mediaType,'text/plain');
  assert.equal((await call(server.client,'read_method_file',{version:imported.saved.version,path:'a.pdf',intent:'history'})).error.code,'unsupported_media');await server.client.close();
});
for(const channel of ['binary','text','timecodes'])for(const mode of ['swap','link','growing','fifo','ancestor'])test(`L02 ${channel} real syscall ${mode} confinement`,{timeout:30000},async t=>{
  const f=fixture(t),parent=join(f.workspace.path,'input'),outside=join(f.workspace.path,'outside');mkdirSync(parent);mkdirSync(outside);writeFileSync(join(outside,'payload'),'OUTSIDE NEVER READ');
  const name=channel==='binary'?'payload.pdf':channel==='text'?'payload.txt':'payload.json',path=join(parent,name);
  writeFileSync(path,channel==='binary'?pdf(100000):channel==='text'?'supplied':'[{"startMs":0,"endMs":5}]');
  let args;
  if(channel==='binary')args=['import',...base(f),'--file',path,'--title','race'];
  else{
    const wav=Buffer.from('RIFF1234WAVEx'),saved=ok(f.call('importAssetVersion',input('wav',{filename:'a.wav',mediaType:'audio/wav',bytes:wav}))),text=join(f.workspace.path,'text.txt');writeFileSync(text,'supplied');
    args=['derive',...base(f),'--version',JSON.stringify(saved.version),'--kind','transcript','--text-file',channel==='text'?path:text,...(channel==='timecodes'?['--timecodes',path]:[])];
  }
  const config={path,parent,outside,name,mode},url=new URL('./fixtures/asset-files-race.mjs',import.meta.url).href;
  const preload='data:text/javascript,'+encodeURIComponent(`globalThis.U4B_FILE_FAULT=${JSON.stringify(config)};await import(${JSON.stringify(url)});`);
  const terminal=review(f.workspace,args,{imports:[preload]});
  if(mode==='ancestor'){
    const prompt=await terminal.prompt;terminal.answer(phrase(prompt.output));const done=await terminal.done;assert.equal(done.code,0,done.output);
    if(channel==='binary')assert.deepEqual(bytes(f,ok(receipt(done.output)).version),pdf(100000));
  }else {const done=await terminal.done;assert.equal(done.code,1,done.output);assert.equal(receipt(done.output).ok,false);}
  assert.equal(f.db.prepare('SELECT count(*) n FROM asset_derivatives').get().n,mode==='ancestor'&&channel!=='binary'?1:0);
});
for(const channel of ['text','timecodes'])test('L02 '+channel+' replacement after review refuses frozen derivative',{timeout:30000},async t=>{
  const f=fixture(t),saved=ok(f.call('importAssetVersion',input('wav',{filename:'a.wav',mediaType:'audio/wav',bytes:Buffer.from('RIFF1234WAVE')}))),text=join(f.workspace.path,'text.txt'),timecodes=join(f.workspace.path,'times.json');writeFileSync(text,'frozen');writeFileSync(timecodes,'[{"startMs":0,"endMs":1}]');
  const terminal=review(f.workspace,['derive',...base(f),'--version',JSON.stringify(saved.version),'--kind','transcript','--text-file',text,'--timecodes',timecodes]),prompt=await terminal.prompt;
  const target=channel==='text'?text:timecodes;renameSync(target,target+'.old');writeFileSync(target,channel==='text'?'replacement':'[]');terminal.answer(phrase(prompt.output));const done=await terminal.done;
  assert.equal(done.code,1,done.output);assert.equal(f.db.prepare('SELECT count(*) n FROM asset_derivatives').get().n,0);
});
for(const operation of ['import','derive'])for(const index of operation==='import'?[1,2]:[1,2,3,4])test(`L02 ${operation} input close ${index} still closes all and reports sanitized failure`,{timeout:30000},async t=>{
  const f=fixture(t),parent=join(f.workspace.path,'input');mkdirSync(parent);
  const file=join(parent,'private.pdf'),text=join(parent,'private.txt'),timecodes=join(parent,'private.json');
  writeFileSync(file,pdf());writeFileSync(text,'Private supplied derivative prose');writeFileSync(timecodes,'[]');
  let args=['import',...base(f),'--file',file,'--title','Private supplied title'],names=['private.pdf'];
  if(operation==='derive'){
    const saved=ok(f.call('importAssetVersion',input('wav',{filename:'a.wav',mediaType:'audio/wav',bytes:Buffer.from('RIFF1234WAVE')})));
    args=['derive',...base(f),'--version',JSON.stringify(saved.version),'--kind','transcript','--text-file',text,'--timecodes',timecodes];names=['private.txt','private.json'];
  }
  const config=join(f.workspace.path,'close-fault.json'),trace=join(f.workspace.path,'close-trace'),audit=join(f.workspace.path,'close-audit.json');
  writeFileSync(config,JSON.stringify({mode:'input',inputParent:parent,names,operation:'close',index,phase:'after',action:'throw',trace,audit}));
  const terminal=review(f.workspace,args,{imports:[new URL('./fixtures/asset-export-fault.mjs',import.meta.url).href],env:{U4B_FAULT_CONFIG:config}}),prompt=await terminal.prompt;
  terminal.answer(phrase(prompt.output));const done=await terminal.done,result=receipt(done.output);assert.equal(done.code,1,done.output);
  assert.deepEqual(result,{ok:false,error:{code:'storage_error',retryable:false}});
  const observed=JSON.parse(readFileSync(audit,'utf8'));
  assert.equal(observed.opened.length,operation==='import'?2:4);assert.deepEqual(observed.closeAttempts,[...observed.opened].reverse());
  assert.equal(readFileSync(trace,'utf8').trim().split('\n').length,1);
});
