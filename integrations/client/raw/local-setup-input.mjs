import { fileURLToPath } from 'node:url';
import { join, resolve, dirname } from 'node:path';
import { ownData, localNamespace } from '../../../core/local-authority-input.mjs';
import { hostRuntime } from './local-host-profile.mjs';
import { createHash } from 'node:crypto';
import { types } from 'node:util';

export const runtimeRoot = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
export const sha = value => createHash('sha256').update(value).digest('hex');
export const reasons = Object.freeze(['invalid_input','declined','not_installed','prepared','active','disabled','rearm_required',
  'recovery_required','configuration_conflict','configuration_changed','unsafe_path','store_invalid','authority_bound',
  'authority_changed','qualification_required','runtime_unavailable','busy','cancelled','source_refused','event_refused','unexpected_failure']);
export const fail = reason => { throw Object.assign(new Error('local_setup_failed'), { reason }); };
export function runtime() { try { hostRuntime(); } catch { fail('runtime_unavailable'); } }
export function exact(value, keys) {
  let result;
  try { result = ownData(value, keys); } catch { fail('invalid_input'); }
  if (Object.keys(result).length !== keys.length) fail('invalid_input');
  return result;
}
export function absolute(value) {
  return typeof value === 'string' && value.length > 1 && value.length <= 8192 && value.isWellFormed() &&
    !/[\x00-\x1f\x7f]/.test(value) && resolve(value) === value && value.startsWith('/');
}
export function installationPath(value) { if (!absolute(value)) fail('invalid_input'); return value; }
export function locations(root) {
  installationPath(root);
  return { root, record:join(root,'installation.json'), lock:join(root,'.setup.lock'), config:join(root,'capture.json'),
    profile:join(root,'host-profile.json'), home:join(root,'home'), usage:join(root,'usage'), state:join(root,'state'), key:join(root,'identity.key') };
}
export const overlap = (a, b) => a === b || a.startsWith(b + '/') || b.startsWith(a + '/');
export function setupRequest(value) {
  const input = exact(value, ['version','installationDirectory','databasePath','namespace','client','sourceRoot','clientConfigPath','usageRoot',
    'installation','rawMode','rawCapBytes','dailyCap','providerApiKeyEnv','interpretationConsent','plaintextRawConsent','foregroundConsent']);
  if (input.version !== 'local-raw-setup-request-v1' || ![input.installationDirectory,input.databasePath,input.sourceRoot,input.clientConfigPath,input.usageRoot].every(absolute) ||
      !['claude-code','codex'].includes(input.client) || !['off','local-plain-v1'].includes(input.rawMode) ||
      !Number.isSafeInteger(input.rawCapBytes) || input.rawCapBytes < 1 || !Number.isSafeInteger(input.dailyCap) || input.dailyCap < 1 || input.dailyCap > 100000 ||
      typeof input.providerApiKeyEnv !== 'string' || !(input.providerApiKeyEnv === 'OPENAI_API_KEY' || /^CAIRN_[A-Z0-9_]{1,96}_API_KEY$/.test(input.providerApiKeyEnv)) ||
      !['interpretationConsent','plaintextRawConsent','foregroundConsent'].every(key => typeof input[key] === 'boolean')) fail('invalid_input');
  let namespace;
  try { namespace = localNamespace(input.namespace); } catch { fail('invalid_input'); }
  namespace = { ...namespace, projectId:namespace.projectId || null };
  const field = input.client === 'claude-code' ? 'pluginRoot' : 'qualificationConfigPath';
  const installation = exact(input.installation, [field]); if (!absolute(installation[field])) fail('invalid_input');
  const paths = locations(input.installationDirectory);
  const protectedPaths = [paths.root,input.databasePath,input.clientConfigPath,installation[field],input.usageRoot,input.databasePath+'.local-setup.lock'];
  if (protectedPaths.some(path => overlap(path,input.sourceRoot)) ||
      [input.databasePath,input.clientConfigPath,installation[field]].some(path => overlap(path,paths.root)) ||
      [paths.root,input.databasePath,input.clientConfigPath,installation[field]].some(path => overlap(path,input.usageRoot)) ||
      overlap(input.databasePath,input.clientConfigPath) || dirname(input.clientConfigPath) === paths.root) fail('invalid_input');
  return { ...input, namespace, installation };
}
export const consented = request => request.interpretationConsent && request.foregroundConsent &&
  (request.rawMode === 'off' || request.plaintextRawConsent);
export function result(status, reason = null) {
  if (!['prepared','active','disabled','declined','blocked','busy'].includes(status) || reason !== null && !reasons.includes(reason)) fail('unexpected_failure');
  return Object.freeze({ version:'local-raw-setup-v1',status,reason,foreground:true,hookTimeoutSeconds:160 });
}
export const failure = error => result(error?.message === 'state_busy' ? 'busy':'blocked',
  error?.message === 'state_busy' ? 'busy' : reasons.includes(error?.reason) ? error.reason:'unexpected_failure');
export function checkSignal(signal) {
  if (signal === undefined) return;
  if (types.isProxy(signal)) fail('invalid_input');
  let aborted;
  try { aborted = Object.getOwnPropertyDescriptor(AbortSignal.prototype,'aborted').get.call(signal); }
  catch { fail('invalid_input'); }
  if (aborted) fail('cancelled');
}
