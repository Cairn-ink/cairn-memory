import { join } from 'node:path';
import { privateRead } from './private-state.mjs';
import { hostedTargetId } from './transport-hosted.mjs';
import { createRuntimeGuard } from './runtime-usage.mjs';
import { withFileLock } from './file-lock.mjs';
import { privateWrite } from './private-state.mjs';
import { readControlState } from './control-state.mjs';
import { randomUUID } from 'node:crypto';

// Installer-owned, secret-free Codex policy. Claude only diagnoses it on status;
// it never applies this local cap or requires the Codex hosted-pause gate.
export const policyPath = (root, endpoint) => join(root,'automatic-policy',hostedTargetId({endpoint})+'.json');
export async function automaticPolicy(root, endpoint) {
  const raw = await privateRead(policyPath(root,endpoint), { missing: true });
  if (raw === undefined) return undefined;
  const value = JSON.parse(raw);
  if (!value || Object.keys(value).sort().join(',') !== 'concurrency,dailyCap,version' || value.version !== 1 ||
    value.concurrency !== 2 || !Number.isSafeInteger(value.dailyCap) || value.dailyCap < 1 || value.dailyCap > 100000) {
    throw new Error('invalid_automatic_policy');
  }
  return value;
}
// Best-effort diagnostics: malformed/unreadable/future policies are never authority
// for Claude controls or hooks. Never include file contents or exception text.
export async function inspectAutomaticPolicy(root, endpoint) {
  try {
    const policy = await automaticPolicy(root, endpoint);
    return policy ? { state: 'available', policy } : { state: 'absent' };
  } catch { return { state: 'invalid' }; }
}
export function automaticGuard(root, endpoint, policy) {
  return createRuntimeGuard({ root, targetId: hostedTargetId({endpoint}), client: 'shared',
    mode: 'hosted', dailyCap: policy.dailyCap, concurrency: policy.concurrency });
}

// Revoke old workers atomically without clearing a simultaneous user pause.
// Use the released control lock and representation; preserve the legacy marker.
export async function rotateAutomaticBoundary(root) {
  let updated;
  const acquired = await withFileLock(join(root,'control.lock'),async () => {
    const current = await readControlState(root);
    if (!current.valid) throw new Error('invalid_control');
    updated = {version:1,paused:current.paused,generation:randomUUID()};
    await privateWrite(join(root,'control.json'),JSON.stringify(updated));
  },{timeoutMs:250,pollMs:10});
  if (!acquired || !updated) throw new Error('control_busy');
  return updated;
}
