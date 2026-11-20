import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { runtimeDirectory } from '../../adapters/mcp/local-daemon-state.mjs';
import { runEntry } from '../bin/cairn-memory.mjs';
import { daemonVector } from '../../adapters/mcp/local-daemon-identity.mjs';
import { runForwarder } from '../../adapters/mcp/local-forwarder.mjs';

const base = ['--db', '/synthetic/store.sqlite', '--owner', 'synthetic-owner'];
const rows = [
  ['installer 5', base, 'daemon'], ['installer 7', [...base, '--project', 'p'], 'daemon'],
  ...['--no-raw', '--no-raw-search', '--no-context-read'].map(f => [f, [...base, f], 'daemon']),
  ['advanced', [...base, '--context-read', 'context-read-v1'], 'cli'],
  ['setup check personal', ['--check-config', ...base], 'cli'],
  ['setup check project', ['--check-config', ...base, '--project', 'p'], 'cli'],
  ['local', ['local', 'status'], 'local'], ['local daemon', ['local','daemon','status'], 'local'],
  ['daemon status', ['daemon','status'], 'support'], ['daemon stop', ['daemon','stop'], 'support'], ['subcommand', ['safety', 'inspect'], 'cli'],
];
for (const [name, args, expected] of rows) test('routing: ' + name, async () => {
  let route, spawns = 0, calls = [], errors = [];
  const rc = await runEntry(args, { platform: 'linux', stderr: s => errors.push(s), load: async name => {
    calls.push(name);
    if (name.endsWith('local-daemon-liveness.mjs')) return { runDaemonCommand: async vector => { assert.deepEqual(vector,args.slice(1)); route = 'support'; return 0; } };
    if (name.endsWith('local-daemon-identity.mjs')) return { daemonVector };
    if (name.endsWith('local-forwarder.mjs')) return { runForwarder: async vector => {
      assert.deepEqual(vector, args); route = 'daemon'; spawns++; return null;
    } };
    if (name.endsWith('local-setup-cli.mjs')) return { runLocalSetupCli: async vector => {
      assert.deepEqual(vector, args.slice(1)); route = 'local'; return 0;
    } };
    if (name.endsWith('/cli.mjs')) return { start: async () => { route = 'cli'; } };
    assert.fail(name);
  } });
  assert.equal(rc, 0); assert.equal(route, expected); assert.deepEqual(errors, []);
  if (expected !== 'support') assert.ok(!calls.some(s => s.endsWith('local-daemon-liveness.mjs')), 'only explicit daemon commands load support code');
  if (expected !== 'daemon') { assert.equal(spawns, 0); assert.ok(!calls.some(s => s.endsWith('local-forwarder.mjs'))); }
  if (expected === 'local') assert.equal(calls.length, 1, 'local stays first');
});
test('non-Linux bypasses identity and forwarder entirely', async () => {
  const imports = [];
  await runEntry(base, { platform: 'darwin', load: async s => { imports.push(s); return { start: async () => {} }; } });
  assert.deepEqual(imports, ['../adapters/mcp/cli.mjs']);
});
for (const args of [base, ['--check-config', ...base], ['--check-config', ...base, '--project', 'p']]) {
  test('identity import refusal falls back once: ' + args.join(' '), async () => {
    const calls = [], errors = [];
    const rc = await runEntry(args, { platform: 'linux', stderr: s => errors.push(s), load: async name => {
      calls.push(name);
      if (name.endsWith('local-daemon-identity.mjs')) throw Error('synthetic_import_failure');
      assert.equal(name, '../adapters/mcp/cli.mjs');
      return { start: async () => { calls.push('start'); } };
    } });
    assert.equal(rc, 0);
    assert.deepEqual(calls, ['../adapters/mcp/local-daemon-identity.mjs', '../adapters/mcp/cli.mjs', 'start']);
    assert.deepEqual(errors, ['cairn_daemon_fallback:daemon_build\n']);
  });
}
test('identity refusal preserves real check-config stdout accepted by setup', () => {
  for (const extra of [[], ['--project', 'p']]) {
    const child = spawnSync(process.execPath, [new URL('./fixtures/entry-identity-refusal.mjs', import.meta.url).pathname,
      '--check-config', ...base, ...extra], { encoding: 'utf8', env: {}, timeout: 15000 });
    assert.equal(child.status, 0, child.stderr); assert.equal(child.signal, null);
    assert.equal(child.stderr, 'cairn_daemon_fallback:daemon_build\n');
    const report = JSON.parse(child.stdout);
    assert.equal(report.ok, true); assert.equal(report.databaseOpened, false);
    assert.equal(report.providerContacted, false); assert.equal(report.modelKeyPresent, false);
    assert.equal(report.contextRead, 'context-read-v1'); assert.equal(report.raw, true); assert.equal(report.rawSearch, true);
  }
});
test('eligibility exceptions after the import keep their original failure', async () => {
  const errors = [];
  await assert.rejects(runEntry(base, { platform: 'linux', stderr: s => errors.push(s), load: async () => ({
    daemonVector() { throw Error('synthetic_vector_failure'); },
  }) }), /synthetic_vector_failure/);
  assert.deepEqual(errors, []);
});
test('pre-stdin refusal leaves both streams intact for the same-process fallback', async () => {
  const input = new PassThrough(), output = new PassThrough(); let read = 0, fallback = 0, stderr = [];
  const frames = [{ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }, { jsonrpc: '2.0', id: 2, method: 'tools/list' }];
  const wire = frames.map(m => JSON.stringify(m) + '\n').join(''); input.write(wire);
  const originalRead = input.read.bind(input); input.read = (...a) => { const b = originalRead(...a); if (b) read += b.length; return b; };
  await runEntry(base, { platform: 'linux', stderr: s => stderr.push(s), load: async s => {
    if (s.endsWith('local-daemon-identity.mjs')) return { daemonVector };
    if (s.endsWith('local-forwarder.mjs')) return { runForwarder: async args => {
      // A programmatic refusal before directory creation or candidate spawn.
      const result = await runForwarder(args, { input, output, environment: { NODE_OPTIONS: 'synthetic-injection' },
        onCandidate: () => assert.fail('refusal must precede spawn') });
      assert.equal(read, 0); assert.equal(input.destroyed, false); assert.equal(output.writableEnded, false);
      return result;
    } };
    return { start: async () => { fallback++; assert.equal(input.read().toString(), wire); } };
  } });
  assert.equal(fallback, 1); assert.deepEqual(stderr, ['cairn_daemon_fallback:daemon_node_injection\n']);
  input.destroy(); output.destroy();
});
test('post-attach transport outcome never imports fallback', async () => {
  const calls = [], stderr = [];
  assert.equal(await runEntry(base, { platform: 'linux', stderr: s => stderr.push(s), load: async s => {
    calls.push(s); if (s.endsWith('local-daemon-identity.mjs')) return { daemonVector };
    return { runForwarder: async () => 'daemon_outcome_unknown' };
  } }), 1);
  assert.ok(!calls.some(s => s.endsWith('/cli.mjs'))); assert.deepEqual(stderr, ['daemon_outcome_unknown\n']);
});
test('pre-fallback entry closure has no heavy static import edge', () => {
  const source = readFileSync(new URL('../bin/cairn-memory.mjs', import.meta.url), 'utf8');
  const imports = [...source.matchAll(/^import .* from ['"]([^'"]+)['"]/gm)].map(m => m[1]);
  assert.ok(imports.every(s => s.startsWith('node:')));
  assert.ok(source.indexOf("args[0] === 'local'") < source.indexOf('daemonVector'));
});
test('standalone forwarder preserves its code-only refusal after the return contract change', async () => {
  if (process.platform !== 'linux') return;
  const directory = await runtimeDirectory(), before = readdirSync(directory.path).sort();
  const result = spawnSync(process.execPath, [new URL('../../adapters/mcp/local-forwarder.mjs', import.meta.url).pathname, '--help'], {
    env: {}, encoding: 'utf8', timeout: 15000,
  });
  assert.equal(result.error, undefined); assert.equal(result.signal, null); assert.equal(result.status, 1);
  assert.equal(result.stdout, ''); assert.equal(result.stderr, 'daemon_not_eligible\n');
  assert.deepEqual(readdirSync(directory.path).sort(), before, 'standalone refusal spawns no daemon and leaves no runtime files');
});
