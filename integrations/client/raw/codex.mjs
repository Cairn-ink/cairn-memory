import { FORMAT, verifyHeader } from '../../codex/parser.mjs';
import { hash, PROFILE } from '../common-profile.mjs';
import { refuse } from './bounds.mjs';

const tops = new Set(['session_meta','response_item','inter_agent_communication','inter_agent_communication_metadata','compacted',
  'turn_context','token_usage_record','world_state','retained_context','security_risk_score','event_msg','realtime_item']);
const events = new Set(['item_completed','task_started','turn_started','task_complete','turn_complete','token_count','thread_settings_applied',
  'thread_goal_updated','thread_rolled_back','turn_aborted','user_message','agent_message','agent_reasoning','agent_reasoning_raw_content',
  'context_compacted','item_started','agent_message_content_delta','hook_started','hook_completed','error','warning','turn_moderation_metadata']);
const items = new Set(['UserMessage','FunctionCallOutput','HookPrompt','AgentMessage','Plan','Reasoning','CommandExecution','DynamicToolCall',
  'CollabAgentToolCall','SubAgentActivity','WebSearch','ImageView','Extension','ImageGeneration','EnteredReviewMode','ExitedReviewMode',
  'FileChange','McpToolCall','ContextCompaction']);
const phases = new Set(['commentary','partial_answer','final_answer']);
const attachments = new Set(['image','local_image','audio','local_audio','skill','mention']);

export function codexPolicy() {
  let userBad = false, assistantBad = false;
  return { paths:new Set(['type','timestamp','payload','payload.type','payload.thread_id','payload.turn_id','payload.item',
    'payload.item.type','payload.item.id','payload.item.phase','payload.item.content']),
    closed:new Map([
      ['', ['timestamp','ordinal','type','payload','metadata']],
      ['payload',['type','thread_id','turn_id','item','started_at_ms','completed_at_ms']],
      ['payload.item',['type','id','client_id','content','phase','memory_citation','delivery','questions']],
    ]),
    block(block) {
      const keys = [...block.keys];
      if (block.type==='text') userBad ||= block.kind!=='object' || !block.hasText || block.invalidText || block.invalidRich || keys.some(key => !['type','text','text_elements'].includes(key));
      else if (!attachments.has(block.type)) userBad = true;
      if (block.type==='Text') assistantBad ||= block.kind!=='object' || !block.hasText || block.invalidText || keys.some(key => !['type','text'].includes(key));
      else assistantBad = true;
    },
    select(view,input) {
      const get = key => view.fields.get(key), kind = key => view.kinds.get(key);
      const result = (reason,role) => ({ reason,role,nextSelectionState:{} });
      if (kind('')!=='object' || view.unknown.has('') || !tops.has(get('type')) || kind('payload')!=='object') refuse('unsupported_format');
      if (get('type')!=='event_msg') return result('non_conversation');
      if (!events.has(get('payload.type'))) refuse('unsupported_format');
      const phase = get('payload.item.phase');
      if (get('payload.type')==='item_started' && get('payload.item.type')==='AgentMessage' && phase!=null && !phases.has(phase)) refuse('unsupported_format');
      if (get('payload.type')!=='item_completed') return result('non_conversation');
      if (view.unknown.has('payload') || get('payload.thread_id')!==input.sessionId || kind('payload.turn_id')!=='string' || !items.has(get('payload.item.type'))) refuse('unsupported_format');
      const type = get('payload.item.type'), user = type==='UserMessage';
      if (!user && type!=='AgentMessage') return result('non_conversation');
      const forbidden = user ? ['phase','memory_citation','delivery','questions']:['client_id'];
      if (view.unknown.has('payload.item') || kind('payload.item.id')!=='string' || kind('payload.item.content')!=='array' ||
        forbidden.some(key => view.present.has('payload.item.'+key)) ||
        user && userBad || !user && (assistantBad || phase!=null && !phases.has(phase))) refuse('unsupported_format');
      if (user && view.rich) return result('rich_input');
      return result(view.file.units ? null:'empty_text',user ? 'user':'assistant');
    },
  };
}

export async function checkCodexHeader(read,input,state) {
  const descriptor = input.formatAuthority;
  let position = 0, count = 0;
  const buffer = Buffer.alloc(state.limits.metadataByteLimit);
  while (true) {
    const bytes = await read(position,Math.min(state.limits.bufferBytes,state.limits.metadataByteLimit-count+1));
    const newline = bytes.indexOf(10), selected = newline<0 ? bytes:bytes.subarray(0,newline);
    if (count+selected.length>state.limits.metadataByteLimit) refuse('raw_source_resource_limit');
    selected.copy(buffer,count); count += selected.length; position += bytes.length;
    if (newline>=0) break;
  }
  state.metadata(count);
  const header = buffer.subarray(0,count); let format, row;
  try {
    format = verifyHeader(header,input.sessionId,{ qualifiedCreatorVersion:descriptor.qualifiedCreatorVersion ?? undefined });
    row = JSON.parse(new TextDecoder('utf-8',{ fatal:true }).decode(header));
  } catch (error) { refuse(error.message==='creator_unqualified' ? 'creator_unqualified':'unsupported_format'); }
  if (descriptor.format!==FORMAT || descriptor.format!==format || descriptor.sessionId!==input.sessionId || descriptor.creatorVersion!==row.payload.cli_version) refuse('unsupported_format');
}
export const codexMessageId = input => hash(PROFILE,'codex',input.wireSessionId,input.epoch,input.range.start,input.range.end);
