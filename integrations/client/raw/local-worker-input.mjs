import { performance } from 'node:perf_hooks';
import { types } from 'node:util';
import { ownData, localAuthorityInput } from '../../../core/local-authority-input.mjs';
import { normalizedPath } from '../../../adapters/local/configuration.mjs';
import { FORMAT } from '../../codex/parser.mjs';
import { createLocalCaptureTransport } from './local-transport.mjs';

export const reasons = Object.freeze(['initialized','invalid_input','platform_unavailable','config_invalid','source_unavailable',
  'state_busy','capture_refused','awaiting_user_boundary','partial_record','work_limit','state_invalid','key_invalid',
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
export function workerOptions(value) {
  try {
    const input = ownData(value, ['stateRoot','identityKeyPath','nodeExecutable','runtimeRoot','configPath','expectedAuthority','home','env']);
    for (const field of ['stateRoot','identityKeyPath','nodeExecutable','runtimeRoot','configPath','home'])
      if (!normalizedPath(input[field])) fault('invalid_input');
    const authority = localAuthorityInput(input.expectedAuthority);
    const transport = Object.freeze({ nodeExecutable: input.nodeExecutable, runtimeRoot: input.runtimeRoot, configPath: input.configPath,
      expectedAuthority: authority, home: input.home, ...(Object.hasOwn(input,'env') ? { env: input.env } : {}) });
    createLocalCaptureTransport(transport); // Reuse the closed B4a constructor boundary; no I/O or spawn.
    return Object.freeze({ stateRoot: input.stateRoot, identityKeyPath: input.identityKeyPath, authority, transport });
  } catch { fault('invalid_input'); }
}
export function workerContext(value, client, initialize) {
  try {
    const input = ownData(value, ['sessionId','sourcePath','pluginRoot','formatAuthority', ...(initialize ? ['start'] : [])]);
    for (const field of ['sessionId','sourcePath','pluginRoot','formatAuthority']) if (!Object.hasOwn(input,field)) fault('invalid_input');
    if (!id(input.sessionId) || !normalizedPath(input.sourcePath)) fault('invalid_input');
    const start = initialize && Object.hasOwn(input,'start') ? input.start : 'eof';
    if (!['eof','beginning'].includes(start)) fault('invalid_input');
    let formatAuthority = null;
    if (client === 'claude-code') {
      if (!normalizedPath(input.pluginRoot) || input.formatAuthority !== null) fault('invalid_input');
    } else {
      const format = exact(input.formatAuthority, ['format','sessionId','creatorVersion','qualifiedCreatorVersion']);
      if (input.pluginRoot !== null || format.format !== FORMAT || format.sessionId !== input.sessionId ||
          !id(format.creatorVersion) || format.creatorVersion.length > 100 ||
          format.qualifiedCreatorVersion !== null && (!id(format.qualifiedCreatorVersion) || format.qualifiedCreatorVersion.length > 100)) fault('invalid_input');
      formatAuthority = Object.freeze(format);
    }
    return Object.freeze({ sessionId: input.sessionId, sourcePath: input.sourcePath, pluginRoot: input.pluginRoot, formatAuthority, start });
  } catch { fault('invalid_input'); }
}

const aborted = Object.getOwnPropertyDescriptor(AbortSignal.prototype,'aborted').get;
const add = EventTarget.prototype.addEventListener, remove = EventTarget.prototype.removeEventListener;
export function workerOperation(options) {
  let signal;
  try {
    signal = ownData(options,['signal']).signal;
    if (signal !== undefined) { if (types.isProxy(signal)) fault('invalid_input'); aborted.call(signal); }
  } catch { fault('invalid_input'); }
  const end = performance.now() + 155000, controller = new AbortController();
  let cancelled = signal !== undefined && aborted.call(signal);
  const cancel = () => { cancelled = true; controller.abort(); };
  if (signal !== undefined) add.call(signal,'abort',cancel,{ once: true });
  if (cancelled) controller.abort();
  const timer = setTimeout(() => controller.abort(),153000);
  return Object.freeze({ signal: controller.signal,
    remaining: () => Math.max(0,Math.floor(end-performance.now())),
    check() { if (controller.signal.aborted || performance.now() >= end-2000) fault(cancelled ? 'cancelled' : 'work_limit'); },
    close() { clearTimeout(timer); if (signal !== undefined) remove.call(signal,'abort',cancel); },
  });
}
export function summary(status, reason, cursor = null, counts = {}) {
  if (!['ready','progress','waiting','blocked','busy'].includes(status) || reason !== null && !reasons.includes(reason)) fault('state_invalid');
  return Object.freeze({ version: 'local-raw-worker-v1', status, reason, completedRecords: 0, completedParts: 0, dispatchedParts: 0,
    bytesAdvanced: 0, hasPending: cursor?.pending != null, remainingWork: false, nextEligibleAt: cursor?.pending?.nextEligibleAt ?? null,
    savedParts: 0, skippedParts: 0, ...counts });
}
