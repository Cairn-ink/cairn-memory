// Node >=20; do not import core in plugin-loaded code.
import { createHash } from 'node:crypto';
import { redactSecrets } from './redact.mjs';

export const PROFILE = 'normalized-conversation-v1';
export const hash = (...parts) => createHash('sha256').update(JSON.stringify(parts)).digest('hex');
export function canonical(value) {
  return redactSecrets(value.normalize('NFKC')).replace(/\s+/gu, ' ').trim();
}
export function normalizeBlocks(blocks) {
  if (blocks.some(x => typeof x !== 'string' || !x.isWellFormed() || x.includes('\0')))
    return { reason: 'invalid_text' };
  const full = canonical(blocks.map(x => redactSecrets(x.normalize('NFKC'))).join(''));
  if (!full || /^\[REDACTED\](?: \[REDACTED\])*$/u.test(full)) return { reason: 'invalid_text' };
  let content = '';
  for (const point of full) {
    if (content.length + point.length > 4000) break;
    content += point;
  }
  content = canonical(content);
  if (!content || content === '[REDACTED]' || canonical(content) !== content || !content.isWellFormed())
    return { reason: 'invalid_text' };
  return { content, normalizedUnits: full.length, submittedUnits: content.length,
    truncated: full.length > content.length };
}

export function captureBody(binding, messages, eventId) {
  return { project_id: binding.projectId, session_id: binding.sessionId,
    client: 'codex', event_id: eventId, messages };
}
export function preflight(body) {
  for (const id of [body.project_id, body.session_id, body.event_id, ...body.messages.map(x => x.id)]) {
    if (typeof id !== 'string' || !id || id.length > 200 || !id.isWellFormed() ||
        id.trim() !== id || /[\x00-\x1f\x7f]/u.test(id)) throw new Error('invalid_dto');
  }
  if (!body.messages.length || body.messages.length > 24 ||
      new Set(body.messages.map(x => x.id)).size !== body.messages.length ||
      body.messages.some(x => !['user','assistant'].includes(x.role) || !x.content ||
        x.content.length > 4000 || !x.content.isWellFormed() || x.content.includes('\0') ||
        canonical(x.content) !== x.content || x.content === '[REDACTED]') ||
      body.messages.reduce((n,x) => n + x.content.length, 0) > 20000 ||
      Buffer.byteLength(JSON.stringify(body)) > 65536) throw new Error('invalid_dto');
  return body;
}

// Records retain byte positions in memory only. Manifest contains no source text.
export function planBatches(records, binding, epoch, start, end) {
  const batches = [];
  let messages = [], batchStart = start, batchEnd = start;
  function flush() {
    if (batchEnd === batchStart) return;
    const eventId = hash(PROFILE, 'codex', binding.sessionId, epoch, batchStart, batchEnd,
      messages.map(x => x.id));
    const body = messages.length ? preflight(captureBody(binding, messages, eventId)) : null;
    batches.push({ start: batchStart, end: batchEnd, eventId, body });
    batchStart = batchEnd; messages = [];
  }
  for (const record of records) {
    if (record.message) {
      const next = [...messages, record.message];
      const candidate = captureBody(binding, next, '0'.repeat(64));
      if (messages.length && (next.length > 24 || next.reduce((n,x) => n+x.content.length,0)>20000 ||
          Buffer.byteLength(JSON.stringify(candidate))>65536)) flush();
      messages.push(record.message);
    }
    batchEnd = record.end;
  }
  if (end > batchEnd) batchEnd = end;
  flush();
  return batches;
}
