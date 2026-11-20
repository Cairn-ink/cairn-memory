import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { censusRows, censusCommand, realBin, commands } from './fixtures/entry-exit-census.mjs';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';
import { discoverEntryCommands } from './fixtures/entry-command-discovery.mjs';
import { runEntry } from '../bin/cairn-memory.mjs';

test('exit census covers the bin and CLI command tables', () => {
  assert.deepEqual(discoverEntryCommands(fileURLToPath(new URL('../../', import.meta.url))), [...commands].sort());
});

for (const platform of ['linux', 'darwin']) test('real-bin exit-code census through ' + platform + ' route', { timeout: 180000 }, async t => {
  const fixture = await censusRows(t), bin = realBin(t), backup = createTestWorkspace(t, { prefix: 'exit-backup-' });
  const script = fileURLToPath(new URL('./fixtures/entry-census-snapshot.py', import.meta.url));
  const copy = action => { const child = spawnSync('/usr/bin/python3', [script, action, backup.path, ...fixture.roots], { env: {}, encoding: 'utf8' }); assert.equal(child.status, 0, child.stderr); };
  copy('save');
  assert.deepEqual([...new Set(fixture.rows.map(row => row.command))].sort(), [...commands].sort());
  const failures = [];
  for (const row of fixture.rows) {
    copy('restore');
    const result = await censusCommand(bin, row, { platform });
    const expected = platform === 'darwin' ? row.expectedDarwin ?? row.expected : row.expected;
    t.diagnostic(JSON.stringify({ command: row.command, kind: row.kind, code: result.code, expected }));
    if (result.code !== expected) failures.push({ command: row.command, kind: row.kind, expected, actual: result.code, stdout: result.stdout, stderr: result.stderr });
  }
  assert.deepEqual(failures, []);
});

test('command-set exitCode wins over numeric return on local, support, fallback, forwarded and non-Linux routes', async () => {
  const old = process.exitCode;
  try {
    for (const [args, platform, refused] of [[['--db','/synthetic/db','--owner','synthetic'], 'linux', true], [['local', 'status'], 'linux'], [['daemon','status'], 'linux'], [['--db','/synthetic/db','--owner','synthetic'], 'linux'], [['raw','list'], 'linux'], [['raw','list'], 'darwin']]) {
      process.exitCode = undefined;
      const result = await runEntry(args, { platform, stderr() {}, load: async name => {
        if (name.endsWith('local-daemon-identity.mjs')) return { daemonVector: () => ({ eligible: args[0] === '--db' }) };
        const command = async () => { process.exitCode = 7; return 0; };
        return { start: command, runForwarder: refused ? async () => ({ refused: 'daemon_filesystem' }) : command, runLocalSetupCli: command, runDaemonCommand: command };
      } });
      assert.equal(result, 7, args.join(' '));
    }
  } finally { process.exitCode = old; }
});
