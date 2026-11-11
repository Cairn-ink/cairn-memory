import test from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {DatabaseSync} from 'node:sqlite';
const root = new URL('../../', import.meta.url);
globalThis.timeoutProvenanceNow=0n;
const hook=registerHooks({load(url,ctx,next){const r=next(url,ctx);if(!url.endsWith('/core/capture-deadline.mjs'))return r;
 const source=r.source.toString();assert.ok(source.includes('const monotonicNow = process.hrtime.bigint;'));
 return {...r,source:source.replace('const monotonicNow = process.hrtime.bigint;','const monotonicNow = () => globalThis.timeoutProvenanceNow;')};}});
const {fixture,request,splitRaw}=await import(new URL('core/testing/raw-capture-fixtures.mjs',root));
hook.deregister();
test('deadline at lazy handoff releases the writer already reserved for the new episode',async t=>{
 globalThis.timeoutProvenanceNow=0n;
 const f=fixture(t,{kind:'episode',coreOptions:{captureDeadlineMs:500}});
 function input(session,id,ordinal){return request(splitRaw('Synthetic '+id,{id,ordinal})[0],{sessionId:session},'episode');}
 for(const [id,ordinal]of [['old-one',1],['old-two',2]])assert.equal((await f.core.captureRaw(input('old-session',id,ordinal))).ok,true);
 t.diagnostic(JSON.stringify({before:f.db.prepare('SELECT id,observed,attempted,writer_token FROM session_episodes').all()}));
 const prepare=DatabaseSync.prototype.prepare;let fired=0;
 DatabaseSync.prototype.prepare=function(sql,...args){const st=prepare.call(this,sql,...args);
  if(!sql.startsWith('SELECT e.id FROM session_episodes e WHERE'))return st;
  return new Proxy(st,{get(target,key){if(key==='get')return(...values)=>{const result=target.get(...values);if(result){fired++;globalThis.timeoutProvenanceNow+=600_000_000n;}return result;};return Reflect.get(target,key,target);}});
 };
 let result;try{result=await f.core.captureRaw(input('new-session','new-one',1));}finally{DatabaseSync.prototype.prepare=prepare;}
 const writers=f.db.prepare('SELECT id,observed,attempted,writer_token,writer_expires_at FROM session_episodes').all();
 globalThis.timeoutProvenanceNow=0n;
 const retry=await f.core.captureRaw(input('new-session','new-one',1));
 t.diagnostic(JSON.stringify({fired,result,writers,retry,transaction:f.db.isTransaction}));
 assert.equal(writers.filter(row=>row.writer_token!==null).length,0,'an expired invocation must release its acquired writer');
 assert.ok(writers.every(row=>row.writer_expires_at===null));
 assert.equal(retry.ok,true,JSON.stringify(retry));
 assert.equal(retry.value.interpretation.ok,true,JSON.stringify(retry));
 assert.equal(retry.value.interpretation.value.processing,undefined);
 assert.equal(f.db.isTransaction,false);
 assert.equal(fired,1);assert.equal(result.value?.interpretation.error?.code,'model_timeout');
});
