import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, writeFile, rename, rm, symlink, realpath, stat, link, lstat } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { buildArtifact, command, packageName } from '../../build.mjs';
import { verifyInstalledTree } from '../../../packages/setup/lib/local-engine.mjs';
import { runtimeDirectory } from '../../../adapters/mcp/local-daemon-state.mjs';
import { startAwareAlive } from '../../../adapters/mcp/local-daemon-liveness.mjs';

const source = fileURLToPath(new URL('../../../', import.meta.url));
const until = async (predicate, reason, ms = 15000) => {
  const end = performance.now() + ms;
  while (performance.now() < end) { const result = await predicate(); if (result) return result; await delay(25); }
  assert.fail(reason);
};
const ok = r => { assert.equal(r.ok, true, JSON.stringify(r)); return r.value; };
export async function installedAssertions(t, { install = false } = {}) {
  const scratch = await mkdtemp(join(tmpdir(), 'entry-')), clients = [], owned = new Map(), logs = new Set();
  const dir = await runtimeDirectory(), baseline = new Set(await readdir(dir.path));
  // Claim key ownership via an exclusive atomic link, rather than assuming
  // absence in a directory snapshot proves that this test created the key.
  const keyPath = join(dir.path, 'identity-v1.key');
  let ownKey;
  if (!baseline.has('identity-v1.key')) {
    const temporary = join(dir.path, 'test-key-' + randomBytes(12).toString('hex'));
    await dir.validate();
    await writeFile(temporary, randomBytes(32).toString('hex'), { flag: 'wx', mode: 0o600 });
    try {
      const pin = await lstat(temporary, { bigint: true });
      try { await link(temporary, keyPath); ownKey = pin; }
      catch (error) { if (error.code !== 'EEXIST') throw error; }
    } finally { await rm(temporary); }
  }
  const artifact = buildArtifact({ ownDirectory: p => t.after(() => rm(p, { recursive: true, force: true })) });
  const manifest = JSON.parse(await readFile(new URL('../../../packages/setup/runtime/engine/manifest.json', import.meta.url)));
  let next = 0;
  const bundleHashes = { ...manifest.sourceHashes, ...manifest.generatedHashes };
  assert.deepEqual(artifact.files, [...manifest.files].sort(), 'packed archive and setup manifest inventory');
  async function tree(name) {
    const app = join(scratch, name), modules = join(app, 'node_modules'), root = join(modules, packageName);
    await mkdir(modules, { recursive: true });
    if (install) {
      await writeFile(join(app, 'package.json'), JSON.stringify({ name: 'synthetic-entry', version: '0.0.0', private: true }));
      command('npm', ['install', '--prefix', app, '--offline', '--ignore-scripts', '--no-audit', '--no-fund', artifact.artifactPath], app, artifact.userconfig);
      assert.equal(await verifyInstalledTree(app, manifest), true);
    } else {
      command('tar', ['-xzf', artifact.artifactPath, '-C', app], app, artifact.userconfig);
      await rename(join(app, 'package'), root);
      for (const name of artifact.files) {
        const digest = createHash('sha256').update(await readFile(join(root, name))).digest('hex');
        assert.equal(digest, bundleHashes[name], 'setup manifest staged bytes: ' + name);
      }
      t.diagnostic(`packed archive/setup manifest hash cross-check: ${artifact.files.length} files`);
      await mkdir(join(root, 'node_modules'));
      for (const name of ['@modelcontextprotocol', 'zod', 'tiktoken']) {
        const adapter = name === 'tiktoken' ? 'openai' : 'mcp';
        await symlink(join(source, 'adapters', adapter, 'node_modules', name), join(root, 'node_modules', name));
      }
      // The requested local symlink layout conflicts with setup's lstat directory
      // rule. Record the refusal; the real-install CI row asserts acceptance.
      await assert.rejects(verifyInstalledTree(app, manifest), { key: 'local_engine_verification_failed' });
      t.diagnostic('STOPPED local verifyInstalledTree acceptance: symlink layout conflicts with local-engine.mjs:95');
    }
    return root;
  }
  const store = join(scratch, 'synthetic.sqlite');
  async function descriptors() {
    const values = [];
    for (const name of (await readdir(dir.path)).filter(n => /^d-.*\.json$/.test(n))) {
      let d; try { d = JSON.parse(await readFile(join(dir.path, name))); } catch (e) { if (e.code === 'ENOENT') continue; throw e; }
      if (d.identity.store.path !== store || !d.identity.package.path.startsWith(scratch + '/')) continue;
      owned.set(d.incarnation, d); logs.add(name.replace(/\.json$/, '.log')); values.push({ name, ...d });
    }
    return values;
  }
  async function client(root, extra = [], expectedFallback = false, owner = 'synthetic-entry-owner', entryPath = join(root, 'bin/cairn-memory.mjs')) {
    const child = spawn(process.execPath, [entryPath, '--db', store, '--owner', owner, ...extra], {
      env: { PATH: dirname(process.execPath), NODE_NO_WARNINGS: '1' }, stdio: ['pipe', 'pipe', 'pipe'],
    });
    const entry = { child, lines: [], stderr: '', exit: null, buffer: '' }; clients.push(entry);
    child.stdin.on('error', () => {});
    child.stdout.on('data', b => { entry.buffer += b; let i; while ((i = entry.buffer.indexOf('\n')) >= 0) {
      entry.lines.push(JSON.parse(entry.buffer.slice(0, i))); entry.buffer = entry.buffer.slice(i + 1);
    } });
    child.stderr.on('data', b => { entry.stderr += b; });
    child.on('exit', (code, signal) => { entry.exit = { code, signal }; });
    entry.request = async (method, params = {}) => {
      const id = ++next; child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
      const response = await until(() => entry.lines.find(m => m.id === id), 'response ' + method + ' ' + entry.stderr);
      assert.equal(entry.lines.filter(m => m.id === id).length, 1, 'no duplicate response'); assert.ok(!response.error, JSON.stringify(response)); return response.result;
    };
    entry.tool = async (name, args) => JSON.parse((await entry.request('tools/call', { name, arguments: args })).content[0].text);
    // Both frames are buffered before attach/refusal, testing real same-process
    // fallback preservation, not just a mocked stream consumer.
    const initialize = entry.request('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'synthetic-entry', version: '1' } });
    const tools = entry.request('tools/list');
    assert.ok((await initialize).serverInfo);
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
    assert.ok((await tools).tools.length > 0);
    assert.equal(entry.stderr.includes('cairn_daemon_fallback:'), expectedFallback, entry.stderr);
    await descriptors(); return entry;
  }
  async function close(entry) {
    entry.child.stdin.end(); await until(() => entry.exit, 'client exits');
    assert.deepEqual(entry.exit, { code: 0, signal: null }, entry.stderr);
    const ids = entry.lines.filter(m => Object.hasOwn(m, 'id')).map(m => m.id);
    assert.equal(new Set(ids).size, ids.length, 'no delayed duplicate MCP responses');
  }
  t.after(async () => {
    try {
      for (const c of clients) if (!c.exit) c.child.stdin.end();
      await until(() => clients.every(c => c.exit), 'every client stopped');
      await descriptors();
      for (const d of owned.values()) if (startAwareAlive(d.owner)) process.kill(d.owner.pid, 'SIGTERM');
      await until(() => [...owned.values()].every(d => !startAwareAlive(d.owner)), 'every test daemon stopped');
      await until(async () => (await descriptors()).length === 0, 'test endpoints removed');
      for (const name of logs) if (!baseline.has(name)) await rm(join(dir.path, name), { force: true });
      if (ownKey) {
        const current = await lstat(keyPath, { bigint: true });
        assert.equal(current.dev, ownKey.dev); assert.equal(current.ino, ownKey.ino);
        await rm(keyPath);
      }
      const remaining = (await readdir(dir.path)).filter(n => !baseline.has(n));
      assert.deepEqual(remaining, [], 'test leaves no files in real cairn-memory runtime folder');
      t.diagnostic('runtime hygiene: no test-owned files remain');
    } finally { await rm(scratch, { recursive: true, force: true }); }
  });
  const root = await tree('a');
  const engine = await import(pathToFileURL(join(root, 'adapters/mcp/local-daemon-identity.mjs')));
  const costs = [];
  for (let i = 0; i < 50; i++) {
    const start = performance.now(); const path = await realpath(root); await stat(path, { bigint: true }); await engine.engineBuild(root); costs.push(performance.now() - start);
  }
  costs.sort((a, b) => a - b);
  t.diagnostic(`identity package realpath + stat + 8-file rehash (50 starts): median=${costs[25].toFixed(3)}ms p95=${costs[47].toFixed(3)}ms max=${costs[49].toFixed(3)}ms`);
  const a = await client(root), b = await client(root);
  assert.equal((await descriptors()).length, 1, 'two sessions must share exactly one ready descriptor');
  const alias = join(scratch, 'entry-alias.mjs'); await symlink(join(root, 'bin/cairn-memory.mjs'), alias);
  const aliased = await client(root, [], false, 'synthetic-entry-owner', alias); await close(aliased);
  assert.equal((await descriptors()).length, 1, 'symlinked bin invocation runs and shares the physical package');
  const memory = ok(await a.tool('remember_memory', { content: 'synthetic cobalt telescope entry sentinel', kind: 'fact' })).memory;
  const query = { query: 'synthetic cobalt telescope entry sentinel', types: ['memory'], intent: 'current', semantic: false };
  const recalled = ok(await b.tool('read_memory_context', query));
  assert.ok(JSON.stringify(recalled).includes(memory.id), JSON.stringify({ memory, recalled }));
  ok(await a.tool('forget_memory', { memoryId: memory.id, expectedRevision: memory.revision }));
  assert.ok(!JSON.stringify(ok(await b.tool('read_memory_context', query))).includes(memory.id));
  for (const name of ['engine-build.json', 'adapters/mcp/local-daemon.mjs']) {
    const path = join(root, name), bytes = await readFile(path), backup = join(scratch, 'mutation-original'); await writeFile(backup, bytes);
    try {
      await writeFile(path, name.endsWith('.json') ? '{malformed' : Buffer.concat([bytes, Buffer.from('\n// synthetic mutation\n')]));
      const c = await client(root, [], true); assert.ok(c.stderr.includes('cairn_daemon_fallback:daemon_build\n')); await close(c);
      assert.equal((await descriptors()).length, 1, 'tamper refusal cannot attach or elect another daemon');
    } finally {
      await writeFile(path, bytes);
      const compared = spawnSync('cmp', [backup, path]); assert.equal(compared.status, 0); t.diagnostic(`cmp restored ${name}: rc=${compared.status}`);
    }
  }
  const second = await tree('b'), other = await client(second);
  assert.equal((await descriptors()).length, 2, 'identical bytes at two package locations split');
  // Retire and remove the old tree, retaining the root inode until the new one
  // is allocated so the filesystem cannot immediately recycle it.
  const old = second + '-retired'; await rename(second, old);
  const replacement = await tree('b-replacement'); await rename(replacement, second);
  await rm(old, { recursive: true, force: true });
  const recreated = await client(second);
  assert.equal((await descriptors()).length, 3, 'same-path reinstall splits physical package inode');
  ok(await a.tool('remember_memory', { content: 'synthetic cobalt telescope entry sentinel namespace', kind: 'fact' }));
  const ownerSession = await client(root, [], false, 'synthetic-other-owner');
  assert.deepEqual(ok(await ownerSession.tool('read_memory_context', query)).items, []);
  assert.equal((await descriptors()).length, 4);
  const otherOwner = await client(root, ['--project', 'synthetic-project']);
  assert.deepEqual(ok(await otherOwner.tool('read_memory_context', query)).items, []);
  assert.equal((await descriptors()).length, 5);
  // Different owner uses a separately parameterized bin vector below.
  const ownerBin = join(root, 'bin/cairn-memory.mjs');
  const result = spawnSync(process.execPath, [ownerBin, '--check-config', '--db', store, '--owner', 'synthetic-other-owner'], {
    env: { PATH: dirname(process.execPath), NODE_NO_WARNINGS: '1' }, encoding: 'utf8', timeout: 15000,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal((await descriptors()).length, 5, 'setup check spawns no daemon');
  const lossRoot = await tree('loss'), loss = await client(lossRoot);
  const victim = (await descriptors()).find(d => d.identity.package.path === lossRoot);
  assert.ok(victim && startAwareAlive(victim.owner));
  const buildPath = join(lossRoot, 'engine-build.json'), buildBytes = await readFile(buildPath);
  const lossBackup = join(scratch, 'loss-original'); await writeFile(lossBackup, buildBytes);
  try {
    await rm(buildPath);
    // Signal only the daemon elected by this test, with its complete owner record.
    assert.ok(startAwareAlive(victim.owner)); process.kill(victim.owner.pid, 'SIGTERM');
    await until(() => loss.exit, 'post-attach refusal must terminate without fallback');
    assert.deepEqual(loss.exit, { code: 1, signal: null });
    assert.ok(!loss.stderr.includes('cairn_daemon_fallback:'), loss.stderr);
    assert.ok(loss.stderr.includes('daemon_transport'), loss.stderr);
  } finally {
    await writeFile(buildPath, buildBytes);
    const compared = spawnSync('cmp', [lossBackup, buildPath]); assert.equal(compared.status, 0);
    t.diagnostic(`cmp post-attach build restoration: rc=${compared.status}`);
  }
  for (const c of [a, b, other, recreated, otherOwner, ownerSession]) await close(c);
  const start = performance.now();
  await until(async () => (await descriptors()).length === 0, '30 second idle exit removes endpoints', 37000);
  assert.ok(performance.now() - start >= 28000 && performance.now() - start < 37000);
  await until(() => [...owned.values()].every(d => !startAwareAlive(d.owner)), 'idle daemon process exits after endpoint removal');
  const endpoints = (await readdir(dir.path)).filter(n => [...logs].some(log => n.startsWith(log.slice(0, -4))) && !n.endsWith('.log'));
  assert.deepEqual(endpoints, [], 'ready socket and lock files are removed');
  t.diagnostic(`idle exit observed after ${(performance.now() - start).toFixed(0)}ms`);
}
