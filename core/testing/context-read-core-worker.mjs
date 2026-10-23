import { writeFileSync } from 'node:fs';
import { openMemoryCore, openContextReader } from '../index.mjs';
const [path, serialized, report] = process.argv.slice(2), job = JSON.parse(serialized);
const token = {}, grants = new WeakMap();
const authority = { authorize(request, supplied) {
  if (supplied !== token) return null;
  const grant = {}, { input, ...binding } = request; grants.set(grant, binding); return grant;
}, isCurrent(grant) { return grants.has(grant) ? { ...grants.get(grant), accessGeneration: 1 } : null; } };
const configuration = { version: 'context-read-v1', authority };
let core;
try {
  core = job.mode === 'read-only' ? openContextReader({ path, contextRead: configuration }) : openMemoryCore({ path,
    ...(job.mode === 'managed' ? { existingStore: { version: 'schema30-existing-v1', storeId: job.storeId }, contextRead: configuration } : {}),
    ...(job.card ? { privateCards: { version: 'private-cards-local-v1', source: 'submitted-note-v1',
      storage: 'local-plain-v1', disclosure: 'explicit-submitted-note-v1', authority } } : {}) });
  const result = await core[job.method](job.input, token);
  if (job.envelope) writeFileSync(report, JSON.stringify(result), { mode: 0o600 });
  else {
    if (!result.ok) throw Error(JSON.stringify(result));
    writeFileSync(report, JSON.stringify(result.value), { mode: 0o600 });
  }
} catch (error) {
  if (!job.envelope) throw error;
  writeFileSync(report, JSON.stringify({ ok: false, error: { code: error.code ?? 'storage_error' } }), { mode: 0o600 });
} finally { core?.close(); }
