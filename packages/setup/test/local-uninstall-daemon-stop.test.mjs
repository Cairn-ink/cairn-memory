import assert from 'node:assert/strict';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { startAwareAlive } from '../../../adapters/mcp/local-daemon-liveness.mjs';
import { ok, until, workspace } from '../../../adapters/mcp/test/local-daemon-support.mjs';
import { codexSnippet } from '../lib/local-codex.mjs';
import { shellArgument, terminalWriter } from '../lib/output.mjs';
import { assertRecordedEngine, installerFixture, realDaemonEngine, uninstall } from './daemon-installer-fixture.mjs';
import { fixtureBinaryGuard } from './fixture-clients.mjs';

async function assertEngineRemoved(f) {
  await assert.rejects(access(join(f.root, 'engine')), { code: 'ENOENT' });
  const descriptor = JSON.parse(await readFile(join(f.root, 'installation.json'), 'utf8'));
  assert.equal(descriptor.state, 'uninstalled');
}

function assertOrdinaryOutput(f, result) {
  let stdout = '';
  const write = terminalWriter(line => { stdout += line + '\n'; });
  write('Disable capture and remove its hooks, then detach cairn-local from the selected tools. Keep data, capture identity and its pinned runtime.');
  write('Memory data is kept. You may delete it when you no longer need it.');
  write('  Removed:');
  write.literal('claude: cairn-local');
  write('✓ Local memory detached.');
  write('Memory data is kept. You may delete it when you no longer need it.');
  write.literal(shellArgument(f.database));
  assert.deepEqual(result, { code: 0, stdout, stderr: '' });
}

async function registerFakeCodex(f) {
  const scratch = dirname(f.home);
  const state = join(scratch, 'codex-state.json');
  const calls = join(scratch, 'codex-calls.jsonl');
  const descriptor = JSON.parse(await readFile(join(f.root, 'installation.json'), 'utf8'));
  await mkdir(f.env.CODEX_HOME, { mode: 0o700 });
  await writeFile(join(f.env.CODEX_HOME, 'config.toml'), codexSnippet(f.root, descriptor.clients.codex.vector), { mode: 0o600 });
  await writeFile(state, '{}');
  await writeFile(join(f.env.PATH, 'codex'), `#!${process.execPath}
${fixtureBinaryGuard(scratch)}
process.env.FAKE_STATE = ${JSON.stringify(state)};
process.env.FAKE_CALLS = ${JSON.stringify(calls)};
${await readFile(new URL('./fake-codex.mjs', import.meta.url), 'utf8')}`, { mode: 0o755 });
}

async function uninstallBothClients(f, afterClaude = () => {}) {
  await registerFakeCodex(f);
  const partial = f.run([...uninstall, '--client', 'claude']);
  assert.equal(partial.code, 0, partial.stdout);
  await access(f.engine);
  assert.deepEqual(await f.calls(), []);
  afterClaude();
  const last = f.run([...uninstall, '--client', 'codex']);
  assert.equal(last.code, 0, last.stdout);
  await assertEngineRemoved(f);
}

test('full local uninstall stops the live shared owner before removing its engine and keeps data',
  { timeout: 40000, skip: process.platform !== 'linux' }, async t => {
    const daemon = await workspace(t);
    const f = await installerFixture(t, { db: daemon.path });
    await f.setEngine(realDaemonEngine({ root: join(daemon.root, 'run') }));
    const forwarder = daemon.forward();
    forwarder.release();
    const { owner } = await daemon.connect(forwarder);
    const saved = ok(await forwarder.tool('remember_memory', { content: 'synthetic uninstall data kept', kind: 'fact' }));
    forwarder.process.stdin.end();
    await until(() => forwarder.messages.some(message => message.kind === 'forwarder-done'), 'synthetic session has closed');
    assert.equal(startAwareAlive(owner), true, 'shared owner is live before uninstall');

    assertOrdinaryOutput(f, f.run(uninstall));
    await assertEngineRemoved(f);
    assert.equal(startAwareAlive(owner), false, 'full uninstall stopped the verified shared owner');
    const calls = await f.calls();
    assert.equal(calls.length, 1);
    assertRecordedEngine(calls[0], f, 'stop');
    assert.equal(calls[0].claudeAttached, false);
    const { DatabaseSync } = await import('node:sqlite');
    const store = new DatabaseSync(f.database, { readOnly: true });
    try {
      const row = store.prepare('SELECT content FROM memories WHERE id = ?').get(saved.memory.id);
      assert.equal(row.content, 'synthetic uninstall data kept');
    } finally {
      store.close();
    }
  });

test('uninstalling the last local client stops the live shared owner and keeps data',
  { timeout: 40000, skip: process.platform !== 'linux' }, async t => {
    const daemon = await workspace(t);
    const f = await installerFixture(t, { db: daemon.path, clients: ['claude', 'codex'] });
    await f.setEngine(realDaemonEngine({ root: join(daemon.root, 'run') }));
    const forwarder = daemon.forward();
    forwarder.release();
    const { owner } = await daemon.connect(forwarder);
    const content = 'synthetic data kept after last-client uninstall';
    const saved = ok(await forwarder.tool('remember_memory', { content, kind: 'fact' }));
    forwarder.process.stdin.end();
    await until(() => forwarder.messages.some(message => message.kind === 'forwarder-done'), 'synthetic session has closed');
    assert.equal(startAwareAlive(owner), true, 'shared owner is live before uninstall');

    await uninstallBothClients(f, () => {
      assert.equal(startAwareAlive(owner), true, 'uninstalling Claude leaves the shared owner live');
    });
    const { DatabaseSync } = await import('node:sqlite');
    const store = new DatabaseSync(f.database, { readOnly: true });
    try {
      const row = store.prepare('SELECT content FROM memories WHERE id = ?').get(saved.memory.id);
      assert.equal(row.content, content);
    } finally {
      store.close();
    }
    assert.equal(startAwareAlive(owner), false, 'uninstalling Codex as the last client stops the shared owner');
  });

test('uninstalling the last local client invokes the pinned stop command before removing the engine', async t => {
  const f = await installerFixture(t, { clients: ['claude', 'codex'] });
  await f.setEngine(realDaemonEngine({ platform: 'darwin' }));
  await uninstallBothClients(f);
  assert.equal(await readFile(f.database, 'utf8'), 'synthetic data kept\n');
  const calls = await f.calls();
  assert.equal(calls.length, 1, 'uninstalling the last client invokes stop');
  assertRecordedEngine(calls[0], f, 'stop');
});

for (const [behavior, source] of [
  ['non-zero exit', "console.log('{\"stopped\":0,\"still_running\":0}'); console.error('synthetic stop failure'); process.exitCode = 7;"],
  ['still running', "console.log('{\"stopped\":0,\"still_running\":1}');"],
  ['daemon_platform', realDaemonEngine({ platform: 'darwin' })],
  ['times out', "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);"],
  ['missing-node', ''],
]) test(`full local uninstall keeps its exit and output when engine stop ${behavior}`, { timeout: 24000 }, async t => {
  const f = await installerFixture(t, { behavior });
  await f.setEngine(source);
  assertOrdinaryOutput(f, f.run(uninstall));
  await assertEngineRemoved(f);
  assert.equal(await readFile(f.database, 'utf8'), 'synthetic data kept\n');
  const calls = await f.calls();
  if (behavior === 'missing-node') assert.deepEqual(calls, []);
  else {
    assert.equal(calls.length, 1, 'engine stop was attempted');
    assertRecordedEngine(calls[0], f, 'stop');
    assert.equal(calls[0].claudeAttached, false);
    assert.throws(() => process.kill(calls[0].pid, 0), { code: 'ESRCH' });
  }
});

test('partial local uninstall detaches Claude and keeps the shared engine without invoking stop', async t => {
  const f = await installerFixture(t, { clients: ['claude', 'codex'] });
  await f.setEngine('process.exitCode = 5;');
  assert.equal(f.run([...uninstall, '--client', 'claude']).code, 0);
  await access(f.engine);
  const descriptor = JSON.parse(await readFile(join(f.root, 'installation.json'), 'utf8'));
  assert.equal(descriptor.clients.claude, null);
  assert.ok(descriptor.clients.codex);
  assert.deepEqual(await f.calls(), []);
});

test('full local uninstall with retained capture keeps the engine without invoking stop', async t => {
  const f = await installerFixture(t, { retained: true });
  await f.setEngine('process.exitCode = 5;');
  const result = f.run(uninstall);
  assert.equal(result.code, 0, result.stdout);
  await access(f.engine);
  const descriptor = JSON.parse(await readFile(join(f.root, 'installation.json'), 'utf8'));
  assert.equal(descriptor.state, 'uninstalled');
  assert.deepEqual(await f.calls(), []);
});
