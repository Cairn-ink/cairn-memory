import test from 'node:test';
import assert from 'node:assert/strict';
import { compareWideTraces, assertWidePins, summary, ledgerAdditionSummary, compareWideTables,
  currentReceiptWalkSQLTexts, reconstructWideTrace, currentAdditionSummary, validateSqlAdditions, hash } from '../testing/card-lineage-off-wide-compare.mjs';

const row = (sql, method = 'exec', bindings = []) => [sql, method, bindings];
const ns = ['synthetic-owner', 'personal', ''];
const tombstone = row('UPDATE memories SET content = NULL, deleted = 1, revision = revision + 1, updated_at = ? WHERE id = ?',
  'run', ['2026-01-01T00:00:00.000Z', 'synthetic-memory']);
const additions = [
  row("SELECT 1 FROM sqlite_master WHERE type='table' AND name='card_memory_bindings'", 'get'),
  row("SELECT c.* FROM private_cards c JOIN card_operations o ON o.target_id=c.id WHERE c.owner_id=? AND c.scope=? AND c.project_id=? AND o.method='consolidate' AND json_extract(o.result,'$.origin')='engine' AND EXISTS(SELECT 1 FROM card_memory_bindings b WHERE b.card_id=c.id AND b.memory_id=?)", 'all', [...ns, 'synthetic-memory']),
  row("SELECT 1 FROM sqlite_master WHERE type='table' AND name='card_operations'", 'get'),
  row("DELETE FROM card_operations WHERE owner_id=? AND scope=? AND project_id=? AND method IN ('consolidateAttempt','consolidateOutcome') AND target_id=?", 'run', [...ns, 'synthetic-memory']),
];
const refusal = { ok: false, error: { code: 'revision_conflict' } }, success = { ok: true, value: { forgotten: true } };
const forgetRows = [row('BEGIN IMMEDIATE'), row('SELECT authorization', 'get', ns), row('SELECT suppression', 'get', ns),
  row('SELECT fence', 'get', ns), tombstone, row('DELETE FROM receipts WHERE memory_id = ?', 'run', ['synthetic-memory']), row('COMMIT')];
function trace(parts) {
  const statements = [row('PRAGMA user_version', 'get')], calls = [['open', true, 1]];
  for (const [method, result, rows] of parts) {
    const start = statements.length; statements.push(...structuredClone(rows));
    calls.push([method, result, start, statements.length]);
  }
  calls.push(['modelCalls', []]); statements.push(row('PRAGMA optimize'));
  return { calls, statements, dump: [['memories', ['{"id":"synthetic-memory","deleted":1}']]], effectWitnesses: [] };
}
function fixture(receiptWalk = false) {
  const key = receiptWalk ? 'workload:52' : 'workload:23';
  const receipt = row([...currentReceiptWalkSQLTexts][0], 'all', [...ns, 0, 10]);
  const parts = [
    ['forget', refusal, [row('BEGIN IMMEDIATE'), row('SELECT authorization', 'get', ns), row('ROLLBACK')]],
    ['read', { ok: true }, [row('SELECT id FROM memories', 'all'), ...(receiptWalk ? [receipt] : [])]],
    ['forget', success, [...forgetRows.slice(0, 4), ...additions, ...forgetRows.slice(4)]],
  ];
  const oldParts = structuredClone(parts); oldParts[2][2] = forgetRows;
  if (receiptWalk) oldParts[1][2].push(receipt);
  const sqlAdditions = additions.map(statement => ({ key, method: 'forget', ordinal: 2, after: 3, statement: structuredClone(statement),
    reference: 616, reason: 'Erase engine Card content and bookkeeping when its source is forgotten.' }));
  return { key, receiptWalk, archived: trace(oldParts), current: trace(parts), sqlAdditions, sqlAdditionMethods: ['forget'], parts };
}
const compare = f => compareWideTraces(f);
const pinned = f => ({ ...summary(f.current), sqlAdditions: ledgerAdditionSummary(f.key, f.sqlAdditions, f.sqlAdditionMethods) });

function cascadeFixture(receiptWalk) {
  const f = fixture(receiptWalk);
  const second = rows => rows.map(([sql, method, bindings]) => [sql, method,
    bindings.map(value => value === 'synthetic-memory' ? 'synthetic-second-memory' : value)]);
  // One transaction, two terminal Memories, two distinct archived anchors.
  // Successful probes have already been memoized by the earlier forget.
  const cached = [additions[1], additions[3]], nextRows = second(forgetRows), nextAdditions = second(cached);
  const oldRows = [...forgetRows.slice(0, -1), ...nextRows.slice(1)];
  const newRows = [...forgetRows.slice(0, 4), ...cached, ...forgetRows.slice(4, -1),
    ...nextRows.slice(1, 4), ...nextAdditions, ...nextRows.slice(4)];
  const refused = ['deleteConversation', refusal, [row('BEGIN IMMEDIATE'), row('ROLLBACK')]];
  const oldParts = structuredClone(f.parts); oldParts[2][2] = forgetRows;
  if (receiptWalk) oldParts[1][2].push(oldParts[1][2].at(-1));
  oldParts.push(refused, ['deleteConversation', success, oldRows]);
  f.parts.push(refused, ['deleteConversation', success, newRows]);
  f.archived = trace(oldParts); f.current = trace(f.parts);
  f.sqlAdditionMethods.push('deleteConversation');
  for (const [after, rows] of [[3, cached], [8, nextAdditions]])
    f.sqlAdditions.push(...rows.map(statement => ({ key: f.key, method: 'deleteConversation', ordinal: 2, after,
      statement: structuredClone(statement), reference: 616,
      reason: 'Erase engine Card content and bookkeeping when its source is forgotten.' })));
  return f;
}

for (const receiptWalk of [false, true]) {
  const mode = receiptWalk ? 'receipt walk' : 'exact trace';
  test(`${mode}: exactly the ledger reconstructs the current trace`, () => compare(fixture(receiptWalk)));
  test(`${mode}: an empty ledger accepts identical traces`, () => {
    const f = fixture(receiptWalk); f.current = structuredClone(f.archived); f.sqlAdditions = []; f.sqlAdditionMethods = []; compare(f);
  });
  const mutations = {
    'an extra statement on forget beyond the ledger': f => f.parts[2][2].splice(8, 0, row('SELECT unexpected', 'get')),
    'an extra statement on another operation': f => f.parts[1][2].push(row('SELECT unexpected', 'get')),
    'a dropped purge statement': f => f.parts[2][2].splice(7, 1),
    'a purge on a refused forget without an anchor': f => f.parts[0][2].splice(2, 0, ...additions),
    'the purge moved before the fence': f => {
      const moved = f.parts[2][2].splice(4, additions.length); f.parts[2][2].splice(2, 0, ...moved);
    },
    'a wrong Memory binding': f => { f.parts[2][2][7][2][3] = 'synthetic-other-memory'; },
    'a wrong Memory binding in the body lookup': f => { f.parts[2][2][5][2][3] = 'synthetic-other-memory'; },
    'a wrong namespace binding in the body lookup': f => { f.parts[2][2][5][2][0] = 'synthetic-other-owner'; },
    'a wrong owner binding': f => { f.parts[2][2][7][2][0] = 'synthetic-other-owner'; },
    'a wrong scope binding': f => { f.parts[2][2][7][2][1] = 'project'; },
    'a wrong project binding': f => { f.parts[2][2][7][2][2] = 'synthetic-other-project'; },
    'an unused ledger entry': f => f.sqlAdditions.push({ ...structuredClone(f.sqlAdditions[0]), ordinal: 3 }),
    'an anchor that does not exist': f => { f.sqlAdditions[0].after = 100; },
    'a ledger anchor moved before the fence': f => { f.sqlAdditions[0].after = 1; },
    'a ledger entry on a refused forget': f => { f.sqlAdditions[0].ordinal = 1; },
    'a changed result': f => { f.parts[2][1] = { ok: true, value: { forgotten: false } }; },
  };
  for (const [name, mutate] of Object.entries(mutations)) test(`${mode}: rejects ${name}`, () => {
    const f = fixture(receiptWalk); f.parts = structuredClone(f.parts);
    mutate(f); f.current = trace(f.parts);
    assert.throws(() => compare(f), { code: 'ERR_ASSERTION' });
  });
  test(`${mode}: table deletion requires an explicit row ledger`, () => {
    const f = fixture(receiptWalk); f.current.dump[0][1] = [];
    assert.throws(() => compare(f), { code: 'ERR_ASSERTION' });
  });
  test(`${mode}: table additions and changed effect witnesses remain strict`, () => {
    const f = fixture(receiptWalk); f.current.dump[0][1].push('{"id":"synthetic-extra"}');
    assert.throws(() => compare(f), { code: 'ERR_ASSERTION' });
    f.current.dump = structuredClone(f.archived.dump); f.current.effectWitnesses.push({ effect_id: 'synthetic-extra' });
    assert.throws(() => compare(f), { code: 'ERR_ASSERTION' });
  });
  test(`${mode}: deleteConversation additions match exactly across a multi-Memory cascade`, () => {
    const f = cascadeFixture(receiptWalk); compare(f);
    assertWidePins(f.key, f.current, f.sqlAdditions, pinned(f), f.sqlAdditionMethods);
    const call = pinned(f).sqlAdditions.calls.find(call => call.method === 'deleteConversation');
    assert.equal(call.ordinal, 2); assert.equal(call.statements.length, 4);
  });
  for (const [name, mutate] of Object.entries({
    'deleteConversation additions attributed to the wrong method': f => { f.sqlAdditions[4].method = 'forget'; },
    'deleteConversation additions attributed to the wrong ordinal': f => { f.sqlAdditions[4].ordinal = 1; },
    'a multi-Memory cascade with one insertion point missing': f => { f.sqlAdditions.splice(6, 2); },
    'purge SQL in a call whose method is not reviewed': f => { f.parts[1][2].push(structuredClone(additions[3])); },
    'purge SQL in an unlisted forgetting method': f => {
      f.parts[1][0] = 'forgetEpisode'; f.parts[1][2].push(structuredClone(additions[3]));
    },
  })) test(`${mode}: rejects ${name}`, () => {
    const f = cascadeFixture(receiptWalk); f.parts = structuredClone(f.parts);
    mutate(f); f.current = trace(f.parts);
    assert.throws(() => compare(f), { code: 'ERR_ASSERTION' });
    assert.throws(() => assertWidePins(f.key, f.current, f.sqlAdditions, pinned(f), f.sqlAdditionMethods), { code: 'ERR_ASSERTION' });
  });
}

for (const method of ['forgetEpisode', 'reject']) test(`reviewed call methods are data: ${method} reconstructs exactly when listed`, () => {
  const f = fixture();
  for (const part of f.parts) if (part[0] === 'forget') part[0] = method;
  for (const call of f.archived.calls) if (call[0] === 'forget') call[0] = method;
  for (const entry of f.sqlAdditions) entry.method = method;
  f.sqlAdditionMethods = [method]; f.current = trace(f.parts);
  compare(f); assertWidePins(f.key, f.current, f.sqlAdditions, pinned(f), f.sqlAdditionMethods);
});

test('pins mode: explicit addition summaries match the ledger and the current trace', () => {
  const f = fixture(); assertWidePins(f.key, f.current, f.sqlAdditions, pinned(f), f.sqlAdditionMethods);
  assert.equal(pinned(f).sqlAdditions.callCount, 1);
  assert.equal(pinned(f).sqlAdditions.calls[0].statements.length, 4);
});
test('pins mode: an empty ledger accepts identical traces with legacy pins', () => {
  const f = fixture(); f.current = structuredClone(f.archived); f.sqlAdditions = []; f.sqlAdditionMethods = [];
  assertWidePins(f.key, f.current, f.sqlAdditions, summary(f.current), f.sqlAdditionMethods);
});
for (const mutation of ['extra', 'extra with changed SQL', 'dropped', 'other operation', 'binding', 'unused entry'])
  test(`pins mode: rejects ${mutation} even with re-derived general hashes`, () => {
    const f = fixture(); f.parts = structuredClone(f.parts);
    if (mutation === 'extra') f.parts[2][2].splice(4, 0, additions[3]);
    if (mutation === 'extra with changed SQL') f.parts[2][2].splice(4, 0,
      [additions[3][0].replace('owner_id=?', 'owner_id = ?'), additions[3][1], additions[3][2]]);
    if (mutation === 'dropped') f.parts[2][2].splice(7, 1);
    if (mutation === 'other operation') f.parts[1][2].push(additions[3]);
    if (mutation === 'binding') f.parts[2][2][7][2][3] = 'synthetic-other-memory';
    if (mutation === 'unused entry') f.sqlAdditions.push({ ...structuredClone(f.sqlAdditions[0]), ordinal: 3 });
    f.current = trace(f.parts);
    assert.throws(() => assertWidePins(f.key, f.current, f.sqlAdditions, pinned(f), f.sqlAdditionMethods), { code: 'ERR_ASSERTION' });
  });
test('pins mode: a hand-edited effect summary cannot replace the ledger', () => {
  const f = fixture(), pin = pinned(f); pin.sqlAdditions.callCount = 0;
  assert.throws(() => assertWidePins(f.key, f.current, f.sqlAdditions, pin, f.sqlAdditionMethods), { code: 'ERR_ASSERTION' });
});
for (const [name, index] of [['Memory', 3], ['namespace', 0]])
  test(`pins mode: a wrong ${name} binding changes the reviewed bindings hash without an archive`, () => {
    const f = fixture(), reviewed = pinned(f).sqlAdditions;
    delete f.archived;
    f.parts = structuredClone(f.parts);
    f.parts[2][2][7][2][index] = 'synthetic-wrong-binding';
    f.sqlAdditions[3].statement[2][index] = 'synthetic-wrong-binding';
    f.current = trace(f.parts);
    // Even re-deriving the ledger and all general trace hashes cannot replace
    // the separately reviewed bindings digest in the record's addition summary.
    const actual = currentAdditionSummary(f.key, f.current, f.sqlAdditions, f.sqlAdditionMethods).effect;
    const before = reviewed.calls[0].statements[3], after = actual.calls[0].statements[3];
    assert.deepEqual(after.slice(0, 2), before.slice(0, 2));
    assert.notEqual(after[2], before[2]);
    assert.equal(after[2], hash(f.sqlAdditions[3].statement[2]));
    const pin = { ...summary(f.current), sqlAdditions: reviewed };
    assert.throws(() => assertWidePins(f.key, f.current, f.sqlAdditions, pin, f.sqlAdditionMethods),
      { code: 'ERR_ASSERTION', message: /pins explicitly describe the ledger effect/ });
  });
test('reviewed addition methods reject unlisted entries, duplicates and unused methods', () => {
  const f = fixture();
  assert.throws(() => validateSqlAdditions(f.sqlAdditions, []), { code: 'ERR_ASSERTION' });
  assert.throws(() => validateSqlAdditions(f.sqlAdditions, ['forget', 'forget']), { code: 'ERR_ASSERTION' });
  assert.throws(() => validateSqlAdditions(f.sqlAdditions, ['forget', 'reject']), { code: 'ERR_ASSERTION' });
  f.sqlAdditions[0].method = 'read';
  assert.throws(() => validateSqlAdditions(f.sqlAdditions, f.sqlAdditionMethods), { code: 'ERR_ASSERTION' });
});
test('pins mode: opening traces also reject purge SQL outside a reviewed call', () => {
  const f = fixture();
  f.current = trace([['read', success, [additions[3]]]]);
  assert.throws(() => assertWidePins('open:23', f.current, [], summary(f.current), []),
    { code: 'ERR_ASSERTION', message: /read carries purge SQL but is not a reviewed addition method/ });
});
test('explicit table removals consume exact rows, with no loose table exemption', () => {
  const before = [['card_operations', ['synthetic-old', 'synthetic-retained']]], after = [['card_operations', ['synthetic-retained']]];
  compareWideTables(after, before, [{ table: 'card_operations', row: 'synthetic-old' }]);
  assert.throws(() => compareWideTables(after, before, [{ table: 'card_operations', row: 'synthetic-missing' }]), { code: 'ERR_ASSERTION' });
  assert.throws(() => compareWideTables([['card_operations', []]], before,
    [{ table: 'card_operations', row: 'synthetic-old' }]), { code: 'ERR_ASSERTION' });
});
test('reconstruction consumes separate probe entries and adjusts all later offsets', () => {
  const f = fixture(), reconstructed = reconstructWideTrace(f.key, f.archived, f.sqlAdditions, f.sqlAdditionMethods);
  assert.deepEqual(reconstructed, f.current);
});
