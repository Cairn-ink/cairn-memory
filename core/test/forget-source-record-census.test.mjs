import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { lineageBaseDeclarations } from '../card-lineage-base-schema.mjs';
import { safetyFixture } from '../testing/content-safety-s2h-fixture.mjs';

// Every persisted JSON slot walked by the guard is classified, including slots
// whose closed grammar cannot contain conversation sources. Keep relational
// anchors visible too; they are checked through FKs rather than the JSON walk.
const records = {
  admission_claims: { columns: ["memory_ids"], canTrip: false, reason: "Memory IDs; completed claims are not rewritten by forget or correct." },
  asset_derivatives: { columns: ["provenance", "timecodes"], canTrip: false, reason: "Asset-only provenance and timecodes; no retained conversation source identity." },
  asset_operations: { columns: ["result"], canTrip: false, reason: "Asset acknowledgements; source mutations do not write this ledger." },
  capture_events: { columns: ["reconciliation"], canTrip: false, reason: "Reconciliation metadata only; source mutations do not write this row." },
  capture_initial_classification: { columns: ["bound_refs", "final_refs", "selected_refs"], canTrip: false, reason: "Memory references; source mutations do not rewrite classification journals." },
  card_bindings: { columns: ["source_ref"], canTrip: false, reason: "Submitted-note references; source mutations remove bindings on purged engine Cards, never rewrite them." },
  card_current_dependencies: { columns: ["context", "vector"], canTrip: false, reason: "Method binding context and vector; source mutations do not rewrite them." },
  card_memory_bindings: { columns: ["source_ref"], canTrip: false, reason: "Receipt references; deleted on engine purge, otherwise unchanged." },
  card_operations: { columns: ["result"], canTrip: false, reason: "Stored acknowledgements; purge removes affected engine rows without rewriting source references." },
  card_raw_bindings: { columns: ["source_ref"], canTrip: false, reason: "Raw references; affected bindings are removed on engine purge, otherwise unchanged." },
  confirmation_actions: { columns: ["result"], canTrip: false, reason: "Audit result identities; ordinary forget and correct do not rewrite this ledger." },
  confirmation_conflicts: { columns: ["result"], canTrip: false, reason: "Dropped audit results retain Memory identities, handled by existing audit and terminal matching." },
  confirmation_supersessions: { columns: ["previous_receipt_ids", "receipt_ids", "result"], canTrip: false, reason: "Dropped audit results and receipt arrays use existing audit and terminal matching." },
  episode_keep_actions: { columns: ["keep_source_ids", "memory_ids"], canTrip: false, reason: "Exact Episode source IDs; completed keeps stay unchanged, and exclusions resolve their receipt proof before invalidation removes the referenced IDs." },
  episode_memory_links: { columns: ["receipt_ids"], canTrip: false, reason: "Receipt IDs; links are not rewritten by the operation." },
  memory_supersessions: { columns: ["receipt_ids"], canTrip: false, reason: "Receipt IDs; source mutations do not rewrite supersession proofs." },
  method_binding_events: { columns: ["reason_refs"], canTrip: false, reason: "Reason references may include retained content; source mutations do not write binding events." },
  method_changes: { columns: ["from_ref", "items", "reason_refs", "to_ref"], canTrip: false, reason: "Reason references may include retained content; source mutations do not write version changes." },
  method_operations: { columns: ["result"], canTrip: false, reason: "Method acknowledgements; source mutations do not write this ledger." },
  procedural_tags: { columns: ["anchors"], canTrip: false, reason: "Receipt anchors are cleared to NULL before the changed row is walked." },
  raw_deletion_actions: { columns: ["result"], canTrip: false, reason: "Deletion acknowledgements; ordinary forget and correct do not write this ledger." },
  raw_events: { columns: ["result"], canTrip: false, reason: "Capture acknowledgements; source mutations do not rewrite capture history." },
  role_profile_changes: { columns: ["payload"], canTrip: false, reason: "Reason references may include retained content; source mutations do not write release changes." },
  role_profile_operations: { columns: ["result"], canTrip: false, reason: "Role acknowledgements; source mutations do not write this ledger." },
  role_profile_releases: { columns: ["payload"], canTrip: false, reason: "Related content references; source mutations do not rewrite releases." },
  session_episodes: { columns: ["record"], canTrip: true, reason: "Can trip: touchMemory changes revision with retained source anchors; invalidate and withhold before fencing." },
  staged_capture_evidence: { columns: ["payload"], canTrip: false, reason: "The operation purges payload to NULL before the changed row is walked." },
};
const jsonColumns = () => new Set(readFileSync(new URL('../content-write-safety.mjs', import.meta.url), 'utf8')
  .match(/const jsonColumns=new Set\(`([^`]+)`/)[1].split(/\s+/));
function declaredSlots() {
  const columns = jsonColumns();
  return Object.fromEntries(lineageBaseDeclarations[33].filter(row => row.type === 'table').flatMap(row => {
    const slots = [...new Set([...row.sql.matchAll(/\b([a-z_]+)\s+(?:TEXT|BLOB)\b/g)]
      .map(match => match[1]).filter(column => columns.has(column)))].sort();
    return slots.length ? [[row.name, slots]] : [];
  }).sort(([a], [b]) => a.localeCompare(b, 'en')));
}
test('every guard JSON record kind has a source-fence verdict', () => {
  const slots = Object.fromEntries(Object.entries(records).map(([table, value]) => [table, value.columns]));
  assert.deepEqual(declaredSlots(), slots);
  assert.equal(Object.keys(slots).length, 27);
  assert.equal(Object.values(slots).flat().length, 37);
  assert.deepEqual(Object.entries(records).filter(([, value]) => value.canTrip).map(([table]) => table), ['session_episodes']);
  for (const record of Object.values(records)) assert.ok(record.reason.length > 30);
});
test('independent installed-schema census agrees with the guard record classification', async t => {
  const f = safetyFixture(t, 33); await f.migrate();
  const db = f.connect(); t.after(() => db.close());
  const columns = jsonColumns(), actual = {};
  for (const { name } of db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%'").all()) {
    const slots = db.prepare('SELECT name,type FROM pragma_table_info(?)').all(name)
      .filter(row => ['TEXT', 'BLOB'].includes(row.type) && columns.has(row.name)).map(row => row.name).sort();
    if (slots.length) actual[name] = slots;
  }
  assert.deepEqual(actual, declaredSlots());
  for (const [table, column] of [['episode_sources', 'origin_episode_id'], ['rationale_edges', 'from_receipt'], ['qualification_anchors', 'receipt_id']])
    assert.ok(db.prepare('SELECT 1 FROM pragma_table_info(?) WHERE name=?').get(table, column), table + ' relational source anchor');
});
