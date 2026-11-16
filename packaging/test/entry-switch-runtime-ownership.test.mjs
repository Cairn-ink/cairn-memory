import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { readFile, writeFile, readdir, rm, mkdir, symlink } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { startAwareAlive } from '../../adapters/mcp/local-daemon-liveness.mjs';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';
import { buildArtifact, command } from '../build.mjs';
import { installedDaemonRuntime, ownedRuntimeFiles } from './fixtures/installed-daemon-runtime.mjs';
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

// Exercise the shared runtime helper independently of the extracted fixture's
// lease and recorder. All child argv/environment values are the saved session.
async function runtimeOwnershipFixture(t, options = {}) {
  const workspace = createTestWorkspace(t, { prefix: 'runtime-ownership-' });
  const diagnostics = [], runtime = await installedDaemonRuntime({ ...options, diagnostic: text => {
    diagnostics.push(text); t.diagnostic(text);
  } });
  workspace.defer(runtime.finish);
  const artifact = buildArtifact({ ownDirectory: path => workspace.defer(() => rm(path, { recursive: true, force: true })) });
  command('tar', ['-xzf', artifact.artifactPath, '-C', workspace.path], workspace.path, artifact.userconfig);
  const root = join(workspace.path, 'package');
  await mkdir(join(root, 'node_modules'));
  for (const name of ['@modelcontextprotocol', 'zod', 'tiktoken']) await symlink(
    new URL('../../adapters/' + (name === 'tiktoken' ? 'openai' : 'mcp') + '/node_modules/' + name, import.meta.url).pathname,
    join(root, 'node_modules', name));
  const db = join(workspace.path, 'synthetic.sqlite');
  const session = owner => ({ command: process.execPath,
    args: [join(root, 'bin/cairn-memory.mjs'), '--db', db, '--owner', owner],
    cwd: workspace.path, env: { PATH: dirname(process.execPath), NODE_NO_WARNINGS: '1' } });
  async function launch(saved, fallback = false) {
    const child = spawn(saved.command, saved.args, { cwd: saved.cwd, env: saved.env, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', data => { stdout += data; }); child.stderr.on('data', data => { stderr += data; });
    child.stdin.on('error', () => {});
    const done = new Promise((resolve, reject) => { child.once('error', reject); child.once('close', (code, signal) => resolve({ code, signal })); });
    workspace.defer(async () => { child.stdin.end(); await done; });
    let timer;
    const response = new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(Error('synthetic_initialize_timeout')), 15000);
      child.stdout.on('data', () => { if (stdout.includes('\n')) resolve(); });
      child.once('close', () => { if (!stdout.includes('\n')) reject(Error('synthetic_initialize_closed')); });
    });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {
      protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'synthetic-ownership', version: '1' },
    } }) + '\n');
    try { await response; } finally { clearTimeout(timer); child.stdin.end(); }
    assert.deepEqual(await done, { code: 0, signal: null }, stderr);
    assert.equal(JSON.parse(stdout.trim()).result.serverInfo.name.length > 0, true);
    assert.equal(stderr.includes('cairn_daemon_fallback:'), fallback);
  }
  return { workspace, root, runtime, session, launch, diagnostics };
}

test('shared installed runtime rejects never-ready log, temp and owner residue as test-owned', { timeout: 120000 }, async t => {
  const f = await runtimeOwnershipFixture(t), { runtime, root } = f;
  const first = f.session('synthetic-initial-owner'), initial = runtime.register(first);
  await f.launch(first); await initial.observe(); await initial.stop();
  const saved = f.session('synthetic-never-ready-owner'), attempt = runtime.register(saved);
  // Wait for independent launch recording before deliberately refusing build
  // publication. Older helpers have no recorder, which is this regression.
  await attempt.recording;
  const engine = await import(pathToFileURL(join(root, 'adapters/mcp/local-daemon-identity.mjs')));
  const state = await import(pathToFileURL(join(root, 'adapters/mcp/local-daemon-state.mjs')));
  const identity = await engine.createIdentity(saved.args.slice(1), { root, cwd: saved.cwd, environment: saved.env,
    key: await state.identityKey(runtime.directory), node: { executable: saved.command, version: process.version, execArgv: [] } });
  const prefix = 'd-' + identity.digest.slice(0, 32), names = [prefix + '.log', prefix + '.stamp.tmp-' + 'b'.repeat(24), prefix + '.lock.owner-synthetic'];
  const mutate = ownedRuntimeFiles(runtime.directory, { prefixes: new Set([prefix]) });
  f.workspace.defer(async () => { for (const name of names) await mutate('remove', name, { force: true }); });
  const metadata = join(root, 'engine-build.json'), original = await readFile(metadata), backup = join(f.workspace.path, 'build-backup');
  await writeFile(backup, original);
  try {
    await writeFile(metadata, '{malformed'); await f.launch(saved, true);
    assert.ok(!(await readdir(runtime.directory.path)).includes(prefix + '.json'), 'attempt never published ready');
    for (const name of names) await mutate('write', name, name.endsWith('.log') ? 'daemon_refused\n' : '{}', { flag: 'wx', mode: 0o600 });
  } finally {
    await writeFile(metadata, original);
    const compared = spawnSync('cmp', [backup, metadata]); assert.equal(compared.status, 0);
    t.diagnostic(`cmp shared refused-attempt build restoration: rc=${compared.status}`);
  }
  await attempt.observe();
  await assert.rejects(runtime.finish(), error => {
    assert.equal(error.code, 'ERR_ASSERTION');
    for (const name of names) assert.ok(error.actual.includes('test-owned file remains: ' + name), 'each residue is owned: ' + name);
    return true;
  });
});

for (const value of ['', 'd-' + 'A'.repeat(32), 'flip', 'missing']) test('shared installed launch recorder rejects ' + (value || 'empty'), { timeout: 120000 }, async t => {
  const f = await runtimeOwnershipFixture(t, { recordLaunchPrefix: prefix => {
    if (value === 'missing') throw Object.assign(Error('synthetic_record_missing'), { code: 'ENOENT' });
    return value === 'flip' ? prefix.slice(0, -1) + (prefix.endsWith('0') ? '1' : '0') : value;
  } });
  const saved = f.session('synthetic-publishing-owner'), accounting = f.runtime.register(saved);
  await f.launch(saved);
  await assert.rejects(accounting.observe(), error => {
    assert.match(error.message, value === 'flip' ? /recorded launch prefix agrees with published identity/ :
      value === 'missing' ? /synthetic_record_missing/ : /recorded launch prefix is nonempty and well-formed/); return true;
  });
  // Cleanup must retain the genuine publication independently of the corrupted
  // recorder, so this negative control never leaves a serving candidate.
  await accounting.stop();
});

for (const seam of ['missing', 'malformed']) test('finish cleans an unobserved publishing launch despite ' + seam + ' recording', { timeout: 120000 }, async t => {
  const f = await runtimeOwnershipFixture(t, { recordLaunchPrefix: () => {
    if (seam === 'missing') throw Object.assign(Error('synthetic_record_missing'), { code: 'ENOENT' });
    return 'd-' + 'A'.repeat(32);
  } });
  const saved = f.session('synthetic-unobserved-owner');
  f.runtime.register(saved);
  await f.launch(saved);
  // Independent publication/death evidence: never use observe() or the
  // fixture's private owners collection to establish cleanup success.
  const published = [];
  for (const name of await readdir(f.runtime.directory.path)) {
    if (!/^d-[a-f0-9]{32}\.json$/.test(name)) continue;
    const descriptor = JSON.parse(await readFile(join(f.runtime.directory.path, name), 'utf8'));
    if (descriptor.identity.store.path === saved.args[saved.args.indexOf('--db') + 1])
      published.push({ prefix: name.slice(0, -5), owner: descriptor.owner });
  }
  assert.equal(published.length, 1, 'launch independently verified published');
  const [{ prefix, owner }] = published;
  assert.equal(startAwareAlive(owner), true, 'published owner independently verified live');
  const mutate = ownedRuntimeFiles(f.runtime.directory, { prefixes: new Set([prefix]) });
  try {
    await assert.rejects(f.runtime.finish(), error => {
      const errors = error instanceof AggregateError ? error.errors : [error];
      assert.ok(errors.some(value => seam === 'missing' ? value.code === 'ENOENT' && value.message === 'synthetic_record_missing' :
        value.code === 'ERR_ASSERTION' && /recorded launch prefix is nonempty and well-formed/.test(value.message)),
      'original recording failure is still reported');
      return true;
    });
    const alive = startAwareAlive(owner);
    t.diagnostic(`unobserved ${seam} recorder: owner independently alive after finish=${alive}`);
    assert.equal(alive, false, 'published owner independently verified dead after finish');
    assert.deepEqual((await readdir(f.runtime.directory.path)).filter(name => name.startsWith(prefix + '.')), [],
      'all published runtime files are gone');
  } finally {
    // Keep the red control supervised too: stop through the saved installed
    // command before deleting its proven-owned log or installation.
    const result = spawnSync(saved.command, [saved.args[0], 'daemon', 'stop', '--db', saved.args[saved.args.indexOf('--db') + 1]], {
      cwd: saved.cwd, env: saved.env, encoding: 'utf8', timeout: 12000,
    });
    assert.equal(result.error, undefined); assert.equal(result.signal, null); assert.equal(result.status, 0);
    assert.equal(JSON.parse(result.stdout).still_running, 0);
    assert.equal(startAwareAlive(owner), false, 'control recovery independently verifies death');
    for (const name of await readdir(f.runtime.directory.path)) if (name.startsWith(prefix + '.')) await mutate('remove', name);
    t.diagnostic(`unobserved ${seam} control recovery: installed stop rc=${result.status}; owner dead`);
  }
});
