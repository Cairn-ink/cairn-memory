import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { performance } from 'node:perf_hooks';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { compareWire, golden, withStdio } from '../../packaging/test/fixtures/local-host-wire-replay.mjs';
import { compareFiledWire, seedLegacyFiled } from '../../packaging/test/fixtures/installed-local-0.6.11-filed-wire.mjs';
import { assertFixtureClients, fixtureBinaryGuard } from '../../packages/setup/test/fixture-clients.mjs';
import { rawRequest, splitRaw } from '../../core/testing/raw-fixtures.mjs';
import { rationaleModel } from '../../core/testing/rationale-model.mjs';
import { canonical, physicalStore } from '../../adapters/mcp/local-daemon-identity.mjs';
import { daemonStoreKey, runDaemonCommand } from '../../adapters/mcp/local-daemon-liveness.mjs';
import { endpointPaths, runtimeDirectory, writePrivate, removePrivate } from '../../adapters/mcp/local-daemon-state.mjs';
import { createHash } from 'node:crypto';
import { message } from '../../packages/setup/lib/messages.mjs';
import { wrapLine } from '../../packages/setup/lib/output.mjs';
import { qualifyExplicitCorrection } from './local-cutover-correct.qualification.mjs';

const repo = fileURLToPath(new URL('../../', import.meta.url));
const scratch = mkdtempSync(join(tmpdir(), 'cairn-installed-upgrade-'));
const node = process.execPath;
const npm = realpathSync(join(dirname(node), 'npm'));
const cache = directory(join(scratch, 'npm-cache'));
const userconfig = join(scratch, 'empty-user.npmrc'), globalconfig = join(scratch, 'empty-global.npmrc');
for (const path of [userconfig, globalconfig]) writeFileSync(path, '', { mode: 0o600 });
const env = { HOME: scratch, TMPDIR: scratch, PATH: dirname(node) + ':/usr/bin:/bin', LANG: 'C.UTF-8',
  npm_config_userconfig: userconfig, npm_config_globalconfig: globalconfig, npm_config_cache: cache };
const json = path => JSON.parse(readFileSync(path, 'utf8'));
const cacheMarker = 'Synthetic private cache marker for installer upgrade qualification.';
const program = 'bin/memory.mjs';
const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";

function directory(path) { mkdirSync(path, { mode: 0o700 }); return path; }
function execute(executable, args, { environment = env, cwd = scratch, expect = 0 } = {}) {
  const result = spawnSync(executable, args, { env: environment, cwd, encoding: 'utf8', timeout: 120000,
    maxBuffer: 4 * 1024 * 1024, killSignal: 'SIGKILL' });
  assert.ifError(result.error);
  assert.equal(result.status, expect, args.slice(0, 4).join(' ') + '\n' + result.stdout + result.stderr);
  return result.stdout;
}
function npmCommand(args) {
  return execute(node, [npm, ...args, '--no-audit', '--no-fund', '--fetch-retries=0']);
}
function install(specifier, name) {
  const destination = directory(join(scratch, name));
  const packed = JSON.parse(npmCommand(['pack', specifier, '--json', '--ignore-scripts', '--pack-destination', destination]));
  assert.equal(packed.length, 1);
  const prefix = directory(join(destination, 'app'));
  npmCommand(['install', '--offline', '--ignore-scripts', '--no-package-lock', '--prefix', prefix, join(destination, packed[0].filename)]);
  return join(prefix, 'node_modules/@cairn-ink/memory');
}

function testClients(label) {
  const parent = directory(join(scratch, label));
  const home = directory(join(parent, 'home'));
  const bin = directory(join(parent, 'bin'));
  // The operator environment permits only the two synthetic clients and the
  // npm helper in this directory. Absolute Node paths run the installer and engines.
  writeFileSync(join(bin, 'npm'), '#!/bin/sh\nexec ' + quote(node) + ' ' + quote(npm) +
    ' --userconfig ' + quote(userconfig) + ' --globalconfig ' + quote(globalconfig) +
    ' --fetch-retries=0 "$@"\n', { mode: 0o755 });
  for (const name of ['claude', 'codex']) {
    const state = join(parent, name + '.json'), calls = join(parent, name + '.jsonl');
    writeFileSync(state, '{}', { mode: 0o600 });
    writeFileSync(join(bin, name), `#!${node}\n${fixtureBinaryGuard(parent)}` +
      `process.env.FAKE_STATE = ${JSON.stringify(state)};\nprocess.env.FAKE_CALLS = ${JSON.stringify(calls)};\n` +
      readFileSync(join(repo, 'packages/setup/test/fake-' + name + '.mjs'), 'utf8'), { mode: 0o755 });
  }
  const codexHome = directory(join(home, '.codex'));
  const root = join(home, '.cairn-memory');
  const environment = { HOME: home, CODEX_HOME: codexHome, TMPDIR: parent, PATH: bin, LANG: 'C.UTF-8',
    CAIRN_SETUP_NPM_CACHE: cache };
  assert.deepEqual(Object.keys(assertFixtureClients(environment, parent)).sort(), ['claude', 'codex']);
  const run = (pkg, args, expect = 0) => execute(node, [join(pkg, program), ...args, '--lang', 'en'],
    { environment, cwd: parent, expect });
  return { parent, home, root, codexHome, environment, run };
}

function closedFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? closedFiles(path) : entry.isFile() ? [path] : [];
  });
}

function sqlite(path, work) {
  const db = new DatabaseSync(path);
  try { return work(db); }
  finally { db.close(); }
}

const owner = 'synthetic-owner', project = 'synthetic-project';
const namespace = { ownerId: owner, scope: 'project', projectId: project };
const setupArgs = ['setup', '--local', '--no-capture', '--owner', owner, '--project', project];
const claudeVector = f => json(join(f.home, '.claude.json')).mcpServers['cairn-local'].args;

async function captureLegacy(executable, path, messages) {
  const root = dirname(dirname(executable));
  const { openMemoryCore } = await import(pathToFileURL(join(root, 'core/index.mjs')));
  const model = { ...rationaleModel(), extract: () => ({ items: [] }) };
  const core = openMemoryCore({ path, raw: true, rawSearch: false, model });
  try {
    for (const { text, time, id, ordinal = 1, sessionId } of messages) {
      const input = rawRequest(splitRaw(text, { id, ordinal, occurredAt: time })[0], { namespace, sessionId });
      const result = await core.captureRaw(input);
      assert.equal(result.ok, true, JSON.stringify(result));
      assert.equal(result.value.raw.conversationId.length > 0, true);
    }
  } finally { await core.close(); }
}

async function qualifyTimeless(baseline, candidate) {
  const f = testClients('timeless');
  f.run(baseline, setupArgs);
  const descriptor = join(f.root, 'installation.json'), path = json(descriptor).database.path;
  const originalVector = claudeVector(f);
  const sessionId = 'synthetic-timeless';
  const text = 'A synthetic Raw turn with an incomplete time range.';
  const now = new Date().toISOString();
  const { assertSupportedLegacyContents } = await import(pathToFileURL(join(candidate, 'lib/local-cutover-release.mjs')));
  const assertRefused = async () => {
    const prior = readFileSync(path), record = readFileSync(descriptor);
    const status = f.run(candidate, ['setup', '--local'], 2);
    assert.ok(status.split('\n').includes('Local cutover paused. Found 1 Raw session without event times. Legacy service remains active until a follow-up release addresses this.'), status);
    assert.deepEqual(readFileSync(path), prior);
    assert.deepEqual(readFileSync(descriptor), record);
    assert.deepEqual(claudeVector(f), originalVector);
    assert.equal(await assertSupportedLegacyContents(path, { keyless: false }), 1);
  };
  await captureLegacy(originalVector[0], path, [{ text, time: now, id: 'timeless-a', sessionId }]);
  assert.equal(await assertSupportedLegacyContents(path), 0);
  // In pre-index stores, stored timestamps could be fallbacks.
  const range = sqlite(path, db => {
    const row = db.prepare('SELECT * FROM local_raw_session_ranges').get();
    assert.equal(row.unknown_time, 0);
    db.exec('DELETE FROM local_raw_session_ranges');
    return Object.values(row);
  });
  await assertRefused();
  sqlite(path, db => db.prepare('INSERT INTO local_raw_session_ranges VALUES (?,?,?,?,?,?,?,?)').run(...range));
  await captureLegacy(originalVector[0], path, [{ text, time: null, id: 'timeless-b', ordinal: 2, sessionId }]);
  await assertRefused();
  console.log('Keyless upgrade refused one timeless Raw session with its bytes and registration unchanged, including a session without the legacy event-time range. The keyed admission predicate accepted the same count.');
}

async function qualifyMigratedExplicit(baseline, candidate) {
  const f = testClients('migrated-explicit');
  f.run(baseline, setupArgs);
  const path = json(join(f.root, 'installation.json')).database.path;
  const content = 'The synthetic marmot filed a striped map.';
  const raw = 'The conversation recorded a synthetic zephyrite beacon.';
  const outside = 'A separate synthetic zephyrite lantern stayed visible.';
  const tool = async (request, name, args) => {
    const reply = await request('tools/call', { name, arguments: args });
    assert.ok(reply.result, JSON.stringify(reply));
    const envelope = JSON.parse(reply.result.content[0].text);
    assert.equal(envelope.ok, true, JSON.stringify(envelope));
    return envelope.value;
  };
  const withTools = async ([exe, ...args], work) => withStdio(exe, args, f.parent, async (request, notify) => {
    await request('initialize', golden.exchanges.initialize.params);
    notify('notifications/initialized');
    return work((name, args) => tool(request, name, args));
  });
  const legacy = claudeVector(f);
  let memory;
  try {
    memory = (await withTools(legacy, call => call('remember_memory', { content }))).memory;
  } finally { f.run(baseline, ['daemon', 'stop', '--local']); }
  const anchor = Date.parse(sqlite(path, db => db.prepare('SELECT updated_at FROM memories WHERE id = ?').get(memory.id)).updated_at);
  assert.ok(Number.isFinite(anchor));
  await captureLegacy(legacy[0], path, [
    { text: raw, time: new Date(anchor + 29 * 60_000).toISOString(), id: 'inside', sessionId: 'inside-window' },
    { text: outside, time: new Date(anchor + 31 * 60_000).toISOString(), id: 'outside', sessionId: 'outside-window' },
  ]);
  const legacyRaw = f.run(baseline, ['raw', 'list']).trim().split('\n').map(JSON.parse);
  assert.equal(legacyRaw.length, 2);
  f.run(candidate, ['setup', '--local']);
  f.run(candidate, ['local-cutover', '--confirm']);
  const vector = claudeVector(f), target = vector[vector.indexOf('--db') + 1];
  assert.notEqual(target, path);
  assert.equal(sqlite(target, db => db.prepare('SELECT count(*) AS n FROM cairn_raw_messages').get()).n, 2);
  for (const { id } of legacyRaw) {
    assert.ok(!readFileSync(target).includes(id), 'legacy conversation ID is absent from the published core-local store');
  }
  for (const operation of ['export', 'index']) {
    const args = ['raw', operation];
    assert.equal(f.run(candidate, args, 2), f.run(baseline, args, 2));
  }
  console.log('Published 0.6.11 and the active installer reject Raw export/index with identical messages and exit 2. Its existing Raw conversation IDs are absent from the migrated file.');
  const search = { query: 'zephyrite', types: ['memory'], intent: 'current' };
  const assertVisibility = async (call, visible) => {
    const items = (await call('read_memory_context', search)).items;
    assert.equal(JSON.stringify(items).includes(raw), visible, JSON.stringify(items));
    assert.ok(JSON.stringify(items).includes(outside), JSON.stringify(items));
  };
  await withTools(vector, async call => {
    assert.equal((await call('inspect_memory', { memoryId: memory.id })).memory.content, content);
    await assertVisibility(call, true);
    assert.equal((await call('forget_memory', { memoryId: memory.id, expectedRevision: memory.revision })).forgotten, true);
    await assertVisibility(call, false);
  });
  f.run(candidate, ['daemon', 'stop', '--local']);
  for (const file of closedFiles(f.root)) assert.equal(readFileSync(file).includes(content), false, 'forgotten memory bytes in ' + file);
  assert.ok(readFileSync(target).includes(raw), 'the closed archive retains the withheld Raw payload');
  assert.equal(sqlite(target, db => db.prepare(`SELECT count(*) AS n FROM cairn_suppression_facts
    WHERE json_extract(body, '$.kind') = 'window'`).get()).n, 1);
  await withTools(vector, call => assertVisibility(call, false));
  console.log('Migrated explicit forget survived a closed-store restart. Timed Raw at +29 minutes was withheld, Raw at +31 minutes remained visible, and the forgotten Memory bytes were absent.');
  f.run(candidate, ['daemon', 'stop', '--local']);
  await qualifyDaemonControls(f, candidate, target);
}

async function qualifyCorrect(baseline, candidate) {
  const fixture = testClients('explicit-correct');
  fixture.run(baseline, setupArgs);
  const { database } = json(join(fixture.root, 'installation.json'));
  const savedAt = Date.now();
  const turns = [-31, -29, 29, 31].map((minutes, index) => ({
    text: 'The synthetic zirconium turn is ' + ['amber', 'violet', 'silver', 'green'][index] + '.',
    time: new Date(savedAt + minutes * 60_000).toISOString(),
    id: 'turn-' + index,
    sessionId: 'synthetic-turn-' + index,
  }));
  await captureLegacy(claudeVector(fixture)[0], database.path, turns);
  fixture.run(candidate, ['setup', '--local']);
  fixture.run(candidate, ['local-cutover', '--confirm']);
  const vector = claudeVector(fixture);
  await qualifyExplicitCorrection({
    fixture, vector, savedAt, turns,
    scope: { owner, namespace: 'project\0' + project },
    storageOptions: { database: vector[vector.indexOf('--db') + 1], owner, project },
  });
}

async function sharedDaemon(f, pkg, vectors) {
  const command = action => JSON.parse(f.run(pkg, ['daemon', action, '--local']));
  const wait = async (predicate, timeout = 8000) => {
    const deadline = performance.now() + timeout;
    for (;;) {
      const { daemons } = command('status');
      const current = predicate(daemons);
      if (current) return current;
      assert.ok(performance.now() < deadline, JSON.stringify(daemons));
      await delay(100);
    }
  };
  const attached = n => wait(rows => rows.length === 1 && rows[0].running &&
    rows[0].attached_sessions === n && rows[0]);
  const session = ([exe, ...args], work) => withStdio(exe, args, f.parent, async (request, notify) => {
    assert.deepEqual(await request('initialize', golden.exchanges.initialize.params), golden.exchanges.initialize.response);
    notify('notifications/initialized');
    await work(request);
  });
  const observations = [];
  const stamp = row => {
    assert.match(row.store, /^[a-f0-9]{12}$/u);
    assert.match(row.build, /^[a-f0-9]{12}$/u);
    assert.ok(row.stamp_age_seconds >= 0 && row.stamp_age_seconds < 6);
    const { store, build, stamp_age_seconds, ...observable } = row;
    return observable;
  };
  assert.deepEqual(command('status'), { daemons: [] });
  try {
    await session(vectors[0], async request => {
      observations.push(stamp(await attached(1)));
      await session(vectors[1], async second => {
        observations.push(stamp(await attached(2)));
        assert.deepEqual(await request('ping'), { result: {} });
        assert.deepEqual(await second('ping'), { result: {} });
        const content = 'Synthetic memory shared by the two client sessions.';
        const remember = await request('tools/call', { name: 'remember_memory', arguments: { content } });
        const { memory } = JSON.parse(remember.result.content[0].text).value;
        const inspected = await second('tools/call', { name: 'inspect_memory', arguments: { memoryId: memory.id } });
        assert.equal(JSON.parse(inspected.result.content[0].text).value.memory.content, content);
      });
      observations.push(stamp(await attached(1)));
    });
    observations.push(stamp(await attached(0)));
    observations.push(command('stop'), command('status'));
    await session(vectors[0], async () => { await attached(1); });
    const since = performance.now();
    await attached(0);
    await wait(rows => rows.length === 0, 40000);
    const idleMs = performance.now() - since;
    assert.ok(idleMs >= 27000 && idleMs <= 38000, 'idle lifetime: ' + idleMs);
    observations.push(command('stop'));
    console.log(`Installed shared daemon idle exit after ${Math.round(idleMs / 1000)} s.`);
    return observations;
  } finally { command('stop'); }
}

const published0611Disclosure = [
  'Memory stays on this computer. Setup sends no user data.',
  'With OPENAI_API_KEY available to the Cairn MCP server, memories and search text go to OpenAI for semantic search, ' +
    'up to an estimated US$1 per day per running Cairn server. Saved conversations are sent only if you opt in with ' +
    "--raw-semantic (or explicitly configure --context-embedder). To keep everything on this computer, don't give the " +
    'server a key. --no-context-semantic only turns off embeddings; with a key, recall and other model features still ' +
    'send memory text to OpenAI.',
].join('\n');

function assertRepairAndUninstallMessages(legacy, candidate) {
  const header = 'Cairn.ink Memory setup <version>\n';
  const compare = (outputs, disclosure, version) => {
    const prefix = header + disclosure.split('\n').flatMap(wrapLine).join('\n') + '\n';
    return outputs.map((output, index) => {
      // Only the three actual setup runs print the disclosure.
      if (index < 1 || index > 3) return output;
      assert.equal(output.slice(0, prefix.length), prefix, `${version} setup disclosure (${index})`);
      return header + output.slice(prefix.length);
    });
  };
  assert.deepEqual(compare(candidate, message('en', 'local_privacy'), 'candidate'),
    compare(legacy, published0611Disclosure, 'published 0.6.11'));
}

async function qualifyRepairAndUninstall(cells) {
  const setup = ['setup', '--local', '--no-capture'];
  const uninstall = ['uninstall', '--local'];
  const tombstone = 'Cairn local store migrated. This path is retired.\n';
  const result = [];
  for (const { f, pkg, active } of cells) {
    const database = () => claudeVector(f)[2];
    const [exe] = claudeVector(f), path = database();
    const descriptor = json(join(f.root, 'installation.json'));
    const simplify = value => value.replace(/^Cairn\.ink Memory setup \S+/mu, 'Cairn.ink Memory setup <version>')
      .replaceAll(path, '<database>').replaceAll(f.root, '<installation>');
    const output = [];
    const prior = readFileSync(path);
    output.push(simplify(f.run(pkg, [...setup, '--dry-run'])));
    output.push(simplify(f.run(pkg, setup)));
    assert.equal(claudeVector(f)[0], exe);
    execute(join(f.environment.PATH, 'claude'), ['mcp', 'remove', '--scope', 'user', 'cairn-local'],
      { environment: f.environment, cwd: f.parent });
    output.push(simplify(f.run(pkg, setup)));
    assert.equal(claudeVector(f)[0], exe);
    writeFileSync(exe, readFileSync(exe, 'utf8') + '\n// synthetic damaged generation\n');
    output.push(simplify(f.run(pkg, setup)));
    const [repaired, ...args] = claudeVector(f);
    assert.notEqual(repaired, exe);
    assert.equal(database(), path);
    assert.deepEqual(readFileSync(path), prior);
    if (active) assert.equal(readFileSync(descriptor.database.path, 'utf8'), tombstone);

    await withStdio(repaired, args, f.parent, async (request, notify) => {
      await request('initialize', golden.exchanges.initialize.params);
      notify('notifications/initialized');
      const reply = await request('tools/call', { name: 'remember_memory', arguments: { content: 'Synthetic memory retained by uninstall.' } });
      assert.equal(JSON.parse(reply.result.content[0].text).ok, true);
    });
    const query = async action => {
      let result;
      assert.equal(await runDaemonCommand([action, '--db', path], { write: text => { result = JSON.parse(text); } }), 0);
      return result;
    };
    try {
      assert.equal((await query('status')).daemons[0]?.running, true);
      output.push(simplify(f.run(pkg, uninstall, 2)));
      assert.equal(claudeVector(f)[0], repaired);
      output.push(simplify(f.run(pkg, [...uninstall, '--yes', '--client', 'claude'])));
      assert.equal((await query('status')).daemons[0]?.running, true);
      output.push(simplify(f.run(pkg, [...uninstall, '--yes', '--client', 'codex'])));
      assert.equal((await query('status')).daemons.some(row => row.running), !active);
      const detached = json(join(f.root, 'installation.json'));
      assert.equal(detached.state, 'uninstalled');
      assert.ok(readFileSync(repaired).length > 0, 'capture receipts retain the installed engine');
      if (active) assert.equal(readFileSync(descriptor.database.path, 'utf8'), tombstone);
      output.push(simplify(f.run(pkg, ['daemon', 'stop', '--local'], 2)));
    } finally { await query('stop'); }
    const preserved = readFileSync(path);
    assert.ok(preserved.includes('Synthetic memory retained by uninstall.'));
    output.push(simplify(f.run(pkg, [...uninstall, '--yes', '--purge-config'])));
    assert.throws(() => readFileSync(join(f.root, 'installation.json')), { code: 'ENOENT' });
    assert.deepEqual(readFileSync(path), preserved);
    if (active) assert.equal(readFileSync(descriptor.database.path, 'utf8'), tombstone);
    result.push(output);
  }
  assertRepairAndUninstallMessages(...result);
  console.log('Published and active setup disclosures match their respective installer text. The remaining repair and detach messages agree after normalizing the package version and store paths. Healthy reuse, missing registration, damaged generation, confirmation, client detach and final data retention passed. Final active detach stopped the daemon with its engine retained.');
}

async function qualifySharedDaemon(baseline, candidate) {
  const old = testClients('legacy-shared-daemon'), next = testClients('core-shared-daemon');
  for (const f of [old, next]) {
    f.run(baseline, setupArgs);
    const [legacy, ...legacyArgs] = claudeVector(f);
    try {
      await withStdio(legacy, legacyArgs, f.parent, request => request('initialize', golden.exchanges.initialize.params));
    } finally { f.run(baseline, ['daemon', 'stop', '--local']); }
  }
  next.run(candidate, ['setup', '--local']);
  next.run(candidate, ['local-cutover', '--confirm']);
  const vectors = f => [claudeVector(f), JSON.parse(execute(join(f.environment.PATH, 'codex'),
    ['mcp', 'get', 'cairn-local', '--json'], { environment: f.environment, cwd: f.parent })).transport.args];
  const observed = await Promise.allSettled([
    sharedDaemon(old, baseline, vectors(old)), sharedDaemon(next, candidate, vectors(next)),
  ]);
  const failures = observed.filter(entry => entry.status === 'rejected').map(entry => entry.reason);
  if (failures.length) throw new AggregateError(failures, 'Installed daemon lifecycle');
  assert.deepEqual(observed[1].value, observed[0].value);
  console.log('Installed shared daemon matches published 0.6.11 status fields, the 1/2/1/0 session counts, TERM stop and idle exit.');
  await qualifyRepairAndUninstall([{ f: old, pkg: baseline, active: false }, { f: next, pkg: candidate, active: true }]);
}

async function qualifyDaemonControls(f, candidate, target) {
  const run = action => f.run(candidate, ['daemon', action, '--local']);
  assert.equal(run('status'), '{"daemons":[]}\n');
  assert.equal(run('stop'), '{"stopped":0,"still_running":0}\n');
  const before = readFileSync(target);
  // Publish one synthetic owner in the shared lifecycle for this scratch
  // inode. The process acknowledges TERM with a distinct exit code.
  const live = new URL('../../adapters/mcp/local-daemon-liveness.mjs', import.meta.url).href;
  const child = spawn(node, ['--input-type=module', '-e', `
    import { localProcessIdentity } from ${JSON.stringify(live)};
    process.on('SIGTERM', () => process.exit(19));
    process.send(localProcessIdentity());
    setInterval(() => {}, 1000);
  `], { env, stdio: ['ignore', 'ignore', 'inherit', 'ipc'] });
  const exited = once(child, 'exit');
  let directory, paths;
  try {
    const [owner] = await once(child, 'message', { signal: AbortSignal.timeout(10000) });
    directory = await runtimeDirectory();
    const store = await physicalStore(target);
    const build = createHash('sha256').update(f.parent).digest('hex');
    const identity = { uid: directory.uid, store, build };
    const incarnation = 'f'.repeat(64);
    paths = endpointPaths(directory, createHash('sha256').update(canonical(identity)).digest('hex'));
    await writePrivate(directory, paths.ready, JSON.stringify({ identity, owner, incarnation }));
    assert.deepEqual(JSON.parse(run('status')), { daemons: [{
      store: daemonStoreKey(store), running: true, build: build.slice(0, 12),
      attached_sessions: null, stamp_age_seconds: null, last_codes: [],
    }] });
    assert.equal(run('stop'), '{"stopped":1,"still_running":0}\n');
    assert.deepEqual(await exited, [19, null]);
    assert.equal(JSON.parse(run('status')).daemons[0].running, false);
    assert.deepEqual(readFileSync(target), before);
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await exited;
    if (paths) await removePrivate(directory, paths.ready);
  }
  console.log('Active-store daemon status and stop matched the shared lifecycle JSON and shut down the registered synthetic owner through TERM.');
}

async function qualify(baseline, candidate, filed) {
  const f = testClients(filed ? 'filed' : 'ordinary');
  f.run(baseline, setupArgs);
  const descriptorPath = join(f.root, 'installation.json'), descriptor = json(descriptorPath);
  assert.equal(descriptor.installerVersion, '0.6.11');
  assert.ok(descriptor.clients.claude && descriptor.clients.codex);
  const cli = json(join(f.home, '.claude.json')).mcpServers['cairn-local'];
  const [legacyExecutable, ...args] = cli.args;
  const legacyRoot = dirname(dirname(legacyExecutable));
  const source = descriptor.database.path;
  try {
    await withStdio(legacyExecutable, args, f.parent, async (request, notify) => {
      assert.deepEqual(await request('initialize', golden.exchanges.initialize.params), golden.exchanges.initialize.response);
      notify('notifications/initialized');
    });
  } finally {
    f.run(baseline, ['daemon', 'stop', '--local']);
  }
  const filedIds = filed ? await seedLegacyFiled(legacyRoot, source) : null;
  const sidecar = source + '.context-read-v1.sqlite';
  sqlite(sidecar, db => {
    db.exec('CREATE TABLE synthetic_cache (body TEXT)');
    db.prepare('INSERT INTO synthetic_cache VALUES (?)').run(cacheMarker);
  });
  chmodSync(sidecar, 0o600);

  const before = f.run(candidate, ['setup', '--local', '--dry-run']);
  assert.doesNotMatch(before, /Local cutover verified/u);
  assert.equal(json(descriptorPath).version, 'cairn-local-installation-v1');
  const staged = f.run(candidate, ['setup', '--local']);
  assert.ok(staged.split('\n').includes('Local cutover verified. Confirm to switch clients and remove the legacy store and migration backup.'), staged);
  assert.ok(readFileSync(sidecar).includes(cacheMarker));
  assert.match(f.run(candidate, ['local-cutover', '--abort']), /Local cutover aborted\. Legacy service restored\./u);
  assert.ok(readFileSync(sidecar).includes(cacheMarker));
  f.run(candidate, ['local-cutover', '--activate']);
  assert.match(f.run(candidate, ['local-cutover', '--confirm']), /Local cutover active\. Restart your MCP clients\./u);
  assert.match(f.run(candidate, ['status']), /Local cutover active\. Restart your MCP clients\./u);
  assert.throws(() => readFileSync(sidecar), { code: 'ENOENT' });
  assert.ok(closedFiles(f.root).every(path => !readFileSync(path).includes(cacheMarker)), 'cache bytes survived confirmation');
  const claude = json(join(f.home, '.claude.json')).mcpServers['cairn-local'];
  const codex = JSON.parse(execute(join(f.environment.PATH, 'codex'), ['mcp', 'get', 'cairn-local', '--json'],
    { environment: f.environment, cwd: f.parent }));
  assert.deepEqual(codex.transport.args, claude.args);
  assert.equal(codex.transport.command, claude.command);
  const [candidateExecutable, ...targetArgs] = claude.args;
  const target = targetArgs[targetArgs.indexOf('--db') + 1];
  assert.ok(candidateExecutable.endsWith('/packaging/core-local/cli.mjs'));
  assert.notEqual(source, target);
  const candidateRoot = join(dirname(candidateExecutable), '../..');
  const { default: tokenizer } = await import(pathToFileURL(join(candidateRoot, 'packaging/core-local/vendor/tiktoken/tiktoken.cjs')));
  const encoding = tokenizer.get_encoding('o200k_base');
  try {
    const result = filed ? await compareFiledWire(candidateExecutable, target, f.parent, filedIds)
      : await withStdio(candidateExecutable, targetArgs, f.parent,
        (request, notify) => compareWire(request, notify, text => encoding.encode(text, [], []).length));
    assert.deepEqual(result.differences, []);
    console.log(`Installed upgrade ${filed ? 'filed' : 'ordinary'} MCP golden matched ${result.matched} of ${result.total}.`);
  } finally {
    encoding.free();
    f.run(candidate, ['daemon', 'stop', '--local']);
  }
  if (!filed) {
    const retired = golden.exchanges.correct.params.arguments.content;
    for (const path of closedFiles(f.root)) assert.equal(readFileSync(path).includes(retired), false, 'forgotten bytes in ' + path);
    console.log('Closed upgraded store, companions and setup files contain no forgotten or retired cache bytes.');
  }
}

export async function withUpgradeInstallers(work) {
  try {
    assert.equal(readdirSync(cache).length, 0);
    const baseline = install('@cairn-ink/memory@0.6.11', 'baseline');
    const candidate = install(join(repo, 'packages/setup'), 'candidate');
    return await work({ baseline, candidate, testClients });
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  await withUpgradeInstallers(async ({ baseline, candidate }) => {
    await qualifyCorrect(baseline, candidate);
    if (process.argv.includes('--correct-only')) return;
    await qualifySharedDaemon(baseline, candidate);
    await qualify(baseline, candidate, false);
    await qualify(baseline, candidate, true);
    await qualifyTimeless(baseline, candidate);
    await qualifyMigratedExplicit(baseline, candidate);
  });
}
