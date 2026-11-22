import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beginOperation, executableFor, newDescriptor, recordClient,
  vectorArguments, withLocalLock, writeDescriptor } from '../lib/local-descriptor.mjs';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { assertFixtureClients, fixtureBinaryGuard } from './fixture-clients.mjs';

const packageRoot = process.env.CAIRN_SETUP_TEST_PACKAGE ?? fileURLToPath(new URL('../', import.meta.url));
const engineEntry = new URL('../../../packaging/bin/cairn-memory.mjs', import.meta.url).href;
const liveness = new URL('../../../adapters/mcp/local-daemon-liveness.mjs', import.meta.url).href;
const engineId = '0.6.10-' + 'a'.repeat(12);
export const uninstall = ['uninstall', '--local', '--yes', '--lang', 'en'];

export async function installerFixture(t, { db, behavior = 'success', clients = ['claude'], retained = false } = {}) {
  const scratch = createTestWorkspace(t, { prefix: 'setup-daemon-' }).path;
  const home = join(scratch, 'home'), bin = join(scratch, 'bin'), root = join(home, '.cairn-memory');
  const codexHome = join(home, '.codex'), tmp = join(scratch, 'tmp');
  const engine = executableFor(root, engineId), node = join(scratch, 'pinned-node');
  const log = join(scratch, 'engine-calls.jsonl');
  const env = { HOME: home, PATH: bin, TMPDIR: tmp, CODEX_HOME: codexHome,
    LANG: 'en_US.UTF-8', CAIRN_SYNTHETIC_PARENT_ONLY: 'synthetic-parent-marker' };
  const database = db ?? join(scratch, 'synthetic store.sqlite');
  await mkdir(home, { mode: 0o700 });
  await mkdir(bin);
  await mkdir(tmp);
  await writeFile(log, '');
  const argv = args => {
    assertFixtureClients(env, scratch);
    const result = spawnSync(process.execPath, [join(packageRoot, 'bin/memory.mjs'), ...args],
      { env, cwd: scratch, encoding: 'utf8', timeout: 16000, killSignal: 'SIGKILL' });
    assert.ifError(result.error);
    return { code: result.status, stdout: result.stdout, stderr: result.stderr };
  };
  if (!clients.length) return { run: argv };

  await mkdir(root, { mode: 0o700 });
  for (const directory of [join(root, 'engine'), join(root, 'engine', engineId), join(root, 'engine', engineId, 'app')]) {
    await mkdir(directory, { mode: 0o700 });
  }
  await mkdir(dirname(engine), { recursive: true });
  if (!db) await writeFile(database, 'synthetic data kept\n');
  if (behavior !== 'missing-node') await symlink(process.execPath, node);
  const config = { claude: home, codex: join(codexHome, 'config.toml') };
  const descriptor = newDescriptor(root, '0.6.10', { db: database, owner: 'synthetic-daemon-owner' });
  const vector = { engineId, node, databasePath: database, ownerId: descriptor.ownerId, projectId: null };
  beginOperation(descriptor, 'setup', clients, config, vector);
  descriptor.node = node;
  descriptor.engine = { id: engineId, package: 'cairn-memory-local-preview',
    packageVersion: '0.0.0-preview.1', sha256: 'b'.repeat(64) };
  for (const client of clients) recordClient(descriptor, client, vector);
  descriptor.state = 'installed';
  descriptor.operation = null;
  await withLocalLock(root, () => writeDescriptor(root, descriptor));

  const fakeState = join(scratch, 'claude-state.json'), fakeCalls = join(scratch, 'claude-calls.jsonl');
  await writeFile(fakeState, '{}');
  await writeFile(join(bin, 'claude'), `#!${process.execPath}
${fixtureBinaryGuard(scratch)}
process.env.FAKE_STATE = ${JSON.stringify(fakeState)};
process.env.FAKE_CALLS = ${JSON.stringify(fakeCalls)};
${await readFile(new URL('./fake-claude.mjs', import.meta.url), 'utf8')}`, { mode: 0o755 });
  await writeFile(join(home, '.claude.json'), JSON.stringify({ mcpServers: {
    'cairn-local': { type: 'stdio', command: node, args: vectorArguments(root, vector) },
  } }), { mode: 0o600 });
  if (retained) await writeFile(join(root, 'capture-settings.json'), JSON.stringify({
    version: 1, clients: { claude: { enabled: true, noticed: true, engineId, node } },
  }), { mode: 0o600 });
  return { root, home, engine, node, database, env, run: argv,
    calls: async () => (await readFile(log, 'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse),
    async setEngine(source) {
      await writeFile(engine, `import { appendFileSync, existsSync } from 'node:fs';
const args = process.argv.slice(2);
const config = JSON.parse(await (await import('node:fs/promises')).readFile(${JSON.stringify(join(home, '.claude.json'))}, 'utf8'));
appendFileSync(${JSON.stringify(log)}, JSON.stringify({
  args, node: process.argv0, pid: process.pid, engineExists: existsSync(process.argv[1]),
  claudeAttached: Object.hasOwn(config.mcpServers, 'cairn-local'),
  env: Object.keys(process.env).sort(), lang: process.env.LANG,
}) + '\\n');
${source}`);
    },
  };
}

export function realDaemonEngine({ root, platform } = {}) {
  // The engine's routing and liveness code run unmodified. Only its supported
  // test seams map discovery into the fixture directory or simulate macOS.
  return `import { runEntry } from ${JSON.stringify(engineEntry)};
process.exitCode = await runEntry(args, {
  platform: ${JSON.stringify(platform)},
  load: async () => {
    const { runDaemonCommand } = await import(${JSON.stringify(liveness)});
    return { runDaemonCommand: (args, options) => runDaemonCommand(args, { ...options, root: ${JSON.stringify(root)} }) };
  },
});`;
}

export function assertRecordedEngine(call, fixture, operation) {
  assert.deepEqual(call.args, ['daemon', operation, '--db', fixture.database]);
  assert.equal(call.node, fixture.node);
  assert.equal(call.engineExists, true);
  assert.deepEqual(call.env, ['HOME', 'LANG', 'PATH', 'TMPDIR']);
  assert.equal(call.lang, 'C.UTF-8');
}
