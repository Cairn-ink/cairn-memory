import test from 'node:test';
import assert from 'node:assert/strict';
import { compareWideTraces, assertWidePins, summary, ledgerAdditionSummary, compareWideTables,
  currentReceiptWalkSQLTexts, reconstructWideTrace, currentAdditionSummary, validateSqlAdditions, hash, cardFamilySQL, forgettingMethods,
  assertArchivedCardStatementTexts, validateCardStatementTexts, normalizeSQL, wideArchiveMode, cardExecutionSummary, purgeAdditionSQL } from '../testing/card-lineage-off-wide-compare.mjs';

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
// Synthetic fixture pins are derived before mutation in occurrence tests below.
const executionPins = f => f.cardStatementExecutions ?? { [f.key]: cardExecutionSummary(f.archived ?? f.current,
  new Set((f.archived ?? f.current).statements.flatMap((statement, index) => purgeAdditionSQL(statement) ? [index] : []))) };
const compare = f => compareWideTraces({ ...f, cardStatementExecutions: executionPins(f) });
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
    assertWidePins(f.key, f.current, f.sqlAdditions, pinned(f), f.sqlAdditionMethods, f.cardStatementTexts ?? {}, executionPins(f));
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
    assert.throws(() => assertWidePins(f.key, f.current, f.sqlAdditions, pinned(f), f.sqlAdditionMethods, f.cardStatementTexts ?? {}, executionPins(f)), { code: 'ERR_ASSERTION' });
  });
}

for (const method of ['forgetEpisode', 'reject']) test(`reviewed call methods are data: ${method} reconstructs exactly when listed`, () => {
  const f = fixture();
  for (const part of f.parts) if (part[0] === 'forget') part[0] = method;
  for (const call of f.archived.calls) if (call[0] === 'forget') call[0] = method;
  for (const entry of f.sqlAdditions) entry.method = method;
  f.sqlAdditionMethods = [method]; f.current = trace(f.parts);
  compare(f); assertWidePins(f.key, f.current, f.sqlAdditions, pinned(f), f.sqlAdditionMethods, f.cardStatementTexts ?? {}, executionPins(f));
});

test('pins mode: explicit addition summaries match the ledger and the current trace', () => {
  const f = fixture(); assertWidePins(f.key, f.current, f.sqlAdditions, pinned(f), f.sqlAdditionMethods, f.cardStatementTexts ?? {}, executionPins(f));
  assert.equal(pinned(f).sqlAdditions.callCount, 1);
  assert.equal(pinned(f).sqlAdditions.calls[0].statements.length, 4);
});
test('pins mode: an empty ledger accepts identical traces with legacy pins', () => {
  const f = fixture(); f.current = structuredClone(f.archived); f.sqlAdditions = []; f.sqlAdditionMethods = [];
  assertWidePins(f.key, f.current, f.sqlAdditions, summary(f.current), f.sqlAdditionMethods, f.cardStatementTexts ?? {}, executionPins(f));
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
    assert.throws(() => assertWidePins(f.key, f.current, f.sqlAdditions, pinned(f), f.sqlAdditionMethods, f.cardStatementTexts ?? {}, executionPins(f)), { code: 'ERR_ASSERTION' });
  });
test('pins mode: a hand-edited effect summary cannot replace the ledger', () => {
  const f = fixture(), pin = pinned(f); pin.sqlAdditions.callCount = 0;
  assert.throws(() => assertWidePins(f.key, f.current, f.sqlAdditions, pin, f.sqlAdditionMethods, f.cardStatementTexts ?? {}, executionPins(f)), { code: 'ERR_ASSERTION' });
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
    assert.throws(() => assertWidePins(f.key, f.current, f.sqlAdditions, pin, f.sqlAdditionMethods, f.cardStatementTexts ?? {}, executionPins(f)),
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

for (const mutation of ['purge moved before the fence', 'purge moved after the tombstone', 'split anchor group'])
  test(`pins mode: rejects ${mutation} without the archive even with re-derived general hashes`, () => {
    const f = fixture(); delete f.archived;
    const rows = f.parts[2][2], purge = rows.splice(4, additions.length);
    if (mutation === 'split anchor group') {
      rows.splice(4, 0, ...purge.slice(0, 2), row('SELECT intervening', 'get'), ...purge.slice(2));
    } else rows.splice(mutation === 'purge moved before the fence' ? 3 : 5, 0, ...purge);
    f.current = trace(f.parts);
    assert.throws(() => assertWidePins(f.key, f.current, f.sqlAdditions, pinned(f), f.sqlAdditionMethods, f.cardStatementTexts ?? {}, executionPins(f)),
      { code: 'ERR_ASSERTION', message: /current purge anchor/ });
  });

const reviewedCardText = 'UPDATE private_cards SET revision=revision+1 WHERE id=?';
for (const receiptWalk of [false, true]) for (const mode of ['archive', 'pins'])
for (const mutation of ['control', 'duplicate with altered bindings', 'remove', 'reorder', 'rebind', 'execution method'])
test(`${mode} per-call Card executions: ${mutation}, receiptWalk=${receiptWalk}`, () => {
  const f = fixture(receiptWalk), first = row(reviewedCardText, 'run', ['synthetic-first-card']),
    second = row(reviewedCardText, 'run', ['synthetic-second-card']);
  f.parts[2][2].push(first, second);
  const oldParts = structuredClone(f.parts); oldParts[2][2] = [...forgetRows, first, second];
  f.archived = trace(oldParts); f.current = trace(f.parts);
  f.cardStatementTexts = { forget: [reviewedCardText] };
  f.cardStatementExecutions = structuredClone(executionPins(f));
  const reviewedAdditions = pinned(f).sqlAdditions;
  f.parts = structuredClone(f.parts);
  const rows = f.parts[2][2];
  if (mutation === 'duplicate with altered bindings') rows.splice(1, 0, row(reviewedCardText, 'run', ['synthetic-wrong-card']));
  if (mutation === 'remove') rows.pop();
  if (mutation === 'reorder') rows.push(rows.splice(-2, 1)[0]);
  if (mutation === 'rebind') rows.at(-1)[2] = ['synthetic-wrong-card'];
  if (mutation === 'execution method') rows.at(-1)[1] = 'all';
  f.current = trace(f.parts);
  const run = () => mode === 'archive' ? compare(f) : assertWidePins(f.key, f.current, f.sqlAdditions,
    { ...summary(f.current), sqlAdditions: reviewedAdditions }, f.sqlAdditionMethods, f.cardStatementTexts, f.cardStatementExecutions);
  if (mode === 'pins') delete f.archived;
  if (mutation === 'control') run();
  else assert.throws(run, { code: 'ERR_ASSERTION', message: /Card-family executions match reviewed calls/ });
});
for (const mode of ['archive', 'pins']) test(`${mode} per-call Card executions: missing pins fail closed`, () => {
  const f = fixture();
  const run = () => mode === 'archive' ? compareWideTraces(f) :
    assertWidePins(f.key, f.current, f.sqlAdditions, pinned(f), f.sqlAdditionMethods);
  assert.throws(run, { code: 'ERR_ASSERTION', message: /cardStatementExecutions requires reviewed per-call pins/ });
});
for (const mode of ['archive', 'pins']) {
  for (const [name, method, sql, lists] of [
    ['extra binding delete in forget', 'forget', 'DELETE FROM card_memory_bindings WHERE card_id=?', {}],
    ['extra replace in forget', 'forget', 'REPLACE INTO private_cards(id) VALUES(?)', {}],
    ['extra insert or replace in forget', 'forget', 'INSERT OR REPLACE INTO card_epochs VALUES(?)', {}],
    ['extra upsert in forget', 'forget', 'INSERT INTO card_epochs VALUES(?) ON CONFLICT(owner_id) DO UPDATE SET generation=2', {}],
    ['extra Card update in deleteConversation', 'deleteConversation', reviewedCardText, {}],
    ['one character changed in listed text', 'forget', reviewedCardText + ' ', { forget: [reviewedCardText] }],
    ['text listed for another method', 'forget', reviewedCardText, { deleteConversation: [reviewedCardText] }],
  ]) test(`${mode} card-family: rejects ${name}`, () => {
    const f = fixture(); f.cardStatementTexts = lists;
    // A matching archived occurrence ensures the negative cases exercise the
    // current classifier, rather than just failing the archive-list equality.
    if (lists.forget) {
      const call = f.archived.calls[3]; f.archived.statements.splice(call[3] - 1, 0, row(reviewedCardText, 'run', ['synthetic-card'])); call[3]++;
    }
    if (lists.deleteConversation) {
      const oldParts = [['deleteConversation', success, [row(reviewedCardText, 'run', ['synthetic-card'])]],
        ...f.parts.map((part, index) => index === 2 ? [part[0], part[1], forgetRows] : part)];
      f.archived = trace(oldParts);
      f.parts.unshift(oldParts[0]);
    }
    const part = f.parts.findLast(part => part[0] === 'forget'); part[0] = method;
    if (method !== 'forget') {
      for (const call of f.archived.calls) if (call[0] === 'forget' && call[1].ok) call[0] = method;
      for (const entry of f.sqlAdditions) { entry.method = method; entry.ordinal = 1; }
      f.sqlAdditionMethods = [method];
    }
    part[2].splice(-1, 0, row(sql, 'run', ['synthetic-card'])); f.current = trace(f.parts);
    if (mode === 'pins') {
      delete f.archived;
      assert.throws(() => assertWidePins(f.key, f.current, f.sqlAdditions, pinned(f), f.sqlAdditionMethods, lists, executionPins(f)),
        { code: 'ERR_ASSERTION', message: /unreviewed card-family statement/ });
    } else assert.throws(() => compare(f), { code: 'ERR_ASSERTION', message: /unreviewed card-family statement/ });
  });
  for (const method of forgettingMethods) test(`${mode} card-family: accepts a listed exact text in ${method}`, () => {
    const f = fixture(), listed = row(reviewedCardText, 'run', ['synthetic-card']);
    for (const part of f.parts) if (part[0] === 'forget') part[0] = method;
    f.parts[2][2].push(listed); f.current = trace(f.parts);
    const oldParts = structuredClone(f.parts); oldParts[2][2] = [...forgetRows, listed]; f.archived = trace(oldParts);
    for (const entry of f.sqlAdditions) entry.method = method;
    f.sqlAdditionMethods = [method]; f.cardStatementTexts = { [method]: [reviewedCardText] };
    if (mode === 'archive') compare(f);
    else { delete f.archived; assertWidePins(f.key, f.current, f.sqlAdditions, pinned(f), f.sqlAdditionMethods, f.cardStatementTexts, executionPins(f)); }
  });
}
test('archive card-family: rejects a listed text absent from every archived call', () => {
  const f = fixture(); f.cardStatementTexts = { forget: [reviewedCardText] };
  assert.throws(() => compare(f), { code: 'ERR_ASSERTION', message: /reviewed card texts equal the revised archive/ });
});
test('archive card-family: list equality covers the union of workloads', () => {
  const a = trace([['forget', success, [row(reviewedCardText)]]]), b = trace([['deleteConversation', success, [row(reviewedCardText)]]]);
  assertArchivedCardStatementTexts([a, b], { forget: [reviewedCardText], deleteConversation: [reviewedCardText] });
});
test('card-family classifier covers target tables, schema probes and Card operation joins', () => {
  for (const sql of ['INSERT INTO card_effects VALUES(?)', 'INSERT OR IGNORE INTO card_epochs VALUES(?)',
    'REPLACE INTO private_cards(id) VALUES(?)', 'REPLACE INTO card_effects VALUES(?)',
    'INSERT OR REPLACE INTO private_cards(id) VALUES(?)', 'INSERT OR REPLACE INTO card_epochs VALUES(?)',
    'INSERT INTO private_cards(id) VALUES(?) ON CONFLICT(id) DO UPDATE SET revision=2',
    'INSERT INTO card_epochs VALUES(?) ON CONFLICT(owner_id) DO UPDATE SET generation=2',
    'UPDATE private_cards SET revision=2', 'DELETE FROM card_memory_bindings WHERE card_id=?',
    'UPDATE main."card_effects" SET ordinal=2', 'DELETE FROM [card_bindings]',
    'WITH wanted AS (SELECT 1) DELETE FROM card_bindings WHERE card_id=?',
    "SELECT 1 FROM sqlite_schema WHERE name IN ('other','private_cards')",
    "SELECT 1 FROM sqlite_master WHERE name='card_raw_bindings'", 'SELECT c.* FROM private_cards c JOIN card_operations o ON o.target_id=c.id'])
    assert.equal(cardFamilySQL(row(sql)), true, sql);
  for (const sql of ['UPDATE memories SET deleted=1', "SELECT 1 FROM sqlite_master WHERE name='memories'", 'DELETE FROM card1',
    'SELECT * FROM private_cards WHERE id=?', 'SELECT 1 FROM card_memory_bindings WHERE card_id=? LIMIT 1'])
    assert.equal(cardFamilySQL(row(sql)), false, sql);
});

for (const padded of [false, true]) test(`reviewed text list rejects a purge text even without a matching ledger row, padded=${padded}`, () => {
  const sql = padded ? '\n  SELECT  1 FROM sqlite_master WHERE type=\'table\' AND name=\'card_memory_bindings\'  ' : additions[0][0];
  const f = fixture(); f.cardStatementTexts = { forget: [sql] };
  // An extra listed copy used to bypass the purge ledger in pins mode.
  f.parts[2][2].splice(-1, 0, row(sql, 'get')); f.current = trace(f.parts);
  assert.throws(() => assertWidePins(f.key, f.current, f.sqlAdditions, pinned(f), f.sqlAdditionMethods, f.cardStatementTexts, executionPins(f)),
    { code: 'ERR_ASSERTION', message: /cannot hide purge-family statements/ });
  assert.throws(() => validateCardStatementTexts(f.cardStatementTexts),
    { code: 'ERR_ASSERTION', message: /cannot hide purge-family statements/ });
});
for (const padded of [false, true]) test(`reviewed text list rejects a normalized ledger duplicate, padded=${padded}`, () => {
  // Keep this text outside the purge recognizer to exercise the independent
  // ledger-text check rather than succeeding through its purge rejection.
  const sql = padded ? '\n UPDATE  private_cards SET revision=revision+1 WHERE id=?  ' : reviewedCardText;
  assert.equal(normalizeSQL(sql), normalizeSQL(reviewedCardText));
  assert.throws(() => validateCardStatementTexts({ forget: [sql] }, [{ statement: row(reviewedCardText) }]),
    { code: 'ERR_ASSERTION', message: /cannot duplicate ledger statement texts/ });
});
test('a generic table probe stays distinct from every literal-name ledger probe after normalization', () => {
  const generic = "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?";
  const f = fixture(); validateCardStatementTexts({ forget: [generic] }, f.sqlAdditions);
  for (const entry of f.sqlAdditions) assert.notEqual(normalizeSQL(generic), normalizeSQL(entry.statement[0]));
  assert.equal(cardFamilySQL(row(generic, 'get', ['card_memory_bindings'])), true);
});
test('archive card-family: an empty archive collection cannot pass list equality', () => {
  assert.throws(() => assertArchivedCardStatementTexts([], {}),
    { code: 'ERR_ASSERTION', message: /needs at least one trace/ });
});
for (const setting of [undefined, '0', '1', 'true']) {
  test(`wide archive policy compares an available archive, setting=${setting}`, () => {
    assert.equal(wideArchiveMode(true, setting), 'archive');
  });
  for (const cause of ['missing revision', 'unreadable archive'])
    test(`wide archive policy handles ${cause}, setting=${setting}`, () => {
      if (setting === '1') assert.throws(() => wideArchiveMode(false, setting),
        { code: 'ERR_ASSERTION', message: /archive revision not available/ });
      else assert.equal(wideArchiveMode(false, setting), 'pins');
    });
}
for (const mode of ['archive', 'pins']) test(`${mode} card-family: a listed forgetting method needs no ledger rows or addition-method entry`, () => {
  const current = trace([['reject', success, [row(reviewedCardText, 'run', ['synthetic-card'])]]]);
  const f = { key: 'workload:23', current, archived: structuredClone(current), sqlAdditions: [], sqlAdditionMethods: [],
    cardStatementTexts: { reject: [reviewedCardText] } };
  if (mode === 'archive') compare(f);
  else assertWidePins(f.key, current, [], summary(current), [], f.cardStatementTexts, executionPins(f));
});

for (const mode of ['archive', 'pins']) test(`${mode} card-family: a reviewed ledger cannot put purge SQL in another method`, () => {
  const f = fixture(); f.parts[2][0] = 'capture';
  f.archived.calls[3][0] = 'capture';
  for (const entry of f.sqlAdditions) { entry.method = 'capture'; entry.ordinal = 1; }
  f.sqlAdditionMethods = ['capture']; f.current = trace(f.parts);
  if (mode === 'archive') assert.throws(() => compare(f), { code: 'ERR_ASSERTION', message: /outside a forgetting call/ });
  else assert.throws(() => assertWidePins(f.key, f.current, f.sqlAdditions, pinned(f), f.sqlAdditionMethods, f.cardStatementTexts ?? {}, executionPins(f)),
    { code: 'ERR_ASSERTION', message: /outside a forgetting call/ });
});
