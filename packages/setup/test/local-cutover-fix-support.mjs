import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { appendFileSync, chmodSync, existsSync, mkdirSync, readFileSync, realpathSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initLocalRawStore } from '../../../integrations/client/raw/local-setup-init.mjs';
import { createLocalRawSetup, setupLocalRaw } from '../../../integrations/client/raw/local-setup.mjs';
import { runDaemonCommand } from '../../../adapters/mcp/local-daemon-liveness.mjs';
import { codexSnippet, inspectLocalCodexServers } from '../lib/local-codex.mjs';
import { readDescriptor, withLocalLock, writeDescriptor } from '../lib/local-descriptor.mjs';
import { installerFixture, realDaemonEngine } from './daemon-installer-fixture.mjs';
import { assertFixtureClients, fixtureBinaryGuard } from './fixture-clients.mjs';

export const installer = fileURLToPath(new URL('../bin/memory.mjs', import.meta.url));
export const setup = ['setup', '--local'];
export const prepare = ['local-cutover', '--activate'];
export const confirm = ['local-cutover', '--confirm'];
export const providerFixture = 'synthetic-provider-fixture';
export const credentialPattern = /^(?:OPENAI_API_KEY|CAIRN_[A-Z0-9_]+_API_KEY)$/iu;
export const keyedRefusal = 'Local cutover is unavailable for model-configured installations. Legacy service remains active.';
export const linux = { skip: process.platform !== 'linux', timeout: 120000 };
export const readJSON = path => JSON.parse(readFileSync(path, 'utf8'));
export const claude = f => readJSON(join(f.home, '.claude.json')).mcpServers['cairn-local'];
export const codex = async f => (await inspectLocalCodexServers({ home: f.env.CODEX_HOME, env: f.env,
  ...f.inspection })).find(row => row.name === 'cairn-local');
export const rpc = (method, params, id = 1) => JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n';
export const tool = (name, args, id) => rpc('tools/call', { name, arguments: args }, id);

export function launch(f, entry, args, { env = {}, preload, input, node = process.execPath } = {}) {
  const result = spawnSync(node, [...(preload ? ['--import', preload] : []), entry, ...args], {
    env: { ...f.env, ...env }, cwd: f.parent, input, encoding: 'utf8', timeout: 45000, killSignal: 'SIGKILL',
  });
  assert.ifError(result.error);
  return result;
}

export function operator(f, args, { code = 0, entry = installer, ...options } = {}) {
  assertFixtureClients(f.env, f.parent);
  const result = launch(f, entry, [...args, '--lang', 'en'], options);
  assert.equal(result.status, code, result.stdout + result.stderr);
  return result.stdout;
}

export async function legacyFixture(t, { both = false, capture = false } = {}) {
  const cleanups = [];
  let f;
  t.after(async () => {
    try {
      const target = f && claude(f)?.args[2];
      if (target && target !== f.database && existsSync(target)) {
        assert.equal(await runDaemonCommand(['stop', '--db', target], { write() {} }), 0);
      }
    } finally {
      for (const cleanup of cleanups) await cleanup();
    }
  });
  f = await installerFixture({ after: cleanup => cleanups.push(cleanup) }, both ? { clients: ['claude', 'codex'] } : {});
  f.parent = dirname(f.home);
  f.inspection = { fallbackParent: f.parent, managedPaths: [] };
  const cache = join(f.parent, 'npm-cache');
  mkdirSync(cache, { mode: 0o700 });
  Object.assign(f.env, { CAIRN_SETUP_NPM_CACHE: cache, CAIRN_SETUP_NPM_OFFLINE: '1' });
  const npm = realpathSync(join(dirname(process.execPath), 'npm'));
  writeFileSync(join(f.env.PATH, 'npm'), `#!${process.execPath}
require('node:child_process').execFileSync(process.execPath, [${JSON.stringify(npm)}, '--offline', ...process.argv.slice(2)], { stdio: 'inherit', env: process.env });
`, { mode: 0o700 });

  unlinkSync(f.database);
  assert.equal((await initLocalRawStore({ databasePath: f.database })).status, 'initialized');
  chmodSync(f.database, 0o600);
  await f.setEngine(realDaemonEngine({ root: join(f.home, 'run') }));
  const descriptor = await readDescriptor(f.root);
  descriptor.installerVersion = '0.6.11';
  await withLocalLock(f.root, () => writeDescriptor(f.root, descriptor));
  if (both) {
    mkdirSync(f.env.CODEX_HOME, { mode: 0o700 });
    writeFileSync(join(f.env.CODEX_HOME, 'config.toml'), codexSnippet(f.root, descriptor.clients.codex.vector), { mode: 0o600 });
    const state = join(f.parent, 'codex-state.json');
    writeFileSync(state, '{}');
    writeFileSync(join(f.env.PATH, 'codex'), `#!${process.execPath}
${fixtureBinaryGuard(f.parent)}
process.env.FAKE_STATE = ${JSON.stringify(state)};
process.env.FAKE_CALLS = ${JSON.stringify(join(f.parent, 'codex-calls.jsonl'))};
${readFileSync(new URL('./fake-codex.mjs', import.meta.url), 'utf8')}`, { mode: 0o755 });
  }
  if (capture) {
    const installationDirectory = join(f.root, 'capture', 'claude');
    const sourceRoot = join(f.home, '.claude', 'projects'), pluginRoot = join(f.home, '.claude', 'support');
    const usageRoot = join(f.root, 'usage'), clientConfigPath = join(f.home, '.claude', 'settings.json');
    for (const path of [sourceRoot, pluginRoot, usageRoot, dirname(installationDirectory)]) {
      mkdirSync(path, { mode: 0o700, recursive: true });
    }
    writeFileSync(clientConfigPath, '{}\n', { mode: 0o600 });
    const request = { version: 'local-raw-setup-request-v1', installationDirectory, databasePath: f.database,
      namespace: { ownerId: descriptor.ownerId, scope: 'personal', projectId: null },
      client: 'claude-code', sourceRoot, clientConfigPath, usageRoot, installation: { pluginRoot },
      rawMode: 'local-plain-v1', rawCapBytes: 1000000, dailyCap: 20, providerApiKeyEnv: 'OPENAI_API_KEY',
      plaintextRawConsent: true, foregroundConsent: true, interpretationConsent: false };
    assert.equal((await setupLocalRaw(request)).status, 'prepared');
    assert.equal((await createLocalRawSetup({ installationDirectory }).activate()).status, 'active');
    f.sourceRoot = sourceRoot;
  }
  return f;
}

export function recordClientPresence(f, trace, name) {
  const path = join(f.env.PATH, name);
  const script = readFileSync(path, 'utf8');
  const start = script.indexOf('\n') + 1;
  writeFileSync(path, script.slice(0, start) + `
import { appendFileSync as recordFixturePresence } from 'node:fs';
recordFixturePresence(${JSON.stringify(trace)}, JSON.stringify({ child: ${JSON.stringify(name)},
  key: Object.keys(process.env).some(name => ${credentialPattern}.test(name)) }) + '\\n');
` + script.slice(start));
}

export function makeCapturePayload(f, session, event) {
  const transcript = join(f.sourceRoot, session + '.jsonl');
  if (event === 'SessionStart') writeFileSync(transcript, '', { mode: 0o600 });
  else appendFileSync(transcript, JSON.stringify({ type: 'user', uuid: 'synthetic-turn',
    timestamp: new Date(Date.now() - 3600000).toISOString(), promptSource: 'typed',
    message: { content: [{ type: 'text', text: 'Synthetic lapis Raw turn.' }] } }) + '\n');
  return JSON.stringify({ hook_event_name: event, session_id: session, transcript_path: transcript });
}
