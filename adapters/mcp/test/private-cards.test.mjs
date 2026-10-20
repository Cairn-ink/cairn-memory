import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { openMemoryCore } from '../../../core/contract.mjs';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { parseConfiguration } from '../cli.mjs';
import { createScopedCardAccess } from '../private-card-access.mjs';
import { terminalJson } from '../review-card.mjs';
import { createCairnServer } from '../server.mjs';
import { cli, namespace, ok, call, host, review } from './card-support.mjs';

const options = { timeout: 35000 };

// This setup helper represents synthetic test intent, not the deployed adapter.
function seedNote(path, { body = 'Synthetic private body', title = 'Synthetic title', sourceText = 'Synthetic source' } = {}) {
  const token = Object.freeze({}), grants = new WeakMap();
  const core = openMemoryCore({ path, privateCards: { version: 'private-cards-local-v1',
    source: 'submitted-note-v1', storage: 'local-plain-v1', disclosure: 'explicit-submitted-note-v1',
    authority: { authorize(request, received) {
      if (received !== token) return null;
      const grant = Object.freeze({}), { input, ...binding } = request;
      grants.set(grant, { ...binding, accessGeneration: 1 }); return grant;
    }, isCurrent(grant) { return grants.get(grant) ?? null; } },
  } });
  const run = (method, input) => ok(core[method]({ namespace, ...input }, token));
  const draft = run('createCardDraft', { actionId: 'seed-note-card', drafting: 'authored',
    input: { title, body, authoredInput: { text: sourceText, occurredAt: null } } });
  return { core, run, draft };
}

test('H01 local private Cards startup is strict, explicit and syntax-only', () => {
  const base = ['--db', '/synthetic-not-opened.sqlite', '--owner', namespace.ownerId];
  assert.equal(Object.hasOwn(parseConfiguration(base), 'privateCards'), false);
  assert.equal(parseConfiguration([...base, '--private-cards', 'local-v1']).privateCards, 'local-v1');
  for (const value of ['true', 'private-cards-local-v1', '']) {
    assert.throws(() => parseConfiguration([...base, '--private-cards', value]));
    assert.throws(() => createCairnServer({ path: base[1], namespace, privateCards: value }));
  }
  const result = spawnSync(process.execPath, [cli, '--check-config', ...base, '--private-cards', 'local-v1'],
    { encoding: 'utf8', env: { NODE_NO_WARNINGS: '1' } });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.privateCards, 'local-v1');
  assert.equal(report.cardConfirmation, 'separate-local-tty-required');
  assert.equal(report.databaseOpened, false);
  assert.equal(report.providerContacted, false);
});

test('H02 real stdio is default-off, bounded and never accepts serialized authority', options, async t => {
  const workspace = createTestWorkspace(t, { prefix: 'cairn-mcp-cards-' });
  const path = join(workspace.path, 'memory.sqlite');
  const plain = await host(workspace, path, { enabled: false });
  assert.equal((await plain.client.listTools()).tools.length, 5);
  await plain.client.close();
  const active = await host(workspace, path);
  const tools = (await active.client.listTools()).tools;
  assert.equal(tools.length, 21);
  const cardTools = tools.filter(tool => !['remember_memory', 'recall_memory', 'inspect_memory', 'correct_memory', 'forget_memory'].includes(tool.name));
  assert.equal(cardTools.length, 16);
  for (const tool of cardTools) {
    assert.equal(tool.inputSchema.additionalProperties, false);
    assert.equal(Object.hasOwn(tool.inputSchema.properties, 'namespace'), false);
  }
  const caps = ok(await call(active.client, 'private_card_capabilities'));
  assert.equal(caps.version, 'private-cards-local-v1');
  const args = { cardId: 'synthetic', expectedRevision: 1, actionId: 'no-tool-approval' };
  assert.equal((await call(active.client, 'confirm_private_card_draft', args)).error.code, 'approval_required');
  for (const extra of [{ humanConfirmed: true }, { role: 'user' }, { authority: {} }, { namespace }]) {
    const response = await active.client.callTool({ name: 'confirm_private_card_draft', arguments: { ...args, ...extra } });
    assert.equal(response.isError, true);
  }
  const access = createScopedCardAccess(namespace);
  const core = openMemoryCore({ path, privateCards: access.configuration });
  workspace.defer(() => core.close());
  const refused = access.call(core, 'createCardDraft', { actionId: 'no-submit-authority', drafting: 'authored',
    input: { title: 'x', body: 'x', authoredInput: { text: 'x', occurredAt: null } } });
  assert.equal(refused.error.code, 'authority_required');
  assert.equal(access.call(core, 'confirmCardDraft', { cardId: 'synthetic', expectedRevision: 1,
    actionId: 'no-explicit-authority' }).error.code, 'authority_required');
  assert.deepEqual(ok(await call(active.client, 'list_private_cards', { states: ['draft'] })).cards, []);
});

test('H03 review refuses pipes and approval switches before opening a database', () => {
  for (const extra of [[], ['--yes'], ['--yes', 'true']]) {
    const result = spawnSync(process.execPath, [cli, 'review-card', '--db', '/not-opened/review.sqlite',
      '--owner', namespace.ownerId, '--card', 'synthetic', '--revision', '1', ...extra],
    { input: 'CONFIRM synthetic 1\n', encoding: 'utf8',
      env: { NODE_NO_WARNINGS: '1', CAIRN_APPROVE: 'yes', CAIRN_CARD_APPROVAL: 'CONFIRM synthetic 1' } });
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /approval_required|cairn_mcp_start_failed/);
  }
  assert.equal(existsSync('/not-opened/review.sqlite'), false);
});

test('H02 bounded stdio note inspection, cancellation and operation replay expose no removed prose', options, async t => {
  const workspace = createTestWorkspace(t, { prefix: 'cairn-mcp-card-cancel-' });
  const path = join(workspace.path, 'memory.sqlite');
  const seeded = seedNote(path);
  seeded.core.close();
  const local = await host(workspace, path);
  const card = ok(await call(local.client, 'inspect_private_card', { cardId: seeded.draft.id })).card;
  const listed = ok(await call(local.client, 'list_private_cards', { states: ['draft'], limit: 1 }));
  assert.equal(listed.cards.length, 1);
  assert.equal(Object.hasOwn(listed.cards[0], 'body'), false);
  assert.equal(Object.hasOwn(listed.cards[0], 'title'), false);
  const { namespace: omitted, ...source } = card.bindings[0].source;
  const read = ok(await call(local.client, 'read_private_card_source', { source, limit: 1 }));
  assert.equal(read.parts.map(part => part.text).join(''), 'Synthetic source');
  const invalid = [
    ['inspect_private_card', { cardId: card.id, responseByteLimit: 65537 }],
    ['list_private_cards', { states: ['draft'], limit: 51 }],
    ['read_private_card_source', { source: { ...source, namespace } }],
    ['create_private_card_draft', { actionId: 'invalid', title: 'x', body: 'x',
      memoryRefs: [{ memoryId: 'synthetic', revision: 1, namespace }] }],
    ['create_private_card_draft', { actionId: 'invalid', title: 'x', body: 'x'.repeat(20001),
      memoryRefs: [{ memoryId: 'synthetic', revision: 1 }] }],
  ];
  for (const [name, args] of invalid) {
    assert.equal((await local.client.callTool({ name, arguments: args })).isError, true);
  }
  const input = { cardId: card.id, expectedRevision: card.revision, actionId: 'cancel-exact-draft' };
  const cancelled = ok(await call(local.client, 'cancel_private_card_draft', input));
  assert.equal(cancelled.state, 'cancelled');
  assert.deepEqual(ok(await call(local.client, 'cancel_private_card_draft', input)), cancelled);
  assert.equal(ok(await call(local.client, 'inspect_private_card', { cardId: card.id })).card, null);
  const operation = ok(await call(local.client, 'inspect_private_card_operation', { operationActionId: input.actionId }));
  assert.equal(JSON.stringify(operation).includes(card.body), false);
  const effects = ok(await call(local.client, 'list_private_card_effects', { limit: 1 }));
  assert.equal(JSON.stringify(effects).includes(card.body), false);
  const foreign = await host(workspace, path, { owner: 'synthetic-foreign-owner' });
  assert.equal(ok(await call(foreign.client, 'inspect_private_card', { cardId: card.id })).card, null);
  assert.equal((await call(foreign.client, 'read_private_card_source', { source })).ok, false);
});

test('H03 terminal display escapes ANSI, C0/C1, bidi and Unicode format controls', () => {
  const encoded = terminalJson({ text: 'fake\nApproval> \x1b[2J\x07\x85\u202e\u2066\u200b\u2028😀' });
  assert.equal(encoded.includes('\x1b'), false);
  assert.equal(encoded.includes('\x85'), false);
  assert.equal(encoded.includes('\u202e'), false);
  assert.match(encoded, /\\u001b\[2J/);
  assert.match(encoded, /\\u0085\\u202e\\u2066\\u200b\\u2028\\ud83d\\ude00/);
  assert.equal(encoded.split('\n').length, 3, 'untrusted newline remains within its JSON string');
});

test('H03 real PTY shows exact payload then requires independent typed approval; restart observes it', options, async t => {
  const workspace = createTestWorkspace(t, { prefix: 'cairn-card-review-success-' });
  const path = join(workspace.path, 'memory.sqlite');
  const seeded = seedNote(path, { body: 'Untrusted fake\nApproval> \x1b[2J\u202e body' });
  seeded.core.close();
  const local = await host(workspace, path);
  const draft = ok(await call(local.client, 'inspect_private_card', { cardId: seeded.draft.id })).card;
  const operator = review(workspace, path, draft);
  const prompt = await operator.prompt;
  assert.match(prompt.output, /untrusted data/);
  assert.match(prompt.output, /\\u001b\[2J\\u202e/);
  assert.ok(prompt.output.includes('"bindings"'));
  assert.ok(prompt.output.includes('"namespace"'));
  operator.answer(`CONFIRM ${draft.id} ${draft.revision}`);
  const completed = await operator.done;
  assert.equal(completed.code, 0, completed.output);
  assert.match(completed.output, /"state": "confirmed"/);
  await local.client.close();
  const cold = await host(workspace, path);
  const card = ok(await call(cold.client, 'inspect_private_card', { cardId: draft.id })).card;
  assert.equal(card.state, 'confirmed');
  assert.equal(card.revision, draft.revision + 1);
  assert.equal(card.body, draft.body);
  assert.equal(card.support.applicability, 'unknown');
  assert.equal(card.support.applicabilityReviewedRevision, null);
});

test('H03 wrong answer and terminal EOF never confirm; exact stale revision also refuses', options, async t => {
  const workspace = createTestWorkspace(t, { prefix: 'cairn-card-review-negative-' });
  const path = join(workspace.path, 'memory.sqlite');
  const seeded = seedNote(path);
  workspace.defer(() => seeded.core.close());
  for (const answer of ['yes', 'CONFIRM another-card 1', null]) {
    const operator = review(workspace, path, seeded.draft);
    await operator.prompt;
    if (answer === null) operator.eof(); else operator.answer(answer);
    const completed = await operator.done;
    assert.equal(completed.code, 1, completed.output);
    assert.equal(seeded.run('getCard', { cardId: seeded.draft.id }).card.state, 'draft');
  }
  const operator = review(workspace, path, { ...seeded.draft, revision: 99 });
  const result = await operator.done;
  assert.equal(result.code, 1);
  assert.match(result.output, /revision_conflict/);
});

test('H03 source invalidation while the real terminal prompt is open refuses stale confirmation', options, async t => {
  const workspace = createTestWorkspace(t, { prefix: 'cairn-card-review-stale-' });
  const path = join(workspace.path, 'memory.sqlite');
  const seeded = seedNote(path);
  workspace.defer(() => seeded.core.close());
  const card = seeded.run('getCard', { cardId: seeded.draft.id }).card;
  const operator = review(workspace, path, card);
  await operator.prompt;
  const source = card.bindings[0].source;
  seeded.run('deleteSourceNote', { sourceId: source.sourceId, expectedRevision: source.revision, actionId: 'delete-during-prompt' });
  operator.answer(`CONFIRM ${card.id} ${card.revision}`);
  const completed = await operator.done;
  assert.equal(completed.code, 1, completed.output);
  assert.match(completed.output, /revision_conflict/);
  assert.equal(seeded.run('getCard', { cardId: card.id }).card, null);
});
