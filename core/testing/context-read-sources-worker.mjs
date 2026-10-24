import { writeFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openMemoryCore, openContextReader } from '../index.mjs';
import { STORAGE_BUSY_TIMEOUT_MS } from '../database.mjs';
const [path, serialized, report] = process.argv.slice(2), job = JSON.parse(serialized);
const token = {}, grants = new WeakMap();
const authority = { authorize(request, supplied) { if (supplied !== token) return null;
  const { input, ...binding } = request, grant = {}; grants.set(grant, binding); return grant;
}, isCurrent(grant) { return grants.has(grant) ? { ...grants.get(grant), accessGeneration: 1 } : null; } };
let core;
try {
  if (job.kind === 'corruption-probe') {
    // Only deliberate out-of-band race/corruption probes use SQL. Fixture
    // evidence, edges, titles and memberships were authored by public APIs.
    const db = new DatabaseSync(path, { timeout: STORAGE_BUSY_TIMEOUT_MS });
    try { db.exec('PRAGMA busy_timeout=' + STORAGE_BUSY_TIMEOUT_MS); db.exec(job.sql); }
    finally { db.close(); }
    writeFileSync(report, JSON.stringify({ ok: true, value: { sourceEnabled: false } }));
  } else {
    const configuration = { version: 'context-read-v1', authority, sources: job.sources ?? ['relations-one-hop-v1', 'moc-v1'] };
    const before = readdirSync(dirname(path)).sort();
    core = job.kind === 'read-only' ? openContextReader({ path, contextRead: configuration }) : openMemoryCore({ path,
      ...(job.card ? { privateCards: { version: 'private-cards-local-v1', source: 'submitted-note-v1', storage: 'local-plain-v1',
        disclosure: 'explicit-submitted-note-v1', authority } } : {}) });
    if (job.rendezvous) {
      writeFileSync(report + '.ready', 'ready', { flag: 'wx' });
      const watchdog = Date.now() + 60000;
      while (!existsSync(report + '.release')) {
        if (Date.now() >= watchdog) throw Error('writer_rendezvous_timeout');
        await new Promise(resolve => setTimeout(resolve, 10));
      }
    }
    const result = await core[job.method](job.input, token);
    if (job.kind === 'read-only') writeFileSync(report, JSON.stringify({ result, before, after: readdirSync(dirname(path)).sort() }));
    else writeFileSync(report, JSON.stringify({ ...result, sourceEnabled: 'findCandidates' in core }));
  }
} finally { core?.close(); }
