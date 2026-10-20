import assert from 'node:assert/strict';
import { join } from 'node:path';
import test from 'node:test';
import { openMemoryCore } from '../../../core/contract.mjs';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { createScopedCardAccess } from '../private-card-access.mjs';
import { namespace, ok, call, host, review } from './card-support.mjs';
import { organizeCard } from './organization-support.mjs';

test('M01–M06 real stdio typed organization preserves canonical retrieval and never grants mapping activation',
  { timeout: 35000 }, async t => {
    const workspace = createTestWorkspace(t, { prefix: 'cairn-mcp-organization-' });
    const path = join(workspace.path, 'memory.sqlite');
    let local = await host(workspace, path);
    const memory = ok(await call(local.client, 'remember_memory', { content: 'Synthetic review source' })).memory;
    const draft = ok(await call(local.client, 'create_private_card_draft', { actionId: 'organization-card',
      title: 'Review', body: 'Synthetic review Card', memoryRefs: [{ memoryId: memory.id, revision: memory.revision }] }));
    const operator = review(workspace, path, draft, { extra: ['--applicability', 'current'] });
    await operator.prompt;
    operator.answer(`CONFIRM ${draft.id} ${draft.revision} APPLICABILITY current`);
    assert.equal((await operator.done).code, 0);
    const card = ok(await call(local.client, 'inspect_private_card', { cardId: draft.id })).card;
    const organized = await organizeCard({ client: local.client, path, memory, card });
    for (const [name, input] of [
      ['map_evidence', { type: 'card', namespace }],
      ['map_evidence', { type: 'raw' }],
      ['map_evidence', { type: 'card', parentRef: { mocId: organized.cardTopic.mocId, revision: 1, namespace } }],
      ['list_evidence_mappings', { type: 'card', mocId: organized.cardTopic.mocId, limit: 51 }],
      ['propose_evidence_mapping', { actionId: 'forged-approval', ...organized.endpoints, authority: { humanConfirmed: true } }],
    ]) assert.equal((await local.client.callTool({ name, arguments: input })).isError, true);
    const access = createScopedCardAccess(namespace), core = openMemoryCore({ path, privateCards: access.configuration });
    try {
      assert.equal(access.call(core, 'reviewEvidenceMapping', { actionId: 'cannot-activate', mappingId: organized.proposed.id,
        expectedRevision: organized.proposed.revision, state: 'active', ...organized.endpoints }).error.code, 'authority_required');
    } finally { core.close(); }
    const foreign = await host(workspace, path, { owner: 'synthetic-other-owner' });
    assert.deepEqual(ok(await call(foreign.client, 'map_evidence', { type: 'card' })).items, []);
    assert.deepEqual(ok(await call(foreign.client, 'list_evidence_mappings', { type: 'card', mocId: organized.cardTopic.mocId })).items, []);
    const foreignProposal = await call(foreign.client, 'propose_evidence_mapping', { actionId: 'foreign-proposal', ...organized.endpoints });
    assert.equal(foreignProposal.ok, false);
    const first = ok(await call(local.client, 'map_evidence', { type: 'card', limit: 1 }));
    assert.equal(first.coverage.partial, true);
    assert.equal((await call(local.client, 'map_evidence', { type: 'memory', limit: 1, cursor: first.nextCursor })).error.code, 'invalid_cursor');
    await local.client.close();
    local = await host(workspace, path);
    assert.equal(ok(await call(local.client, 'list_evidence_mappings', { type: 'card', mocId: organized.cardTopic.mocId })).items[0].state, 'proposed');
    assert.equal(ok(await call(local.client, 'map_evidence', { type: 'card' })).items.some(item => item.type === 'ref' && item.ref.childType === 'card'), true);
    ok(await call(local.client, 'correct_memory', { memoryId: memory.id, expectedRevision: memory.revision, content: 'Changed review source' }));
    const stale = ok(await call(local.client, 'map_evidence', { type: 'card' }));
    assert.equal(stale.items.some(item => item.type === 'ref' && item.ref.childType === 'card'), false);
    assert.equal(stale.items.filter(item => item.type === 'topic').every(item => item.topic.title === null), true);
    assert.equal(ok(await call(local.client, 'list_evidence_mappings', { type: 'card', mocId: organized.cardTopic.mocId })).items[0].navigable, false);
    const history = ok(await call(local.client, 'select_evidence', { query: 'review', types: ['card'], intent: 'history' }));
    assert.equal(history.items.length, 1);
  });
