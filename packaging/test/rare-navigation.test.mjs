import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';
import { buildArtifact, command, packageName } from '../build.mjs';

test('installed offline core imports default and opt-in rare preview without checkout dependencies', { timeout: 60000 }, async t => {
  const workspace = createTestWorkspace(t, { prefix: 'cairn-installed-rare-' });
  const artifact = buildArtifact();
  writeFileSync(join(workspace.path, 'package.json'), JSON.stringify({ name: 'synthetic-installed-rare',
    private: true, version: '0.0.0' }), { flag: 'wx' });
  command('npm', ['install', '--prefix', workspace.path, '--offline', '--ignore-scripts',
    '--no-audit', '--no-fund', artifact.artifactPath], workspace.path, artifact.userconfig);
  const installed = join(workspace.path, 'node_modules', packageName);
  const helper = 'core/rare-query-preview.mjs';
  assert.equal(createHash('sha256').update(readFileSync(join(installed, helper))).digest('hex'), artifact.sourceHashes[helper]);
  const { openMemoryCore } = await import(pathToFileURL(join(installed, 'core/contract.mjs')).href);
  const { countOpenAITokens } = await import(pathToFileURL(join(installed, 'adapters/openai/index.mjs')).href);
  const namespace = { ownerId: 'synthetic-installed-rare', scope: 'personal', projectId: null };
  const common = 'what when how did the does a before after', anchor = 'Kivu tomorrow';
  const query = `${common} ${anchor}`;
  const path = join(workspace.path, 'memory.sqlite');
  let core;
  workspace.defer(() => core?.close());
  const seen = [];
  const model = { contextWindow: 8192, countTokens: countOpenAITokens,
    select({ input }) {
      seen.push(...input.maps.flatMap(page => page.items));
      return { refs: input.maps.flatMap(page => page.items.filter(item => item.label.includes(anchor)).slice(0, 1)
        .map(item => ({ namespaceIndex: page.namespaceIndex, ...(item.type === 'unfiled' ? item.ref
          : { memoryId: item.ref.childId, revision: item.ref.childRevision }) }))) };
    },
    rank({ input }) { return { refs: input.candidates.slice(0, input.limit).map(item => ({ namespaceIndex: item.namespaceIndex,
      memoryId: item.memory.id, revision: item.memory.revision })) }; } };
  const ok = result => { assert.equal(result.ok, true, result.error?.code); return result.value; };
  const options = { path, model, sourceCandidatePolicy: 'bounded-keyset-v1' };
  core = openMemoryCore(options);
  for (let index = 0; index < 40; index++) ok(core.admit({ namespace,
    memory: { content: `${common} distractor ${index}`, kind: 'context' },
    receipts: [{ client: 'synthetic', sessionId: 'owned', eventId: `${index}`, role: 'user', excerpt: common }] }));
  const target = ok(core.admit({ namespace, memory: { content: 'Kivu interpretation', kind: 'context' },
    receipts: [common, `${'what when how '.repeat(25)}${'padding '.repeat(20)}${anchor}`]
      .map((excerpt, index) => ({ client: 'synthetic', sessionId: 'owned', eventId: `target-${index}`, role: 'user', excerpt })) })).memory;
  assert.equal(ok(await core.recall({ readSet: [namespace], query, contextMode: 'source-evidence' })).memories.length, 0);
  assert.ok(seen.length > 0);
  core.close(); seen.length = 0;
  core = openMemoryCore({ ...options, navigationLabelPolicy: 'rare-query-window-v1' });
  const recalled = ok(await core.recall({ readSet: [namespace], query, contextMode: 'source-evidence' }));
  assert.equal(recalled.memories[0].memory.id, target.id);
  assert.ok(seen.some(item => item.label.includes(anchor)));
  assert.ok(seen.every(item => [...item.label].length <= 120));
});
