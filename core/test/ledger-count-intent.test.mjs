import test from 'node:test';
import assert from 'node:assert/strict';
import { openMemoryCore } from '../index.mjs';
import { createInMemoryLedgerPort } from '../quantity-ledger.mjs';
import { controlledClock, counter, ns, ok } from '../testing/context-read-assembly-fixture.mjs';
import { host, policy } from '../testing/context-read-core-fixture.mjs';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';

test('a stored coffee category makes a count question eligible before listing rows', async t => {
  const { capture, read, stored, scans } = fixture(t);
  await capture();
  const configured = read({ ...stored, list: scans.list });
  const result = await configured('How many coffees today?');
  assert.match(result.metered.items.find(item => item.channel === 'ledger-v1')?.body ?? '', /Coffee: \$6\.00 in 1 record\b/);
  assert.equal(scans.count, 1);
});

test('a legacy port can still deliver a count question by listing rows', async t => {
  const { capture, read, stored, scans } = fixture(t);
  await capture();
  const result = await read({ put: stored.put, drop: stored.drop, list: scans.list })('How many coffees today?');
  assert.ok(result.metered.items.some(item => item.channel === 'ledger-v1'));
  assert.equal(scans.count, 1);
});

test('an unmatched count question keeps the entire ordinary pack without listing rows', async t => {
  controlledClock(t);
  const { capture, read, stored, scans } = fixture(t);
  await capture();
  const configured = read({ ...stored, list: scans.list }), plain = read();
  await configured('pencils');
  await plain('pencils');
  const baseline = await plain('How many pencils?');
  assert.ok(baseline.metered.items.length);
  assert.equal(JSON.stringify(await configured('How many pencils?')), JSON.stringify(baseline));
  assert.equal(scans.count, 0);
});

function fixture(t) {
  const now = '2026-03-18T12:00:00.000Z';
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse(now) });
  const workspace = createTestWorkspace(t), trusted = host(), stored = createInMemoryLedgerPort();
  const contextRead = { version: 'context-read-v1', authority: trusted.authority, policy: policy(), counter };
  const model = { contextWindow: 8192, countTokens: () => 1, extract: () => ({
    items: [{ content: 'Coffee cost 6 USD', kind: 'fact', confidence: 0.9, sourceIndices: [0] }],
    quantities: [{ item: 0, kind: 'record', measure: 'spend', category: 'coffee', value: 6, unit: 'USD',
      group: 'food', period: 'none', comparator: 'none' }],
  }) };
  function open(ledgerPort) {
    const core = openMemoryCore({ path: workspace.path + '/memory.sqlite', model, contextRead, ledgerPort });
    workspace.defer(() => core.close());
    return core;
  }
  const writer = open(stored);
  const scans = { count: 0, list(...args) { scans.count++; return stored.list(...args); } };
  return {
    stored, scans,
    async capture() {
      ok(await writer.capture({ namespace: ns, client: 'test', sessionId: 'session', eventId: 'coffee',
        messages: [{ id: 'cup', role: 'user', content: 'Coffee cost 6 USD', occurredAt: now }] }));
      ok(writer.admit({ namespace: ns, memory: { content: 'How many pencils?', kind: 'fact' },
        receipts: [{ client: 'test', sessionId: 'session', eventId: 'pencils', role: 'user', excerpt: 'How many pencils?' }] }));
    },
    read(ledgerPort) {
      const core = open(ledgerPort);
      return async query => ok(await trusted.call(core, 'contextRead', { readSet: [ns], query,
        intent: 'current', types: ['memory'], representation: 'memory-compact-v1', raw: false, deadlineMs: 5000 }));
    },
  };
}
