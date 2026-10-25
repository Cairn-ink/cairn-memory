import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { rm } from 'node:fs/promises';
import { fixture } from './fixtures/pack.mjs';
import { verifyPack } from '../pack.mjs';
import { startBundle } from '../bundle.mjs';
import { spawnNode } from '../process.mjs';
async function bundle(t, options = {}) {
  const f = await fixture(), pack = await verifyPack(f.root, { catalog: f.catalog });
  let b;
  try { b = await startBundle(pack, 4, { spawn: () => spawnNode(fileURLToPath(new URL('./fixtures/supervisor.mjs', import.meta.url)), [f.root], { stdio: ['pipe', 'pipe', 'pipe', 'pipe'] }), ...options }); }
  catch (error) { await rm(f.parent, { recursive: true, force: true }); throw error; }
  t.after(async () => { await b.close(); await rm(f.parent, { recursive: true, force: true }); }); return { b, f };
}
test('L07/L08 independent supervisor, valid counts at both boundaries, stderr flood and idempotent close', async t => {
  const { b } = await bundle(t);
  assert.deepEqual(b.localStatus(), { state: 'ready', reason: null });
  for (const text of ['tokens:[1]', 'tokens:[8192]', 'stderr']) { const vectors = await b.embed([text]); assert.equal(vectors[0][0], 1); }
  await b.close(); await b.close(); assert.deepEqual(b.localStatus(), { state: 'closed', reason: 'closed' }); assert.equal(b.diagnostics().exited, true);
});
test('L07 invalid successful token counts poison before vector acceptance', async t => {
  for (const count of [[], [1, 2], '1', null, [1.5], [-1], [0], [9007199254740992], [8193], ['1']]) {
    const { b } = await bundle(t);
    await assert.rejects(b.embed(['tokens:' + JSON.stringify(count)]), { code: 'protocol_error' });
    assert.deepEqual(b.localStatus(), { state: 'unavailable', reason: 'protocol_error' }); assert.equal(b.diagnostics().exited, true);
  }
});
test('L08 operation abort reaps before settlement and no automatic restart follows crash', async t => {
  const { b } = await bundle(t), controller = new AbortController();
  const pending = b.embed(['stall'], { signal: controller.signal });
  controller.abort(); await assert.rejects(pending, { code: 'timeout' });
  // Abort before transmission may preserve the warm bundle.
  await b.close(); assert.equal(b.diagnostics().exited, true);
  const second = await bundle(t);
  await assert.rejects(second.b.embed(['crash']), { code: 'child_crash' }); assert.equal(second.b.diagnostics().exited, true);
  await assert.rejects(second.b.embed(['late']), { code: 'provider_error' });
});
