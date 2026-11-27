import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { appendFileSync, chmodSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { golden, withStdio } from '../../packaging/test/fixtures/local-host-wire-replay.mjs';
import { rawRequest, splitRaw } from '../../core/testing/raw-fixtures.mjs';
import { rationaleModel } from '../../core/testing/rationale-model.mjs';
import { SERDE_MARKERS } from '../../integrations/codex/schema-evidence.mjs';
import { withUpgradeInstallers } from './local-cutover-upgrade.qualification.mjs';

const ownerId = 'synthetic-operator', projectId = 'synthetic-project';
const namespace = { ownerId, scope: 'project', projectId };
const setup = ['setup', '--local'];
const scopeOptions = ['--owner', ownerId, '--project', projectId];
const descriptor = f => json(join(f.root, 'installation.json'));
const json = path => JSON.parse(readFileSync(path, 'utf8'));
const rows = output => output.trim().split('\n').filter(Boolean).map(JSON.parse);
const vector = f => json(join(f.home, '.claude.json')).mcpServers['cairn-local'].args;
const tombstone = 'Cairn local store migrated. This path is retired.\n';
const daemonStop = (f, pkg) => f.run(pkg, ['daemon', 'stop', '--local']);
const token = 'rutilatedcelestite';
const removed = 'Synthetic ' + token + ' conversation text.';
const control = 'Synthetic marble conversation retained.';
const retainedMemory = 'A synthetic enamel lamp should survive detachment.';
const nativeSettings = (f, client) => client === 'claude'
  ? join(f.home, '.claude/settings.json') : join(f.codexHome, 'hooks.json');
const clients = ['claude', 'codex'];

function userHook(f, event, sessionId, transcript) {
  const hook = json(nativeSettings(f, 'claude')).hooks[event].at(-1).hooks[0];
  const result = spawnSync('/bin/sh', ['-c', hook.command], { env: { ...f.environment, NODE_NO_WARNINGS: '1' }, cwd: f.parent,
    input: JSON.stringify({ hook_event_name: event, session_id: sessionId, transcript_path: transcript }),
    encoding: 'utf8', timeout: 120000 });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, '');
}

function captureTurn(f, sessionId, text) {
  const transcript = join(f.home, '.claude/projects', sessionId + '.jsonl');
  writeFileSync(transcript, '', { mode: 0o600 });
  userHook(f, 'SessionStart', sessionId, transcript);
  writeFileSync(transcript, JSON.stringify({ type: 'user', uuid: sessionId,
    timestamp: new Date().toISOString(), promptSource: 'typed',
    message: { content: [{ type: 'text', text }] } }) + '\n');
  userHook(f, 'Stop', sessionId, transcript);
}

async function tools(f, work) {
  const [exe, ...args] = vector(f);
  return withStdio(exe, args, f.parent, async (request, notify) => {
    await request('initialize', golden.exchanges.initialize.params);
    notify('notifications/initialized');
    return work(async (name, args) => {
      const result = await request('tools/call', { name, arguments: args });
      const reply = JSON.parse(result.result.content[0].text);
      assert.equal(reply.ok, true, JSON.stringify(reply));
      return reply.value;
    });
  });
}

async function seedRaw(f, messages) {
  const [exe, , path] = vector(f);
  const { openMemoryCore } = await import(pathToFileURL(join(dirname(exe), '../core/index.mjs')));
  const core = openMemoryCore({ path, raw: true, rawSearch: false,
    model: { ...rationaleModel(), extract: () => ({ items: [] }) } });
  try {
    for (const { text, client, sessionId, time, id } of messages) {
      const input = rawRequest(splitRaw(text, { id, occurredAt: time })[0], { namespace, client, sessionId });
      assert.equal((await core.captureRaw(input)).ok, true);
    }
  } finally { await core.close(); }
}

function closedFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? closedFiles(path) : entry.isFile() ? [path] : [];
  });
}

async function qualifyRaw(baseline, candidate, testClients) {
  const reference = testClients('raw-reference'), active = testClients('raw-active');
  const time = new Date().toISOString();
  const messages = [
    { text: removed, client: 'claude-code', sessionId: 'synthetic-raw', id: 'seed-first', time },
    { text: control, client: 'codex', sessionId: 'synthetic-control', id: 'seed-second', time },
  ];
  for (const f of [reference, active]) {
    f.run(baseline, [...setup, '--no-capture', ...scopeOptions]);
    await seedRaw(f, messages);
  }
  const source = descriptor(active).database.path;
  const [legacy] = rows(active.run(baseline, ['raw', 'list', '--client', 'claude']));
  const sidecar = source + '.context-read-v1.sqlite';
  const cache = new DatabaseSync(sidecar);
  try {
    cache.exec('CREATE TABLE synthetic_cache (token TEXT)');
    cache.prepare('INSERT INTO synthetic_cache VALUES (?)').run(token);
  } finally { cache.close(); }
  chmodSync(sidecar, 0o600);
  mkdirSync(source + '.raw-search', { mode: 0o700 });
  writeFileSync(join(source + '.raw-search', 'synthetic-cache'), token, { mode: 0o600 });
  assert.ok(readFileSync(sidecar).includes(token));
  active.run(candidate, setup);
  active.run(candidate, ['local-cutover', '--confirm']);
  const [, , database] = vector(active);
  assert.notEqual(source, database);
  assert.equal(readFileSync(source, 'utf8'), tombstone);
  const normalize = row => {
    const { id, conversationId, actionId, ...metadata } = row;
    if (conversationId !== undefined) assert.equal(conversationId, id);
    if (actionId !== undefined) assert.match(actionId, /^[0-9a-f-]{36}$/u);
    return metadata;
  };
  const runList = (f, pkg, ...args) => rows(f.run(pkg, ['raw', 'list', ...args]));
  const [ref] = runList(reference, baseline, '--client', 'claude');
  const [current] = runList(active, candidate, '--client', 'claude');
  assert.match(current.id, /^raw-[0-9a-f]{64}$/u);
  assert.notEqual(current.id, legacy.id);
  assert.deepEqual(normalize(current), normalize(ref));
  assert.deepEqual(runList(active, candidate, '--client', 'codex').map(normalize),
    runList(reference, baseline, '--client', 'codex').map(normalize));
  assert.deepEqual(runList(active, candidate).map(normalize).sort((a, b) => a.client.localeCompare(b.client)),
    runList(reference, baseline).map(normalize).sort((a, b) => a.client.localeCompare(b.client)));
  for (const args of [['export'], ['index'], ['delete'], ['delete', '*', '--yes'], ['list', 'unexpected']]) {
    assert.equal(active.run(candidate, ['raw', ...args], 2), reference.run(baseline, ['raw', ...args], 2));
  }
  const missing = rows(active.run(candidate, ['raw', 'delete', legacy.id, '--yes'], 1))[0];
  assert.equal(missing.error.code, 'conversation_not_found');
  assert.match(missing.error.message, /run raw list/iu);
  assert.deepEqual(runList(active, candidate, '--client', 'claude'), [current]);
  const executeDelete = (f, pkg, id, ...args) => rows(f.run(pkg, ['raw', 'delete', id, ...args]))[0];
  assert.deepEqual(normalize(executeDelete(active, candidate, current.id)),
    normalize(executeDelete(reference, baseline, ref.id)));

  const search = { query: token, types: ['memory'], intent: 'current' };
  try {
    await tools(active, async call => {
      const before = await call('read_memory_context', search);
      assert.ok(JSON.stringify(before.items).includes(removed));
      const expected = executeDelete(reference, baseline, ref.id, '--yes');
      const actual = executeDelete(active, candidate, current.id, '--yes');
      assert.deepEqual(normalize(actual), normalize(expected));
      const after = await call('read_memory_context', search);
      assert.ok(!JSON.stringify(after.items).includes(removed));
    });
  } finally { daemonStop(active, candidate); }
  assert.ok(readFileSync(database).includes(control), 'unselected content stayed');
  for (const suffix of ['-wal', '-shm']) {
    try { assert.ok(!readFileSync(database + suffix).includes(token)); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const files = closedFiles(active.root);
  assert.ok(files.includes(database));
  for (const file of files) {
    const bytes = readFileSync(file);
    for (const marker of [removed, token]) assert.equal(bytes.includes(marker), false, file);
  }
  assert.deepEqual(runList(active, candidate).map(normalize), runList(reference, baseline).map(normalize));
  console.log('Installed Raw list, client filters, preview, delete and argument exits match the published CLI after normalizing IDs. The legacy ID returns exit 1 with the relist hint.');
  console.log('After installed CLI deletion and SQLite close, the database, existing companions and retired search-cache locations have no deleted Raw text or cache token. An open MCP session stopped seeing the deleted content.');
}

async function qualifyWindow(baseline, candidate, testClients) {
  const f = testClients('raw-window');
  f.run(baseline, [...setup, '--no-capture', ...scopeOptions]);
  const source = descriptor(f).database.path;
  let memory;
  try {
    await tools(f, async call => { memory = (await call('remember_memory', { content: retainedMemory })).memory; });
  } finally { daemonStop(f, baseline); }
  const db = new DatabaseSync(source, { readOnly: true });
  let anchor;
  try { anchor = Date.parse(db.prepare('SELECT updated_at FROM memories WHERE id=?').get(memory.id).updated_at); }
  finally { db.close(); }
  await seedRaw(f, [
    { text: removed, client: 'claude-code', sessionId: 'synthetic-window', id: 'window-turn',
      time: new Date(anchor + 29 * 60000).toISOString() },
    { text: control, client: 'codex', sessionId: 'synthetic-control', id: 'outside-turn',
      time: new Date(anchor + 31 * 60000).toISOString() },
  ]);
  f.run(candidate, setup);
  f.run(candidate, ['local-cutover', '--confirm']);
  const search = { query: token, types: ['memory'], intent: 'current' };
  try {
    await tools(f, async call => {
      assert.ok(JSON.stringify((await call('read_memory_context', search)).items).includes(removed));
      await call('forget_memory', { memoryId: memory.id, expectedRevision: memory.revision });
      assert.ok(!JSON.stringify((await call('read_memory_context', search)).items).includes(removed));
      const [hidden] = rows(f.run(candidate, ['raw', 'list', '--client', 'claude']));
      assert.equal(hidden.hidden, true);
      const [result] = rows(f.run(candidate, ['raw', 'delete', hidden.id, '--yes']));
      assert.equal(result.hidden, true);
      assert.equal(result.conversationId, hidden.id);
      assert.equal(rows(f.run(candidate, ['raw', 'list', '--client', 'codex'])).length, 1);
    });
  } finally { daemonStop(f, candidate); }
  for (const file of closedFiles(f.root)) assert.equal(readFileSync(file).includes(removed), false, file);
  console.log('Installed Raw deletion identified and erased a window-hidden conversation after explicit forget. The +31-minute control stayed listed.');
}

function binding(f, client) {
  const { cutover } = descriptor(f).migration;
  const journal = json(join(f.root, '.cutover-' + cutover.id, 'capture-' + client + '.json'));
  return json(join(f.root, 'capture', client, 'core-' + journal.generation, 'binding.json'));
}

function hookShape(f, client, active) {
  const settings = json(nativeSettings(f, client));
  const installed = active ? binding(f, client) : json(join(f.root, 'capture', client, 'installation.json'));
  const installation = active ? join(f.root, 'capture', client, 'core-' + installed.generation) : installed.request.installationDirectory;
  const executable = active ? installed.executable : join(installed.runtimeRoot, 'integrations/client/raw/local-setup-cli.mjs');
  assert.equal(active ? installed.phase : installed.phase === 'active' ? 'armed' : installed.phase, 'armed');
  if (active) assert.equal(installed.database, vector(f)[2]);
  return Object.entries(settings.hooks).sort().map(([event, groups]) => {
    const matching = groups.flatMap(group => group.hooks).filter(hook => hook.command.includes(executable));
    assert.equal(matching.length, 1, event);
    const { command, ...shape } = matching[0];
    const expected = ['/usr/bin/env', '-u', 'NODE_OPTIONS', '-u', 'NODE_PATH',
      process.execPath, executable, 'hook', '--installation', installation, '--event', event];
    assert.equal(command, expected.map(value => "'" + value.replaceAll("'", "'\\''") + "'").join(' '));
    return { event, ...shape };
  });
}

async function qualifyArmedRepairAndReattach(baseline, candidate, testClients) {
  const results = [];
  for (const active of [false, true]) {
    const f = testClients(active ? 'armed-active' : 'armed-reference');
    const output = [];
    const pkg = active ? candidate : baseline;
    const repair = (args = [], expected = 0, command = setup) => output.push(f.run(pkg, [...command, ...args], expected)
      .replace(/^Cairn\.ink Memory setup \S+/mu, 'Cairn.ink Memory setup <version>'));
    const formatEvidence = fileURLToPath(new URL('../../integrations/codex/test/fixtures', import.meta.url));
    writeFileSync(join(f.parent, 'codex.json'), JSON.stringify({ version: '0.162.0', formatEvidence }), { mode: 0o600 });
    const formats = json(join(formatEvidence, 'binary-0.162.0/format.json'));
    appendFileSync(join(f.environment.PATH, 'codex'), '\n/*\n' +
      [...Object.values(formats.hooks).map(value => JSON.stringify(value, null, 2)), ...SERDE_MARKERS].join('\n') + '\n*/\n');
    f.run(baseline, [...setup, ...scopeOptions]);
    assert.ok(clients.every(client => hookShape(f, client, false).length >= 3));
    captureTurn(f, 'e8609cd7-8a53-46a9-964a-3f31d14c02c5', control);
    assert.equal(rows(f.run(baseline, ['raw', 'list'])).length, 1);
    const source = descriptor(f).database.path;
    if (active) {
      f.run(candidate, setup);
      f.run(candidate, ['local-cutover', '--confirm']);
    }
    const path = vector(f)[2], originalInode = statSync(path, { bigint: true }).ino;
    const before = vector(f);
    const hooks = clients.map(client => hookShape(f, client, active));
    const originalBindings = active && clients.map(client => binding(f, client));
    repair(['--dry-run']);
    repair();
    assert.deepEqual(vector(f), before);
    if (active) assert.deepEqual(clients.map(client => binding(f, client)), originalBindings);
    const codexState = join(f.parent, 'codex.json');
    const knownHost = json(codexState);
    const codexBinary = join(f.environment.PATH, 'codex');
    const knownBinary = readFileSync(codexBinary);
    writeFileSync(codexState, JSON.stringify({ ...knownHost, changedFormat: true }));
    appendFileSync(codexBinary, '\n// synthetic host format change\n');
    repair([], 2);
    writeFileSync(codexState, JSON.stringify(knownHost));
    writeFileSync(codexBinary, knownBinary);
    const correctHooks = new Map();
    for (const client of clients) {
      const config = nativeSettings(f, client), settings = json(config);
      settings.syntheticPreference = true;
      correctHooks.set(config, JSON.stringify(settings, null, 2) + '\n');
      delete settings.hooks.Stop;
      writeFileSync(config, JSON.stringify(settings, null, 2) + '\n');
    }
    const drifted = clients.map(client => readFileSync(nativeSettings(f, client)));
    repair([], 2);
    assert.deepEqual(clients.map(client => readFileSync(nativeSettings(f, client))), drifted);
    for (const [path, text] of correctHooks) writeFileSync(path, text);
    repair();
    assert.deepEqual(clients.map(client => hookShape(f, client, active)), hooks);
    assert.ok(clients.every(client => json(nativeSettings(f, client)).syntheticPreference));
    if (active) assert.deepEqual(clients.map(client => binding(f, client)), originalBindings);
    const healthyEntry = readFileSync(before[0], 'utf8');
    writeFileSync(before[0], healthyEntry + '\n// synthetic damage\n');
    repair();
    assert.notEqual(vector(f)[0], before[0]);
    assert.deepEqual(clients.map(client => hookShape(f, client, active)), hooks);
    if (active) for (const client of clients) {
      const repaired = binding(f, client);
      assert.notEqual(repaired.executable, originalBindings[clients.indexOf(client)].executable);
      const { executable, ...sameBinding } = originalBindings[clients.indexOf(client)];
      assert.deepEqual(repaired, { ...sameBinding, executable: join(dirname(vector(f)[0]), 'capture-cli.mjs') });
    }
    // Start the detach comparison with a reusable base on the legacy route.
    // The active descriptor records its verified replacement across detach.
    if (!active) writeFileSync(before[0], healthyEntry);
    let memory;
    try {
      await tools(f, async call => { memory = (await call('remember_memory', { content: retainedMemory })).memory; });
      const rawBeforeDetach = f.run(pkg, ['raw', 'list']);
      const uninstall = f.run(pkg, ['uninstall', '--local', '--yes']);
      output.push(uninstall.replaceAll(path, '<store>'));
      assert.equal(descriptor(f).state, 'uninstalled');
      assert.ok(clients.every(client => !Object.values(json(nativeSettings(f, client)).hooks ?? {}).flat().some(group =>
        group.hooks.some(hook => hook.command.includes('cairn-memory')))));
      if (active) {
        const { cutover } = descriptor(f).migration;
        const receipt = readFileSync(join(f.root, '.cutover-' + cutover.id, 'activation.json'));
        assert.equal(readFileSync(source, 'utf8'), tombstone);
        assert.ok(clients.every(client => binding(f, client).phase === 'staged'));
        repair([], 0, ['setup']);
        assert.deepEqual(descriptor(f).migration.cutover, cutover);
        assert.deepEqual(readFileSync(join(f.root, '.cutover-' + cutover.id, 'activation.json')), receipt);
        assert.equal(readFileSync(source, 'utf8'), tombstone);
      } else repair();
      assert.equal(vector(f)[2], path);
      assert.equal(statSync(path, { bigint: true }).ino, originalInode);
      assert.deepEqual(clients.map(client => hookShape(f, client, active)), hooks);
      assert.equal(f.run(pkg, ['raw', 'list']), rawBeforeDetach);
      const after = 'A synthetic moonstone torch recorded after reconnecting.';
      captureTurn(f, '358066bd-edab-4d2a-9bf8-032c6cdf3750', after);
      assert.equal(rows(f.run(pkg, ['raw', 'list'])).length, 2);
      await tools(f, async call => {
        assert.equal((await call('inspect_memory', { memoryId: memory.id })).memory.content, retainedMemory);
        assert.equal(JSON.parse(f.run(pkg, ['daemon', 'status', '--local'])).daemons[0]?.running, true);
      });
    } finally { if (descriptor(f).state === 'installed') daemonStop(f, pkg); }
    results.push(output);
  }
  assert.deepEqual(results[1], results[0]);
  console.log('Published and upgraded armed repair match output and exits for dry run, healthy repair, Codex format change, missing hooks and a damaged generation. Native commands, unrelated settings, and bindings were verified for both clients.');
  console.log('After complete detach, installed setup reattached both clients to the same inode and activation receipt. Capture archived a new turn and the daemon served the retained Memory. The retired source stayed a tombstone.');
}

await withUpgradeInstallers(async ({ baseline, candidate, testClients }) => {
  await qualifyRaw(baseline, candidate, testClients);
  await qualifyWindow(baseline, candidate, testClients);
  await qualifyArmedRepairAndReattach(baseline, candidate, testClients);
});
