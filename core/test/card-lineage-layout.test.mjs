import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lineageFixture,ns,ok } from '../testing/card-lineage-fixture.mjs';
import { attestContentSafety,cardLineageRevision } from '../content-safety-schema.mjs';
import { resolveContentLayout,contentSafetyPin } from '../content-safety-layout.mjs';
import { cardLineageDDL,authoredInvalidationDDL } from '../card-lineage-schema.mjs';
import { installCardMemoryInvalidation } from '../private-card-schema.mjs';

for(const base of [23,33])for(const eventTime of [false,true])test(`complete exact tuple ${base}, event time ${eventTime}`,async t=>{
  const f=await lineageFixture(t,{base,eventTime}),layout=attestContentSafety(f.db);
  assert.equal(layout.physical,base===23?52:53);assert.equal(cardLineageRevision(layout),1);
  assert.equal(contentSafetyPin(layout,f.storeId).cardLineageRevision,1);
  assert.equal(f.db.prepare('SELECT receipt_event_time FROM content_safety_control').get().receipt_event_time,Number(eventTime));
  assert.equal(f.db.prepare("SELECT 1 FROM pragma_table_info('receipts') WHERE name='occurred_at'").get()!==undefined,eventTime);
  assert.equal(f.db.prepare("SELECT 1 FROM pragma_table_info('content_safety_control') WHERE name='engine_capture_cards_revision'").get(),undefined);
  const declarations=cardLineageDDL.match(/CREATE (?:TABLE|(?:UNIQUE )?INDEX)[\s\S]*?;|CREATE TRIGGER[\s\S]*?END;/g);
  assert.equal(declarations.length,17);
    assert.equal(createHash('sha256').update(cardLineageDDL).digest('hex'),'5981bb49d17cd0a2909e12efef4cb1dd92a43ebf59114fe9354c375c8bcb01ef');
  const normalize=s=>s.trim().replace(/;$/,'').replace(/\s+/g,' ');
  for(const sql of declarations) {
    const name=sql.match(/^CREATE (?:UNIQUE )?(?:TABLE|INDEX|TRIGGER) (\w+)/)[1];
    assert.equal(normalize(f.db.prepare('SELECT sql FROM sqlite_schema WHERE name=?').get(name).sql),normalize(sql),name);
  }
  const n=f.note('source'),card=f.draft([n]);assert.ok(ok(f.call('getCard',{cardId:card.id})).card);
});

test('invalidation delta changes exactly the assignment list on both bases',()=>{
  for(const base of [23,33]) {
    let original;installCardMemoryInvalidation({exec:sql=>{original=sql;}},base===33);
    const strip=sql=>sql.replace(/UPDATE private_cards SET[\s\S]*?\n      WHERE/,'UPDATE private_cards SET <assignments>\n      WHERE');
    assert.equal(strip(authoredInvalidationDDL(base)),strip(original));
    assert.match(authoredInvalidationDDL(base),/UPDATE private_cards SET revision=revision\+1,updated_at=NEW.updated_at\n      WHERE/);
  }
});
test('base eighteen, reserved cells and other lineage revisions refuse',async t=>{
  for(const physical of [49,50,54])assert.throws(()=>resolveContentLayout(physical),/unsupported_database/);
  const f=await lineageFixture(t);
  for(const sql of [
    'DROP TRIGGER safety_control_update; UPDATE content_safety_control SET card_lineage_revision=0',
    'PRAGMA ignore_check_constraints=ON; DROP TRIGGER safety_control_update; UPDATE content_safety_control SET card_lineage_revision=2',
    'ALTER TABLE content_safety_control ADD COLUMN engine_capture_cards_revision INTEGER',
    'ALTER TABLE receipts ADD COLUMN occurred_at TEXT',
    'DROP TRIGGER safety_source_insert',
    'DROP TRIGGER card_memory_revision_invalidation',
    "CREATE TRIGGER unexpected_base_trigger AFTER UPDATE ON memories BEGIN SELECT 1; END",
    'CREATE INDEX unexpected_base_index ON memories(content)',
  ]) {
    const db=f.connect();db.exec('BEGIN');
    try {
      db.exec(sql);assert.throws(()=>attestContentSafety(db),/unsupported_database/);
    } finally {db.exec('ROLLBACK');db.close();}
  }
});
