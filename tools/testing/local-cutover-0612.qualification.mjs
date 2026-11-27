import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { rawRequest, splitRaw } from '../../core/testing/raw-fixtures.mjs';
import { rationaleModel } from '../../core/testing/rationale-model.mjs';
import { golden, withStdio } from '../../packaging/test/fixtures/local-host-wire-replay.mjs';
import { assertEngineCache } from '../../packages/setup/test/engine-cache.mjs';
import { assertFixtureClients, fixtureBinaryGuard } from '../../packages/setup/test/fixture-clients.mjs';

const repo = fileURLToPath(new URL('../../', import.meta.url));
const tag = 'installer-v0.6.12';
const tagEngine = tag + ':packages/setup/runtime/engine/';
const archiveName = 'cairn-memory-local-preview-0.0.0-preview.1.tgz';
const namespace = { ownerId: 'synthetic-owner', scope: 'project', projectId: 'synthetic-project' };
const node = process.execPath;
const cache = process.env.CAIRN_SETUP_NPM_CACHE;
const json = path => JSON.parse(readFileSync(path, 'utf8'));
const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
const candidate = join(repo, 'packages/setup/bin/memory.mjs');

function run(executable, args, { cwd, environment, input, expect = 0 }) {
  const result = spawnSync(executable, args, {
    cwd, env: environment, input, timeout: 120_000, maxBuffer: 16 * 1024 * 1024, killSignal: 'SIGKILL',
  });
  assert.ifError(result.error);
  assert.equal(result.status, expect, result.stdout.toString() + result.stderr.toString());
  return result.stdout;
}

function publishedInstaller(scratch) {
  const options = { cwd: repo, environment: { PATH: '/usr/bin:/bin', HOME: scratch, LANG: 'C.UTF-8' } };
  const packageDir = join(scratch, 'packages/setup');
  const archived = run('git', ['archive', tag, '--', 'packages/setup/bin', 'packages/setup/lib',
    'packages/setup/package.json', 'packages/setup/runtime'], options);
  run('tar', ['-xf', '-', '-C', scratch], { ...options, input: archived });
  assert.equal(json(join(packageDir, 'package.json')).version, '0.6.12');
  const manifestBytes = run('git', ['show', tagEngine + 'manifest.json'], options);
  const archiveBytes = run('git', ['show', tagEngine + archiveName], options);
  const manifest = JSON.parse(manifestBytes);
  assert.equal(archiveBytes.length, manifest.bytes);
  assert.equal(createHash('sha256').update(archiveBytes).digest('hex'), manifest.sha256);
  assert.deepEqual(readFileSync(join(packageDir, 'runtime/engine/manifest.json')), manifestBytes);
  assert.deepEqual(readFileSync(join(packageDir, 'runtime/engine', archiveName)), archiveBytes);
  return { bin: join(packageDir, 'bin/memory.mjs'), manifest };
}

function fixture(scratch) {
  const home = join(scratch, 'home');
  const bin = join(scratch, 'bin');
  for (const path of [home, bin]) mkdirSync(path, { mode: 0o700 });
  const state = join(scratch, 'claude.json'), calls = join(scratch, 'claude.jsonl');
  writeFileSync(state, '{}', { mode: 0o600 });
  writeFileSync(join(bin, 'claude'), '#!' + node + '\n' + fixtureBinaryGuard(scratch) +
    `process.env.FAKE_STATE = ${JSON.stringify(state)};\nprocess.env.FAKE_CALLS = ${JSON.stringify(calls)};\n` +
    readFileSync(join(repo, 'packages/setup/test/fake-claude.mjs'), 'utf8'), { mode: 0o700 });
  const npm = realpathSync(join(dirname(node), 'npm'));
  const userconfig = join(scratch, 'empty-user.npmrc'), globalconfig = join(scratch, 'empty-global.npmrc');
  for (const path of [userconfig, globalconfig]) writeFileSync(path, '', { mode: 0o600 });
  writeFileSync(join(bin, 'npm'), '#!/bin/sh\nexec ' + quote(node) + ' ' + quote(npm) +
    ' --offline --userconfig ' + quote(userconfig) + ' --globalconfig ' + quote(globalconfig) +
    ' --cache ' + quote(cache) + ' "$@"\n', { mode: 0o700 });
  const environment = { HOME: home, CODEX_HOME: join(home, '.codex'), PATH: bin, TMPDIR: scratch,
    LANG: 'C.UTF-8', CAIRN_SETUP_NPM_CACHE: cache, CAIRN_SETUP_NPM_OFFLINE: '1' };
  assert.deepEqual(Object.keys(assertFixtureClients(environment, scratch)), ['claude']);
  return {
    descriptor: () => json(join(home, '.cairn-memory/installation.json')),
    vector: () => json(join(home, '.claude.json')).mcpServers['cairn-local'].args,
    run: (entry, args, expect = 0) => run(node, [entry, ...args, '--lang', 'en'],
      { cwd: scratch, environment, expect }).toString(),
  };
}

async function withTools([entry, ...args], directory, work) {
  await withStdio(entry, args, directory, async (request, notify) => {
    assert.ok((await request('initialize', golden.exchanges.initialize.params)).result);
    notify('notifications/initialized');
    assert.ok((await request('ping')).result);
    await work(async (name, args) => {
      const reply = await request('tools/call', { name, arguments: args });
      assert.ok(reply.result, JSON.stringify(reply));
      return JSON.parse(reply.result.content[0].text);
    });
  });
}

function value(reply) {
  assert.equal(reply.ok, true, JSON.stringify(reply));
  return reply.value;
}

async function captureLegacy(entry, database, memoryId, turns) {
  const db = new DatabaseSync(database, { readOnly: true });
  let anchor;
  try {
    anchor = Date.parse(db.prepare('SELECT updated_at FROM memories WHERE id = ?').get(memoryId).updated_at);
    assert.ok(Number.isFinite(anchor));
  } finally { db.close(); }
  const { openMemoryCore } = await import(pathToFileURL(join(dirname(entry), '../core/index.mjs')));
  const model = { ...rationaleModel(), extract: () => ({ items: [] }) };
  const core = openMemoryCore({ path: database, raw: true, rawSearch: false, model });
  try {
    for (const [index, { text, minutes }] of turns.entries()) {
      const id = 'synthetic-turn-' + index;
      const occurredAt = new Date(anchor + minutes * 60_000).toISOString();
      const input = rawRequest(splitRaw(text, { id, ordinal: 1, occurredAt })[0], { namespace, sessionId: id });
      assert.ok(value(await core.captureRaw(input)).raw.conversationId);
    }
  } finally { await core.close(); }
}

assertEngineCache(cache);
const scratch = mkdtempSync(join(tmpdir(), 'cairn-0612-'));
try {
  const { bin: legacy, manifest } = publishedInstaller(scratch);
  const f = fixture(scratch);
  let active = false;
  try {
    f.run(legacy, ['setup', '--local', '--no-capture', '--owner', namespace.ownerId, '--project', namespace.projectId]);
    const installed = f.descriptor();
    assert.equal(installed.installerVersion, '0.6.12');
    assert.equal(installed.engine.sha256, manifest.sha256);
    const legacyVector = f.vector();
    const content = 'The synthetic marmot filed a striped map.';
    let memory;
    try {
      await withTools(legacyVector, scratch, async call => {
        memory = value(await call('remember_memory', { content })).memory;
      });
    } finally { f.run(legacy, ['daemon', 'stop', '--local']); }
    const withheld = 'The synthetic zephyrite beacon has an amber base.';
    const retained = 'The synthetic zephyrite lantern has a blue base.';
    await captureLegacy(legacyVector[0], installed.database.path, memory.id,
      [{ text: withheld, minutes: 29 }, { text: retained, minutes: 31 }]);
    const legacyRaw = f.run(legacy, ['raw', 'list']).trim().split('\n').map(JSON.parse);
    assert.equal(legacyRaw.length, 2);

    assert.match(f.run(candidate, ['setup', '--local']), /Local cutover verified/u);
    assert.match(f.run(candidate, ['local-cutover', '--confirm']), /Local cutover active/u);
    active = true;
    assert.match(f.run(candidate, ['status']), /Local cutover active/u);
    const vector = f.vector();
    const target = vector[vector.indexOf('--db') + 1];
    assert.ok(vector[0].endsWith('/packaging/core-local/cli.mjs'));
    assert.notEqual(target, installed.database.path);
    assert.equal(readFileSync(installed.database.path, 'utf8'), 'Cairn local store migrated. This path is retired.\n');

    for (const operation of ['export', 'index']) {
      assert.equal(f.run(candidate, ['raw', operation], 2), f.run(legacy, ['raw', operation], 2));
    }
    const search = { query: 'zephyrite', types: ['memory'], intent: 'current' };
    const checkRaw = async (call, visible) => {
      const items = JSON.stringify(value(await call('read_memory_context', search)).items);
      assert.equal(items.includes(withheld), visible, items);
      assert.ok(items.includes(retained), items);
    };
    await withTools(vector, scratch, async call => {
      assert.equal(value(await call('inspect_memory', { memoryId: memory.id })).memory.content, content);
      await checkRaw(call, true);
      assert.equal(value(await call('forget_memory', { memoryId: memory.id, expectedRevision: memory.revision })).forgotten,
        true);
      await checkRaw(call, false);
    });
    f.run(candidate, ['daemon', 'stop', '--local']);
    await withTools(vector, scratch, call => checkRaw(call, false));
    console.log('Published 0.6.12 upgraded to active. MCP served the migrated memory and Raw turns, and forget withheld the nearby Raw turn across restart.');
  } finally {
    if (active) f.run(candidate, ['daemon', 'stop', '--local']);
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
