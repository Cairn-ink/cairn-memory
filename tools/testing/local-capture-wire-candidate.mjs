import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { appendFileSync, copyFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildCoreLocalCandidate } from '../../packaging/build-core-local.mjs';
import { createLegacyBackup } from '../../packages/adapter-sqlite/src/legacy/backup.mjs';
import { migrateLegacyStore } from '../../packages/adapter-sqlite/src/migrate/index.mjs';
import { installCandidate } from '../../packaging/test/fixtures/local-host-wire-replay.mjs';

const quiescence = { admissionsClosed: true, writersStopped: true, readersDrained: true, oldHandlesClosed: true };
const prefix = ['/usr/bin/env', '-u', 'NODE_OPTIONS', '-u', 'NODE_PATH'];
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const json = value => JSON.stringify(value, null, 2) + '\n';
const scopeOf = ({ ownerId: owner, scope, projectId }) => ({ owner, namespace: scope + '\0' + (projectId ?? '') });

export async function runCandidate(fixture) {
  const { root, installed, child, sql, read, privateWrite, directory, moduleAt, flags, cases, sessions, sentinel,
    fakeCodex, prepareBaseline, cursor, golden, instrumentation, calls, node, env } = fixture;
  const source = join(root, 'candidate-source.sqlite');
  const binary = fakeCodex(), preload = instrumentation();
  const { clients, forkPath } = await prepareBaseline(installed, binary, source);
  const output = join(root, 'candidate-output');
  const built = buildCoreLocalCandidate(output);
  const candidate = installCandidate(join(root, 'candidate-install'), join(output, built.archive.filename), built.package.name);
  const executable = join(candidate.root, 'packaging/core-local/capture-cli.mjs');
  const { openStorage } = await moduleAt(candidate.root, 'packaging/core-local/adapter-slot.mjs');
  const { captureStoreIdentity } = await moduleAt(candidate.root, 'packaging/core-local/capture-binding.mjs');
  const { SQLITE_PHYSICAL_VERSION } = await moduleAt(candidate.root, 'packages/adapter-sqlite/src/schema/layout.mjs');
  const database = join(root, 'candidate.sqlite');
  const expectedStoreId = sql(source, db => db.prepare('SELECT store_id FROM store_metadata').get().store_id);
  const migration = { path: source, destination: database, backupDirectory: join(root, 'backup'), expectedStoreId, quiescence };
  await createLegacyBackup(migration);
  const { migrationId, attestation } = await migrateLegacyStore(migration);
  assert.equal(sql(database, db => db.prepare('PRAGMA user_version').get().user_version), SQLITE_PHYSICAL_VERSION);
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

  async function operate(work) {
    const runtime = await openStorage(database);
    try { return await work(runtime); }
    finally { await runtime.close(); }
  }
  await operate(({ service }) => assert.rejects(service.enqueueCapture(scopeOf(clients.claude.request.namespace), {
    client: 'claude-code', sessionId: 'synthetic-mcp-session', eventId: 'synthetic-mcp-event',
    messages: [{ id: 'synthetic-mcp-message', role: 'user', occurredAtMs: null, content: 'Synthetic MCP capture probe.' }],
  }), { code: 'capability_unavailable' }));
  const archived = () => sql(database, db => db.prepare(`SELECT client_key, content, occurred_at_ms
    FROM cairn_raw_messages`).all().map(row => ({ client: JSON.parse(row.client_key), saved: 1, reason: null,
    content: JSON.parse(row.content), occurredAt: row.occurred_at_ms === null ? null : new Date(row.occurred_at_ms).toISOString() })));
  const canonicalArchive = rows => rows.toSorted((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  const result = new Map();
  const entries = cases();
  assert.equal(entries.length, golden.exchanges.length);
  let deleteChecks = 0;
  const matched = { claude: 0, codex: 0 };
  for (const [index, step] of entries.entries()) {
    const expected = golden.exchanges[index], client = clients[step.client];
    assert.equal(step.label, expected.label);
    const sourcePath = step.source === 'fork' ? forkPath : client.sourcePath;
    if (step.append) appendFileSync(sourcePath, step.append);
    if (step.control === 'pause') {
      const { ownerId } = client.request.namespace;
      await operate(async ({ service }) => assert.equal((await service.setPause(ownerId, true)).paused, true));
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
      await scopedDisableProbe({ fixture, source, expectedStoreId, client, openStorage });
    }
    const args = expected.argv.map(value => ({ $node: node, $hook: executable, $installation: client.directory })[value] ?? value);
    assert.deepEqual(args.slice(0, 5), prefix);
    assert.deepEqual(args.slice(7), ['hook', '--installation', client.directory, '--event', step.event]);
    const input = expected.stdin.replaceAll('$transcript', sourcePath);
    assert.equal(input, step.literal ?? JSON.stringify({ hook_event_name: step.event,
      session_id: sessions[step.source ?? step.client], transcript_path: sourcePath, ...step.payload }));
    const prior = calls().length;
    const argv = [...prefix, node, ...flags, '--import', preload, executable, ...args.slice(7)];
    if (step.label === 'claude start') {
      const keyed = child(argv[0], argv.slice(1), input, root, { ...env,
        [client.request.providerApiKeyEnv]: 'synthetic-provider-value' });
      assert.deepEqual(keyed, { exit: expected.exit, stdout: expected.stdout, stderr: expected.stderr });
      assert.deepEqual(calls().slice(prior), [{ kind: 'hook', outcome: { status: 'blocked', reason: 'authority_changed' } }]);
      assert.equal(cursor(client.request.installationDirectory), null);
    }
    const before = calls().length;
    const actual = step.client === 'codex' ? child(binary, ['hook-fixture', ...argv], input) : child(argv[0], argv.slice(1), input);
    assert.deepEqual(actual, { exit: expected.exit, stdout: expected.stdout, stderr: expected.stderr }, step.label);
    const observations = calls().slice(before);
    const outcome = observations.find(row => row.kind === 'hook')?.outcome ?? null;
    assert.equal(observations.filter(row => row.kind === 'model').length, 0);
    assert.equal(observations.filter(row => row.kind === 'ack').length, 0);
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
  console.log('Packaged capture CLI, cursor and Raw archive matched ' + entries.length + ' of ' + golden.exchanges.length +
    ' exchanges (' + matched.claude + ' Claude Code, ' + matched.codex + ' Codex), with 0 model calls.');
  console.log('Ordinary MCP kept automatic capture off and the configured-key hook refused before cursor initialization.');
  console.log('Migrated candidate uses physical schema ' + SQLITE_PHYSICAL_VERSION + '.');
  console.log('Deleted text absent from the closed main file and SQLite companions after delete, restart and replay.');
}

function assertDeletedBytes(database, sentinel, step) {
  for (const suffix of ['', '-wal', '-shm', '-journal']) {
    let bytes;
    try { bytes = readFileSync(database + suffix); }
    catch (error) { if (suffix && error.code === 'ENOENT') continue; throw error; }
    assert.equal(bytes.includes(sentinel), false, step + ' (' + (suffix || 'main file') + ')');
  }
}

async function scopedDisableProbe({ fixture, source, expectedStoreId, client, openStorage }) {
  const { root, installed, moduleAt, sql } = fixture;
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
  const candidateRoot = join(root, 'candidate-install', 'node_modules', 'cairn-memory-core-local-candidate');
  const { captureAdapter } = await moduleAt(candidateRoot, 'packaging/core-local/capture-slot.mjs');
  assert.throws(() => captureAdapter({ ...client.binding, database: destination, migrationId, attestation }).check(), { code: 'capture_disabled' });
  const alive = await openStorage(destination);
  try { assert.equal((await alive.service.pauseState(namespace.ownerId)).paused, false); }
  finally { await alive.close(); }
  assert.equal(sql(destination, db => db.prepare('SELECT count(*) AS n FROM cairn_raw_messages').get().n), 0);
  console.log('Packaged authority check refused migrated scoped disable while owner pause remained open.');
}
