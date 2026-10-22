import { installedImportClosure } from './fixtures/installed-import-closure.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';
import { buildArtifact, command, packageName } from '../build.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const preload = fileURLToPath(new URL('./fixtures/local-oneshot.mjs', import.meta.url));
function sourceClosure() {
  return installedImportClosure(root, ["adapters/local/cli.mjs"]);
}
for (const client of ['claude-code', 'codex']) test(`B3 installed ${client}: offline archive runs only installed runtime in fresh processes`, { timeout: 120000 }, async t => {
  const workspace = createTestWorkspace(t, { prefix: 'installed-local-oneshot-' });
  const home = join(workspace.path, 'home'), usage = join(workspace.path, 'usage');
  mkdirSync(home, { mode: 0o700 }); mkdirSync(usage, { mode: 0o700 });
  const artifact = buildArtifact(), { required:closure, eager:eagerClosure } = sourceClosure();
  writeFileSync(join(workspace.path, 'package.json'), JSON.stringify({ name: 'synthetic-local-oneshot', version: '0.0.0', private: true }), { flag: 'wx', mode: 0o600 });
  command('npm', ['install', '--prefix', workspace.path, '--offline', '--ignore-scripts', '--no-audit', '--no-fund', artifact.artifactPath], workspace.path, artifact.userconfig);
  const installed = join(workspace.path, 'node_modules', packageName), config = join(workspace.path, 'config.json');
  for (const path of closure) {
    assert.ok(artifact.files.includes(path), path);
    assert.deepEqual(readFileSync(join(installed, path)), readFileSync(join(root, path)));
  }
  const observed = new Set(), pids = new Set(), trace = join(workspace.path, 'http.jsonl'), database = join(workspace.path, 'memory.sqlite');
  let phase = 0;
  const run = (input, { prepare = false, key = true, mode = 'memory', bytes } = {}) => {
    const imports = join(workspace.path, `imports-${phase++}.jsonl`);
    const child = spawnSync(process.execPath, prepare ? [preload, 'prepare'] : ['--import', preload, join(installed, 'adapters/local/cli.mjs'), '--config', config], {
      cwd: workspace.path, encoding: 'utf8', input: bytes ?? JSON.stringify(input), timeout: 12000, maxBuffer: 262144,
      env: { PATH: dirname(process.execPath), HOME: home, TMPDIR: workspace.path, TMP: workspace.path, TEMP: workspace.path,
        NODE_DISABLE_COMPILE_CACHE: '1', NODE_NO_WARNINGS: '1', SYNTHETIC_INSTALLED: installed, SYNTHETIC_IMPORT_TRACE: imports,
        SYNTHETIC_TRACE: trace, SYNTHETIC_MODE: mode, SYNTHETIC_CLIENT: client, SYNTHETIC_DATABASE: database,
        SYNTHETIC_CONFIG: config, SYNTHETIC_CORE: join(installed, 'core/index.mjs'), SYNTHETIC_USAGE: usage,
        ...(key ? { SYNTHETIC_LOCAL_KEY: 'synthetic_key_secret' } : {}) },
    });
    pids.add(child.pid); assert.equal(child.error, undefined); assert.equal(child.signal, null);
    assert.doesNotMatch(child.stderr + child.stdout, /synthetic_source_secret|synthetic_key_secret/);
    for (const line of readFileSync(imports, 'utf8').trim().split('\n').filter(Boolean)) {
      const row = JSON.parse(line); if (row.path.startsWith(installed + '/')) observed.add(relative(installed, row.path));
    }
    return child;
  };
  assert.equal(run(null, { prepare: true }).status, 0);
  const text = 'synthetic_source_secret\n Ａ🙂 e\u0301 ', request = { version: 2, client, session_id: 'synthetic-session', event_id: 'first',
    messages: [{ id: 'message-first', role: 'user', occurred_at: null, message_ordinal: 1, content: text.slice(0, 10),
      part: { index: 0, start: 0, totalUnits: text.length, totalBytes: Buffer.byteLength(text) } }] };
  const first = run(request); assert.equal(first.status, 0, first.stderr); const response = JSON.parse(first.stdout);
  assert.equal(response.status, 200); assert.equal(response.body.memoryCount, 1);
  const replay = run(request, { key: false }); assert.equal(replay.status, 0); assert.equal(JSON.parse(replay.stdout).body.duplicate, true);
  const suffix = { ...request, event_id: 'suffix', messages: [{ ...request.messages[0], content: text.slice(10),
    part: { ...request.messages[0].part, index: 1, start: 10 } }] };
  const continued = run(suffix, { key: false }); assert.equal(continued.status, 0); assert.equal(JSON.parse(continued.stdout).status, 200);
  const failure = { ...request, event_id: 'failed', messages: [{ ...request.messages[0], id: 'message-failed', message_ordinal: 2,
    content: text, part: { ...request.messages[0].part } }] };
  const failed = run(failure, { mode: 'provider-error' }); assert.equal(failed.status, 0); assert.equal(JSON.parse(failed.stdout).status, 503);
  const failedReplay = run(failure, { key: false }); assert.equal(failedReplay.status, 0); assert.equal(JSON.parse(failedReplay.stdout).status, 503);
  const invalid = run(null, { bytes: Buffer.from([0xc0, 0xaf]) }); assert.equal(invalid.status, 1); assert.equal(invalid.stdout, '');
  const db = new DatabaseSync(database, { readOnly: true });
  try {
    const parts = db.prepare('SELECT sealed FROM raw_parts WHERE conversation_id=? AND message_id=? ORDER BY part_index').all(response.body.raw.conversationId, 'message-first');
    assert.equal(parts.length, 2); assert.equal(Buffer.concat(parts.map(part => Buffer.from(part.sealed))).toString(), text);
    assert.equal(db.prepare('SELECT count(*) n FROM memories').get().n, 1);
  } finally { db.close(); }
  const ledgers = readdirSync(join(usage, 'usage')).filter(name => name.endsWith('.json')); assert.equal(ledgers.length, 1);
  const ledger = JSON.parse(readFileSync(join(usage, 'usage', ledgers[0]), 'utf8')); assert.equal(ledger.used, 4); assert.deepEqual(ledger.reservations, []);
  assert.equal(readFileSync(trace, 'utf8').trim().split('\n').length, 7);
  assert.deepEqual([...observed].sort(), eagerClosure); assert.equal(pids.size, 7);
  t.diagnostic(JSON.stringify({ client, closureFiles: closure.length, observedInstalledFiles: observed.size, successfulProcesses: 6, deliberateInputFailureExit: 1 }));
  await workspace.cleanup(); assert.equal(existsSync(workspace.path), false);
});
