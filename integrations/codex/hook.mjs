import { isAbsolute } from 'node:path';
import { resolveClient, clientProjectId } from '../client/pairing.mjs';
import { readControlState } from '../client/control-state.mjs';
import { prepareCapture, runWorker, establishPauseBoundary } from './worker.mjs';
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
 * No transport is enabled here. Context and model calls remain unavailable.
 */
export async function handleHook(input,{clientOptions,targetId,launch,now=Date.now}={}) {
  const start=now();
  let event=input?.hook_event_name;
  const output=()=> ['Stop','PreCompact','SessionEnd'].includes(event)?'{}':'';
  try {
    const hook=validateHook(input); event=hook.event;
    if (!clientOptions || !launch || !/^[a-f0-9]{64}$/.test(targetId)) return {output:output(),status:'transport_unavailable'};
    const options={...clientOptions,client:'codex'};
    const resolved=await resolveClient(options);
    if (!resolved.enabled) return {output:output(),status:resolved.status};
    const control=await readControlState(resolved.root);
    if (control.paused) return {output:output(),status:'paused'};
    if (hook.path===null) return {output:output(),status:'source_unavailable'};
    if (event==='UserPromptSubmit') return {output:'',status:'context_unavailable'};
    const projectId=await clientProjectId(options,hook.cwd);
    const binding={root:resolved.root,targetId,projectId,sessionId:hook.sessionId,path:hook.path};
    if (event==='SessionStart') return {output:'',status:(await establishPauseBoundary(binding)).status};
    const prepared=await prepareCapture(binding);
    if (prepared.status!=='pending' || now()-start>=750) return {output:output(),status:prepared.status};
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
