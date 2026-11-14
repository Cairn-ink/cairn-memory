import test from 'node:test';
import assert from 'node:assert/strict';
import { workerFixture } from './fixtures/local-worker-workspace.mjs';
import { claude, codex } from './fixtures/raw-fixtures.mjs';

for (const client of ['claude-code', 'codex']) test(`hosted metadata changes preserve non-HTTP ${client} capture through engine validation`, async t => {
  const row = client === 'codex' ? codex('Synthetic local message') : claude('Synthetic local message');
  row.timestamp = new Date().toISOString();
  const f = workerFixture(t, { client, rows: client === 'codex' ? [] : [row] });
  f.providerMode('memory');
  async function call(action, options) {
    const result = await f.runWorker(action, options).done;
    assert.equal(result.code, 0, result.stderr); assert.equal(result.signal, null);
    return JSON.parse(result.stdout);
  }
  // This format now requires an EOF boundary before new local messages.
  if (client === 'codex') {
    const refused = await call('initialize', { start: 'beginning' });
    assert.equal(refused.status, 'blocked'); assert.equal(refused.reason, 'invalid_input');
  }
  assert.equal((await call('initialize', { start: client === 'codex' ? 'eof' : 'beginning' })).status, 'ready');
  if (client === 'codex') f.writeSource([row]);
  const captured = await call('run');
  assert.equal(captured.status, 'progress', JSON.stringify(captured)); assert.equal(captured.savedParts, 1);
  assert.equal(captured.hasPending, false);
  const calls = f.calls().length;
  assert.ok(f.calls().some(call => call.method === 'cairn_extract' && !call.count));
  assert.equal((await call('run')).status, 'ready');
  assert.equal(f.calls().length, calls);
  assert.equal(f.childrenStopped(), true);
});
