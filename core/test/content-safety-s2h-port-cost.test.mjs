import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { openRawCaptureCore } from '../raw-capture.mjs';
import { cardHost } from '../testing/raw-source-fixtures.mjs';
import { request, splitRaw, localPlainPort } from '../testing/raw-capture-fixtures.mjs';
import { rationaleModel } from '../testing/rationale-model.mjs';
import { safetyFixture, ns, ok } from '../testing/content-safety-s2h-fixture.mjs';

const fixedByMethod=new Map();
const epochSQL='SELECT epoch_hi,epoch_lo FROM owner_suppression_epochs WHERE owner_id=?';
for(const method of ['getConversation','resolveSourceReferences','getSource'])for(const n of [1,4])
test(`E1 ${method} ${n} parts: exactly one autocommit epoch read before inspecting each return`,async t=>{
 const measured=[];
 for(const migrated of [false,true]) {
 const f=safetyFixture(t,33);if(migrated)await f.migrate();const host=cardHost(),base=localPlainPort();
 let active=false,returned=false,calls=0,observations=[],statements=0,begins=0;
 const connections=new Set(),boundaries=[];
 const port={...base,async openRaw(value){
  if(active){assert.equal(returned,false,'previous return was inspected before another port');for(const db of connections)assert.equal(db.isTransaction,false,'no read snapshot spans the await');calls++;}
  const result=await base.openRaw(value);
  if(!active)return result;
  returned=true;observations=[];
  return {get text(){
   assert.deepEqual(observations,migrated?[{sql:epochSQL,transaction:false}]:[]);
   returned=false;boundaries.push(observations);return result.text;
  }};
 }};
 const core=openRawCaptureCore({path:f.path,privateCards:host.options,model:{...rationaleModel(),extract:()=>({items:[]})}},
  {mode:'raw-v1',port,sources:true,readPolicy:()=>({generation:'synthetic',reason:null})});
 const db=f.connect();t.after(()=>{core.close();db.close();});
 const text='ABCD'.slice(0,n),parts=splitRaw(text,{size:1});let raw;
 for(const [i,part]of parts.entries())raw=ok(await core.captureRaw(request(part,{namespace:ns,client:'codex',sessionId:'cost-source',eventId:'cost-'+i})));
 const conversationId=raw.raw.conversationId,revision=db.prepare('SELECT revision FROM raw_conversations WHERE id=?').get(conversationId).revision;
 const input={namespace:ns,anchors:[{rawAnchor:{conversationId,messageId:parts[0].id,start:0,end:n,precision:'exact'},expectedConversationRevision:revision}]};
 const source=method==='getSource'?ok(await host.call(core,'resolveSourceReferences',input)).sources[0]:null;
 const prepare=DatabaseSync.prototype.prepare,exec=DatabaseSync.prototype.exec;
 DatabaseSync.prototype.prepare=function(sql){
  const connection=this,statement=prepare.call(this,sql);connections.add(connection);
  return new Proxy(statement,{get(target,key){const value=Reflect.get(target,key,target);if(typeof value!=='function')return value;return(...args)=>{
   if(active&&['get','all','iterate','run'].includes(key))statements++;
   if(returned&&['get','all','iterate','run'].includes(key))observations.push({sql,transaction:connection.isTransaction});
   return value.apply(target,args);
  };}});
 };
 DatabaseSync.prototype.exec=function(sql){if(active)for(const statement of sql.split(';').filter(s=>s.trim())){statements++;if(/^BEGIN/.test(statement.trim()))begins++;}if(returned)observations.push({sql,transaction:this.isTransaction});return exec.call(this,sql);};
 let result;
 try{active=true;result=method==='getConversation'?await core.getConversation({namespace:ns,conversationId}):
  await host.call(core,method,method==='getSource'?{namespace:ns,source}:input);
 }finally{active=false;DatabaseSync.prototype.prepare=prepare;DatabaseSync.prototype.exec=exec;}
 assert.equal(result.ok,true,JSON.stringify(result));assert.equal(calls,n);assert.equal(boundaries.length,n);assert.equal(returned,false);
 measured.push({statements,begins});
 t.diagnostic('E1_PORT_COUNTS '+JSON.stringify({node:process.version,method,n,migrated,statements,begins,epochReads:migrated?boundaries.length:0,portBegin:0,portHeader:0,portFact:0}));
 }
 const fixed=measured[1].statements-measured[0].statements-n;
 assert.ok(fixed<=6,JSON.stringify({method,n,measured,fixed}));
 assert.equal(measured[1].begins,measured[0].begins,'no safety-only transaction');
 if(n===1)fixedByMethod.set(method,fixed);else assert.equal(fixed,fixedByMethod.get(method),'zero per-part overhead beyond E1');
});
