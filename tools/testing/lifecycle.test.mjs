import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { createTestWorkspace } from './workspace.mjs';

const runner = fileURLToPath(new URL('./run.mjs', import.meta.url));
const helper = new URL('./workspace.mjs', import.meta.url).href;
const root = fileURLToPath(new URL('../../', import.meta.url));

function launch(owner, args, options = {}) {
  const child = spawn(process.execPath, [runner, ...args], {
    cwd: root, env: { ...process.env, TMPDIR: owner.path, TMP: owner.path, TEMP: owner.path, ...options.env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', data => { output += data; });
  child.stderr.on('data', data => { output += data; });
  const done = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({ code, signal, output }));
  });
  owner.defer(async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
    await done;
  });
  return { child, done };
}

async function waitFor(predicate) {
  for (let i = 0; i < 200; i++) { if (predicate()) return; await delay(25); }
  assert.fail('subprocess readiness timeout');
}

const header = `import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, renameSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTestWorkspace } from ${JSON.stringify(helper)};
`;

for (const [name, source, expected] of [
  ['success', `test('legacy scratch', () => { writeFileSync(join(mkdtempSync(join(tmpdir(), 'legacy-')), 'file'), 'scratch'); });`, 0],
  ['assertion failure', `test('assertion', t => { const w = createTestWorkspace(t); writeFileSync(join(w.path, 'file'), 'scratch'); assert.fail('expected assertion'); });`, 1],
  ['setup failure', `test('setup', t => { createTestWorkspace(t); throw Error('expected setup'); });`, 1],
  ['resource close failure', `test('close', t => { const w = createTestWorkspace(t); w.defer(() => { throw Error('expected close'); }); });`, 1],
  ['runner cleanup failure', `test('replace', () => { const p = tmpdir(); renameSync(p, p + '-moved'); symlinkSync(p + '-moved', p, 'dir'); });`, 1],
  ['child failure', `test('child', async () => { const { spawn } = await import('node:child_process'); const c = spawn(process.execPath, ['-e', 'process.exit(7)']); const code = await new Promise(r => c.on('close', r)); assert.equal(code, 0); });`, 1],
]) {
  test(`subprocess ${name} reports status and owns scratch`, { timeout: 15000 }, async () => {
    const owner = createTestWorkspace(null);
    try {
      const file = join(owner.path, 'fixture.mjs');
      writeFileSync(file, header + source);
      const { done } = launch(owner, [file]);
      const result = await done;
      assert.equal(result.code, expected, result.output);
      const retained = readdirSync(owner.path).filter(name => name !== 'fixture.mjs');
      if (name === 'runner cleanup failure') {
        assert.match(result.output, /test_workspace_cleanup_failed/);
        assert.equal(retained.length, 2, 'unsafe replaced root deliberately retained');
      } else assert.deepEqual(retained, [], result.output);
    } finally { await owner.cleanup(); }
  });
}

for (const code of [0, 7]) {
  test(`script mode preserves exit ${code} and removes scratch`, async () => {
    const owner = createTestWorkspace(null);
    try {
      const file = join(owner.path, 'script.mjs');
      writeFileSync(file, `import { mkdtempSync } from 'node:fs'; import { tmpdir } from 'node:os'; import { join } from 'node:path'; mkdtempSync(join(tmpdir(), 'script-')); process.exitCode = ${code};`);
      const result = await launch(owner, ['--script', file]).done;
      assert.equal(result.code, code, result.output);
      assert.deepEqual(readdirSync(owner.path), ['script.mjs']);
    } finally { await owner.cleanup(); }
  });
}

for (const cleanupFails of [false, true]) {
test(`signal during awaited removal preserves ${cleanupFails ? 'cleanup failure' : 'termination'} status`, { timeout: 15000 }, async () => {
  const owner = createTestWorkspace(null);
  try {
    const file = join(owner.path, 'cleanup-signal.mjs');
    const child = join(owner.path, 'child.mjs');
    const marker = join(owner.path, 'cleanup-complete');
    writeFileSync(child, 'process.exitCode = 0;');
    writeFileSync(file, `import assert from 'node:assert/strict'; import fs from 'node:fs'; import { syncBuiltinESMExports } from 'node:module';
const originalRm = fs.promises.rm;
fs.promises.rm = async (path, options) => {
  assert.equal(fs.existsSync(path), true);
  const keepAlive = setInterval(() => {}, 1000);
  const delivered = new Promise(resolve => process.once('SIGTERM', resolve));
  process.kill(process.pid, 'SIGTERM');
  await delivered;
  clearInterval(keepAlive);
  assert.equal(fs.existsSync(path), true, 'signal must not interrupt awaited removal');
  await originalRm(path, options);
  assert.equal(fs.existsSync(path), false);
  fs.writeFileSync(${JSON.stringify(marker)}, 'removed');
  ${cleanupFails ? "throw new Error('synthetic_cleanup_failure');" : ''}
};
syncBuiltinESMExports();
process.argv = [process.execPath, ${JSON.stringify(runner)}, '--script', ${JSON.stringify(child)}];
await import(${JSON.stringify(new URL('./run.mjs', import.meta.url).href)});`);
    const result = await launch(owner, ['--script', file]).done;
    assert.equal(result.code, cleanupFails ? 1 : 143, result.output);
    assert.equal(readFileSync(marker, 'utf8'), 'removed');
    assert.deepEqual(readdirSync(owner.path).sort(), ['child.mjs', 'cleanup-complete', 'cleanup-signal.mjs']);
  } finally { await owner.cleanup(); }
});
}

test('overlapping invocations isolate roots and repeated runs leave no scratch', async () => {
  const owner = createTestWorkspace(null);
  try {
    const file = join(owner.path, 'script.mjs');
    writeFileSync(file, `import { tmpdir } from 'node:os'; console.log(tmpdir()); await new Promise(r => setTimeout(r, 100));`);
    for (let i = 0; i < 2; i++) {
      const results = await Promise.all([launch(owner, ['--script', file]).done, launch(owner, ['--script', file]).done]);
      assert.ok(results.every(result => result.code === 0));
      assert.notEqual(results[0].output, results[1].output);
      assert.deepEqual(readdirSync(owner.path), ['script.mjs']);
    }
  } finally { await owner.cleanup(); }
});

function live(pid) {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
    return !['Z', 'X'].includes(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[0]);
  } catch (error) { if (error.code === 'ENOENT' || error.code === 'ESRCH') return false; throw error; }
}

for (const terminate of [true, false]) {
test(`${terminate ? 'catchable termination' : 'ordinary parent exit'} waits for Linux child and grandchild before deletion`, { skip: process.platform !== 'linux', timeout: 15000 }, async () => {
  const owner = createTestWorkspace(null);
  try {
    const ready = join(owner.path, 'ready');
    const childReady = join(owner.path, 'child-ready');
    const grandReady = join(owner.path, 'grand-ready');
    const observed = join(owner.path, 'scratch-present-on-termination');
    const violation = join(owner.path, 'premature-deletion');
    const grand = join(owner.path, 'grand.mjs');
    const child = join(owner.path, 'child.mjs');
    const file = join(owner.path, 'script.mjs');
    const watcher = `import { existsSync, writeFileSync } from 'node:fs'; import { tmpdir } from 'node:os';
const scratch = tmpdir(); process.on('SIGTERM', () => { writeFileSync(existsSync(scratch) ? ${JSON.stringify(observed)} : ${JSON.stringify(violation)}, 'synthetic'); });
setInterval(() => { if (!existsSync(scratch)) writeFileSync(${JSON.stringify(violation)}, 'synthetic'); }, 10);
`;
    writeFileSync(grand, watcher + `writeFileSync(${JSON.stringify(grandReady)}, String(process.pid));`);
    writeFileSync(child, watcher + `import { spawn } from 'node:child_process'; spawn(process.execPath, [${JSON.stringify(grand)}], { stdio: 'ignore' }); writeFileSync(${JSON.stringify(childReady)}, String(process.pid));`);
    writeFileSync(file, watcher + `import { spawn } from 'node:child_process'; spawn(process.execPath, [${JSON.stringify(child)}], { stdio: 'ignore' });
const readiness = setInterval(() => { if (existsSync(${JSON.stringify(grandReady)})) { clearInterval(readiness); writeFileSync(${JSON.stringify(ready)}, 'ready'); ${terminate ? '' : 'process.exit(0);'} } }, 10);`);
    const run = launch(owner, ['--script', file]);
    await waitFor(() => existsSync(ready));
    const childPid = Number(readFileSync(childReady, 'utf8'));
    const grandPid = Number(readFileSync(grandReady, 'utf8'));
    assert.ok(live(childPid) && live(grandPid));
    if (terminate) run.child.kill('SIGTERM');
    const result = await run.done;
    assert.equal(result.code, terminate ? 143 : 0, result.output);
    assert.equal(live(childPid), false, 'child terminated before root removal');
    assert.equal(live(grandPid), false, 'grandchild terminated before root removal');
    assert.equal(existsSync(observed), true, 'descendant saw scratch still present during termination');
    assert.equal(existsSync(violation), false, 'scratch never disappeared under a live descendant');
    assert.equal(readdirSync(owner.path).some(name => name.startsWith('cairn-test-run-')), false);
  } finally {
    await owner.cleanup();
  }
});
}

test('sanitized artifact child follows scoped temp without application credentials', async () => {
  const owner = createTestWorkspace(null);
  try {
    const file = join(owner.path, 'script.mjs');
    const build = new URL('../../packaging/build.mjs', import.meta.url).href;
    writeFileSync(file, `import assert from 'node:assert/strict'; import { command } from ${JSON.stringify(build)}; import { tmpdir } from 'node:os';
const child = JSON.parse(command(process.execPath, ['-e', 'console.log(JSON.stringify({ temp: require("node:os").tmpdir(), secret: process.env.CAIRN_TEST_SECRET }))'], process.cwd(), ${JSON.stringify(join(owner.path, 'empty.npmrc'))}));
assert.equal(child.temp, tmpdir()); assert.equal(child.secret, undefined);`);
    const result = await launch(owner, ['--script', file], { env: { CAIRN_TEST_SECRET: 'synthetic-no-credential' } }).done;
    assert.equal(result.code, 0, result.output);
    assert.deepEqual(readdirSync(owner.path), ['script.mjs']);
  } finally { await owner.cleanup(); }
});

for (const [name, pattern, file] of [
  ['ordered', '^Q2 reaffirms with user evidence never retires its predecessor$', 'core/test/ordered-capture.test.mjs'],
  ['paired', '^paired schedule uses 16 independent SQLite arms, cold snapshots and source-only answers$', 'evaluation/live/test/qualified-comparison.test.mjs'],
  ['semantic', '^fake HTTP exercises all 36 fresh states with fixture namespaces and per-case request caps$', 'adapters/openai/test/semantic-evaluation.test.mjs'],
]) {
  test(`actual ${name} fixture leaves no owned invocation scratch`, { timeout: 60000 }, async () => {
    const owner = createTestWorkspace(null);
    try {
      const result = await launch(owner, ['--test-reporter=tap', `--test-name-pattern=${pattern}`, file]).done;
      assert.equal(result.code, 0, result.output);
      assert.match(result.output, /# pass [1-9]/, 'the selected fixture must actually run');
      assert.deepEqual(readdirSync(owner.path), [], result.output);
    } finally { await owner.cleanup(); }
  });
}
