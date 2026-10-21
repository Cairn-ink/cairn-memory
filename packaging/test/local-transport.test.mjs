import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';
import { buildArtifact, command, packageName } from '../build.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const preload = fileURLToPath(new URL('./fixtures/local-oneshot.mjs', import.meta.url));
const driver = fileURLToPath(new URL('./fixtures/local-transport.mjs', import.meta.url));
function sourceClosure() {
  const queue = ['adapters/local/cli.mjs', 'integrations/client/raw/local-transport.mjs'], seen = new Set();
  while (queue.length) {
    const path = queue.pop(); if (seen.has(path)) continue; seen.add(path);
    if (!path.endsWith('.mjs')) continue;
    const text = readFileSync(join(root, path), 'utf8');
    const imports = [...text.matchAll(/\b(?:from\s*|import\s*\(?\s*)['"](\.[^'"]+)['"]/g)];
    const assets = [...text.matchAll(/new URL\(\s*['"]([^'"]+)['"]\s*,\s*import\.meta\.url\s*\)/g)];
    for (const row of [...imports, ...assets]) {
      const next = relative(root, resolve(root, dirname(path), row[1])); assert.equal(next.startsWith('..'), false); queue.push(next);
    }
  }
  return [...seen].sort();
}
for (const client of ['claude-code', 'codex']) test(`B4a installed ${client}: transport and fresh one-shot children use only archive runtime`, { timeout: 120000 }, async t => {
  const workspace = createTestWorkspace(t, { prefix: 'installed-local-transport-' });
  const home = join(workspace.path, 'home'), usage = join(workspace.path, 'usage');
  mkdirSync(home, { mode: 0o755 }); mkdirSync(usage, { mode: 0o700 });
  const artifact = buildArtifact(), closure = sourceClosure();
  writeFileSync(join(workspace.path, 'package.json'), JSON.stringify({ name: 'synthetic-local-transport', version: '0.0.0', private: true }), { flag: 'wx', mode: 0o600 });
  command('npm', ['install', '--prefix', workspace.path, '--offline', '--ignore-scripts', '--no-audit', '--no-fund', artifact.artifactPath], workspace.path, artifact.userconfig);
  const installed = join(workspace.path, 'node_modules', packageName), configPath = join(workspace.path, 'config.json');
  for (const path of closure) {
    assert.ok(artifact.files.includes(path), path);
    assert.deepEqual(readFileSync(join(installed, path)), readFileSync(join(root, path)));
  }
  const database = join(workspace.path, 'memory.sqlite'), httpTrace = join(workspace.path, 'http.jsonl');
  const scaffold = { PATH: dirname(process.execPath), HOME: home, TMPDIR: workspace.path, TMP: workspace.path, TEMP: workspace.path,
    NODE_DISABLE_COMPILE_CACHE: '1', NODE_NO_WARNINGS: '1', SYNTHETIC_INSTALLED: installed,
    SYNTHETIC_TRACE: httpTrace, SYNTHETIC_MODE: 'memory', SYNTHETIC_CLIENT: client, SYNTHETIC_DATABASE: database,
    SYNTHETIC_CONFIG: configPath, SYNTHETIC_CORE: join(installed, 'core/index.mjs'), SYNTHETIC_USAGE: usage };
  const prepared = spawnSync(process.execPath, [preload, 'prepare'], { encoding: 'utf8', timeout: 12000,
    env: { ...scaffold, SYNTHETIC_IMPORT_TRACE: join(workspace.path, 'prepare-imports.jsonl') } });
  assert.equal(prepared.error, undefined); assert.equal(prepared.status, 0, prepared.stderr); assert.equal(prepared.signal, null);
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  config.provider.apiKeyEnv = 'CAIRN_SYNTHETIC_API_KEY'; writeFileSync(configPath, JSON.stringify(config));
  const modePath = join(workspace.path, 'mode'); writeFileSync(modePath, 'memory');
  const executable = join(workspace.path, 'synthetic-node'), trace = join(workspace.path, 'host-imports.jsonl');
  // Explicit test executable inserts fake HTTP before the installed CLI. These
  // scaffolding variables/preload are NOT inherited or forwarded by production.
  writeFileSync(executable, `#!${process.execPath}
import {spawn} from 'node:child_process'; import {readFileSync} from 'node:fs';
if(process.argv[2]==='--version'){process.stdout.write(process.version+'\\n');}
else {
 const env={...process.env,...${JSON.stringify(scaffold)},SYNTHETIC_MODE:readFileSync(${JSON.stringify(modePath)},'utf8'),
 SYNTHETIC_IMPORT_TRACE:${JSON.stringify(join(workspace.path, 'child-imports-'))}+process.pid+'.jsonl'};
 const child=spawn(${JSON.stringify(process.execPath)},['--import',${JSON.stringify(preload)},...process.argv.slice(2)],{env,stdio:'inherit',shell:false});
 for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>child.kill(signal));
 child.once('error',()=>{process.exitCode=1});child.once('close',(code)=>{process.exitCode=code??1});
}
`, { flag: 'wx', mode: 0o700 });
  const settings = join(workspace.path, 'settings.json');
  writeFileSync(settings, JSON.stringify({ installed, configPath, home, trace, executable, modePath, client }), { flag: 'wx', mode: 0o600 });
  const result = spawnSync(process.execPath, [driver, settings], { encoding: 'utf8', timeout: 45000, maxBuffer: 262144,
    env: { PATH: dirname(process.execPath), HOME: home, TMPDIR: workspace.path, TMP: workspace.path, TEMP: workspace.path, NODE_NO_WARNINGS: '1' } });
  assert.equal(result.error, undefined); assert.equal(result.signal, null); assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stderr, /synthetic_source_secret|synthetic_key_secret/);
  const response = JSON.parse(result.stdout), observed = new Set();
  const traces = readdirSync(workspace.path).filter(name => /^(?:prepare-imports|host-imports|child-imports-\d+)\.jsonl$/.test(name));
  assert.equal(traces.filter(name => name.startsWith('child-imports-')).length, 5);
  for (const name of traces) for (const line of readFileSync(join(workspace.path, name), 'utf8').trim().split('\n').filter(Boolean)) {
    const row = JSON.parse(line); if (row.path.startsWith(installed + '/')) observed.add(relative(installed, row.path));
  }
  assert.deepEqual([...observed].sort(), closure);
  const db = new DatabaseSync(database, { readOnly: true });
  try {
    const parts = db.prepare('SELECT sealed FROM raw_parts WHERE conversation_id=? AND message_id=? ORDER BY part_index').all(response.conversationId, 'message-first');
    assert.equal(parts.length, 2); assert.equal(Buffer.concat(parts.map(part => Buffer.from(part.sealed))).toString(), response.text);
    assert.equal(db.prepare('SELECT count(*) n FROM memories').get().n, 1);
  } finally { db.close(); }
  const ledgers = readdirSync(join(usage, 'usage')).filter(name => name.endsWith('.json')); assert.equal(ledgers.length, 1);
  const ledger = JSON.parse(readFileSync(join(usage, 'usage', ledgers[0]), 'utf8')); assert.equal(ledger.used, 4); assert.deepEqual(ledger.reservations, []);
  assert.equal(readFileSync(httpTrace, 'utf8').trim().split('\n').length, 7);
  t.diagnostic(JSON.stringify({ client, closureFiles: closure.length, observedInstalledFiles: observed.size, normalCaptureChildExits: 5, completed: 3, incomplete: 2 }));
  await workspace.cleanup(); assert.equal(existsSync(workspace.path), false);
});
