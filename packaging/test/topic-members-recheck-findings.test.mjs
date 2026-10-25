import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, readdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';
import { buildArtifact } from '../build.mjs';
import { runMemberProcess } from './fixtures/topic-members-process.mjs';

// Runtime proof of the cleanup finding already resolved in d2ed3926. The child
// exercises real pack/install/Worker acceptance and its test-runner teardown.
for (const failure of [false, true]) test(`spec P2: Scratch cleanup was verified only by inspection — installed ${failure ? 'failure' : 'success'}`, t => {
  const workspace = createTestWorkspace(t, { prefix: 'e1m-recheck-cleanup-' });
  const scratch = join(workspace.path, 'scratch'); mkdirSync(scratch);
  const config = join(workspace.path, 'empty.npmrc'); writeFileSync(config, '');
  const args = failure ? ['--import', new URL('./fixtures/topic-members-review-failure.mjs', import.meta.url).href] : [];
  args.push(fileURLToPath(new URL('./topic-members.test.mjs', import.meta.url)));
  const result = runMemberProcess(process.execPath, args, workspace.path, config,
    { TMPDIR: scratch, TMP: scratch, TEMP: scratch, NODE_NO_WARNINGS: '1' });
  assert.equal(result.error, undefined); assert.equal(result.signal, null);
  assert.equal(result.status, failure ? 1 : 0, result.stderr + '\n' + result.stdout);
  if (failure) assert.match(result.stdout, /23/, 'failure is injected in the installed child after archive/install');
  else assert.match(result.stdout, /"workersClosed":true/, 'success reaches real installed Worker teardown');
  assert.deepEqual(readdirSync(scratch), [], 'pack owner, install workspace, subprocess output and child temp directories are gone');
  t.diagnostic(JSON.stringify({ installedOutcome: failure ? 'controlled exit 23' : 'success', childExit: result.status, leftoverDirectories: readdirSync(scratch) }));
});

test('spec P2: Scratch cleanup was verified only by inspection — pack failure', async t => {
  const workspace = createTestWorkspace(t, { prefix: 'e1m-recheck-pack-' });
  let owned;
  assert.throws(() => buildArtifact({ ownDirectory(path) { owned = path; workspace.defer(() => rmSync(path, { recursive: true, force: true })); },
    runCommand() { throw Error('controlled pack failure'); } }), /controlled pack failure/);
  assert.ok(owned); assert.equal(existsSync(owned), true);
  await workspace.cleanup(); assert.equal(existsSync(owned), false);
});
