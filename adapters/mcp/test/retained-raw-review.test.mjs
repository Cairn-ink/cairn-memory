import assert from 'node:assert/strict';
import test from 'node:test';
import { renameSync, writeFileSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fixture, host, rawDraft, terminal, namespace, cli, cleanEnv, noNetwork, ok, call } from './retained-raw-support.mjs';

test('retained real controlling TTY confirms exact Raw-bound Card and fresh stdio preserves it', { timeout: 35000 }, async t => {
  const f = fixture(t); await f.capture(); let local = await host(f.workspace, f.profilePath);
  const { draft, sources } = await rawDraft(local.client);
  const tty = terminal(f.workspace, f.profilePath, draft, { extra: ['--applicability', 'current'] });
  const prompt = await tty.prompt; assert.match(prompt.output, /Synthetic independently authored body/); assert.match(prompt.output, /"type": "raw"/);
  tty.answer(`CONFIRM ${draft.id} ${draft.revision} APPLICABILITY current`);
  const result = await tty.done; assert.equal(result.code, 0, result.output);
  await local.client.close(); local = await host(f.workspace, f.profilePath);
  const card = ok(await call(local.client, 'inspect_private_card', { cardId: draft.id })).card;
  assert.equal(card.state, 'confirmed'); assert.equal(card.support.applicability, 'current');
  assert.deepEqual(card.bindings[0].source, { ...sources[0], namespace: f.profile.namespace });
  assert.equal(f.db.prepare('SELECT count(*) n FROM memories').get().n, 0);
});

test('retained TTY rejects wrong phrase and EOF without approving the inspected draft', { timeout: 35000 }, async t => {
  for (const eof of [false, true]) {
    const f = fixture(t); await f.capture(); const { client } = await host(f.workspace, f.profilePath);
    const { draft } = await rawDraft(client), tty = terminal(f.workspace, f.profilePath, draft);
    await tty.prompt;
    if (eof) tty.eof(); else tty.answer('CONFIRM a-different-card 1');
    const result = await tty.done; assert.equal(result.code, 1); assert.match(result.output, /Not confirmed/);
    assert.equal(ok(await call(client, 'inspect_private_card', { cardId: draft.id })).card.state, 'draft');
  }
});

test('source deletion while real TTY waits purges the draft and refuses stale confirmation', { timeout: 35000 }, async t => {
  const f = fixture(t); await f.capture(); const { client } = await host(f.workspace, f.profilePath);
  const { draft, conversationId, revision } = await rawDraft(client), tty = terminal(f.workspace, f.profilePath, draft);
  await tty.prompt;
  ok(f.core.deleteConversation({ namespace, conversationId, expectedRevision: revision, actionId: 'synthetic-delete-during-review' }));
  tty.answer(`CONFIRM ${draft.id} ${draft.revision}`);
  const result = await tty.done; assert.equal(result.code, 1); assert.match(result.output, /revision_conflict/);
  assert.equal(ok(await call(client, 'inspect_private_card', { cardId: draft.id })).card, null);
});

test('profile identity replacement while real TTY waits refuses and closes the review', { timeout: 35000 }, async t => {
  const f = fixture(t); await f.capture(); const { client } = await host(f.workspace, f.profilePath);
  const { draft } = await rawDraft(client), tty = terminal(f.workspace, f.profilePath, draft);
  await tty.prompt;
  const bytes = readFileSync(f.profilePath); renameSync(f.profilePath, f.profilePath + '.old');
  writeFileSync(f.profilePath, bytes, { mode: 0o600 });
  tty.answer(`CONFIRM ${draft.id} ${draft.revision}`);
  const result = await tty.done; assert.equal(result.code, 1); assert.match(result.output, /cairn_mcp_start_failed/);
  assert.equal(ok(await call(client, 'inspect_private_card', { cardId: draft.id })).card.state, 'draft');
});

test('cancelling a real TTY supervisor reaps its review child and permits a fresh review', { timeout: 35000 }, async t => {
  const f = fixture(t); await f.capture(); const { client } = await host(f.workspace, f.profilePath);
  const { draft } = await rawDraft(client), tty = terminal(f.workspace, f.profilePath, draft);
  await tty.prompt; tty.child.kill('SIGTERM'); await tty.closed;
  assert.notEqual(tty.child.exitCode, 0); await assert.rejects(tty.done, /PTY supervisor exit/);
  assert.equal(ok(await call(client, 'inspect_private_card', { cardId: draft.id })).card.state, 'draft');
  const next = terminal(f.workspace, f.profilePath, draft); await next.prompt; next.eof();
  assert.equal((await next.done).code, 1);
});

test('retained terminal CLI rejects pipes, approval switches and mixed configuration', t => {
  const f = fixture(t);
  const base = ['--import', noNetwork, cli, 'review-card', '--retained-raw-profile', f.profilePath, '--card', 'synthetic', '--revision', '1'];
  for (const tail of [[], ['--yes', 'true'], ['--db', f.path], ['--owner', namespace.ownerId]]) {
    const child = spawnSync(process.execPath, [...base, ...tail], { encoding: 'utf8', input: 'CONFIRM synthetic 1\n',
      env: { ...cleanEnv, CAIRN_CARD_APPROVAL: 'CONFIRM synthetic 1' }, timeout: 5000 });
    assert.equal(child.status, 1); assert.equal(child.signal, null); assert.equal(child.stdout, '');
    assert.match(child.stderr, /approval_required|cairn_mcp_start_failed/);
  }
});
