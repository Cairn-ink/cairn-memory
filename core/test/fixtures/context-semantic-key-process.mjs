// Keep the existing native-Worker operation clock deterministic under load.
import '../../testing/context-product-test-clock.mjs';
import assert from 'node:assert/strict';
import threads from 'node:worker_threads';
import { syncBuiltinESMExports } from 'node:module';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { names, markers, hash, markerHits } from './context-semantic-key-audit.mjs';

const scenario = process.argv[2], saved = names.map(name => process.env[name]);
const observations = [], workers = [], outputs = new Map();
function capture(kind, value) {
  assert.deepEqual(markerHits(value), [], 'marker leak in ' + kind);
  outputs.set(kind, (outputs.get(kind) ?? 0) + 1);
  return value;
}
const NativeWorker = threads.Worker;
threads.Worker = class extends NativeWorker {
  constructor(entry, options) {
    capture('workerData', options.workerData);
    super(entry, options);
    // Env is the credential channel, not an engine-owned output. Retain only
    // names and a digest for assertions; never retain or report the raw value.
    workers.push({ entry: entry.pathname, names: Object.keys(options.env).sort(), hash: hash(options.env[names[0]]) });
    this.on('message', message => {
      if (message.kind === 'test-key-observation') observations.push(message);
      else capture('worker-to-parent IPC', message);
    });
    this.on('error', error => capture('Worker errors and causes', error));
    this.stdout?.on('data', bytes => capture('Worker stdout', bytes));
    this.stderr?.on('data', bytes => capture('Worker stderr', bytes));
  }
  postMessage(message, ...args) {
    capture('parent-to-worker IPC', message); return super.postMessage(message, ...args);
  }
};
syncBuiltinESMExports();

const { DatabaseSync } = await import('node:sqlite');
const { fixture, ns, ok } = await import('../../testing/context-read-fixture.mjs');
const { createExclusiveSqliteFile } = await import('../../sqlite-journal-probe.mjs');
const { provisionSemanticOwner } = await import('../../context-semantic-ledger.mjs');
const { canonicalJson } = await import('../../context-product-validation.mjs');
const { credentialDigest, PRODUCT_PROFILE } = await import('../../context-product-control.mjs');
const { createMaintenancePumpRuntime, maintenancePumpDiagnostic, maintenancePumpPhaseDiagnostic } = await import('../../context-product-pump.mjs');
const { productOpenPhaseDiagnostic, maintenancePhaseDiagnostic, maintenanceStallDiagnostic, maintenanceFailureDiagnostic,
  maintenanceReaderFailureDiagnostic } = await import('../../context-product-reader.mjs');
const { supervisorOwner } = await import('../../context-read-supervisor.mjs');
const { createContextReadSupervisor, openContextSemanticCoordinator, openContextIndexMaintainer } = await import('../../index.mjs');
const hostUrl = new URL('./context-semantic-key-host.mjs', import.meta.url).href;
const keyAudit = new SharedArrayBuffer(32), coverage = { policy: 'recent-projects-v1', selectionRevision: 'synthetic',
  requestedNamespaces: 1, selectedNamespaces: 1, omittedNamespaces: 0 };
const f = fixture(null), supervisor = createContextReadSupervisor();
f.workspace.defer(() => supervisor.close());
const state = new SharedArrayBuffer(64); new Int32Array(state)[0] = 1;
let scans = 0;
function scanFiles() {
  const result = spawnSync(process.execPath, [new URL('./context-semantic-key-audit.mjs', import.meta.url).pathname], {
    input: JSON.stringify(f.workspace.path), encoding: 'utf8', env: {}, timeout: 30000,
  });
  assert.equal(result.error, undefined); assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.deepEqual(report.hits, [], 'marker leak in engine-written files');
  assert.ok(report.files.includes('ledger.sqlite'));
  assert.ok(report.files.some(name => name.includes('.semantic-owner-') && name.endsWith('.lock.sqlite')));
  scans++;
}
function observe(worker, stage = 'factory') { return observations.filter(o => o.worker === worker && o.stage === stage); }
function assertEnvironment(observation, expected) {
  assert.ok(observation, 'host factory observation');
  assert.deepEqual(observation.names, expected === undefined ? [] : [names[0]], 'Worker environment allowlist');
  assert.equal(observation.hash, hash(expected), 'Worker credential digest');
}
function maintainerOptions(coordinator) {
  const credential = { opaque: randomUUID() }, binding = { kind: 'service', serviceId: randomUUID(),
    credentialBindingId: randomUUID(), credentialExpiresUtcMs: null, credentialDigest: credentialDigest(credential),
    ownerId: ns.ownerId, namespaces: { readSet: [ns], ownerCoverage: coverage }, issuedAt: 0 };
  return { credential, options: { supervisor, path: f.path, version: 'context-read-v1', profile: PRODUCT_PROFILE,
    readSet: [ns], ownerCoverage: coverage, sidecarJournalMode: 'DELETE', diagnostics: true,
    ...(coordinator ? { semanticConfig: { version: 'context-read-product-p2e-v1', coordinator } } : {}),
    host: { moduleUrl: hostUrl, configuration: { serviceBinding: binding, state, keyAudit } } } };
}

try {
  names.forEach((name, i) => { process.env[name] = markers[i]; });
  if (scenario === 'absent') delete process.env[names[0]];
  if (scenario === 'empty') process.env[names[0]] = '';
  f.admit('synthetic semantic key document'); f.core.close();
  if (scenario === 'ordinary') {
    const m = maintainerOptions(), h = await openContextIndexMaintainer(m.options);
    f.workspace.defer(() => h.close());
    ok(capture('ordinary status', await h.getContextIndexStatus({ readSet: [ns], types: ['memory'], intent: 'current' }, m.credential)));
    await h.close();
    assertEnvironment(observe('product')[0], undefined);
    assert.equal(workers.length, 1); assert.deepEqual(workers[0].names, []);
  } else {
    const anchorPath = join(f.workspace.path, 'authority.sqlite'), ledgerPath = join(f.workspace.path, 'ledger.sqlite');
    createExclusiveSqliteFile(anchorPath);
    const authority = new DatabaseSync(anchorPath); f.workspace.defer(() => authority.close());
    authority.exec('CREATE TABLE anchors(owner TEXT PRIMARY KEY,anchor TEXT NOT NULL) STRICT;');
    const ledgerIdentity = { accountingDomainId: 'synthetic-accounting', ledgerId: 'synthetic-ledger' };
    await provisionSemanticOwner({ path: ledgerPath, identity: ledgerIdentity, ownerId: ns.ownerId,
      deadlineAt: Number(process.hrtime.bigint()) / 1e6 + 5000, enrollment: {
        authorizeNeverBound: owner => !authority.prepare('SELECT 1 FROM anchors WHERE owner=?').get(owner),
        createIfNeverBound(anchor) { authority.prepare('INSERT INTO anchors VALUES(?,?)').run(anchor.ownerId, canonicalJson(anchor)); return true; },
      } });
    const token = { opaque: randomUUID() }, binding = { kind: 'semantic-service', serviceId: randomUUID(),
      credentialBindingId: randomUUID(), credentialExpiresUtcMs: null, credentialDigest: credentialDigest(token),
      ownerId: ns.ownerId, scope: 'owner', issuedAt: 0, ...ledgerIdentity, ledgerEpoch: 1, bindingRevision: 1,
      methods: ['setOwnerSemantic', 'getOwnerSemanticStatus', 'validateOwnerSemanticCoverage', 'purgeOwnerVectors'] };
    const priceTable = { authorityId: 'synthetic-price', revision: 'one', sequence: 1,
      effectiveFromUtcMs: Date.now() - 60000, effectiveUntilUtcMs: Date.now() + 3600000,
      usdPerMillionInputTokens: { 'text-embedding-3-small': '0.02' } };
    const options = { version: 'context-read-product-p2e-v1', supervisor, ledgerPath, ledgerIdentity,
      provider: { provider: 'openai', model: 'text-embedding-3-small', dimensions: 1536,
        normalization: 'l2', requestTimeoutMs: 3000, maxBatchDocuments: 64 },
      refreshCaps: { steady: { maxItemsPerUtcDay: 2000, maxUsdPerUtcDay: '0.05' },
        backfill: { maxItemsPerUtcDay: 20000, maxUsdPerUtcDay: '0.50', maxUsdTotal: '5' } },
      backfillTargets: [{ canonicalPath: f.path, readSet: [ns], types: ['memory'], intents: ['current', 'history'] }], priceTable,
      host: { moduleUrl: hostUrl, configuration: { semanticServiceBinding: binding, anchorPath, state, keyAudit,
        priceTable, requireDedicated: scenario === 'absent' || scenario === 'empty' } } };
    if (scenario === 'absent' || scenario === 'empty') {
      await assert.rejects(openContextSemanticCoordinator(options), error => {
        capture('opening error and causes', error); assert.equal(error.code, 'invalid_input'); return true;
      });
      assertEnvironment(observe('semantic')[0], undefined);
      assert.deepEqual(workers[0].names, []);
      capture('opening cleanup', await supervisor.drain());
    } else {
      const coordinator = await openContextSemanticCoordinator(options); f.workspace.defer(() => coordinator.close());
      if (scenario === 'rotation') {
        process.env[names[0]] = markers[3];
        await coordinator.close();
        const next = await openContextSemanticCoordinator(options); f.workspace.defer(() => next.close());
        await next.close();
        assertEnvironment(observe('semantic')[1], markers[3]);
        assert.equal(workers[1].hash, hash(markers[3]));
        // The live Worker's environment is a snapshot; closing it still sees
        // the first value, and the next open must observe the rotated value.
        assertEnvironment(observe('semantic', 'close')[0], markers[0]);
      } else if (scenario === 'scan') {
        // Prove the scan includes hidden causes, rather than silently ignoring
        // Error.message/cause as a JSON-only serializer would.
        const probe = Error('synthetic scan probe', { cause: Error(markers.join('|')) });
        assert.deepEqual(markerHits(probe), [0, 1, 2, 3]);
        scanFiles();
        ok(capture('enable result', await coordinator.setOwnerSemantic({ ownerId: ns.ownerId, semantic: true, expectedRevision: 0 }, token)));
        const m = maintainerOptions(coordinator), timers = new Map(), turns = [];
        const renew = createMaintenancePumpRuntime({
          setTimer(fn) { const id = {}; timers.set(id, fn); return id; }, clearTimer(id) { timers.delete(id); },
          async open(o) {
            const h = await openContextIndexMaintainer(o);
            capture('open diagnostics', productOpenPhaseDiagnostic(h));
            return { ...h, async refreshContextIndex(...args) {
              const result = capture('turn result', await h.refreshContextIndex(...args)); turns.push(result);
              capture('turn diagnostics', [maintenancePhaseDiagnostic(result), maintenanceStallDiagnostic(result),
                maintenanceFailureDiagnostic(result), maintenanceReaderFailureDiagnostic(result)]);
              return result;
            } };
          },
        });
        const pump = renew({ supervisor, id: 'synthetic-key-pump',
          window: { id: 'synthetic-window', endsAtMonoMs: Math.floor(Number(process.hrtime.bigint()) / 1e6) + 60000, usedItems: 0, usedMs: 0, usedUsd: '0' },
          budgets: { maxItems: 1024, maxMs: 60000, maxUsd: '0.50' }, quantum: { maxItems: 64, maxMs: 700, maxUsd: '0.01' },
          pollMs: 700, renewalMs: 60000, projections: [{ options: m.options, types: ['memory'], modes: ['lexical', 'embeddings'] }],
          serviceCredential: m.credential, semanticConfig: m.options.semanticConfig, semanticServiceCredential: token,
          firstCoverageValidation: { maxTargets: 1, maxMs: 700 } });
        f.workspace.defer(() => pump.close());
        for (let i = 0; i < 2; i++) {
          const [id, tick] = timers.entries().next().value ?? [];
          assert.ok(tick, 'next scheduled turn'); timers.delete(id); await tick();
          capture('pump status', pump.getStatus());
        }
        assert.equal(turns.length, 2);
        const result = ok(turns[1]);
        assert.equal(result.progress.embeddingAttempts, 1);
        assert.ok(result.channels.semantic.causes.includes('provider_error'));
        ok(capture('semantic status', await coordinator.getOwnerSemanticStatus({ ownerId: ns.ownerId }, token)));
        const denied = await coordinator.getOwnerSemanticStatus({ ownerId: ns.ownerId }, { opaque: 'synthetic-invalid-authority' });
        capture('error result and causes', denied); assert.equal(denied.error.code, 'authority_required');
        scanFiles();
        await pump.close(); capture('completion result', await pump.completion);
        capture('pump diagnostics', [maintenancePumpDiagnostic(pump.getStatus()), maintenancePumpPhaseDiagnostic(pump.getStatus())]);
        await coordinator.close();
        for (const record of supervisorOwner(supervisor).owner.records) {
          capture('cleanup status', supervisor.getCleanupStatus(record.id));
          capture('cleanup diagnostics', await supervisor.drain(record.id));
        }
        capture('supervisor close result', await supervisor.close()); scanFiles();
        assert.equal(scans, 3);
        const counts = [...new Int32Array(keyAudit)];
        counts.slice(0, 4).forEach(n => assert.ok(n > 0, 'captured IPC in both directions on parent and peer ports'));
        assert.deepEqual(counts.slice(4), [0, 0, 0, 0], 'no IPC marker hits');
        for (const kind of ['workerData', 'worker-to-parent IPC', 'parent-to-worker IPC', 'open diagnostics',
          'semantic status', 'error result and causes', 'turn diagnostics', 'completion result', 'cleanup diagnostics']) assert.ok(outputs.get(kind) > 0, kind);
        assert.equal(observe('semantic', 'provider')[0]?.hash, hash(markers[0]), 'provider receives dedicated runtime credential');
        for (const observation of observe('product')) assertEnvironment(observation, undefined);
        for (const worker of workers.filter(w => w.entry.endsWith('/context-product-worker.mjs'))) assert.deepEqual(worker.names, []);
      }
      await coordinator.close();
      assertEnvironment(observe('semantic')[0], markers[0]);
      assert.deepEqual(workers[0].names, [names[0]]);
    }
  }
} finally {
  try { await f.workspace.cleanup(); }
  finally {
    names.forEach((name, i) => { if (saved[i] === undefined) delete process.env[name]; else process.env[name] = saved[i]; });
    threads.Worker = NativeWorker; syncBuiltinESMExports();
  }
}
