import '../testing/context-product-test-clock.mjs';
import { faults } from './fixtures/sqlite-helper-child-faults.mjs';
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, lstatSync } from 'node:fs';
import { join, basename } from 'node:path';
import { createHash } from 'node:crypto';
import { fixture, ns } from '../testing/context-read-fixture.mjs';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';
import { openDatabase } from '../database.mjs';
import { openContextReadSidecar } from '../context-read-sidecar.mjs';
import { openRawSearchStorage } from '../raw-search-storage.mjs';
import { provisionSemanticOwner } from '../context-semantic-ledger.mjs';
import { openContextSemanticCoordinator } from '../index.mjs';
import { setupProductSemantic } from '../testing/content-safety-s2h-product-semantic-probe.mjs';
import { productSidecar, PRODUCT_SIDECAR_SUFFIX } from '../context-product-sidecar.mjs';
import { openContextProductFacade } from '../context-read-facade.mjs';
import { accessDigest } from '../context-product-validation.mjs';
import { createExclusiveSqliteFile } from '../sqlite-journal-probe.mjs';

beforeEach(t => faults.install?.(t));
const selection = { readSet: [ns], types: ['memory'], intent: 'current', ownerCoverage: { policy: 'recent-projects-v1', selectionRevision: 'synthetic', requestedNamespaces: 1, selectedNamespaces: 1, omittedNamespaces: 0 } };
const access = accessDigest({ ownerId: ns.ownerId, namespaces: { readSet: [ns] } });
const budget = { maxItems: 1024, maxMs: 5000 };

async function driver(t, site) {
  if (site === 'semantic-worker') {
    const s = await setupProductSemantic(t, { open: false, corpus: 0 });
    return { directory: s.f.workspace.path, target: 1, open: async () => {
      try { const h = await openContextSemanticCoordinator(s.options); await h.close(); }
      catch (error) {
        if (error.cleanupId) {
          const cleanup = await s.supervisor.drain(error.cleanupId);
          assert.equal(cleanup.state, 'complete', 'SEMANTIC_CLEANUP_BEFORE_RETRY');
          assert.equal(cleanup.nativeDisposed, true);
          console.log(JSON.stringify({ marker: 'SEMANTIC_CLEANUP_BEFORE_RETRY', state: cleanup.state }));
        }
        throw error;
      }
    } };
  }
  if (site === 'canonical-s2h') {
    const w = createTestWorkspace(t), path = join(w.path, 'canonical.sqlite');
    return { directory: w.path, path, target: 5, open: () => openDatabase(path, { contentSafety: 's2h-v1' }).close() };
  }
  if (site === 'ledger') {
    const w = createTestWorkspace(t), path = join(w.path, 'ledger.sqlite');
    return { directory: w.path, path, target: 5, open: () => provisionSemanticOwner({ path, identity: { accountingDomainId: 'synthetic', ledgerId: 'synthetic' }, ownerId: ns.ownerId,
      deadlineAt: Infinity, enrollment: { authorizeNeverBound: () => true, createIfNeverBound: () => true } }) };
  }
  if (site === 'raw-search') {
    const w = createTestWorkspace(t);
    const bind = (purpose, value) => createHash('sha256').update(JSON.stringify([purpose, value])).digest('hex');
    return { directory: w.path, target: 5, open: async () => {
      const h = await openRawSearchStorage({ directory: w.path, identity: { ownerId: ns.ownerId }, bind, quotaBytes: 16 * 1024 * 1024, deadlineAt: Infinity }); await h.close();
    } };
  }
  const f = fixture(t);
  if (site === 'legacy') return { directory: f.workspace.path, path: f.path + '.context-read-v1.sqlite', target: 5,
    open: () => openContextReadSidecar({ path: f.path, db: f.db }).close() };
  const facade = openContextProductFacade(f.path, {}); t.after(() => facade.close());
  const storage = productSidecar({ path: f.path, db: facade.port.db, identity: facade.port.identity, features: facade.port.features, writable: true, now: () => 0 });
  t.after(() => storage.close());
  return { directory: f.workspace.path, path: f.path + PRODUCT_SIDECAR_SUFFIX + (site === 'lifecycle' ? '.lifecycle-lock.sqlite' : ''), target: site === 'lifecycle' ? 2 : 3,
    open: () => { storage.refresh(selection, access, budget); }, verify: () => {
      for (let i = 0; i < 100; i++) {
        storage.refresh(selection, access, budget);
        if (storage.observe(selection, access).dto.lexical.state === 'ready') return;
      }
      assert.fail('RETRY_READY');
    } };
}

for (const site of ['semantic-worker', 'lifecycle', 'product', 'canonical-s2h', 'legacy', 'raw-search', 'ledger'])
for (const [window, mode] of [['linked', 5], ['directory-fsync', 6], ['before-reply', 7]])
test(`PUBLICATION ${site} ${window}`, async t => {
  const d = await driver(t, site), before = readdirSync(d.directory).sort();
  faults.arm(d.target, mode); t.after(() => faults.reset());
  let failure;
  try { await d.open(); } catch (error) { failure = error; }
  assert.equal(faults.counts.reached, 1, 'PUBLICATION_WINDOW_REACHED');
  if (site !== 'semantic-worker') assert.equal(failure?.cause, 'ETIMEDOUT', 'PUBLICATION_PRIVATE_CAUSE');
  assert.equal(failure?.code, mode === 5 && site !== 'canonical-s2h' ? 'storage_busy' : 'storage_error', 'PUBLICATION_CLASSIFICATION');
  if (mode === 5) {
    assert.equal(faults.counts.recoveries, 1, 'PUBLICATION_RECOVERY_CHILD');
    assert.equal(faults.counts.recoverySynced, 1, 'PUBLICATION_RECOVERY_DIRECTORY_SYNCED');
    assert.equal(readdirSync(d.directory).some(name => name.includes('.cairn-create-')), false, 'PUBLICATION_RECOVERY_UNLINK');
  }
  const files = readdirSync(d.directory).sort();
  const states = files.filter(name => !before.includes(name)).map(name => {
    const s = lstatSync(join(d.directory, name));
    return { name, size: s.size, nlink: s.nlink, ino: String(s.ino) };
  });
  if (site === 'canonical-s2h') {
    // Fresh S2H creation cannot retry any existing target, including a safely
    // unlinked stage. Preserve database.mjs:483 and report a permanent failure.
    assert.equal(lstatSync(d.path).size, 0);
    await assert.rejects(async () => d.open(), { code: 'unsupported_database' }, 'CANONICAL_EXISTING_EMPTY_REFUSED');
    console.log(JSON.stringify({ marker: 'CANONICAL_NONRETRYABLE', site, window, code: failure.code, states, files }));
    return;
  }
  // Non-retryable errors leave state to existing admission/repair. A later
  // explicit open may initialize a permitted blank file or rebuild a cache.
  faults.reset(); await d.open(); d.verify?.();
  const after = readdirSync(d.directory).sort();
  assert.equal(after.some(name => name.includes('.cairn-create-')), false, 'PUBLICATION_NO_ORPHANS');
  const added = after.filter(name => !before.includes(name));
  assert.ok(added.length > 0);
  assert.ok(added.every(name => /\.sqlite$/.test(name)), 'only required databases remain');
  if (site === 'product' || site === 'lifecycle') assert.deepEqual(after, [basename(d.path.split(PRODUCT_SIDECAR_SUFFIX)[0]), basename(d.path.split(PRODUCT_SIDECAR_SUFFIX)[0]) + PRODUCT_SIDECAR_SUFFIX, basename(d.path.split(PRODUCT_SIDECAR_SUFFIX)[0]) + PRODUCT_SIDECAR_SUFFIX + '.lifecycle-lock.sqlite'].sort());
  console.log(JSON.stringify({ marker: 'PUBLICATION_OUTCOME', site, window, code: failure.code, next: 'success', states, before, files: after }));
});

for (const recovery of [1, 2, 3]) test(`RECOVERY_FAILURE ${recovery}: failed recovery is never retryable`, t => {
  const w = createTestWorkspace(t), path = join(w.path, 'synthetic.sqlite');
  faults.arm(5, 5); faults.recovery(recovery); t.after(() => faults.reset());
  assert.throws(() => createExclusiveSqliteFile(path), { code: 'storage_error', cause: 'ETIMEDOUT' }, 'RECOVERY_FAILURE_CLOSED');
  assert.equal(faults.counts.recoveries, 1, 'RECOVERY_FAILURE_CHILD');
  assert.equal(lstatSync(path).nlink, 2);
});


test('CANONICAL_ABSENT_BUSY: S2H retry succeeds only when no target was published', async t => {
  const d = await driver(t, 'canonical-s2h'); faults.arm(5); t.after(() => faults.reset());
  await assert.rejects(async () => d.open(), { code: 'storage_busy', cause: 'ETIMEDOUT' });
  assert.throws(() => lstatSync(d.path), { code: 'ENOENT' });
  faults.reset(); await d.open();
  openDatabase(d.path).close();
  assert.deepEqual(readdirSync(d.directory), ['canonical.sqlite'], 'CANONICAL_ABSENT_RETRY_NO_ORPHANS');
});
