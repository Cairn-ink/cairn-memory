import { writeFileSync } from 'node:fs';
import { openMemoryCore, openContextReader } from '../index.mjs';

const [path, serialized, report] = process.argv.slice(2), job = JSON.parse(serialized);
const token = {}, grants = new WeakMap();
const authority = { authorize(request, supplied) {
  if (supplied !== token || request.method !== 'contextRead') return null;
  const grant = {}, { input, ...binding } = request; grants.set(grant, binding); return grant;
}, isCurrent(grant) { return grants.has(grant) ? { ...grants.get(grant), accessGeneration: 1 } : null; } };
const contextRead = { version: 'context-read-v1', authority,
  counter: { id: 'synthetic-utf8-bytes', countTokens: text => Buffer.byteLength(text) } };
let core;
try {
  core = job.mode === 'read-only' ? openContextReader({ path, contextRead }) :
    openMemoryCore({ path, contextRead, existingStore: { version: 'schema30-existing-v1', storeId: job.storeId } });
  writeFileSync(report, JSON.stringify(await core.contextRead(job.input, token)), { mode: 0o600 });
} catch (error) {
  writeFileSync(report, JSON.stringify({ ok: false, error: { code: error.code ?? 'storage_error' } }), { mode: 0o600 });
} finally { core?.close(); }
