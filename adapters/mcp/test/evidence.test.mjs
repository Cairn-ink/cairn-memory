import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import test from 'node:test';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { cli, namespace, ok, call, host, review } from './card-support.mjs';

const options = { timeout: 35000 };

test('R01/R03/R05/R06 stdio common reads enforce exact scope, strict bounds and opaque snapshots', options, async t => {
  const workspace = createTestWorkspace(t, { prefix: 'cairn-mcp-evidence-' });
  const path = join(workspace.path, 'memory.sqlite');
  const local = await host(workspace, path);
  const memory = ok(await call(local.client, 'remember_memory', { content: 'Synthetic evidence review' })).memory;
  const request = { query: 'review', types: ['memory', 'card'], intent: 'current' };
  const selected = ok(await call(local.client, 'select_evidence', request));
  assert.deepEqual(selected.items.map(item => item.type), ['memory']);
  assert.equal(selected.coverage.ranking, 'literal-unicode-word-overlap');
  assert.equal(Object.hasOwn(selected.items[0], 'content'), false);
  const ref = { type: 'memory', memoryId: memory.id, revision: memory.revision };
  const fetched = ok(await call(local.client, 'fetch_evidence', { refs: [ref], intent: 'current' }));
  assert.equal(fetched.items[0].content, 'Synthetic evidence review');
  assert.equal(fetched.items[0].provenance.completeness, 'excerpt-only');
  assert.equal(fetched.items[0].provenance.meaning, 'unassessed');
  assert.equal(fetched.items[0].provenance.conversationCoverage, 'unknown');
  assert.equal(Object.hasOwn(fetched.items[0].provenance.sources[0], 'excerpt'), false);
  assert.deepEqual(ok(await call(local.client, 'revalidate_evidence', { snapshot: fetched.snapshot })).items, fetched.items);
  const oversized = await call(local.client, 'fetch_evidence', { refs: [ref], intent: 'current', responseByteLimit: 1 });
  assert.equal(oversized.error.code, 'context_item_too_large');
  assert.equal(Object.hasOwn(oversized, 'value'), false);
  const invalid = [
    ['select_evidence', { ...request, namespace }],
    ['select_evidence', { ...request, query: 'x'.repeat(4001) }],
    ['select_evidence', { ...request, limit: 25 }],
    ['select_evidence', { ...request, scanRows: 1025 }],
    ['select_evidence', { ...request, scanBodyUnits: 2000001 }],
    ['select_evidence', { ...request, deadlineMs: 5001 }],
    ['fetch_evidence', { refs: [{ ...ref, namespace }], intent: 'current' }],
    ['fetch_evidence', { refs: [ref], intent: 'current', authority: { role: 'user' } }],
    ['revalidate_evidence', { snapshot: fetched.snapshot, humanConfirmed: true }],
  ];
  for (const [name, args] of invalid) {
    assert.equal((await local.client.callTool({ name, arguments: args })).isError, true);
  }
  assert.equal((await call(local.client, 'revalidate_evidence', { snapshot: `${fetched.snapshot}x` })).error.code, 'invalid_snapshot');
  const foreign = await host(workspace, path, { owner: 'synthetic-foreign' });
  assert.equal((await call(foreign.client, 'revalidate_evidence', { snapshot: fetched.snapshot })).error.code, 'invalid_snapshot');
  assert.equal((await call(foreign.client, 'fetch_evidence', { refs: [ref], intent: 'history' })).error.code, 'evidence_unavailable');
  ok(await call(local.client, 'correct_memory', { memoryId: memory.id, expectedRevision: memory.revision,
    content: 'Synthetic evidence corrected' }));
  const stale = await call(local.client, 'revalidate_evidence', { snapshot: fetched.snapshot });
  assert.equal(stale.error.code, 'snapshot_stale');
  assert.equal(Object.hasOwn(stale, 'value'), false);
});

test('R02 real terminal binds each applicability choice; a generic phrase cannot approve current', options, async t => {
  const workspace = createTestWorkspace(t, { prefix: 'cairn-card-applicability-' });
  const path = join(workspace.path, 'memory.sqlite');
  const local = await host(workspace, path);
  const memory = ok(await call(local.client, 'remember_memory', { content: 'Synthetic review evidence' })).memory;
  for (const applicability of ['current', 'historical', 'conflict', 'unknown']) {
    const draft = ok(await call(local.client, 'create_private_card_draft', { actionId: `draft-${applicability}`,
      title: 'Review', body: `Synthetic ${applicability} review`, memoryRefs: [{ memoryId: memory.id, revision: memory.revision }] }));
    const extra = ['--applicability', applicability];
    if (applicability === 'current') {
      const generic = review(workspace, path, draft, { extra });
      await generic.prompt;
      generic.answer(`CONFIRM ${draft.id} ${draft.revision}`);
      assert.equal((await generic.done).code, 1);
      assert.equal(ok(await call(local.client, 'inspect_private_card', { cardId: draft.id })).card.state, 'draft');
    }
    const operator = review(workspace, path, draft, { extra });
    const prompt = await operator.prompt;
    assert.ok(prompt.output.includes(`"applicability": "${applicability}"`));
    assert.match(prompt.output, /"explicitlySelected": true/);
    operator.answer(`CONFIRM ${draft.id} ${draft.revision} APPLICABILITY ${applicability}`);
    const result = await operator.done;
    assert.equal(result.code, 0, result.output);
    const card = ok(await call(local.client, 'inspect_private_card', { cardId: draft.id })).card;
    assert.equal(card.support.applicability, applicability);
    assert.equal(card.support.applicabilityReviewedRevision, card.revision);
    assert.equal((await local.client.callTool({ name: 'confirm_private_card_draft', arguments: {
      cardId: draft.id, expectedRevision: card.revision, actionId: 'model-cannot-review', applicability } })).isError, true);
  }
  const current = ok(await call(local.client, 'select_evidence', { query: 'review', types: ['card'], intent: 'current' }));
  assert.equal(current.items.length, 1);
  assert.equal(current.items[0].support.applicability, 'current');
  const history = ok(await call(local.client, 'select_evidence', { query: 'review', types: ['card'], intent: 'history' }));
  assert.equal(history.items.length, 4);
});

test('R02 invalid review applicability is rejected without a terminal or database access', () => {
  for (const extra of [['--applicability', 'truth'], ['--applicability'], ['--applicability', 'CURRENT'],
    ['--applicability', 'current', '--applicability', 'current']]) {
    const result = spawnSync(process.execPath, [cli, 'review-card', '--db', '/not-opened/review.sqlite',
      '--owner', namespace.ownerId, '--card', 'synthetic', '--revision', '1', ...extra],
    { encoding: 'utf8', env: { NODE_NO_WARNINGS: '1' } });
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /cairn_mcp_start_failed/);
  }
});
