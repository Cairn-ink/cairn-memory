import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';
import { buildArtifact, command, packageName } from '../build.mjs';
import { ok, call, host, review } from '../../adapters/mcp/test/card-support.mjs';
import { organizeCard } from '../../adapters/mcp/test/organization-support.mjs';

test('H04/H05/R08/M06 installed stdio preserves reviewed evidence, typed organization and restart fences',
  { timeout: 120000 }, async t => {
    const workspace = createTestWorkspace(t, { prefix: 'cairn-installed-private-card-mcp-' });
    const root = workspace.path;
    const artifact = buildArtifact();
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'synthetic-card-mcp-install',
      private: true, version: '0.0.0' }), { flag: 'wx' });
    command('npm', ['install', '--prefix', root, '--offline', '--ignore-scripts', '--no-audit', '--no-fund',
      artifact.artifactPath], root, artifact.userconfig);
    const installed = join(root, 'node_modules', packageName);
    const required = ['adapters/mcp/cli.mjs', 'adapters/mcp/server.mjs', 'adapters/mcp/private-card-access.mjs',
      'adapters/mcp/review-card.mjs', 'bin/cairn-memory.mjs', 'core/private-evidence-input.mjs',
      'core/private-evidence-schema.mjs', 'core/private-evidence-storage.mjs',
      'core/private-organization-input.mjs', 'core/private-organization-schema.mjs', 'core/private-organization-storage.mjs'];
    for (const file of required) {
      assert.ok(artifact.files.includes(file));
      assert.equal(createHash('sha256').update(readFileSync(join(installed, file))).digest('hex'), artifact.sourceHashes[file]);
    }
    // Independent manifest/archive checks are performed by buildArtifact; this
    // verifies the installed bytes as a third route for the entry/runtime modules.
    t.diagnostic(`Cross-checked ${artifact.files.length} manifest/archive files; ${required.length} installed entry-module hashes.`);
    const executable = join(root, 'node_modules/.bin/cairn-memory');
    const path = join(root, 'synthetic.sqlite');
    const plain = await host(workspace, path, { command: executable, enabled: false });
    assert.equal((await plain.client.listTools()).tools.length, 5);
    await plain.client.close();
    let local = await host(workspace, path, { command: executable });
    const content = 'Synthetic installed review is Tuesday.';
    const memory = ok(await call(local.client, 'remember_memory', { content })).memory;
    const input = { title: 'Installed private plan', body: 'Review Tuesday capacity.',
      memoryRefs: [{ memoryId: memory.id, revision: memory.revision }] };
    const saved = ok(await call(local.client, 'create_private_card_draft', { ...input, actionId: 'installed-confirm' }));
    const pending = ok(await call(local.client, 'create_private_card_draft', { ...input, actionId: 'installed-cancel-on-correct' }));
    const draft = ok(await call(local.client, 'inspect_private_card', { cardId: saved.id })).card;
    assert.equal(draft.bindings[0].source.completeness, 'excerpt-only');
    const { namespace: omitted, ...source } = draft.bindings[0].source;
    assert.equal(ok(await call(local.client, 'read_private_card_source', { source })).parts.map(part => part.text).join(''), content);
    assert.equal((await call(local.client, 'confirm_private_card_draft', { cardId: draft.id,
      expectedRevision: draft.revision, actionId: 'installed-no-mcp-approval' })).error.code, 'approval_required');
    const terminal = review(workspace, path, draft, { command: executable, extra: ['--applicability', 'current'] });
    const prompt = await terminal.prompt;
    assert.match(prompt.output, /excerpt-only/);
    assert.ok(prompt.output.includes(draft.body));
    assert.match(prompt.output, /"applicability": "current"/);
    terminal.answer(`CONFIRM ${draft.id} ${draft.revision} APPLICABILITY current`);
    const approved = await terminal.done;
    assert.equal(approved.code, 0, approved.output);
    const reviewedCard = ok(await call(local.client, 'inspect_private_card', { cardId: draft.id })).card;
    const organized = await organizeCard({ client: local.client, path, memory, card: reviewedCard,
      coreModule: pathToFileURL(join(installed, 'core/index.mjs')).href });
    const request = { query: 'review', types: ['memory', 'card'], intent: 'current' };
    const selected = ok(await call(local.client, 'select_evidence', request));
    assert.deepEqual(selected.items.map(item => item.type).sort(), ['card', 'memory']);
    assert.equal(Object.hasOwn(selected.items[0], 'body'), false);
    const refs = selected.items.map(({ ref: { namespace: omitted, ...ref } }) => ref);
    const fetched = ok(await call(local.client, 'fetch_evidence', { refs, intent: 'current' }));
    assert.equal(fetched.items.find(item => item.type === 'card').body, draft.body);
    assert.equal(fetched.items.find(item => item.type === 'card').provenance.completeness, 'excerpt-only');
    assert.deepEqual(ok(await call(local.client, 'revalidate_evidence', { snapshot: fetched.snapshot })).items, fetched.items);
    await local.client.close();
    local = await host(workspace, path, { command: executable });
    const confirmed = ok(await call(local.client, 'inspect_private_card', { cardId: draft.id })).card;
    assert.equal(confirmed.state, 'confirmed');
    assert.equal(confirmed.revision, draft.revision + 1);
    assert.equal(confirmed.support.applicability, 'current');
    assert.deepEqual(ok(await call(local.client, 'revalidate_evidence', { snapshot: fetched.snapshot })).items, fetched.items);
    const restartMap = ok(await call(local.client, 'map_evidence', { type: 'card' }));
    assert.equal(restartMap.items.some(item => item.type === 'ref' && item.ref.childType === 'card' && item.ref.childId === draft.id), true);
    const restartMappings = ok(await call(local.client, 'list_evidence_mappings', { type: 'card', mocId: organized.cardTopic.mocId }));
    assert.equal(restartMappings.items[0].state, 'proposed');
    assert.equal(restartMappings.items[0].navigable, false);
    const corrected = ok(await call(local.client, 'correct_memory', { memoryId: memory.id,
      expectedRevision: memory.revision, content: 'Synthetic installed review is Friday.' })).memory;
    assert.equal(ok(await call(local.client, 'inspect_private_card', { cardId: pending.id })).card, null);
    const unsupported = ok(await call(local.client, 'inspect_private_card', { cardId: draft.id })).card;
    assert.notEqual(unsupported.support.status, 'eligible');
    assert.equal(unsupported.support.applicability, 'unknown');
    assert.equal(unsupported.support.applicabilityReviewedRevision, null);
    assert.equal(unsupported.body, input.body);
    const invalidatedMap = ok(await call(local.client, 'map_evidence', { type: 'card' }));
    assert.equal(invalidatedMap.items.some(item => item.type === 'ref' && item.ref.childType === 'card'), false);
    assert.equal(invalidatedMap.items.filter(item => item.type === 'topic').every(item => item.topic.title === null), true);
    const stale = await call(local.client, 'revalidate_evidence', { snapshot: fetched.snapshot });
    assert.equal(stale.error.code, 'snapshot_stale');
    assert.equal(Object.hasOwn(stale, 'value'), false);
    const current = ok(await call(local.client, 'select_evidence', request));
    assert.equal(current.items.some(item => item.type === 'card'), false);
    const history = ok(await call(local.client, 'select_evidence', { ...request, intent: 'history', types: ['card'] }));
    assert.equal(history.items.length, 1);
    const { namespace: omittedHistoryScope, ...historyRef } = history.items[0].ref;
    const historical = ok(await call(local.client, 'fetch_evidence', { refs: [historyRef], intent: 'history' })).items[0];
    assert.equal(historical.body, input.body);
    assert.equal(historical.support.applicability, 'unknown');
    assert.equal(historical.provenance.support, 'unavailable');
    ok(await call(local.client, 'forget_memory', { memoryId: memory.id, expectedRevision: corrected.revision }));
    assert.equal((await call(local.client, 'read_private_card_source', { source })).ok, false);
    await local.client.close();
    const cold = await host(workspace, path, { command: executable });
    assert.notEqual(ok(await call(cold.client, 'inspect_private_card', { cardId: draft.id })).card.support.status, 'eligible');
    assert.equal(ok(await call(cold.client, 'select_evidence', { ...request, types: ['card'] })).items.length, 0);
    const coldHistory = ok(await call(cold.client, 'select_evidence', { ...request, types: ['card'], intent: 'history' }));
    assert.equal(coldHistory.items.length, 1);
    assert.equal(ok(await call(cold.client, 'list_evidence_mappings', { type: 'card', mocId: organized.cardTopic.mocId })).items[0].navigable, false);
    await cold.client.close();
    t.diagnostic('Actual installed stdio + synthetic terminal subprocesses: no key; fetch abort guard stayed inactive (zero provider calls).');
    await workspace.cleanup();
    assert.equal(existsSync(root), false);
  });
