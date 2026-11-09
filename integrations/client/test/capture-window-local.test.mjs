import test from 'node:test';
import assert from 'node:assert/strict';
import { workerFixture } from './fixtures/local-worker-workspace.mjs';
import { claude, codex } from './fixtures/raw-fixtures.mjs';

for (const client of ['claude-code', 'codex']) test(`hosted metadata changes preserve non-HTTP ${client} capture through engine validation`, async t => {
  const row = client === 'codex' ? codex('Synthetic local message') : claude('Synthetic local message');
  row.timestamp = '2026-01-02T03:04:05.000Z';
  const f = workerFixture(t, { client, rows: [row] });
  f.providerMode('memory');
  async function call(action, options) {
    const result = await f.runWorker(action, options).done;
    assert.equal(result.code, 0, result.stderr); assert.equal(result.signal, null);
    return JSON.parse(result.stdout);
  }
  assert.equal((await call('initialize', { start: 'beginning' })).status, 'ready');
  const captured = await call('run');
  assert.equal(captured.status, 'progress'); assert.equal(captured.savedParts, 1);
  assert.equal(captured.hasPending, false);
  assert.equal((await call('run')).status, 'ready');
  assert.equal(f.calls().length, 2);
  assert.equal(f.childrenStopped(), true);
});
