import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { lineageHost } from '../../core/testing/card-lineage-fixture.mjs';
import { interpretation } from '../../core/testing/episode-capture-helpers.mjs';
import { rawRequest, splitRaw } from '../../core/testing/raw-fixtures.mjs';
import { rationaleModel } from '../../core/testing/rationale-model.mjs';
import { golden, withStdio } from '../../packaging/test/fixtures/local-host-wire-replay.mjs';
import { openSqliteAdapter } from '../../packages/adapter-sqlite/src/index.mjs';
import { assertEngineCache } from '../../packages/setup/test/engine-cache.mjs';
import { assertFixtureClients, fixtureBinaryGuard } from '../../packages/setup/test/fixture-clients.mjs';

const repo = fileURLToPath(new URL('../../', import.meta.url));
const tag = 'installer-v0.6.12';
const tagEngine = tag + ':packages/setup/runtime/engine/';
const archiveName = 'cairn-memory-local-preview-0.0.0-preview.1.tgz';
const namespace = { ownerId: 'synthetic-owner', scope: 'project', projectId: 'synthetic-project' };
const node = process.execPath;
const cache = process.env.CAIRN_SETUP_NPM_CACHE;
const json = path => JSON.parse(readFileSync(path, 'utf8'));
const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
const candidate = join(repo, 'packages/setup/bin/memory.mjs');

function run(executable, args, { cwd, environment, input, expect = 0 }) {
  const result = spawnSync(executable, args, {
    cwd, env: environment, input, timeout: 120_000, maxBuffer: 16 * 1024 * 1024, killSignal: 'SIGKILL',
  });
  assert.ifError(result.error);
  assert.equal(result.status, expect, result.stdout.toString() + result.stderr.toString());
  return result.stdout;
}

function publishedInstaller(scratch) {
  const options = { cwd: repo, environment: { PATH: '/usr/bin:/bin', HOME: scratch, LANG: 'C.UTF-8' } };
  const packageDir = join(scratch, 'packages/setup');
  const archived = run('git', ['archive', tag, '--', 'packages/setup/bin', 'packages/setup/lib',
    'packages/setup/package.json', 'packages/setup/runtime'], options);
  run('tar', ['-xf', '-', '-C', scratch], { ...options, input: archived });
  assert.equal(json(join(packageDir, 'package.json')).version, '0.6.12');
  const manifestBytes = run('git', ['show', tagEngine + 'manifest.json'], options);
  const archiveBytes = run('git', ['show', tagEngine + archiveName], options);
  const manifest = JSON.parse(manifestBytes);
  assert.equal(archiveBytes.length, manifest.bytes);
  assert.equal(createHash('sha256').update(archiveBytes).digest('hex'), manifest.sha256);
  assert.deepEqual(readFileSync(join(packageDir, 'runtime/engine/manifest.json')), manifestBytes);
  assert.deepEqual(readFileSync(join(packageDir, 'runtime/engine', archiveName)), archiveBytes);
  return { bin: join(packageDir, 'bin/memory.mjs'), manifest };
}

function fixture(scratch) {
  const home = join(scratch, 'home');
  const bin = join(scratch, 'bin');
  for (const path of [home, bin]) mkdirSync(path, { mode: 0o700 });
  const state = join(scratch, 'claude.json'), calls = join(scratch, 'claude.jsonl');
  writeFileSync(state, '{}', { mode: 0o600 });
  writeFileSync(join(bin, 'claude'), '#!' + node + '\n' + fixtureBinaryGuard(scratch) +
    `process.env.FAKE_STATE = ${JSON.stringify(state)};\nprocess.env.FAKE_CALLS = ${JSON.stringify(calls)};\n` +
    readFileSync(join(repo, 'packages/setup/test/fake-claude.mjs'), 'utf8'), { mode: 0o700 });
  const npm = realpathSync(join(dirname(node), 'npm'));
  const userconfig = join(scratch, 'empty-user.npmrc'), globalconfig = join(scratch, 'empty-global.npmrc');
  for (const path of [userconfig, globalconfig]) writeFileSync(path, '', { mode: 0o600 });
  writeFileSync(join(bin, 'npm'), '#!/bin/sh\nexec ' + quote(node) + ' ' + quote(npm) +
    ' --offline --userconfig ' + quote(userconfig) + ' --globalconfig ' + quote(globalconfig) +
    ' --cache ' + quote(cache) + ' "$@"\n', { mode: 0o700 });
  const environment = { HOME: home, CODEX_HOME: join(home, '.codex'), PATH: bin, TMPDIR: scratch,
    LANG: 'C.UTF-8', CAIRN_SETUP_NPM_CACHE: cache, CAIRN_SETUP_NPM_OFFLINE: '1' };
  assert.deepEqual(Object.keys(assertFixtureClients(environment, scratch)), ['claude']);
  return {
    descriptor: () => json(join(home, '.cairn-memory/installation.json')),
    vector: () => json(join(home, '.claude.json')).mcpServers['cairn-local'].args,
    run: (entry, args, expect = 0) => run(node, [entry, ...args, '--lang', 'en'],
      { cwd: scratch, environment, expect }).toString(),
  };
}

async function withTools([entry, ...args], directory, work) {
  await withStdio(entry, args, directory, async (request, notify) => {
    assert.ok((await request('initialize', golden.exchanges.initialize.params)).result);
    notify('notifications/initialized');
    assert.ok((await request('ping')).result);
    await work(async (name, args) => {
      const reply = await request('tools/call', { name, arguments: args });
      assert.ok(reply.result, JSON.stringify(reply));
      return JSON.parse(reply.result.content[0].text);
    });
  });
}

function value(reply) {
  assert.equal(reply.ok, true, JSON.stringify(reply));
  return reply.value;
}

const legacyCore = async entry => (await import(pathToFileURL(join(dirname(entry), '../core/index.mjs')))).openMemoryCore;
const manualReceipt = (eventId, excerpt) => ({ client: 'manual', sessionId: 'synthetic-manual', eventId, role: 'user', excerpt });
const admit = (core, content, receipts) => value(core.admit({ namespace, memory: { content, kind: 'fact' }, receipts })).memory;
const get = (core, memory) => value(core.get({ namespace, memoryId: memory.id }));
const forget = async (core, memory) => assert.equal(value(await core.forget({
  namespace, memoryId: memory.id, expectedRevision: memory.revision,
})).forgotten, true);

async function seedLegacyForgets(entry, database, updatedAt) {
  const anchor = Date.parse(updatedAt);
  assert.ok(Number.isFinite(anchor));
  const openMemoryCore = await legacyCore(entry);
  const model = { ...rationaleModel(), extract: ({ input }) => ({ items: input.messages
    .filter(message => message.content.startsWith('Synthetic deletion '))
    .map(message => ({ content: 'Derived ' + message.content, kind: 'fact', confidence: 0.8, sourceIndices: [message.index] })),
  }) };
  const core = openMemoryCore({ path: database, raw: true, rawSearch: false, model });
  const known = {};
  let cliConversation;
  try {
    const capture = async (id, text, minutes) => {
      const occurredAt = new Date(anchor + minutes * 60_000).toISOString();
      const input = rawRequest(splitRaw(text, { id, ordinal: 1, occurredAt })[0], { namespace, sessionId: id });
      return value(await core.captureRaw(input));
    };
    const single = admit(core, 'The synthetic single turn is discarded.', [manualReceipt('single', 'A standalone excerpt.')]);
    await forget(core, single);
    known.single = single.id;

    const shared = manualReceipt('shared', 'A shared excerpt about an indigo ribbon.');
    const first = admit(core, 'The synthetic swallow has a blue band.', [shared]);
    const survivor = admit(core, 'The synthetic quail has a green band.', [shared, manualReceipt('independent', 'An independent excerpt.')]);
    assert.equal(get(core, survivor).receipts.length, 2);
    await forget(core, first);
    assert.deepEqual(get(core, survivor).receipts.map(({ eventId }) => eventId), ['independent']);
    known.shared = first.id;
    known.survivor = survivor.id;

    const original = admit(core, 'The synthetic river flows west.', [manualReceipt('river', 'The original river excerpt.')]);
    const corrected = value(await core.correct({ namespace, memoryId: original.id, expectedRevision: original.revision,
      content: 'The synthetic river flows east.', kind: 'fact', receipt: manualReceipt('correction', 'The corrected river excerpt.') }));
    await forget(core, corrected.memory);
    known.corrected = original.id;

    const firstRevision = admit(core, 'The synthetic dial originally pointed east.', [manualReceipt('original', 'The first dial excerpt.')]);
    const superseded = value(await core.supersede({ namespace, memoryId: firstRevision.id, expectedRevision: firstRevision.revision,
      replacement: { content: 'The synthetic dial now points north.', kind: 'fact' },
      receipts: [manualReceipt('replacement', 'The revised dial excerpt.')] }));
    await forget(core, get(core, firstRevision).memory);
    known.historical = firstRevision.id;
    known.replacement = superseded.memory.id;

    const conversation = await capture('synthetic-conversation-delete', 'Synthetic deletion of the fern archive.', -180);
    const { conversations } = value(core.listRawConversations({ namespace, client: 'claude-code' }));
    const header = conversations.find(({ id }) => id === conversation.raw.conversationId);
    assert.ok(header);
    const [attached] = value(conversation.interpretation).admission.memories;
    assert.ok(attached);
    assert.equal(value(await core.deleteConversation({ namespace, conversationId: header.id,
      expectedRevision: header.revision, actionId: 'synthetic-conversation-delete' })).forgottenMemories, 1);
    known.conversation = attached.id;
    const raw = await capture('synthetic-cli-delete', 'Synthetic deletion of the ash archive.', -240);
    const [attachedToRaw] = value(raw.interpretation).admission.memories;
    assert.ok(attachedToRaw);
    known.raw = attachedToRaw.id;
    cliConversation = raw.raw.conversationId;
    assert.ok(cliConversation);
  } finally { await core.close(); }

  const review = openMemoryCore({ path: database, decisionReview: 'required-v1', model: {
    ...rationaleModel(),
    extract: () => ({ items: [{ content: 'The synthetic transit route uses the east gate.',
      kind: 'decision', confidence: 0.8, sourceIndices: [0] }] }),
  } });
  try {
    value(await review.capture({ namespace, client: 'codex', sessionId: 'synthetic-review',
      eventId: 'synthetic-review-capture',
      messages: [{ id: 'synthetic-review-turn', role: 'user', content: 'The synthetic transit plan selects the east gate.' }] }));
    const { memories: [pending] } = value(review.list({ namespace, reviewState: 'awaiting' }));
    assert.ok(pending);
    value(await review.reject({ namespace, memoryId: pending.id, expectedRevision: pending.revision,
      actionId: 'synthetic-review-reject' }));
    assert.equal(review.get({ namespace, memoryId: pending.id, includeAwaiting: true }).error?.code, 'memory_not_found');
    known.rejected = pending.id;
  } finally { await review.close(); }
  return { known, cliConversation };
}

async function seedCardForget(openMemoryCore, database) {
  const host = lineageHost();
  const core = openMemoryCore({ path: database, privateCards: host.options });
  try {
    const shared = manualReceipt('shared-card', 'A shared excerpt about an indigo ribbon.');
    const first = admit(core, 'The synthetic swallow has a blue band.', [shared]);
    const survivor = admit(core, 'The synthetic quail has a green band.', [shared]);
    const card = (method, fields) => host.call(core, method, { namespace, ...fields });
    const draft = value(await card('createCardDraft', { actionId: 'synthetic-draft', drafting: 'authored',
      input: { title: 'Synthetic ribbon', body: shared.excerpt, sourcePolicy: 'retained-receipts-v1',
        memoryRefs: [{ type: 'memory', namespace, memoryId: survivor.id, revision: survivor.revision }] } }));
    const confirmed = value(await card('confirmCardDraft', { actionId: 'synthetic-confirm', cardId: draft.id,
      expectedRevision: draft.revision, applicability: 'current' }));
    assert.equal(value(await card('getCard', { cardId: confirmed.id })).card.body, shared.excerpt);
    await forget(core, first);
    assert.deepEqual(get(core, survivor).receipts, []);
    assert.ok(!JSON.stringify(await card('getCard', { cardId: confirmed.id })).includes(shared.excerpt));
  } finally { await core.close(); }
}

async function seedEpisodeForget(openMemoryCore, database) {
  const episodes = openMemoryCore({ path: database, model: { ...rationaleModel(), interpretEpisode: interpretation },
    captureQualification: 'source-bound-v2', captureEvidence: 'staged-v1',
    sessionEpisodes: { mode: 'episode-v1', draftEveryBatches: 2 } });
  try {
    const captured = value(await episodes.capture({ namespace, client: 'codex', sessionId: 'synthetic-episode',
      eventId: 'synthetic-episode-capture', episodeContext: { clientLabel: 'Synthetic', generation: 'initial', origin: 'ordinary' },
      messages: [{ id: 'synthetic-episode-turn', role: 'user', content: 'The synthetic notebook belongs to this episode.', occurredAt: null }] }));
    const [memory] = captured.admission.memories;
    const { episode } = value(episodes.getEpisode({ namespace, episodeId: captured.episode.id }));
    value(await episodes.forgetEpisode({ namespace, episodeId: episode.id, expectedRevision: episode.revision }));
    assert.equal(episodes.get({ namespace, memoryId: memory.id }).error?.code, 'memory_not_found');
  } finally { await episodes.close(); }
}

async function assertUnsupportedLegacyShape(legacy, directory, seed) {
  mkdirSync(directory, { mode: 0o700 });
  const f = fixture(directory);
  f.run(legacy, ['setup', '--local', '--no-capture', '--owner', namespace.ownerId, '--project', namespace.projectId]);
  const { path } = f.descriptor().database;
  const vector = f.vector();
  try {
    await withTools(vector, directory, async call => assert.deepEqual(value(await call('inspect_memory', {})).memories, []));
  } finally { f.run(legacy, ['daemon', 'stop', '--local']); }
  await seed(await legacyCore(vector[0]), path);
  assert.match(f.run(candidate, ['setup', '--local'], 2), /cannot migrate all data/u);
  assert.equal(f.descriptor().database.path, path);
}

async function visibleMemories(call) {
  const rows = [];
  let cursor;
  do {
    const page = value(await call('inspect_memory', { states: ['active', 'historical'], limit: 2, ...(cursor ? { cursor } : {}) }));
    for (const { id } of page.memories) {
      const { memory, receipts, nextReceiptCursor } = value(await call('inspect_memory', { memoryId: id, receiptLimit: 50 }));
      assert.ok(!nextReceiptCursor);
      const { content, kind, origin, confidence, revision, state } = memory;
      rows.push({ id, content, kind, origin, confidence, revision, state,
        receipts: receipts.map(({ id, client, sessionId, eventId, role, excerpt, createdAt }) =>
          ({ id, client, sessionId, eventId, role, excerpt, createdAt })) });
    }
    cursor = page.nextCursor;
  } while (cursor);
  return rows.sort((a, b) => a.id.localeCompare(b.id));
}

async function assertHydration(path, legacyVisible) {
  const scope = { owner: namespace.ownerId, namespace: namespace.scope + '\0' + namespace.projectId };
  const selection = { owner: scope.owner, namespaces: [scope.namespace] };
  const adapter = await openSqliteAdapter(path);
  try {
    await adapter.uow.run(scope.owner, { readOnly: true }, async tx => {
      const { items } = await adapter.memories.exportPage(tx, scope, { cursor: null, limit: 50 });
      const refs = items.map(({ id }) => ({ type: 'memory', namespace: scope.namespace, id }));
      const rows = await adapter.hydrate.hydrate(tx, selection, refs, 'export');
      const projectReceipts = receipts => receipts.map(({ client, sessionId, messageId, role }) =>
        ({ client, sessionId, messageId, role }));
      const migrated = rows.map(({ memory, receipts }) => ({ id: memory.id, receipts: projectReceipts(receipts) }))
        .sort((a, b) => a.id.localeCompare(b.id));
      assert.deepEqual(migrated, legacyVisible.map(({ id, receipts }) =>
        ({ id, receipts: projectReceipts(receipts.map(receipt => ({ ...receipt, messageId: receipt.eventId }))) })));
    });
  } finally { await adapter.close(); }
}

async function assertForgetWindow(legacy, directory) {
  mkdirSync(directory, { mode: 0o700 });
  const f = fixture(directory);
  f.run(legacy, ['setup', '--local', '--no-capture', '--owner', namespace.ownerId, '--project', namespace.projectId]);
  const installed = f.descriptor();
  const vector = f.vector();
  let memory;
  try {
    await withTools(vector, directory, async call => {
      const saved = value(await call('remember_memory', { content: 'The synthetic fox left a note.' })).memory;
      memory = value(await call('inspect_memory', { memoryId: saved.id })).memory;
    });
  } finally { f.run(legacy, ['daemon', 'stop', '--local']); }
  const openMemoryCore = await legacyCore(vector[0]);
  const core = openMemoryCore({ path: installed.database.path, raw: true, rawSearch: false,
    model: { ...rationaleModel(), extract: () => ({ items: [] }) } });
  const withheld = 'The synthetic zephyrite beacon has an amber base.';
  const retained = 'The synthetic zephyrite lantern has a blue base.';
  try {
    for (const [index, { text, minutes }] of [{ text: withheld, minutes: 29 }, { text: retained, minutes: 31 }].entries()) {
      const id = 'synthetic-turn-' + index;
      const occurredAt = new Date(Date.parse(memory.updatedAt) + minutes * 60_000).toISOString();
      const input = rawRequest(splitRaw(text, { id, ordinal: 1, occurredAt })[0], { namespace, sessionId: id });
      assert.ok(value(await core.captureRaw(input)).raw.conversationId);
    }
  } finally { await core.close(); }
  assert.match(f.run(candidate, ['setup', '--local']), /Local cutover verified/u);
  assert.match(f.run(candidate, ['local-cutover', '--confirm']), /Local cutover active/u);
  const migrated = f.vector();
  const search = { query: 'zephyrite', types: ['memory'], intent: 'current' };
  const checkRaw = async (call, visible) => {
    const items = JSON.stringify(value(await call('read_memory_context', search)).items);
    assert.equal(items.includes(withheld), visible, items);
    assert.ok(items.includes(retained), items);
  };
  try {
    await withTools(migrated, directory, async call => {
      await checkRaw(call, true);
      assert.equal(value(await call('forget_memory', { memoryId: memory.id, expectedRevision: memory.revision })).forgotten, true);
      await checkRaw(call, false);
    });
    f.run(candidate, ['daemon', 'stop', '--local']);
    await withTools(migrated, directory, call => checkRaw(call, false));
  } finally { f.run(candidate, ['daemon', 'stop', '--local']); }
}

assertEngineCache(cache);
const scratch = mkdtempSync(join(tmpdir(), 'cairn-0612-'));
try {
  const { bin: legacy, manifest } = publishedInstaller(scratch);
  const f = fixture(scratch);
  let active = false;
  try {
    f.run(legacy, ['setup', '--local', '--no-capture', '--owner', namespace.ownerId, '--project', namespace.projectId]);
    const installed = f.descriptor();
    assert.equal(installed.installerVersion, '0.6.12');
    assert.equal(installed.engine.sha256, manifest.sha256);
    const legacyVector = f.vector();
    const content = 'The synthetic marmot filed a striped map.';
    let memory;
    try {
      await withTools(legacyVector, scratch, async call => {
        const saved = value(await call('remember_memory', { content })).memory;
        memory = value(await call('inspect_memory', { memoryId: saved.id })).memory;
      });
    } finally { f.run(legacy, ['daemon', 'stop', '--local']); }
    const { known, cliConversation } = await seedLegacyForgets(legacyVector[0], installed.database.path, memory.updatedAt);
    assert.equal(JSON.parse(f.run(legacy, ['raw', 'delete', cliConversation, '--yes'])).conversationId, cliConversation);
    let legacyVisible;
    try {
      await withTools(legacyVector, scratch, async call => { legacyVisible = await visibleMemories(call); });
    } finally { f.run(legacy, ['daemon', 'stop', '--local']); }
    const legacyById = new Map(legacyVisible.map(row => [row.id, row]));
    for (const id of [known.single, known.shared, known.corrected, known.historical, known.conversation, known.rejected]) {
      assert.equal(legacyById.has(id), false);
    }
    assert.deepEqual(legacyById.get(known.survivor).receipts.map(({ eventId }) => eventId), ['independent']);
    assert.equal(legacyById.get(known.raw).receipts.length, 0);
    assert.equal(legacyById.get(known.replacement).receipts.length, 1);

    assert.match(f.run(candidate, ['setup', '--local']), /Local cutover verified/u);
    assert.match(f.run(candidate, ['local-cutover', '--confirm']), /Local cutover active/u);
    active = true;
    assert.match(f.run(candidate, ['status']), /Local cutover active/u);
    const vector = f.vector();
    const target = vector[vector.indexOf('--db') + 1];
    assert.ok(vector[0].endsWith('/packaging/core-local/cli.mjs'));
    assert.notEqual(target, installed.database.path);
    assert.equal(readFileSync(installed.database.path, 'utf8'), 'Cairn local store migrated. This path is retired.\n');
    f.run(candidate, ['daemon', 'stop', '--local']);
    await assertHydration(target, legacyVisible);

    for (const operation of ['export', 'index']) {
      assert.equal(f.run(candidate, ['raw', operation], 2), f.run(legacy, ['raw', operation], 2));
    }
    await withTools(vector, scratch, async call => {
      const migratedVisible = await visibleMemories(call);
      assert.deepEqual(migratedVisible, legacyVisible);
      assert.equal(value(await call('inspect_memory', { memoryId: memory.id })).memory.content, content);
    });
    console.log('Published 0.6.12 upgraded to active. Visible Memories and receipts match after single, shared, corrected and historical forgets, review rejection, conversation deletion and Raw CLI deletion.');
  } finally {
    if (active) f.run(candidate, ['daemon', 'stop', '--local']);
  }
  await assertForgetWindow(legacy, join(scratch, 'window'));
  console.log('A fresh forget withheld the nearby Raw turn across restart.');
  await assertUnsupportedLegacyShape(legacy, join(scratch, 'card'), seedCardForget);
  await assertUnsupportedLegacyShape(legacy, join(scratch, 'episode'), seedEpisodeForget);
  console.log('Published card-bound and episode forgets exercised separately. Both stores retained rows that the cutover refuses.');
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
