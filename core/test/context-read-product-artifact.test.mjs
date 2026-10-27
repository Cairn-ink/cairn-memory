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
  const entries = ['core/context-product-reader.mjs', 'core/context-product-worker.mjs', 'core/context-product-pump.mjs', 'core/context-read-supervisor.mjs'];
  const expected = closure(root, entries);
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
  const installed = closure(artifact, entries);
  assert.deepEqual(installed, expected);
  const staticFiles = closure(artifact, ['core/context-product-reader.mjs', 'core/context-read-supervisor.mjs'], false);
  t.diagnostic(`runtime/Worker closure cross-check: source=${expected.length}, installed=${installed.length}; static SQLite-free closure=${staticFiles.length}`);
  // Bootstrap code is supplied by the host, copied into the installed tree;
  // it imports no source-checkout module and has no network/provider dependency.
  copyFileSync(new URL('../testing/context-product-index-host.mjs', import.meta.url), join(artifact, 'host.mjs'));
  const api = await import(pathToFileURL(join(artifact, 'core/index.mjs')));
  const f = fixture(t), memory = f.admit('installed canonical evidence');
  const supervisor = api.createContextReadSupervisor(); t.after(() => supervisor.close());
  const credential = { nonce: randomUUID() }, requestControl = { requestId: randomUUID(), handleId: randomUUID(), credentialBindingId: randomUUID(), credentialExpiresUtcMs: null, requestMaxMs: 5000 };
  const ownerCoverage = { policy: 'recent-projects-v1', selectionRevision: 'fixture', requestedNamespaces: 1, selectedNamespaces: 1, omittedNamespaces: 0 };
  const { requestMaxMs, ...ids } = requestControl;
  const binding = { kind: 'request', ...ids, credentialDigest: credentialDigest(credential), ownerId: ns.ownerId, namespaces: { readSet: [ns], ownerCoverage }, issuedAt: 0 };
  const state = new SharedArrayBuffer(32); new Int32Array(state)[0] = 1;
  const serviceCredential={opaque:randomUUID()},serviceBinding={kind:'service',serviceId:randomUUID(),credentialBindingId:randomUUID(),credentialExpiresUtcMs:null,
    credentialDigest:credentialDigest(serviceCredential),ownerId:ns.ownerId,namespaces:{readSet:[ns],ownerCoverage},issuedAt:0};
  const maintainer=await api.openContextIndexMaintainer({supervisor,path:f.path,version:'context-read-v1',profile:PRODUCT_PROFILE,
    readSet:[ns],ownerCoverage,sidecarJournalMode:'DELETE',diagnostics:true,
    host:{moduleUrl:pathToFileURL(join(artifact,'host.mjs')).href,configuration:{serviceBinding,state}}});
  try {
    for(const intent of ['current','history']) {
      const result=ok(await maintainer.refreshContextIndex({readSet:[ns],types:['memory'],intent,mode:'lexical',budget:{maxItems:1024,maxMs:5000}},serviceCredential));
      assert.equal(result.status,'complete');
    }
  } finally {await maintainer.close();}
  const reader = await api.openContextProductReader({ supervisor, path: f.path, version: 'context-read-v1', profile: PRODUCT_PROFILE,
    readSet: [ns], ownerCoverage, requestControl, diagnostics: true, host: { moduleUrl: pathToFileURL(join(artifact, 'host.mjs')).href, configuration: { requestBinding: binding, state, requestReservation: new SharedArrayBuffer(4) } } });
  try {
    assert.equal(ok(await reader.getContextReadCapabilities()).execution, 'worker');
    const evidence = ok(await reader.fetchCandidateEvidence({ readSet: [ns], refs: [{ type: 'memory', namespace: ns, memoryId: memory.id, revision: memory.revision }], intent: 'current' }, credential));
    assert.equal(evidence.items[0].content, f.db.prepare('SELECT content FROM memories WHERE id=?').get(memory.id).content);
    const candidates=ok(await reader.findCandidates({readSet:[ns],types:['memory'],intent:'current',query:'installed'},credential));
    assert.equal(candidates.items[0].ref.memoryId,memory.id);
    const assembly=ok(await reader.contextRead({readSet:[ns],types:['memory'],intent:'history',query:'installed',budget:{maxTokens:4000,maxItems:12}},credential));
    assert.equal(assembly.metered.items[0].body,'installed canonical evidence');
  } finally { await reader.close(); }
  assert.ok((await supervisor.drain()).every(r => r.telemetry === 'complete'));
  const newRuntime = readdirSync(join(root, 'core')).filter(name => name.startsWith('context-product-') && name.endsWith('.mjs')).map(name => 'core/' + name);
  for (const name of newRuntime) assert.ok(installed.includes(name));
});
