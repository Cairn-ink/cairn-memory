import test from 'node:test';
import assert from 'node:assert/strict';
import { openMemoryCore } from '../contract.mjs';
import { createCommitDispatcher } from '../commit-dispatch.mjs';
import { safetyFixture, ns, ok, receipt } from '../testing/content-safety-s2h-fixture.mjs';

for (const safety of [false, true]) for (const suppressed of [false, true]) {
  test(`host isSuppressed retries an exclusive read lock: safety=${safety} suppressed=${suppressed}`, async t => {
    const f = safetyFixture(t);
    if (safety) await f.migrate();
    const query = { namespace: ns, content: 'Synthetic suppression probe' };
    const ordinary = openMemoryCore({ path: f.path, raw: false });
    try {
      if (suppressed) {
        const memory = ok(ordinary.admit({ namespace: ns, memory: { content: query.content, kind: 'fact' },
          receipts: [receipt('suppression-probe')] })).memory;
        ok(ordinary.forget({ namespace: ns, memoryId: memory.id, expectedRevision: memory.revision }));
      }
      const expected = ordinary.isSuppressed(query);
      assert.deepEqual(expected, { ok: true, value: { suppressed } });
      const holder = f.connect();
      let backoffs = 0;
      const host = createCommitDispatcher({ strict: true, onBackoff() {
        backoffs++;
        assert.ok(host.inspectTransactions().every(state => state.isTransaction === false));
        holder.exec('ROLLBACK');
      } });
      const core = host.open(() => openMemoryCore({ path: f.path, raw: false }));
      try {
        holder.exec('BEGIN EXCLUSIVE');
        const actual = await host.run(() => core.isSuppressed(query));
        assert.deepEqual(actual, expected, 'R2M_SUPPRESSION_READ_PARITY');
        assert.ok(backoffs >= 1, 'R2M_SUPPRESSION_READ_BACKOFF');
        assert.equal(host.inspectSynchronousWrites().count, 0);
      } finally {
        if (holder.isTransaction) holder.exec('ROLLBACK');
        core.close(); holder.close();
      }
    } finally { ordinary.close(); }
  });
}
