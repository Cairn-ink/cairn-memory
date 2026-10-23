import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { join, basename } from 'node:path';
import { watch, writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { openMemoryCore } from '../index.mjs';
import { openContextReadSidecar } from '../context-read-sidecar.mjs';
import { cardHost } from './raw-source-fixtures.mjs';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';

export const ns = { ownerId: 'synthetic-u5a', scope: 'project', projectId: 'test' };
export const ok = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };
export const receipt = (eventId, excerpt = eventId) => ({ client: 'synthetic', sessionId: 'u5a', eventId, role: 'user', excerpt });
export const request = (patch = {}) => ({ readSet: [ns], types: ['memory'], intent: 'current', accessGeneration: 1,
  budget: { maxItems: 1024, maxMs: 5000 }, ...patch });

export { readTransaction } from '../database.mjs';
import { readTransaction } from '../database.mjs';

// Fresh inotify subscription per observation. A sentinel event drains the
// same ordered event queue, avoiding sleeps and events from fixture setup.
export async function observeDatabaseFiles(f, work) {
  const name = basename(f.path), sentinel = '.u5a-observe-' + randomUUID(), markers = [], events = [];
  let barrier, timer, watchError, expectedSentinel;
  const monitor = watch(f.workspace.path, (event, filename) => {
    const selected = String(filename);
    if (selected === expectedSentinel) barrier?.();
    else if (selected === name || selected.startsWith(name + '.')) events.push([event, selected]);
  });
  monitor.on('error', error => { watchError = error; });
  async function flush() {
    await new Promise((resolve, reject) => {
      barrier = resolve;
      timer = setTimeout(() => reject(watchError ?? Error('filesystem_observer_timeout')), 30000);
      const marker = join(f.workspace.path, sentinel + '-' + markers.length); markers.push(marker);
      expectedSentinel = basename(marker);
      writeFileSync(marker, '', { flag: 'wx', mode: 0o600 });
    });
    clearTimeout(timer);
  }
  try {
    await flush(); events.length = 0;
    const result = await work();
    await flush();
    if (watchError) throw watchError;
    return { result, events };
  } finally {
    clearTimeout(timer);
    await new Promise(resolve => { monitor.once('close', resolve); monitor.close(); });
    for (const marker of markers) if (existsSync(marker)) unlinkSync(marker);
  }
}

export function fixture(t, { cards = false, coreOptions = {} } = {}) {
  const workspace = createTestWorkspace(t, { prefix: 'u5a-' }), path = join(workspace.path, 'canonical.sqlite');
  const host = cardHost(), core = openMemoryCore({ path, ...(cards ? { privateCards: host.options } : {}), ...coreOptions });
  workspace.defer(() => core.close());
  const db = new DatabaseSync(path, { readOnly: true }); workspace.defer(() => db.close());
  return { path, workspace, db, core, host,
    admit(content, namespace = ns) {
      return ok(core.admit({ namespace, memory: { content, kind: 'fact' },
        receipts: [receipt(createHash('sha256').update(content).digest('hex'), content)] })).memory;
    },
    call(method, input) { return host.call(core, method, input); },
    index(options = {}) {
      const sidecar = openContextReadSidecar({ path, db, ...options });
      workspace.defer(() => sidecar.close()); return sidecar;
    } };
}
export function drain(sidecar, input = request()) {
  const totals = {}, calls = [];
  for (let attempt = 0; attempt < 10000; attempt++) {
    const result = sidecar.reconcile(input); calls.push(result);
    for (const [key, value] of Object.entries(result.metrics)) totals[key] = (totals[key] ?? 0) + value;
    if (result.status === 'complete') return { ...result, totals, calls };
  }
  throw Error('reconciliation_did_not_finish');
}
export function snapshot(path) {
  const db = new DatabaseSync(path + '.context-read-v1.sqlite', { readOnly: true });
  try { return readTransaction(db, () => ({
    documents: db.prepare('SELECT stream,id,revision,body_revision,eligible,representation,token_length FROM documents ORDER BY stream,id').all().map(row => ({ ...row })),
    postings: db.prepare('SELECT stream,id,term,frequency FROM postings ORDER BY stream,id,term').all().map(row => ({ ...row })),
    statistics: db.prepare('SELECT term,df,n,total_length FROM statistics ORDER BY term').all().map(row => ({ ...row })),
  })); } finally { db.close(); }
}
