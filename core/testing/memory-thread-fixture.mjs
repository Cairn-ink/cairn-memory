import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openMemoryCore } from '../index.mjs';
import { host } from './context-read-core-fixture.mjs';

export const threadNamespace={ownerId:'synthetic-thread',scope:'personal',projectId:null};
export const unwrap=result=>{assert.equal(result.ok,true,JSON.stringify(result));return result.value;};
export function memoryThreadFixture(t,{tier=1,model:patch={},contextRead={},coreOptions={}}={}){
 const directory=mkdtempSync(join(tmpdir(),'memory-thread-')),path=join(directory,'store.sqlite');
 const trusted=host();trusted.state.allowed=[threadNamespace];const calls=[];
 const model={contextWindow:8192,countTokens:()=>1,
  extract:({input})=>({items:input.messages.map((message,index)=>({content:message.content,kind:'fact',confidence:.9,sourceIndices:[index]}))}),
  classify:({input})=>({items:input.memories.map(memory=>({memoryId:memory.id,parentIds:[]}))}),
  ...(tier===2?{relateMemories:({input})=>{calls.push(input);return {facts:input.facts.map(fact=>({factIndex:fact.factIndex,eventTime:'1900-01-01T00:00:00.000Z',
   edges:input.candidates[fact.factIndex].sort((a,b)=>b.eventTime.localeCompare(a.eventTime)).slice(0,1).map(candidate=>({candidateId:candidate.id,relation:'supersedes',confidence:.95,reason:'The breakfast value changed.'}))}))};}}:{}),...patch};
 const core=openMemoryCore({path,model,...coreOptions,contextRead:{version:'context-read-v1',authority:trusted.authority,counter:{id:'synthetic-thread',countTokens:()=>1},...contextRead}});
 const db=new DatabaseSync(path);let event=0;
 t.after(async()=>{await core.close();db.close();rmSync(directory,{recursive:true,force:true});});
 const capture=async(content,{occurredAt,namespace=threadNamespace,...extra}={})=>unwrap(await core.capture({namespace,client:'synthetic',sessionId:'session',eventId:'batch-'+(++event),
  messages:[{id:'message-'+event,role:'user',content,...(occurredAt?{occurredAt}:{})}],...extra}));
 const read=async({intent='current',query='breakfast',maxItems=24,...rest}={})=>unwrap(await trusted.call(core,'contextRead',{
  readSet:[threadNamespace],types:['memory'],intent,query,semantic:false,budget:{maxItems,maxTokens:6000},...rest}));
 return {core,db,path,trusted,model,calls,capture,read};
}
export const chainText=index=>`My breakfast is value ${index}.`;
export const chainDate=index=>new Date(Date.UTC(2025,0,index+1)).toISOString();
export async function measureThreadChain(f,changes){
 const ids=[];
 for(let i=0;i<=changes;i++)ids.push((await f.capture(chainText(i),{occurredAt:chainDate(i)})).admission.memories[0].id);
 const pack=await f.read({maxItems:1});
 const current=pack.metered.items.filter(item=>item.metadata?.thread?.status==='current');
 const latest=current.length===1&&current[0].body===chainText(changes);
 const memory=unwrap(f.core.get({namespace:threadNamespace,memoryId:ids.at(-1)})).memory;
 unwrap(f.core.forget({namespace:threadNamespace,memoryId:memory.id,expectedRevision:memory.revision}));
 const retracted=await f.read({maxItems:1});
 const previous=retracted.metered.items.find(item=>item.metadata?.thread?.status==='current')??retracted.metered.items[0];
 return {changes,latest,markedCurrent:current.length===1,retracted:previous?.body===chainText(changes-1),members:pack.metered.items.length,
  dated:pack.metered.items.every(item=>item.metadata.thread.eventTime===chainDate(Number(item.body.match(/value (\d+)/)[1])))};
}
