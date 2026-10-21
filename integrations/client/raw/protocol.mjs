import { closed, integer, identifier, freeze, refuse } from './bounds.mjs';
import { utcInstant } from '../hosted-contract.mjs';

const requestError = () => refuse('invalid_capture_v2');
const acknowledgementError = () => refuse('invalid_capture_ack');
const dense = (value,min,max) => Array.isArray(value) && integer(value.length,min,max) && Object.keys(value).length===value.length &&
  Array.from({ length:value.length },(_,index) => Object.hasOwn(value,index)).every(Boolean);
const text = value => typeof value==='string' && value.isWellFormed() && !value.includes('\0');
const canonicalTime = value => value===null || typeof value==='string' && utcInstant(value) && new Date(value).toISOString()===value;
export const project = value => value===null || identifier(value,128) && value.length>=16;
const reasons = new Set(['tool_off','notice_required','quota_reached','raw_disabled','capture_barrier']);

export function validateRawRequest(input) {
  if (!closed(input,['version','client','event_id','session_id','project_id','messages']) || input.version!==2 ||
    !['claude-code','codex'].includes(input.client) || !identifier(input.event_id) || !identifier(input.session_id) ||
    Object.hasOwn(input,'project_id') && (input.project_id===null || !project(input.project_id)) || !dense(input.messages,1,24)) requestError();
  const ids = new Set(); let units = 0, ordinal = 0;
  for (const message of input.messages) {
    if (!closed(message,['id','role','occurred_at','message_ordinal','content','part']) || !identifier(message.id) || ids.has(message.id) ||
      !['user','assistant'].includes(message.role) || !Object.hasOwn(message,'occurred_at') || !canonicalTime(message.occurred_at) ||
      !integer(message.message_ordinal,ordinal+1) || !text(message.content) || !integer(message.content.length,1,4000) ||
      !closed(message.part,['index','start','totalUnits','totalBytes'])) requestError();
    ids.add(message.id); units += message.content.length; ordinal = message.message_ordinal;
    const { index,start,totalUnits,totalBytes } = message.part;
    if (!integer(index) || !integer(start) || !integer(totalUnits,1) || !integer(totalBytes,1) ||
      !integer(start+message.content.length,1,totalUnits) || index===0 && start!==0 || index>0 && start===0 ||
      Buffer.byteLength(message.content)>totalBytes ||
      start+message.content.length===totalUnits && start===0 && Buffer.byteLength(message.content)!==totalBytes) requestError();
  }
  if (units>20000 || Buffer.byteLength(JSON.stringify(input))>65536) requestError();
  return freeze(structuredClone(input));
}

export function classifyRawAcknowledgement(status,input,frozenRequest) {
  let request;
  try { request = validateRawRequest(frozenRequest); } catch { acknowledgementError(); }
  if (!integer(status,100,599)) acknowledgementError();
  const decision = disposition => Object.freeze({ disposition });
  if (status===429) {
    if (!closed(input,['error','resetAt']) || input.error!=='quota_reached' || Object.hasOwn(input,'resetAt') &&
      (typeof input.resetAt!=='string' || input.resetAt.length>65500 || !utcInstant(input.resetAt))) acknowledgementError();
    return decision('quota_reached');
  }
  if (![200,202].includes(status)) return decision('refused');
  if (!closed(input,['version','duplicate','memoryCount','raw','processing']) || input.version!==2 || typeof input.duplicate!=='boolean' ||
    !integer(input.memoryCount) || Object.hasOwn(input,'processing') && typeof input.processing!=='boolean' ||
    !closed(input.raw,['conversationId','revision','parts']) || !identifier(input.raw.conversationId) || !integer(input.raw.revision,1) ||
    !dense(input.raw.parts,request.messages.length,request.messages.length)) acknowledgementError();
  const outstanding = new Map(request.messages.map(message => [message.id,message.part.index]));
  for (const part of input.raw.parts) {
    if (!closed(part,['messageId','index','saved','reason']) || !identifier(part.messageId) || !integer(part.index) ||
      outstanding.get(part.messageId)!==part.index || typeof part.saved!=='boolean' ||
      (part.saved ? part.reason!==null:!reasons.has(part.reason))) acknowledgementError();
    outstanding.delete(part.messageId);
  }
  if (outstanding.size || status===202 && input.processing!==true) acknowledgementError();
  return decision(input.processing ? 'processing':'complete');
}
