import assert from 'node:assert/strict';
import test from 'node:test';
import { writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';
import { runMemberProcess } from './fixtures/topic-members-process.mjs';

test('Primary-key identity validation: installed offline artifact ships the validator and exercises v18/current DELETE/WAL', t => {
  const workspace = createTestWorkspace(t, { prefix: 'e1m-round3-installed-' });
  const config = join(workspace.path, 'empty.npmrc'); writeFileSync(config, '');
  const scratch = join(workspace.path, 'scratch'); mkdirSync(scratch);
  const result = runMemberProcess(process.execPath, [fileURLToPath(new URL('./topic-members.test.mjs', import.meta.url))],
    workspace.path, config, { TMPDIR: scratch, TMP: scratch, TEMP: scratch, NODE_NO_WARNINGS: '1' });
  assert.equal(result.error, undefined); assert.equal(result.signal, null); assert.equal(result.status, 0, result.stdout + '\n' + result.stderr);
  assert.match(result.stdout, /"workersClosed":true/);
  assert.match(result.stdout, /"memberModules":9/, 'the new primary-key validator belongs to the checked installed closure');
  assert.deepEqual(readdirSync(scratch), [], 'release archive, install and subprocess scratch');
  t.diagnostic(result.stdout);
});
