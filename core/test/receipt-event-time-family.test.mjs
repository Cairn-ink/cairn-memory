import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { openDatabase } from '../database.mjs';
import { openReadDatabase } from '../read-database.mjs';
import { createTopicSession } from '../topic-members-session.mjs';
import { existingStoreOption, validateExistingStore } from '../existing-store.mjs';
import { contentSafetyPin, resolveContentLayout } from '../content-safety-layout.mjs';
import { receiptEventTimeEnabled, attestContentSafety, installedContentLayout, contentSafetyDDL, verifyContentSafetyDDL, bindContentSafetyConnection } from '../content-safety-schema.mjs';
import { validateContextProductLayout } from '../context-product-schema.mjs';
import { storeIdentity } from '../store-fence.mjs';
import { openMemoryCore } from '../index.mjs';
import { host } from '../testing/context-read-core-fixture.mjs';
import { eventTimeFixture, migrateEventTime, ns, ok, receipt } from '../testing/receipt-event-time-fixture.mjs';
import { safetyFixture, readSqliteFixture } from '../testing/content-safety-s2h-fixture.mjs';

function openers(f, db) {
  const pin = existingStoreOption(contentSafetyPin(resolveContentLayout({18:51,23:52,33:53}[f.base]), f.storeId));
  return [
    () => { const handle = openDatabase(f.path); handle.close(); },
    () => { const handle = openReadDatabase(f.path); handle.db.close(); },
    () => validateContextProductLayout(db),
    () => { const session = createTopicSession(f.path); try { session.prepare({ charge() {}, request: {} }); } finally { session.dispose(); } },
    () => validateExistingStore(db, pin),
    () => storeIdentity(db),
  ];
}
const controlGuard = (base, flag) => contentSafetyDDL(base, flag, true).match(/CREATE TRIGGER safety_control_update[\s\S]*?END;/)[0];
function withoutEventTime(db, base) {
  // A coherent future family variant: its integer stays fixed, its attested
  // tuple and DDL select the feature. No supported serving writer does this.
  db.exec(`DROP TRIGGER safety_control_update; UPDATE content_safety_control SET receipt_event_time=0;
    DROP TRIGGER safety_receipt_identity; ALTER TABLE receipts DROP COLUMN occurred_at;`);
  db.exec(contentSafetyDDL(base, false, true).match(/CREATE TRIGGER safety_receipt_identity[\s\S]*?END;/)[0]);
  db.exec(controlGuard(base, false));
}

for (const base of [18,23,33]) test(`family ${base}: attested 0 and 1 select exact DDL and capabilities at the same integer`, async t => {
  const f = await eventTimeFixture(t, base), db = f.connect(); t.after(() => db.close());
  assert.equal(receiptEventTimeEnabled(attestContentSafety(db)), true);
  assert.throws(() => db.exec('UPDATE content_safety_control SET receipt_event_time=0'), /safety_immutable/);
  assert.throws(() => db.exec('UPDATE content_safety_control SET receipt_event_time=0,card_lineage_revision=1'), /safety_immutable/);
  withoutEventTime(db, base);
  assert.equal(attestContentSafety(db).physical, {18:51,23:52,33:53}[base]);
  assert.equal(receiptEventTimeEnabled(attestContentSafety(db)), false);
  for (const open of openers(f, db)) assert.doesNotThrow(open);
  const trusted = host();
  const core = openMemoryCore({ path: f.path, contextRead: { version: 'context-read-v1', authority: trusted.authority } }); t.after(() => core.close());
  assert.equal(ok(core.getContextReadCapabilities()).receiptEventTime, false);
  ok(core.admit({ namespace: ns, memory: { content: 'Synthetic family without event time', kind: 'fact' }, receipts: [receipt('plain')] }));
  const dated = core.admit({ namespace: ns, memory: { content: 'Synthetic refused dated receipt', kind: 'fact' },
    receipts: [{ ...receipt('dated'), occurredAt: '2001-02-03T04:05:06.789Z' }] });
  assert.equal(dated.ok, false); assert.equal(dated.error.code, 'unsupported_database');
});

for (const base of [18,23,33]) for (const damage of ['missing-flag','unsupported-flag','unknown-feature','unsupported-revision','flag-ddl-mismatch'])
test(`family ${base}: all six openers refuse ${damage}`, async t => {
  const f = await eventTimeFixture(t, base), db = f.connect(); t.after(() => db.close());
  if (damage === 'missing-flag') db.exec('DROP TRIGGER safety_control_update; ALTER TABLE content_safety_control DROP COLUMN receipt_event_time');
  if (damage === 'unsupported-flag') db.exec('DROP TRIGGER safety_control_update; PRAGMA ignore_check_constraints=ON; UPDATE content_safety_control SET receipt_event_time=2');
  if (damage === 'unknown-feature') db.exec('ALTER TABLE content_safety_control ADD COLUMN future_feature INTEGER NOT NULL DEFAULT 0');
  if (damage === 'unsupported-revision') db.exec('DROP TRIGGER safety_control_update; PRAGMA ignore_check_constraints=ON; UPDATE content_safety_control SET card_lineage_revision=2');
  if (damage === 'flag-ddl-mismatch') {
    db.exec('DROP TRIGGER safety_control_update; UPDATE content_safety_control SET receipt_event_time=0');
    db.exec(controlGuard(base, true));
  }
  for (const open of openers(f, db)) assert.throws(open, { code: 'unsupported_database' });
});

for (const base of [23,33]) test(`family ${base}: unsupported S2c revision refuses even with unchanged DDL`, async t => {
  const f = await eventTimeFixture(t, base), db = f.connect(); t.after(() => db.close());
  attestContentSafety(db);
  // The existing S2c transition remains permitted by the control guard, but
  // this binary's supported revision set remains {0}.
  db.exec('UPDATE content_safety_control SET card_lineage_revision=1');
  assert.throws(() => installedContentLayout(db), { code: 'unsupported_database' });
  for (const open of openers(f, db)) assert.throws(open, { code: 'unsupported_database' });
});

for (const base of [18,23,33]) test(`family ${base}: cached control binding includes receipt_event_time`, async t => {
  const f = await eventTimeFixture(t, base), db = f.connect(); t.after(() => db.close());
  attestContentSafety(db);
  const prepare = db.prepare.bind(db);
  let originalControl, revalidated = false;
  const adapter = { prepare(sql) {
    if (sql.includes("name GLOB 'content_safety_*'")) { revalidated = true; throw Error('synthetic-revalidation'); }
    const statement = prepare(sql);
    if (!sql.includes('json_array')) return statement;
    return { get() { const header = statement.get(); const control = JSON.parse(header.control); originalControl = [...control]; control[control.length - 1] = 0;
      return { ...header, control: JSON.stringify(control) }; } };
  } };
  bindContentSafetyConnection(adapter, db);
  // Only the flag differs: cookie, physical version and application id match.
  // Refusal proves the header forced reattestation instead of reusing the cache.
  assert.throws(() => installedContentLayout(adapter), { code: 'unsupported_database' });
  assert.equal(originalControl.length, 9); assert.equal(originalControl.at(-1), 1);
  assert.equal(revalidated, true);
});

test('frozen pre-safety binaries reject every 51/52/53 family', async t => {
  const f = await eventTimeFixture(t), root = join(f.workspace.path, 'old'); mkdirSync(root);
  const archive = fileURLToPath(new URL('./fixtures/content-safety-openers.tgz', import.meta.url));
  const child = spawnSync('tar', ['-xf', archive, '-C', root, 'legacy'], { encoding: 'utf8' });
  assert.equal(child.status, 0, child.stderr);
  const load = name => import(pathToFileURL(join(root, 'legacy/core', name + '.mjs')).href);
  const [write, read, product, existing, topics] = await Promise.all(['database','read-database','context-product-schema','existing-store','topic-members-session'].map(load));
  for (const base of [18,23,33]) {
    const store = await eventTimeFixture(t, base), db = store.connect();
    try {
      assert.throws(() => write.openDatabase(store.path), { code: 'unsupported_database' });
      assert.throws(() => read.openReadDatabase(store.path), { code: 'unsupported_database' });
      assert.throws(() => product.validateContextProductLayout(db), { code: 'unsupported_database' });
      assert.throws(() => existing.validateExistingStore(db, { storeId: store.storeId }), { code: 'unsupported_database' });
      const session = topics.createTopicSession(store.path);
      try { assert.throws(() => session.prepare({ charge() {}, request: {} }), { code: 'unsupported_database' }); } finally { session.dispose(); }
    } finally { db.close(); }
  }
});

for (const safety of [false,true]) for (const phase of ['DROP TABLE event_time_control_before', 'PRAGMA user_version=51'])
test(`family migration rollback after ${phase}, safety=${safety}`, async t => {
  const f = safetyFixture(t); if (safety) await f.migrate();
  const before = readSqliteFixture(f.path), exec = DatabaseSync.prototype.exec;
  let fired = false;
  DatabaseSync.prototype.exec = function(sql) {
    const result = exec.call(this, sql);
    if (sql.includes(phase)) { fired = true; throw Error('synthetic-control-migration-failure'); }
    return result;
  };
  try { await assert.rejects(() => migrateEventTime(f), /synthetic-control-migration-failure/); }
  finally { DatabaseSync.prototype.exec = exec; }
  assert.equal(fired, true);
  assert.deepEqual(readSqliteFixture(f.path), before);
});

// Matching canonical triggers are essential here: these stores must get past
// the old DDL-only attestation before the column/flag check refuses them.
for (const base of [18,23,33]) for (const flag of [0,1])
test(`family ${base}: column/flag mismatch with matching trigger, flag=${flag}`, async t => {
  const f = await eventTimeFixture(t, base), db = f.connect();
  try {
    db.exec('DROP TRIGGER safety_receipt_identity; DROP TRIGGER safety_control_update');
    db.exec(`UPDATE content_safety_control SET receipt_event_time=${flag}`);
    if (flag === 1) db.exec('ALTER TABLE receipts DROP COLUMN occurred_at');
    db.exec(contentSafetyDDL(base, Boolean(flag), true).match(/CREATE TRIGGER safety_receipt_identity[\s\S]*?END;/)[0]);
    db.exec(controlGuard(base, Boolean(flag)));
    // Positive control for the old check: tuple and exact safety DDL match.
    assert.doesNotThrow(() => verifyContentSafetyDDL(db, {18:51,23:52,33:53}[base]));
    assert.equal(db.prepare("SELECT count(*) n FROM pragma_table_xinfo('receipts') WHERE name='occurred_at'").get().n, 1 - flag);
  } finally { db.close(); }
  const names = ['writer', 'ordinary reader', 'product validator', 'topic preparation', 'existing store', 'store identity', 'safety attestation'];
  for (const [i, name] of names.entries()) await t.test(name, () => {
    // Independent native handles: an earlier refusal must not mask a gap in
    // another opener through the connection's permanent refusal cache.
    const fresh = f.connect();
    try {
      const open = [...openers(f, fresh), () => attestContentSafety(fresh)][i];
      assert.throws(open, { code: 'unsupported_database' });
    } finally { fresh.close(); }
  });
});

for (const base of [18,23,33]) for (const flag of [0,1])
test(`family ${base}: cached column mismatch reattests, flag=${flag}`, async t => {
  const f = await eventTimeFixture(t, base), db = f.connect(); t.after(() => db.close());
  if (flag === 0) withoutEventTime(db, base);
  const layout = attestContentSafety(db);
  assert.equal(receiptEventTimeEnabled(layout), Boolean(flag));
  assert.equal(Reflect.has(layout, 'receiptEventTime'), false);
  assert.equal(receiptEventTimeEnabled({ ...layout }), false, 'copies carry no private attestation');
  const statements = [];
  const adapter = bindContentSafetyConnection({ prepare(sql) { statements.push(sql); return db.prepare(sql); } }, db);
  assert.equal(installedContentLayout(adapter), layout);
  assert.equal(statements.length, 1, 'cached attestation still executes only its header');
  assert.doesNotMatch(statements[0], /pragma_table_(?:xinfo|info)/, 'no per-read receipt column scan');
  db.exec('DROP TRIGGER safety_receipt_identity');
  if (flag === 0) db.exec('ALTER TABLE receipts ADD COLUMN occurred_at TEXT');
  else db.exec('ALTER TABLE receipts DROP COLUMN occurred_at');
  db.exec(contentSafetyDDL(base, Boolean(flag), true).match(/CREATE TRIGGER safety_receipt_identity[\s\S]*?END;/)[0]);
  assert.throws(() => installedContentLayout(adapter), { code: 'unsupported_database' });
  assert.ok(statements.some(sql => sql.includes("pragma_table_xinfo('receipts')")), 'schema cookie change runs the shared check');
});
