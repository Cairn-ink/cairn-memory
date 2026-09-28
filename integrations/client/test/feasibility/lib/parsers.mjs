// Candidate allowlist parsers under test. They are harness evidence for F0,
// not the shipped CX-3 parser. Each returns { messages, excluded } where
// excluded counts reasons only, never text.
import { machineUserRecord } from '../../../../../plugins/cairn-memory/lib/transcript.mjs';

const count = (excluded, reason) => { excluded[reason] = (excluded[reason] ?? 0) + 1; };

function claudeRecord(record, excluded) {
  if (record?.type !== 'user' && record?.type !== 'assistant') return count(excluded, `type:${record?.type ?? 'none'}`);
  if (record.isSidechain) return count(excluded, 'sidechain');
  // Machine-generated user records use the released plugin's rule (0.1.1), so
  // the harness and the plugin exclude the same records.
  const machine = record.type === 'user' ? machineUserRecord(record) : null;
  if (machine) return count(excluded, machine);
  if (record.isVisibleInTranscriptOnly) return count(excluded, 'transcript-only');
  const message = record.message;
  if (message?.role !== record.type) return count(excluded, 'role-mismatch');
  if (record.type === 'assistant' && (message.model === '<synthetic>' || record.isApiErrorMessage)) {
    return count(excluded, 'synthetic-assistant');
  }
  const blocks = typeof message.content === 'string' ? [{ type: 'text', text: message.content }]
    : Array.isArray(message.content) ? message.content : [];
  const texts = [];
  for (const block of blocks) {
    if (block?.type !== 'text' || typeof block.text !== 'string') { count(excluded, `block:${block?.type ?? 'none'}`); continue; }
    texts.push(block.text);
  }
  const text = texts.join('\n').trim();
  if (!text) return count(excluded, 'empty');
  return { role: record.type, text, sourceId: typeof record.uuid === 'string' ? record.uuid : undefined };
}

// Codex 0.157.1: only event_msg/item_completed UserMessage text parts and
// AgentMessage Text parts are treated as conversation. response_item messages
// mirror them and also carry injected user-role AGENTS.md/environment text,
// hook developer context and Codex-generated image wrappers, so that whole
// family is excluded, as are reasoning, tool and metadata records.
function codexRecord(record, excluded) {
  const payload = record?.payload;
  if (record?.type !== 'event_msg' || payload?.type !== 'item_completed') {
    return count(excluded, `type:${record?.type ?? 'none'}${payload?.type ? `/${payload.type}` : ''}`);
  }
  const item = payload.item;
  const allowed = item?.type === 'UserMessage' ? ['user', 'text'] : item?.type === 'AgentMessage' ? ['assistant', 'Text'] : null;
  if (!allowed) return count(excluded, `item:${item?.type ?? 'none'}`);
  const [role, partType] = allowed;
  const texts = [];
  for (const part of Array.isArray(item.content) ? item.content : []) {
    if (part?.type === partType && typeof part.text === 'string') texts.push(part.text);
    else count(excluded, `part:${part?.type ?? 'none'}`);
  }
  const text = texts.join('\n').trim();
  return text ? { role, text, sourceId: typeof item.id === 'string' ? item.id : undefined } : count(excluded, 'empty');
}

const PARSERS = { claude: claudeRecord, codex: codexRecord };

/** Parse complete newline-terminated JSONL from a byte slice starting at `baseOffset`. */
export function parseTranscript(host, buffer, baseOffset) {
  const parse = PARSERS[host];
  if (!parse) throw new Error(`unsupported_host:${host}`);
  const messages = [];
  const excluded = {};
  let position = 0;
  while (position < buffer.length) {
    const newline = buffer.indexOf(0x0a, position);
    if (newline < 0) break;
    const line = buffer.subarray(position, newline).toString('utf8');
    const offset = baseOffset + position;
    position = newline + 1;
    if (!line.trim()) continue;
    let record;
    try { record = JSON.parse(line); } catch { count(excluded, 'malformed'); continue; }
    const message = parse(record, excluded);
    if (message) messages.push({ ...message, offset });
  }
  return { messages, excluded, consumed: position };
}
