import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
const root = fileURLToPath(new URL('../../../', import.meta.url));
const allowed = new Set(['integrations/client/capture-cursor.mjs', 'plugins/cairn-memory/lib/capture-cursor.mjs',
  'plugins/cairn-memory/scripts/hook.mjs', 'integrations/client/bundle.mjs',
  'integrations/client/pairing.mjs', 'plugins/cairn-memory/lib/pairing.mjs']);
async function sources(path) {
  const out = [];
  for (const entry of await readdir(path, { withFileTypes: true })) {
    if (['test', 'testing', 'node_modules', 'fixtures'].includes(entry.name)) continue;
    const full = join(path, entry.name);
    if (entry.isDirectory()) out.push(...await sources(full));
    else if (/\.(?:mjs|cjs|js|ts)$/.test(entry.name)) out.push(full);
  }
  return out;
}
test('sessions namespace belongs only to Claude capture; F0 never ships', async () => {
  for (const file of [...await sources(join(root, 'integrations')), ...await sources(join(root, 'plugins'))]) {
    const source = await readFile(file, 'utf8');
    if (relative(root, file).endsWith('/pairing.mjs')) {
      const detector = source.slice(source.indexOf('export async function hasClaudeEvidence'), source.indexOf('/** Read-only, exact known-file'));
      assert.ok(detector.includes("join(root, 'sessions')"));
      assert.doesNotMatch(detector, /\b(?:writeFile|privateWrite|writeCaptureCursor|mkdir|rename|unlink|rm|link)\s*\(/);
      assert.equal((source.match(/['"`]sessions['"`]/g) ?? []).length, 1, 'pairing may only reference sessions in its read-only detector');
    }

    // Conservatively forbid even references/imports outside the audited owners.
    if (/['"`][^'"`\n]*\bsessions\b[^'"`\n]*['"`]|capture-cursor|\bcaptureCursorPath\b|\bwriteCaptureCursor\b/.test(source)) {
      assert.ok(allowed.has(relative(root, file)), `Claude-only cursor namespace: ${relative(root, file)}`);
    }
  }
  const artifact = JSON.parse(await readFile(join(root, 'packaging/artifact-files.json')));
  assert.ok(artifact.every(path => !path.includes('test/feasibility/')));
});
test('suite home guard rejects real home resolution and host state before filesystem access', t => {
  const workspace = createTestWorkspace(t, { prefix: 'cx2-home-guard-' });
  const guard = fileURLToPath(new URL('../testing/home-guard.mjs', import.meta.url));
  // A synthetic forbidden home proves the guard without resolving/reading the real one.
  for (const code of ["require('node:os').homedir()", "require('node:fs').readFileSync(process.env.HOME + '/.codex/config.toml')"]) {
    const result = spawnSync(process.execPath, ['--import', guard, '-e', code], {
      env: { PATH: process.env.PATH, HOME: workspace.path, CAIRN_TEST_REAL_HOME: workspace.path,
        TMPDIR: process.env.TMPDIR, CLAUDE_PLUGIN_DATA: join(workspace.path, 'data') }, encoding: 'utf8' });
    assert.equal(result.status, 1); assert.match(result.stderr, /test_(resolved_real_home|accessed_real_state)/);
  }
});
