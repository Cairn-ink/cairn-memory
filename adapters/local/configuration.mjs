import { isAbsolute, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { privateRead, checkedPath } from '../../integrations/client/private-state.mjs';
import { localAuthorityInput, ownData } from '../../core/local-authority-input.mjs';
import { validateRawRequest } from '../../integrations/client/raw/protocol.mjs';

export class LocalCaptureError extends Error {
  constructor(code = 'local_capture_failed') { super(code); this.code = code; }
}
const invalid = () => { throw new LocalCaptureError('invalid_local_capture_configuration'); };
const exact = (value, keys) => {
  const result = ownData(value, keys);
  if (Object.keys(result).length !== keys.length) invalid();
  return result;
};
const positive = (value, maximum = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(value) && value >= 1 && value <= maximum;
export const normalizedPath = value => typeof value === 'string' && !value.includes('\0') && isAbsolute(value) && resolve(value) === value;

export function configuration(value) {
  try {
    const required = ['version', 'databasePath', 'authority', 'raw', 'provider', 'usage', 'timeouts'];
    const input = ownData(value, [...required, 'captureQualifiedDuplicates']);
    if (required.some(field => !Object.hasOwn(input, field)) ||
        'captureQualifiedDuplicates' in value && (!Object.hasOwn(input, 'captureQualifiedDuplicates') ||
          input.captureQualifiedDuplicates !== 'append-matching-evidence-v1')) invalid();
    if (input.version !== 'local-capture-config-v1' || !normalizedPath(input.databasePath)) invalid();
    const validated = localAuthorityInput(input.authority);
    // The trusted authority validator uses storage's empty personal project ID;
    // public core read controls require the equivalent public null spelling.
    const authority = Object.freeze({ ...validated, namespace: Object.freeze({ ...validated.namespace,
      projectId: validated.namespace.projectId || null }) });
    const raw = exact(input.raw, ['mode', 'capBytes']);
    const provider = exact(input.provider, ['profile', 'apiKeyEnv']);
    const usage = exact(input.usage, ['root', 'dailyCap', 'concurrency']);
    const timeouts = exact(input.timeouts, ['captureMs', 'processMs']);
    if (!['off', 'local-plain-v1'].includes(raw.mode) || !positive(raw.capBytes) ||
        provider.profile !== 'openai-baseline-v1' || typeof provider.apiKeyEnv !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(provider.apiKeyEnv) ||
        !normalizedPath(usage.root) || !positive(usage.dailyCap) || !positive(usage.concurrency, 32) ||
        !positive(timeouts.captureMs, 120000) || !positive(timeouts.processMs, 150000) || timeouts.captureMs > timeouts.processMs) invalid();
    return Object.freeze({ ...input, authority, raw: Object.freeze(raw), provider: Object.freeze(provider),
      usage: Object.freeze(usage), timeouts: Object.freeze(timeouts) });
  } catch { invalid(); }
}

export async function readConfigurationSnapshot(path, expectedDigest) {
  if (process.platform === 'win32') throw new LocalCaptureError('local_capture_platform_unavailable');
  if (!normalizedPath(path) || expectedDigest !== undefined && (typeof expectedDigest !== 'string' || !/^[a-f0-9]{64}$/.test(expectedDigest))) invalid();
  try {
    const text = await privateRead(path), digest = createHash('sha256').update(text, 'utf8').digest('hex');
    if (expectedDigest !== undefined && expectedDigest !== digest) invalid();
    return Object.freeze({ config: configuration(JSON.parse(text)), digest });
  }
  catch { invalid(); }
}

export async function readConfiguration(args) {
  if (!Array.isArray(args) || ![2, 4].includes(args.length) || args[0] !== '--config' ||
      args.length === 4 && (args[2] !== '--config-digest' || typeof args[3] !== 'string' || !/^[a-f0-9]{64}$/.test(args[3]))) invalid();
  return (await readConfigurationSnapshot(args[1], args[3])).config;
}

export function requestForTarget(value, config) {
  try {
    const request = validateRawRequest(value), { namespace, client } = config.authority;
    if (request.client !== client || (namespace.scope === 'personal'
      ? Object.hasOwn(request, 'project_id') : request.project_id !== namespace.projectId)) throw new Error();
    return request;
  } catch { throw new LocalCaptureError('invalid_capture_v2'); }
}

export async function preflight(config) {
  let db;
  try {
    const { DatabaseSync } = await import('node:sqlite');
    await checkedPath(config.usage.root, { directory: true });
    const before = await checkedPath(config.databasePath);
    db = new DatabaseSync(config.databasePath, { readOnly: true });
    const after = await checkedPath(config.databasePath);
    if (before.dev !== after.dev || before.ino !== after.ino) invalid();
    if (db.prepare('PRAGMA application_id').get().application_id !== 0x43414952 || db.prepare('PRAGMA user_version').get().user_version !== 29 ||
        db.prepare('SELECT store_id FROM store_metadata WHERE singleton=1').get()?.store_id !== config.authority.storeId ||
        db.prepare('SELECT 1 FROM raw_owner_usage WHERE owner_id=? AND cap_bytes!=?').get(config.authority.namespace.ownerId, config.raw.capBytes)) invalid();
  } catch { invalid(); }
  finally { db?.close(); }
}
