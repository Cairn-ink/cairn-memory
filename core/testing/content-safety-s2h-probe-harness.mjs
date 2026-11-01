import { trackContentHostOptions } from './content-safety-cost-hosts.mjs';
// Synthetic in-memory transport reproduces the frozen query-cost fixture.
// Production query SQL is loaded unchanged; only file/Worker plumbing is adapted.

import {register} from 'node:module';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {EventEmitter} from 'node:events';
import assert from 'node:assert/strict';
const fixtureRoot=fileURLToPath(new URL('../../',import.meta.url));
const root=process.env.CAIRN_PROBE_SOURCE_ROOT ?? fixtureRoot;
const replaceOnce=(source,needle,value)=>{assert.equal(source.split(needle).length,2,'one loader placeholder');return source.replace(needle,value);};
register('data:text/javascript,'+encodeURIComponent(replaceOnce(replaceOnce("\nimport {readFile} from 'node:fs/promises';\nconst root=ROOT,fixtures=FIXTURES;\nexport async function resolve(spec,ctx,next){\n if(spec==='node:worker_threads' && ctx.parentURL?.endsWith('/core/context-product-reader.mjs'))return {url:'probe:/shim-worker',shortCircuit:true};\n if(spec==='node:fs' && ctx.parentURL?.startsWith('probe:/') && !ctx.parentURL.includes('/shim-'))return {url:'probe:/shim-fs',shortCircuit:true};\n if(spec==='node:sqlite' && ctx.parentURL?.startsWith('probe:/') && !ctx.parentURL.includes('/shim-'))return {url:'probe:/shim-sqlite',shortCircuit:true};\n if(spec.startsWith('probe:'))return {url:spec,shortCircuit:true};\n if(spec.startsWith('.')&&ctx.parentURL?.startsWith('probe:/'))return {url:new URL(spec,ctx.parentURL).href,shortCircuit:true};\n return next(spec,ctx);\n}\nexport async function load(url,ctx,next){\n if(url==='probe:/shim-worker')return {format:'module',shortCircuit:true,source:`export * from 'node:worker_threads';export class Worker{constructor(url,options){return new globalThis.__probe.ProbeWorker(options.workerData)}}`};\n if(url==='probe:/shim-fs')return {format:'module',shortCircuit:true,source:`export * from 'node:fs';import * as fs from 'node:fs';export function lstatSync(p,o){return globalThis.__probe.stat(p,o,fs.lstatSync)};export function readFileSync(p,o){return globalThis.__probe.read(p,o,fs.readFileSync)};export function mkdirSync(p,...rest){if(String(p).startsWith('/synthetic'))return;return fs.mkdirSync(p,...rest)};`};\n if(url==='probe:/shim-sqlite')return {format:'module',shortCircuit:true,source:`export * from 'node:sqlite';export function DatabaseSync(p,o){return globalThis.__probe.open(p,o)};`};\n if(url.endsWith('/core/sqlite-journal-probe.mjs'))return {format:'module',shortCircuit:true,source:`export const sqliteFileStat=p=>globalThis.__probe.stat(p,{bigint:true});export const probeRollbackJournal=()=>({mode:'delete',code:0});export function createExclusiveSqliteFile(){throw Error('unexpected file creation')}`};\n if(url.startsWith('probe:/')){\n if(/\\/(?:adapters|node_modules)\\//.test(url))throw Error('probe_core_dependency_boundary');\n const m=/^probe:\\/([^/]+)\\/(.+)$/.exec(url);if(!m)throw Error(url);\n const source=await readFile(((m[2].startsWith('core/testing/')||m[2].startsWith('tools/testing/'))?fixtures:root)+'/'+m[2],'utf8');\n return {format:'module',source,shortCircuit:true};\n }\n return next(url,ctx);\n}\n",'ROOT',JSON.stringify(root)),'FIXTURES',JSON.stringify(fixtureRoot))),import.meta.url);

export async function initializeProbe({physical,n,factCount='0',model,cardsAuthority}) {
const rev='working';
const load=p=>import('probe:/'+rev+'/core/'+p+'.mjs');
const dbs=new Map(), originals=new Map();let memorySerial=0;
globalThis.__probe={
 read(p,o,actual){if(!String(p).startsWith('probe:/'))return actual(p,o);const m=/^probe:\/([^/]+)\/(.+)$/.exec(String(p));return readFileSync((m[2].startsWith('core/testing/')?fixtureRoot:root)+'/'+m[2],o);},
 open(p,o){
  if(p===':memory:'){const db=new DatabaseSync(':memory:');globalThis.__probe.latest=db;return db;}
  p=String(p).replace(/^file:\/\//,'').split('?')[0];
  if(!dbs.has(p))throw Error('unknown synthetic DB '+p);
  return dbs.get(p);
 },
 stat(p,o,actual){
  p=String(p);if(!p.startsWith('/synthetic/')){if(actual)return actual(p,o);throw Error('unexpected path '+p);}
  if(!dbs.has(p))throw Object.assign(Error('synthetic absent'),{code:'ENOENT'});
  const big=o?.bigint;const num=x=>big?BigInt(x):x;
  return {dev:num(1),ino:num([...dbs.keys()].indexOf(p)+1),size:num(8192),mode:num(0o100600),mtimeNs:num(1),ctimeNs:num(1),isFile:()=>true,isSymbolicLink:()=>false};
 }
};
const {openMemoryCore}=await load('contract');
const {openDatabase,transaction}=await load('database');
const authority=cardsAuthority ?? {authorize:()=>null,isCurrent:()=>null};
const rawBase=[23,33,38,48].includes(physical)?{privateCards:{version:'private-cards-local-v1',source:'submitted-note-v1',storage:'local-plain-v1',disclosure:'explicit-submitted-note-v1',authority,currentDependencies:{version:'card-current-dependencies-v1'}},methodPackages:{version:'method-packages-local-v1',storage:'local-plain-v1',authority}}:{};
if ([23,38].includes(physical)) { delete rawBase.methodPackages; delete rawBase.privateCards.currentDependencies; }
const core=openMemoryCore(trackContentHostOptions({path:':memory:',model,...rawBase}));const canonical=__probe.latest;
const ns={ownerId:'synthetic-probe-owner',scope:'personal',projectId:null};
const memories=[];
for(let i=0;i<n;i++){
 const r=core.admit({namespace:ns,memory:{content:'probecommon synthetic memory '+String(i).padStart(5,'0'),kind:'fact'},receipts:[{client:'synthetic',sessionId:'probe',eventId:String(i),role:'user',excerpt:'synthetic receipt '+i}]});
 assert.equal(r.ok,true,JSON.stringify(r));memories.push(r.value.memory);
}
const base=[33,48].includes(physical)?33:[23,38].includes(physical)?23:18;
assert.equal(canonical.prepare('PRAGMA user_version').get().user_version,base);
if([34,38,48].includes(physical)){
 const {installContentSafetyInside,contentSafetyInventory}=await load('content-safety-migration');
 transaction(canonical,()=>installContentSafetyInside(canonical,base,contentSafetyInventory(canonical)));
}
const {attestContentSafety}=await load('content-safety-schema');attestContentSafety(canonical);
assert.equal(canonical.prepare('PRAGMA user_version').get().user_version,physical,'native physical cell after setup');

return {core,canonical,load,dbs,originals,ns,memories,transaction,physical,n,factCount,rev};
}
