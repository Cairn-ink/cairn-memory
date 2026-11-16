import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { installedAssertions } from './fixtures/entry-switch-installed.mjs';

test('a publishing launch rejects a well-formed recorded prefix with one flipped hex digit', { timeout: 120000 }, async t => {
  const hooks = [], context = { after: fn => hooks.push(fn), diagnostic: text => t.diagnostic(text) };
  try {
    await installedAssertions(context, {
      recordLaunchPrefix: prefix => prefix.slice(0, -1) + (prefix.endsWith('0') ? '1' : '0'),
      exercise: async ({ root, client, close, directory }) => {
        await assert.rejects(async () => {
          const entry = await client(root); await close(entry);
        }, error => {
          assert.equal(error.code, 'ERR_ASSERTION');
          assert.match(error.message, /recorded launch prefix agrees with published identity/); return true;
        });
        assert.ok((await readdir(directory.path)).some(name => /^d-[a-f0-9]{32}\.json$/.test(name)), 'launch published ready');
      },
    });
  } finally { for (const hook of hooks) await hook(); }
});

for (const prefix of ['', 'd-' + 'a'.repeat(31), 'd-' + 'A'.repeat(32), 'd-' + 'a'.repeat(32) + '.json']) {
  test(`launch recording refuses ${prefix ? 'malformed prefix ' + prefix : 'empty prefix'}`, { timeout: 120000 }, async t => {
    const hooks = [], context = { after: fn => hooks.push(fn), diagnostic: text => t.diagnostic(text) };
    try {
      await installedAssertions(context, { recordLaunchPrefix: () => prefix, exercise: async ({ root, client, close }) => {
        await assert.rejects(async () => {
          const entry = await client(root); await close(entry);
        }, error => {
          assert.equal(error.code, 'ERR_ASSERTION');
          assert.match(error.message, /recorded launch prefix is nonempty and well-formed/); return true;
        });
      } });
    } finally { for (const hook of hooks) await hook(); }
  });
}

test('a launched installed attempt without a ready descriptor fails hygiene for its owned leftovers', { timeout: 120000 }, async t => {
  const hooks = [], leftovers = [];
  const context = { after: fn => hooks.push(fn), diagnostic: text => t.diagnostic(text) };
  try {
    await installedAssertions(context, { exercise: async ({ root, client, close, directory, store }) => {
      // Provision through the real installed entry; the refused vector below
      // has its own owner and never publishes a descriptor.
      const initial = await client(root); await close(initial);
      const engine = await import(pathToFileURL(join(root, 'adapters/mcp/local-daemon-identity.mjs')));
      const state = await import(pathToFileURL(join(root, 'adapters/mcp/local-daemon-state.mjs')));
      const owner = 'synthetic-never-ready-owner';
      const args = ['--db', store, '--owner', owner];
      const identity = await engine.createIdentity(args, { root, key: await state.identityKey(directory),
        environment: { PATH: dirname(process.execPath), NODE_NO_WARNINGS: '1' },
        node: { executable: process.execPath, version: process.version, execArgv: [] } });
      const prefix = 'd-' + identity.digest.slice(0, 32);
      const metadata = join(root, 'engine-build.json'), original = await readFile(metadata);
      const backup = metadata + '.control-backup'; await writeFile(backup, original);
      try {
        await writeFile(metadata, '{malformed');
        const refused = await client(root, [], true, owner); await close(refused);
        assert.ok(!(await readdir(directory.path)).includes(prefix + '.json'), 'attempt never published ready');
        // Inject candidate-failure residue for this exact launched vector.
        for (const suffix of ['.log', '.stamp.tmp-' + 'b'.repeat(24), '.lock.owner-synthetic']) {
          const path = join(directory.path, prefix + suffix); leftovers.push(path);
          await writeFile(path, '{}', { flag: 'wx', mode: 0o600 });
        }
      } finally {
        await writeFile(metadata, original);
        const compared = spawnSync('cmp', [backup, metadata]);
        assert.equal(compared.status, 0); t.diagnostic(`cmp refused-attempt build restoration: rc=${compared.status}`);
        await rm(backup);
      }
    } });
    const results = [];
    for (const hook of hooks.splice(0)) {
      try { await hook(); } catch (error) { results.push(error); }
    }
    assert.equal(results.length, 1, 'teardown must reject never-ready owned residue');
    const error = results[0]; assert.equal(error.code, 'ERR_ASSERTION');
    for (const path of leftovers) assert.ok(error.actual.includes('test-owned file remains: ' + path.split('/').at(-1)));
    t.diagnostic('never-ready log, temp and owner file each rejected as test-owned');
  } finally {
    try { for (const hook of hooks) await hook(); }
    finally { for (const path of leftovers) await rm(path, { force: true }); }
  }
});

test('a publishing launch cannot defer ENOENT ownership recording after initialization', { timeout: 120000 }, async t => {
  const hooks = [], context = { after: fn => hooks.push(fn), diagnostic: text => t.diagnostic(text) };
  try {
    await installedAssertions(context, {
      recordLaunchPrefix: () => { throw Object.assign(Error('synthetic_record_missing'), { code: 'ENOENT' }); },
      exercise: async ({ root, client, close, directory }) => {
        await assert.rejects(async () => { const entry = await client(root); await close(entry); }, error => {
          assert.match(error.message, /ownership recording|synthetic_record_missing/); return true;
        });
        assert.ok((await readdir(directory.path)).some(name => /^d-[a-f0-9]{32}\.json$/.test(name)), 'launch published ready');
      },
    });
  } finally { for (const hook of hooks) await hook(); }
});
