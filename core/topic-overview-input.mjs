import { sqliteFailureDiagnostics } from './topic-reader-sqlite.mjs';
import { resolve } from 'node:path';
import { types } from 'node:util';
import { identifier, fail } from './validation.mjs';

export function ownData(value, allowed) {
  if (!value || typeof value !== 'object' || types.isProxy(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail('invalid_input');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const name of Reflect.ownKeys(descriptors)) {
    if (typeof name !== 'string' || !allowed.includes(name) ||
        !Object.hasOwn(descriptors[name], 'value')) fail('invalid_input');
  }
  return Object.fromEntries(Object.entries(descriptors).map(([name, descriptor]) => [name, descriptor.value]));
}
const id = value => { try { return identifier(value); } catch { fail('invalid_input'); } };
export function readerOptions(input) {
  const value = ownData(input, ['path', 'ownerId', 'diagnostics']);
  if (typeof value.path !== 'string' || !value.path.isWellFormed() || !value.path ||
      value.path.length > 4096 || value.path.includes('\0') || value.path === ':memory:' ||
      value.path.startsWith('file:')) fail('invalid_input');
  if (value.diagnostics !== undefined && typeof value.diagnostics !== 'boolean') fail('invalid_input');
  return { path: resolve(value.path), ownerId: id(value.ownerId), ...(value.diagnostics === true ? { diagnostics: true } : {}) };
}
export function overviewInput(input, ownerId) {
  const value = ownData(input, ['namespace', 'nodeLimit', 'maxBytes', 'workLimit', 'memberLimit', 'cursor', 'snapshotVersion']);
  if (value.snapshotVersion !== undefined && value.snapshotVersion !== 'topic-snapshot-v1') fail('invalid_input');
  const namespace = ownData(value.namespace, ['ownerId', 'scope', 'projectId']);
  if (id(namespace.ownerId) !== ownerId || !Object.hasOwn(namespace, 'projectId')) fail('invalid_input');
  if (namespace.scope === 'personal' && namespace.projectId === null) namespace.projectId = '';
  else if (namespace.scope === 'project') namespace.projectId = id(namespace.projectId);
  else fail('invalid_input');
  const bounds = {};
  for (const [name, fallback, minimum, maximum] of [['nodeLimit', 100, 1, 100],
    ['maxBytes', 65536, 4096, 262144], ['workLimit', 5000, 16, 50000], ['memberLimit', 0, 0, 10]]) {
    const supplied = value[name] === undefined ? fallback : value[name];
    if (!Number.isSafeInteger(supplied) || supplied < minimum || supplied > maximum) fail('invalid_input');
    bounds[name] = supplied;
  }
  if (value.cursor !== undefined && (typeof value.cursor !== 'string' ||
      !/^e1\.[A-Za-z0-9_-]{43}$/.test(value.cursor))) fail('invalid_cursor');
  return { namespace: { ownerId: namespace.ownerId, scope: namespace.scope, projectId: namespace.projectId },
    ...bounds, ...(value.snapshotVersion === undefined ? {} : { snapshotVersion: value.snapshotVersion }), ...(value.cursor === undefined ? {} : { cursor: value.cursor }) };
}

export const readerFailure = code => ({ ok: false, error: { code } });
const legacyCodes = new Set(['invalid_input', 'invalid_cursor', 'cursor_stale', 'index_unavailable',
  'unsafe_database_file', 'unsupported_database', 'database_not_found', 'storage_busy',
  'state_limit', 'context_item_too_large', 'store_closed']);
const safeCodes = new Set([...legacyCodes, 'moc_not_found', 'revision_conflict', 'invalid_ref', 'read_timeout']);
function classifiedFailure(error, codes, diagnostics) {
  const result = classify(error, codes);
  const metadata = diagnostics && sqliteFailureDiagnostics(error);
  if (metadata) result.error.diagnostics = metadata;
  return result;
}
function classify(error, codes) {
  if (error?.code === 'ERR_SQLITE_ERROR' && Number.isInteger(error.errcode) && [5, 6].includes(error.errcode & 255)) {
    return readerFailure('storage_busy');
  }
  return readerFailure(codes.has(error?.code) ? error.code : 'reader_failed');
}
export const safeReaderFailure = (error, diagnostics = false) => classifiedFailure(error, safeCodes, diagnostics);
export const safeLegacyReaderFailure = (error, diagnostics = false) => classifiedFailure(error, legacyCodes, diagnostics);
