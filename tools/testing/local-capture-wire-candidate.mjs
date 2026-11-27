import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { appendFileSync, copyFileSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { buildCoreLocalCandidate } from '../../packaging/build-core-local.mjs';
import { createLegacyBackup } from '../../packages/adapter-sqlite/src/legacy/backup.mjs';
import { migrateLegacyStore } from '../../packages/adapter-sqlite/src/migrate/index.mjs';
import { installCandidate } from '../../packaging/test/fixtures/local-host-wire-replay.mjs';

const quiescence = { admissionsClosed: true, writersStopped: true, readersDrained: true, oldHandlesClosed: true };
const prefix = ['/usr/bin/env', '-u', 'NODE_OPTIONS', '-u', 'NODE_PATH'];
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const json = value => JSON.stringify(value, null, 2) + '\n';
const scopeOf = ({ ownerId: owner, scope, projectId }) => ({ owner, namespace: scope + '\0' + (projectId ?? '') });

async function migrateFixture(fixture, binary) {
  const { root, installed, sql, read, privateWrite, directory, moduleAt, prepareBaseline } = fixture;
  const source = join(root, 'candidate-source.sqlite');
  const { clients, forkPath } = await prepareBaseline(installed, binary, source);
  const output = join(root, 'candidate-output');
  const built = buildCoreLocalCandidate(output);
  const candidate = installCandidate(join(root, 'candidate-install'), join(output, built.archive.filename), built.package.name);
  const executable = join(candidate.root, 'packaging/core-local/capture-cli.mjs');
  const { captureStoreIdentity } = await moduleAt(candidate.root, 'packaging/core-local/capture-binding.mjs');
  const database = join(root, 'candidate.sqlite');
  const expectedStoreId = sql(source, db => db.prepare('SELECT store_id FROM store_metadata').get().store_id);
  const migration = { path: source, destination: database, backupDirectory: join(root, 'backup'), expectedStoreId, quiescence };
  await createLegacyBackup(migration);
  const { migrationId, attestation } = await migrateLegacyStore(migration);
  const attemptId = randomUUID();
  privateWrite(join(root, 'installation.json'), json({ version: 'cairn-local-installation-v2', migration: { state: 'verified',
    cutover: { aborting: false, attemptId, result: { attestation }, source: { storeId: expectedStoreId } } } }));
  const identity = await captureStoreIdentity(database);
  for (const [name, client] of Object.entries(clients)) {
    const { installationDirectory, installation, sourceRoot } = client.request;
    const recordPath = join(installationDirectory, 'installation.json');
    const old = read(recordPath);
    const paused = json({ ...old, phase: 'disabled' });
    privateWrite(recordPath, paused);
    const generation = randomUUID();
    client.directory = directory(join(installationDirectory, 'core-' + generation));
    const { authority } = read(join(installationDirectory, 'capture.json'));
    client.binding = { version: 'core-local-capture-v1', phase: 'armed', generation, database, ...identity,
      attemptId, migrationId, attestation, legacyDigest: sha(paused), sourceRoot, sourceIdentity: old.sourceIdentity,
      supportPath: installation.pluginRoot ?? installation.qualificationConfigPath, executable, authority };
    privateWrite(join(client.directory, 'binding.json'), json(client.binding));
    assert.equal(client.binding.authority.client, name === 'claude' ? 'claude-code' : 'codex');
  }

  return { installed, candidateRoot: candidate.root, source, expectedStoreId, database, executable, clients, forkPath };
}

async function upgradeClient(fixture, binary, { baseline, candidate, testClients }, captureClient) {
  const { root, child, ok, read, sql, prepareBaseline, node, flags, env } = fixture;
  const f = testClients('capture-' + captureClient);
  f.run(baseline, ['setup', '--local', '--no-capture', '--owner', 'synthetic-owner', '--project', 'synthetic-capture-project']);
  const descriptor = read(join(f.root, 'installation.json'));
  const legacy = read(join(f.home, '.claude.json')).mcpServers['cairn-local'];
  const installed = dirname(dirname(legacy.args[0]));
  const databasePath = descriptor.database.path;
  assert.equal(descriptor.installerVersion, '0.6.11');
  const cli = join(installed, 'integrations/client/raw/local-setup-cli.mjs');
  assert.equal(JSON.parse(ok(child(node, [...flags, cli, 'init', '--database', databasePath], undefined, root, env))).status, 'initialized');
  const namespace = { ownerId: descriptor.ownerId, scope: 'project', projectId: descriptor.projectId };
  const { clients, forkPath } = await prepareBaseline(installed, binary, databasePath, { captureRoot: f.root, namespace, captureClient });

  // Keep a synthetic, empty-of-transcript source for the existing isolated
  // scoped-disable probe. The exercised installation retires its source.
  const source = join(root, 'scoped-disable-source-' + captureClient + '.sqlite');
  copyFileSync(databasePath, source);
  const expectedStoreId = sql(source, db => db.prepare('SELECT store_id FROM store_metadata').get().store_id);
  assert.match(f.run(candidate, ['local-cutover', '--activate']), /Local cutover verified/u);
  assert.match(f.run(candidate, ['local-cutover', '--confirm']), /Local cutover active/u);
  assert.match(readFileSync(databasePath, 'utf8'), /This path is retired/u);

  const published = read(join(f.home, '.claude.json')).mcpServers['cairn-local'];
  const [entry, dbFlag, database] = published.args;
  assert.equal(dbFlag, '--db');
  const candidateRoot = join(dirname(entry), '../..');
  const executable = join(dirname(entry), 'capture-cli.mjs');
  const { cutover } = read(join(f.root, 'installation.json')).migration;
  for (const [name, client] of Object.entries(clients)) {
    const journal = read(join(f.root, '.cutover-' + cutover.id, 'capture-' + name + '.json'));
    client.directory = join(client.request.installationDirectory, 'core-' + journal.generation);
    client.binding = read(join(client.directory, 'binding.json'));
    assert.equal(client.binding.executable, executable);
    assert.equal(client.binding.database, database);
    assert.equal(client.binding.phase, 'armed');
  }
  const detach = () => {
    const before = readFileSync(database);
    const name = captureClient;
    const client = clients[name];
    f.run(candidate, ['uninstall', '--local', '--yes', '--client', name]);
    assert.equal(read(join(client.directory, 'binding.json')).phase, 'staged');
    const commands = Object.values(read(client.request.clientConfigPath).hooks ?? {})
      .flatMap(groups => groups.flatMap(group => group.hooks.map(hook => hook.command)));
    assert.ok(commands.every(command => !command?.includes(executable)));
    assert.deepEqual(readFileSync(database), before);
    assert.match(readFileSync(databasePath, 'utf8'), /This path is retired/u);
  };
  return { installed, candidateRoot, source, expectedStoreId, database, executable, clients, forkPath, publishedHooks: true, detach };
}

export async function upgradeCaptureFixture(fixture, binary, installers) {
  // The shipped legacy engine grants one native hook authority per namespace.
  // Each stock install still registers both MCP clients. Run the two hook
  // streams through independently upgraded, singly authorized stores.
  const claude = await upgradeClient(fixture, binary, installers, 'claude');
  const codex = await upgradeClient(fixture, binary, installers, 'codex');
  return { ...claude, clients: {
    claude: { ...claude.clients.claude, database: claude.database, executable: claude.executable },
    codex: { ...codex.clients.codex, database: codex.database, executable: codex.executable },
  }, forkPath: codex.forkPath, detach() { claude.detach(); codex.detach(); } };
}

export async function runCandidate(fixture, prepare = binary => migrateFixture(fixture, binary)) {
  const { root, child, sql, read, moduleAt, flags, cases, sessions, sentinel, fakeCodex, cursor, golden,
    instrumentation, calls, node, env } = fixture;
  const binary = fakeCodex(), preload = instrumentation();
  const { installed, candidateRoot, source, expectedStoreId, database, executable, clients, forkPath, publishedHooks, detach } = await prepare(binary);
  const { openStorage } = await moduleAt(candidateRoot, 'packaging/core-local/adapter-slot.mjs');
  const { SQLITE_PHYSICAL_VERSION } = await moduleAt(candidateRoot, 'packages/adapter-sqlite/src/schema/layout.mjs');
  assert.equal(sql(database, db => db.prepare('PRAGMA user_version').get().user_version), SQLITE_PHYSICAL_VERSION);

  async function operate(work, path = database) {
    const runtime = await openStorage(path);
    try { return await work(runtime); }
    finally { await runtime.close(); }
  }
  await operate(({ service }) => assert.rejects(service.enqueueCapture(scopeOf(clients.claude.request.namespace), {
    client: 'claude-code', sessionId: 'synthetic-mcp-session', eventId: 'synthetic-mcp-event',
    messages: [{ id: 'synthetic-mcp-message', role: 'user', occurredAtMs: null, content: 'Synthetic MCP capture probe.' }],
  }), { code: 'capability_unavailable' }));
  const databases = new Set(Object.values(clients).map(client => client.database ?? database));
  const archived = () => [...databases].flatMap(path => sql(path, db => db.prepare(`SELECT client_key, content, occurred_at_ms
    FROM cairn_raw_messages`).all().map(row => ({ client: JSON.parse(row.client_key), saved: 1, reason: null,
    content: JSON.parse(row.content), occurredAt: row.occurred_at_ms === null ? null : new Date(row.occurred_at_ms).toISOString() }))));
  const canonicalArchive = rows => rows.toSorted((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  const cardIds = (path = database) => sql(path, db => {
    if (!db.prepare("SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = 'cairn_document_cards'").get()) {
      return new Set();
    }
    return new Set(db.prepare('SELECT id FROM cairn_document_cards').all().map(({ id }) => id));
  });
  const result = new Map();
  const entries = cases();
  assert.equal(entries.length, golden.exchanges.length);
  let deleteChecks = 0;
  const matched = { claude: 0, codex: 0 };
  for (const [index, step] of entries.entries()) {
    const expected = golden.exchanges[index], client = clients[step.client];
    const target = client.database ?? database, hook = client.executable ?? executable;
    assert.equal(step.label, expected.label);
    const sourcePath = step.source === 'fork' ? forkPath : client.sourcePath;
    if (step.append) appendFileSync(sourcePath, step.append);
    if (step.control === 'pause') {
      const { ownerId } = client.request.namespace;
      await operate(async ({ service }) => assert.equal((await service.setPause(ownerId, true)).paused, true), target);
    }
    if (step.control === 'delete') {
      assert.ok(archived().some(row => row.client === 'claude-code' && row.content.includes(sentinel)));
      assert.ok(readFileSync(database).includes(sentinel), 'the closed store must contain the sentinel before deletion');
      const installation = client.request.installationDirectory;
      const { wireSessionId } = read(join(installation, 'state/sessions', fixture.cursorFilename(installation)));
      const scope = scopeOf(client.request.namespace);
      await operate(async ({ service, storage }) => {
        assert.equal((await service.setPause(scope.owner, false)).paused, false);
        const removed = await storage.uow.run(scope.owner, { pauseLock: true }, tx =>
          storage.raw.deleteConversation(tx, scope, { client: 'claude-code', sessionId: wireSessionId }));
        assert.equal(removed.rawDeleted, 2);
      });
      assertDeletedBytes(database, sentinel, 'delete, before restarting the hook');
      deleteChecks++;
    }
    if (step.control === 'disable') {
      // Scoped consent is frozen in a migration. Probe the real adapter control
      // against a separate migrated snapshot, leaving the serving file intact.
      await scopedDisableProbe({ fixture, source, expectedStoreId, client, openStorage, candidateRoot, installed });
    }
    const args = expected.argv.map(value => ({ $node: node, $hook: hook, $installation: client.directory })[value] ?? value);
    assert.deepEqual(args.slice(0, 5), prefix);
    assert.deepEqual(args.slice(7), ['hook', '--installation', client.directory, '--event', step.event]);
    if (publishedHooks) {
      const native = read(client.request.clientConfigPath).hooks[step.event].at(-1).hooks[0];
      const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
      assert.deepEqual(native, { type: 'command', command: args.map(quote).join(' '), timeout: 160 });
    }
    const input = expected.stdin.replaceAll('$transcript', sourcePath);
    assert.equal(input, step.literal ?? JSON.stringify({ hook_event_name: step.event,
      session_id: sessions[step.source ?? step.client], transcript_path: sourcePath, ...step.payload }));
    const prior = calls().length;
    const argv = [...prefix, node, ...flags, '--import', preload, hook, ...args.slice(7)];
    if (step.label === 'claude start') {
      const keyed = child(argv[0], argv.slice(1), input, root, { ...env,
        [client.request.providerApiKeyEnv]: 'synthetic-provider-value' });
      assert.deepEqual(keyed, { exit: expected.exit, stdout: expected.stdout, stderr: expected.stderr });
      assert.deepEqual(calls().slice(prior), [{ kind: 'hook', outcome: { status: 'ready' } }], 'keyed hook is ready with zero fetches');
      assert.deepEqual(cursor(client.request.installationDirectory), expected.cursor, 'keyed hook advances the same cursor');
    }
    const before = calls().length;
    const cardsBefore = cardIds(target);
    const actual = step.client === 'codex' ? child(binary, ['hook-fixture', ...argv], input) : child(argv[0], argv.slice(1), input);
    assert.deepEqual(actual, { exit: expected.exit, stdout: expected.stdout, stderr: expected.stderr }, step.label);
    const observations = calls().slice(before);
    const outcome = observations.find(row => row.kind === 'hook')?.outcome ?? null;
    assert.equal(observations.filter(row => row.kind === 'model').length, 0);
    assert.equal(observations.filter(row => row.kind === 'ack').length, 0);
    assert.equal([...cardIds(target)].filter(id => !cardsBefore.has(id)).length, expected.cardWrites, step.label + ' Card writes');
    result.set(step.label, outcome);
    assert.deepEqual(cursor(client.request.installationDirectory), expected.cursor, step.label + ' cursor');
    assert.deepEqual(canonicalArchive(archived()), canonicalArchive(expected.archived), step.label + ' Raw archive');
    matched[step.client]++;
    if (expected.closedFileContainsDeletedText !== null) {
      assert.equal(outcome?.reason, 'capture_evidence_closed', step.label);
      assertDeletedBytes(database, sentinel, step.label);
      deleteChecks++;
    }
  }
  assert.equal(result.get('claude start')?.status, 'ready');
  assert.equal(result.get('codex prompt fallback')?.status, 'ready');
  assert.equal(result.get('codex fork start')?.status, 'blocked');
  assert.equal(result.get('codex fork stop')?.reason, 'capture_evidence_closed');
  assert.equal(result.get('codex paused')?.reason, 'capture_paused');
  assert.equal(deleteChecks, 3);
  console.log((publishedHooks ? 'Upgraded registered' : 'Packaged') + ' capture CLI, cursor and Raw archive matched ' + entries.length + ' of ' + golden.exchanges.length +
    ' exchanges (' + matched.claude + ' Claude Code, ' + matched.codex + ' Codex), with 0 model calls.');
  console.log('Ordinary MCP kept automatic capture off and the configured-key hook refused before cursor initialization.');
  console.log('Migrated candidate uses physical schema ' + SQLITE_PHYSICAL_VERSION + '.');
  console.log('Deleted text absent from the closed main file and SQLite companions after delete, restart and replay.');
  await qualifyRouterCards({ fixture, database, executable, client: clients.claude, operate, preload, cardIds });
  if (detach) {
    detach();
    console.log('Installed detach disarmed each migrated capture binding, removed its native hooks and preserved the store bytes.');
  }
}

async function qualifyRouterCards({ fixture, database, executable, client, operate, preload, cardIds }) {
  if (!await operate(({ storage }) => storage.capabilities.documentCards === true)) {
    console.log('Document Card router, forget and delete cases deferred by the SQLite Card capability gate.');
    return;
  }
  const { root, child, calls, flags, node, privateWrite, sql } = fixture;
  const scope = scopeOf(client.request.namespace);
  const source = { kind: 'mcp', client: null, sessionId: null };
  const initial = cardIds();
  for (const action of ['forget', 'delete']) {
    const session = randomUUID();
    const sourcePath = join(client.request.sourceRoot, session + '.jsonl');
    privateWrite(sourcePath, '');
    const marker = 'Synthetic orchid manual for ' + action;
    const document = [
      marker,
      '- Store the woodland orchid pots under the sheltered bench until the morning frost clears.',
      '- Move each tray back to its original row and record the condition of the soil in the greenhouse notebook.',
      '- After watering, leave the bench dry and return the tools to the cabinet.',
    ].join('\n');
    const before = calls().length;
    function hook(event) {
      const args = [...prefix.slice(1), node, ...flags, '--import', preload, executable,
        'hook', '--installation', client.directory, '--event', event];
      const result = child(prefix[0], args, JSON.stringify({
        hook_event_name: event, session_id: session, transcript_path: sourcePath,
      }), root);
      assert.deepEqual(result, { exit: 0, stdout: '', stderr: '' });
    }
    hook('SessionStart');
    appendFileSync(sourcePath, JSON.stringify({ type: 'user', uuid: randomUUID(), timestamp: new Date().toISOString(),
      promptSource: 'typed', message: { content: [{ type: 'text', text: document }] } }) + '\n');
    hook('Stop');
    const newIds = [...cardIds()].filter(id => !initial.has(id));
    assert.equal(newIds.length, 1, 'router writes one card');
    const [cardId] = newIds;
    initial.add(cardId);
    assert.equal(calls().slice(before).filter(({ kind }) => kind === 'model').length, 0);
    assert.equal(sql(database, db => db.prepare('SELECT COUNT(*) AS n FROM cairn_document_card_amendments').get().n), 0);
    assert.ok(readFileSync(database).includes(marker), 'the closed store contains the card marker before erasure');
    await operate(async ({ service, storage }) => {
      const read = () => storage.uow.run(scope.owner, { readOnly: true }, tx => storage.documentCards.get(tx, scope, cardId));
      const card = await read();
      assert.ok(card?.body.includes(marker));
      assert.equal(card.origin, 'router');
      assert.equal((await service.readCard(scope, cardId)).status, 'found');
      if (action === 'forget') {
        const saved = await service.save(scope, card.body, source, 'fact');
        assert.equal(saved.status, 'saved');
        assert.equal((await service.forget(scope, saved.memory.id, source)).status, 'forgotten');
      } else {
        const { client, sessionId } = card.sourceMessage;
        const removed = await storage.uow.run(scope.owner, { pauseLock: true }, tx =>
          storage.raw.deleteConversation(tx, scope, { client, sessionId }));
        assert.equal(removed.rawDeleted, 1);
      }
      assert.deepEqual(await service.readCard(scope, cardId), { status: 'not_found' });
    });
    assertDeletedBytes(database, marker, 'keyless Document Card ' + action);
  }
  console.log('Keyless router capture, model-free Card writes and closed-file forget and delete passed.');
}

function assertDeletedBytes(database, sentinel, step) {
  for (const suffix of ['', '-wal', '-shm', '-journal']) {
    let bytes;
    try { bytes = readFileSync(database + suffix); }
    catch (error) { if (suffix && error.code === 'ENOENT') continue; throw error; }
    assert.equal(bytes.includes(sentinel), false, step + ' (' + (suffix || 'main file') + ')');
  }
}

async function scopedDisableProbe({ fixture, source, expectedStoreId, client, openStorage, candidateRoot, installed }) {
  const { root, moduleAt, sql } = fixture;
  const path = join(root, 'disabled-source.sqlite'), destination = join(root, 'disabled-candidate.sqlite');
  copyFileSync(source, path);
  const { openMemoryCore } = await moduleAt(installed, 'core/index.mjs');
  const core = openMemoryCore({ path, rawConversations: { mode: 'off', configureCap: false,
    readPolicy: () => ({ generation: 'synthetic', reason: 'tool_off' }) } });
  const { namespace } = client.request;
  try {
    const current = core.getCaptureControl({ namespace });
    assert.equal(current.ok, true);
    assert.equal(core.setProjectCapture({ namespace, expectedGeneration: current.value.generation, enabled: false }).ok, true);
  } finally { await core.close(); }
  const input = { path, destination, expectedStoreId, quiescence, backupDirectory: join(root, 'disabled-backup') };
  await createLegacyBackup(input);
  const { migrationId, attestation } = await migrateLegacyStore(input);
  const { captureAdapter } = await moduleAt(candidateRoot, 'packaging/core-local/capture-slot.mjs');
  assert.throws(() => captureAdapter({ ...client.binding, database: destination, migrationId, attestation }).check(), { code: 'capture_disabled' });
  const alive = await openStorage(destination);
  try { assert.equal((await alive.service.pauseState(namespace.ownerId)).paused, false); }
  finally { await alive.close(); }
  assert.equal(sql(destination, db => db.prepare('SELECT count(*) AS n FROM cairn_raw_messages').get().n), 0);
  console.log('Packaged authority check refused migrated scoped disable while owner pause remained open.');
}
