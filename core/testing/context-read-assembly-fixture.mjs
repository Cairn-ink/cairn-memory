import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { performance } from 'node:perf_hooks';
import { coreFixture, ns, personal, ok } from './context-read-core-fixture.mjs';
import { STORAGE_BUSY_TIMEOUT_MS } from '../database.mjs';

export const sample = JSON.parse(readFileSync(new URL('../test/fixtures/context-read/u5b-assembly.json', import.meta.url)));
export const counter = { id: 'synthetic-utf8-bytes', countTokens: text => Buffer.byteLength(text) };
export const assemblyQuery = (patch = {}) => ({ readSet: [ns], types: ['memory'], intent: 'current', query: 'assembly', deadlineMs: 5000, ...patch });
export function controlledClock(t) {
  const descriptor = Object.getOwnPropertyDescriptor(performance, 'now');
  let time = 0;
  Object.defineProperty(performance, 'now', { configurable: true, value: () => time });
  t.after(() => { if (descriptor) Object.defineProperty(performance, 'now', descriptor); else delete performance.now; });
  return { now: () => time, advance(ms) { time += ms; } };
}
export function assemblyFixture(t, options = {}) {
  const { counter: port = counter, ...rest } = options, f = coreFixture(t, rest);
  const context = f.reopen({ ...(port === null ? {} : { counter: port }) });
  f.db.exec('PRAGMA busy_timeout=' + STORAGE_BUSY_TIMEOUT_MS);
  const writer = new DatabaseSync(f.path, { timeout: STORAGE_BUSY_TIMEOUT_MS });
  f.workspace.defer(() => writer.close());
  const config = { ...f.config, ...(port === null ? {} : { counter: port }) };
  return { ...f, context, config, writer,
    seed(definitions = sample.items, namespaces = [ns]) {
      return definitions.map((definition, i) => {
        const namespace = namespaces[i % namespaces.length];
        const first = definition.receipts[0] ?? { client: 'synthetic', sessionId: 'empty', eventId: definition.id, role: 'user', excerpt: 'Seed only.' };
        const memory = ok(f.core.admit({ namespace, memory: { content: definition.input, kind: 'fact' }, receipts: [first] })).memory;
        // Synthetic fixture installation only. Fixed IDs/times make receipt
        // order independent of random admission IDs and the wall clock.
        writer.prepare('DELETE FROM receipts WHERE memory_id=?').run(memory.id);
        for (const [index, source] of definition.receipts.entries()) {
          writer.prepare(`INSERT INTO receipts(id,memory_id,receipt_key,client,session_id,event_id,role,excerpt,created_at)
            VALUES(?,?,?,?,?,?,?,?,?)`).run(definition.receiptStorage?.[index]?.id ?? definition.id + '-r-' + String(index).padStart(2, '0'), memory.id,
            createHash('sha256').update(JSON.stringify(source)).digest('hex'), source.client, source.sessionId,
            source.eventId, source.role, source.excerpt, definition.receiptStorage?.[index]?.createdAt ?? '2026-01-01T00:00:00.000Z');
        }
        return { definition, namespace, memory };
      });
    },
  };
}

export function fixedPrepared(order = sample.rankings[0]) {
  return order.map((id, index) => {
    const item = sample.items.find(item => item.id === id);
    return { ref: { type: 'memory', namespace: ns, memoryId: id, revision: 1 }, type: 'memory', ns: 0, fence: 'abcdefgh' + 'x'.repeat(35), rank: index + 1,
      metadata: { state: 'active', reviewState: 'none', filing: { status: 'unfiled' }, kind: 'fact', origin: 'explicit', confidence: 1 },
      text: item.text, sources: item.receipts.slice(0, 16).map(({ role, excerpt }, index) => ({ index, role, excerpt })),
      sourceAccess: 'available', sourcesComplete: item.receipts.length <= 16 };
  });
}
export { ns, personal, ok };
