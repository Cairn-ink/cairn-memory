import { sourceFixture, savedSource, anchor, resolve as resolveRaw, ns as rawNamespace } from '../testing/raw-source-fixtures.mjs';
import { openMemoryCore } from '../contract.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { fixture,ns,project,ok,error,file,input,history,collect } from '../testing/method-package-fixtures.mjs';

test('M03 immutable requested-version reads, manifest identity mismatch and UTF16 code-point parts',t=>{
  const f=fixture(t),text='a'.repeat(3999)+'😀'+'界'.repeat(5000),first=ok(f.call('importMethodVersion',input('first',{files:[file('one',text),file('two','x'.repeat(5000))]})));
  const second=ok(f.call('importMethodVersion',input('second',{package:first.package,expectedPackageRevision:1,basedOn:first.version,files:[file('one','Synthetic replacement.')]})));
  const parts=collect(f,'readMethodFile',{...history(first.version),path:'one'},'parts');
  assert.equal(parts.map(p=>p.text).join(''),text);assert.equal(parts[0].end,3999);
  let next=0;for(const part of parts){assert.equal(part.start,next);assert.ok(part.end-part.start<=4000);assert.ok(part.text.isWellFormed());next=part.end;}
  assert.equal(collect(f,'readMethodFile',{...history(second.version),path:'one'},'parts')[0].text,'Synthetic replacement.');
  const mismatched={...first.version,manifestIdentity:'a'.repeat(43)};
  for(const method of ['getMethodVersion','listMethodManifest','readMethodFile'])error(f.call(method,{...history(mismatched),...(method==='readMethodFile'?{path:'one'}:{})}),'method_version_unavailable');
  const page=ok(f.call('readMethodFile',{...history(first.version),path:'one'}));assert.ok(page.nextCursor);
  error(f.call('readMethodFile',{...history(second.version),path:'one',cursor:page.nextCursor}),'invalid_cursor');
  error(f.call('readMethodFile',{...history(first.version),path:'two',cursor:page.nextCursor}),'invalid_cursor');
  error(f.call('listMethodManifest',{...history(first.version),cursor:page.nextCursor}),'invalid_cursor');
  error(f.call('readMethodFile',{...history(first.version),path:'one',cursor:page.nextCursor+'tamper'}),'invalid_cursor');
  error(f.call('readMethodFile',{...history(first.version),path:'missing'}),'method_not_found');
  assert.equal(ok(f.call('getMethodVersion',history(first.version))).version.adoptionStatus,'unassessed');
});

test('M03 every read verifies persisted manifest/content and context/snapshot/current are deferred',t=>{
  const f=fixture(t),first=ok(f.call('importMethodVersion',input()));
  for(const method of ['getMethodVersion','listMethodManifest','readMethodFile']){
    const base={...history(first.version),...(method==='readMethodFile'?{path:'SKILL.md'}:{})};
    for(const patch of [{intent:'current'},{intent:undefined},{context:{readSet:[ns],roleId:null}},{context:null},{snapshot:'opaque'},{snapshot:null}]){
      const candidate={...base,...patch};if(candidate.intent===undefined)delete candidate.intent;
      error(f.call(method,candidate),'invalid_input');
    }
  }
  error(f.call('listMethodVersions',{package:first.package,context:{readSet:[ns],roleId:'test'}}),'invalid_input');
  f.db.prepare('UPDATE method_files SET text=? WHERE version_id=?').run('Corrupted synthetic content.',first.version.versionId);
  for(const method of ['getMethodVersion','listMethodManifest','readMethodFile'])error(f.call(method,{...history(first.version),...(method==='readMethodFile'?{path:'SKILL.md'}:{})}),'method_version_unavailable');
});

test('M03/M10 manifest/history/package pages and cursors bind store, namespace, stream, limits and access generation',t=>{
  const f=fixture(t),first=ok(f.call('importMethodVersion',input('first',{files:Array.from({length:64},(_,i)=>file('界'.repeat(500)+i,'x'))})));
  assert.equal(collect(f,'listMethodManifest',history(first.version),'files').length,64);
  let latest=first;for(let i=2;i<=23;i++)latest=ok(f.call('importMethodVersion',input('v'+i,{package:first.package,expectedPackageRevision:i-1,basedOn:first.version})));
  assert.equal(collect(f,'listMethodVersions',{package:first.package},'versions').length,23);
  for(let i=0;i<22;i++)ok(f.call('importMethodVersion',input('p'+i)));
  assert.equal(collect(f,'listMethodPackages',{namespace:ns},'packages').length,23);
  const list=ok(f.call('listMethodVersions',{package:first.package,limit:1}));assert.equal(list.versions.length,1);assert.ok(list.nextCursor);
  error(f.call('listMethodVersions',{package:first.package,limit:2,cursor:list.nextCursor}),'invalid_cursor');
  error(f.call('listMethodVersions',{package:{...first.package,namespace:project},limit:1,cursor:list.nextCursor}),'invalid_cursor');
  const other=fixture(t);error(other.call('listMethodVersions',{package:first.package,limit:1,cursor:list.nextCursor}),'invalid_cursor');
  f.trusted.state.generation++;error(f.call('listMethodVersions',{package:first.package,limit:1,cursor:list.nextCursor}),'invalid_cursor');f.trusted.state.generation--;
  const page=ok(f.call('listMethodManifest',history(first.version)));
  ok(f.call('importMethodVersion',input('mutate')));
  error(f.call('listMethodManifest',{...history(first.version),cursor:page.nextCursor}),'cursor_stale');
  for(const limit of [0,21,1.5,NaN,-1])error(f.call('listMethodVersions',{package:first.package,limit}),'invalid_input');
});

test('M07 exact stored edges keep authored items; non-adjacent and reversed edges have no inferred reasons',t=>{
  const f=fixture(t,{cards:true});
  const note=ok(f.call('submitSourceNote',{namespace:ns,actionId:'note',text:'Synthetic independent reason.',occurredAt:null})).source;
  const memory=ok(f.core.admit({namespace:ns,memory:{content:'Synthetic independent Memory reason.',kind:'fact'},receipts:[{
    client:'manual',sessionId:'synthetic',eventId:'one',role:'user',excerpt:'Synthetic independent receipt.'}]})).memory;
  const memoryRef={type:'memory',namespace:ns,memoryId:memory.id,revision:memory.revision};
  const first=ok(f.call('importMethodVersion',input('first',{files:[file('same','stable'),file('removed','old'),file('changed','old')]})));
  const change={items:[{summary:'Synthetic authored change.',paths:['removed','added','changed']}],reasonRefs:[note,memoryRef]};
  const second=ok(f.call('importMethodVersion',input('second',{package:first.package,expectedPackageRevision:1,basedOn:first.version,
    files:[file('same','stable'),file('added','new'),file('changed','new')],change})));
  const third=ok(f.call('importMethodVersion',input('third',{package:first.package,expectedPackageRevision:2,basedOn:second.version,
    files:[file('same','stable')],change:{items:[{summary:'Synthetic no cited reason.',paths:['added']}],reasonRefs:[]}})));
  let comparison=ok(f.call('compareMethodVersions',{from:first.version,to:second.version}));
  assert.deepEqual(Object.fromEntries(comparison.changes.map(p=>[p.path,p.status])),{added:'added',changed:'changed',removed:'removed',same:'unchanged'});
  assert.equal(comparison.reason,'available');assert.deepEqual(comparison.items,change.items);assert.ok(comparison.reasonRefs.every(r=>r.status==='available'));
  for(const pair of [[first.version,third.version],[second.version,first.version]]){
    const result=ok(f.call('compareMethodVersions',{from:pair[0],to:pair[1]}));assert.equal(result.reason,'not-recorded');assert.deepEqual(result.items,[]);assert.deepEqual(result.reasonRefs,[]);
  }
  const noReasons=ok(f.call('compareMethodVersions',{from:second.version,to:third.version}));assert.equal(noReasons.reason,'not-recorded');assert.equal(noReasons.items.length,1);
  ok(f.call('deleteSourceNote',{namespace:ns,sourceId:note.sourceId,expectedRevision:1,actionId:'delete-note'}));
  comparison=ok(f.call('compareMethodVersions',{from:first.version,to:second.version}));assert.equal(comparison.reason,'available');assert.equal(comparison.reasonRefs[0].status,'unavailable');
  ok(f.core.forget({namespace:ns,memoryId:memory.id,expectedRevision:memory.revision}));
  comparison=ok(f.call('compareMethodVersions',{from:first.version,to:second.version}));assert.equal(comparison.reason,'recorded-unavailable');assert.ok(comparison.reasonRefs.every(r=>r.status==='unavailable'));
  assert.equal(comparison.items[0].summary,change.items[0].summary);
});

test('M07/M09 reason refs require a separate read grant and exact-namespace canonical revisions',t=>{
  const f=fixture(t,{cards:true});
  const source=ok(f.call('submitSourceNote',{namespace:ns,actionId:'note',text:'Synthetic reason.',occurredAt:null})).source;
  const candidate=input('reason',{change:{items:[],reasonRefs:[source]}});
  f.trusted.state.denyReasonReads=true;error(f.call('importMethodVersion',candidate),'authority_required');
  f.trusted.state.denyReasonReads=false;
  error(f.call('importMethodVersion',{...candidate,change:{items:[],reasonRefs:[{...source,namespace:project}]}}),'method_not_found');
  error(f.call('importMethodVersion',{...candidate,change:{items:[],reasonRefs:[{...source,revision:2}]}}),'method_not_found');
  error(f.call('importMethodVersion',{...candidate,change:{items:[],reasonRefs:[{...source,contentIdentity:'a'.repeat(43)}]}}),'method_not_found');
  error(f.call('importMethodVersion',{...candidate,change:{items:[],reasonRefs:[{type:'method-version',namespace:ns}]}}),'invalid_input');
  const receipt=ok(f.call('importMethodVersion',candidate));assert.ok(receipt.version);
  assert.ok(f.trusted.state.requests.some(r=>r.method==='importMethodVersion'&&r.actionClass==='read'));
  assert.equal(f.db.prepare('SELECT count(*) n FROM method_operations').get().n,1);
});

test('M03/M07/M10 comparison metadata pages obey envelope bytes and oversized indivisible change item refuses',t=>{
  const f=fixture(t),files=Array.from({length:64},(_,i)=>file('界'.repeat(500)+i,'old'));
  const first=ok(f.call('importMethodVersion',input('first',{files}))),paths=files.map(file=>file.path);
  const second=ok(f.call('importMethodVersion',input('second',{package:first.package,expectedPackageRevision:1,basedOn:first.version,
    files:files.map(file=>({...file,text:'new'})),change:{items:[{summary:'Synthetic oversized path attribution.',paths}],reasonRefs:[]}})));
  let cursor,seen=0,oversized=false;
  do{
    const response=f.call('compareMethodVersions',{from:first.version,to:second.version,...(cursor?{cursor}:{})});
    if(!response.ok){error(response,'context_item_too_large');oversized=true;break;}
    assert.ok(Buffer.byteLength(JSON.stringify(response))<=65536);seen+=response.value.changes.length;cursor=response.value.nextCursor;
  }while(cursor);
  assert.equal(seen,64);assert.equal(oversized,true);
});

test('M07 canonical Card and receipt reasons recheck revisions and eligibility on delivery',t=>{
  const f=fixture(t,{cards:true});
  const admitted=ok(f.core.admit({namespace:ns,memory:{content:'Synthetic retained receipt reason.',kind:'fact'},receipts:[{
    client:'manual',sessionId:'receipt-reason',eventId:'one',role:'user',excerpt:'Synthetic explicit receipt reason.'}]})).memory;
  const draft=ok(f.call('createCardDraft',{namespace:ns,actionId:'card',drafting:'authored',input:{title:'Synthetic reason Card',body:'Synthetic independently authored reason Card.',
    memoryRefs:[{type:'memory',namespace:ns,memoryId:admitted.id,revision:admitted.revision}],sourcePolicy:'retained-receipts-v1'}}));
  const confirmed=ok(f.call('confirmCardDraft',{namespace:ns,cardId:draft.id,expectedRevision:1,actionId:'confirm',applicability:'current'}));
  const card=ok(f.call('getCard',{namespace:ns,cardId:draft.id})).card;
  const cardRef={type:'card',namespace:ns,cardId:card.id,revision:confirmed.revision,bodyRevision:card.bodyRevision},receipt=card.bindings[0].source;
  const first=ok(f.call('importMethodVersion',input('first')));
  const second=ok(f.call('importMethodVersion',input('second',{package:first.package,expectedPackageRevision:1,basedOn:first.version,
    change:{items:[],reasonRefs:[cardRef,receipt]}})));
  assert.ok(ok(f.call('compareMethodVersions',{from:first.version,to:second.version})).reasonRefs.every(ref=>ref.status==='available'));
  ok(f.core.forget({namespace:ns,memoryId:admitted.id,expectedRevision:admitted.revision}));
  const result=ok(f.call('compareMethodVersions',{from:first.version,to:second.version}));assert.equal(result.reason,'recorded-unavailable');assert.ok(result.reasonRefs.every(ref=>ref.status==='unavailable'));
});

test('M07 import resolves reasons inside the transaction after the final authority callback',t=>{
  const f=fixture(t,{cards:true}),note=ok(f.call('submitSourceNote',{namespace:ns,actionId:'note',text:'Synthetic fenced reason.',occurredAt:null})).source;
  f.trusted.state.checks=0;f.trusted.state.hook=count=>{
    if(count===4)ok(f.call('deleteSourceNote',{namespace:ns,sourceId:note.sourceId,expectedRevision:1,actionId:'delete-at-fence'}));
  };
  error(f.call('importMethodVersion',input('stale-reason',{change:{items:[],reasonRefs:[note]}})),'method_not_found');
  f.trusted.state.hook=null;
  assert.equal(f.db.prepare('SELECT count(*) n FROM method_packages').get().n,0);
});

test('M07 Raw reason availability rechecks canonical exclusions after a public Memory forget',async t=>{
  const f=sourceFixture(t),source=await savedSource(f,'Synthetic retained Raw reason.',{client:'claude-code'}),refs=await resolveRaw(f,[anchor(source)]);
  const core=openMemoryCore({path:f.path,methodPackages:{version:'method-packages-local-v1',storage:'local-plain-v1',authority:f.host.options.authority}});
  f.workspace.defer(()=>core.close());const call=(method,payload)=>f.host.call(core,method,payload);
  const first=ok(call('importMethodVersion',input('raw-first',{namespace:rawNamespace})));
  const second=ok(call('importMethodVersion',input('raw-second',{namespace:rawNamespace,package:first.package,expectedPackageRevision:1,basedOn:first.version,
    change:{items:[],reasonRefs:refs}})));
  assert.equal(ok(call('compareMethodVersions',{from:first.version,to:second.version})).reason,'available');
  const memory=ok(f.core.admit({namespace:rawNamespace,memory:{content:'Synthetic explicit Raw interpretation.',kind:'fact'},receipts:[{
    client:'claude-code',sessionId:'synthetic-session',eventId:'message',role:'user',excerpt:source.text}]})).memory;
  ok(f.core.forget({namespace:rawNamespace,memoryId:memory.id,expectedRevision:memory.revision}));
  assert.ok(f.db.prepare('SELECT count(*) n FROM raw_source_exclusions').get().n>0);
  const compared=ok(call('compareMethodVersions',{from:first.version,to:second.version}));assert.equal(compared.reason,'recorded-unavailable');assert.equal(compared.reasonRefs[0].status,'unavailable');
});
