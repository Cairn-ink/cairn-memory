import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, copyFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';
import { fixture, ns, ok } from '../testing/context-read-fixture.mjs';
import { credentialDigest, PRODUCT_PROFILE } from '../context-product-control.mjs';
import { card } from '../testing/context-product-owner-fixture.mjs';
import { installedImportClosure } from '../../packaging/test/fixtures/installed-import-closure.mjs';
import threads from 'node:worker_threads';
import { syncBuiltinESMExports } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';

const root = new URL('../../', import.meta.url).pathname;
function imports(source, dynamic = true) {
  const refs = [...source.matchAll(/(?:from\s*|import\s*|import\s*\()\s*['"]([^'"]+)['"]/g)].map(m => m[1]);
  if (dynamic) refs.push(...[...source.matchAll(/new URL\(['"]([^'"]+)['"],\s*import\.meta\.url\)/g)].map(m => m[1]));
  return refs;
}
function closure(base, entries, dynamic = true) {
  const seen = new Set(), queue = [...entries];
  while (queue.length) {
    const file = queue.pop(); if (seen.has(file)) continue; seen.add(file);
    const source = readFileSync(join(base, file), 'utf8');
    for (const ref of imports(source, dynamic)) {
      if (ref === 'node:sqlite' && !dynamic) assert.fail('static SQLite boundary: ' + file);
      if (ref.startsWith('.') && ref.endsWith('.mjs')) queue.push(relative(base, resolve(base, dirname(file), ref)));
    }
  }
  return [...seen].sort();
}

test('P2-02/13 manifest-only installation executes exported product Worker and cross-checks installed closure', async t => {
  const workspace = createTestWorkspace(t), staged = join(workspace.path, 'staged'), artifact = join(workspace.path, 'installed');
  const manifest = JSON.parse(readFileSync(join(root, 'packaging/artifact-files.json'), 'utf8'));
  const entries = ['core/context-product-reader.mjs', 'core/context-product-worker.mjs', 'core/context-product-pump.mjs', 'core/context-product-selection.mjs', 'core/context-read-supervisor.mjs'];
  const expected = closure(root, entries);
  // Hosted P2e closure, shared maintenance admission, private open timing and attribution, content safety and retained receipt lineage.
  // S2h-1 adds the four storage modules behind the SQLite Worker boundary.
  // Keep the exact closure pin and independently verify the installed edges.
  assert.equal(expected.length, 110);
  for (const file of ['core/content-safety-layout.mjs','core/content-safety-schema.mjs',
    'core/content-safety-migration.mjs','core/content-suppression-storage.mjs']) assert.ok(expected.includes(file),file);
  for (const file of expected) assert.ok(manifest.includes(file), 'missing artifact file: ' + file);
  for (const file of manifest) {
    const target = join(staged, file); mkdirSync(dirname(target), { recursive: true }); copyFileSync(join(root, file), target);
    assert.equal(createHash('sha256').update(readFileSync(target)).digest('hex'), createHash('sha256').update(readFileSync(join(root, file))).digest('hex'));
  }
  const archive = join(workspace.path, 'product.tar');
  const packed = spawnSync('tar', ['-cf', archive, '-C', staged, '.']); assert.equal(packed.status, 0);
  mkdirSync(artifact);
  const unpacked = spawnSync('tar', ['-xf', archive, '-C', artifact]); assert.equal(unpacked.status, 0);
  function filesAt(directory, prefix = '') {
    return readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ?
      filesAt(join(directory, entry.name), prefix + entry.name + '/') : [prefix + entry.name]);
  }
  const archiveFiles = filesAt(artifact).sort(); assert.deepEqual(archiveFiles, [...manifest].sort());
  for (const file of archiveFiles) assert.deepEqual(readFileSync(join(artifact, file)), readFileSync(join(root, file)));
  t.diagnostic(`manifest/archive filesystem cross-check: manifest=${manifest.length}, installed=${archiveFiles.length}; tar pack exit=${packed.status}, unpack exit=${unpacked.status}`);
  const installed = installedImportClosure(artifact, entries).required;
  assert.deepEqual(installed, expected);
  // Independent route: enumerate installed files first, then close a set over
  // all reverse edges, rather than discovering files from entry-point reads.
  const edges=[];
  for(const file of archiveFiles.filter(name=>name.endsWith('.mjs'))){
    const source=readFileSync(join(artifact,file),'utf8');
    for(const pattern of [/\bfrom\s+['"]([^'"]+)['"]/g,/\bimport\s*(?:\(\s*)?['"]([^'"]+)['"]/g,/new\s+URL\(\s*['"]([^'"]+)['"]\s*,\s*import\.meta\.url/g]){
      for(const match of source.matchAll(pattern))if(match[1].startsWith('.') && match[1].endsWith('.mjs'))
        edges.push([file,relative(artifact,resolve(artifact,dirname(file),match[1]))]);
    }
  }
  const independentlyReached=new Set(entries);let changed=true;
  while(changed){changed=false;for(const [from,to]of edges)if(independentlyReached.has(from)&&!independentlyReached.has(to)){independentlyReached.add(to);changed=true;}}
  assert.deepEqual([...independentlyReached].sort(),expected);
  t.diagnostic(`independent installed edge-set closure=${independentlyReached.size}; differences=0`);
  assert.ok(installed.includes('core/context-product-sqlite.mjs')); // P2d Worker dependency.

  const staticFiles = closure(artifact, ['core/context-product-reader.mjs', 'core/context-read-supervisor.mjs'], false);
  assert.equal(staticFiles.length, 30, 'engine-only pool and private diagnostics keep the parent SQLite-free');
  t.diagnostic(`runtime/Worker closure cross-check: source=${expected.length}, installed=${installed.length}; static SQLite-free closure=${staticFiles.length}`);
  // Bootstrap code is supplied by the host, copied into the installed tree;
  // it imports no source-checkout module and has no network/provider dependency.
  copyFileSync(new URL('../testing/context-product-index-host.mjs', import.meta.url), join(artifact, 'host.mjs'));
  const api = await import(pathToFileURL(join(artifact, 'core/index.mjs')));
  const f = fixture(t, { cards: true }), memory = f.admit('installed canonical evidence');
  const readSet = [ns, { ownerId: ns.ownerId, scope: 'personal', projectId: null },
    { ...ns, projectId: 'a' }, { ...ns, projectId: 'z' }].sort((a,b) => Buffer.compare(Buffer.from(JSON.stringify([a.ownerId,a.scope,a.projectId])),Buffer.from(JSON.stringify([b.ownerId,b.scope,b.projectId]))));
  for (const namespace of readSet) {
    if (namespace.projectId !== ns.projectId) f.admit('installed canonical evidence', namespace);
    card(f, namespace, 'installed Card', 'canonical evidence');
  }
  // Observe loading only; the installed public opt-in owns the real Workers.
  let warmed; const ready = new Promise(resolve => { warmed = resolve; }); let readyCount = 0;
  const OriginalWorker = threads.Worker;
  threads.Worker = class extends OriginalWorker {
    constructor(entry, options) {
      super(entry, options);
      if (entry.href === pathToFileURL(join(artifact, 'core/context-product-reader-pool-worker.mjs')).href)
        this.on('message', message => { if (message.kind === 'context-reader-pool-ready' && ++readyCount === 2) warmed(); });
    }
  };
  syncBuiltinESMExports();
  let supervisor; const timeout = new AbortController();
  try {
    supervisor = api.createContextReadSupervisor({ readerWorkerPool: true }); t.after(() => supervisor.close());
    await Promise.race([ready, delay(30000, undefined, { signal: timeout.signal }).then(() => assert.fail('installed_pool_ready_watchdog'))]);
  } finally { timeout.abort(); threads.Worker = OriginalWorker; syncBuiltinESMExports(); }
  const { readerPoolDiagnostic } = await import(pathToFileURL(join(artifact, 'core/context-read-supervisor.mjs')));
  const credential = { nonce: randomUUID() }, requestControl = { requestId: randomUUID(), handleId: randomUUID(), credentialBindingId: randomUUID(), credentialExpiresUtcMs: null, requestMaxMs: 5000 };
  const ownerCoverage = { policy: 'recent-projects-v1', selectionRevision: 'fixture', requestedNamespaces: 4, selectedNamespaces: 4, omittedNamespaces: 0 };
  const { requestMaxMs, ...ids } = requestControl;
  const binding = { kind: 'request', ...ids, credentialDigest: credentialDigest(credential), ownerId: ns.ownerId, namespaces: { readSet, ownerCoverage }, issuedAt: 0 };
  const state = new SharedArrayBuffer(32); new Int32Array(state)[0] = 1;
  const serviceCredential={opaque:randomUUID()},serviceBinding={kind:'service',serviceId:randomUUID(),credentialBindingId:randomUUID(),credentialExpiresUtcMs:null,
    credentialDigest:credentialDigest(serviceCredential),ownerId:ns.ownerId,namespaces:{readSet,ownerCoverage},issuedAt:0};
  const maintainer=await api.openContextIndexMaintainer({supervisor,path:f.path,version:'context-read-v1',profile:PRODUCT_PROFILE,
    readSet,ownerCoverage,wal:true,sidecarJournalMode:'WAL',diagnostics:true,
    host:{moduleUrl:pathToFileURL(join(artifact,'host.mjs')).href,configuration:{serviceBinding,state}}});
  try {
    for(const intent of ['current','history']) {
      const result=ok(await maintainer.refreshContextIndex({readSet,types:['memory','card'],intent,mode:'lexical',budget:{maxItems:1024,maxMs:5000}},serviceCredential));
      assert.equal(result.status,'complete');
    }
  } finally {await maintainer.close();}
  assert.deepEqual(readerPoolDiagnostic(supervisor), { hits: 0, misses: 0, startupFailures: 0 });
  const reader = await api.openContextProductReader({ supervisor, path: f.path, version: 'context-read-v1', profile: PRODUCT_PROFILE,
    readSet: [...readSet].reverse(), ownerCoverage, requestControl, wal: true, diagnostics: true, host: { moduleUrl: pathToFileURL(join(artifact, 'host.mjs')).href, configuration: { requestBinding: binding, state, requestReservation: new SharedArrayBuffer(4) } } });
  try {
    assert.equal(readerPoolDiagnostic(supervisor).hits, 1, 'installed_engine_pool_supplies_reader');
    assert.equal(ok(await reader.getContextReadCapabilities()).execution, 'worker');
    assert.deepEqual(ok(await reader.getContextReadCapabilities()).sidecarJournals, ['DELETE','WAL']);
    const evidence = ok(await reader.fetchCandidateEvidence({ readSet, refs: [{ type: 'memory', namespace: ns, memoryId: memory.id, revision: memory.revision }], intent: 'current' }, credential));
    assert.equal(evidence.items[0].content, f.db.prepare('SELECT content FROM memories WHERE id=?').get(memory.id).content);
    const candidates=ok(await reader.findCandidates({readSet,types:['memory','card'],intent:'current',query:'installed'},credential));
    assert.equal(candidates.items.length,8); assert.equal(candidates.coverage.status,'complete');
    assert.equal(new Set(candidates.items.map(i=>JSON.stringify(i.ref.namespace))).size,4);
    const assembly=ok(await reader.contextRead({readSet,types:['memory','card'],intent:'history',query:'installed',budget:{maxTokens:4000,maxItems:12}},credential));
    assert.equal(assembly.metered.items.length,8);
    assert.deepEqual(ok(await reader.fetchCandidateEvidence({readSet,snapshot:assembly.snapshot},credential)).items.map(i=>i.ref),assembly.diagnostics.items.map(i=>i.ref));
    const selected=api.selectContextProductNamespaces(readSet.map(namespace=>({namespace})), 'installed');
    assert.deepEqual(selected.readSet,readSet);assert.equal(selected.ownerCoverage.selectedNamespaces,4);
  } finally { await reader.close(); }
  assert.ok((await supervisor.drain()).every(r => r.telemetry === 'complete'));
  const newRuntime = readdirSync(join(root, 'core')).filter(name => name.startsWith('context-product-') && name.endsWith('.mjs')).map(name => 'core/' + name);
  for (const name of newRuntime) assert.ok(installed.includes(name));
});
