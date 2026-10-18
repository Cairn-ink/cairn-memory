import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { buildArtifact, command, packageName } from '../build.mjs';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';

const ok = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };
const hash = value => createHash('sha256').update(value).digest('hex');

test('R4 installed archive contains exact ranking module and opt-in survives cold reopen', { timeout: 60000 }, async t => {
  const workspace = createTestWorkspace(t, { prefix: 'cairn-installed-idf-' });
  const artifact = buildArtifact();
  const archivePaths = command('tar', ['-tzf', artifact.artifactPath], workspace.path, artifact.userconfig)
    .trim().split(/\r?\n/).map(path => path.slice('package/'.length)).sort();
  const manifestPaths = JSON.parse(readFileSync(join(artifact.stagingPath, 'package.json'))).files.slice().sort();
  assert.deepEqual(archivePaths, manifestPaths);
  assert.deepEqual(archivePaths, artifact.files);
  const runtimePaths = JSON.parse(readFileSync(new URL('../artifact-files.json', import.meta.url)));
  assert.ok(runtimePaths.includes('core/source-ranking.mjs'));
  const archivedRanking = command('tar', ['-xOzf', artifact.artifactPath, 'package/core/source-ranking.mjs'], workspace.path, artifact.userconfig);
  assert.equal(hash(archivedRanking), artifact.sourceHashes['core/source-ranking.mjs']);
  writeFileSync(join(workspace.path, 'package.json'), JSON.stringify({ name: 'synthetic-installed-idf',
    version: '0.0.0', private: true }), { flag: 'wx' });
  command('npm', ['install', '--prefix', workspace.path, '--offline', '--ignore-scripts', '--no-audit', '--no-fund',
    artifact.artifactPath], workspace.path, artifact.userconfig);
  const installed = join(workspace.path, 'node_modules', packageName);
  assert.equal(hash(readFileSync(join(installed, 'core/source-ranking.mjs'))), artifact.sourceHashes['core/source-ranking.mjs']);
  const { openMemoryCore } = await import(pathToFileURL(join(installed, 'core/contract.mjs')).href);
  const { countOpenAITokens } = await import(pathToFileURL(join(installed, 'adapters/openai/index.mjs')).href);
  const calls = [];
  const model = { contextWindow: 16384, countTokens: countOpenAITokens,
    extract: ({ input }) => ({ items: input.messages.map(message => ({ content: message.content,
      kind: 'fact', confidence: 0.8, sourceIndices: [message.index] })) }),
    classify: ({ input }) => ({ items: input.memories.map(memory => ({ memoryId: memory.id, parentIds: [] })) }),
    select: ({ input }) => { calls.push({ method: 'select', input }); return { refs: input.maps.flatMap(map =>
      map.items.filter(item => item.label.includes('cobaltmarker')).map(item => ({ namespaceIndex: map.namespaceIndex, ...item.ref }))) }; },
    rank: ({ input }) => { calls.push({ method: 'rank', input }); return { refs: input.candidates.slice(0, input.limit)
      .map(item => ({ namespaceIndex: item.namespaceIndex, memoryId: item.memory.id, revision: item.memory.revision })) }; } };
  const namespace = { ownerId: 'installed-idf', scope: 'personal', projectId: null };
  const path = join(workspace.path, 'memory.sqlite');
  let core = openMemoryCore({ path, model }); workspace.defer(() => core.close());
  const source = 'cobaltmarker retained source from installed normal capture';
  const captured = ok(await core.capture({ namespace, client: 'synthetic', sessionId: 'idf', eventId: 'capture',
    messages: [{ id: 'source', role: 'user', content: source }] }));
  assert.equal(captured.classification.status, 'applied');
  const detail = ok(core.get({ namespace, memoryId: captured.admission.memories[0].id }));
  const request = { readSet: [namespace], query: 'cobaltmarker', contextMode: 'source-evidence' };
  const baseline = await core.recall(request);
  core.close(); core = openMemoryCore({ path, model, sourceRankingPolicy: 'bounded-idf-v1',
    sourceCandidatePolicy: 'bounded-keyset-v1' }); calls.length = 0;
  const enabled = await core.recall(request);
  assert.deepEqual(enabled, baseline);
  assert.deepEqual(calls.map(call => call.method), ['select', 'rank']);
  assert.deepEqual(ok(enabled).memories[0].receipts, detail.receipts.map(({ id, role, excerpt }) => ({ id, role, excerpt })));
  assert.equal(/ranking|maskBytes|bounded-idf/.test(JSON.stringify(enabled)), false);
  for (const path of ['adapters/mcp/server.mjs', 'bin/cairn-memory.mjs']) {
    assert.equal(readFileSync(join(installed, path), 'utf8').includes('sourceRankingPolicy'), false);
  }
  t.diagnostic(`independent tar/manifest paths cross-checked: ${archivePaths.length}; ranking archive/source/installed SHA256 matched`);
});
