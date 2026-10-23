import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { readFileSync,writeFileSync,openSync,closeSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { openMemoryCore } from '../contract.mjs';
import { STORAGE_BUSY_TIMEOUT_MS } from '../database.mjs';
import { ASSET_METHODS } from '../asset-input.mjs';
import { METHOD_METHODS } from '../method-package-input.mjs';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';
export {ok,error,child,moduleURL,childHost,restoreHistoricalStore,historicalFixtures} from './method-package-fixtures.mjs';
export const ns={ownerId:'synthetic-asset-owner',scope:'personal',projectId:null};
export const project={...ns,scope:'project',projectId:'synthetic-asset-project'};
export const foreign={...ns,ownerId:'foreign-asset-owner'};
export function assetHost() {
  const tokens=new WeakMap(),grants=new WeakMap();
  const state={enabled:true,generation:1,checks:0,hook:null,authorizeHook:null,classes:null,requests:[],allowAssets:true,wrongScope:false};
  const authority={authorize(request,token) {
    state.authorizeHook?.(request);
    const expected=tokens.get(token);
    state.requests.push(request);
    if(!state.enabled||!expected||expected!==request.method||![ns,project].some(value=>isDeepStrictEqual(value,request.namespace))||
      !(METHOD_METHODS.includes(request.method)||state.allowAssets&&ASSET_METHODS.includes(request.method))||
      state.classes&&!state.classes.includes(request.actionClass))return null;
    const grant={},{input,...binding}=request;grants.set(grant,binding);return grant;
  },isCurrent(grant) {
    state.checks++;state.hook?.(state.checks);
    if(Object.hasOwn(state,'currentValue'))return state.currentValue;
    const binding=grants.get(grant);
    return state.enabled&&binding?{...binding,accessGeneration:state.generation,...(state.wrongScope?{namespace:foreign}:{})}:null;
  }};
  return {state,authority,options:{version:'assets-local-v1',storage:'sqlite-blob-v1',authority},
    methods:{version:'method-packages-local-v1',storage:'local-plain-v1',authority},
    token(method){const token={};tokens.set(token,method);return token;},call(core,method,input){return core[method](input,this.token(method));}};
}
export function fixture(t,{methods=false}={}) {
  const workspace=createTestWorkspace(t,{prefix:'assets-'}),path=join(workspace.path,'store.sqlite'),trusted=assetHost();
  const config={path,assets:trusted.options,...(methods?{methodPackages:trusted.methods}:{})};let core=openMemoryCore(config);
  workspace.defer(()=>core.close());const db=new DatabaseSync(path,{timeout:STORAGE_BUSY_TIMEOUT_MS});db.exec('PRAGMA foreign_keys=ON');workspace.defer(()=>db.close());
  return {workspace,path,trusted,db,get core(){return core;},call(method,input){return trusted.call(core,method,input);},
    reopen(){core.close();core=openMemoryCore(config);return core;}};
}
export const pdf=(count=8)=>{const bytes=Buffer.alloc(count,0x61);bytes.set(Buffer.from('%PDF-1.7'));return bytes;};
export const input=(actionId='asset-first',patch={})=>({namespace:ns,actionId,title:'Synthetic asset',filename:'synthetic.pdf',mediaType:'application/pdf',bytes:pdf(),...patch});
export function collect(f,method,input,key) {
  const values=[];let cursor;
  do {const result=f.call(method,{...input,...(cursor?{cursor}:{})});assert.equal(result.ok,true,JSON.stringify(result));
    assert.ok(Buffer.byteLength(JSON.stringify(result))<=65536);values.push(...result.value[key]);cursor=result.value.nextCursor;}while(cursor);
  return values;
}
export function bytes(f,version) {
  const buffers=[];let cursor,index=0,total;
  do {const result=f.call('readAssetBytes',{version,...(cursor?{cursor}:{})});assert.equal(result.ok,true,JSON.stringify(result));
    assert.ok(Buffer.byteLength(JSON.stringify(result))<=65536);const page=result.value;assert.equal(page.status,'available');assert.equal(page.index,index++);
    const value=Buffer.from(page.bytes,'base64');assert.ok(value.length<=32768);assert.equal(value.length,page.byteCount);
    total??=page.totalByteCount;assert.equal(page.totalByteCount,total);assert.equal(page.complete,page.nextCursor===null);buffers.push(value);cursor=page.nextCursor;
  }while(cursor);const result=Buffer.concat(buffers);assert.equal(result.length,total);return result;
}
export const frozen=JSON.parse(readFileSync(new URL('./fixtures/assets-v30/manifest.json',import.meta.url),'utf8'));
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
export function restoreV30(path) {
  const compressed=readFileSync(new URL('./fixtures/assets-v30/populated.sqlite.gz',import.meta.url));assert.equal(digest(compressed),frozen.storeSha256);
  writeFileSync(path,gunzipSync(compressed),{flag:'wx',mode:0o600});return frozen;
}
export function materializeV30(directory) {
  const archive=new URL('./fixtures/assets-v30/opener.tgz',import.meta.url),value=readFileSync(archive);assert.equal(digest(value),frozen.archiveSha256);
  const out=openSync(join(directory,'tar.stdout'),'wx',0o600),err=openSync(join(directory,'tar.stderr'),'wx',0o600);
  let result;try{result=spawnSync('tar',['-xzf',fileURLToPath(archive),'-C',directory],{stdio:['ignore',out,err],timeout:30000});}finally{closeSync(out);closeSync(err);}
  assert.equal(result.error,undefined);assert.equal(result.status,0,readFileSync(join(directory,'tar.stderr'),'utf8'));
  const root=join(directory,'package');
  for(const [path,sha]of Object.entries(frozen.sourceHashes))assert.equal(digest(readFileSync(join(root,path))),sha,path);
  assert.deepEqual(JSON.parse(readFileSync(join(root,'package.json'),'utf8')).files,frozen.files);
  return root;
}
// Deliberate out-of-band corruption: restore exactly the same canonical trigger
// SQL before reopening. In-band writers never bypass these immutable rows.
export function corrupt(db,trigger,sql,...args) {
  const definition=db.prepare("SELECT sql FROM sqlite_master WHERE type='trigger' AND name=?").get(trigger).sql;
  db.exec('DROP TRIGGER '+trigger);
  try {db.prepare(sql).run(...args);}finally{db.exec(definition);}
}
