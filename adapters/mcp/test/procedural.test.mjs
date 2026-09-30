import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { openMemoryCore } from '../../../core/contract.mjs';
import { call, episodeHost, fails, invalid, namespace, ok, workspace } from './fixtures/episode-server.mjs';

const procedural = content => ({ anchors: [{ receiptIndex: 0, start: 0, end: content.length }] });
for (const access of [false, true]) test(`explicit procedural remember with receipt anchors works with episode access ${access}`, async t => {
  const f = workspace(t), h = await episodeHost(t, f.path, { home: f.home, cli: true,
    flags: [...(access ? ['--session-episodes-access', 'episode-v1'] : []), '--client', 'synthetic-client', '--session', 'synthetic-session'] });
  const content = '請先閱讀規格 😀 before editing.';
  const memory = ok(await call(h, 'remember_memory', { content, kind: 'preference', procedural: procedural(content) })).memory;
  const inspected = ok(await call(h, 'inspect_memory', { memoryId: memory.id }));
  assert.equal(inspected.procedural.procedural, true); assert.equal(inspected.procedural.origin, 'explicit');
  assert.equal(inspected.procedural.tagRevision, 1);
  const anchor = inspected.procedural.anchors[0], receipt = inspected.receipts.find(receipt => receipt.id === anchor.receiptId);
  assert.equal(receipt.excerpt, content); assert.equal(receipt.client, 'synthetic-client'); assert.equal(receipt.sessionId, 'synthetic-session');
  assert.equal(anchor.digest, createHash('sha256').update(content).digest('hex')); assert.equal(anchor.end, content.length);
  if (access) {
    const context = ok(await call(h, 'read_session_start_context', { groups: { nextSteps: false } }));
    assert.equal(context.groups.procedural.items[0].memory.id, memory.id);
    assert.equal(context.groups.procedural.items[0].receipts[0].excerpt, content);
    assert.match(context.framing, /not execution permission/);
  }
});

test('procedural remember rejects metadata-only, foreign, oversized and split-code-point anchors without admission', async t => {
  const f = workspace(t), h = await episodeHost(t, f.path, { home: f.home });
  const content = 'Habit 😀 text';
  for (const args of [
    { content, kind: 'preference', procedural: { anchors: [] } },
    { content, kind: 'preference', procedural: { anchors: [{ receiptIndex: 1, start: 0, end: 1 }] } },
    { content, kind: 'preference', procedural: { anchors: [{ receiptIndex: 0, start: 0, end: 1, digest: 'forged' }] } },
    { content, kind: 'preference', procedural: { anchors: [{ receiptIndex: 0, start: 0, end: 1 }], origin: 'model' } },
    { content, kind: 'preference', procedural: true },
    { content, kind: 'preference', procedural: null },
  ]) await invalid(h, 'remember_memory', args);
  for (const args of [
    { content, kind: 'fact', procedural: procedural(content) },
    { content, kind: 'context', procedural: procedural(content) },
    { content, kind: 'decision', procedural: procedural(content) },
    { content, kind: 'preference', procedural: { anchors: [{ receiptIndex: 0, start: 7, end: 8 }] } },
    { content, kind: 'instruction', procedural: { anchors: [{ receiptIndex: 0, start: 0, end: 1000 }] } },
  ]) fails(await call(h, 'remember_memory', args), 'invalid_input');
  assert.deepEqual(ok(await call(h, 'inspect_memory')).memories, []);
});

test('re-remembering cannot clear a revision-guarded procedural tag from another host', async t => {
  const f = workspace(t), a = await episodeHost(t, f.path, { home: f.home }),
    b = await episodeHost(t, f.path, { home: f.home });
  const content = 'Synthetic instruction shared across hosts';
  const memory = ok(await call(a, 'remember_memory', { content, kind: 'instruction' })).memory;
  const source = ok(await call(a, 'inspect_memory', { memoryId: memory.id })).receipts[0];
  const anchor = { receiptId: source.id, digest: createHash('sha256').update(source.excerpt).digest('hex'),
    start: 0, end: source.excerpt.length };
  ok(await call(a, 'set_procedural_memory', { memoryId: memory.id, expectedRevision: memory.revision,
    expectedTagRevision: 0, procedural: { anchors: [anchor] } }));
  const tagged = ok(await call(a, 'inspect_memory', { memoryId: memory.id })).procedural;
  assert.equal(tagged.procedural, true); assert.equal(tagged.tagRevision, 1);

  await invalid(b, 'remember_memory', { content, kind: 'instruction', procedural: null });
  assert.deepEqual(ok(await call(a, 'inspect_memory', { memoryId: memory.id })).procedural, tagged);
  const remembered = ok(await call(b, 'remember_memory', { content, kind: 'instruction' })).memory;
  assert.equal(remembered.id, memory.id);
  assert.deepEqual(ok(await call(a, 'inspect_memory', { memoryId: memory.id })).procedural, tagged);
});

test('tag-only changes guard independent revisions and preserve memory content, receipts and evidence links', async t => {
  const f = workspace(t), h = await episodeHost(t, f.path, { home: f.home });
  const content = 'Synthetic standing instruction';
  const memory = ok(await call(h, 'remember_memory', { content, kind: 'instruction' })).memory;
  const core = openMemoryCore({ path: f.path });
  try { ok(core.admit({ namespace, memory: { content: 'Synthetic conflicting instruction', kind: 'instruction' },
    receipts: [{ client: 'synthetic', sessionId: 'explicit-test', eventId: 'conflicting', role: 'user', excerpt: 'Synthetic conflicting instruction' }],
    conflictHints: [{ memoryId: memory.id, expectedRevision: memory.revision, relation: 'contradicts' }] })); }
  finally { core.close(); }
  const db = new DatabaseSync(f.path); t.after(() => db.close());
  const source = ok(await call(h, 'inspect_memory', { memoryId: memory.id })).receipts[0];
  const hash = text => createHash('sha256').update(text).digest('hex');
  db.prepare(`INSERT INTO memory_qualifications(memory_id,version,bound_revision,content_digest,attribution,commitment,anchor_count)
    VALUES(?,1,?,?,'direct','adopted',1)`).run(memory.id, memory.revision, hash(content));
  db.prepare('INSERT INTO qualification_anchors VALUES(?,0,?,?,0,6,?)').run(memory.id, source.id, hash(source.excerpt), '["attribution","commitment"]');
  const boundDigest = hash(JSON.stringify({ id: source.id, role: source.role, excerpt: source.excerpt }));
  db.prepare("INSERT INTO rationale_edges VALUES(?,?,?,?,'supports-decision',?,?,?,?)")
    .run(memory.id, memory.revision, memory.id, memory.revision, source.id, source.id, boundDigest, boundDigest);
  const snapshot = () => ['memory_conflicts', 'memory_qualifications', 'qualification_anchors', 'rationale_edges']
    .map(table => db.prepare(`SELECT * FROM ${table}`).all());
  const links = snapshot(); assert.ok(links.every(rows => rows.length > 0));
  const before = ok(await call(h, 'inspect_memory', { memoryId: memory.id }));
  const receipt = before.receipts[0], anchor = { receiptId: receipt.id, digest: createHash('sha256').update(receipt.excerpt).digest('hex'), start: 0, end: receipt.excerpt.length };
  const args = { memoryId: memory.id, expectedRevision: memory.revision, expectedTagRevision: 0, procedural: { anchors: [anchor] } };
  ok(await call(h, 'set_procedural_memory', args));
  fails(await call(h, 'set_procedural_memory', args), 'revision_conflict');
  await invalid(h, 'set_procedural_memory', { ...args, expectedTagRevision: 1, namespace: 'forged' });
  const tagged = ok(await call(h, 'inspect_memory', { memoryId: memory.id }));
  assert.deepEqual(snapshot(), links);
  assert.deepEqual(tagged.memory, before.memory); assert.deepEqual(tagged.receipts, before.receipts);
  for (const key of ['placements', 'conflicts', 'qualification', 'rationale']) assert.deepEqual(tagged[key], before[key]);
  ok(await call(h, 'set_procedural_memory', { ...args, expectedTagRevision: 1, procedural: null }));
  const cleared = ok(await call(h, 'inspect_memory', { memoryId: memory.id }));
  assert.equal(cleared.procedural.procedural, false); assert.equal(cleared.procedural.tagRevision, 2);
  assert.equal(cleared.memory.revision, memory.revision);
});

test('startup procedural group stops at an oversized whole sourced item and reports budget markers', async t => {
  const f = workspace(t), h = await episodeHost(t, f.path, { home: f.home });
  const content = '中'.repeat(580);
  ok(await call(h, 'remember_memory', { content, kind: 'preference', procedural: procedural(content) }));
  const context = ok(await call(h, 'read_session_start_context', { groups: { nextSteps: false }, maxChars: 1000, maxTokens: 2000 }));
  assert.equal(context.groups.procedural.returned, 0); assert.equal(context.groups.procedural.complete, false);
  assert.equal(context.groups.procedural.budget_exhausted, true); assert.equal(context.groups.procedural.status, 'budget_exhausted');
  assert.equal(h.stderr().includes('forbidden_model_call'), false);
});
