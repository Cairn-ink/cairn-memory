import { faults } from '../../../core/test/fixtures/sqlite-helper-child-faults.mjs';
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { fixture, ns } from '../../../core/testing/context-read-fixture.mjs';
import { contextCommand } from '../context-read-command.mjs';
import { spawnSync } from 'node:child_process';
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
for (const command of ['methods', 'assets']) test(`CLI_HELPER_BUSY ${command}: real terminal CLI preserves probe timeout`, t => {
  const f = fixture(t);
  const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
  const args = [process.execPath, '--import', new URL('../../../core/test/fixtures/sqlite-helper-cli-fault.mjs', import.meta.url).href,
    new URL('../cli.mjs', import.meta.url).pathname, command, 'import', '--db', f.path, '--owner', ns.ownerId, '--project', ns.projectId,
    '--title', 'Synthetic', ...(command === 'methods' ? ['--dir', f.workspace.path] : ['--file', f.workspace.path + '/synthetic.txt'])];
  const result = spawnSync('script', ['-qefc', args.map(quote).join(' '), '/dev/null'], { encoding: 'utf8', env: {}, input: '', timeout: 20000 });
  const records = result.stdout.split(/\r?\n/).filter(line => line.startsWith('{')).map(line => JSON.parse(line));
  const proof = records.find(row => row.marker === 'CLI_REAL_HELPER_TIMEOUT');
  assert.equal(proof?.injected, 1, 'CLI_REAL_HELPER_INJECTED');
  assert.equal(proof?.reached, 1, 'CLI_REAL_HELPER_TIMEOUT_REACHED');
  assert.equal(result.status, 1, result.stderr);
  assert.deepEqual(records.find(row => Object.hasOwn(row, 'ok')), { ok: false, error: { code: 'storage_busy', retryable: true } }, 'CLI_HELPER_BUSY');
});
