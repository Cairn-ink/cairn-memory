import { faults } from '../../../core/test/fixtures/sqlite-helper-child-faults.mjs';
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { fixture, ns } from '../../../core/testing/context-read-fixture.mjs';
import { contextCommand } from '../context-read-command.mjs';
beforeEach(t => faults.install?.(t));
for (const [mode, code] of [[1, 'storage_busy'], [3, 'storage_error']]) test(`CLI_STORAGE_CODE ${code}: refresh preserves helper failure`, async t => {
  const f = fixture(t), lines = [], previous = process.exitCode;
  t.mock.method(console, 'log', line => lines.push(JSON.parse(line)));
  t.after(() => { process.exitCode = previous; faults.reset(); });
  faults.arm(4, mode);
  await contextCommand(['refresh', '--db', f.path, '--owner', ns.ownerId, '--project', ns.projectId, '--types', 'memory', '--intent', 'current',
    '--max-items', '1024', '--max-ms', '5000', '--context-embedder', 'openai', '--context-embed-model', 'text-embedding-3-small',
    '--context-embed-dimensions', '1536', '--context-embed-max-requests', '1', '--context-embed-max-usd', '1'], {});
  assert.deepEqual(lines, [{ ok: false, error: { code, retryable: code === 'storage_busy' } }], 'CLI_STORAGE_CODE');
  assert.equal(process.exitCode, 1);
});
