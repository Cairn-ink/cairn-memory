import assert from 'node:assert/strict';
import test from 'node:test';
import { conforms as pluginConforms } from '../lib/hosted-contract.mjs';

import { conforms as sourceConforms } from '../../../integrations/client/hosted-contract.mjs';
import { conforms as installedConforms } from '../../../packages/setup/runtime/integrations/client/hosted-contract.mjs';

for (const [label, conforms] of [['plugin', pluginConforms], ['source', sourceConforms], ['installed', installedConforms]])
test(`${label}: optional capture metadata accepts source time and bounded strict windows`, () => {
  const body = { client: 'claude-code', event_id: 'synthetic-event', session_id: 'synthetic-session',
    messages: [{ id: 'message', role: 'user', content: 'Synthetic message', occurred_at: '2020-01-02T03:04:05.123456+00:00' }],
    sent_at: '2026-01-02T03:04:05.000Z', window: { id: 'a'.repeat(64), slice: 1, slices: 2, initial: true } };
  assert.equal(conforms('capture-request', body), true);
  assert.equal(conforms('capture-request', { ...body, window: { ...body.window, slice: 1, slices: 1 } }), true);
  for (const time of ['2026-01-02T03:04:05+08:00', '2026-01-02T03:04:05-05:30', '2026-01-02T03:04:05.123456789Z',
    '2000-02-29T23:59:59.123456789Z', '2024-02-29T00:00:00.1+23:59']) {
    assert.equal(conforms('capture-request', { ...body, messages: [{ ...body.messages[0], occurred_at: time }] }), true);
  }
  const legacy = structuredClone(body); delete legacy.sent_at; delete legacy.window; delete legacy.messages[0].occurred_at;
  assert.equal(conforms('capture-request', legacy), true);
  assert.equal(conforms('capture-request', { ...body, window: { ...body.window, slice: 4096, slices: 4096 } }), true);
  for (const patch of [{ slice: 2, slices: 1 }, { slice: 0 }, { slice: 4097 }, { slices: 4097 }, { slice: 1.5 }, { initial: 1 },
    { id: 'x'.repeat(129) }, { unknown: true }]) {
    assert.equal(conforms('capture-request', { ...body, window: { ...body.window, ...patch } }), false);
  }
  for (const time of ['', 'invalid', '2026-01-02', '2026-01-02T03:04:05.1234567890Z',
    '2026-01-02T03:04:05.123456789000000+00:00', 'x'.repeat(41),
    '2026-11-10T24:00:00Z', '2026-02-30T00:00:00Z', '1900-02-29T00:00:00Z',
    '2024-01-01T00:60:00Z', '2024-01-01T00:00:60Z', '2024-01-01T00:00:00+24:00',
    '2024-01-01T00:00:00+00:60']) {
    assert.equal(conforms('capture-request', { ...body, messages: [{ ...body.messages[0], occurred_at: time }] }), false);
  }
  for (const time of ['', 'invalid', '2026-01-02', 'x'.repeat(41)]) {
    assert.equal(conforms('capture-request', { ...body, sent_at: time }), false);
  }
});
