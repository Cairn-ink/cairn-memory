import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { openMemoryCore } from '../index.mjs';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';
import { admit, receipt, namespace, parity, episodeOptions, openStep } from '../testing/background-parity.mjs';
import { contextInput, contextQuery, SESSION_FRAMING, BACKGROUND_FRAMING } from '../session-context.mjs';

const ok = r => { assert.equal(r.ok, true, JSON.stringify(r)); return r.value; };
const config = { groups: { background: true }, maxChars: 8000, maxTokens: 2000,
  backgroundBudget: { maxChars: 8000, maxTokens: 2000 } };
function fixture(t, options = {}) {
  const ws = createTestWorkspace(t, { prefix: 'cf2-' });
  const path = ws.path + '/memory.sqlite';
  const core = openMemoryCore({ path, model: { countTokens: () => 1 }, ...options });
  ws.defer(() => core.close());
  const db = new DatabaseSync(path); ws.defer(() => db.close());
  return { core, db, path, ws };
}
function inferred(core, content, kind = 'fact', eventId = content) {
  const key = { namespace, client: 'synthetic', eventId, payloadDigest: 'a'.repeat(64) };
  const { token } = ok(core.claimAdmission({ ...key, leaseMs: 125000 }));
  return ok(core.finishAdmission({ ...key, token, items: [{ content, kind, confidence: 0.7, receipts: [receipt(content)] }] }));
}
const read = (core, input = config) => ok(core.sessionStartContext({ namespace, ...input }));

test('CF2 current facts and context of both origins are opt-in, sourced and framed', t => {
  const { core } = fixture(t);
  for (const kind of ['fact', 'context']) {
    admit(core, 'Explicit synthetic ' + kind, kind);
    inferred(core, 'Inferred synthetic ' + kind, kind);
  }
  const result = read(core);
  assert.equal(result.framing, BACKGROUND_FRAMING);
  assert.match(result.framing, /episodes, next steps and background may be inferred, unverified model interpretations/);
  assert.match(result.framing, /No execution permission/);
  assert.ok(BACKGROUND_FRAMING.length + ',"backgroundOmitted":true'.length <= SESSION_FRAMING.length);
  assert.equal(result.groups.background.status, 'complete');
  assert.equal(result.groups.background.returned, 4);
  for (const kind of ['fact', 'context']) for (const origin of ['explicit', 'agent-inferred']) {
    const item = result.groups.background.items.find(i => i.memory.kind === kind && i.memory.origin === origin);
    assert.ok(item); assert.equal(item.receipts.length, 1);
    assert.equal(item.receipts[0].excerpt, item.memory.content);
    assert.equal(item.semanticSupport, 'unassessed');
  }
  for (const input of [{}, { groups: { background: false } }]) {
    const off = read(core, input);
    assert.equal(off.framing, SESSION_FRAMING);
    assert.equal(Object.hasOwn(off.groups, 'background'), false);
    assert.doesNotMatch(JSON.stringify(off), /Explicit synthetic|Inferred synthetic/);
  }
});

test('CF2 owner, scope and project isolation; historical, superseded, forgotten and suppressed exclusion', t => {
  const { core, db } = fixture(t);
  const current = admit(core, 'Current synthetic fact');
  for (const ns of [{ ...namespace, ownerId: 'other' }, { ...namespace, projectId: 'other' },
    { ...namespace, scope: 'personal', projectId: null }]) admit(core, 'Foreign synthetic fact', 'fact', ns);
  const historical = admit(core, 'Historical synthetic fact');
  db.prepare("UPDATE memories SET currentness='historical' WHERE id=?").run(historical.id);
  const old = admit(core, 'Superseded synthetic fact');
  const replacement = ok(core.supersede({ namespace, memoryId: old.id, expectedRevision: old.revision,
    replacement: { content: 'Replacement synthetic fact', kind: 'fact' }, receipts: [receipt('replacement')] })).memory;
  const forgotten = admit(core, 'Forgotten synthetic fact');
  ok(core.forget({ namespace, memoryId: forgotten.id, expectedRevision: forgotten.revision }));
  assert.equal(inferred(core, 'Forgotten synthetic fact').suppressedCount, 1);
  assert.deepEqual(read(core).groups.background.items.map(i => i.memory.id).sort(), [current.id, replacement.id].sort());
});

test('CF2 awaiting is excluded with decisionReview enabled and disabled, including defensive fact filtering', t => {
  const { core, db, path, ws } = fixture(t, { decisionReview: 'required-v1' });
  inferred(core, 'Awaiting synthetic decision', 'decision');
  const waiting = ok(core.list({ namespace, reviewState: 'awaiting' })).memories[0];
  assert.equal(waiting.reviewState, 'awaiting');
  const off = openMemoryCore({ path, model: { countTokens: () => 1 } }); ws.defer(() => off.close());
  for (const opener of [core, off]) assert.equal(read(opener).groups.background.returned, 0);
  // Defensive storage regression: the visibility predicate must not rely on kind alone.
  db.prepare("UPDATE memories SET kind='fact' WHERE id=?").run(waiting.id);
  for (const opener of [core, off]) assert.equal(read(opener).groups.background.returned, 0);
});

test('CF2 ordering is updated_at descending then id ascending; bounded indexed probe and six-item truncation', t => {
  const { core, db } = fixture(t);
  for (let i = 0; i < 15; i++) admit(core, 'Synthetic fact ' + i);
  db.prepare('UPDATE memories SET updated_at=?').run('2026-01-01T00:00:00.000Z');
  const ids = db.prepare('SELECT id FROM memories ORDER BY id').all().map(r => r.id);
  db.prepare('UPDATE memories SET updated_at=? WHERE id=?').run('2026-02-01T00:00:00.000Z', ids.at(-1));
  const value = read(core).groups.background;
  assert.deepEqual(value.items.map(i => i.memory.id), [ids.at(-1), ...ids.slice(0, 5)]);
  assert.equal(value.complete, false); assert.equal(value.budget_exhausted, true);
  const { sql, params } = contextQuery(namespace, 'background');
  assert.equal(db.prepare(sql).all(...params).length, 13);
  const plan = db.prepare('EXPLAIN QUERY PLAN ' + sql).all(...params).map(r => r.detail).join('\n');
  assert.match(plan, /namespace_memories/); assert.doesNotMatch(plan, /TEMP B-TREE/);
});

test('CF2 own character and token budget boundaries are exact; other groups do not lose their budget', t => {
  const { core } = fixture(t, { model: { countTokens: s => Buffer.byteLength(s, 'utf8') } });
  admit(core, 'Synthetic instruction', 'instruction');
  admit(core, 'Synthetic 中文😀 fact');
  const full = read(core);
  const text = JSON.stringify(full.groups.background.items);
  const units = text.length, bytes = Buffer.byteLength(text, 'utf8');
  assert.ok(bytes > units);
  for (const [maxChars, maxTokens, returned] of [[units, bytes, 1], [units - 1, bytes, 0], [units, bytes - 1, 0]]) {
    const result = read(core, { ...config, backgroundBudget: { maxChars, maxTokens } });
    assert.equal(result.groups.background.returned, returned);
    assert.equal(result.groups.background.budget_exhausted, returned === 0);
    assert.deepEqual(result.groups.procedural, full.groups.procedural);
    assert.deepEqual(result.groups.nextSteps, full.groups.nextSteps);
    assert.ok(Buffer.byteLength(JSON.stringify({ ok: true, value: result }), 'utf8') <= 2000);
  }
  assert.deepEqual(read(core, { maxChars: 8000, maxTokens: 2000 }).groups.procedural, full.groups.procedural);
});

test('CF2 whole envelope budget is exact, including framing, receipts, status and UTF-8 bytes', t => {
  const { core } = fixture(t);
  admit(core, 'Synthetic 中文😀 fact');
  const full = read(core), text = JSON.stringify({ ok: true, value: full });
  assert.deepEqual(read(core, { ...config, maxChars: text.length }), full);
  const short = read(core, { ...config, maxChars: text.length - 1 });
  assert.equal(short.groups.background.returned, 0);
  assert.equal(short.groups.background.status, 'budget_exhausted');
  assert.ok(JSON.stringify({ ok: true, value: short }).length <= text.length - 1);
  assert.ok(Buffer.byteLength(text, 'utf8') <= 24000);
});

test('CF2 final reread fails closed on concurrent forgetting; retry drops the forgotten item', t => {
  let core, memory, changed = false;
  const model = { countTokens: text => {
    if (memory && !changed && text.includes('Synthetic soon forgotten')) {
      changed = true;
      ok(core.forget({ namespace, memoryId: memory.id, expectedRevision: memory.revision }));
    }
    return 1;
  } };
  ({ core } = fixture(t, { model }));
  memory = admit(core, 'Synthetic soon forgotten');
  const result = core.sessionStartContext({ namespace, ...config });
  assert.equal(changed, true); assert.equal(result.ok, false);
  assert.equal(result.error.code, 'index_revision_conflict');
  assert.doesNotMatch(JSON.stringify(result), /Synthetic soon forgotten/);
  assert.equal(read(core).groups.background.returned, 0);
});

test('CF2 final reread validates receipt bytes even without an epoch change', t => {
  let db, changed = false;
  const { core, db: database } = fixture(t, { model: { countTokens: text => {
    if (!changed && text.includes('Synthetic receipt')) {
      changed = true; db.prepare("UPDATE receipts SET excerpt='Changed evidence'").run();
    }
    return 1;
  } } });
  db = database; admit(core, 'Synthetic receipt');
  assert.equal(core.sessionStartContext({ namespace, ...config }).error.code, 'revision_conflict');
});

test('CF2 strict input and defaults', () => {
  assert.deepEqual(contextInput({ groups: { background: true } }).backgroundBudget, { maxTokens: 500, maxChars: 2000 });
  for (const input of [{ groups: { background: 1 } }, { backgroundBudget: {} }, { groups: { background: false }, backgroundBudget: {} },
    { groups: { background: true }, backgroundBudget: null },
    { groups: { background: true }, backgroundBudget: { unknown: 1 } },
    ...[0, -1, 1.5, null, 2001].map(maxTokens => ({ groups: { background: true }, backgroundBudget: { maxTokens } })),
    ...[0, null, 8001].map(maxChars => ({ groups: { background: true }, backgroundBudget: { maxChars } }))]) {
    assert.throws(() => contextInput(input), { code: 'invalid_input' });
  }
});

test('CF2 option-off success envelope bytes match frozen main fcd93ae4', async t => {
  const ws = createTestWorkspace(t, { prefix: 'cf2-parity-' });
  const fixture = JSON.parse(readFileSync(new URL('../testing/background-main-fixture.json', import.meta.url), 'utf8'));
  assert.equal(fixture.base, 'fcd93ae45b1b7c0c49c7beb0a0dd5d8e8868885c');
  assert.deepEqual(await parity(openMemoryCore, ws.path + '/memory.sqlite'), fixture.cases);
});

test('CF2 background omits cleared procedural sidecars after correction to fact', t => {
  const { core } = fixture(t);
  const content = 'Synthetic habit';
  const memory = ok(core.admit({ namespace, memory: { content, kind: 'preference' },
    receipts: [receipt(content)], procedural: { anchors: [{ receiptIndex: 0, start: 0, end: content.length }] } })).memory;
  ok(core.correct({ namespace, memoryId: memory.id, expectedRevision: memory.revision,
    content: 'Synthetic fact', kind: 'fact', receipt: receipt('Synthetic fact') }));
  assert.equal(Object.hasOwn(read(core).groups.background.items[0], 'procedural'), false);
});

test('CF2 reviewer sweep: background never reduces legacy groups or turns a budget success into failure', async t => {
  const { core } = fixture(t, episodeOptions);
  await openStep(core);
  for (let i = 0; i < 8; i++) admit(core, 'Synthetic instruction ' + i, 'instruction');
  for (let i = 0; i < 11; i++) admit(core, 'Synthetic background ' + i, i % 2 ? 'fact' : 'context');
  const full = read(core);
  assert.equal(full.groups.nextSteps.returned, 1);
  assert.equal(full.groups.procedural.returned, 6);
  let omitted = 0, truncated = 0, included = 0, successes = 0;
  for (let maxChars = 200; maxChars <= 8000; maxChars++) {
    const input = { namespace, maxChars, maxTokens: 2000 };
    const off = core.sessionStartContext(input);
    const on = core.sessionStartContext({ ...input, groups: { background: true } });
    if (!off.ok) { assert.deepEqual(on, off, `maxChars=${maxChars}`); continue; }
    successes++;
    assert.equal(on.ok, true, `maxChars=${maxChars}: ${JSON.stringify(on)}`);
    assert.deepEqual(on.value.groups.nextSteps, off.value.groups.nextSteps, `maxChars=${maxChars}`);
    assert.deepEqual(on.value.groups.procedural, off.value.groups.procedural, `maxChars=${maxChars}`);
    assert.equal(on.value.framing, BACKGROUND_FRAMING);
    const text = JSON.stringify(on);
    assert.ok(text.length <= maxChars);
    assert.ok(Math.ceil(text.length / 5) <= 2000);
    assert.ok(Buffer.byteLength(text, 'utf8') <= 24000);
    if (!on.value.groups.background) {
      omitted++; assert.equal(on.value.backgroundOmitted, true);
    } else {
      assert.equal(Object.keys(on.value.groups).at(-1), 'background');
      if (on.value.groups.background.budget_exhausted) truncated++;
      included += on.value.groups.background.returned;
    }
  }
  assert.ok(successes > 7000); assert.ok(omitted > 0); assert.ok(truncated > 0); assert.ok(included > 0);
});

test('CF2 token-budget sweep preserves existing groups with a lexical local counter', async t => {
  const { core } = fixture(t, { ...episodeOptions, model: { ...episodeOptions.model,
    countTokens: text => (text.match(/[\p{L}\p{N}]+|[^\s\p{L}\p{N}]/gu) ?? []).length } });
  await openStep(core);
  for (let i = 0; i < 8; i++) admit(core, 'Synthetic instruction ' + i, 'instruction');
  for (let i = 0; i < 11; i++) admit(core, 'Synthetic background ' + i, i % 2 ? 'fact' : 'context');
  let omissions = 0;
  for (let maxTokens = 100; maxTokens <= 2000; maxTokens++) {
    const input = { namespace, maxChars: 8000, maxTokens };
    const off = core.sessionStartContext(input);
    const on = core.sessionStartContext({ ...input, groups: { background: true } });
    if (!off.ok) { assert.deepEqual(on, off); continue; }
    assert.equal(on.ok, true, `maxTokens=${maxTokens}: ${JSON.stringify(on)}`);
    for (const name of ['nextSteps', 'procedural']) assert.deepEqual(on.value.groups[name], off.value.groups[name]);
    if (on.value.backgroundOmitted) omissions++;
    assert.ok((JSON.stringify(on).match(/[\p{L}\p{N}]+|[^\s\p{L}\p{N}]/gu) ?? []).length <= maxTokens);
  }
  assert.ok(omissions > 0);
});

test('CF2 omitted background retains both warnings and participates in the final reread', t => {
  let core, memory, forgotten = false, armed = false;
  ({ core } = fixture(t, { model: { countTokens: text => {
    if (armed && !forgotten && text.includes('"backgroundOmitted":true')) {
      forgotten = true;
      ok(core.forget({ namespace, memoryId: memory.id, expectedRevision: memory.revision }));
    }
    return 1;
  } } }));
  memory = admit(core, 'Synthetic omitted background');
  const off = read(core, {});
  let maxChars = JSON.stringify({ ok: true, value: off }).length;
  while (!core.sessionStartContext({ namespace, maxChars }).ok) maxChars++;
  const input = { namespace, maxChars, groups: { background: true } };
  const omitted = ok(core.sessionStartContext(input));
  assert.equal(omitted.backgroundOmitted, true);
  assert.equal(Object.hasOwn(omitted.groups, 'background'), false);
  assert.match(omitted.framing, /episodes, next steps and background may be inferred, unverified model interpretations/);
  assert.match(omitted.framing, /No execution permission/);
  armed = true;
  assert.equal(core.sessionStartContext(input).error.code, 'index_revision_conflict');
  assert.equal(forgotten, true);
  assert.equal(core.sessionStartContext(input).ok, true);
});
