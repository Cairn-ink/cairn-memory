import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { assertObserverParity, runObserverProbe } from './phase-observer-probe.mjs';

const adapterPath = fileURLToPath(new URL('../index.mjs', import.meta.url));

test('O1/O3 actual adapter subprocess handles own-catch rejections with healthy and invalid-output parity', t => {
  const owner = createTestWorkspace(t, { prefix: 'cairn-observer-parity-' });
  assertObserverParity(owner, adapterPath);
});

test('O5 actual observer subprocess assertion failure removes owned scratch', t => {
  const owner = createTestWorkspace(t, { prefix: 'cairn-observer-failure-' });
  const child = runObserverProbe(owner, adapterPath, 'enabled', false, true);
  assert.equal(child.status, 1);
  assert.match(child.stderr, /synthetic_cleanup_assertion/u);
  assert.equal(child.report.requests, 2);
  assert.equal(child.report.events, 7);
  assert.equal(child.report.unhandled, 0);
});
