import assert from 'node:assert/strict';
import { existsSync, lstatSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { codexAddArguments } from '../lib/local-codex.mjs';
import { captureTargetFor } from '../lib/local-cutover-journal.mjs';
import { readBundledCoreLocal } from '../lib/local-engine.mjs';
import { claude, codex, confirm, launch, legacyFixture, linux, operator, prepare, readJSON, rpc, setup } from './local-cutover-fix-support.mjs';

const checkpointProgram = `
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { runLocalCutover } from ${JSON.stringify(new URL('../lib/local-cutover.mjs', import.meta.url).href)};
const { point, root, manifest, inspection } = JSON.parse(process.argv[1]);
const runClaude = args => spawnSync(join(process.env.PATH, 'claude'), args,
  { env: process.env, encoding: 'utf8', timeout: 5000 });
await runLocalCutover({ root, manifest, env: process.env, action: 'confirm-activation',
  context: { inspection, runClaude, t: key => key, write: Object.assign(() => {}, { literal() {} }) },
  onCheckpoint(state) { if (state === point) process.kill(process.pid, 'SIGKILL'); } });
`;

const earlyPoints = ['activation-staging', 'activation-target-published', 'capture-paused', 'capture-store-staged',
  'capture-binding-staged', 'capture-native-published'];

for (const point of [...earlyPoints, 'activation-mcp-claude', 'activation-mcp-codex', 'activation-retirement-planned',
  'activation-source-exchanged', 'activation-legacy-sealed', 'activation-source-removed', 'activation-caches-removed',
  'activation-backup-removed', 'activation-reclaimed', 'capture-armed', 'activation-active']) {
  test('confirmation survives SIGKILL at ' + point, linux, async t => {
    const f = await legacyFixture(t, { both: true, capture: true });
    operator(f, prepare);
    const { cutover } = readJSON(join(f.root, 'installation.json')).migration;
    const backup = join(f.root, '.cutover-' + cutover.id, 'backup-' + cutover.attemptId, 'store.sqlite');
    const original = readFileSync(f.database);
    const manifest = await readBundledCoreLocal();
    const child = launch(f, '--input-type=module', ['-e', checkpointProgram,
      JSON.stringify({ point, manifest, root: f.root, inspection: f.inspection })]);
    assert.equal(child.signal, 'SIGKILL', child.stderr);
    const registrations = [claude(f), await codex(f)];
    if (earlyPoints.includes(point)) {
      assert.ok(registrations.every(record => record?.args[2] === f.database));
      assert.ok(readFileSync(f.database).equals(original), 'legacy must still serve both clients');
      assert.ok(readFileSync(backup).length > 0);
    }
    if (point === 'activation-mcp-claude') {
      assert.notEqual(registrations[0].args[2], f.database);
      assert.equal(registrations[1].args[2], f.database);
      assert.ok(readFileSync(f.database).equals(original), 'legacy must still serve Codex');
      assert.ok(readFileSync(backup).length > 0);
    }
    if (!readFileSync(f.database).equals(original)) {
      assert.ok(registrations.every(record => record?.args[2] !== f.database), 'legacy retired before both switches');
    }
    if (point === 'activation-legacy-sealed') {
      const retired = join(f.parent, '.cairn-retired-' + cutover.attemptId);
      assert.match(operator(f, ['local-cutover', '--abort'], { code: 2 }), /can no longer be aborted/u);
      assert.ok(readFileSync(retired).equals(original), 'abort refusal must preserve the sealed legacy store');
    }
    const retry = ['activation-mcp-claude', 'activation-legacy-sealed'].includes(point) ? setup : confirm;
    assert.match(operator(f, retry), /Local cutover active/u);
    const active = [claude(f), await codex(f)];
    assert.deepEqual(active[0].args, active[1].args);
    assert.equal(active[0].command, active[1].command);
    assert.notEqual(active[0].args[2], f.database);
    const { command: node, args: [entry, ...vector] } = active[0];
    const ping = launch(f, entry, vector, { node, input: rpc('ping', {}) });
    assert.equal(ping.status, 0, ping.stderr);
    assert.deepEqual(JSON.parse(ping.stdout).result, {});
  });
}

function killAfterFilesystemCall(f, method, path) {
  const preload = join(f.parent, 'kill-after-filesystem-call.mjs');
  writeFileSync(preload, `
import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
const method = ${JSON.stringify(method)};
const original = fs[method];
fs[method] = async (...args) => {
  const result = await original(...args);
  if (args[method === 'link' ? 1 : 0] === ${JSON.stringify(path)} &&
      (method === 'link' || args[1] === 'wx')) process.kill(process.pid, 'SIGKILL');
  return result;
};
syncBuiltinESMExports();
`);
  const result = launch(f, new URL('../bin/memory.mjs', import.meta.url).pathname, confirm, { preload });
  assert.equal(result.signal, 'SIGKILL', result.stdout + result.stderr);
}

async function assertServing(f, target) {
  const active = claude(f);
  assert.deepEqual((await codex(f)).args, active.args);
  assert.equal(active.args[2], target);
  const { command: node, args: [entry, ...vector] } = active;
  const ping = launch(f, entry, vector, { node, input: rpc('ping', {}) });
  assert.equal(ping.status, 0, ping.stderr);
  assert.deepEqual(JSON.parse(ping.stdout).result, {});
}

test('confirmation recovers the exact two-link tombstone left by SIGKILL', linux, async t => {
  const f = await legacyFixture(t, { both: true });
  operator(f, prepare);
  const { cutover } = readJSON(join(f.root, 'installation.json')).migration;
  const target = captureTargetFor(f.database, cutover.attemptId);
  const retiredName = '.cairn-retired-' + cutover.attemptId;
  const retired = join(f.parent, retiredName);
  const original = readFileSync(f.database);
  killAfterFilesystemCall(f, 'link', retired);
  assert.equal(claude(f).args[2], target);
  assert.equal((await codex(f)).args[2], target);
  assert.ok(readFileSync(f.database).equals(original));
  const [temporaryName] = readdirSync(f.parent).filter(name => name.startsWith(retiredName + '.tmp-'));
  const temporary = join(f.parent, temporaryName);
  assert.equal(lstatSync(retired).nlink, 2);
  assert.equal(lstatSync(temporary).ino, lstatSync(retired).ino);

  const foreign = join(f.parent, 'unexpected-tombstone-link');
  renameSync(temporary, foreign);
  try {
    operator(f, confirm, { code: 2 });
    assert.equal(lstatSync(foreign).nlink, 2);
    assert.ok(readFileSync(f.database).equals(original));
  } finally { renameSync(foreign, temporary); }

  assert.match(operator(f, confirm), /Local cutover active/u);
  assert.equal(existsSync(temporary), false);
  assert.equal(existsSync(retired), false);
  await assertServing(f, target);
});

test('an empty Codex lock left by SIGKILL refuses with its path until removed by hand', linux, async t => {
  const f = await legacyFixture(t, { both: true });
  operator(f, prepare);
  const { cutover } = readJSON(join(f.root, 'installation.json')).migration;
  const target = captureTargetFor(f.database, cutover.attemptId);
  const lock = join(f.env.CODEX_HOME, '.cairn-setup.lock');
  killAfterFilesystemCall(f, 'open', lock);
  assert.equal(lstatSync(lock).size, 0);
  assert.equal(claude(f).args[2], target);
  assert.equal((await codex(f)).args[2], f.database);
  // An empty lock can belong to a live hosted setup, so retries never remove it.
  await delay(1100);
  for (const command of [setup, confirm]) {
    const refused = operator(f, command, { code: 2 });
    assert.match(refused, /empty Codex lock file/u);
    assert.ok(refused.includes('rm -- "' + lock + '"'));
    assert.equal(lstatSync(lock).size, 0);
    assert.equal((await codex(f)).args[2], f.database);
  }
  unlinkSync(lock);
  assert.match(operator(f, setup), /Local cutover active/u);
  assert.equal(existsSync(lock), false);
  await assertServing(f, target);
});

for (const published of [false, true]) {
  test('confirmation recovers the Codex lock when setup dies ' + (published ? 'after' : 'before') + ' native add', linux, async t => {
    const f = await legacyFixture(t, { both: true });
    operator(f, prepare);
    const { migration, node, clients } = readJSON(join(f.root, 'installation.json'));
    const target = captureTargetFor(f.database, migration.cutover.attemptId);
    const vector = { ...clients.codex.vector, node, engineId: migration.targetEngineId, databasePath: target };
    const nativeState = published ? { killAfterAdd: true } : { killBefore: codexAddArguments(f.root, vector).join(' ') };
    writeFileSync(join(f.parent, 'codex-state.json'), JSON.stringify(nativeState));
    const child = launch(f, new URL('../bin/memory.mjs', import.meta.url).pathname, confirm);
    assert.equal(child.signal, 'SIGKILL', child.stderr);
    const lock = join(f.env.CODEX_HOME, '.cairn-setup.lock');
    assert.ok(existsSync(lock));
    assert.equal(claude(f).args[2], target);
    assert.equal((await codex(f)).args[2], published ? target : f.database);
    assert.match(operator(f, setup), /Local cutover active/u);
    assert.equal(existsSync(lock), false);
    assert.equal((await codex(f)).args[2], target);
  });
}
