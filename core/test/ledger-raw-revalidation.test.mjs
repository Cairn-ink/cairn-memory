import test from 'node:test';
import assert from 'node:assert/strict';
import { openMemoryCore } from '../index.mjs';
import { host, ns, ok, refresh } from '../testing/context-read-core-fixture.mjs';
import { controlledClock, counter } from '../testing/context-read-assembly-fixture.mjs';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';

const sentinel = /orchid raw delivery sentinel/;

test('Raw grants are revalidated after a ledger list probe', async t => {
  let revoked = false;
  const { read } = await fixture(t, { list() { revoked = true; return []; } }, () => revoked);
  assert.match(JSON.stringify(ok(await read('orchid'))), sentinel);
  const result = await read('How much orchid today?');
  assert.equal(revoked, true);
  assert.doesNotMatch(JSON.stringify(result), sentinel);
});

test('Raw grants are revalidated after a ledger terms probe', async t => {
  let revoked = false;
  const { read } = await fixture(t, {
    terms() { revoked = true; return []; },
    list: assert.fail,
  }, () => revoked);
  assert.match(JSON.stringify(ok(await read('orchid'))), sentinel);
  const result = await read('How many orchids today?');
  assert.equal(revoked, true);
  assert.doesNotMatch(JSON.stringify(result), sentinel);
});

test('a timed-out ledger probe retains the valid ordinary Raw pack', async t => {
  const clock = controlledClock(t);
  const { read, plain } = await fixture(t, { list() { clock.advance(5000); return []; } }, () => false);
  const question = 'How much orchid today?';
  const baseline = ok(await plain(question));
  assert.match(JSON.stringify(baseline), sentinel);
  assert.equal(JSON.stringify(ok(await read(question))), JSON.stringify(baseline));
});

async function fixture(t, reader, revoked) {
  const workspace = createTestWorkspace(t), trusted = host();
  const text = 'orchid raw delivery sentinel';
  const candidate = { namespace: ns, conversationId: 'raw-probe', messageId: 'turn' };
  const value = { ...candidate, role: 'user',
    ranges: [{ source: { span: { start: 0, end: text.length } }, text }] };
  const rawSearch = {
    async search() { return { candidates: [candidate], coverage: { status: 'complete' } }; },
    async prepare() { return { value }; },
    revalidate(handles) {
      if (revoked()) throw new Error('Raw grant revoked');
      return handles.map(handle => handle.value);
    },
  };
  const contextRead = { version: 'context-read-v1', authority: trusted.authority, counter, rawSearch };
  const open = ledgerPort => {
    const core = openMemoryCore({ path: workspace.path + '/probe.sqlite', ledgerPort, contextRead });
    workspace.defer(() => core.close());
    return core;
  };
  const configured = open({ put() {}, drop() {}, ...reader }), ordinary = open();
  for (let i = 0; i < 5; i++) {
    if (ok(await trusted.call(configured, 'refreshContextIndex', refresh())).status === 'complete') break;
  }
  const read = core => query => trusted.call(core, 'contextRead', {
    readSet: [ns], types: ['memory'], intent: 'current', query, raw: true, deadlineMs: 5000,
  });
  return { read: read(configured), plain: read(ordinary) };
}
