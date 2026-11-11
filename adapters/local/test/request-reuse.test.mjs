// Synthetic regression for overlapping calls reusing one caller-owned object.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, ok } from '../../../adapters/local/test/fixtures/workspace.mjs';
import { openMemoryCore } from '../../../core/index.mjs';
import { localPlainPort } from '../../../core/testing/raw-capture-fixtures.mjs';

test('arrival decisions must belong to an invocation, not a reusable request object', async t => {
  const f = fixture(t, { client: 'claude-code' });
  const privacy = openMemoryCore({ path: f.databasePath, raw: true, rawSearch: false });
  f.workspace.defer(() => privacy.close());
  const memory = ok(privacy.admit({ namespace: f.namespace, memory: { content: 'Synthetic fact', kind: 'fact' },
    receipts: [{ client: 'claude-code', sessionId: 'explicit-tool', eventId: 'synthetic-save', role: 'user', excerpt: 'Synthetic fact' }] })).memory;
  let enter, release;
  const entered = new Promise(resolve => { enter = resolve; });
  const held = new Promise(resolve => { release = resolve; });
  const base = localPlainPort();
  const core = openMemoryCore({ path: f.databasePath, rawSearch: false,
    rawConversations: { mode: 'raw-v1', capBytes: 1000000, configureCap: false,
      interpretation: 'host', localAuthority: f.config.authority,
      readPolicy: () => ({ generation: 'synthetic', reason: null }),
      port: { ...base, async sealRaw(value) {
        if (value.context.messageId !== 'first-message') return base.sealRaw(value);
        enter(); await held; throw Error('synthetic seal failure');
      } } } });
  f.workspace.defer(() => core.close());
  const at = new Date().toISOString();
  const message = (id, occurredAt, ordinal = 1) => ({ id, role: 'user', occurredAt, messageOrdinal: ordinal,
    content: 'copper source', part: { index: 0, start: 0, totalUnits: 13, totalBytes: 13 } });
  const request = { namespace: f.namespace, client: 'claude-code', sessionId: 'first-session', eventId: 'first-event',
    messages: [message('first-message', at)] };
  const first = core.captureRaw(request);
  await entered;
  ok(privacy.forget({ namespace: f.namespace, memoryId: memory.id, expectedRevision: memory.revision }));
  // Caller-owned data can be reused after the first call detached it.
  Object.assign(request, { sessionId: 'second-session', eventId: 'second-event', messages: [message('second-message', at)] });
  const second = await core.captureRaw(request);
  assert.equal(second.error.code, 'conversation_deleted');
  release();
  const failed = await first;
  assert.equal(failed.error.code, 'conversation_deleted', 'first invocation still needs its own detached fence decision');
  const late = await core.captureRaw({ namespace: f.namespace, client: 'claude-code', sessionId: 'first-session', eventId: 'late-event',
    messages: [message('late-message', new Date(Date.parse(at) + 7200000).toISOString(), 2)] });
  assert.equal(late.error.code, 'conversation_deleted');
});
