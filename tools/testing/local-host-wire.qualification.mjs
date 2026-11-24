import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { migrateLegacyStore, SQLITE_PHYSICAL_VERSION } from '../../packages/adapter-sqlite/src/index.mjs';
import { createLegacyBackup } from '../../packages/adapter-sqlite/src/legacy/backup.mjs';
import { buildCoreLocalCandidate } from '../../packaging/build-core-local.mjs';
import { command } from '../../packaging/build.mjs';
import { sha256 } from '../../packaging/core-local/engine-id.mjs';
import { compareWire, golden, installCandidate, isolatedEnv, scopeArgs, withStdio }
  from '../../packaging/test/fixtures/local-host-wire-replay.mjs';

const repo = fileURLToPath(new URL('../..', import.meta.url));
const tagPath = 'installer-v0.6.11:packages/setup/runtime/engine/';
const archiveName = 'cairn-memory-local-preview-0.0.0-preview.1.tgz';
const packageName = 'cairn-memory-local-preview';
const json = path => JSON.parse(readFileSync(path, 'utf8'));

function blob(path) {
  const result = spawnSync('git', ['show', tagPath + path], { cwd: repo, timeout: 15_000, maxBuffer: 16 * 1024 * 1024 });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr.toString());
  return result.stdout;
}

function installLegacy(directory) {
  mkdirSync(directory);
  const manifest = JSON.parse(blob('manifest.json'));
  const archiveBytes = blob(archiveName);
  assert.equal(archiveBytes.length, manifest.bytes);
  assert.equal(sha256(archiveBytes), manifest.sha256);
  const archive = join(directory, archiveName);
  const npmrc = join(directory, 'empty.npmrc');
  writeFileSync(archive, archiveBytes);
  writeFileSync(npmrc, '');
  command('npm', ['install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', archive], directory, npmrc);
  const root = join(directory, 'node_modules', packageName);
  const require = createRequire(join(root, 'adapters', 'mcp', 'server.mjs'));
  const lock = json(join(root, 'npm-shrinkwrap.json'));
  for (const pkg of ['@modelcontextprotocol/server', '@modelcontextprotocol/core', 'zod', 'tiktoken']) {
    assert.equal(json(join(directory, 'node_modules', pkg, 'package.json')).version,
      lock.packages['node_modules/' + pkg].version);
  }
  for (const entry of ['@modelcontextprotocol/server', '@modelcontextprotocol/server/stdio', 'zod/v4', 'tiktoken']) {
    assert.ok(require.resolve(entry).startsWith(join(directory, 'node_modules') + '/'));
  }
  return { bin: join(root, 'bin', 'cairn-memory.mjs'), root, tokenizer: require('tiktoken'),
    tokenizerPath: join(directory, 'node_modules', 'tiktoken') };
}

const scratch = mkdtempSync(join(tmpdir(), 'cairn-wire-'));
try {
  const legacy = installLegacy(join(scratch, 'legacy-install'));
  const builtDir = join(scratch, 'out');
  const built = buildCoreLocalCandidate(builtDir);
  const candidate = installCandidate(join(scratch, 'candidate-install'), join(builtDir, built.archive.filename), built.package.name);
  for (const asset of ['package.json', 'tiktoken.cjs', 'tiktoken_bg.cjs', 'tiktoken_bg.wasm']) {
    assert.equal(sha256(readFileSync(join(legacy.tokenizerPath, asset))),
      sha256(readFileSync(join(candidate.root, 'packaging', 'core-local', 'vendor', 'tiktoken', asset))), asset);
  }
  assert.deepEqual(readFileSync(join(candidate.root, 'licenses', 'tiktoken-LICENSE')),
    readFileSync(join(legacy.root, 'licenses', 'tiktoken-LICENSE')));
  console.log('Verified installed dependency pins and four tokenizer asset digests plus the license.');

  const source = join(scratch, 'layout.sqlite');
  const stoppedLegacy = async (path, work) => {
    try {
      return await withStdio(legacy.bin, ['--db', path, ...scopeArgs], scratch, work);
    } finally {
      const stop = spawnSync(process.execPath, [legacy.bin, 'daemon', 'stop', '--db', path],
        { cwd: scratch, env: isolatedEnv(scratch), encoding: 'utf8', timeout: 15_000 });
      assert.ifError(stop.error);
      assert.equal(stop.status, 0, stop.stderr);
      console.log('Installed daemon stop exit 0');
    }
  };
  await stoppedLegacy(source, async (request, notify) => {
    assert.deepEqual(await request('initialize', golden.exchanges.initialize.params), golden.exchanges.initialize.response);
    notify('notifications/initialized');
    assert.deepEqual(await request('ping'), golden.exchanges.ping.response);
  });
  const db = new DatabaseSync(source);
  let expectedStoreId;
  try {
    assert.equal(db.prepare('PRAGMA user_version').get().user_version, golden.sourceLayout);
    assert.equal(db.prepare('SELECT count(*) AS n FROM memories').get().n, 0);
    expectedStoreId = db.prepare('SELECT store_id FROM store_metadata').get().store_id;
    assert.equal(db.prepare('PRAGMA journal_mode = DELETE').get().journal_mode, 'delete');
  } finally {
    db.close();
  }

  // Both replays start from the exact same closed, empty layout-29 state.
  // Only the legacy replay copy is ever served by the installed daemon.
  const replaySource = join(scratch, 'legacy-replay.sqlite');
  copyFileSync(source, replaySource);
  const quiescence = { admissionsClosed: true, writersStopped: true, readersDrained: true, oldHandlesClosed: true };
  const destination = join(scratch, 'migrated.sqlite');
  const input = { path: source, expectedStoreId, quiescence, destination, backupDirectory: join(scratch, 'backup') };
  await createLegacyBackup(input);
  const migrated = await migrateLegacyStore(input);
  assert.equal(migrated.sourceLayout, golden.sourceLayout);
  const target = new DatabaseSync(destination, { readOnly: true });
  try {
    assert.equal(target.prepare('PRAGMA user_version').get().user_version, SQLITE_PHYSICAL_VERSION);
  } finally {
    target.close();
  }
  console.log('Migrated the closed layout-' + migrated.sourceLayout + ' baseline to SQLite layout ' + SQLITE_PHYSICAL_VERSION + '.');

  const encoding = legacy.tokenizer.get_encoding('o200k_base');
  const count = text => encoding.encode(text, [], []).length;
  try {
    const baseline = await stoppedLegacy(replaySource, (request, notify) => compareWire(async (method, params, label) => {
      // Let the installed daemon's one-second Raw upkeep publish the
      // post-forget inventory before measuring the final context read.
      if (label === 'read context forgotten') await delay(1250);
      return request(method, params);
    }, notify, count, { legacy: true }));
    const comparison = await withStdio(candidate.bin, ['--db', destination, ...scopeArgs], scratch,
      (request, notify) => compareWire(request, notify, count));
    for (const [name, result] of [['Installed baseline', baseline], ['Migrated candidate', comparison]]) {
      console.log(name + ' matched ' + result.matched + ' of ' + result.total);
      for (const entry of result.differences) console.error(name + '\t' + entry);
      assert.equal(result.total, 50);
    }
    if (baseline.differences.length || comparison.differences.length) process.exitCode = 1;
  } finally {
    encoding.free();
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
