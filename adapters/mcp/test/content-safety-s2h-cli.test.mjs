import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { copySqliteFixture, safetyFixture } from '../../../core/testing/content-safety-s2h-fixture.mjs';

const cli = new URL('../cli.mjs', import.meta.url).pathname;
test('S2h retained MCP negotiates a migrated v48 store through the CLI', async t => {
  const { host, namespace } = await import('./retained-raw-support.mjs');
  const f = safetyFixture(t, 33); await f.migrate();
  const profilePath = join(f.workspace.path, 'retained.json');
  writeFileSync(profilePath, JSON.stringify({ version: 'local-raw-retained-profile-v1',
    path: f.path, storeId: f.storeId, namespace }), { mode: 0o600, flag: 'wx' });
  const { client } = await host(f.workspace, profilePath);
  const listed = await client.listTools();
  assert.ok(listed.tools.some(tool => tool.name === 'list_raw_conversations'));
});

for (const base of [18,23,33]) test(`S2h CLI explicit ${base} maintenance entry and refused re-run`, t => {
  const f = safetyFixture(t, base); copySqliteFixture(f.path, f.backupPath);
  const args = ['safety','migrate','--db',f.path,'--backup',f.backupPath,'--store-id',f.storeId,'--base',String(base),'--quiescent'];
  const run = selected => spawnSync(process.execPath, [cli, ...selected], { encoding: 'utf8', timeout: 30000 });
  const missing = run(args.slice(0, -1)); assert.equal(missing.status, 1, missing.stderr); assert.equal(JSON.parse(missing.stdout).ok, false);
  const success = run(args); assert.equal(success.status, 0, success.stdout + success.stderr);
  assert.equal(JSON.parse(success.stdout).value.physical, { 18:34, 23:38, 33:48 }[base]);
  const again = run(args); assert.equal(again.status, 1); assert.equal(JSON.parse(again.stdout).error.admissionsRemainClosed, true);
});

test('S2h CLI safety migration links without SQLite and performs no maintenance from --help', () => {
  const source = `import { registerHooks } from 'node:module';
registerHooks({ resolve(specifier, context, next) { if (specifier === 'node:sqlite') throw Error('static_sqlite'); return next(specifier, context); } });
const { start } = await import(${JSON.stringify(new URL('../cli.mjs', import.meta.url).href)});
await start(['--help']);`;
  const result = spawnSync(process.execPath, ['--input-type=module','-e',source], { encoding: 'utf8', timeout: 20000 });
  assert.equal(result.status, 0, result.stderr); assert.match(result.stdout, /safety migrate/);
});

for (const name of ['local-host-import','local-transport-import']) test(`S2h ${name}: installed host/transport boundary remains SQLite-free`, () => {
  const path = new URL(`../../../integrations/client/test/fixtures/${name}.mjs`, import.meta.url).pathname;
  const result = spawnSync(process.execPath, [path], { encoding: 'utf8', timeout: 20000 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});
