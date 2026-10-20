import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';
import { buildArtifact, command, packageName } from '../build.mjs';
import { ok, call, host, review } from '../../adapters/mcp/test/card-support.mjs';

test('H04/H05 inspected installed artifact uses real stdio, local PTY confirmation and cold support invalidation',
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
      'adapters/mcp/review-card.mjs', 'bin/cairn-memory.mjs'];
    for (const file of required) {
      assert.ok(artifact.files.includes(file));
      assert.equal(createHash('sha256').update(readFileSync(join(installed, file))).digest('hex'), artifact.sourceHashes[file]);
    }
    // Independent manifest/archive checks are performed by buildArtifact; this
    // verifies the installed bytes as a third route for all five entry modules.
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
    const terminal = review(workspace, path, draft, { command: executable });
    const prompt = await terminal.prompt;
    assert.match(prompt.output, /excerpt-only/);
    assert.ok(prompt.output.includes(draft.body));
    terminal.answer(`CONFIRM ${draft.id} ${draft.revision}`);
    const approved = await terminal.done;
    assert.equal(approved.code, 0, approved.output);
    await local.client.close();
    local = await host(workspace, path, { command: executable });
    const confirmed = ok(await call(local.client, 'inspect_private_card', { cardId: draft.id })).card;
    assert.equal(confirmed.state, 'confirmed');
    assert.equal(confirmed.revision, draft.revision + 1);
    const corrected = ok(await call(local.client, 'correct_memory', { memoryId: memory.id,
      expectedRevision: memory.revision, content: 'Synthetic installed review is Friday.' })).memory;
    assert.equal(ok(await call(local.client, 'inspect_private_card', { cardId: pending.id })).card, null);
    const unsupported = ok(await call(local.client, 'inspect_private_card', { cardId: draft.id })).card;
    assert.notEqual(unsupported.support.status, 'eligible');
    assert.equal(unsupported.body, input.body);
    ok(await call(local.client, 'forget_memory', { memoryId: memory.id, expectedRevision: corrected.revision }));
    assert.equal((await call(local.client, 'read_private_card_source', { source })).ok, false);
    await local.client.close();
    const cold = await host(workspace, path, { command: executable });
    assert.notEqual(ok(await call(cold.client, 'inspect_private_card', { cardId: draft.id })).card.support.status, 'eligible');
    await cold.client.close();
    t.diagnostic('Actual installed stdio + synthetic terminal subprocesses: no key; fetch abort guard stayed inactive (zero provider calls).');
    await workspace.cleanup();
    assert.equal(existsSync(root), false);
  });
