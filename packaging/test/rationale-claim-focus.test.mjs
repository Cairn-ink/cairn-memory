import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildArtifact, command, packageName } from '../build.mjs';

test('installed core imports both prompt assets and preserves source-only versus opt-in focus', { timeout: 60000 }, async t => {
  const artifact = buildArtifact(); const root = mkdtempSync(join(tmpdir(), 'cairn-installed-focus-'));
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'synthetic-focus', private: true, version: '0.0.0' }), { flag: 'wx' });
  command('npm', ['install', '--prefix', root, '--offline', '--ignore-scripts', '--no-audit', '--no-fund', artifact.artifactPath], root, artifact.userconfig);
  const packageRoot = join(root, 'node_modules', packageName);
  const { openMemoryCore } = await import(pathToFileURL(join(packageRoot, 'core/index.mjs')).href);
  assert.equal(readFileSync(join(packageRoot, 'core/prompts/relate-claim-focus.md'), 'utf8'),
    readFileSync(new URL('../../core/prompts/relate-claim-focus.md', import.meta.url), 'utf8'));
  const calls = []; const path = join(root, 'memory.sqlite');
  const core = openMemoryCore({ path, model: { contextWindow: 8192, countTokens: () => 1,
    relate(request) { calls.push(request); return { edges: [] }; } } }); t.after(() => core.close());
  const namespace = { ownerId: 'synthetic', scope: 'personal', projectId: null };
  const admitted = core.admit({ namespace, memory: { content: 'I have not chosen.', kind: 'context' },
    receipts: [{ client: 'synthetic', sessionId: 'synthetic', eventId: 'synthetic', role: 'user', excerpt: 'I have not chosen.' }] });
  assert.equal(admitted.ok, true); const { id: memoryId, revision } = admitted.value.memory;
  const refs = [{ memoryId, revision }];
  assert.equal((await core.reviewRationale({ namespace, refs })).ok, true);
  assert.equal(Object.hasOwn(calls[0].input.memories[0], 'focus'), false);
  assert.equal((await core.reviewRationale({ namespace, refs, inputMode: 'claim-focus-v1' })).value.inputMode, 'claim-focus-v1');
  assert.deepEqual(calls[1].input.memories[0].focus, { content: 'I have not chosen.', interpretationStatus: 'unverified' });
  core.close(); const cold = openMemoryCore({ path }); t.after(() => cold.close());
  assert.equal(cold.getRationale({ namespace, memoryId, revision }).value.status, 'unassessed');
});
