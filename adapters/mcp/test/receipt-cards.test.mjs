import assert from 'node:assert/strict';
import { join } from 'node:path';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { STORAGE_BUSY_TIMEOUT_MS } from '../../../core/database.mjs';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { ok, call, host, review } from './card-support.mjs';

test('H02/H04 receipt-backed stdio drafts, local review, restart, correction and forgetting use canonical support',
  { timeout: 35000 }, async t => {
    const workspace = createTestWorkspace(t, { prefix: 'cairn-mcp-receipt-cards-' });
    const path = join(workspace.path, 'memory.sqlite');
    let local = await host(workspace, path);
    const content = 'Synthetic review is Tuesday.';
    const memory = ok(await call(local.client, 'remember_memory', { content })).memory;
    const input = { title: 'Review plan', body: 'Check Tuesday availability.',
      memoryRefs: [{ memoryId: memory.id, revision: memory.revision }] };
    const saved = ok(await call(local.client, 'create_private_card_draft', { ...input, actionId: 'confirm-me' }));
    const draft = ok(await call(local.client, 'inspect_private_card', { cardId: saved.id })).card;
    assert.equal(draft.bindings[0].source.type, 'receipt');
    assert.equal(draft.bindings[0].source.completeness, 'excerpt-only');
    const { namespace: omitted, ...source } = draft.bindings[0].source;
    const retained = ok(await call(local.client, 'read_private_card_source', { source }));
    assert.equal(retained.parts.map(part => part.text).join(''), content);
    assert.equal(retained.coverage.conversationCoverage, 'unknown');
    const cancelled = ok(await call(local.client, 'create_private_card_draft', { ...input, actionId: 'cancel-on-correction' }));
    assert.equal((await call(local.client, 'confirm_private_card_draft', { cardId: draft.id,
      expectedRevision: draft.revision, actionId: 'cannot-confirm-mcp' })).error.code, 'approval_required');
    const operator = review(workspace, path, draft);
    const prompt = await operator.prompt;
    assert.match(prompt.output, /excerpt-only/);
    operator.answer(`CONFIRM ${draft.id} ${draft.revision}`);
    const reviewed = await operator.done;
    assert.equal(reviewed.code, 0, reviewed.output);
    await local.client.close();
    local = await host(workspace, path);
    assert.equal(ok(await call(local.client, 'inspect_private_card', { cardId: draft.id })).card.state, 'confirmed');
    const corrected = ok(await call(local.client, 'correct_memory', { memoryId: memory.id,
      expectedRevision: memory.revision, content: 'Synthetic review is Friday.' })).memory;
    assert.equal(ok(await call(local.client, 'inspect_private_card', { cardId: cancelled.id })).card, null);
    const unsupported = ok(await call(local.client, 'inspect_private_card', { cardId: draft.id })).card;
    assert.equal(unsupported, null);
    const db = new DatabaseSync(path, { readOnly: true, timeout: STORAGE_BUSY_TIMEOUT_MS });
    try { assert.equal(db.prepare('SELECT body FROM private_cards WHERE id=?').get(draft.id).body, input.body); }
    finally { db.close(); }
    ok(await call(local.client, 'forget_memory', { memoryId: memory.id, expectedRevision: corrected.revision }));
    assert.equal((await call(local.client, 'read_private_card_source', { source })).ok, false);
    const effects = ok(await call(local.client, 'list_private_card_effects'));
    assert.ok(effects.effects.length > 0);
    assert.equal(JSON.stringify(effects).includes(content), false);
    const foreign = await host(workspace, path, { owner: 'synthetic-other-owner' });
    assert.equal(ok(await call(foreign.client, 'inspect_private_card', { cardId: draft.id })).card, null);
    assert.equal((await call(foreign.client, 'read_private_card_source', { source })).ok, false);
  });

test('H03 correcting a supporting Memory during terminal review refuses the inspected draft',
  { timeout: 35000 }, async t => {
    const workspace = createTestWorkspace(t, { prefix: 'cairn-card-review-receipt-stale-' });
    const path = join(workspace.path, 'memory.sqlite');
    const local = await host(workspace, path);
    const memory = ok(await call(local.client, 'remember_memory', { content: 'Synthetic source before review' })).memory;
    const draft = ok(await call(local.client, 'create_private_card_draft', { title: 'Synthetic', body: 'Synthetic',
      memoryRefs: [{ memoryId: memory.id, revision: memory.revision }], actionId: 'stale-at-prompt' }));
    const operator = review(workspace, path, draft);
    await operator.prompt;
    ok(await call(local.client, 'correct_memory', { memoryId: memory.id,
      expectedRevision: memory.revision, content: 'Synthetic source changed during review' }));
    operator.answer(`CONFIRM ${draft.id} ${draft.revision}`);
    const completed = await operator.done;
    assert.equal(completed.code, 1, completed.output);
    assert.match(completed.output, /revision_conflict/);
    assert.equal(ok(await call(local.client, 'inspect_private_card', { cardId: draft.id })).card, null);
  });
