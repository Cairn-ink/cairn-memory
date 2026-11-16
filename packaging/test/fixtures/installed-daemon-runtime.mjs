import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { open, unlink, lstat, link, writeFile, readFile, readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { runtimeDirectory, readPrivate } from '../../../adapters/mcp/local-daemon-state.mjs';
import { startAwareAlive } from '../../../adapters/mcp/local-daemon-liveness.mjs';
export const identityPrefix = name => /^(d-[a-f0-9]{32})\./.exec(name)?.[1];
export const sameOwner = (a, b) => a != null && b != null &&
  ['pid', 'start', 'boot', 'namespace'].every(key => a[key] === b[key]);
export const sameEntry = (a, b) => b != null &&
  ['name', 'kind', 'inode', 'size', 'mtime'].every(key => a[key] === b[key]);
// Read the immutable source allowlist, never log bytes through a path reader.
const stateSource = await readFile(new URL('../../../adapters/mcp/local-daemon-state.mjs', import.meta.url), 'utf8');
const codeList = /const logCodes = new Set\(\[([\s\S]*?)\]\);/.exec(stateSource);
assert.ok(codeList, 'fixed log-code allowlist exists');
const logCodes = new Set([...codeList[1].matchAll(/'(daemon_[a-z_]+)'/g)].map(match => match[1]));
assert.ok(logCodes.size > 0, 'fixed log-code allowlist is nonempty');
const logLimit = 262144;
function logChange(before, after) {
  if (before.kind !== 'file' || after?.kind !== 'file' || typeof before.content !== 'string' || typeof after.content !== 'string') return;
  if (/[^\x00-\x7f]/.test(before.content) || /[^\x00-\x7f]/.test(after.content)) return;
  if (BigInt(before.size) !== BigInt(Buffer.byteLength(before.content)) ||
      BigInt(after.size) !== BigInt(Buffer.byteLength(after.content)) || BigInt(after.size) > BigInt(logLimit)) return;
  if (sameEntry(before, after) && before.content === after.content) return [];
  const lines = content => {
    if (!content.endsWith('\n')) return;
    const codes = content.slice(0, -1).split('\n');
    return codes.every(code => logCodes.has(code)) ? codes : undefined;
  };
  if (after.content.startsWith(before.content)) {
    const appended = lines(after.content.slice(before.content.length));
    if (appended) return appended;
  }
  // After a reset only the retained new lines are observable. The old bytes
  // plus those lines must exceed the writer's cap; equality does not reset.
  if (BigInt(before.size) + BigInt(after.size) > BigInt(logLimit)) return lines(after.content);
}
const revivalEndpoint = suffix => /^\.(?:json|stamp|sock|lock(?:\.(?:owner|reap)-[a-z0-9-]+)*|takeover\.lock(?:\.(?:owner|reap)-[a-z0-9-]+)*)$/.test(suffix);

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
    else if (!before.entries.some(value => value.name === entry.name)) {
      if (identityPrefix(entry.name)) diagnostics.push('foreign identity entry created: ' + entry.name);
      else errors.push('non-identity entry created: ' + entry.name);
    }
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
    const remaining = after.entries.filter(entry => identityPrefix(entry.name) === prefix);
    if (previous?.alive && remaining.length === 0) {
      const retired = after.retired.find(identity => identity.prefix === prefix && sameOwner(identity.owner, previous.owner));
      if (retired?.alive !== false) errors.push('foreign identity gone without dead owner: ' + prefix);
      continue;
    }
    const log = entries.find(entry => entry.name === prefix + '.log');
    const appended = log ? logChange(log, current.get(log.name)) : undefined;
    if (log && !appended) errors.push('foreign log changed invalidly: ' + log.name);
    const revived = !previous?.alive && appended?.includes('daemon_ready');
    if (revived) diagnostics.push('foreign identity revived: ' + prefix);
    if (previous?.alive && previous.owner && next?.owner && !sameOwner(previous.owner, next.owner)) {
      if (next.alive && !owners.some(owner => sameOwner(owner, next.owner)))
        diagnostics.push('foreign identity takeover: ' + prefix);
      else errors.push('foreign takeover has dead or test owner: ' + prefix);
      continue;
    }
    if (!previous?.alive) {
      for (const entry of entries) if (!(entry === log && appended) &&
        !(revived && revivalEndpoint(entry.name.slice(prefix.length))) && !sameEntry(entry, current.get(entry.name)))
        errors.push('dead or ownerless foreign entry changed: ' + entry.name);
      continue;
    }
    for (const entry of entries) {
      const value = current.get(entry.name), suffix = entry.name.slice(prefix.length);
      const unchanged = sameEntry(entry, value);
      const heartbeat = suffix === '.stamp' && value?.kind === entry.kind;
      if (!unchanged && !heartbeat && !(entry === log && appended)) errors.push('live foreign entry changed: ' + entry.name);
    }
  }
  return { errors, diagnostics };
}

// Shape validation is separate from liveness: malformed records are ownerless;
// OS/probe failures for a well-formed owner still propagate.
const ownerRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value) &&
  Number.isSafeInteger(value.pid) && value.pid > 0 && typeof value.start === 'string' &&
  typeof value.boot === 'string' && value.boot.length > 0 && typeof value.namespace === 'string' && value.namespace.length > 0;

export async function runtimeSnapshot(path, remembered = [], { afterMetadata = async () => {} } = {}) {
  let logDirectory;
  async function logContent(name) {
    // All log reads use the real pinned directory and the typed fd reader.
    logDirectory ??= await runtimeDirectory({ root: dirname(path) });
    if (logDirectory.path !== path) throw Object.assign(Error('runtime_snapshot_directory'), { code: 'runtime_snapshot_directory' });
    return readPrivate(logDirectory, join(path, name), { fileClass: 'log', missing: true, maxBytes: logLimit,
      deadline: performance.now() + 1000 });
  }
  async function metadata(names) {
    const values = [];
    for (const name of names) {
      let info;
      try { info = await lstat(join(path, name), { bigint: true }); }
      catch (error) { if (error.code === 'ENOENT') continue; throw error; }
      values.push({ name, kind: info.isFile() ? 'file' : info.isSocket() ? 'socket' : info.isDirectory() ? 'directory' : info.isSymbolicLink() ? 'symlink' : 'other',
        inode: String(info.ino), size: String(info.size), mtime: String(info.mtimeNs) });
    }
    return values;
  }
  const names = (await readdir(path)).sort(), identities = [];
  const entries = await metadata(names.filter(name => !identityPrefix(name)));
  for (const prefix of new Set(names.map(identityPrefix).filter(Boolean))) {
    // At most three complete samples per identity. Recheck both anchors,
    // including absence, so a new descriptor cannot hide behind a stable lock.
    for (let attempt = 1; attempt <= 3; attempt++) {
      const sampled = await metadata((await readdir(path)).filter(name => identityPrefix(name) === prefix).sort());
      await afterMetadata({ prefix, attempt }); // Test-only acquisition seam.
      const log = sampled.find(entry => entry.name === prefix + '.log');
      if (log) log.content = await logContent(log.name);
      let owner;
      for (const suffix of ['.json', '.lock']) {
        if (!sampled.some(entry => entry.name === prefix + suffix && entry.kind === 'file')) continue;
        try {
          const value = JSON.parse(await readFile(join(path, prefix + suffix), 'utf8'));
          const candidate = suffix === '.json' ? value?.owner : value;
          if (ownerRecord(candidate)) { owner = candidate; break; }
        } catch (error) { if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error; }
      }
      const alive = owner ? startAwareAlive(owner) : false;
      const anchors = ['.json', '.lock'].map(suffix => prefix + suffix);
      const checked = await metadata(anchors);
      const logChecked = log ? (await metadata([log.name]))[0] : undefined;
      const stable = (!log || (sameEntry(log, logChecked) && typeof log.content === 'string' &&
        BigInt(log.size) === BigInt(Buffer.byteLength(log.content)))) && anchors.every(name => {
        const previous = sampled.find(entry => entry.name === name), next = checked.find(entry => entry.name === name);
        return previous ? next?.inode === previous.inode && next.kind === previous.kind : !next;
      });
      if (stable) { entries.push(...sampled); identities.push({ prefix, owner, alive }); break; }
      if (attempt === 3) throw Object.assign(Error('runtime_snapshot_changed'), { code: 'runtime_snapshot_changed' });
    }
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  return { entries, identities, retired: remembered.filter(identity => identity.owner)
    .map(identity => ({ ...identity, alive: startAwareAlive(identity.owner) })) };
}

// All installed daemon fixtures share this lease, including across supervised
// runners with different TMPDIRs. It is outside the production runtime folder.
export async function runtimeLease(directory) {
  const path = join(dirname(directory.path), '.installed-daemon-test.lease');
  for (let attempt = 0; attempt < 12000; attempt++) {
    try {
      const file = await open(path, 'wx', 0o600);
      const pin = await file.stat({ bigint: true });
      await file.close();
      return async () => {
        const current = await lstat(path, { bigint: true });
        assert.equal(current.ino, pin.ino); assert.equal(current.dev, pin.dev);
        await unlink(path);
      };
    } catch (error) { if (error.code !== 'EEXIST') throw error; }
    await delay(25);
  }
  assert.fail('installed daemon test scheduling lease timed out');
}

export async function installedDaemonRuntime({ diagnostic = () => {} } = {}) {
  const directory = await runtimeDirectory(), release = await runtimeLease(directory);
  const before = await runtimeSnapshot(directory.path), baseline = new Set(before.entries.map(entry => entry.name));
  const prefixes = new Set(), owners = [], markers = new Set(), epochs = new Map();
  let ownKey, finished = false;
  const keyPath = join(directory.path, 'identity-v1.key');
  if (!baseline.has('identity-v1.key')) {
    const temporary = join(directory.path, 'test-key-' + randomBytes(12).toString('hex'));
    await directory.validate();
    await writeFile(temporary, randomBytes(32).toString('hex'), { flag: 'wx', mode: 0o600 });
    try {
      const pin = await lstat(temporary, { bigint: true });
      try { await link(temporary, keyPath); ownKey = pin; }
      catch (error) { if (error.code !== 'EEXIST') throw error; }
    } finally { await unlink(temporary); }
  }
  function command(session, action) {
    const db = session.args[session.args.indexOf('--db') + 1];
    assert.ok(session.args.includes('--db') && db);
    const result = spawnSync(session.command, [session.args[0], 'daemon', action, '--db', db], {
      cwd: session.cwd, env: session.env, encoding: 'utf8', timeout: 12000,
    });
    diagnostic(`installed daemon ${action}: rc=${result.status}`);
    assert.equal(result.error, undefined, 'supported daemon command started');
    assert.equal(result.signal, null); assert.equal(result.status, 0, 'supported daemon command exit code');
    return JSON.parse(result.stdout);
  }
  async function collect(db) {
    for (const name of (await readdir(directory.path)).filter(name => /^d-[a-f0-9]{32}\.json$/.test(name))) {
      const text = await readPrivate(directory, join(directory.path, name), { fileClass: 'descriptor', missing: true });
      if (!text) continue;
      const descriptor = JSON.parse(text);
      if (descriptor.identity.store.path !== db) continue;
      const prefix = name.slice(0, -5);
      prefixes.add(prefix);
      if (!owners.some(owner => sameOwner(owner, descriptor.owner))) owners.push(descriptor.owner);
      const lock = await readPrivate(directory, join(directory.path, prefix + '.lock'), { fileClass: 'lock', missing: true });
      if (lock) {
        const value = JSON.parse(lock);
        if (sameOwner(value, descriptor.owner) && /^[a-f0-9-]{36}$/.test(value.token))
          markers.add(prefix + '.lock.reap-' + value.token);
      }
    }
  }
  function register(session, { expected } = {}) {
    const db = session.args[session.args.indexOf('--db') + 1];
    assert.ok(db && session.args.includes('--db'));
    let epoch = epochs.get(db);
    if (!epoch) { epoch = { session, db, running: 0, counted: 0, stopped: 0, expected, boundaries: 0 }; epochs.set(db, epoch); }
    // Reinstall boundaries register the new saved command generation here.
    epoch.session = session;
    return {
      async observe() {
        const rows = command(session, 'status').daemons;
        assert.ok(rows.every(row => row.running === true), 'only running serving lifetimes');
        assert.ok(rows.length >= epoch.running, 'counted lifetimes persist until stop');
        epoch.counted += rows.length - epoch.running; epoch.running = rows.length;
        await collect(db); return rows;
      },
      async stop() { return stop(epoch); },
      status: () => command(session, 'status').daemons,
      get counted() { return epoch.counted; },
    };
  }
  async function stop(epoch) {
    if (!existsSync(epoch.db)) { assert.equal(epoch.counted, 0); return; }
    await collect(epoch.db);
    const rows = command(epoch.session, 'status').daemons;
    assert.equal(rows.length, epoch.running, 'serving lifetimes remain through boundary');
    const result = command(epoch.session, 'stop');
    assert.equal(result.still_running, 0);
    epoch.stopped += result.stopped; epoch.boundaries++;
    assert.equal(epoch.stopped, epoch.counted, 'stopped count equals serving lifetime growth');
    assert.deepEqual(command(epoch.session, 'status').daemons, [], 'empty status after stop');
    diagnostic(JSON.stringify({ servingLifetimes: epoch.counted, stopped: epoch.stopped, boundary: epoch.boundaries }));
    epoch.running = 0;
  }
  async function finish({ stopDaemons = true } = {}) {
    if (finished) return; finished = true;
    try {
      const errors = [];
      for (const epoch of epochs.values()) {
        try {
          if (stopDaemons) await stop(epoch);
          assert.equal(epoch.stopped, epoch.counted, 'stopped count equals serving lifetime growth');
          if (epoch.expected !== undefined) assert.equal(epoch.counted, epoch.expected, 'expected serving lifetime count');
        } catch (error) { errors.push(error); }
      }
      // A negative cleanup control must fail without leaving its synthetic
      // daemon behind. Recovery still uses the saved installed support command.
      if (owners.some(owner => startAwareAlive(owner))) {
        errors.push(Error('owned daemon still alive after stop boundary'));
        for (const epoch of epochs.values()) {
          const result = command(epoch.session, 'stop'); assert.equal(result.still_running, 0);
        }
      }
      assert.ok(owners.every(owner => !startAwareAlive(owner)), 'all owned daemon owners dead before removing logs or markers');
      for (const name of await readdir(directory.path)) {
        if (baseline.has(name)) continue;
        const log = [...prefixes].some(prefix => name === prefix + '.log');
        const marker = [...markers].some(prefix => name === prefix || name.startsWith(prefix + '.owner-') || name.startsWith(prefix + '.reap-'));
        if (log || marker) { await directory.validate(); await unlink(join(directory.path, name)); }
      }
      if (ownKey) {
        const pin = await lstat(keyPath, { bigint: true });
        assert.equal(pin.dev, ownKey.dev); assert.equal(pin.ino, ownKey.ino); await unlink(keyPath);
      }
      const after = await runtimeSnapshot(directory.path, before.identities);
      const hygiene = classifyRuntimeHygiene(before, after, { prefixes: [...prefixes], owners, tokenPrefixes: [...markers], names: ownKey ? ['identity-v1.key'] : [] });
      diagnostic('runtime observed difference: ' + JSON.stringify(runtimeDifference(before, after)));
      for (const line of hygiene.diagnostics) diagnostic(line);
      assert.deepEqual(hygiene.errors, [], 'owned entries absent; foreign entries obey class-aware hygiene');
      if (errors.length) throw new AggregateError(errors, 'installed daemon lifetime accounting failed');
    } finally { await release(); }
  }
  return { directory, register, finish, before };
}
export function runtimeDifference(before, after) {
  const a = new Map(before.entries.map(entry => [entry.name, entry])), b = new Map(after.entries.map(entry => [entry.name, entry]));
  return { added: [...b.keys()].filter(name => !a.has(name)), removed: [...a.keys()].filter(name => !b.has(name)),
    changed: [...a.keys()].filter(name => b.has(name) && !sameEntry(a.get(name), b.get(name))) };
}
