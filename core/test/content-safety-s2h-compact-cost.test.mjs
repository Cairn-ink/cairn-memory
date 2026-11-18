import test from 'node:test';
import assert from 'node:assert/strict';
import { openContextReader, openMemoryCore } from '../index.mjs';
import { controlledClock } from '../testing/context-read-assembly-fixture.mjs';
import { compactRequest } from '../testing/context-read-compact-fixture.mjs';
import { host, refresh } from '../testing/context-read-core-fixture.mjs';
import { measureContentRead } from '../testing/content-safety-cost-meter.mjs';
import { eventTimeFixture, ns, ok, receipt } from '../testing/receipt-event-time-fixture.mjs';

const epochQuery = 'SELECT epoch_hi,epoch_lo FROM owner_suppression_epochs WHERE owner_id=?';

for (const readOnly of [false, true]) test(`compact statement slope at 32 and 64 delivered items, readOnly=${readOnly}`, async t => {
  controlledClock(t);
  const rows = new Map();
  for (const n of [12, 24, 32, 64]) {
    const f = await eventTimeFixture(t), trusted = host();
    let calls = 0;
    const config = { version: 'context-read-v1', authority: trusted.authority,
      counter: { id: 'compact-cost-unit', countTokens() { calls++; return 1; } } };
    const writer = openMemoryCore({ path: f.path, contextRead: config }); t.after(() => writer.close());
    for (let i = 0; i < n; i++) ok(writer.admit({ namespace: ns, memory: { content: `telescope ${i}`, kind: 'fact' },
      receipts: [receipt(`statement-${i}`)] }));
    assert.equal(ok(await trusted.call(writer, 'refreshContextIndex', refresh())).status, 'complete');
    const core = readOnly ? openContextReader({ path: f.path, contextRead: config }) : writer;
    if (readOnly) t.after(() => core.close());
    const request = compactRequest({ readSet: [ns], deadlineMs: 5000, budget: { maxItems: n } });
    ok(await trusted.call(core, 'contextRead', { ...request, representation: 'representation-v2-dated', budget: { maxItems: 1 } }));
    const compact = await measureContentRead('contextRead', 'compact', () => trusted.call(core, 'contextRead', request), () => calls);
    const value = ok(compact.result);
    assert.equal(value.metered.items.length, n);
    assert.equal(value.diagnostics.candidates.count, n);
    assert.equal(compact.ports, 2 + 2 * n);
    assert.equal(value.diagnostics.trace.counterCalls, compact.ports);
    assert.ok(compact.ports <= 194);
    assert.ok((compact.sql.find(([sql]) => sql === epochQuery)?.[1] ?? 0) >= compact.ports, 'the measured E1 includes one observation per count');
    if (n <= 24) {
      const legacy = await measureContentRead('contextRead', 'dated',
        () => trusted.call(core, 'contextRead', { ...request, representation: 'representation-v2-dated' }), () => calls);
      assert.equal(ok(legacy.result).metered.items.length, n);
      assert.equal(compact.begin, legacy.begin);
      assert.equal(compact.statements - compact.ports, legacy.statements - legacy.ports);
    }
    rows.set(n, { statements: compact.statements - compact.ports, begin: compact.begin });
  }
  const baseline = rows.get(24), step = baseline.statements - rows.get(12).statements;
  assert.equal(baseline.begin, rows.get(12).begin);
  for (const n of [32, 64]) {
    const { statements, begin } = rows.get(n);
    assert.equal(12 * (statements - baseline.statements), (n - 24) * step,
      `n=${n} must match the 12-to-24 statement formula after counter observations`);
    assert.equal(begin, baseline.begin);
  }
});
