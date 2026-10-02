import { isAbsolute } from 'node:path';
import { resolveClient, clientProjectId } from '../client/pairing.mjs';
import { readControlState, startIfActive } from '../client/control-state.mjs';
import { prepareCapture, runWorker, establishPauseBoundary, wireSessionId } from './worker.mjs';
import { FORMAT } from './parser.mjs';

const EVENTS = new Set(['SessionStart','UserPromptSubmit','Stop','PreCompact','SessionEnd']);
export function validateHook(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || !EVENTS.has(input.hook_event_name) ||
      typeof input.session_id !== 'string' || !input.session_id || input.session_id.length>200 ||
      !input.session_id.isWellFormed() || /[\x00-\x1f\x7f]/u.test(input.session_id) ||
      typeof input.cwd !== 'string' || !isAbsolute(input.cwd) || input.cwd.length>8192 ||
      input.cwd.includes('\0') || (input.transcript_path !== null &&
        (typeof input.transcript_path !== 'string' || !isAbsolute(input.transcript_path) ||
          input.transcript_path.length>8192 || input.transcript_path.includes('\0'))))
    throw new Error('invalid_hook_input');
  return {event:input.hook_event_name,sessionId:input.session_id,cwd:input.cwd,path:input.transcript_path};
}
export async function readHookInput(stream,{limit=65536,deadlineMs=750}={}) {
  return new Promise((resolve,reject)=>{
    let bytes=0, chunks=[];
    const finish=(error,value)=>{
      clearTimeout(timer); stream.off('data',data); stream.off('end',end); stream.off('error',fail);
      stream.pause(); error?reject(error):resolve(value);
    };
    const fail=()=>finish(new Error('invalid_hook_input'));
    const data=chunk=>{bytes+=chunk.length; if(bytes>limit) fail(); else chunks.push(chunk);};
    const end=()=>{try {finish(null,JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks))));} catch {fail();}};
    const timer=setTimeout(fail,deadlineMs);
    stream.on('data',data); stream.once('end',end); stream.once('error',fail);
  });
}

/** The installed launcher owns fixed config and a closed direct-pipe launch callback.
 * SessionStart accepts an optional installation-owned read port. Context
 * injection and model calls remain unavailable; no credentials are read here.
 */
export async function handleHook(input,{clientOptions,targetId,launch,sessionStart,now=Date.now}={}) {
  const start=now();
  const budget=['SessionStart','UserPromptSubmit'].includes(input?.hook_event_name)?2500:750;
  let expired=false,timer;
  const abort = new AbortController();
  const unavailable={output:['Stop','PreCompact','SessionEnd'].includes(input?.hook_event_name)?'{}':'',status:'capture_unavailable'};
  try {
    return await Promise.race([processHook(input,{clientOptions,targetId,launch,sessionStart},
      ()=>expired || now()-start>=budget, abort.signal),new Promise(resolve=>{
      timer=setTimeout(()=>{expired=true;abort.abort();resolve(unavailable);},budget);
    })]);
  } finally {clearTimeout(timer);abort.abort();}
}

async function processHook(input,{clientOptions,targetId,launch,sessionStart},expired,signal) {
  let event=input?.hook_event_name;
  const output=()=> ['Stop','PreCompact','SessionEnd'].includes(event)?'{}':'';
  try {
    const hook=validateHook(input); event=hook.event;
    if (!clientOptions || (!launch && !(event==='SessionStart' && typeof sessionStart==='function')) ||
        !/^[a-f0-9]{64}$/.test(targetId)) return {output:output(),status:'transport_unavailable'};
    const options={...clientOptions,client:'codex'};
    const resolved=await resolveClient(options);
    if (!resolved.enabled) return {output:output(),status:resolved.status};
    if (expired()) return {output:output(),status:'capture_unavailable'};
    const control=await readControlState(resolved.root);
    if (control.paused) return {output:output(),status:'paused'};
    if (event==='SessionStart' && typeof sessionStart==='function') {
      // Preserve any needed capture boundary before the read; ephemeral hooks
      // have no transcript but still carry a host conversation/session id.
      if (hook.path!==null) {
        const projectId=await clientProjectId(options,hook.cwd);
        await establishPauseBoundary({root:resolved.root,targetId,projectId,sessionId:hook.sessionId,path:hook.path});
      }
      const dispatch=async start=>{
        if (expired()) throw new Error('dispatch_not_started');
        const started=await startIfActive(resolved.root,control.generation,start);
        if (!started.started) throw new Error('dispatch_not_started');
        return started.operation;
      };
      if (expired()) return {output:'',status:'capture_unavailable'};
      // Match capture's existing opaque wire id so a read in this very same
      // conversation cannot be counted as a different host conversation.
      const result=await sessionStart({version:1,session_id:wireSessionId(hook.sessionId)},{signal,dispatch});
      return {output:'',status:result?.status==='complete'?'complete':'context_unavailable'};
    }
    if (hook.path===null) return {output:output(),status:'source_unavailable'};
    if (event==='UserPromptSubmit') return {output:'',status:'context_unavailable'};
    const projectId=await clientProjectId(options,hook.cwd);
    if (expired()) return {output:output(),status:'capture_unavailable'};
    const binding={root:resolved.root,targetId,projectId,sessionId:hook.sessionId,path:hook.path};
    if (event==='SessionStart') return {output:'',status:(await establishPauseBoundary(binding)).status};
    const prepared=await prepareCapture(binding);
    if (prepared.status!=='pending' || expired()) return {output:output(),status:prepared.status};
    // serialize a closed, content-free handoff; never copy hook extras into it
    const handoff={client:'codex',parser:FORMAT,sessionId:hook.sessionId,path:hook.path,cwd:hook.cwd,
      generation:control.generation,byteEnd:prepared.state.pending.end,endIntent:event==='SessionEnd'};
    await launch(JSON.stringify(handoff),resolved.workerEnv);
    return {output:output(),status:'launched'};
  } catch { return {output:output(),status:'capture_unavailable'}; }
}

export async function workerFromHandoff(handoff,{clientOptions,targetId,transport,guard,...workerOptions}={}) {
  if (!handoff || Object.keys(handoff).some(k=>!['client','parser','sessionId','path','cwd',
      'generation','byteEnd','endIntent'].includes(k)) || handoff.client!=='codex' ||
      handoff.parser!==FORMAT || !Number.isSafeInteger(handoff.byteEnd) || handoff.byteEnd<0 ||
      typeof handoff.endIntent!=='boolean') throw new Error('invalid_handoff');
  const hook=validateHook({hook_event_name:'Stop',session_id:handoff.sessionId,cwd:handoff.cwd,transcript_path:handoff.path});
  const options={...clientOptions,client:'codex',worker:true};
  const resolved=await resolveClient(options);
  if(!resolved.enabled) return {status:resolved.status};
  const control=await readControlState(resolved.root);
  if(control.paused || handoff.generation!==control.generation) return {status:'paused'};
  const projectId=await clientProjectId(options,hook.cwd,resolved);
  return runWorker({root:resolved.root,targetId,projectId,sessionId:hook.sessionId,path:hook.path},
    {transport,guard,byteEnd:handoff.byteEnd,...workerOptions});
}
