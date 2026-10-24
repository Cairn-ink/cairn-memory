// Opt-in maintainer recipe. Unit tests read the committed artifacts only.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdirSync, openSync, closeSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';

const [mode,...extra]=process.argv.slice(2);
if (!['--write','--verify'].includes(mode) || extra.length) throw Error('Usage: npm run fixtures:method-packages -- --write|--verify (full history required)');
const repo=fileURLToPath(new URL('../../',import.meta.url));
const workspace=createTestWorkspace(null,{prefix:'method-history-generator-'});
const ns={ownerId:'synthetic-method-owner',scope:'personal',projectId:null};
const revisions=[[18,'b8fa224'],[20,'73980ab'],[21,'08dfe24'],[22,'d7d46ef'],[23,'8fed09d'],
  [24,'91846e6'],[25,'05f4a94'],[26,'efbf9aa'],[27,'6596b2e'],[28,'63098c1'],[29,'b8fa224']];
let commandOrdinal=0;
function command(program,args,options={}) {
  const stem=join(workspace.path,'command-'+commandOrdinal++),out=openSync(stem+'.out','wx',0o600),err=openSync(stem+'.err','wx',0o600);
  let result;
  try { result=spawnSync(program,args,{cwd:repo,timeout:60000,...options,stdio:['ignore',out,err]}); }
  finally {closeSync(out);closeSync(err);}
  assert.equal(result.error,undefined,String(result.error));
  assert.equal(result.signal,null,readFileSync(stem+'.err','utf8'));
  assert.equal(result.status,0,readFileSync(stem+'.err','utf8'));
  return readFileSync(stem+'.out','utf8');
}
const child=(code,args=[])=>command(process.execPath,['--input-type=module','-e',determinism+code,...args]);
// Deterministic synthetic clock/entropy make --verify byte-exact on both Nodes.
// Historical source code is left unchanged; these replace only fixture inputs.
const determinism=`
import crypto from 'node:crypto';import {syncBuiltinESMExports} from 'node:module';
let sequence=0;const bytes=n=>{const chunks=[];for(let size=0;size<n;size+=32)chunks.push(crypto.createHash('sha256').update('synthetic-method-history-'+sequence++).digest());return Buffer.concat(chunks).subarray(0,n);};
crypto.randomBytes=bytes;crypto.randomUUID=()=>{const b=bytes(16);b[6]=(b[6]&15)|64;b[8]=(b[8]&63)|128;const h=b.toString('hex');return h.slice(0,8)+'-'+h.slice(8,12)+'-'+h.slice(12,16)+'-'+h.slice(16,20)+'-'+h.slice(20);};syncBuiltinESMExports();
const RealDate=Date;globalThis.Date=class extends RealDate{constructor(...args){super(...(args.length?args:['2026-10-20T00:00:00.000Z']));}static now(){return 1792454400000;}};
`;
function materialize(root,revision) {
  const target = join(root,'code-'+revision); mkdirSync(target,{ mode:0o700 });
  const archive = join(root,'code-'+revision+'.tar'), out = openSync(archive,'wx',0o600);
  try { const result=spawnSync('git',['archive',revision,'core','plugins/cairn-memory/lib/redact.mjs'],{cwd:repo,stdio:['ignore',out,'inherit']});assert.equal(result.error,undefined);assert.equal(result.status,0); }
  finally { closeSync(out); }
  command('tar',['-xf',archive,'-C',target]);
  return target;
}
const childHost = `
const token={}, grants=new WeakMap();
const authority={authorize(request,supplied){if(supplied!==token)return null;const grant={}, {input,...binding}=request;grants.set(grant,binding);return grant;},
isCurrent(grant){return grants.has(grant)?{...grants.get(grant),accessGeneration:1}:null;}};
const methods={version:'method-packages-local-v1',storage:'local-plain-v1',authority};
const cards={version:'private-cards-local-v1',source:'submitted-note-v1',storage:'local-plain-v1',disclosure:'explicit-submitted-note-v1',authority};
const ok=r=>{if(!r.ok)throw Error(JSON.stringify(r));return r.value;};
`;
function populated(root,version,path) {
  const code = `
import { openMemoryCore } from ${JSON.stringify(pathToFileURL(join(root,'core/contract.mjs')).href)};
import { DatabaseSync } from 'node:sqlite';
${childHost}
const path=process.argv[1], ns=${JSON.stringify(ns)}, version=${version};
let core;
const options={path,...(version>=20?{privateCards:cards}:{})};
const raw={mode:'raw-v1',capBytes:1000000,readPolicy:()=>({generation:'synthetic',reason:null}),
port:{version:'raw-seal-v1',async sealRaw({text}){return {format:'local-plain-v1',keyVersion:null,sealed:Buffer.from(text)};},async openRaw({sealed}){return {text:Buffer.from(sealed).toString()};}}};
if(version>=25&&version<29){const {openRawCaptureCore}=await import(${JSON.stringify(pathToFileURL(join(root,'core/raw-capture.mjs')).href)});
 core=openRawCaptureCore({...options,model:{extract:()=>({items:[]})}},{...raw,...(version>=26?{lineage:true}:{}),...(version>=27?{deletion:true}:{}),...(version>=28?{sources:true}:{})});}
else if(version===29)core=openMemoryCore({...options,model:{extract:()=>({items:[]})},rawConversations:raw});
else core=openMemoryCore(options);
ok(core.admit({namespace:ns,memory:{content:'Synthetic preserved Memory.',kind:'fact'},receipts:[{client:'manual',sessionId:'synthetic',eventId:'one',role:'user',excerpt:'Synthetic explicit excerpt.'}]}));
if(version>=20){const source=ok(core.submitSourceNote({namespace:ns,actionId:'note',text:'Synthetic retained note.',occurredAt:null},token)).source;
ok(core.createCardDraft({namespace:ns,actionId:'draft',drafting:'authored',input:{sources:[source],title:'Synthetic retained Card',body:'Synthetic retained body.'}},token));}
const request={namespace:ns,client:'claude-code',sessionId:'synthetic-raw',eventId:'raw-event',messages:[{id:'raw-message',role:'user',occurredAt:null,messageOrdinal:1,content:'Synthetic Raw.',part:{index:0,start:0,totalUnits:14,totalBytes:14}}]};
if(version>=25)ok(await core.captureRaw(request));
core.close();
if(version===24){const {openDatabase}=await import(${JSON.stringify(pathToFileURL(join(root,'core/database.mjs')).href)});
const {createRawJournal}=await import(${JSON.stringify(pathToFileURL(join(root,'core/raw-journal.mjs')).href)});
const db=openDatabase(path,{rawConversations:true});const journal=createRawJournal({db,...raw});await journal.register(request);db.close();}
const db=new DatabaseSync(path);if(db.prepare('PRAGMA user_version').get().user_version!==version)throw Error('wrong historical layout');
if(version===29){db.close();const c=openMemoryCore({...options,rawConversations:{mode:'off',readPolicy:raw.readPolicy}});
const before=ok(c.getLocalCaptureControl({namespace:ns,client:'codex'}));ok(c.setLocalCaptureControl({namespace:ns,client:'codex',targetId:'synthetic-target',expectedStoreId:before.storeId,expectedRevision:before.revision,automaticCaptureEnabled:false,rawNoticeVersion:null}));c.close();}else db.close();
`;
  child(code,[path]);
}

function capture(path,objects) {
  const db=new DatabaseSync(path,{readOnly:true});
  try {
    const definitions=db.prepare("SELECT name,type,tbl_name AS tableName,sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY name").all();
    const ids=definitions.map(row=>{const object={...row},id=createHash('sha256').update(JSON.stringify(object)).digest('hex');objects[id]=object;return id;});
    const tables={};
    for(const row of definitions.filter(row=>row.type==='table')) {
      const rows=db.prepare('SELECT * FROM "'+row.name+'"').all().map(row=>Object.fromEntries(Object.entries(row).map(([key,value])=>[key,value instanceof Uint8Array?{blob:Buffer.from(value).toString('base64')}:value])));
      if(rows.length)tables[row.name]=rows;
    }
    assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
    return {applicationId:db.prepare('PRAGMA application_id').get().application_id,version:db.prepare('PRAGMA user_version').get().user_version,objects:ids,tables};
  } finally {db.close();}
}
try {
  const objects={},layouts=[],roots=new Map();
  for(const [version,pin] of revisions) {
    const revision=command('git',['rev-parse',pin+'^{commit}']).trim();
    if(!roots.has(pin))roots.set(pin,materialize(workspace.path,pin));
    const path=join(workspace.path,'v'+version+'.sqlite');populated(roots.get(pin),version,path);
    layouts.push({revision,...capture(path,objects)});
  }
  const root=roots.get('b8fa224'),path=join(workspace.path,'compatibility.sqlite');
  const expected=JSON.parse(child(`
    const {openMemoryCore}=await import(${JSON.stringify(pathToFileURL(join(root,'core/contract.mjs')).href)});
    const ns=${JSON.stringify(ns)},core=openMemoryCore({path:process.argv[1]});
    const admitted=core.admit({namespace:ns,memory:{content:'Synthetic unchanged default DTO.',kind:'fact'},receipts:[{
      client:'manual',sessionId:'synthetic',eventId:'one',role:'user',excerpt:'Synthetic default excerpt.'}]});
    if(!admitted.ok)throw Error(JSON.stringify(admitted));const id=admitted.value.memory.id;
    console.log(JSON.stringify({keys:Object.keys(core),id,get:core.get({namespace:ns,memoryId:id}),list:core.list({namespace:ns}),map:core.map({namespace:ns})}));core.close();`,[path]));
  const compatibility={revision:layouts[0].revision,...capture(path,objects),expected};
  const artifact={format:'method-package-history-v1',synthetic:true,recipe:'core/testing/generate-method-package-history.mjs',objects:Object.fromEntries(Object.entries(objects).sort(([a],[b])=>a.localeCompare(b))),layouts,compatibility};
  const opener='// Frozen actual b8fa224 ordinary opener. Only this header and relative import relocation differ.\n'+
    readFileSync(join(root,'core/database.mjs'),'utf8').replaceAll('from "./','from "../').replaceAll("from './","from '../");
  for(const [file,text] of [['method-package-history.json',JSON.stringify(artifact,null,2)+'\n'],['method-package-v29-database.mjs',opener]]) {
    const target=new URL(file,import.meta.url);
    if(mode==='--write')writeFileSync(target,text);else assert.equal(readFileSync(target,'utf8'),text,file+' differs from historical generation');
    console.log(mode+' '+file+' ('+Buffer.byteLength(text)+' bytes)');
  }
} finally {await workspace.cleanup();}
