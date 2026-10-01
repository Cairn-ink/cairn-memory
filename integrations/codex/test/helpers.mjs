import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { createRuntimeGuard } from '../../client/runtime-usage.mjs';
import { cursorPath, readCursor } from '../cursor.mjs';

export const session='11111111-1111-4111-8111-111111111111';
export const timestamp='2026-09-30T00:00:00.000Z';
export const jsonl = row => JSON.stringify({timestamp,...row})+'\n';
export const header = (overrides={}) => jsonl({type:'session_meta',payload:{
  session_id:session,id:session,timestamp,cwd:'/synthetic/CWD_CANARY',originator:'codex_cli_rs',
  cli_version:'0.157.1',source:'exec',model_provider:'synthetic',base_instructions:{text:'INSTRUCTIONS_CANARY'},
  history_mode:'paginated',...overrides}});
export const item = (text,id=0,role='user',extras={}) => jsonl({type:'event_msg',payload:{
  type:'item_completed',thread_id:session,turn_id:'synthetic-turn',started_at_ms:0,completed_at_ms:1,
  item:{type:role==='user'?'UserMessage':'AgentMessage',id:`item-${id}`,
    content:[{type:role==='user'?'text':'Text',text,...(role==='user'?{text_elements:[]}: {})}],...extras}}});

export async function fixture(t, {text=header(),cap=10000,mode='api-key'}={}) {
  const ws=createTestWorkspace(t,{prefix:'cx3-'});
  const home=join(ws.path,'home'); await mkdir(home,{mode:0o700});
  const root=join(home,'state'); await mkdir(root,{mode:0o700});
  const path=join(ws.path,'synthetic-rollout.jsonl'); await writeFile(path,text);
  const binding={root,path,targetId:'a'.repeat(64),projectId:'b'.repeat(64),sessionId:session};
  const guard=createRuntimeGuard({root,targetId:binding.targetId,mode,dailyCap:cap});
  const receiver=new Map(), calls=[];
  let failure=null, count=0;
  const transport={terminated:()=>true,capture:async body=>{
    calls.push(structuredClone(body)); count++;
    if (failure?.at===count && failure.kind!=='lost') {
      if(failure.kind==='timeout') throw new Error('synthetic timeout');
      if(failure.kind==='processing') return {status:'processing',eventId:body.event_id};
      if(failure.kind==='refusal') return {status:'refused',code:'quota_reached'};
      return {status:'complete',eventId:'wrong'};
    }
    const duplicate=receiver.has(body.event_id);
    if (duplicate && JSON.stringify(receiver.get(body.event_id))!==JSON.stringify(body)) throw new Error('changed replay');
    receiver.set(body.event_id,structuredClone(body));
    if(failure?.at===count && failure.kind==='lost') throw new Error('lost reply');
    return {status:duplicate?'duplicate':'complete',eventId:body.event_id};
  }};
  return {ws,home,root,path,binding,guard,transport,calls,receiver,
    fail:(kind,at=1)=>{failure={kind,at};count=0;},clear:()=>{failure=null;count=0;},
    cursor:()=>readCursor(cursorPath(root,binding.targetId,session)),
    stateBytes:()=>readFile(cursorPath(root,binding.targetId,session),'utf8')};
}
