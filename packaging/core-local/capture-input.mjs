import { types } from 'node:util';
import { ownData } from '../../core/local-authority-input.mjs';
import { resolve } from 'node:path';

export const reasons = Object.freeze(['initialized','invalid_input','platform_unavailable','config_invalid','source_unavailable',
  'state_busy','capture_refused','awaiting_user_boundary','partial_record','work_limit','codex_boundary_required','state_invalid','key_invalid',
  'authority_changed','source_changed','record_limit','processing','uncertain','unavailable','interpretation_incomplete',
  'quota_reached','recovery_exhausted','cancelled']);
export class WorkerError extends Error {
  constructor(reason) { super('local_raw_worker_' + reason); this.code = this.message; this.reason = reason; }
}
export const fault = reason => { throw new WorkerError(reason); };
export const integer = (value, min = 0) => Number.isSafeInteger(value) && value >= min;
export const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const id = value => typeof value === 'string' && value.length > 0 && value.length <= 200 && value.isWellFormed() &&
  value.trim() === value && !/[\x00-\x1f\x7f]/.test(value);
export function exact(value, fields) {
  const result = ownData(value, fields);
  if (Object.keys(result).length !== fields.length) fault('invalid_input');
  return result;
}
export function absolute(value) {
  return typeof value === 'string' && value.length > 1 && value.length <= 8192 && value.isWellFormed() &&
    !/[\x00-\x1f\x7f]/u.test(value) && value.startsWith('/') && resolve(value) === value;
}

export const events = client => client === 'codex' ? ['SessionStart','UserPromptSubmit','Stop','PreCompact'] : ['SessionStart','Stop','PreCompact'];

export function hookSelection(payload, event, client) {
  if (!payload || typeof payload !== 'object' || types.isProxy(payload) || Array.isArray(payload) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(payload))) fault('event_refused');
  const selected = {};
  // Native clients can include unrelated fields. Select only own data.
  for (const field of ['hook_event_name', 'session_id', 'transcript_path', 'source']) {
    const descriptor = Object.getOwnPropertyDescriptor(payload, field);
    if (!descriptor) continue;
    if (!Object.hasOwn(descriptor, 'value')) fault('event_refused');
    selected[field] = descriptor.value;
  }
  const { hook_event_name: nativeEvent, session_id: sessionId, transcript_path: sourcePath, source } = selected;
  if (!events(client).includes(event) || nativeEvent !== event || !id(sessionId) || !absolute(sourcePath) ||
      source != null && (typeof source !== 'string' || source.length > 65536)) fault('event_refused');
  return { sessionId, sourcePath, source: source ?? undefined };
}
