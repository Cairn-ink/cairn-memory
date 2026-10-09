import { normalizeBlocks, hash, PROFILE } from '../client/common-profile.mjs';

export const CODEX_COMMIT = '36650394c5b38c2990ccf2a3457165ca3e9d9726';
export const FORMAT = 'codex-0.157.1-paginated-v1';
// Seed versions have frozen native format evidence. Other hosts require a
// binary-identity verdict; a version string never widens the parser by itself.
export const QUALIFIED_CREATORS = Object.freeze(['0.157.1', '0.160.1', '0.161.0', '0.162.0']);
export const MAX_READ = 1048576, MAX_LINE = 262144;
const tops = new Set(['session_meta','response_item','inter_agent_communication',
  'inter_agent_communication_metadata','compacted','turn_context','token_usage_record',
  'world_state','retained_context','security_risk_score','event_msg','realtime_item']);
const items = new Set(['UserMessage','FunctionCallOutput','HookPrompt','AgentMessage','Plan',
  'Reasoning','CommandExecution','DynamicToolCall','CollabAgentToolCall','SubAgentActivity',
  'WebSearch','ImageView','Extension','ImageGeneration','EnteredReviewMode','ExitedReviewMode',
  'FileChange','McpToolCall','ContextCompaction']);
const events = new Set(['item_completed','task_started','turn_started','task_complete','turn_complete',
  'token_count','thread_settings_applied','thread_goal_updated','thread_rolled_back','turn_aborted',
  'user_message','agent_message','agent_reasoning','agent_reasoning_raw_content','context_compacted',
  'item_started','agent_message_content_delta','hook_started','hook_completed',
  'error','warning','turn_moderation_metadata']);
const keys = (value, allowed) => value && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).every(k => allowed.includes(k));
const unsupported = () => { throw new Error('unsupported_format'); };

// Header evidence selects one layout. No fallback to user-role response_item.
export function verifyHeader(line, sessionId, { qualifiedCreatorVersion } = {}) {
  let row;
  try { row = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(line)); }
  catch { unsupported(); }
  const meta = row?.payload;
  if (row.type !== 'session_meta' || typeof meta?.cli_version !== 'string' ||
      !/^\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.-]+)?$/u.test(meta.cli_version) || meta.cli_version.length > 100 ||
      meta.history_mode !== 'paginated' || meta.id !== sessionId ||
      !['cli','exec'].includes(meta.source) || meta.history_base != null ||
      meta.forked_from_id != null || meta.parent_thread_id != null ||
      meta.subagent_history_start_ordinal != null ||
      (meta.thread_source != null && meta.thread_source !== 'user')) unsupported();
  if (!QUALIFIED_CREATORS.includes(meta.cli_version) && meta.cli_version !== qualifiedCreatorVersion) {
    const error = new Error('creator_unqualified'); error.version = meta.cli_version; throw error;
  }
  return FORMAT;
}

export function parseLine(bytes, { sessionId, wireSessionId, epoch, start, end }) {
  let row;
  try { row = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { return { start, end, reason: 'malformed' }; }
  if (!keys(row, ['timestamp','ordinal','type','payload','metadata']) || !tops.has(row.type) ||
      !row.payload || typeof row.payload !== 'object') unsupported();
  const excluded = reason => ({ start, end, reason });
  if (row.type !== 'event_msg') return excluded('non_conversation');
  const p = row.payload;
  if (!events.has(p.type)) unsupported();
  // Phase classifies a message, not its streaming completion. The 0.162.0
  // searchOccurrences SQL unions partial items with the turn final item.
  // Capture only item_completed; mirrors, starts and deltas remain excluded.
  if (p.type === 'item_started' && p.item?.type === 'AgentMessage' &&
      p.item.phase != null && !['commentary','partial_answer','final_answer'].includes(p.item.phase)) unsupported();
  if (p.type !== 'item_completed') return excluded('non_conversation');
  if (!keys(p, ['type','thread_id','turn_id','item','started_at_ms','completed_at_ms']) ||
      p.thread_id !== sessionId || typeof p.turn_id !== 'string' || !items.has(p.item?.type)) unsupported();
  const item = p.item;
  if (!['UserMessage','AgentMessage'].includes(item.type)) return excluded('non_conversation');
  const user = item.type === 'UserMessage';
  if (!keys(item, user ? ['type','id','client_id','content'] :
      ['type','id','content','phase','memory_citation','delivery','questions']) ||
      typeof item.id !== 'string' || !Array.isArray(item.content)) unsupported();
  if (!user && item.phase != null && !['commentary','partial_answer','final_answer'].includes(item.phase)) unsupported();
  const texts = [];
  for (const part of item.content) {
    if (part?.type === (user ? 'text' : 'Text')) {
      if (!keys(part, user ? ['type','text','text_elements'] : ['type','text']) || typeof part.text !== 'string') unsupported();
      if (user && part.text_elements!==undefined && !Array.isArray(part.text_elements)) unsupported();
      // Rich markers/attachments have not been qualified; exclude their whole record.
      if (user && part.text_elements?.length) return excluded('rich_input');
      texts.push(part.text);
    } else if (user && ['image','local_image','audio','local_audio','skill','mention'].includes(part?.type)) {
      continue;
    } else unsupported();
  }
  const clean = normalizeBlocks(texts);
  if (clean.reason) return excluded(clean.reason);
  return { start, end, ...clean, message: { id: hash(PROFILE,'codex',wireSessionId,epoch,start,end),
    role: user ? 'user' : 'assistant', content: clean.content } };
}
