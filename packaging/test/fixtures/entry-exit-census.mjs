// Synthetic subprocess census. The bin bytes are copied without rewriting into
// their shipped ../adapters layout. All SQLite backup/restore IO belongs to cp.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, writeFileSync, symlinkSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { daemonStoreCommand } from '../../../tools/testing/fixtures/daemon-qualification.mjs';
import { createInterface } from 'node:readline';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { fixture as assetFixture, input as assetInput, ns as assetNs, pdf } from '../../../core/testing/asset-fixtures.mjs';
import { fixture as methodFixture, input as methodInput, ns as methodNs, ok } from '../../../core/testing/method-package-fixtures.mjs';
import { fixture as cardFixture, ns as cardNs } from '../../../core/test/content-safety-preflight-fixture.mjs';
import { safetyFixture, copySqliteFixture } from '../../../core/testing/content-safety-s2h-fixture.mjs';
import { setupFixture } from '../../../integrations/client/test/fixtures/local-setup-workspace.mjs';

export const commands = [
  '--help', '--check-config', '--check-config context', 'server',
  'local --help', 'local init', 'local setup', 'local status', 'local activate', 'local disable', 'local hook',
  'daemon status', 'daemon stop', 'safety preflight', 'safety migrate', 'raw --help', 'raw list', 'raw delete',
  'assets import', 'assets derive', 'assets delete', 'assets export', 'methods import', 'methods adopt', 'methods disable',
  'model install', 'model verify', 'context refresh', 'review-card',
];
export function realBin(t, source = new URL('../../bin/cairn-memory.mjs', import.meta.url)) {
  source = typeof source === 'string' ? resolve(source) : fileURLToPath(source);
  const root = resolve(dirname(source), '../..'), w = createTestWorkspace(t, { prefix: 'exit-bin-' });
  mkdirSync(join(w.path, 'bin')); copyFileSync(source, join(w.path, 'bin/cairn-memory.mjs'));
  for (const name of ['adapters', 'integrations', 'core']) symlinkSync(join(root, name), join(w.path, name));
  return join(w.path, 'bin/cairn-memory.mjs');
}
export async function censusRows(t) {
  const w = createTestWorkspace(t, { prefix: 'exit-data-' });
  const a = assetFixture(t), asset = ok(a.call('importAssetVersion', assetInput()));
  await a.core.close(); a.db.close(); a.db.close = () => { assert.equal(a.db.isOpen, false); };
  const m = methodFixture(t), method = ok(m.call('importMethodVersion', methodInput()));
  ok(m.call('adoptMethodVersion', { bindingNamespace: methodNs, actionId: 'seed-adopt', package: method.package, version: method.version, roleId: null, expectedRevision: null, readSet: [methodNs], reasonRefs: [] }));
  await m.core.close(); m.db.close(); m.db.close = () => { assert.equal(m.db.isOpen, false); };
  const c = cardFixture(t), card = c.draft(); c.close();
  const s = safetyFixture(t); copySqliteFixture(s.path, s.backupPath);
  const local = await setupFixture(t); local.request.interpretationConsent = false; await local.core.close();
  const rawPath = join(w.path, 'raw.sqlite'), rawNs = { ownerId: 'synthetic-daemon-owner' };
  await daemonStoreCommand('seed', rawPath, 2);
  const rawDb = new DatabaseSync(rawPath, { readOnly: true });
  const rawId = rawDb.prepare('SELECT id FROM raw_conversations LIMIT 1').get().id; rawDb.close();
  const requestPath = join(local.root, 'request.json'); writeFileSync(requestPath, JSON.stringify(local.request), { mode: 0o600 });
  // Preparation here is synthetic fixture setup, not a CLI success assertion.
  // Keep this input unbound; each real bin prepares its own installation.
  const inputFile = join(w.path, 'input.pdf'), textFile = join(w.path, 'text.txt'), methodDir = join(w.path, 'method');
  writeFileSync(inputFile, pdf()); writeFileSync(textFile, 'Synthetic supplied caption'); mkdirSync(methodDir); writeFileSync(join(methodDir, 'SKILL.md'), 'Synthetic method');
  const base = (path, ns) => ['--db', path, '--owner', ns.ownerId];
  const refresh = ['refresh', ...base(a.path, assetNs), '--types', 'memory', '--intent', 'current', '--max-items', '16', '--max-ms', '1000', '--context-embedder', 'openai', '--context-embed-model', 'text-embedding-3-small', '--context-embed-dimensions', '1536', '--context-embed-max-requests', '1', '--context-embed-max-usd', '1'];
  const binding = ['--binding-namespace', 'personal', '--package', JSON.stringify(method.package), '--role', '*', '--expected-revision', '1'];
  const review = [...base(c.path, cardNs), '--card', card.id, '--revision', String(card.revision)];
  const operations = [
    ['--help', ['--help']], ['--check-config', ['--check-config', ...base(a.path, assetNs)]],
    ['--check-config context', ['--check-config', 'context', ...refresh]],
    ['server', [...base(a.path, assetNs), '--no-context-read', '--no-raw', '--assets', 'local-v1']],
    ['local --help', ['local', '--help']], ['local init', ['local', 'init', '--database', join(w.path, 'new.sqlite')]],
    ['local setup', ['local', 'setup', '--request', requestPath]],
    ...['status', 'activate', 'disable'].map(action => ['local ' + action, ['local', action, '--installation', local.request.installationDirectory]]),
    ['local hook', ['local', 'hook', '--installation', local.request.installationDirectory, '--event', 'SessionStart']],
    ['safety preflight', ['safety', 'preflight', '--db', s.path]],
    ['safety migrate', ['safety', 'migrate', '--db', s.path, '--backup', s.backupPath, '--store-id', s.storeId, '--base', '18', '--quiescent']],
    ['raw --help', ['raw', '--help']], ['raw list', ['raw', 'list', ...base(rawPath, rawNs)]],
    ['raw delete', ['raw', 'delete', ...base(rawPath, rawNs), '--conversation', rawId]],
    ['assets import', ['assets', 'import', ...base(a.path, assetNs), '--file', inputFile, '--title', 'Synthetic import']],
    ['assets derive', ['assets', 'derive', ...base(a.path, assetNs), '--version', JSON.stringify(asset.version), '--kind', 'caption', '--text-file', textFile]],
    ['assets delete', ['assets', 'delete', ...base(a.path, assetNs), '--ref', JSON.stringify(asset.asset), '--expected-revision', '1']],
    ['assets export', ['assets', 'export', ...base(a.path, assetNs), '--version', JSON.stringify(asset.version), '--out', join(w.path, 'output.pdf')]],
    ['methods import', ['methods', 'import', ...base(m.path, methodNs), '--dir', methodDir, '--title', 'Synthetic import']],
    ['methods adopt', ['methods', 'adopt', ...base(m.path, methodNs), ...binding, '--version', JSON.stringify(method.version)]],
    ['methods disable', ['methods', 'disable', ...base(m.path, methodNs), ...binding]],
    ...['install', 'verify'].map(action => ['model ' + action, ['model', action, 'bge-m3', '--dir', join(w.path, 'model'), '--check-config']]),
    ['context refresh', ['context', ...refresh, '--check-config']], ['review-card', ['review-card', ...review]],
    ['review-card retained', ['review-card', '--retained-raw-profile', join(w.path, 'missing-profile'), ...review]],
  ];
  const rows = [];
  for (const [command, argv] of operations) {
    const tty = /^(assets (import|derive|delete)|methods |review-card$)/.test(command);
    const success = command !== 'review-card retained';
    rows.push({ command: command === 'review-card retained' ? 'review-card' : command, kind: success ? 'success' : 'refused', argv, tty, expected: success ? 0 : 1 });
    if (command === 'review-card retained') continue;
    if (command.startsWith('--') || ['server', 'local --help', 'raw --help'].includes(command)) continue;
    rows.push({ command, kind: 'bad', argv: [argv[0], ...(argv[0] === 'review-card' ? [] : [argv[1]]), '--invalid'], expected: command === 'local hook' ? 0 : command.startsWith('raw ') ? 2 : 1 });
    const missing = [...argv], db = missing.indexOf('--db'), installation = missing.indexOf('--installation'), dir = missing.indexOf('--dir');
    const index = db >= 0 ? db : installation >= 0 ? installation : dir;
    if (index >= 0) { missing[index + 1] = join(w.path, 'missing', 'store'); rows.push({ command, kind: 'missing', argv: missing.filter(x => x !== '--check-config'), expected: command === 'local hook' ? 0 : 1 }); }
    if (tty) rows.push({ command, kind: 'refused', argv, tty: true, reject: true, expected: 1 });
  }
  rows.push({ command: '--help', kind: 'bad', argv: ['--help', '--invalid'], expected: 1 });
  rows.push({ command: '--check-config', kind: 'bad', argv: ['--check-config', '--invalid'], expected: 1 });
  rows.push({ command: '--check-config context', kind: 'bad', argv: ['--check-config', 'context', '--invalid'], expected: 1 });
  rows.push({ command: 'server', kind: 'bad', argv: ['--invalid'], expected: 1 });
  rows.push({ command: 'server', kind: 'missing', argv: ['--db', join(w.path, 'missing', 'server.sqlite'), '--owner', 'synthetic', '--no-context-read', '--assets', 'local-v1'], expected: 0 });
  rows.push({ command: 'local --help', kind: 'success', argv: ['local', '-h'], expected: 0 });
  rows.push({ command: 'local init', kind: 'refused', argv: ['local', 'init', '--database', s.path], expected: 1 });
  rows.push({ command: 'local setup', kind: 'missing', argv: ['local', 'setup', '--request', join(w.path, 'absent.json')], expected: 1 });
  rows.push({ command: 'raw delete', kind: 'refused', argv: ['raw', 'delete', ...base(rawPath, rawNs), '--conversation', 'synthetic-absent'], expected: 1 });
  rows.push({ command: 'assets export', kind: 'refused', argv: ['assets', 'export', ...base(a.path, assetNs), '--version', JSON.stringify(asset.version), '--out', inputFile], expected: 1 });
  rows.push({ command: 'review-card', kind: 'refused', argv: ['review-card', ...review], expected: 1 });
  for (const action of ['status', 'stop']) {
    rows.push({ command: 'daemon ' + action, kind: 'success', argv: ['daemon', action, '--db', a.path], expected: 0, main: 1, intended: 'design Addendum 1.2 support commands' });
    rows.push({ command: 'daemon ' + action, kind: 'bad', argv: ['daemon', action, '--invalid'], expected: 1, expectedDarwin: 0, main: 1, intended: 'design Addendum 1.2; R2 item 5 non-Linux daemon_platform' });
    rows.push({ command: 'daemon ' + action, kind: 'missing', argv: ['daemon', action, '--db', join(w.path, 'absent.sqlite')], expected: 1, expectedDarwin: 0, main: 1, intended: 'design Addendum 1.2; R2 item 5 non-Linux daemon_platform' });
  }
  for (const row of rows) if (['local setup', 'local status', 'local activate', 'local disable'].includes(row.command) && row.kind === 'success') row.prepareLocal = { installation: local.request.installationDirectory, requestPath };
  return { rows, workspace: w, roots: [w.path, a.workspace.path, m.workspace.path, c.workspace.path, s.workspace.path, local.root] };
}

export async function censusCommand(bin, row, { platform = 'linux' } = {}) {
  const preload = 'data:text/javascript,' + encodeURIComponent(`globalThis.fetch=()=>{throw Error('census_network_forbidden')};`);
  const args = ['--import', preload, bin, ...row.argv];
  // This seam selects only the bin route, leaving platform-specific command
  // implementations on their real host (local init remains a Linux command).
  if (platform !== 'linux') {
    args.splice(0, 2, '--import', 'data:text/javascript,' + encodeURIComponent(`import {registerHooks} from 'node:module';
      registerHooks({load(url,c,next){const result=next(url,c);if(url.endsWith('/bin/cairn-memory.mjs'))return {...result,source:String(result.source).replace('platform = process.platform','platform = "darwin"')};return result;}});globalThis.fetch=()=>{throw Error('census_network_forbidden')};`));
  }
  if (row.prepareLocal) {
    // An installation record binds its engine tree. Prepare each binary's own
    // synthetic installation; command argv remains byte-identical in parity.
    const clean = spawnSync('/usr/bin/python3', ['-c', 'import shutil,sys;shutil.rmtree(sys.argv[1],ignore_errors=True)', row.prepareLocal.installation], { env: {} });
    assert.equal(clean.status, 0);
    if (row.command !== 'local setup') {
      const setup = spawnSync(process.execPath, [...args.slice(0, 3), 'local', 'setup', '--request', row.prepareLocal.requestPath], { env: {}, encoding: 'utf8', timeout: 20000 });
      assert.equal(setup.status, 0, setup.stdout + setup.stderr);
    }
  }
  if (!row.tty) {
    const child = spawnSync(process.execPath, args, { input: '', env: {}, encoding: 'utf8', timeout: 20000, maxBuffer: 2 ** 20 });
    assert.equal(child.error, undefined, row.command + ':' + child.error); assert.equal(child.signal, null);
    return { code: child.status, stdout: child.stdout, stderr: child.stderr };
  }
  const terminal = fileURLToPath(new URL('../../../adapters/mcp/test/fixtures/card-review-pty.py', import.meta.url));
  const child = spawn('/usr/bin/python3', [terminal, process.execPath, ...args], { env: {}, stdio: 'pipe' });
  const lines = createInterface({ input: child.stdout }); let completed, stderr = '';
  child.stderr.on('data', data => { stderr += data; });
  lines.on('line', line => {
    const event = JSON.parse(line);
    if (event.event === 'prompt') {
      const match = event.output.match(/(?:type|operation, type) ("[^\r\n]+") and press Enter\./);
      assert.ok(match, event.output); child.stdin.write(JSON.stringify({ answer: row.reject ? 'WRONG' : JSON.parse(match[1]) }) + '\n');
    } else if (event.event === 'done') completed = event;
  });
  await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', (code, signal) => { lines.close(); child.stdin.destroy(); code === 0 && !signal && completed ? resolve() : reject(Error('census_pty_failed:' + stderr)); }); });
  return { code: completed.code, stdout: completed.output, stderr };
}
