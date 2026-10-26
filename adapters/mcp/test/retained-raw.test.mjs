import assert from 'node:assert/strict';
import test from 'node:test';
import { writeFileSync } from 'node:fs';
import { PROTOCOL_VERSION_META_KEY, CLIENT_INFO_META_KEY, CLIENT_CAPABILITIES_META_KEY } from '@modelcontextprotocol/core/internal';
import { openMemoryCore } from '../../../core/index.mjs';
import { createScopedCardAccess } from '../private-card-access.mjs';
import { buildCairnServer, createCairnServer } from '../server.mjs';
import { retainedRawOptions } from '../retained-raw-profile.mjs';
import { rawRequest, splitRaw } from '../../../core/testing/raw-fixtures.mjs';
import { fixture, host, rawHost, discover, rawDraft, namespace, ok, call } from './retained-raw-support.mjs';

test('retained stdio exposes exactly25 strict tools and discovers both clients with exact Unicode/BOM', async t => {
  const f = fixture(t), saved = await f.capture(); await f.capture('claude-code', 'claude-source', saved.text);
  ok(f.core.setRawCaptureControl({ ownerId: namespace.ownerId, client: 'codex', expectedRevision: 0, enabled: false }));
  const before = f.calls(), usage = { ...f.db.prepare('SELECT * FROM raw_owner_usage').get() };
  const { client } = await host(f.workspace, f.profilePath), tools = (await client.listTools()).tools;
  assert.equal(tools.length, 25);
  for (const tool of tools) { assert.equal(tool.inputSchema.additionalProperties, false); assert.equal(Object.hasOwn(tool.inputSchema.properties, 'namespace'), false); }
  for (const rawClient of ['codex', 'claude-code']) {
    const view = await discover(client, rawClient);
    assert.equal(view.pages.flatMap(page => page.messages.flatMap(message => message.parts.map(part => part.text))).join(''), saved.text);
    assert.equal(view.listed.conversations[0].client, rawClient);
  }
  const { draft, sources } = await rawDraft(client);
  assert.equal(f.db.prepare('SELECT count(*) n FROM memories').get().n, 0);
  assert.equal(f.db.prepare('SELECT count(*) n FROM card_notes').get().n, 0);
  assert.equal(ok(await call(client, 'read_private_card_source', { source: sources[0] })).parts.map(part => part.text).join(''), saved.text);
  assert.equal((await call(client, 'confirm_private_card_draft', { cardId: draft.id, expectedRevision: draft.revision, actionId: 'not-approval' })).error.code, 'approval_required');
  assert.equal((await call(client, 'recall_memory', { query: 'synthetic' })).error.code, 'model_not_configured');
  assert.equal(f.calls(), before); assert.deepEqual({ ...f.db.prepare('SELECT * FROM raw_owner_usage').get() }, usage);
});

test('pending partial Raw exposes saved prefix and refuses an unreceived whole-message span', async t => {
  const f = fixture(t), text = 'Synthetic long source. '.repeat(300), first = splitRaw(text)[0];
  ok(await f.core.captureRaw(rawRequest(first, { namespace, client: 'codex', sessionId: 'partial', eventId: 'partial-first' })));
  const { client } = await host(f.workspace, f.profilePath), found = await discover(client);
  assert.equal(found.pages[0].conversation.rawState, 'partial');
  assert.equal(found.pages[0].conversation.coverage.pendingMessages, 1);
  assert.equal(found.message.assemblyState, 'pending');
  assert.equal(found.message.parts[0].text, first.content);
  const anchor = end => ({ rawAnchor: { conversationId: found.conversationId, messageId: found.message.id,
    start: 0, end, precision: end === text.length ? 'whole-message' : 'exact' }, expectedConversationRevision: found.revision });
  const prefix = ok(await call(client, 'resolve_source_references', { anchors: [anchor(first.content.length)] }));
  assert.equal(prefix.coverage.conversationCoverage, 'unknown');
  assert.equal((await call(client, 'resolve_source_references', { anchors: [anchor(text.length)] })).ok, false);
  assert.equal(f.db.prepare('SELECT count(*) n FROM memories').get().n, 0);
});

test('retained draft/source schemas reject namespace, mixed alternatives, user grants and forged refs', async t => {
  const f = fixture(t); await f.capture(); const { client } = await host(f.workspace, f.profilePath);
  const { sources, revision, conversationId, message } = await rawDraft(client);
  const base = { actionId: 'invalid', title: 'Synthetic', body: 'Synthetic', sources };
  for (const input of [{ ...base, namespace }, { ...base, authority: {} }, { ...base, authoredInput: { text: 'bypass' } },
    { ...base, memoryRefs: [{ memoryId: 'fake', revision: 1 }] }, { ...base, sources: [] },
    { ...base, sources: [{ ...sources[0], contentIdentity: 'a'.repeat(43) }] },
    { ...base, sources: [{ ...sources[0], namespace }] }]) {
    assert.equal((await client.callTool({ name: 'create_private_card_draft', arguments: input })).isError, true);
  }
  assert.equal((await call(client, 'resolve_source_references', { anchors: [{ rawAnchor: { conversationId, messageId: message.id,
    start: 0, end: message.totalUnits, precision: 'whole-message' }, expectedConversationRevision: revision + 1 }] })).error.code, 'revision_conflict');
  assert.equal(f.db.prepare('SELECT count(*) n FROM private_cards').get().n, 1);
});

test('actual SDK modern probe falls back to legacy with one immutable retained profile binding', { timeout: 20000 }, async t => {
  const f = fixture(t); await f.capture();
  const wire = rawHost(f.workspace, f.profilePath);
  const discovered = await wire.request('server/discover', { _meta: {
    [PROTOCOL_VERSION_META_KEY]: '2026-07-28', [CLIENT_INFO_META_KEY]: { name: 'synthetic-probe', version: '1.0.0' },
    [CLIENT_CAPABILITIES_META_KEY]: {},
  } });
  assert.ok(discovered.result, JSON.stringify(discovered));
  // Same file identity, different serialized authority: the running process keeps
  // its startup namespace instead of re-reading it for the second SDK instance.
  writeFileSync(f.profilePath, JSON.stringify({ ...f.profile, namespace: { ...namespace, ownerId: 'foreign' } }));
  const initialized = await wire.request('initialize', { protocolVersion: '2025-11-25', capabilities: {},
    clientInfo: { name: 'synthetic-legacy', version: '1.0.0' } });
  assert.ok(initialized.result, JSON.stringify(initialized)); wire.notify('notifications/initialized');
  const tools = await wire.request('tools/list', {}); assert.equal(tools.result.tools.length, 25);
  const reply = await wire.request('tools/call', { name: 'list_raw_conversations', arguments: { client: 'codex' } });
  const result = JSON.parse(reply.result.content[0].text);
  assert.equal(result.ok, true); assert.equal(result.value.conversations.length, 1);
});

test('server async close revokes pending Raw source grants before first await and closes once', async t => {
  const f = fixture(t); await f.capture('codex', 'synthetic-session', 'Synthetic pending read.');
  const listed = ok(f.core.listRawConversations({ namespace, client: 'codex' }));
  const conversationId = listed.conversations[0].id, view = ok(await f.core.getConversation({ namespace, conversationId }));
  const cards = createScopedCardAccess(namespace, { rawSources: true }), raw = retainedRawOptions();
  let release, entered;
  const opened = new Promise(resolve => { entered = resolve; });
  const blocker = new Promise(resolve => { release = resolve; });
  let core;
  f.workspace.defer(() => core?.close());
  core = openMemoryCore({ path: f.path, existingStore: { version: 'schema29-existing-v1', storeId: f.profile.storeId },
    privateCards: cards.configuration, rawConversations: { ...raw, port: { ...raw.port,
      async openRaw(input) { entered(); await blocker; return raw.port.openRaw(input); } } } });
  const pending = cards.call(core, 'resolveSourceReferences', { anchors: [{ rawAnchor: { conversationId,
    messageId: view.messages[0].id, start: 0, end: view.messages[0].totalUnits, precision: 'whole-message' },
  expectedConversationRevision: view.conversation.revision }] });
  await opened;
  let closes = 0;
  const server = buildCairnServer({ path: f.path, binding: namespace, cards,
    core: { ...core, close() { closes++; return core.close(); } }, client: 'synthetic', sessionId: 'synthetic' });
  const closing = server.close();
  release();
  assert.equal((await pending).error.code, 'scope_changed');
  await closing; await server.close(); assert.equal(closes, 1);
});

test('malformed UTF-8, encrypted and keyed plain Raw refuse without plaintext fallback', async t => {
  for (const variant of ['utf8', 'encrypted', 'keyed']) {
    const f = fixture(t); await f.capture();
    if (variant === 'utf8') f.db.prepare('UPDATE raw_parts SET sealed=?').run(Buffer.from([255]));
    if (variant === 'encrypted') f.db.prepare("UPDATE raw_parts SET format='envelope-aes-256-gcm-v1'").run();
    if (variant === 'keyed') f.db.prepare("UPDATE raw_parts SET key_version='unsupported'").run();
    const { client } = await host(f.workspace, f.profilePath);
    const listed = ok(await call(client, 'list_raw_conversations', { client: 'codex' }));
    const result = await call(client, 'read_raw_conversation', { conversationId: listed.conversations[0].id });
    assert.equal(result.error.code, 'raw_crypto_unavailable'); assert.equal(result.value, undefined);
  }
});

test('capture-off retained access still reports skipped Raw honestly and does not resolve missing spans', async t => {
  const f = fixture(t);
  ok(f.core.setRawCaptureControl({ ownerId: namespace.ownerId, client: 'codex', expectedRevision: 0, enabled: false }));
  await f.capture();
  const { client } = await host(f.workspace, f.profilePath), found = await discover(client);
  assert.equal(found.pages[0].conversation.rawState, 'not_saved');
  assert.equal(found.message.parts[0].saved, false); assert.equal(found.message.parts[0].text, null);
  const resolved = await call(client, 'resolve_source_references', { anchors: [{ rawAnchor: { conversationId: found.conversationId,
    messageId: found.message.id, start: 0, end: found.message.totalUnits, precision: 'whole-message' }, expectedConversationRevision: found.revision }] });
  assert.equal(resolved.ok, false);
  assert.equal(f.db.prepare('SELECT count(*) n FROM private_cards').get().n, 0);
});

test('legacy constructors retain default5/private22 behavior and old Memory drafts', async t => {
  const f = fixture(t);
  for (const enabled of [false, true]) {
    const server = createCairnServer({ path: f.path, namespace, ...(enabled ? { privateCards: 'local-v1' } : {}) });
    assert.equal(server instanceof Promise, false); await server.close();
  }
  const { client } = await host(f.workspace, f.profilePath);
  const memory = ok(await call(client, 'remember_memory', { content: 'Synthetic explicit receipt.' })).memory;
  const draft = ok(await call(client, 'create_private_card_draft', { actionId: 'receipt-draft', title: 'Synthetic', body: 'Synthetic',
    memoryRefs: [{ memoryId: memory.id, revision: memory.revision }] }));
  const card = ok(await call(client, 'inspect_private_card', { cardId: draft.id })).card;
  assert.equal(card.bindings[0].source.type, 'receipt');
  assert.equal(card.bindings[0].dependency, 'memory-interpretation');
  const source = { ...card.bindings[0].source }; delete source.namespace;
  assert.equal((await client.callTool({ name: 'read_private_card_source', arguments: { source, budgets: {} } })).isError, true);
  const corrected = ok(await call(client, 'correct_memory', { memoryId: memory.id, expectedRevision: memory.revision, content: 'Synthetic corrected receipt.' })).memory;
  ok(await call(client, 'forget_memory', { memoryId: memory.id, expectedRevision: corrected.revision }));
});
