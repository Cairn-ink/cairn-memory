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
const identityPrefix = name => /^(d-[a-f0-9]{32})\./.exec(name)?.[1];
const sameOwner = (a, b) => a != null && b != null &&
  ['pid', 'start', 'boot', 'namespace'].every(key => a[key] === b[key]);
const sameEntry = (a, b) => b != null &&
  ['name', 'kind', 'inode', 'size', 'mtime'].every(key => a[key] === b[key]);

// Pure comparison: no filesystem reads, clocks, process probes or mutation.
// Liveness of baseline owners is sampled again in after.retired, even when
// their descriptors and locks have disappeared or a successor replaced them.
export function classifyRuntimeHygiene(before, after, {
  prefixes = [], names = [], tokenPrefixes = [], owners = [],
} = {}) {
  const errors = [], diagnostics = [], current = new Map(after.entries.map(entry => [entry.name, entry]));
  const isOwned = name => names.includes(name) || prefixes.some(prefix => name.startsWith(prefix + '.')) ||
    tokenPrefixes.some(prefix => name === prefix || name.startsWith(prefix + '.owner-') || name.startsWith(prefix + '.reap-'));
  for (const entry of after.entries) {
    if (isOwned(entry.name)) errors.push('test-owned file remains: ' + entry.name);
    else if (!identityPrefix(entry.name) && !before.entries.some(value => value.name === entry.name))
      errors.push('non-identity entry created: ' + entry.name);
  }
  const groups = new Map();
  for (const entry of before.entries) {
    if (isOwned(entry.name)) continue;
    const prefix = identityPrefix(entry.name);
    if (!prefix) {
      if (!sameEntry(entry, current.get(entry.name))) errors.push('non-identity entry changed: ' + entry.name);
      continue;
    }
    if (!groups.has(prefix)) groups.set(prefix, []);
    groups.get(prefix).push(entry);
  }
  for (const [prefix, entries] of groups) {
    const previous = before.identities.find(identity => identity.prefix === prefix);
    const next = after.identities.find(identity => identity.prefix === prefix);
    if (previous?.owner && next?.owner && !sameOwner(previous.owner, next.owner)) {
      if (next.alive && !owners.some(owner => sameOwner(owner, next.owner)))
        diagnostics.push('foreign identity takeover: ' + prefix);
      else errors.push('foreign takeover has dead or test owner: ' + prefix);
      continue;
    }
    if (!previous?.alive) {
      for (const entry of after.entries) if (identityPrefix(entry.name) === prefix && !entries.some(value => value.name === entry.name))
        errors.push('dead or ownerless foreign entry created: ' + entry.name);
      for (const entry of entries) if (!sameEntry(entry, current.get(entry.name)))
        errors.push('dead or ownerless foreign entry changed: ' + entry.name);
      continue;
    }
    const remaining = after.entries.filter(entry => identityPrefix(entry.name) === prefix);
    if (remaining.length === 0) {
      const retired = after.retired.find(identity => identity.prefix === prefix && sameOwner(identity.owner, previous.owner));
      if (retired?.alive !== false) errors.push('foreign identity gone without dead owner: ' + prefix);
      continue;
    }
    for (const entry of entries) {
      const value = current.get(entry.name), suffix = entry.name.slice(prefix.length);
      const unchanged = sameEntry(entry, value);
      const heartbeat = suffix === '.stamp' && value?.kind === entry.kind;
      const appended = suffix === '.log' && value?.kind === entry.kind && value.inode === entry.inode &&
        BigInt(value.size) > BigInt(entry.size);
      if (!unchanged && !heartbeat && !appended) errors.push('live foreign entry changed: ' + entry.name);
    }
  }
  return { errors, diagnostics };
}

async function runtimeSnapshot(path, remembered = []) {
  const entries = [];
  for (const name of (await readdir(path)).sort()) {
    let info;
    try { info = await lstat(join(path, name), { bigint: true }); }
    catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    entries.push({ name, kind: info.isFile() ? 'file' : info.isSocket() ? 'socket' : info.isDirectory() ? 'directory' : info.isSymbolicLink() ? 'symlink' : 'other',
      inode: String(info.ino), size: String(info.size), mtime: String(info.mtimeNs) });
  }
  const identities = [];
  for (const prefix of new Set(entries.map(entry => identityPrefix(entry.name)).filter(Boolean))) {
    let owner;
    for (const suffix of ['.json', '.lock']) {
      if (!entries.some(entry => entry.name === prefix + suffix && entry.kind === 'file')) continue;
      try {
        const value = JSON.parse(await readFile(join(path, prefix + suffix), 'utf8'));
        const candidate = suffix === '.json' ? value.owner : value;
        if (candidate) { startAwareAlive(candidate); owner = candidate; break; }
      } catch (error) { if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error; }
    }
    identities.push({ prefix, owner, alive: owner ? startAwareAlive(owner) : false });
  }
  return { entries, identities, retired: remembered.filter(identity => identity.owner)
    .map(identity => ({ ...identity, alive: startAwareAlive(identity.owner) })) };
}
export async function installedAssertions(t, { install = false } = {}) {
  const scratch = await mkdtemp(join(tmpdir(), 'entry-')), clients = [], owned = new Map(), logs = new Set(), lockTokens = new Map();
  const dir = await runtimeDirectory(), before = await runtimeSnapshot(dir.path);
  const baseline = new Set(before.entries.map(entry => entry.name));
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
      const lockName = name.replace(/\.json$/, '.lock');
      try {
        const lock = JSON.parse(await readFile(join(dir.path, lockName)));
        if (lock.pid === d.owner.pid && lock.start === d.owner.start && /^[a-f0-9-]{36}$/.test(lock.token))
          lockTokens.set(lockName + '.reap-' + lock.token, d.incarnation);
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
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
    entry.rawRequest = async (method, params = {}) => {
      const id = ++next; child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
      const response = await until(() => entry.lines.find(m => m.id === id), 'response ' + method + ' ' + entry.stderr);
      assert.equal(entry.lines.filter(m => m.id === id).length, 1, 'no duplicate response'); return response;
    };
    entry.request = async (...args) => { const response = await entry.rawRequest(...args); assert.ok(!response.error, JSON.stringify(response)); return response.result; };
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
  async function cleanupMarkers() {
    // The lifetime-lock reaper deliberately retains token-specific election
    // markers. These prefixes were recorded from this test's exact owners,
    // under unique package/store identities; never remove another identity.
    for (const name of await readdir(dir.path)) {
      if (baseline.has(name)) continue;
      if ([...lockTokens.keys()].some(prefix => name === prefix || name.startsWith(prefix + '.owner-') || name.startsWith(prefix + '.reap-')))
        await rm(join(dir.path, name));
    }
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
      await cleanupMarkers();
      if (ownKey) {
        const current = await lstat(keyPath, { bigint: true });
        assert.equal(current.dev, ownKey.dev); assert.equal(current.ino, ownKey.ino);
        await rm(keyPath);
      }
      const after = await runtimeSnapshot(dir.path, before.identities);
      const current = new Set(after.entries.map(entry => entry.name));
      t.diagnostic('runtime folder difference: ' + JSON.stringify({
        added: [...current].filter(name => !baseline.has(name)), removed: [...baseline].filter(name => !current.has(name)),
        changed: before.entries.filter(entry => current.has(entry.name) && !sameEntry(entry, after.entries.find(value => value.name === entry.name))).map(entry => entry.name),
      }));
      const hygiene = classifyRuntimeHygiene(before, after, {
        prefixes: [...logs].map(name => name.slice(0, -4)), names: [...logs, ...(ownKey ? ['identity-v1.key'] : [])],
        tokenPrefixes: [...lockTokens.keys()], owners: [...owned.values()].map(descriptor => descriptor.owner),
      });
      for (const diagnostic of hygiene.diagnostics) t.diagnostic(diagnostic);
      assert.deepEqual(hygiene.errors, [], 'test leaves no owned files and preserves pre-existing foreign runtime entries');
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
  // Two idle installed sessions recover through the actual packaged bin.
  const idleVictim = (await descriptors()).find(d => d.identity.package.path === root && d.identity.configuration.namespace.ownerId === 'synthetic-entry-owner' && d.identity.configuration.namespace.projectId === null);
  assert.ok(idleVictim && startAwareAlive(idleVictim.owner));
  process.kill(idleVictim.owner.pid, 'SIGKILL');
  const fresh = await until(async () => (await descriptors()).find(d => d.name === idleVictim.name && d.incarnation !== idleVictim.incarnation), 'idle SIGKILL elects fresh daemon');
  assert.notDeepEqual(fresh.owner, idleVictim.owner);
  await until(() => !startAwareAlive(idleVictim.owner), 'old idle owner is gone');
  for (const c of [a, b]) assert.equal((await c.tool('inspect_memory', {})).ok, true, 'next tool works after idle reconnect');
  assert.equal((await descriptors()).filter(d => d.name === idleVictim.name).length, 1);

  // Stop only this test's verified daemon to hold a tool request in flight,
  // then kill it before it can respond. Passing the unknown-outcome assertion
  // also proves the forwarder had recorded that request before socket loss.
  assert.ok(startAwareAlive(fresh.owner)); process.kill(fresh.owner.pid, 'SIGSTOP');
  let settled = false;
  const pending = a.rawRequest('tools/call', { name: 'inspect_memory', arguments: {} }).then(response => { settled = true; return response; });
  await delay(250); assert.equal(settled, false);
  assert.ok(startAwareAlive(fresh.owner)); process.kill(fresh.owner.pid, 'SIGKILL');
  const unknown = await pending; assert.equal(unknown.error.message, 'daemon_transport');
  await until(() => a.exit, 'in-flight session exits with unknown outcome');
  assert.deepEqual(a.exit, { code: 1, signal: null });
  assert.ok(a.stderr.includes('daemon_outcome_unknown\n')); assert.ok(!a.stderr.includes('cairn_daemon_fallback:'));
  const recovered = await until(async () => (await descriptors()).find(d => d.name === fresh.name && d.incarnation !== fresh.incarnation), 'other installed session elects fresh daemon');
  assert.notDeepEqual(recovered.owner, fresh.owner);
  assert.equal((await b.tool('inspect_memory', {})).ok, true, 'other session reconnects after in-flight SIGKILL');
  t.diagnostic('packaged SIGKILL: both idle sessions reconnected; in-flight session outcome unknown; peer reconnected');
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
  for (const c of [b, other, recreated, otherOwner, ownerSession]) await close(c);
  const start = performance.now();
  await until(async () => (await descriptors()).length === 0, '30 second idle exit removes endpoints', 37000);
  assert.ok(performance.now() - start >= 28000 && performance.now() - start < 37000);
  await until(() => [...owned.values()].every(d => !startAwareAlive(d.owner)), 'idle daemon process exits after endpoint removal');
  await cleanupMarkers();
  const endpoints = (await readdir(dir.path)).filter(n => [...logs].some(log => n.startsWith(log.slice(0, -4))) && !n.endsWith('.log'));
  assert.deepEqual(endpoints, [], 'ready socket and lock files are removed');
  t.diagnostic(`idle exit observed after ${(performance.now() - start).toFixed(0)}ms`);
}
