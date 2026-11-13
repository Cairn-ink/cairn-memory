import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { parse } from '../../tools/testing/vendor/acorn/acorn.mjs';
import { openDatabase } from '../database.mjs';
import { contentSafetyDDL } from '../content-safety-schema.mjs';
import { cardLineageDDL } from '../card-lineage-schema.mjs';

// Read the private declaration without expanding the frozen runtime exports.
const verifierSource = readFileSync(new URL('../content-write-safety.mjs', import.meta.url), 'utf8');
const declaration = parse(verifierSource, { ecmaVersion: 2025, sourceType: 'module' }).body
  .filter(node => node.type === 'VariableDeclaration').flatMap(node => node.declarations)
  .filter(node => node.id.name === 'engineCardClosureReferences');
assert.equal(declaration.length, 1, 'one private closure-map declaration');
function literalData(node) {
  if (node.type === 'Literal') return node.value;
  if (node.type === 'ArrayExpression') return node.elements.map(literalData);
  assert.equal(node.type, 'ObjectExpression', 'the closure map contains only static data');
  return Object.fromEntries(node.properties.map(property => {
    assert.equal(property.type, 'Property'); assert.equal(property.kind, 'init');
    assert.equal(property.computed, false); assert.equal(property.method, false);
    return [property.key.name ?? property.key.value, literalData(property.value)];
  }));
}
const engineCardClosureReferences = literalData(declaration[0].init);

// Read installer source, including newly added schema modules. Do not enumerate
// FK tables here: a new direct Card FK must automatically require map coverage.
function sourceReferences() {
  const tables = new Map(), direct = [];
  for (const file of readdirSync(new URL('../', import.meta.url)).filter(name => /schema.*\.mjs$/.test(name) && !name.includes('base-schema'))) {
    const source = readFileSync(new URL('../' + file, import.meta.url), 'utf8');
    for (const [, table, body] of source.matchAll(/CREATE TABLE(?: IF NOT EXISTS)?\s+(\w+)\s*\(([\s\S]*?)\)\s*STRICT/gi)) {
      tables.set(table, body);
      for (const [, column] of body.matchAll(/\b(\w+)\s+TEXT\b[^,\n]*\bREFERENCES\s+private_cards\s*\(id\)/gi)) direct.push([table, column]);
      for (const [, columns] of body.matchAll(/FOREIGN KEY\s*\(([^)]+)\)\s*REFERENCES\s+private_cards\s*\(id\)/gi))
        direct.push([table, columns.trim()]);
    }
  }
  assert.ok(direct.length >= 8, 'installer scan must find actual Card FKs');
  return { tables, direct };
}
// Compile the actual latest base installers and additive declarations as well.
// PRAGMA derives quoted, composite and generated FK columns without relying on
// the source spelling. No content operation or migration fixture runs here.
function schemaReferences() {
  const source = sourceReferences(), db = openDatabase(':memory:', { currentDependencies: true });
  try {
    db.exec(contentSafetyDDL(33)); db.exec(cardLineageDDL);
    const tables = new Map(db.prepare("SELECT name,sql FROM sqlite_master WHERE type='table'").all().map(row => [row.name, row.sql]));
    const direct = new Map(source.direct.map(ref => [JSON.stringify(ref), ref]));
    for (const table of tables.keys()) for (const key of db.prepare('PRAGMA foreign_key_list("' + table.replaceAll('"', '""') + '")').all())
      if (key.table === 'private_cards') direct.set(JSON.stringify([table, key.from]), [table, key.from]);
    return { tables: new Map([...source.tables, ...tables]), direct: [...direct.values()] };
  } finally { db.close(); }
}
// Polymorphic slots have no SQL FK. These declarations follow the native
// receipt DTO, source reservation types, method reason refs and role fields.
const typed = {
  private_cards: { columns: ['id'] },
  card_operations: { columns: ['target_id'], json: [
    { column: 'result', path: [], key: 'id', rowMethods: ['createCardDraft', 'editCardDraft', 'confirmCardDraft',
      'cancelCardDraft', 'editKnowledgeCard', 'deleteKnowledgeCard', 'declareCardCurrentDependencies',
      'revalidateCardCurrentDependencies', 'consolidate'] },
    { column: 'result', path: ['cardRefs', '*'], key: 'cardId', when: ['type', 'card'] }] },
  card_body_provenance: { columns: ['card_id'] }, card_body_sources: { columns: ['card_id'] },
  card_body_authorizations: { columns: ['card_id', 'request_target'] },
  card_effects: { columns: [{ key: 'entity_id', when: ['entity_type', 'card'] }] },
  content_identity_reservations: { columns: [{ key: 'stable_key', when: ['kind', 'card'] }, { key: 'incarnation', when: ['kind', 'card'] }] },
  content_suppressions: { columns: [{ key: 'stable_key', when: ['kind', 'card'] }, { key: 'incarnation', when: ['kind', 'card'] }] },
  method_changes: { json: [{ column: 'reason_refs', path: ['*'], key: 'cardId', when: ['type', 'card'] }] },
  method_binding_events: { json: [{ column: 'reason_refs', path: ['*'], key: 'cardId', when: ['type', 'card'] }] },
  role_profile_releases: { json: [{ column: 'payload', path: ['fields', 'related', '*'], key: 'cardId', when: ['type', 'card'] }] },
  role_profile_changes: { json: [{ column: 'payload', path: ['reasonRefs', '*'], key: 'cardId', when: ['type', 'card'] }] },
};
function coverage(map, schema) {
  for (const [table, column] of schema.direct) assert.ok(map[table]?.columns?.includes(column), `${table}.${column} Card FK missing`);
  for (const [table, slots] of Object.entries(typed)) {
    assert.ok(schema.tables.has(table), table + ' exists in an installer');
    for (const [kind, values] of Object.entries(slots)) for (const slot of values)
      assert.ok(map[table]?.[kind]?.some(actual => JSON.stringify(actual) === JSON.stringify(slot)), `${table} typed slot missing: ${JSON.stringify(slot)}`);
  }
  for (const [table, slots] of Object.entries(map)) {
    const sql = schema.tables.get(table); assert.ok(sql, table + ' is declared');
    for (const column of [...(slots.columns ?? []).map(slot => typeof slot === 'string' ? slot : slot.key), ...(slots.json ?? []).map(slot => slot.column)])
      assert.match(sql, new RegExp('\\b' + column + '\\s+TEXT\\b'), `${table}.${column} exists`);
  }
}
test('engine closure map covers schema-installer Card FKs and typed reference slots', t => {
  const schema = schemaReferences(); coverage(engineCardClosureReferences, schema);
  const required = new Set([...schema.direct.map(([table]) => table), ...Object.keys(typed)]);
  assert.deepEqual(Object.keys(engineCardClosureReferences).sort(), [...required].sort());
  for (const table of required) {
    const missing = structuredClone(engineCardClosureReferences); delete missing[table];
    assert.throws(() => coverage(missing, schema), { code: 'ERR_ASSERTION' });
    const columns = structuredClone(engineCardClosureReferences); columns[table] = {};
    assert.throws(() => coverage(columns, schema), { code: 'ERR_ASSERTION' });
  }
  // A newly installed table or a second direct FK column cannot be forgotten.
  for (const reference of [['new_card_consumer', 'card_id'], ['card_bindings', 'other_card_id']])
    assert.throws(() => coverage(engineCardClosureReferences, { ...schema, direct: [...schema.direct, reference] }), { code: 'ERR_ASSERTION' });
  t.diagnostic(`${required.size} target-bearing tables; ${schema.direct.length} direct FK declarations`);
});
