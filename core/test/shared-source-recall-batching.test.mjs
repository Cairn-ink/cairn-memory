import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync, StatementSync } from 'node:sqlite';
import { openMemoryCore } from '../index.mjs';

const namespace = { ownerId: 'synthetic-owner', scope: 'project', projectId: 'recall' };

function ok(result) {
  assert.equal(result.ok, true, JSON.stringify(result));
  return result.value;
}

for (const contextMode of ['source-evidence', 'rationale-evidence']) {
  test(`recall batches ${contextMode} marker lookups within each read transaction`, async t => {
    const core = openMemoryCore({ path: ':memory:', model: {
      contextWindow: 8192,
      countTokens: () => 1,
      select: ({ input }) => ({ refs: input.maps.flatMap(page => page.items
        .filter(item => item.type === 'unfiled').slice(0, 6)
        .map(item => ({ namespaceIndex: page.namespaceIndex, ...item.ref }))) }),
      rank: ({ input }) => ({ refs: input.candidates.map(({ namespaceIndex, memory }) =>
        ({ namespaceIndex, memoryId: memory.id, revision: memory.revision })) }),
    } });
    t.after(() => core.close());
    for (let i = 0; i < 12; i++) {
      ok(core.admit({ namespace, memory: { kind: 'fact', content: `Synthetic probe Memory ${i}` },
        receipts: [{ client: 'synthetic', sessionId: 'session', eventId: `event-${i}`, role: 'user', excerpt: `Probe source ${i}` }] }));
    }

    const pages = [];
    const exec = DatabaseSync.prototype.exec;
    const all = StatementSync.prototype.all;
    const execHook = t.mock.method(DatabaseSync.prototype, 'exec', function (sql) {
      if (/^BEGIN\b/.test(sql)) pages.push(0);
      return exec.call(this, sql);
    });
    const allHook = t.mock.method(StatementSync.prototype, 'all', function (...bindings) {
      if (this.sourceSQL.includes('CROSS JOIN suppressed s')) {
        assert.ok(pages.length);
        pages[pages.length - 1]++;
      }
      return all.apply(this, bindings);
    });
    try {
      const recall = ok(await core.recall({ readSet: [namespace], query: 'probe', contextMode }));
      assert.equal(recall.memories.length, 6);
    } finally {
      allHook.mock.restore();
      execHook.mock.restore();
    }
    assert.equal(pages.at(-1), 1, 'the final snapshot has one marker lookup for all candidates');
    assert.deepEqual(pages.filter(count => count > 1), [], 'each read transaction has at most one marker lookup');
    assert.equal(pages.reduce((sum, count) => sum + count, 0), 18,
      'one navigation, twelve fetch, four rank checks and one final snapshot');
  });
}
