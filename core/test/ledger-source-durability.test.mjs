import test from 'node:test';
import assert from 'node:assert/strict';
import { openMemoryCore } from '../index.mjs';
import { createInMemoryLedgerPort, ledgerSourceKey, rowsFrom } from '../quantity-ledger.mjs';
import { controlledClock, counter, ns, ok } from '../testing/context-read-assembly-fixture.mjs';
import { host, policy } from '../testing/context-read-core-fixture.mjs';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';

const today = '2026-03-18T12:00:00.000Z';
const tea = 'Tea cost 6 USD';
const receipt = (eventId, excerpt = tea) => ({ client: 'test', sessionId: 'session', eventId, role: 'user', excerpt });
const quantity = { item: 0, kind: 'record', measure: 'spend', value: 6, unit: 'USD',
  group: 'food', category: 'tea', period: 'none', comparator: 'none' };

test('a preloaded port can supply ledger terms before any ledger writes', async t => {
  const f = fixture(t), original = f.open();
  const source = receipt('original');
  const { memory } = ok(original.admit({ namespace: ns, memory: { content: tea, kind: 'fact' }, receipts: [source] }));
  const { receipts: [stored] } = ok(original.get({ namespace: ns, memoryId: memory.id }));
  const rows = rowsFrom(memory, memory.revision, quantity, today).map(row =>
    ({ ...row, sourceKey: ledgerSourceKey(source), receiptId: stored.id }));
  const reader = f.open({ list: () => rows, put: assert.fail, drop: assert.fail });
  assert.match(await f.digest(reader), /\$6\.00 in 1 purchase/);
  assert.match(await f.digest(reader, 'How much was tea today?'), /\$6\.00 in 1 purchase/);
});

test('a slow probe with no matching rows preserves ordinary packing and its deadline', async t => {
  const clock = controlledClock(t), f = fixture(t);
  const port = createInMemoryLedgerPort();
  const core = f.open(port);
  await f.capture(core, 'original');
  const question = 'How much was granite today?';
  ok(core.admit({ namespace: ns, memory: { content: question, kind: 'fact' }, receipts: [receipt('granite', question)] }));
  const plain = f.open();
  await f.read(plain, 'granite');
  let scans = 0;
  const configured = f.open({ ...port, list(...args) {
    scans++;
    clock.advance(5000);
    return port.list(...args);
  } });
  await f.read(configured, 'granite');
  const baseline = await f.read(plain, question);
  assert.ok(baseline.metered.items.length);
  assert.equal(JSON.stringify(await f.read(configured, question)), JSON.stringify(baseline));
  assert.equal(scans, 1);
  await f.read(configured, 'How many pencils?');
  assert.equal(scans, 1);
});

test('a failed port call during exact dedup leaves every earlier amount readable', async t => {
  const f = fixture(t), stored = createInMemoryLedgerPort(), diagnostics = [];
  let failNext = false;
  const core = f.open({ ...stored, put(...args) {
    if (failNext) {
      failNext = false;
      throw new Error('write failed');
    }
    stored.put(...args);
  } }, { onDiagnostic: notice => diagnostics.push(notice) });
  const first = await f.capture(core, 'first');
  const [prior] = stored.list(ns, {});
  failNext = true;
  const second = await f.capture(core, 'second');
  assert.equal(second.id, first.id);
  assert.equal(diagnostics.filter(notice => notice.reason === 'ledger_write_failed').length, 1);
  const rows = stored.list(ns, {});
  assert.ok(rows.some(row => row.sourceKey === prior.sourceKey && row.value === prior.value));
  assert.equal(rows.reduce((sum, row) => sum + row.value, 0), 6);
  assert.match(await f.digest(core), /\$6\.00 in 1 purchase/);
});

test('exact dedup in a fresh runtime keeps preloaded rows and adds a new source', async t => {
  const f = fixture(t), stored = createInMemoryLedgerPort();
  const original = f.open(stored);
  const first = await f.capture(original, 'first');
  original.close();
  const coldPort = { put: stored.put, list: stored.list, drop: stored.drop };
  const reopened = f.open(coldPort);
  const second = await f.capture(reopened, 'second');
  assert.equal(second.id, first.id);
  assert.equal(stored.list(ns, {}).length, 2);
  assert.match(await f.digest(reopened), /\$12\.00 in 2 purchases/);
});

test('retained rows from retired sources are rejected even after a same-text correction', async t => {
  for (const action of ['correct', 'same-text correction', 'forget', 'supersede']) await t.test(action, async t => {
    const f = fixture(t), stored = createInMemoryLedgerPort();
    const core = f.open({ ...stored, drop() {} });
    const memory = await f.capture(core, 'original');
    assert.match(await f.digest(core), /\$6\.00/);
    const input = { namespace: ns, memoryId: memory.id, expectedRevision: memory.revision };
    if (action === 'forget') ok(core.forget(input));
    else if (action === 'supersede') ok(core.supersede({ ...input,
      replacement: { kind: 'fact', content: 'Made tea at home' }, receipts: [receipt('replacement', 'Made tea at home')] }));
    else {
      const content = action === 'correct' ? 'Made tea at home' : tea;
      ok(core.correct({ ...input, kind: 'fact', content, receipt: receipt('original', content) }));
    }
    assert.equal(stored.list(ns, {}).length, 1);
    assert.equal(await f.digest(core), undefined);
  });
});

function fixture(t) {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse(today) });
  const workspace = createTestWorkspace(t), trusted = host();
  const options = { path: workspace.path + '/memory.sqlite',
    contextRead: { version: 'context-read-v1', authority: trusted.authority, policy: policy(), counter } };
  const model = { contextWindow: 8192, countTokens: () => 1, extract: () => ({
    items: [{ content: tea, kind: 'fact', confidence: 0.9, sourceIndices: [0] }], quantities: [quantity],
  }) };
  const keep = handle => { workspace.defer(() => handle.close()); return handle; };
  const read = async (reader, query) => ok(await trusted.call(reader, 'contextRead', { readSet: [ns], query,
    intent: 'current', types: ['memory'], representation: 'memory-compact-v1', raw: false, deadlineMs: 5000 }));
  return {
    open: (ledgerPort, overrides) => keep(openMemoryCore({ ...options, ledgerPort, model: { ...model, ...overrides } })),
    async capture(core, id) {
      return ok(await core.capture({ namespace: ns, client: 'test', sessionId: 'session', eventId: id,
        messages: [{ id, role: 'user', content: tea, occurredAt: today }] })).admission.memories[0];
    },
    async digest(reader, query = 'Total tea spending today') {
      return (await read(reader, query)).metered.items.find(item => item.channel === 'ledger-v1')?.body;
    },
    read,
  };
}
