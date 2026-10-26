import assert from 'node:assert/strict';
import test from 'node:test';
import { membersInput } from '../topic-members-input.mjs';
import { memberFixture, namespace, ok, sorted } from '../testing/topic-members-fixture.mjs';
import { base, previews, controlledPreviews, collectPreviews } from '../testing/topic-member-previews-fixture.mjs';
import { previewCapability } from '../topic-member-previews-text.mjs';
const fail = code => { throw Object.assign(Error(code), { code }); };

test('P1 work16 finite progress, extraction/lookahead caps, actual envelope bytes, no retained text', async t => {
  const f = memberFixture(t); for (let i = 0; i < 15; i++) { const r = f.admit('budget-' + i); f.db.prepare('UPDATE memories SET content=? WHERE id=?').run('PRIVATE_PREVIEW_SENTINEL ' + 'e\u0301👨‍👩‍👧‍👦'.repeat(50), r.id); }
  const h = controlledPreviews(f); let cursor, count = 0, empty = 0; const ids = [];
  do {
    h.reset(); const page = ok(await h.read({ workLimit: 16, limit: 3, ...(cursor ? { cursor } : {}) }));
    assert.ok(h.observations.filter(v => v.used !== undefined).every(v => v.used <= 16));
    const counters = h.observations.at(-1).preview;
    assert.ok(counters.extractions <= 3); assert.ok(counters.sourceBytes <= 36000); assert.ok(counters.decodedUnits <= 36000);
    assert.doesNotMatch(JSON.stringify(h.state), /PRIVATE_PREVIEW_SENTINEL|MEMBER_BODY_SENTINEL|"text"|"source"/);
    assert.ok(Buffer.byteLength(JSON.stringify({ ok: true, value: page })) <= 65536);
    ids.push(...page.items.map(i => i.id)); cursor = page.nextCursor; count++;
    if (!page.items.length) empty++;
    if (cursor) {
      const replay = await h.read({ workLimit: 16, limit: 3, cursor });
      assert.ok(replay.ok); // Advance once, then replay the same input below.
      assert.deepEqual(await h.read({ workLimit: 16, limit: 3, cursor }), replay);
      ids.push(...replay.value.items.map(i => i.id)); cursor = replay.value.nextCursor;
    }
    assert.ok(count < 100);
  } while (cursor);
  assert.deepEqual(ids, sorted(f.ledger).map(r => r.id)); assert.ok(empty > 0);
  const full = ok(await h.read({ limit: 2 }));
  assert.equal(full.items.length, 2); assert.equal(h.observations.at(-1).preview.extractions, 2);
  assert.equal(full.coverage.reason, 'limit');
  const small = await collectPreviews(input => h.read(input), { maxBytes: 4096 });
  assert.deepEqual(small.items.map(r => r.id), ids);
  assert.ok(small.pages.some(p => p.coverage.reason === 'byte_limit'));
});

test('P1 source rejection counters and no source for hidden/nonmember/wrong kind or lookahead', async t => {
  const f = memberFixture(t); for (let i = 0; i < 5; i++) f.admit('source-count-' + i);
  const rows = sorted(f.ledger);
  f.db.prepare('UPDATE memories SET content=? WHERE id=?').run('x'.repeat(12000), rows[0].id);
  f.db.prepare("UPDATE memories SET review_state='awaiting' WHERE id=?").run(rows[1].id);
  f.db.prepare("UPDATE memories SET kind='context' WHERE id=?").run(rows[2].id);
  const sources = [], h = controlledPreviews(f, { beforeSource(row) { sources.push(row.id); } });
  const page = ok(await h.read({ limit: 1, kind: 'fact' }));
  assert.deepEqual(sources, [rows[0].id]);
  assert.equal(page.coverage.reason, 'limit');
  const counters = h.observations.at(-1).preview;
  assert.equal(counters.decodedUnits, 12000); assert.equal(counters.normalizationUnits, 0);
  assert.equal(counters.temporaryPayloadPeak, 36000); assert.deepEqual(counters.failures, { content_limit: 1 });
});

test('P1 deterministic mutation between quanta, during transformation, before source and final delivery', async t => {
  for (const phase of ['yield', 'transform', 'source', 'final']) {
    const f = memberFixture(t); f.admit(phase); f.admit(phase + '-2');
    let armed = false, changed = false, h;
    const mutate = () => { if (armed && !changed) { changed = true; f.admit('mutation-' + phase); } };
    const support = previewCapability(), native = support.segmenter;
    support.segmenter = { segment(input) { if (phase === 'transform') mutate(); return native.segment(input); } };
    h = controlledPreviews(f, { onYield() { if (phase === 'yield') mutate(); },
      beforeSource() { if (phase === 'source' && armed && !changed) { changed = true; f.db.prepare('UPDATE memories SET revision=revision+1').run(); } },
      onFence() { if (phase === 'final' && armed && h.observations.some(o => o.preview === undefined && o.units === 3)) mutate(); },
      overrides: { capability: () => support } });
    const first = ok(await h.read({ limit: 1 })); armed = true; h.reset();
    const input = { limit: 1, cursor: first.nextCursor };
    // WAL permits the owned writer to commit while the read snapshot remains open.
    f.db.exec('PRAGMA journal_mode=WAL');
    await assert.rejects(h.read(input), { code: 'cursor_stale' }); assert.ok(changed);
  }
});

test('P1 replay regenerates bytes without advancing; busy preserves recipe, deadline discards it', async t => {
  const f = memberFixture(t); for (let i = 0; i < 4; i++) f.admit('replay-' + i);
  let busy = false, reads = 0;
  const h = controlledPreviews(f, { beforeSource() { reads++; if (busy) fail('storage_busy'); } });
  const first = ok(await h.read({ limit: 1 })), input = { limit: 1, cursor: first.nextCursor };
  const output = await h.read(input), after = reads;
  assert.equal(JSON.stringify(await h.read(input)), JSON.stringify(output)); assert.equal(reads, after + 1);
  busy = true; await assert.rejects(h.read(input), { code: 'storage_busy' }); busy = false;
  assert.deepEqual(await h.read(input), output);
  await assert.rejects(h.read(input, 99), { code: 'read_timeout' });
  await assert.rejects(h.read(input), { code: 'cursor_stale' });
});

test('P1 controlled partial/deadline, hard timeout and terminal state cap', async t => {
  const f = memberFixture(t); for (let i = 0; i < 30; i++) f.admit('clock-' + i);
  let h = controlledPreviews(f, { onYield() { h.setTime(146); } });
  const partial = ok(await h.read({}, 150)); assert.equal(partial.coverage.reason, 'deadline'); assert.ok(partial.nextCursor);
  await assert.rejects(h.read({ cursor: partial.nextCursor }, 145), { code: 'read_timeout' });
  h = controlledPreviews(f); const original = h.storage.step;
  h.storage.step = (state, ...args) => { original(state, ...args); state.overflow = 'x'.repeat(8 * 1024 * 1024); };
  const terminal = ok(await h.read()); assert.deepEqual(terminal.items, []);
  assert.deepEqual(terminal.coverage, { complete: false, reason: 'state_limit' }); assert.equal(terminal.nextCursor, null);
});

test('P1 maximal identifiers and escaped preview enforce first-item oversize without consuming input', async t => {
  const f = memberFixture(t), ns = { ownerId: '界'.repeat(200), scope: 'project', projectId: '語'.repeat(200) };
  const a = f.admit('maximal', 'fact', ns), b = f.admit('maximal-2', 'fact', ns);
  f.db.exec('PRAGMA foreign_keys=OFF');
  f.db.prepare('UPDATE memories SET id=? WHERE id=?').run('字'.repeat(200), a.id); a.id = '字'.repeat(200);
  f.db.prepare('UPDATE memories SET id=? WHERE id=?').run('文'.repeat(200), b.id); b.id = '文'.repeat(200);
  f.db.prepare('UPDATE memories SET content=? WHERE id=?').run('a' + '\u0301'.repeat(500), a.id);
  const h = controlledPreviews(f), input = membersInput({ ...base, namespace: ns, maxBytes: 4096 }, ns.ownerId);
  await assert.rejects(h.engine.read(input), { code: 'context_item_too_large' });
  const large = ok(await h.engine.read({ ...input, maxBytes: 262144 }));
  assert.equal(large.items.length, 2); assert.equal(large.coverage.complete, true);
  assert.ok([a.id, b.id].every(id => large.items.some(i => i.id === id)));
});

test('P1 origin absolute expiry and latest replay lifetime, older sequence and bound access changes', async t => {
  const f = memberFixture(t); for (let i = 0; i < 4; i++) f.admit('origin-' + i);
  const h = controlledPreviews(f), first = ok(await h.read({ limit: 1 }));
  const input = { limit: 1, cursor: first.nextCursor };
  h.setTime(60099); const second = await h.read(input); assert.ok(second.ok);
  assert.deepEqual(await h.read(input), second);
  h.setTime(60100); await assert.rejects(h.read(input), { code: 'cursor_stale' });
  const fresh = ok(await h.read({ limit: 1 }));
  assert.notEqual(fresh.snapshot.originToken, first.snapshot.originToken);
  await assert.rejects(h.read({ limit: 1, cursor: fresh.nextCursor, accessRevision: 'changed' }), { code: 'cursor_stale' });
  const newer = ok(await h.read({ limit: 1 })), next = ok(await h.read({ limit: 1, cursor: newer.nextCursor }));
  await h.read({ limit: 1, cursor: next.nextCursor });
  await assert.rejects(h.read({ limit: 1, cursor: newer.nextCursor }), { code: 'cursor_stale' });
});

test('P1 heavily escaped previews preserve full envelope bound and exact replay bytes', async t => {
  const f = memberFixture(t); for (let i = 0; i < 15; i++) {
    const row = f.admit('escaped-' + i); f.db.prepare('UPDATE memories SET content=? WHERE id=?').run('"\\\u0001'.repeat(26), row.id);
  }
  const h = controlledPreviews(f), input = { maxBytes: 4096, limit: 7 };
  const first = ok(await h.read(input)); assert.equal(first.coverage.reason, 'byte_limit');
  const continuation = { ...input, cursor: first.nextCursor }, output = await h.read(continuation);
  assert.equal(JSON.stringify(await h.read(continuation)), JSON.stringify(output));
  assert.ok(Buffer.byteLength(JSON.stringify(output)) <= 4096);
  for (const row of output.value.items) {
    assert.equal(row.preview.text, '"\\\u0001'.repeat(24)); assert.equal(row.preview.truncated, true);
    assert.equal(row.preview.text.trim(), row.preview.text);
  }
});

test('P1 a first ref fitting only at EOF checkpoints metadata before regenerating under work16', async t => {
  const f = memberFixture(t), ns = { ownerId: '界'.repeat(150), scope: 'project', projectId: '語'.repeat(150) };
  const row = f.admit('final-fitting', 'fact', ns), id = '字'.repeat(180);
  f.db.exec('PRAGMA foreign_keys=OFF');
  f.db.prepare('UPDATE memories SET id=?,content=? WHERE id=?').run(id, 'a', row.id);
  const h = controlledPreviews(f), normalized = membersInput({ ...base, namespace: ns, limit: 1, maxBytes: 262144 }, ns.ownerId);
  const probe = await h.engine.read(normalized), overhead = Buffer.byteLength(JSON.stringify(probe));
  const marks = Math.floor((4020 - overhead) / 2);
  assert.ok(marks > 0 && marks < 510, { overhead, marks });
  f.db.prepare('UPDATE memories SET content=? WHERE id=?').run('a' + '\u0301'.repeat(marks), id);
  const input = { ...normalized, maxBytes: 4096, workLimit: 16 };
  let cursor, held = false, finalInput, finalOutput; const items = [];
  for (let i = 0; i < 50; i++) {
    finalInput = { ...input, ...(cursor ? { cursor } : {}) };
    finalOutput = await h.engine.read(finalInput); const page = ok(finalOutput);
    held ||= Boolean(h.state.data.held);
    assert.ok(Buffer.byteLength(JSON.stringify(finalOutput)) <= 4096);
    items.push(...page.items); cursor = page.nextCursor;
    if (!cursor) break;
  }
  assert.equal(cursor, null); assert.ok(held); assert.equal(items.length, 1); assert.equal(items[0].id, id);
  assert.deepEqual(await h.engine.read(finalInput), finalOutput);
});
