import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, lstatSync, writeFileSync } from 'node:fs';
import { join, dirname, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { Client, InMemoryTransport } from '../../adapters/mcp/node_modules/@modelcontextprotocol/client/dist/index.mjs';
import { installedMethods, fileCommand } from './fixtures/method-packages.mjs';
import { installedImportClosure } from './fixtures/installed-import-closure.mjs';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';
import { host } from '../../core/testing/context-read-core-fixture.mjs';
import { ns, ok } from '../../core/testing/context-read-sources-fixture.mjs';
import { observeDatabaseFiles } from '../../core/testing/context-read-fixture.mjs';

function tree(directory, prefix = '') {
  return readdirSync(directory, { withFileTypes: true }).flatMap(e => e.isDirectory() ? tree(join(directory, e.name), prefix + e.name + '/') : [prefix + e.name]).sort();
}
// Route B enumerates all runtime files first, builds reverse dependency edges,
// and reaches a fixed point. Route A walks imports from entries on demand.
function independentlyReach(root, entries, files) {
  const edges = [];
  for (const file of files.filter(f => f.endsWith('.mjs'))) {
    const source = readFileSync(join(root, file), 'utf8');
    const patterns = [/\bfrom\s+['"]([^'"]+)['"]/g, /\bimport\s*(?:\(\s*)?['"]([^'"]+)['"]/g, /\bnew\s+URL\(\s*['"]([^'"]+)['"]\s*,\s*import\.meta\.url/g];
    for (const pattern of patterns) for (const match of source.matchAll(pattern)) {
      if (!match[1].startsWith('.')) continue;
      const absolute = resolve(root, dirname(file), match[1]); if (lstatSync(absolute).isDirectory()) continue;
      edges.push([file, relative(root, absolute)]);
    }
  }
  const reached = new Set(entries); let changed = true;
  while (changed) { changed = false; for (const [from, to] of edges) if (reached.has(from) && !reached.has(to)) { reached.add(to); changed = true; } }
  return [...reached].sort();
}
test('C09 offline installed tgz: both sources, SQLite-free CLI linking, static closure/archive and read-only DDL/files', { timeout: 120000 }, async t => {
  const workspace = createTestWorkspace(t, { prefix: 'u5c2-installed-' });
  assert.equal(readdirSync(workspace.path).includes('node_modules'), false, 'fresh install target has no shared/symlinked node_modules');
  const f = await installedMethods(workspace);
  const shipped = JSON.parse(readFileSync(new URL('../artifact-files.json', import.meta.url))), actual = tree(f.root);
  const entries = ['core/index.mjs', 'core/contract.mjs', 'adapters/mcp/cli.mjs', 'adapters/local/cli.mjs', 'integrations/client/raw/local-host-cli.mjs'];
  const routeA = installedImportClosure(f.root, entries).required, routeB = independentlyReach(f.root, entries, actual);
  assert.deepEqual(routeA, routeB); assert.deepEqual(routeA.filter(file => !shipped.includes(file)), []);
  const tar = fileCommand(workspace, 'tar', ['-tzf', f.artifact.artifactPath], workspace.path, f.artifact.userconfig).trim().split('\n').map(p => p.replace(/^package\//, '')).sort();
  assert.deepEqual(tar, actual); assert.deepEqual(tar, JSON.parse(readFileSync(join(f.root, 'package.json'))).files.slice().sort());
  assert.deepEqual(f.artifact.files, tar);
  console.log(JSON.stringify({ kind: 'u5c2_packaging_counts', closureRouteA: routeA.length, closureRouteB: routeB.length,
    manifest: shipped.length, manifestOnly: shipped.filter(file => !routeA.includes(file)), archive: tar.length, installedTree: actual.length, closureDifferences: 0, missingManifest: 0, archiveDifferences: 0, packExit: 0, installExit: 0, tarExit: 0 }));
  const trusted = host(), { openMemoryCore } = await import(pathToFileURL(join(f.root, 'core/index.mjs')));
  const sourceConfiguration = { version: 'context-read-v1', authority: trusted.authority, sources: ['relations-one-hop-v1', 'moc-v1'], counter: { id: 'synthetic-unit', countTokens: () => 1 } };
  let proposals;
  const core = openMemoryCore({ path: f.path, contextRead: sourceConfiguration,
    model: { contextWindow: 32768, countTokens: () => 1, relate: () => ({ edges: proposals }) } }); workspace.defer(() => core.close());
  const seed = ok(core.admit({ namespace: ns, memory: { content: 'needle direct', kind: 'fact' }, receipts: [{ client: 'synthetic', sessionId: 's', eventId: 'seed', role: 'user', excerpt: 'direct' }] }));
  const endpoint = ok(core.admit({ namespace: ns, memory: { content: 'Other endpoint', kind: 'fact' }, receipts: [{ client: 'synthetic', sessionId: 's', eventId: 'endpoint', role: 'user', excerpt: 'other' }] }));
  proposals = [{ from: 1, to: 0, relation: 'supports-decision', fromReceipt: 0, toReceipt: 0 }];
  ok(await core.reviewRationale({ namespace: ns, refs: [seed, endpoint].map(value => ({ memoryId: value.memory.id, revision: value.memory.revision })) }));
  const placed = ok(core.applyPlacement({ namespace: ns, expectedIndexRevision: ok(core.map({ namespace: ns, purpose: 'classification' })).indexRevision,
    expectedMemoryRevisions: [{ memoryId: endpoint.memory.id, revision: endpoint.memory.revision }],
    proposal: { items: [{ memoryId: endpoint.memory.id, parentIds: [], newL1: { title: 'needle topic', parentL2Ids: [] } }] } }));
  const db = new DatabaseSync(f.path, { readOnly: true }); workspace.defer(() => db.close());
  const ddl = db.prepare('SELECT type,name,sql FROM sqlite_master ORDER BY type,name').all();
  const query = { readSet: [ns], query: 'needle', types: ['memory'], intent: 'current', deadlineMs: 5000 };
  const value = ok(await trusted.call(core, 'findCandidates', query)); assert.ok(value.items.some(i => i.channels.moc));
  assert.equal(value.trace.sources['relations-one-hop-v1'].status, 'ok'); assert.equal(value.trace.sources['moc-v1'].status, 'ok');
  // Relation-only discovery is independently exercised with MOC narrowed away.
  const relations = ok(await trusted.call(core, 'findCandidates', { ...query, sources: ['relations-one-hop-v1'] }));
  assert.ok(relations.items.some(i => i.via?.family === 'supports-decision'));
  const report = join(workspace.path, 'read-only-result.json');
  const observed = await observeDatabaseFiles({ path: f.path, workspace }, () => fileCommand(workspace, process.execPath,
    [new URL('./fixtures/context-read-sources.mjs', import.meta.url).pathname, f.root, f.path, report], workspace.path, f.artifact.userconfig));
  assert.deepEqual(observed.events, []); assert.ok(ok(JSON.parse(readFileSync(report))).items.length);
  assert.deepEqual(db.prepare('SELECT type,name,sql FROM sqlite_master ORDER BY type,name').all(), ddl);
  // Static CLI link under both pinned runtimes must never reach node:sqlite.
  const probe = `import {registerHooks} from 'node:module'; registerHooks({resolve(s,c,n){if(s==='node:sqlite')throw Error('SQLite linked');return n(s,c);}}); await import(${JSON.stringify(pathToFileURL(join(f.root, 'adapters/mcp/cli.mjs')).href)}); console.log('sqlite-free');`;
  assert.equal(fileCommand(workspace, process.execPath, ['--input-type=module', '-e', probe], workspace.path, f.artifact.userconfig).trim(), 'sqlite-free');
  const { createCairnServer } = await import(pathToFileURL(join(f.root, 'adapters/mcp/server.mjs')));
  const server = createCairnServer({ path: f.path, namespace: ns, contextRead: 'context-read-v1', contextReadSources: sourceConfiguration.sources, contextCounter: sourceConfiguration.counter });
  const [a, b] = InMemoryTransport.createLinkedPair(), client = new Client({ name: 'installed-sources', version: '1' });
  workspace.defer(async () => { await client.close(); await server.close(); }); await server.connect(b); await client.connect(a);
  const response = await client.callTool({ name: 'find_memory_candidates', arguments: { query: 'needle', types: ['memory'], intent: 'current', sources: ['relations-one-hop-v1'] } });
  assert.ok(JSON.parse(response.content[0].text).value.items.some(i => i.via));
});
