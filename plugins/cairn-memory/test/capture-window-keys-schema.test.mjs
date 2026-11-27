import assert from 'node:assert/strict';
import test from 'node:test';
import { conforms as pluginConforms } from '../lib/hosted-contract.mjs';
import { conforms as sourceConforms } from '../../../integrations/client/hosted-contract.mjs';
import { conforms as installedConforms } from '../../../packages/setup/runtime/integrations/client/hosted-contract.mjs';

for (const [label, conforms] of [['plugin', pluginConforms], ['source', sourceConforms], ['installed', installedConforms]]) {
  test(`${label}: legacy and modern capture bounds validate with optional keys`, () => {
    const legacy = { id: 'a'.repeat(64), slice: 1, slices: 1, initial: true };
    const modern = { ...legacy, start: 10, end: 20, final: true, parser: 1 };
    const accepts = window => conforms('capture-request', {
      client: 'claude-code', event_id: 'synthetic-event', session_id: 'synthetic-session',
      messages: [{ id: 'message', role: 'user', content: 'Synthetic message' }], window,
    });
    for (const window of [legacy, modern, { ...legacy, start: 0 }, { ...legacy, end: 1 },
      { ...modern, start: 0, end: 1, final: false, parser: 1000 }]) {
      assert.equal(accepts(window), true, JSON.stringify(window));
    }
    for (const patch of [{ end: 10 }, { end: 9 }, { start: -1 }, { end: 0, start: 0 },
      { final: 1 }, { parser: 0 }, { parser: 1001 }, { parser: 1.5 }, { unknown: true }]) {
      assert.equal(accepts({ ...modern, ...patch }), false, JSON.stringify(patch));
    }
    assert.equal(accepts({ ...legacy, end: 0 }), false);
  });
}
