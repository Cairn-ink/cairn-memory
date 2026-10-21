import { createHmac } from 'node:crypto';
import { utcInstant } from '../hosted-contract.mjs';
import { PROFILE, closed, integer, identifier, freeze, refuse, sourceFailure, budget, settings, sourceReader } from './bounds.mjs';
import { scratch, SCRATCH_BUFFER_BYTES } from './scratch.mjs';
import { parseRecord } from './json-stream.mjs';
import { selection } from './selection.mjs';
import { claudePolicy, selectClaude } from './claude.mjs';
import { codexPolicy, checkCodexHeader, codexMessageId } from './codex.mjs';
import { redact } from './redact.mjs';

const messages = new WeakMap();
const generation = value => identifier(value,71) && /^(?:initial|[a-f0-9-]{36}|legacy-[a-f0-9]{64})$/.test(value);
export const keyed = (key,purpose,value) => createHmac('sha256',key).update(JSON.stringify([PROFILE,purpose,value]));
export function privateMessage(handle) {
  const result = messages.get(handle); if (!result || result.closed) refuse('raw_source_unavailable'); return result;
}
function snapshot(input,options) {
  if (!closed(input,['source','range','client','sessionId','wireSessionId','generation','epoch','messageOrdinal','selectionState','formatAuthority']) ||
    !closed(options,['identityKey','limits','signal']) || !(options.identityKey instanceof Uint8Array) || options.identityKey.byteLength!==32 ||
    !['claude-code','codex'].includes(input.client) || !identifier(input.sessionId) || !identifier(input.wireSessionId) ||
    !generation(input.generation) || !integer(input.epoch) || !integer(input.messageOrdinal,1) ||
    !closed(input.range,['start','end']) || !integer(input.range.start) || !integer(input.range.end,input.range.start+1)) refuse();
  if (input.client==='claude-code') {
    if (!closed(input.selectionState,['ownSkillTurn','pluginRoot']) || typeof input.selectionState.ownSkillTurn!=='boolean' ||
      !identifier(input.selectionState.pluginRoot,8192) || input.formatAuthority!==null) refuse();
  } else if (!closed(input.selectionState,[]) || !closed(input.formatAuthority,['format','sessionId','creatorVersion','qualifiedCreatorVersion']) ||
    !identifier(input.formatAuthority.format) || !identifier(input.formatAuthority.sessionId) || !identifier(input.formatAuthority.creatorVersion,100) ||
    input.formatAuthority.qualifiedCreatorVersion!==null && !identifier(input.formatAuthority.qualifiedCreatorVersion,100)) refuse();
  // Trusted bindings are a closed DTO: caller property order is not source identity.
  const binding = { range:{ start:input.range.start,end:input.range.end },client:input.client,
    sessionId:input.sessionId,wireSessionId:input.wireSessionId,generation:input.generation,
    epoch:input.epoch,messageOrdinal:input.messageOrdinal,
    selectionState:input.client==='claude-code' ? { ownSkillTurn:input.selectionState.ownSkillTurn,pluginRoot:input.selectionState.pluginRoot }: {},
    formatAuthority:input.client==='codex' ? { format:input.formatAuthority.format,sessionId:input.formatAuthority.sessionId,
      creatorVersion:input.formatAuthority.creatorVersion,qualifiedCreatorVersion:input.formatAuthority.qualifiedCreatorVersion }:null };
  return { source:input.source,binding:freeze(binding),key:Buffer.from(options.identityKey),
    state:budget(settings(options.limits),options.signal) };
}

async function verifySource(read,binding,key,state,expected) {
  const check = keyed(key,'source',binding);
  for (let at=binding.range.start;at<binding.range.end;) {
    const bytes = await read(at,Math.min(state.limits.bufferBytes,binding.range.end-at)); check.update(bytes); at += bytes.length;
  }
  if (expected!==check.digest('hex')) refuse('raw_source_changed');
  state.check();
}

// Recheck the exact canonical source binding without reparsing or retaining
// source text. Publication callers supply the original pre-record selection.
export async function verifyRawRecordSource(input,options,expectedSourceIdentity) {
  let copied;
  try { copied = snapshot(input,options); } catch { refuse(); }
  const { source,binding,key,state } = copied;
  try {
    if (typeof expectedSourceIdentity!=='string' || !/^[a-f0-9]{64}$/.test(expectedSourceIdentity)) refuse();
    const read = sourceReader(source,state);
    if (binding.client==='codex') await checkCodexHeader(read,binding,state);
    await verifySource(read,binding,key,state,expectedSourceIdentity);
    return true;
  } catch (error) { sourceFailure(error); }
  finally { key.fill(0); }
}

export async function prepareRawRecord(input,options) {
  let copied;
  try { copied = snapshot(input,options); } catch (error) { if (error.code==='raw_source_invalid') throw error; refuse(); }
  const { source,binding,key,state } = copied;
  let transferred = false, owner;
  try {
    state.metadata(Buffer.byteLength(JSON.stringify(binding)));
    const read = sourceReader(source,state);
    owner = await scratch(state);
    if (binding.client==='codex') await checkCodexHeader(read,binding,state);
    const policy = binding.client==='claude-code' ? claudePolicy():codexPolicy();
    const selected = selection(owner,binding,state,policy); await selected.init();
    const hash = keyed(key,'source',binding);
    await parseRecord(read,binding.range,state,selected.visitor,bytes => hash.update(bytes));
    const view = await selected.finish();
    const result = binding.client==='claude-code' ? await selectClaude(view,binding,state):policy.select(view,binding);
    const sourceIdentity = hash.digest('hex');
    if (result.reason) {
      await verifySource(read,binding,key,state,sourceIdentity);
      return freeze({ disposition:'excluded',reason:result.reason,nextSelectionState:result.nextSelectionState,sourceIdentity });
    }
    const file = await redact(view.file,owner,state);
    const content = keyed(key,'content',{ client:binding.client,role:result.role });
    let totalBytes = 0;
    for (let at=0;at<file.units;) {
      let end = Math.min(file.units,at+SCRATCH_BUFFER_BYTES/2);
      if (end<file.units) {
        const last = (await file.bytes((end-1)*2,end*2)).readUInt16LE(0);
        if (last>=0xD800 && last<=0xDBFF) end--;
      }
      const bytes = Buffer.from((await file.bytes(at*2,end*2)).toString('utf16le'),'utf8');
      content.update(bytes); totalBytes += bytes.length; at = end;
    }
    await verifySource(read,binding,key,state,sourceIdentity);
    const uuid = view.fields.get('uuid'), uuidKind = view.kinds.get('uuid');
    if (binding.client==='claude-code' && uuidKind!==undefined && uuid!==null && uuid!=='' && !identifier(uuid)) refuse();
    const id = binding.client==='codex' ? codexMessageId(binding):identifier(uuid) ? uuid:
      'raw2_'+keyed(key,'message',[binding.client,binding.sessionId,binding.wireSessionId,binding.range]).digest('hex');
    const time = view.fields.get('timestamp');
    if (view.kinds.has('timestamp') && time!==null && (!utcInstant(time) || time.trim()!==time)) refuse();
    const metadata = freeze({ id,role:result.role,occurredAt:time==null ? null:new Date(time).toISOString(),
      messageOrdinal:binding.messageOrdinal,totalUnits:file.units,totalBytes,sourceIdentity,contentIdentity:content.digest('hex') });
    const privateState = { binding,key,metadata,file,state,closed:false,position:{ index:0,start:0 } };
    const handle = Object.freeze({ metadata,
      async readPart(value) {
        return state.operation(async () => {
        privateMessage(handle);
        if (!closed(value,['start','maxUnits']) || !integer(value.start,0,file.units) || !integer(value.maxUnits,1,4000)) refuse();
        const start = value.start;
        if (start<file.units && start>0) {
          const first = (await file.bytes(start*2,(start+1)*2)).readUInt16LE(0);
          if (first>=0xDC00 && first<=0xDFFF) refuse();
        }
        let end = Math.min(file.units,start+value.maxUnits);
        if (end<file.units && end>start) {
          const last = (await file.bytes((end-1)*2,end*2)).readUInt16LE(0);
          if (last>=0xD800 && last<=0xDBFF) end--;
        }
        if (end===start && start<file.units) refuse('raw_source_resource_limit');
        const text = (await file.bytes(start*2,end*2)).toString('utf16le'); state.check();
        return Object.freeze({ start,end,text });
        }).catch(sourceFailure);
      },
      async close() {
        if (privateState.closed) return; privateState.closed = true; key.fill(0);
        try { await owner.close(); } catch (error) { sourceFailure(error); }
      },
    });
    messages.set(handle,privateState); state.check(); transferred = true;
    return Object.freeze({ disposition:'selected',message:handle,nextSelectionState:freeze(result.nextSelectionState) });
  } catch (error) { sourceFailure(error); }
  finally {
    if (!transferred) { key.fill(0); try { await owner?.close(); } catch (error) { sourceFailure(error); } }
  }
}
