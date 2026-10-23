import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {spawn,spawnSync} from 'node:child_process';
import {mkdirSync,writeFileSync,readFileSync,existsSync,openSync,closeSync,renameSync,symlinkSync,linkSync,readdirSync,unlinkSync} from 'node:fs';
import {join} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {createTestWorkspace} from '../../tools/testing/workspace.mjs';
import {installedMethods} from './fixtures/method-packages.mjs';
import {openMemoryCore} from '../../core/contract.mjs';
import {host as coreHost,historicalFixtures,restoreHistoricalStore} from '../../core/testing/method-package-fixtures.mjs';
import {installedImportClosure} from './fixtures/installed-import-closure.mjs';
import {host,call,review,phrase,receipt,namespace as ns,ok} from '../../adapters/mcp/test/method-support.mjs';

test('H01–H07 actual installed method CLI, terminal approval, MCP and closure',{timeout:180000},async t=>{
  const workspace=createTestWorkspace(t,{prefix:'installed-method-packages-'}),f=await installedMethods(workspace);
  const db=new DatabaseSync(f.path);workspace.defer(()=>db.close());
  const atomicState=()=>['method_packages','method_versions','method_files','method_changes','method_operations','method_effects','method_binding_events'].map(table=>[table,db.prepare('SELECT count(*) n FROM '+table).get().n]);
  const count=table=>db.prepare('SELECT count(*) n FROM '+table).get().n;
  const project={...ns,scope:'project',projectId:'synthetic-project'};
  let serial=0;
  function directory(files={'SKILL.md':'Synthetic independently submitted method.\n'}){
    const root=join(workspace.path,'package-'+serial++);mkdirSync(root);
    for(const [path,text] of Object.entries(files))writeFileSync(join(root,path),text);
    return root;
  }
  const base=['--db',f.path,'--owner',ns.ownerId];
  const importArgs=(root,extra=[])=>['import',...base,'--dir',root,'--title','Synthetic method',...extra];
  async function approve(args){
    const terminal=review(workspace,args,{command:f.entry}),prompt=await terminal.prompt;
    terminal.answer(phrase(prompt.output));const done=await terminal.done;assert.equal(done.code,0,done.output);
    return {saved:ok(receipt(done.output)),prompt:prompt.output};
  }
  const bindingArgs=(kind,imported,{role='reviewer',revision='null',projectBinding=false,reasons=[]}={})=>[
    kind,...base,...(projectBinding?['--project',project.projectId]:[]),'--binding-namespace',projectBinding?'project':'personal',
    '--package',JSON.stringify(imported.package),'--role',role,'--expected-revision',String(revision),
    ...(kind==='adopt'?['--version',JSON.stringify(imported.version)]:[]),...reasons.flatMap(ref=>['--reason-ref',JSON.stringify(ref)])];
  let first;
  await t.test('H01 installed CLI eagerly loads the method command, file reader and transport even without method flags',()=>{
    const trace=join(workspace.path,'eager-methods.jsonl'),stdout=join(workspace.path,'help.stdout'),stderr=join(workspace.path,'help.stderr');
    const loader='data:text/javascript,'+encodeURIComponent(`import {appendFileSync} from 'node:fs';export async function load(url,context,next){const result=await next(url,context);appendFileSync(${JSON.stringify(trace)},JSON.stringify(url)+'\\n');return result;}`);
    const preload='data:text/javascript,'+encodeURIComponent(`import {register} from 'node:module';register(${JSON.stringify(loader)},import.meta.url);`);
    const out=openSync(stdout,'wx'),err=openSync(stderr,'wx');let result;
    try{result=spawnSync(process.execPath,['--import',preload,f.entry,'--help'],{env:{NODE_NO_WARNINGS:'1'},stdio:['ignore',out,err]});}
    finally{closeSync(out);closeSync(err);}
    assert.equal(result.error,undefined);assert.equal(result.status,0,readFileSync(stderr,'utf8'));
    const loaded=readFileSync(trace,'utf8').trim().split('\n').map(JSON.parse);
    for(const name of ['command','files','transport'])assert.ok(loaded.includes(pathToFileURL(join(f.root,'adapters/mcp/method-package-'+name+'.mjs')).href),name);
  });
  await t.test('H03 missing database refuses without creating a store or parent',async()=>{
    const path=join(workspace.path,'missing-parent','missing.sqlite'),root=directory();
    const terminal=review(workspace,['import','--db',path,'--owner',ns.ownerId,'--dir',root,'--title','Missing'],{command:f.entry}),done=await terminal.done;
    assert.equal(done.code,1,done.output);assert.equal(receipt(done.output).error.code,'method_not_found');
    assert.ok(!existsSync(path));assert.ok(!existsSync(join(workspace.path,'missing-parent')));
  });
  function stored(path){
    const db=new DatabaseSync(path,{readOnly:true});
    try{return {version:db.prepare('PRAGMA user_version').get().user_version,
      schema:db.prepare('SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name').all(),
      tables:db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(({name})=>({name,
        columns:db.prepare('PRAGMA table_info("'+name+'")').all().map(row=>row.name),rows:db.prepare('SELECT * FROM "'+name+'"').all()}))};
    }finally{db.close();}
  }
  for(const version of [18,30])for(const action of ['replace','delete','wal'])await t.test(`H03 v${version} store ${action} during real-PTY review refuses without application or schema writes`,async()=>{
    const path=join(workspace.path,'fenced-'+version+'-'+action+'.sqlite'),retained=path+'.retained';
    restoreHistoricalStore(path,version===30?29:version);
    if(version===30){const trusted=coreHost(),core=openMemoryCore({path,methodPackages:trusted.options});core.close();}
    const original=stored(path),originalBytes=readFileSync(path);
    const terminal=review(workspace,['import','--db',path,'--owner',ns.ownerId,'--dir',directory(),'--title','Fenced import'],{command:f.entry});
    const prompt=await terminal.prompt;
    if(action==='replace'){renameSync(path,retained);restoreHistoricalStore(path,29);}
    else if(action==='delete'){linkSync(path,retained);unlinkSync(path);}
    else{const db=new DatabaseSync(path);try{assert.equal(db.prepare('PRAGMA journal_mode=WAL').get().journal_mode,'wal');}finally{db.close();}}
    const targetBefore=action==='delete'?null:stored(path),targetBytes=action==='delete'?null:readFileSync(path);
    terminal.answer(phrase(prompt.output));const done=await terminal.done;
    assert.equal(done.code,1,done.output);
    assert.equal(receipt(done.output).error.code,action==='delete'?'method_not_found':'unsafe_database_file');
    if(action==='delete')assert.ok(!existsSync(path),'disappeared store must never be recreated');
    else{assert.deepEqual(stored(path),targetBefore);assert.deepEqual(readFileSync(path),targetBytes);}
    if(action!=='wal'){assert.deepEqual(stored(retained),original);assert.deepEqual(readFileSync(retained),originalBytes);}
  });
  for(const {version} of historicalFixtures.layouts)await t.test(`H03 populated historical v${version}: approval gates upgrade; adopt/disable refuse unchanged`,async()=>{
    const path=join(workspace.path,'historical-'+version+'.sqlite');restoreHistoricalStore(path,version);
    const before=stored(path),bytes=readFileSync(path),entries=readdirSync(workspace.path).sort(),root=directory();
    const args=['import','--db',path,'--owner',ns.ownerId,'--dir',root,'--title','Approved upgrade'];
    const terminal=review(workspace,args,{command:f.entry}),prompt=await terminal.prompt;
    assert.match(prompt.output,new RegExp('"storeUpgrade": \{\\s*"from": '+version+',\\s*"to": 30'));
    assert.match(prompt.output,/"reasonAvailabilityCheck": "after-approved-upgrade"/);
    assert.deepEqual(stored(path),before);assert.deepEqual(readFileSync(path),bytes);
    terminal.answer('WRONG PHRASE');const refused=await terminal.done;
    assert.equal(refused.code,1,refused.output);assert.equal(receipt(refused.output).error.code,'approval_required');
    assert.deepEqual(stored(path),before);assert.deepEqual(readFileSync(path),bytes);
    assert.ok(!existsSync(path+'-journal'));assert.ok(!existsSync(path+'-wal'));assert.ok(!existsSync(path+'-shm'));
    assert.deepEqual(readdirSync(workspace.path).filter(name=>name.startsWith('historical-')).sort(),entries.filter(name=>name.startsWith('historical-')));
    for(const kind of ['adopt','disable']){
      const args=bindingArgs(kind,{package:{type:'method-package',namespace:ns,packageId:'missing'},
        version:{type:'method-version',namespace:ns,packageId:'missing',versionId:'missing',manifestIdentity:'a'.repeat(43)}});
      args[2]=path;
      const command=review(workspace,args,{command:f.entry});
      const done=await command.done;assert.equal(done.code,1,done.output);assert.equal(receipt(done.output).error.code,'method_not_found');
      assert.deepEqual(stored(path),before);assert.deepEqual(readFileSync(path),bytes);
    }
    const saved=(await approve(args)).saved,after=stored(path);assert.equal(after.version,30);
    assert.equal(after.tables.find(table=>table.name==='method_versions').rows.length,1);
    const db=new DatabaseSync(path,{readOnly:true});
    try{
      for(const table of before.tables)assert.deepEqual(db.prepare('SELECT '+table.columns.map(name=>'"'+name+'"').join(',')+' FROM "'+table.name+'"').all(),table.rows,table.name);
      assert.equal(db.prepare('SELECT id FROM method_versions').get().id,saved.version.versionId);
      assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
    }finally{db.close();}
  });
  await t.test('H03 upgraded import rechecks unavailable reasons after approval and refuses the mutation',async()=>{
    const path=join(workspace.path,'reason-upgrade.sqlite');restoreHistoricalStore(path,29);
    const change=join(workspace.path,'missing-reason.json');writeFileSync(change,JSON.stringify({items:[],reasonRefs:[{type:'memory',namespace:ns,memoryId:'missing',revision:1}]}));
    const terminal=review(workspace,['import','--db',path,'--owner',ns.ownerId,'--dir',directory(),'--title','Refused reason','--change',change],{command:f.entry});
    const prompt=await terminal.prompt;terminal.answer(phrase(prompt.output));const done=await terminal.done;
    assert.equal(done.code,1,done.output);assert.equal(receipt(done.output).error.code,'method_not_found');
    const after=stored(path);assert.equal(after.version,30);
    for(const name of ['method_packages','method_versions','method_operations','method_effects'])assert.equal(after.tables.find(table=>table.name===name).rows.length,0,name);
  });
  await t.test('H01/H07 default DTOs and tools stay unchanged; opt-in adds nine read tools; all runtime helpers ship',async()=>{
    const plain=await host(workspace,f.path,{command:f.entry,enabled:false}),selected=await host(workspace,f.path,{command:f.entry});
    const ordinary=(await plain.client.listTools()).tools,tools=(await selected.client.listTools()).tools;
    assert.equal(ordinary.length,5);assert.equal(tools.length,14);
    assert.deepEqual(tools.filter(tool=>ordinary.some(item=>item.name===tool.name)),ordinary);
    const names=tools.filter(tool=>!ordinary.some(item=>item.name===tool.name)).map(tool=>tool.name).sort();
    assert.deepEqual(names,['compare_method_versions','get_method_version','list_method_binding_events','list_method_manifest',
      'list_method_packages','list_method_versions','read_method_file','resolve_method','resolve_methods_for_role']);
    assert.ok(tools.filter(tool=>names.includes(tool.name)).every(tool=>tool.annotations.readOnlyHint&&/untrusted data/.test(tool.description)));
    for(const forbidden of ['import_method_version','adopt_method_version','disable_method_binding','check_method_reason_refs','create_private_card_draft','capture_memory','map_evidence'])assert.ok(!tools.some(tool=>tool.name===forbidden));
    const required=['method-package-access','method-package-tools','method-package-transport','method-package-files','method-package-command'].map(name=>'adapters/mcp/'+name+'.mjs');
    const closure=installedImportClosure(f.root,['bin/cairn-memory.mjs']);
    for(const path of required){assert.ok(f.artifact.files.includes(path));assert.ok(closure.required.includes(path));
      assert.equal(createHash('sha256').update(readFileSync(join(f.root,path))).digest('hex'),f.artifact.sourceHashes[path]);}
    assert.ok(closure.required.every(path=>f.artifact.files.includes(path)));
    assert.ok(f.artifact.files.includes('core/store-fence.mjs'));
    assert.ok(closure.required.includes('core/store-fence.mjs'));
    assert.ok(f.artifact.files.includes('docs/method-packages-local.md'));
    assert.match(readFileSync(join(f.root,'docs/method-packages-local.md'),'utf8'),/cairn-memory methods import/);
    await plain.client.close();await selected.client.close();
  });
  await t.test('H02/H03 exact approved import, explicit binary exclusion and 120-file/1.8MB and maximum boundaries',async()=>{
    const root=directory({'SKILL.md':'\ufeffSynthetic\r\n','a.txt':' first\t','image.png':'binary'});
    symlinkSync('/unopened-git',join(root,'.git'));
    const imported=await approve(importArgs(root,['--exclude','*.png']));first=imported.saved;
    assert.match(imported.prompt,/"filtered": true/);assert.match(imported.prompt,/image\.png/);
    const text=ok(f.call('readMethodFile',{version:first.version,intent:'history',path:'SKILL.md'})).parts[0].text;
    assert.equal(text,'\ufeffSynthetic\r\n');
    for(const [label,count,units] of [['representative',120,15000],['maximum',256,400000]]){
      const files=Object.fromEntries(Array.from({length:count},(_,i)=>['file-'+String(i).padStart(3,'0')+'.txt',label==='maximum'?(i<10?'界'.repeat(units):''):'x'.repeat(units)]));
      const saved=(await approve(importArgs(directory(files)))).saved;
      assert.equal(ok(f.call('getMethodVersion',{version:saved.version,intent:'history'})).version.byteCount,label==='maximum'?12_000_000:1_800_000);
      let cursor,total=0;do{const page=ok(f.call('listMethodManifest',{version:saved.version,intent:'history',...(cursor?{cursor}:{})}));total+=page.files.length;cursor=page.nextCursor;}while(cursor);assert.equal(total,count);
    }
  });
  await t.test('H02 invalid trees refuse before opening the core or upgrading an existing store, including FIFO without hanging',async()=>{
    for(const kind of ['symlink','hardlink','fifo','invalid-utf8','binary']){
      const root=directory({}),path=join(root,'SKILL.md'),store=join(workspace.path,'refused-'+kind+'.sqlite');
      if(kind==='symlink')symlinkSync('/etc/passwd',path);
      else if(kind==='hardlink'){const outside=join(workspace.path,'hardlink-source');writeFileSync(outside,'outside');linkSync(outside,path);}
      else if(kind==='fifo'){const child=spawnSync('/usr/bin/mkfifo',[path],{stdio:'ignore'});assert.equal(child.error,undefined);assert.equal(child.status,0);}
      else if(kind==='invalid-utf8')writeFileSync(path,Buffer.from([0xff]));
      else writeFileSync(join(root,'image.png'),'synthetic binary');
      restoreHistoricalStore(store,29);const before=stored(store),bytes=readFileSync(store);
      const terminal=review(workspace,['import','--db',store,'--owner',ns.ownerId,'--dir',root,'--title','Refused'],{command:f.entry});
      const done=await terminal.done;assert.equal(done.code,1,done.output);assert.equal(receipt(done.output).error.code,kind==='binary'?'unsupported_media':'invalid_input');
      assert.deepEqual(stored(store),before,kind+' must refuse before any core open/upgrade');assert.deepEqual(readFileSync(store),bytes);
    }
  });
  await t.test('H02 installed reader races and real same-filesystem bind mount use pinned descriptors',async sub=>{
    const fixture=fileURLToPath(new URL('../../adapters/mcp/test/fixtures/method-files-race.mjs',import.meta.url));
    for(const mode of ['socket','fifo-replacement','path-swap','link-change','growing','ancestor-swap','mount']){
      const root=directory({}),outside=directory({'SKILL.md':'OUTSIDE MUST NEVER BE READ'});
      if(mode==='ancestor-swap'){mkdirSync(join(root,'nested'));writeFileSync(join(root,'nested','SKILL.md'),'pinned original');}
      else writeFileSync(join(root,'SKILL.md'),'pinned original');
      if(mode==='mount')mkdirSync(join(root,'nested'));
      const resultPath=join(workspace.path,'race-'+mode+'.result'),configPath=join(workspace.path,'race-'+mode+'.json');
      writeFileSync(configPath,JSON.stringify({root,outside,mode,module:pathToFileURL(join(f.root,'adapters/mcp/method-package-files.mjs')).href,result:resultPath}));
      const outPath=join(workspace.path,'race-'+mode+'.stdout'),errPath=join(workspace.path,'race-'+mode+'.stderr'),out=openSync(outPath,'wx'),err=openSync(errPath,'wx');
      const env={...process.env};delete env.NODE_TEST_CONTEXT;let result;
      const args=mode==='mount'?['-Urm','--','/bin/sh','-c','mount --bind "$1" "$2" || exit 77; "$3" "$4" "$5"; result=$?; umount "$2"; exit "$result"',
        'installed-method-mount',outside,root+'/nested',process.execPath,fixture,configPath]:[fixture,configPath];
      try{result=spawnSync(mode==='mount'?'/usr/bin/unshare':process.execPath,args,{env,timeout:15000,stdio:['ignore',out,err]});}finally{closeSync(out);closeSync(err);}
      assert.equal(result.error,undefined,String(result.error));assert.equal(result.signal,null,readFileSync(errPath,'utf8'));
      if(mode==='mount'&&result.status!==0){await sub.test('UNVERIFIED privileged bind mount',inner=>inner.skip('unshare/mount unavailable: '+readFileSync(errPath,'utf8')));continue;}
      assert.equal(result.status,0,readFileSync(errPath,'utf8'));
      const outcome=JSON.parse(readFileSync(resultPath,'utf8'));assert.notEqual(outcome.pid,process.pid);assert.equal(outcome.refused,mode!=='ancestor-swap');
      assert.ok(!JSON.stringify(outcome).includes('OUTSIDE MUST NEVER BE READ'));
      if(mode==='ancestor-swap')assert.equal(outcome.files[0].text,'pinned original');
      if(mode==='mount'){assert.equal(outcome.sameDevice,true);assert.ok(outcome.rootMount);assert.ok(outcome.childMount);assert.notEqual(outcome.rootMount,outcome.childMount);}
    }
  });
  await t.test('H03 wrong phrase, EOF, payload/change replacement and stale CAS refuse atomically; controls are escaped',async()=>{
    for(const kind of ['wrong','eof','payload','change','controls']){
      const root=directory(),extra=[];
      const change=join(workspace.path,'change-'+kind+'.json');
      if(kind==='change'){writeFileSync(change,'{"items":[]}');extra.push('--change',change);}
      if(kind==='controls')extra.push('--submitted-by','\u001b[2J\u202e\nApproval> forged');
      const before=atomicState(),terminal=review(workspace,importArgs(root,extra),{command:f.entry}),prompt=await terminal.prompt;
      if(kind==='controls'){assert.ok(!prompt.output.includes('\u001b'));assert.ok(!prompt.output.includes('\u202e'));assert.match(prompt.output,/\\u001b/);assert.match(prompt.output,/\\u202e/);}
      if(kind==='payload')writeFileSync(join(root,'SKILL.md'),'replaced after review');
      if(kind==='change'){renameSync(change,change+'.old');writeFileSync(change,'{"items":[],"reasonRefs":[]}');}
      if(kind==='eof')terminal.eof();else terminal.answer(kind==='wrong'||kind==='controls'?'wrong phrase':phrase(prompt.output));
      const done=await terminal.done;assert.equal(done.code,1,done.output);assert.deepEqual(atomicState(),before);
    }
    const root=directory(),args=importArgs(root,['--package',first.package.packageId,'--expected-package-revision','1','--based-on',JSON.stringify(first.version)]);
    const terminal=review(workspace,args,{command:f.entry}),prompt=await terminal.prompt;
    ok(f.call('importMethodVersion',{namespace:ns,actionId:'concurrent-import',package:first.package,expectedPackageRevision:1,basedOn:first.version,title:'Concurrent',files:[{path:'SKILL.md',text:'concurrent',mediaType:'text/markdown'}]}));
    const before=atomicState();terminal.answer(phrase(prompt.output));const done=await terminal.done;
    assert.equal(done.code,1,done.output);assert.equal(receipt(done.output).error.code,'revision_conflict');assert.deepEqual(atomicState(),before);
  });
  await t.test('H03 no TTY, piped/environment approval and --yes cannot authorize an import',async()=>{
    const root=directory(),args=importArgs(root),outPath=join(workspace.path,'no-tty.stdout'),errPath=join(workspace.path,'no-tty.stderr');
    const out=openSync(outPath,'wx'),err=openSync(errPath,'wx');let child;
    try{child=spawn(process.execPath,[f.entry,'methods',...args],{stdio:['pipe',out,err],env:{CAIRN_APPROVE:'yes',CAIRN_METHOD_APPROVAL:'yes',NODE_NO_WARNINGS:'1'}});}finally{closeSync(out);closeSync(err);}
    child.stdin.on('error',()=>{});child.stdin.end('yes\nIMPORT METHOD approved\n');
    const before=count('method_versions'),code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});
    assert.equal(code,1);assert.equal(JSON.parse(readFileSync(outPath,'utf8')).error.code,'approval_required');assert.equal(count('method_versions'),before);
    const terminal=review(workspace,[...args,'--yes'],{command:f.entry}),done=await terminal.done;
    assert.equal(done.code,1);assert.equal(receipt(done.output).error.code,'approval_required');
  });
  await t.test('H04 approved default, cross-scope override and disable barrier; concurrent adoption has one CAS winner',async()=>{
    await approve(bindingArgs('adopt',first,{role:'*'}));
    const versions=ok(f.call('listMethodVersions',{package:first.package})).versions;
    const second={package:first.package,version:versions[1].ref};
    const adopted=await approve(bindingArgs('adopt',second,{projectBinding:true}));assert.match(adopted.prompt,/"crossScope": true/);
    const ctx={readSet:[ns,project],roleId:'reviewer'};
    assert.deepEqual(ok(f.call('resolveMethod',{package:first.package,...ctx})).version,second.version);
    await approve(bindingArgs('disable',second,{revision:1,projectBinding:true}));
    assert.equal(ok(f.call('resolveMethod',{package:first.package,...ctx})).status,'disabled');
    const operationsBefore=count('method_operations'),eventsBefore=count('method_binding_events'),effectsBefore=count('method_effects');
    const args=bindingArgs('adopt',first,{role:'race'}),a=review(workspace,args,{command:f.entry}),b=review(workspace,args,{command:f.entry});
    const prompts=await Promise.all([a.prompt,b.prompt]);a.answer(phrase(prompts[0].output));b.answer(phrase(prompts[1].output));
    const outcomes=await Promise.all([a.done,b.done]);assert.deepEqual(outcomes.map(outcome=>outcome.code).sort(),[0,1]);
    assert.equal(count('method_operations'),operationsBefore+1);assert.equal(count('method_binding_events'),eventsBefore+1);assert.equal(count('method_effects'),effectsBefore+1);
    assert.equal(receipt(outcomes.find(outcome=>outcome.code===1).output).error.code,'revision_conflict');
    assert.equal(db.prepare("SELECT count(*) n FROM method_bindings WHERE role_key='race'").get().n,1);
    const foreign={type:'memory',namespace:{...ns,ownerId:'foreign'},memoryId:'missing',revision:1};
    const denied=review(workspace,bindingArgs('adopt',first,{role:'denied',reasons:[foreign]}),{command:f.entry}),done=await denied.done;
    assert.equal(done.code,1);assert.equal(receipt(done.output).error.code,'authority_required');
  });
  await t.test('H05/H06 fresh MCP sessions preserve pins, scope fences, disable barriers, deletion and transport bounds',async()=>{
    const root=directory({'SKILL.md':'v1.\n'.repeat(2000)}),v1=(await approve(importArgs(root))).saved;
    await approve(bindingArgs('adopt',v1));
    let server=await host(workspace,f.path,{command:f.entry}),client=server.client;
    const listed=ok(await call(client,'resolve_methods_for_role',{roleId:'reviewer'})),selected=listed.methods.find(method=>method.package.packageId===v1.package.packageId);
    assert.deepEqual(selected.version,v1.version);
    const request={version:v1.version,path:'SKILL.md',intent:'current',roleId:'reviewer',snapshot:listed.snapshot};
    const historicalPage=ok(await call(client,'read_method_file',{...request,intent:'history'}));
    const read=ok(await call(client,'read_method_file',request));assert.equal(read.parts[0].text,'v1.\n'.repeat(1000));assert.equal(read.adoptionStatus,'current');assert.ok(read.nextCursor);
    for(const field of ['namespace','readSet','context','authority','unknown']){
      const bad=await client.callTool({name:'read_method_file',arguments:{...request,[field]:{approved:true}}});assert.equal(bad.isError,true,field);
    }
    const invalidIntent=await client.callTool({name:'get_method_version',arguments:{version:v1.version,intent:'current'}});assert.equal(invalidIntent.isError,true);
    const v2=ok(f.call('importMethodVersion',{namespace:ns,actionId:'pin-v2',package:v1.package,expectedPackageRevision:1,basedOn:v1.version,title:'Second',files:[{path:'SKILL.md',text:'v2 current',mediaType:'text/markdown'}]}));
    await approve(bindingArgs('adopt',v2,{revision:1}));
    assert.equal((await call(client,'read_method_file',request)).error.code,'cursor_stale');
    assert.equal((await call(client,'read_method_file',{...request,intent:'history',cursor:historicalPage.nextCursor})).error.code,'cursor_stale');
    const history=ok(await call(client,'read_method_file',{...request,intent:'history'}));assert.equal(history.adoptionStatus,'newer-version-available');assert.equal(history.parts[0].text,read.parts[0].text);
    await client.close();server=await host(workspace,f.path,{command:f.entry});client=server.client;
    assert.equal(ok(await call(client,'read_method_file',{...request,intent:'history'})).adoptionStatus,'newer-version-available');
    await approve(bindingArgs('adopt',v2,{projectBinding:true}));
    const cross=await host(workspace,f.path,{command:f.entry,project:project.projectId,personal:true});
    const winner=ok(await call(cross.client,'resolve_method',{package:v2.package,roleId:'reviewer'}));assert.equal(winner.status,'current');
    await cross.client.close();
    const revoked=await host(workspace,f.path,{command:f.entry,project:project.projectId});
    const unavailable=ok(await call(revoked.client,'resolve_methods_for_role',{roleId:'reviewer'})).methods.find(method=>method.package.packageId===v2.package.packageId);
    assert.equal(unavailable.status,'unavailable');
    assert.equal((await call(revoked.client,'read_method_file',{version:v2.version,path:'SKILL.md',intent:'history'})).error.code,'authority_required');
    await approve(bindingArgs('disable',v2,{revision:2}));
    assert.equal(ok(await call(client,'resolve_method',{package:v2.package,roleId:'reviewer'})).status,'disabled');
    assert.equal((await call(client,'read_method_file',{version:v2.version,path:'SKILL.md',intent:'current',roleId:'reviewer'})).error.code,'method_version_unavailable');
    ok(f.call('deleteMethodVersion',{actionId:'delete-pin',ref:v1.version,expectedRevision:1}));
    const removed=ok(await call(client,'read_method_file',{...request,intent:'history'}));assert.equal(removed.status,'unavailable');assert.equal(removed.adoptionStatus,'unavailable');assert.ok(!JSON.stringify(removed).includes('v1.'));
    ok(f.call('deleteMethodVersion',{actionId:'delete-current',ref:v2.version,expectedRevision:1}));
    const afterDelete=await host(workspace,f.path,{command:f.entry,project:project.projectId,personal:true});
    assert.equal(ok(await call(afterDelete.client,'resolve_method',{package:v2.package,roleId:'reviewer'})).status,'unavailable');
    const targetGone=review(workspace,bindingArgs('adopt',v2,{role:'gone'}),{command:f.entry}),done=await targetGone.done;
    assert.equal(done.code,1);assert.equal(receipt(done.output).error.code,'method_version_unavailable');
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
    await client.close();await revoked.client.close();await afterDelete.client.close();
  });
});
