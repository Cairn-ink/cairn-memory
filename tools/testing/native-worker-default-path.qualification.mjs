// R2m investigation: the exact v33 DELETE getter/account preparation and event.
// Compare with green main 63cd28b6; requires full local history, no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTestWorkspace } from './workspace.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
test('exact unbound native Worker getter/account case agrees with main 63cd28b6', { timeout: 120000 }, t => {
  const w = createTestWorkspace(t, { prefix: 'r2m-native-main-' });
  const archive = join(w.path, 'main.tar');
  execFileSync('git', ['archive', '--output', archive, '63cd28b6', 'core', 'tools/testing', 'plugins/cairn-memory/lib/redact.mjs'], { cwd: root });
  execFileSync('tar', ['-xf', archive, '-C', w.path]);
  const relative = 'core/test/commit-dispatch-default-path.test.mjs';
  let source = readFileSync(resolve(root, relative), 'utf8');
  // This is our added probe, not a main test or family gate. Main has no
  // dispatcher module, so omit only its test-hook activation self-check.
  const importLine = "const { createCommitDispatcher } = await import('../commit-dispatch.mjs');\n";
  const activation = "  assert.throws(() => createCommitDispatcher(), /R2M_DEFAULT_DISPATCHER_REACHED:createCommitDispatcher/,\n    'R2M_DEFAULT_GUARD_ACTIVE');\n";
  for (const anchor of [importLine, activation]) {
    assert.equal(source.split(anchor).length, 2, 'R2M_MAIN_PROBE_ANCHOR');
    source = source.replace(anchor, '');
  }
  writeFileSync(join(w.path, relative), source);
  const fixtures = join(w.path, 'core/test/fixtures'); mkdirSync(fixtures, { recursive: true });
  writeFileSync(join(fixtures, 'commit-dispatch-default-guard.mjs'),
    readFileSync(resolve(root, 'core/test/fixtures/commit-dispatch-default-guard.mjs')));
  for (const [engine, path] of [['main', join(w.path, relative)], ['current', resolve(root, relative)]]) {
    const args = ['tools/testing/run.mjs', path];
    const child = spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8', timeout: 55000, maxBuffer: 2 * 1024 * 1024 });
    t.diagnostic('R2M_NATIVE_MAIN_COMPARE ' + JSON.stringify({ engine, command: [process.execPath, ...args], rc: child.status, signal: child.signal }));
    assert.equal(child.status, 0, 'R2M_NATIVE_MAIN_CASE:' + engine + '\n' + child.stdout + '\n' + child.stderr);
  }
});
