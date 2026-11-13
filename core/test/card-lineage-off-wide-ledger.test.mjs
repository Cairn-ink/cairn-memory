import test from 'node:test';
import assert from 'node:assert/strict';
import { compareWideTraces, assertWidePins, summary, ledgerAdditionSummary, compareWideTables,
  currentReceiptWalkSQLTexts, reconstructWideTrace } from '../testing/card-lineage-off-wide-compare.mjs';

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
  const sqlAdditions = additions.map(statement => ({ key, forget: 2, after: 3, statement: structuredClone(statement),
    reference: 616, reason: 'Erase engine Card content and bookkeeping when its source is forgotten.' }));
  return { key, receiptWalk, archived: trace(oldParts), current: trace(parts), sqlAdditions, parts };
}
const compare = f => compareWideTraces(f);
const pinned = f => ({ ...summary(f.current), sqlAdditions: ledgerAdditionSummary(f.key, f.sqlAdditions) });

for (const receiptWalk of [false, true]) {
  const mode = receiptWalk ? 'receipt walk' : 'exact trace';
  test(`${mode}: exactly the ledger reconstructs the current trace`, () => compare(fixture(receiptWalk)));
  test(`${mode}: an empty ledger accepts identical traces`, () => {
    const f = fixture(receiptWalk); f.current = structuredClone(f.archived); f.sqlAdditions = []; compare(f);
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
    'an unused ledger entry': f => f.sqlAdditions.push({ ...structuredClone(f.sqlAdditions[0]), forget: 3 }),
    'an anchor that does not exist': f => { f.sqlAdditions[0].after = 100; },
    'a ledger anchor moved before the fence': f => { f.sqlAdditions[0].after = 1; },
    'a ledger entry on a refused forget': f => { f.sqlAdditions[0].forget = 1; },
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
}

test('pins mode: explicit addition summaries match the ledger and the current trace', () => {
  const f = fixture(); assertWidePins(f.key, f.current, f.sqlAdditions, pinned(f));
  assert.equal(pinned(f).sqlAdditions.forgetCalls, 1);
  assert.equal(pinned(f).sqlAdditions.calls[0].statements.length, 4);
});
test('pins mode: an empty ledger accepts identical traces with legacy pins', () => {
  const f = fixture(); f.current = structuredClone(f.archived); f.sqlAdditions = [];
  assertWidePins(f.key, f.current, f.sqlAdditions, summary(f.current));
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
    if (mutation === 'unused entry') f.sqlAdditions.push({ ...structuredClone(f.sqlAdditions[0]), forget: 3 });
    f.current = trace(f.parts);
    assert.throws(() => assertWidePins(f.key, f.current, f.sqlAdditions, pinned(f)), { code: 'ERR_ASSERTION' });
  });
test('pins mode: a hand-edited effect summary cannot replace the ledger', () => {
  const f = fixture(), pin = pinned(f); pin.sqlAdditions.forgetCalls = 0;
  assert.throws(() => assertWidePins(f.key, f.current, f.sqlAdditions, pin), { code: 'ERR_ASSERTION' });
});
test('explicit table removals consume exact rows, with no loose table exemption', () => {
  const before = [['card_operations', ['synthetic-old', 'synthetic-retained']]], after = [['card_operations', ['synthetic-retained']]];
  compareWideTables(after, before, [{ table: 'card_operations', row: 'synthetic-old' }]);
  assert.throws(() => compareWideTables(after, before, [{ table: 'card_operations', row: 'synthetic-missing' }]), { code: 'ERR_ASSERTION' });
  assert.throws(() => compareWideTables([['card_operations', []]], before,
    [{ table: 'card_operations', row: 'synthetic-old' }]), { code: 'ERR_ASSERTION' });
});
test('reconstruction consumes separate probe entries and adjusts all later offsets', () => {
  const f = fixture(), reconstructed = reconstructWideTrace(f.key, f.archived, f.sqlAdditions);
  assert.deepEqual(reconstructed, f.current);
});
