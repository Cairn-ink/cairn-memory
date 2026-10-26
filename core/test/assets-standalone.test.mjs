import test from 'node:test';
import assert from 'node:assert/strict';
import { openMemoryCore } from '../contract.mjs';
import { ASSET_LIMITS,ASSET_METHODS } from '../asset-input.mjs';
import { fixture,ns,project,input,pdf,ok,error,bytes,collect,child,childHost,moduleURL } from '../testing/asset-fixtures.mjs';
const mp4=(major='isom',compatible=['mp42'])=>{const b=Buffer.alloc(16+4*compatible.length);b.writeUInt32BE(b.length);b.write('ftyp',4);b.write(major,8);compatible.forEach((brand,i)=>b.write(brand,16+4*i));return b;};
const media=[['png','image/png',Buffer.from('89504e470d0a1a0a','hex')],['jpg','image/jpeg',Buffer.from('ffd8ff','hex')],
  ['jpeg','image/jpeg',Buffer.from('ffd8ff00','hex')],['gif','image/gif',Buffer.from('GIF87a')],['gif','image/gif',Buffer.from('GIF89a')],
  ['webp','image/webp',Buffer.from('RIFF0000WEBP')],['wav','audio/wav',Buffer.from('RIFF0000WAVE')],['pdf','application/pdf',pdf()],
  ['mp3','audio/mpeg',Buffer.from([73,68,51,2])],['mp3','audio/mpeg',Buffer.from([73,68,51,3])],['mp3','audio/mpeg',Buffer.from([73,68,51,4])],
  ['mp3','audio/mpeg',Buffer.from('fffb9000','hex')],['mp4','video/mp4',mp4()],['ttf','font/ttf',Buffer.from('00010000','hex')],
  ['otf','font/otf',Buffer.from('OTTO')],['woff','font/woff',Buffer.from('wOFF')],['woff2','font/woff2',Buffer.from('wOF2')]];
test('K03 every allowlisted media type round-trips exact opaque bytes in a fresh process; signature-matched is not parsing',t=>{
  const f=fixture(t),saved=[];
  for(const [i,[ext,mediaType,data]]of media.entries()) {
    const b=Buffer.concat([data,Buffer.from([0,0xff,0xfe,0x1b])]);
    const receipt=ok(f.call('importAssetVersion',input('media-'+i,{filename:'opaque.'+ext,mediaType,bytes:b})));
    assert.deepEqual(bytes(f,receipt.version),b);
    const metadata=ok(f.call('getAssetVersion',{version:receipt.version})).version;
    assert.equal(metadata.signature,'signature-matched');assert.equal(metadata.byteCount,b.length);saved.push({version:receipt.version,hex:b.toString('hex')});
  }
  child(`import assert from 'node:assert/strict';import {openMemoryCore} from ${JSON.stringify(moduleURL('core/contract.mjs'))};${childHost}
  const core=openMemoryCore({path:process.argv[1],assets:{version:'assets-local-v1',storage:'sqlite-blob-v1',authority}});
  try{for(const saved of JSON.parse(process.argv[2])){const chunks=[];let cursor;do{const page=ok(core.readAssetBytes({version:saved.version,...(cursor?{cursor}:{})},token));chunks.push(Buffer.from(page.bytes,'base64'));cursor=page.nextCursor;}while(cursor);assert.equal(Buffer.concat(chunks).toString('hex'),saved.hex);}}finally{core.close();}`,[f.path,JSON.stringify(saved)]);
});
test('K03 declarations, extensions, signatures, MPEG fields and complete bounded MP4 brands must all agree atomically',t=>{
  const f=fixture(t),cases=[
    {filename:'x.png'}, {mediaType:'image/png'}, {bytes:Buffer.from(' %PDF-1.7')},{bytes:Buffer.from('%PDF-1.8')},
    {filename:'x.gif',mediaType:'image/gif',bytes:Buffer.from('GIF88a')},
    ...['ffeb9000','fffd9000','fffb0000','fffbf000','fffb9c00'].map(hex=>({filename:'x.mp3',mediaType:'audio/mpeg',bytes:Buffer.from(hex,'hex')})),
    ...[1,5].map(major=>({filename:'x.mp3',mediaType:'audio/mpeg',bytes:Buffer.from([73,68,51,major])})),
    ...[mp4('xxxx',['mp42']),mp4('isom',['iso2']),mp4().subarray(0,19)].map(b=>({filename:'x.mp4',mediaType:'video/mp4',bytes:b})),
    {filename:'x.png',mediaType:'image/png',bytes:Buffer.from('89504e470d0a1a','hex')},
  ];
  const oversized=mp4();oversized.writeUInt32BE(4100);cases.push({filename:'x.mp4',mediaType:'video/mp4',bytes:oversized});
  for(const [i,patch]of cases.entries())error(f.call('importAssetVersion',input('mismatch-'+i,patch)),'unsupported_media');
  assert.equal(f.db.prepare('SELECT count(*) n FROM assets').get().n,0);assert.equal(f.db.prepare('SELECT count(*) n FROM asset_operations').get().n,0);
  for(const major of ['isom','iso2','iso3','iso4','iso5','iso6','mp41','mp42','avc1'])ok(f.call('importAssetVersion',input('brand-'+major,{filename:'x.mp4',mediaType:'video/mp4',bytes:mp4(major)})));
  for(let minor=0;minor<=7;minor++)ok(f.call('importAssetVersion',input('pdf-'+minor,{bytes:Buffer.from('%PDF-1.'+minor)})));
  ok(f.call('importAssetVersion',input('pdf-20',{bytes:Buffer.from('%PDF-2.0')})));
});
test('K04 input views are copied before callbacks, offsets are preserved and no byte backing storage escapes authority',t=>{
  const f=fixture(t),backing=Buffer.concat([Buffer.from('outside'),pdf(33000),Buffer.from('outside')]);
  const selected=new Uint8Array(backing.buffer,backing.byteOffset+7,33000),expected=Buffer.from(selected);
  f.trusted.state.authorizeHook=request=>{
    assert.equal(request.input.bytes.byteCount,33000);assert.equal(typeof request.input.bytes.commitment,'string');
    assert.equal(request.input.bytes instanceof Uint8Array,false);assert.ok(Object.isFrozen(request.input.bytes));
    backing.fill(0);assert.throws(()=>{request.input.title='changed';},TypeError);
  };
  const receipt=ok(f.call('importAssetVersion',input('offset',{bytes:selected})));f.trusted.state.authorizeHook=null;
  assert.deepEqual(bytes(f,receipt.version),expected);
  const second=ok(f.call('importAssetVersion',input('copy-again',{bytes:expected})));assert.equal(second.version.contentIdentity,receipt.version.contentIdentity);
  assert.notEqual(second.version.versionId,receipt.version.versionId);assert.equal(f.db.prepare('SELECT count(*) n FROM binary_objects').get().n,2);
  assert.equal(ok(f.call('getAssetUsage',{namespace:ns})).retainedBinaryBytes,66000);
  const scoped=ok(f.call('importAssetVersion',input('project',{namespace:project,bytes:expected})));assert.notEqual(scoped.version.contentIdentity,receipt.version.contentIdentity);
});
test('K04 independent asset CAS/ordinals, immutable history, exact replay before existence and action conflicts after purge',t=>{
  const f=fixture(t),firstInput=input(),first=ok(f.call('importAssetVersion',firstInput));
  const laterInput=input('second',{asset:first.asset,expectedAssetRevision:1,bytes:pdf(20)}),second=ok(f.call('importAssetVersion',laterInput));
  assert.equal(second.ordinal,2);assert.equal(second.assetRevision,2);assert.deepEqual(bytes(f,first.version),pdf());
  error(f.call('importAssetVersion',input('stale',{asset:first.asset,expectedAssetRevision:1})),'revision_conflict');
  assert.deepEqual(ok(f.call('importAssetVersion',firstInput)),first);
  error(f.call('importAssetVersion',{...firstInput,title:'changed'}),'action_conflict');
  const deletion={actionId:'delete-first',ref:first.version,expectedRevision:1};ok(f.call('deleteAssetVersion',deletion));
  assert.deepEqual(ok(f.call('importAssetVersion',firstInput)),first);assert.deepEqual(ok(f.call('importAssetVersion',laterInput)),second);
  assert.equal(ok(f.call('getAssetVersion',{version:first.version})).status,'unavailable');
  assert.equal(collect(f,'listAssetVersions',{asset:first.asset},'versions').length,2);
  assert.equal(ok(f.call('getAssetUsage',{namespace:ns})).retainedBinaryBytes,20);
});
test('K04 binary limits, filename/title limits, malformed Unicode/objects and detached/shared bytes refuse before callbacks or locks',t=>{
  const f=fixture(t),bad=[{bytes:new Uint8Array()},{bytes:pdf(ASSET_LIMITS.versionBytes+1)},{bytes:new DataView(new ArrayBuffer(8))},
    {bytes:new Uint8Array(new SharedArrayBuffer(8))},{title:'x'.repeat(201)},{title:'\uD800'}, {filename:'x'.repeat(513)},
    {filename:'a/x.pdf'},{filename:'a\\x.pdf'},{filename:'x\0.pdf'},{namespace:{...ns,ownerId:'\uD800'}},
    {extra:true},{bytes:undefined}];
  const transferable=new Uint8Array(new ArrayBuffer(8));transferable.set(pdf());structuredClone(transferable,{transfer:[transferable.buffer]});bad.push({bytes:transferable});
  for(const patch of bad)error(f.call('importAssetVersion',input('invalid',patch)),'invalid_input');
  error(f.call('importAssetVersion',new Proxy(input(),{})),'invalid_input');
  const getter=input();Object.defineProperty(getter,'bytes',{get(){throw Error('private getter');}});error(f.call('importAssetVersion',getter),'invalid_input');
  assert.equal(f.trusted.state.requests.length,0);assert.equal(f.db.prepare('SELECT count(*) n FROM assets').get().n,0);
  const legal=ok(f.call('importAssetVersion',input('labels',{title:'t'.repeat(200),filename:'x'.repeat(508)+'.pdf'})));
  assert.equal(ok(f.call('getAssetVersion',{version:legal.version})).version.filename.length,512);
});
test('K04 first/last version and namespace limits count tombstones, reservations do not leak on refusal',t=>{
  const f=fixture(t),first=ok(f.call('importAssetVersion',input()));let latest=first;
  for(let i=2;i<=64;i++)latest=ok(f.call('importAssetVersion',input('v-'+i,{asset:first.asset,expectedAssetRevision:i-1})));
  error(f.call('importAssetVersion',input('too-many',{asset:first.asset,expectedAssetRevision:64})),'asset_limit_reached');
  assert.equal(latest.ordinal,64);assert.equal(f.db.prepare('SELECT byte_count FROM binary_owner_usage').get().byte_count,64*8);
  ok(f.call('deleteAssetVersion',{actionId:'del-version',ref:first.version,expectedRevision:1}));
  error(f.call('importAssetVersion',input('still-too-many',{asset:first.asset,expectedAssetRevision:65})),'asset_limit_reached');
  // A namespace limit uses only content-free canonical parent rows.
  const insert=f.db.prepare("INSERT INTO assets VALUES(?,?,?,?,'available',1,1,?,?)");
  f.db.exec('BEGIN IMMEDIATE');
  try{for(let i=1;i<1024;i++)insert.run('limit-'+i,ns.ownerId,ns.scope,'','synthetic','synthetic');f.db.exec('COMMIT');}catch(error){f.db.exec('ROLLBACK');throw error;}
  error(f.call('importAssetVersion',input('too-many-assets')),'asset_limit_reached');
  assert.equal(f.db.prepare('SELECT byte_count FROM binary_owner_usage').get().byte_count,63*8);
});
test('K12 capabilities advertise only implemented methods, namespace-only usage and parser unavailable; no model, network or content execution',t=>{
  let calls=0;const f=fixture(t);const cap=ok(f.core.getAssetCapabilities());
  assert.deepEqual(cap.methods,[...ASSET_METHODS]);assert.equal(cap.parser,'unavailable');assert.equal(cap.limits.responseBytes,65536);
  for(const method of ['createAssetDerivative','listAssetDerivatives','readAssetDerivative','deleteAssetDerivative'])assert.equal(typeof f.core[method],'function');
  assert.equal(f.core.readMethodAttachmentBytes,undefined);
  const previous=globalThis.fetch;globalThis.fetch=()=>{calls++;throw Error('network');};t.after(()=>{globalThis.fetch=previous;});
  const receipt=ok(f.call('importAssetVersion',input('opaque-code',{bytes:Buffer.concat([pdf(),Buffer.from('throw new Error("DO NOT EXECUTE"); fetch("https://invalid")')])})));
  assert.equal(ok(f.call('verifyAssetBytes',{version:receipt.version,bytes:bytes(f,receipt.version)})).matches,true);
  assert.equal(ok(f.call('verifyAssetBytes',{version:receipt.version,bytes:pdf()})).matches,false);
  assert.deepEqual(ok(f.call('verifyAssetBytes',{version:receipt.version,bytes:new Uint8Array()})),{matches:false,candidateLength:0,canonicalContentIdentity:receipt.version.contentIdentity});
  assert.equal(calls,0);assert.equal(ok(f.call('getAssetUsage',{namespace:ns})).aggregate,'not-requested');
});
test('K12 worst-case escaped legal metadata and maximum byte pages remain within the 65536-byte envelope',t=>{
  const f=fixture(t),grants=new WeakMap(),token={},authority={authorize(request,supplied){if(supplied!==token)return null;const grant={},{input,...binding}=request;grants.set(grant,{...binding,accessGeneration:1});return grant;},isCurrent(grant){return grants.get(grant)??null;}};
  const scope={ownerId:'"'.repeat(200),scope:'project',projectId:'\\'.repeat(200)};
  const core=openMemoryCore({path:f.path,assets:{version:'assets-local-v1',storage:'sqlite-blob-v1',authority}});t.after(()=>core.close());
  const call=(method,input)=>{const result=core[method](input,token);assert.ok(Buffer.byteLength(JSON.stringify(result))<=65536);return ok(result);};
  let receipt;
  for(let i=0;i<21;i++)receipt=call('importAssetVersion',{namespace:scope,actionId:'escaped-'+i,title:'\u0001'.repeat(200),filename:'"'.repeat(508)+'.pdf',mediaType:'application/pdf',bytes:pdf(i===0?32769:8),
    ...(receipt?{asset:receipt.asset,expectedAssetRevision:i}:{})});
  let cursor,count=0,pages=0;
  do {const page=call('listAssetVersions',{asset:receipt.asset,...(cursor?{cursor}:{})});if(pages===0)assert.ok(page.versions.length<20,'byte budget trims legal large entries');count+=page.versions.length;pages++;cursor=page.nextCursor;}while(cursor);
  assert.equal(count,21);assert.ok(pages>1);
  const first=call('listAssetVersions',{asset:receipt.asset,limit:1}).versions[0].ref;
  const page=call('readAssetBytes',{version:first});assert.equal(page.byteCount,32768);assert.equal(page.complete,false);
  const final=call('readAssetBytes',{version:first,cursor:page.nextCursor});assert.equal(final.byteCount,1);assert.equal(final.complete,true);
});
