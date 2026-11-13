import assert from 'node:assert/strict';
import { join } from 'node:path';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { openDatabase, transaction } from '../database.mjs';
import { openMemoryCore } from '../contract.mjs';
import { installPrivateCards, installCardMemorySources } from '../private-card-schema.mjs';
import { installPrivateEvidence } from '../private-evidence-schema.mjs';
import { SAFETY_SCHEMA_VERSIONS, resolveContentLayout } from '../content-safety-layout.mjs';
import { safetyFixture, copySqliteFixture, quiescence } from '../testing/content-safety-s2h-fixture.mjs';
import { eventTimeSafetyFixture } from '../testing/receipt-event-time-fixture.mjs';
import { migrateCardLineage } from '../content-safety-migration.mjs';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';

const plain = [18, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33];
const options = base => base === 18 ? {} : base === 23 ? { privateCards: true }
  : { [{24:'rawConversations',25:'rawCapture',26:'rawLineage',27:'rawDeletion',
    28:'rawSources',29:'localControls',30:'methodPackages',31:'assets',32:'roleProfiles',33:'currentDependencies'}[base]]: true };
const shape = [['owner_id',0,'BINARY'],['scope',0,'BINARY'],['project_id',0,'BINARY'],
  ['deleted',0,'BINARY'],['updated_at',1,'BINARY'],['id',0,'BINARY']];

const cells = [...plain, ...SAFETY_SCHEMA_VERSIONS].map(physical => ({ physical }));
for (const physical of [52,53]) for (const eventTime of [false,true]) cells.push({physical,lineage:true,eventTime});
for (const { physical, lineage, eventTime } of cells) test(`recency index shape and query plan: layout ${physical}, lineage ${Boolean(lineage)}, event time ${eventTime ?? 'default'}`, async t => {
  let path;
  if (SAFETY_SCHEMA_VERSIONS.includes(physical)) {
    const layout = resolveContentLayout(physical);
    const f = (layout.attestedFeatures && eventTime !== false ? eventTimeSafetyFixture : safetyFixture)(t, layout.base);
    if (!lineage || eventTime) await f.migrate();
    if (lineage) {
      let suppressionDomain;
      if (eventTime) {
        const db=f.connect();
        suppressionDomain=db.prepare('SELECT suppression_domain FROM content_safety_control').get().suppression_domain;
        db.close();
      }
      copySqliteFixture(f.path,f.backupPath);
      await migrateCardLineage({path:f.path,backupPath:f.backupPath,
        expected:{base:layout.base,storeId:f.storeId,...(suppressionDomain ? {suppressionDomain} : {})},quiescence});
    }
    path = f.path;
  } else {
    const workspace = createTestWorkspace(t, { prefix: 'recency-layout-' });
    path = join(workspace.path, 'store.sqlite');
    const early = [20,21,22].includes(physical);
    const db = openDatabase(path, options(early ? 18 : physical));
    if (early) transaction(db, () => {
      installPrivateCards(db);
      if (physical >= 21) installCardMemorySources(db);
      if (physical >= 22) installPrivateEvidence(db);
      db.exec('PRAGMA user_version=' + physical);
    });
    db.close();
  }
  const core = openMemoryCore({ path }); core.close();
  const db = new DatabaseSync(path); t.after(() => db.close());
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, physical);
  assert.deepEqual(db.prepare('SELECT name,desc,coll FROM pragma_index_xinfo(?) WHERE key=1 ORDER BY seqno')
    .all('namespace_memories').map(r => [r.name,r.desc,r.coll]), shape);
  const index = db.prepare('SELECT * FROM pragma_index_list(?) WHERE name=?').get('memories','namespace_memories');
  assert.equal(index.partial, 0); assert.equal(index.unique, 0);
  for (const continuation of [false, true]) for (const through of [false,true]) {
    const plan = db.prepare(`EXPLAIN QUERY PLAN SELECT id,revision,updated_at FROM memories
      INDEXED BY namespace_memories WHERE owner_id=? AND scope=? AND project_id=? AND deleted=0
      ${through ? 'AND updated_at >= ? AND (updated_at > ? OR (updated_at = ? AND id <= ?))' : ''}
      ${continuation ? 'AND updated_at <= ? AND (updated_at < ? OR (updated_at = ? AND id > ?))' : ''}
      ORDER BY updated_at DESC,id ASC LIMIT ?`).all('synthetic','personal','',
      ...(through ? ['2026-01-01','2026-01-01','2026-01-01','boundary'] : []),
      ...(continuation ? ['2026-01-01','2026-01-01','2026-01-01','last'] : []), 256);
    assert.ok(plan.some(r => r.detail.includes('USING INDEX namespace_memories')));
    assert.ok(plan.every(r => !r.detail.includes('TEMP B-TREE')), JSON.stringify(plan));
  }
});
