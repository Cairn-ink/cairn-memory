import test from 'node:test';
import assert from 'node:assert/strict';
import { openContextReader, openMemoryCore } from '../index.mjs';
import { createInMemoryLedgerPort } from '../quantity-ledger.mjs';
import { controlledClock, counter, ns, ok } from '../testing/context-read-assembly-fixture.mjs';
import { host, policy } from '../testing/context-read-core-fixture.mjs';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';

const today = '2026-03-18T12:00:00.000Z';
const yesterday = '2026-03-17T12:00:00.000Z';
const tea = 'tea 6 USD';
const quantity = item => ({ item, kind: 'record', measure: 'spend', value: 6, unit: 'USD',
  group: 'food', category: 'tea', period: 'none', comparator: 'none' });
const receipt = { client: 'test', sessionId: 'session', eventId: 'replacement', role: 'user', excerpt: 'I drank water.' };

test('retired revisions stay out of the digest when the port keeps their rows', async t => {
  for (const retire of ['forget', 'supersede', 'correct']) await t.test(retire, async t => {
    const port = { ...createInMemoryLedgerPort(), drop() {} };
    const { capture, core, ledger } = fixture(t, port, {
      extract: ({ input }) => {
        const { content } = input.messages[0];
        return { items: [{ content, kind: 'fact', confidence: 0.9, sourceIndices: [0] }],
          quantities: [{ ...quantity(0), value: content === tea ? 6 : 9 }] };
      },
    });
    await capture('another', today, 'another', 'tea 9 USD');
    const { admission: { memories: [memory] } } = await capture('tea');
    assert.match((await ledger()).body, /\$15\.00/);
    const input = { namespace: ns, memoryId: memory.id, expectedRevision: memory.revision };
    if (retire === 'forget') ok(core.forget(input));
    if (retire === 'supersede') ok(core.supersede({ ...input,
      replacement: { content: receipt.excerpt, kind: 'fact' }, receipts: [receipt] }));
    if (retire === 'correct') ok(core.correct({ ...input, content: receipt.excerpt, kind: 'fact', receipt }));
    assert.equal(port.list(ns, {}).length, 2);
    const digest = await ledger();
    assert.match(digest.body, /\$9\.00/);
    assert.ok(!digest.sources.includes(memory.id));
  });
});

test('the default layout uses the source date for a backdated capture', async t => {
  const { capture, ledger } = fixture(t);
  await capture('tea', yesterday);
  assert.match((await ledger('Total tea spending yesterday'))?.body ?? '', /\$6\.00/);
  assert.equal(await ledger('Total tea spending today'), undefined);
});

test('exact dedup retains each distinct message on the same or different days', async t => {
  for (const firstDate of [yesterday, today]) await t.test(firstDate === today ? 'same day' : 'different days', async t => {
    const port = createInMemoryLedgerPort();
    const { capture, core, ledger } = fixture(t, port);
    const first = await capture('first', firstDate);
    const second = await capture('second');
    const [memory] = second.admission.memories;
    assert.equal(memory.id, first.admission.memories[0].id);
    assert.match((await ledger('Total tea spending last 2 days')).body, /\$12\.00 in 2 purchases/);
    assert.match((await ledger('Total tea spending today')).body, firstDate === today ? /\$12\.00/ : /\$6\.00/);
    ok(core.forget({ namespace: ns, memoryId: memory.id, expectedRevision: memory.revision }));
    assert.deepEqual(port.list(ns, {}), []);
  });
});

test('replaying a capture or resubmitting the message does not add an amount', async t => {
  const { capture, ledger } = fixture(t);
  await capture('first');
  assert.equal((await capture('first')).duplicate, true);
  await capture('first', today, 'resubmitted');
  assert.match((await ledger()).body, /\$6\.00 in 1 purchase/);
});

test('a failed post-commit write leaves the capture and later writes intact', async t => {
  const port = createInMemoryLedgerPort(), diagnostics = [];
  let attempts = 0;
  const { capture, core, ledger } = fixture(t, { ...port, put(...args) {
    if (++attempts === 1) throw new Error('observer should not see this');
    port.put(...args);
  } }, {
    onDiagnostic: notice => diagnostics.push(notice),
    extract: () => ({
      items: [tea, 'cake 6 USD', 'juice 6 USD'].map(content => ({ content, kind: 'fact', confidence: 0.9, sourceIndices: [0] })),
      quantities: [quantity(0), { ...quantity(1), category: 'cake' }, { ...quantity(2), category: 'juice' }],
    }),
  });
  const result = await capture('lunch');
  assert.equal(result.duplicate, false);
  assert.equal(result.admission.memories.length, 3);
  for (const memory of result.admission.memories) ok(core.get({ namespace: ns, memoryId: memory.id }));
  assert.equal(attempts, 3);
  assert.deepEqual(diagnostics.filter(({ reason }) => reason === 'ledger_write_failed'),
    [{ version: 1, stage: 'extract', layer: 'core_call', reason: 'ledger_write_failed' }]);
  assert.doesNotMatch(JSON.stringify(diagnostics), /observer should not see this|lunch|cake|juice/);
  assert.deepEqual(port.list(ns, {}).map(row => row.category).sort(), ['cake', 'juice']);
  assert.match((await ledger('Total food spending today')).body, /\$12\.00/);
});

test('a cue without a ledger term performs no port call or deadline work', async t => {
  const clock = controlledClock(t), port = createInMemoryLedgerPort();
  let scans = 0;
  const { capture, configured, core, path, read } = fixture(t, { ...port, list(...args) {
    scans++;
    clock.advance(5000);
    return port.list(...args);
  } });
  await capture('tea');
  const query = 'How many pencils?';
  ok(core.admit({ namespace: ns, memory: { content: query, kind: 'fact' },
    receipts: [{ ...receipt, excerpt: query }] }));
  await read('pencils');
  const plain = openContextReader({ path, contextRead: configured });
  t.after(() => plain.close());
  const baseline = await read(query, plain);
  assert.ok(baseline.metered.items.length > 0);
  const actual = await read(query);
  assert.equal(JSON.stringify(actual.metered), JSON.stringify(baseline.metered));
  assert.equal(scans, 0);
});

function fixture(t, ledgerPort = createInMemoryLedgerPort(), overrides = {}) {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse(today) });
  const workspace = createTestWorkspace(t), trusted = host();
  const path = workspace.path + '/memory.sqlite';
  const configured = { version: 'context-read-v1', authority: trusted.authority, policy: policy(), counter };
  const model = { contextWindow: 8192, countTokens: () => 1, extract: () => ({
    items: [{ content: tea, kind: 'fact', confidence: 0.9, sourceIndices: [0] }], quantities: [quantity(0)],
  }), ...overrides };
  const core = openMemoryCore({ path, ledgerPort, model, contextRead: configured });
  workspace.defer(() => core.close());
  const capture = async (id, occurredAt = today, eventId = id, content = tea) => ok(await core.capture({
    namespace: ns, client: 'test', sessionId: 'session', eventId,
    messages: [{ id, role: 'user', occurredAt, content }],
  }));
  const read = async (query, reader = core) => ok(await trusted.call(reader, 'contextRead', {
    readSet: [ns], query, intent: 'current', types: ['memory'],
    representation: 'memory-compact-v1', raw: false, deadlineMs: 5000,
  }));
  const ledger = async (query = 'Total tea spending today') =>
    (await read(query)).metered.items.find(item => item.channel === 'ledger-v1');
  return { capture, configured, core, ledger, path, read };
}
