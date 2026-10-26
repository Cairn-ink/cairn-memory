import { isDeepStrictEqual } from 'node:util';
import { PROFILE, closed, integer, identifier, freeze, refuse } from './bounds.mjs';
import { utcInstant } from '../hosted-contract.mjs';
import { privateMessage, keyed } from './message.mjs';
import { project, validateRawRequest } from './protocol.mjs';

const invalid = () => refuse('invalid_capture_v2');
const pendingFields = ['version','profile','client','sessionId','wireSessionId','projectId','generation','epoch','range','messageOrdinal',
  'messageId','role','occurredAt','sourceIdentity','contentIdentity','totalUnits','totalBytes','part','eventId'];

async function canonicalPosition(message,position) {
  if (!closed(position,['index','start']) || !integer(position.index) || !integer(position.start)) invalid();
  const { metadata,position:cached } = privateMessage(message);
  let start = position.index>=cached.index ? cached.start:0, index = position.index>=cached.index ? cached.index:0;
  if (position.index>metadata.totalUnits || position.start>=metadata.totalUnits) invalid();
  while (index<position.index) {
    const part = await message.readPart({ start,maxUnits:4000 }); start = part.end; index++;
    if (start>=metadata.totalUnits) invalid();
  }
  if (start!==position.start) invalid();
}

export async function planRawBatch(input) {
  if (!closed(input,['message','projectId','position']) || !project(input.projectId)) invalid();
  const { message,projectId } = input, position = { ...input.position };
  const privateState = privateMessage(message), { binding,key,metadata,state } = privateState;
  return state.operation(async () => {
  await canonicalPosition(message,position);
  const part = await message.readPart({ start:position.start,maxUnits:4000 });
  const pending = { version:1,profile:PROFILE,client:binding.client,sessionId:binding.sessionId,wireSessionId:binding.wireSessionId,
    projectId,generation:binding.generation,epoch:binding.epoch,range:{ ...binding.range },messageOrdinal:metadata.messageOrdinal,
    messageId:metadata.id,role:metadata.role,occurredAt:metadata.occurredAt,sourceIdentity:metadata.sourceIdentity,
    contentIdentity:metadata.contentIdentity,totalUnits:metadata.totalUnits,totalBytes:metadata.totalBytes,
    part:{ index:position.index,start:part.start,end:part.end } };
  const eventId = keyed(key,'event',pending).digest('hex'); pending.eventId = eventId;
  const body = validateRawRequest({ version:2,client:binding.client,event_id:eventId,session_id:binding.wireSessionId,
    ...(projectId===null ? {}:{ project_id:projectId }),messages:[{ id:metadata.id,role:metadata.role,occurred_at:metadata.occurredAt,
      message_ordinal:metadata.messageOrdinal,content:part.text,part:{ index:position.index,start:part.start,totalUnits:metadata.totalUnits,totalBytes:metadata.totalBytes } }] });
  const nextPosition = part.end===metadata.totalUnits ? null:{ index:position.index+1,start:part.end };
  privateState.position = nextPosition ?? position;
  return freeze({ body,pending,nextPosition });
  });
}

export async function restoreRawBatch(input) {
  if (!closed(input,['message','projectId','pending'])) invalid();
  let pending = input.pending;
  if (!closed(pending,pendingFields) || Object.keys(pending).length!==pendingFields.length || !closed(pending.range,['start','end']) ||
    !closed(pending.part,['index','start','end']) || Object.keys(pending.part).length!==3 || pending.version!==1 || pending.profile!==PROFILE ||
    !integer(pending.range.start) || !integer(pending.range.end,pending.range.start+1) || Object.keys(pending.range).length!==2 ||
    !['claude-code','codex'].includes(pending.client) || !identifier(pending.sessionId) || !identifier(pending.wireSessionId) ||
    !identifier(pending.messageId) || !['user','assistant'].includes(pending.role) || !integer(pending.epoch) || !integer(pending.messageOrdinal,1) ||
    !identifier(pending.generation,71) || !/^(?:initial|[a-f0-9-]{36}|legacy-[a-f0-9]{64})$/.test(pending.generation) ||
    pending.occurredAt!==null && (!utcInstant(pending.occurredAt) || new Date(pending.occurredAt).toISOString()!==pending.occurredAt) ||
    !integer(pending.totalUnits,1) || !integer(pending.totalBytes,1) ||
    !integer(pending.part.index) || !integer(pending.part.start) || !integer(pending.part.end,pending.part.start+1,pending.totalUnits) ||
    pending.part.end-pending.part.start>4000 || pending.part.index===0 && pending.part.start!==0 || pending.part.index>0 && pending.part.start===0 ||
    typeof pending.eventId!=='string' || pending.eventId.length!==64 || !/^[a-f0-9]{64}$/.test(pending.eventId) ||
    !project(pending.projectId) || typeof pending.sourceIdentity!=='string' || pending.sourceIdentity.length!==64 || !/^[a-f0-9]{64}$/.test(pending.sourceIdentity) ||
    typeof pending.contentIdentity!=='string' || pending.contentIdentity.length!==64 || !/^[a-f0-9]{64}$/.test(pending.contentIdentity)) invalid();
  try { pending = structuredClone(pending); } catch { invalid(); }
  const { metadata,state } = privateMessage(input.message);
  return state.operation(async () => {
  if (pending.sourceIdentity!==metadata.sourceIdentity || pending.contentIdentity!==metadata.contentIdentity) refuse('raw_source_changed');
  const result = await planRawBatch({ message:input.message,projectId:input.projectId,position:{ index:pending.part.index,start:pending.part.start } });
  if (!isDeepStrictEqual(result.pending,pending)) refuse('raw_source_changed');
  return result;
  });
}
