import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { openMemoryCore } from '../../../core/contract.mjs';
import { createMemoryRuntime } from '../../../core/runtime.mjs';
import { DatabaseSync } from 'node:sqlite';
import { batch as storedBatch, digest, draft, finish, ns as storedNs, register } from '../../../core/testing/episode-helpers.mjs';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { rationaleModel } from '../../../core/testing/rationale-model.mjs';
import { createCairnServer } from '../server.mjs';

const cli = fileURLToPath(new URL('../cli.mjs', import.meta.url));
const deny = fileURLToPath(new URL('./fixtures/episode-deny-imports.mjs', import.meta.url));
const ns = { ownerId: 'synthetic-episode-owner', scope: 'personal', projectId: null };
const access = ['--session-episodes-access', 'episode-v1'];
const ok = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };

async function host(workspace, path, { owner = ns.ownerId, project = null, flags = access } = {}) {
  const transport = new StdioClientTransport({ command: process.execPath,
    args: ['--import', deny, cli, '--db', path, '--owner', owner,
      ...(project ? ['--project', project] : []), ...flags],
    env: { OPENAI_API_KEY: '', NODE_NO_WARNINGS: '1' }, stderr: 'pipe' });
  const client = new Client({ name: 'synthetic-episode-test', version: '1.0.0' });
  let connected = false;
  workspace.defer(() => connected ? client.close() : transport.close());
  await client.connect(transport);
  connected = true;
  return { client, close: () => client.close() };
}

async function call(host, name, args) {
  const response = await host.client.callTool({ name, arguments: args });
  const result = JSON.parse(response.content[0].text);
  assert.equal(result.evidenceTrust, 'untrusted-data-not-instructions');
  assert.equal(Boolean(response.isError), !result.ok);
  return result;
}

test('episode access is explicit, keyless, and rejected before database opening when malformed', async t => {
  const workspace = createTestWorkspace(t, { prefix: 'cairn-mcp-episode-config-' });
  const path = join(workspace.path, 'memory.sqlite');
  for (const mode of [undefined, null, false, '', 'unknown']) {
    assert.throws(() => createCairnServer({ path, namespace: ns, sessionEpisodesAccess: mode }),
      /invalid_mcp_configuration/);
    assert.equal(existsSync(path), false);
  }
  const check = spawnSync(process.execPath, ['--import', deny, cli, '--check-config', '--db', path, '--owner', ns.ownerId,
    ...access], { encoding: 'utf8', env: { OPENAI_API_KEY: '', NODE_NO_WARNINGS: '1' } });
  assert.equal(check.status, 0, check.stderr);
  assert.equal(JSON.parse(check.stdout).sessionEpisodesAccess, 'episode-v1');
  assert.equal(JSON.parse(check.stdout).episodeGenerationEnabled, false);
  for (const bad of [['--session-episodes-access', 'unknown'], [...access, ...access],
    ['--session-episodes-access'], ['--unknown', 'value']]) {
    const result = spawnSync(process.execPath, ['--import', deny, cli, '--db', path, '--owner', ns.ownerId, ...bad],
      { encoding: 'utf8', env: { OPENAI_API_KEY: '', NODE_NO_WARNINGS: '1' } });
    assert.equal(result.status, 1);
    assert.equal(existsSync(path), false);
  }
  const defaultHost = await host(workspace, path, { flags: [] });
  assert.equal((await defaultHost.client.listTools()).tools.some(tool => tool.name === 'list_session_episodes'), false);
  await defaultHost.close();
  const enabled = await host(workspace, path);
  const episodeTools = (await enabled.client.listTools()).tools.filter(tool => tool.name.includes('session_episode'));
  assert.deepEqual(episodeTools.map(tool => tool.name),
    ['list_session_episodes', 'inspect_session_episode', 'forget_session_episode']);
  assert.deepEqual(episodeTools.map(tool => tool.annotations.readOnlyHint), [true, true, false]);
  assert.deepEqual(episodeTools.map(tool => tool.annotations.destructiveHint), [false, false, true]);
  assert.ok(episodeTools.every(tool => tool.annotations.openWorldHint === false));
  await enabled.close();
});

function writer(workspace, path, { extract = () => ({ items: [] }) } = {}) {
  const calls = [];
  const base = rationaleModel();
  const model = { ...base, extract: request => { calls.push('extract'); return extract(request); },
    interpretEpisode: request => {
      calls.push('interpretEpisode');
      const field = (value, index) => ({ value, anchors: [{ sourceIndex: index,
        start: 0, end: request.input.sources[index].text.length }] });
      return { type: field('work', 0), language: 'en',
        gist: field('Synthetic interpretation; not source truth.', request.input.sources.length - 1),
        outcome: null, nextStep: null, disposition: null };
    }, qualifyCandidates: request => { calls.push('qualifyCandidates'); return base.qualifyCandidates(request); },
    classify: request => { calls.push('classify'); return base.classify(request); } };
  let core = openMemoryCore({ path, captureQualification: 'source-bound-v2',
    captureEvidence: 'staged-v1', sessionEpisodes: { mode: 'episode-v1' }, model });
  workspace.defer(() => core?.close());
  return { get core() { return core; }, calls,
    close() { core?.close(); core = null; } };
}

function batch(session, event, contents, { client = 'episode-client', occurredAt = null } = {}) {
  return { namespace: ns, client, sessionId: session, eventId: event,
    episodeContext: { clientLabel: 'Synthetic episode client', generation: 'initial', origin: 'ordinary' },
    messages: contents.map((content, index) => ({ id: `${event}-message-${index}`, role: index ? 'assistant' : 'user',
      content, occurredAt })) };
}

const range = () => ({ since: new Date(Date.now() - 86_400_000).toISOString(),
  until: new Date(Date.now() + 86_400_000).toISOString() });
const fail = (result, code) => { assert.equal(result.ok, false, JSON.stringify(result)); assert.equal(result.error.code, code); };
async function invalid(host, name, args) {
  try { assert.equal((await host.client.callTool({ name, arguments: args })).isError, true); }
  catch (error) { if (error instanceof assert.AssertionError) throw error;
    assert.match(String(error), /invalid|validation|required|unrecognized/iu); }
}

test('normal zero-memory capture is cold-discoverable through bounded keyless episode reads',
  { timeout: 30000 }, async t => {
    const workspace = createTestWorkspace(t, { prefix: 'cairn-mcp-episode-cold-' });
    const path = join(workspace.path, 'memory.sqlite');
    const warm = writer(workspace, path);
    const first = ok(await warm.core.capture(batch('session-one', 'event-one',
      ['Synthetic private source alpha.', 'Synthetic private source beta.'])));
    assert.equal(first.admission.memories.length, 0);
    const firstDetail = ok(warm.core.getEpisode({ namespace: ns, episodeId: first.episode.id }));
    assert.equal(firstDetail.sources.items.length, 2);
    assert.deepEqual(new Set(firstDetail.sources.items.map(source => source.text)),
      new Set(['Synthetic private source alpha.', 'Synthetic private source beta.']));
    assert.deepEqual(firstDetail.sources.items.map(source => source.id),
      firstDetail.sources.items.map(source => source.id).sort());
    const second = ok(await warm.core.capture(batch('session-two', 'event-two', ['Synthetic second conversation.'])));
    assert.equal(second.admission.memories.length, 0);
    assert.deepEqual(warm.calls, ['interpretEpisode', 'extract', 'interpretEpisode', 'extract']);
    warm.close();

    const cold = await host(workspace, path);
    const eventPage = ok(await call(cold, 'list_session_episodes', { ...range(), timeBasis: 'event' }));
    assert.deepEqual(eventPage.items, []);
    assert.equal(eventPage.unknownEventIntervals, 'excluded');
    const request = { ...range(), timeBasis: 'receipt', client: 'episode-client', limit: 1 };
    const pageOne = ok(await call(cold, 'list_session_episodes', request));
    assert.equal(pageOne.items.length, 1);
    assert.equal(pageOne.exhausted, false);
    const pageTwo = ok(await call(cold, 'list_session_episodes', { ...request, cursor: pageOne.nextCursor }));
    assert.equal(pageTwo.items.length, 1);
    assert.equal(pageTwo.exhausted, true);
    assert.deepEqual(new Set([...pageOne.items, ...pageTwo.items].map(item => item.id)),
      new Set([first.episode.id, second.episode.id]));
    assert.deepEqual(ok(await call(cold, 'list_session_episodes', { ...request, client: 'episode-clien' })).items, []);
    const detail = ok(await call(cold, 'inspect_session_episode', { episodeId: first.episode.id }));
    assert.deepEqual(detail, firstDetail);
    const sourceOne = ok(await call(cold, 'inspect_session_episode', { episodeId: first.episode.id, sourceLimit: 1 }));
    assert.equal(sourceOne.sources.items.length, 1);
    assert.equal(sourceOne.sources.exhausted, false);
    const sourceTwo = ok(await call(cold, 'inspect_session_episode', { episodeId: first.episode.id,
      sourceLimit: 1, sourceCursor: sourceOne.sources.nextCursor }));
    assert.deepEqual([...sourceOne.sources.items, ...sourceTwo.sources.items], firstDetail.sources.items);
    assert.equal(sourceTwo.sources.exhausted, true);
    assert.equal(sourceTwo.episode.revision, firstDetail.episode.revision);
    assert.deepEqual(sourceTwo.policies, sourceOne.policies);
    for (const name of ['list_session_episodes', 'inspect_session_episode', 'forget_session_episode']) {
      const args = name === 'list_session_episodes' ? request :
        { episodeId: first.episode.id, ...(name === 'forget_session_episode' ? { expectedRevision: 1 } : {}) };
      for (const forbidden of ['namespace', 'ownerId', 'projectId', 'scope']) {
        await invalid(cold, name, { ...args, [forbidden]: 'foreign' });
      }
    }
    for (const args of [{ ...request, since: '2026-01-01' },
      { ...request, until: request.since },
      { ...request, until: new Date(Date.now() + 367 * 86_400_000).toISOString() }]) {
      const response = await call(cold, 'list_session_episodes', args);
      assert.equal(response.ok, false);
    }
    for (const args of [{}, { ...request, timeBasis: 'revision' }, { ...request, limit: 51 },
      { ...request, cursor: 'x'.repeat(8193) }, { ...request, since: 'x'.repeat(65) }]) {
      await invalid(cold, 'list_session_episodes', args);
    }
    fail(await call(cold, 'list_session_episodes', { ...request, client: 'other',
      cursor: pageOne.nextCursor }), 'invalid_cursor');
    await invalid(cold, 'inspect_session_episode', { episodeId: first.episode.id, sourceLimit: 0 });
    await invalid(cold, 'inspect_session_episode', { episodeId: first.episode.id, memoryLimit: 51 });
    await invalid(cold, 'inspect_session_episode', { episodeId: first.episode.id, policyCursor: '' });
    await invalid(cold, 'forget_session_episode', { episodeId: first.episode.id });
    const other = await host(workspace, path, { owner: 'another-owner' });
    assert.deepEqual(ok(await call(other, 'list_session_episodes', request)).items, []);
    fail(await call(other, 'inspect_session_episode', { episodeId: first.episode.id }), 'episode_not_found');
    fail(await call(other, 'forget_session_episode', { episodeId: first.episode.id,
      expectedRevision: firstDetail.episode.revision }), 'episode_not_found');
    fail(await call(other, 'list_session_episodes', { ...request, cursor: pageOne.nextCursor }), 'invalid_cursor');
    fail(await call(other, 'inspect_session_episode', { episodeId: first.episode.id, sourceLimit: 1,
      sourceCursor: sourceOne.sources.nextCursor }), 'invalid_cursor');
    await other.close();
    const project = await host(workspace, path, { project: 'another-project' });
    assert.deepEqual(ok(await call(project, 'list_session_episodes', request)).items, []);
    fail(await call(project, 'inspect_session_episode', { episodeId: first.episode.id }), 'episode_not_found');
    fail(await call(project, 'forget_session_episode', { episodeId: first.episode.id,
      expectedRevision: firstDetail.episode.revision }), 'episode_not_found');
    fail(await call(project, 'list_session_episodes', { ...request, cursor: pageOne.nextCursor }), 'invalid_cursor');
    fail(await call(project, 'inspect_session_episode', { episodeId: first.episode.id, sourceLimit: 1,
      sourceCursor: sourceOne.sources.nextCursor }), 'invalid_cursor');
    await project.close();
    assert.deepEqual(ok(await call(cold, 'inspect_session_episode', { episodeId: first.episode.id })), firstDetail);
    await cold.close();
  });

test('episode deletion and linked-memory correction preserve revision and source lifecycle guards',
  { timeout: 30000 }, async t => {
    const workspace = createTestWorkspace(t, { prefix: 'cairn-mcp-episode-lifecycle-' });
    const path = join(workspace.path, 'memory.sqlite');
    const warm = writer(workspace, path, { extract: ({ input }) => ({ items: input.messages
      .filter(message => /^(?:LINKED|CORRECT)_SOURCE_SENTINEL/u.test(message.content))
      .map(message => ({ content: message.content, kind: 'context', confidence: 1,
        sourceIndices: [message.index] })) }) });
    const zero = ok(await warm.core.capture(batch('zero-session', 'zero-event',
      ['ZERO_MEMORY_SOURCE_SENTINEL private synthetic passage.'])));
    assert.equal(zero.admission.memories.length, 0);
    const sharedText = 'LINKED_SOURCE_SENTINEL synthetic shared evidence.';
    const linkedA = ok(await warm.core.capture(batch('linked-session-a', 'linked-event-a', [sharedText])));
    assert.equal(linkedA.admission.memories.length, 1);
    const sharedId = linkedA.admission.memories[0].id;
    const duplicate = ok(warm.core.admit({ namespace: ns, memory: { content: sharedText, kind: 'context' },
      receipts: [{ client: 'episode-client', sessionId: 'independent-carrier', eventId: 'duplicate-carrier',
        role: 'user', excerpt: sharedText }] }));
    assert.equal(duplicate.deduplicated, true);
    assert.equal(duplicate.memory.id, sharedId);
    assert.equal(ok(warm.core.get({ namespace: ns, memoryId: sharedId })).receipts.length, 2);
    const correctedSource = 'CORRECT_SOURCE_SENTINEL synthetic old evidence.';
    const correctCase = ok(await warm.core.capture(batch('correct-session', 'correct-event',
      [correctedSource, 'Synthetic second source for stale pagination.'])));
    const correctedMemory = correctCase.admission.memories[0];
    const beforeCorrect = ok(warm.core.getEpisode({ namespace: ns, episodeId: correctCase.episode.id }));
    assert.ok(JSON.stringify(beforeCorrect).includes(correctedSource));
    warm.close();

    const cold = await host(workspace, path);
    const listRequest = { ...range(), timeBasis: 'receipt', client: 'episode-client', limit: 1 };
    const oldPage = ok(await call(cold, 'list_session_episodes', listRequest));
    assert.equal(oldPage.exhausted, false);
    const linkedDetail = ok(await call(cold, 'inspect_session_episode', { episodeId: linkedA.episode.id }));
    const oldSourcePage = ok(await call(cold, 'inspect_session_episode',
      { episodeId: correctCase.episode.id, sourceLimit: 1 }));
    assert.equal(oldSourcePage.sources.exhausted, false);
    fail(await call(cold, 'forget_session_episode', { episodeId: linkedA.episode.id,
      expectedRevision: linkedDetail.episode.revision + 1 }), 'revision_conflict');
    assert.ok(JSON.stringify(ok(await call(cold, 'inspect_session_episode',
      { episodeId: linkedA.episode.id }))).includes(sharedText));
    const forgotten = ok(await call(cold, 'forget_session_episode', { episodeId: linkedA.episode.id,
      expectedRevision: linkedDetail.episode.revision }));
    assert.equal(forgotten.forgotten, true);
    fail(await call(cold, 'list_session_episodes', { ...listRequest, cursor: oldPage.nextCursor }), 'cursor_stale');
    fail(await call(cold, 'inspect_session_episode', { episodeId: linkedA.episode.id }), 'episode_not_found');
    const zeroDetail = ok(await call(cold, 'inspect_session_episode', { episodeId: zero.episode.id }));
    assert.ok(JSON.stringify(zeroDetail).includes('ZERO_MEMORY_SOURCE_SENTINEL'));
    ok(await call(cold, 'forget_session_episode', { episodeId: zero.episode.id,
      expectedRevision: zeroDetail.episode.revision }));
    await cold.close();

    let core = openMemoryCore({ path });
    workspace.defer(() => core?.close());
    fail(core.get({ namespace: ns, memoryId: sharedId }), 'memory_not_found');
    fail(core.admit({ namespace: ns, memory: { content: sharedText, kind: 'context' },
      receipts: [{ client: 'episode-client', sessionId: 'replay', eventId: 'replay',
        role: 'user', excerpt: sharedText }] }), 'memory_suppressed');
    const corrected = ok(core.correct({ namespace: ns, memoryId: correctedMemory.id,
      expectedRevision: correctedMemory.revision, content: 'Synthetic corrected memory.', kind: 'context',
      receipt: { client: 'episode-client', sessionId: 'correction', eventId: 'correction',
        role: 'user', excerpt: 'Synthetic corrected memory.' } }));
    assert.ok(corrected.memory.revision > correctedMemory.revision);
    core.close(); core = null;

    const restarted = await host(workspace, path);
    const remaining = ok(await call(restarted, 'list_session_episodes',
      { ...range(), timeBasis: 'receipt', client: 'episode-client' }));
    assert.equal(remaining.items.some(item => item.id === zero.episode.id || item.id === linkedA.episode.id), false);
    fail(await call(restarted, 'inspect_session_episode', { episodeId: zero.episode.id }), 'episode_not_found');
    const afterCorrect = ok(await call(restarted, 'inspect_session_episode', { episodeId: correctCase.episode.id }));
    assert.equal(JSON.stringify(afterCorrect).includes(correctedSource), false);
    fail(await call(restarted, 'inspect_session_episode', { episodeId: correctCase.episode.id,
      sourceLimit: 1, sourceCursor: oldSourcePage.sources.nextCursor }), 'cursor_stale');
    await restarted.close();
  });

test('forgetting a zero-memory origin invalidates a copied-source consumer but preserves its independent memory',
  { timeout: 30000 }, async t => {
    const workspace = createTestWorkspace(t, { prefix: 'cairn-mcp-episode-copy-' });
    const path = join(workspace.path, 'memory.sqlite');
    let runtime = createMemoryRuntime({ path, sessionEpisodes: { mode: 'episode-v1' } });
    workspace.defer(() => runtime?.close());
    let db = new DatabaseSync(path); db.exec('PRAGMA foreign_keys=ON');
    workspace.defer(() => db?.close());
    let core = openMemoryCore({ path });
    workspace.defer(() => core?.close());
    const fixture = { runtime, db, core };
    const origin = storedBatch('origin', 'COPIED_SOURCE_SENTINEL synthetic source.', 'origin-session');
    const originRegistered = register(fixture, origin);
    runtime.commitEpisodeDraft(storedNs, draft(fixture, originRegistered, origin).commit);
    finish(fixture, origin);
    const originSource = ok(core.getEpisode({ namespace: storedNs, episodeId: originRegistered.episodeId })).sources.items[0];
    const consumer = storedBatch('consumer', origin.view.messages[0].content, 'consumer-session');
    const consumerRegistered = register(fixture, consumer);
    const consumerDraft = draft(fixture, consumerRegistered, consumer);
    consumerDraft.commit.sources = [{ sourceId: originSource.id }];
    runtime.commitEpisodeDraft(storedNs, consumerDraft.commit);
    const receipt = { client: consumer.client, sessionId: consumerRegistered.sessionKey,
      eventId: consumer.eventId, role: 'user', excerpt: consumer.view.messages[0].content };
    const admitted = finish(fixture, consumer, [{ content: 'Independent consumer memory', kind: 'fact',
      origin: 'agent-inferred', confidence: 0.8, fingerprint: digest('independent consumer memory'),
      receipts: [receipt], conflictHints: [] }]);
    const memoryId = admitted.memories[0].id;
    core.close(); core = null; db.close(); db = null; runtime.close(); runtime = null;

    const cold = await host(workspace, path, { owner: storedNs.ownerId, project: storedNs.projectId });
    const originBefore = ok(await call(cold, 'inspect_session_episode', { episodeId: originRegistered.episodeId }));
    const consumerBefore = ok(await call(cold, 'inspect_session_episode', { episodeId: consumerRegistered.episodeId }));
    assert.ok(consumerBefore.sources.items.length > 0);
    assert.ok(JSON.stringify(consumerBefore).includes('COPIED_SOURCE_SENTINEL'));
    ok(await call(cold, 'forget_session_episode', { episodeId: originRegistered.episodeId,
      expectedRevision: originBefore.episode.revision }));
    const consumerAfter = ok(await call(cold, 'inspect_session_episode', { episodeId: consumerRegistered.episodeId }));
    assert.equal(consumerAfter.episode.processing.state, 'invalidated');
    assert.deepEqual(consumerAfter.sources.items, []);
    assert.equal(JSON.stringify(consumerAfter).includes('COPIED_SOURCE_SENTINEL'), false);
    assert.equal(ok(await call(cold, 'inspect_memory', { memoryId })).memory.content, 'Independent consumer memory');
    await cold.close();
  });
