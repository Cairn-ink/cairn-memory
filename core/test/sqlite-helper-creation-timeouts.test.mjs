import '../testing/context-product-test-clock.mjs';
import { faults } from './fixtures/sqlite-helper-child-faults.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { lstatSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { createExclusiveSqliteFile } from '../sqlite-journal-probe.mjs';
import { productFailure } from '../context-product-reader.mjs';
import { openContextSemanticCoordinator, openContextIndexMaintainer, openContextProductReader, createContextReadSupervisor } from '../index.mjs';
import { fixture, ns, ok } from '../testing/context-read-fixture.mjs';
import { setupProductSemantic } from '../testing/content-safety-s2h-product-semantic-probe.mjs';
import { credentialDigest, PRODUCT_PROFILE } from '../context-product-control.mjs';
import { PRODUCT_SIDECAR_SUFFIX } from '../context-product-sidecar.mjs';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';

const input = { readSet: [ns], types: ['memory'], intent: 'current', deadlineMs: 5000 };
const refresh = { readSet: [ns], types: ['memory'], intent: 'current', mode: 'lexical', budget: { maxItems: 1024, maxMs: 5000 } };
function configured(t, path, service = true) {
  const supervisor = createContextReadSupervisor(); t.after(() => supervisor.close());
  const token = { opaque: randomUUID() }, ids = { requestId: randomUUID(), handleId: randomUUID(), credentialBindingId: randomUUID(), credentialExpiresUtcMs: null };
  const coverage = { policy: 'recent-projects-v1', selectionRevision: 'synthetic', requestedNamespaces: 1, selectedNamespaces: 1, omittedNamespaces: 0 };
  const binding = { kind: service ? 'service' : 'request', ...(service ? { serviceId: randomUUID(), credentialBindingId: ids.credentialBindingId, credentialExpiresUtcMs: null } : ids),
    credentialDigest: credentialDigest(token), ownerId: ns.ownerId, namespaces: { readSet: [ns], ownerCoverage: coverage }, issuedAt: 0 };
  const state = new SharedArrayBuffer(32); new Int32Array(state)[0] = 1; new Int32Array(state)[3] = 1;
  return { token, async open() {
    const handle = await (service ? openContextIndexMaintainer : openContextProductReader)({ supervisor, path, version: 'context-read-v1', profile: PRODUCT_PROFILE, readSet: [ns], ownerCoverage: coverage,
      ...(service ? { sidecarJournalMode: 'DELETE' } : { requestControl: { ...ids, requestMaxMs: 5000 } }),
      host: { moduleUrl: new URL('../testing/context-product-index-host.mjs', import.meta.url).href,
        configuration: { [service ? 'serviceBinding' : 'requestBinding']: binding, state, ...(!service ? { requestReservation: new SharedArrayBuffer(4) } : {}) } } });
    t.after(() => handle.close()); return handle;
  } };
}
const busy = (result, marker) => assert.deepEqual(result, { ok: false, error: { code: 'storage_busy', retryable: true } }, marker);
async function build(handle, token) {
  for (let i = 0; i < 100; i++) if (ok(await handle.refreshContextIndex(refresh, token)).status === 'complete') return;
  assert.fail('RETRY_INITIALIZATION_DID_NOT_COMPLETE');
}

test('SEMANTIC_CREATION_BUSY: native coordinator ownership timeout preserves its retryable worker result', async t => {
  const s = await setupProductSemantic(t, { open: false, corpus: 0 });
  faults.arm(1); t.after(() => faults.reset());
  await assert.rejects(openContextSemanticCoordinator(s.options), error => {
    assert.equal(faults.counts.reached, 1, 'ownership child reached its post-create delay');
    assert.equal(error.code, 'storage_busy', 'SEMANTIC_CREATION_BUSY'); return true;
  });
  assert.equal(faults.counts.readyBusy, 1, 'SEMANTIC_READY_RETRYABLE');
});

for (const site of [2, 3]) for (const header of [false, true])
test(`CREATION_BUSY site=${site} leftover=${header ? 'header-no-schema' : 'zero-byte'}: retry cleans the killed child stage`, async t => {
  const f = fixture(t); f.admit('synthetic timeout retry evidence');
  const c = configured(t, f.path), h = await c.open();
  faults.arm(site, 1, header); t.after(() => faults.reset());
  const failed = await h.refreshContextIndex(refresh, c.token);
  assert.equal(faults.counts.reached, 1, 'child created its stage before timeout');
  const stages = readdirSync(f.workspace.path).filter(name => name.includes('.cairn-create-'));
  assert.equal(stages.length, 1, 'one killed child stage');
  assert.equal(lstatSync(join(f.workspace.path, stages[0])).size > 0, header, 'actual leftover shape');
  const shape = spawnSync(process.execPath, ['--input-type=module', '-e', "import {DatabaseSync} from 'node:sqlite'; const d=new DatabaseSync(process.argv[1],{readOnly:true}); console.log(d.prepare('SELECT count(*) n FROM sqlite_schema').get().n);d.close();", join(f.workspace.path, stages[0])], { encoding: 'utf8', env: {} });
  assert.equal(shape.status, 0, shape.stderr); assert.equal(shape.stdout.trim(), '0', 'no initialized schema');
  busy(failed, 'CREATION_BUSY');
  await build(h, c.token);
  const files = readdirSync(f.workspace.path).sort();
  assert.deepEqual(files, [basename(f.path), basename(f.path) + PRODUCT_SIDECAR_SUFFIX, basename(f.path) + PRODUCT_SIDECAR_SUFFIX + '.lifecycle-lock.sqlite'].sort(), 'RETRY_NO_ORPHANS');
  console.log(JSON.stringify({ marker: 'RETRY_NO_ORPHANS', site, header, files }));
  const r = configured(t, f.path, false), reader = await r.open();
  assert.equal(ok(await reader.getContextIndexStatus(input, r.token)).lexical.state, 'ready', 'retry publishes a fully initialized sidecar');
});

for (const observed of [false, true]) test(`CREATION_TIMEOUT_CAUSE observed=${observed}: errno only, safe same-path retry`, t => {
  const w = createTestWorkspace(t), path = join(w.path, 'synthetic.sqlite');
  faults.arm(5); t.after(() => faults.reset());
  assert.throws(() => createExclusiveSqliteFile(path, undefined, undefined, observed ? { observe: work => work() } : undefined), error => {
    assert.equal(faults.counts.reached, 1);
    assert.equal(error.code, 'storage_busy', 'CREATION_TIMEOUT_CAUSE');
    assert.equal(error.cause, 'ETIMEDOUT', 'CREATION_TIMEOUT_PRIVATE_CAUSE'); return true;
  });
  createExclusiveSqliteFile(path);
  assert.deepEqual(readdirSync(w.path), ['synthetic.sqlite'], 'generic retry cleans dead stages');
});

for (const mode of [2, 3, 4]) for (const observed of [false, true])
test(`CREATION_OTHER_ERROR mode=${mode} observed=${observed}: content-free cause`, t => {
  const w = createTestWorkspace(t), path = join(w.path, 'synthetic.sqlite');
  faults.arm(5, mode); t.after(() => faults.reset());
  const options = observed ? { observe: work => work() } : undefined;
  assert.throws(() => createExclusiveSqliteFile(path, undefined, undefined, options), error => {
    assert.equal(error.code, 'storage_error', 'CREATION_OTHER_ERROR');
    assert.equal(error.cause, mode === 2 ? 'EIO' : mode === 3 ? 'SIGTERM' : 'ENOENT', 'CREATION_PRIVATE_CAUSE');
    assert.deepEqual(productFailure(error.code), { ok: false, error: { code: 'storage_error', retryable: false } }); return true;
  });
});

test('LIFECYCLE_CROSS_PROCESS_BUSY: separate EXCLUSIVE holder, bounded refusal and same native reader retry', async t => {
  const f = fixture(t); f.admit('synthetic cross-process evidence');
  const c = configured(t, f.path), h = await c.open(); await build(h, c.token); await h.close();
  const r = configured(t, f.path, false), reader = await r.open();
  ok(await reader.getContextIndexStatus(input, r.token));
  faults.reset(); t.after(() => faults.reset());
  const holder = spawn(process.execPath, ['--input-type=module', '-e', `
    import {DatabaseSync} from 'node:sqlite';
    const d=new DatabaseSync(process.argv[1]);d.exec('PRAGMA busy_timeout=0;BEGIN EXCLUSIVE');
    process.send('locked');process.once('message',()=>{d.exec('ROLLBACK');d.close();process.disconnect();});
  `, f.path + PRODUCT_SIDECAR_SUFFIX + '.lifecycle-lock.sqlite'], { env: {}, stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  let stderr = ''; holder.stderr.on('data', b => { stderr += b; });
  t.after(() => { if (holder.exitCode === null) holder.kill('SIGKILL'); });
  const exit = once(holder, 'exit');
  await Promise.race([once(holder, 'message'), exit.then(() => assert.fail('holder failed: ' + stderr))]);
  const started = process.hrtime();
  const result = await reader.getContextIndexStatus(input, r.token);
  const elapsed = process.hrtime(started); const ms = elapsed[0] * 1000 + elapsed[1] / 1e6;
  busy(result, 'LIFECYCLE_CROSS_PROCESS_BUSY');
  assert.ok(faults.counts.busyConnection > 0, 'busy refusal came from a tracked native connection');
  assert.ok(ms < 1000, `zero-busy-timeout refusal exceeded 1000 ms margin: ${ms}`);
  holder.send('release'); const [code, signal] = await exit;
  assert.equal(code, 0, stderr); assert.equal(signal, null);
  assert.equal(ok(await reader.getContextIndexStatus(input, r.token)).lexical.state, 'ready');
  assert.equal(faults.counts.retriedConnection, faults.counts.busyConnection, 'LIFECYCLE_SAME_NATIVE_CONNECTION');
  console.log(JSON.stringify({ marker: 'LIFECYCLE_CROSS_PROCESS_BUSY', elapsedMs: ms, holderExit: code, nativeConnection: faults.counts.busyConnection, retriedConnection: faults.counts.retriedConnection }));
});
