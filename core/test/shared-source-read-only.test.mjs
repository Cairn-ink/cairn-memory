import test from 'node:test';
import assert from 'node:assert/strict';
import { lineageFixture, ns, ok, receipt } from '../testing/card-lineage-fixture.mjs';
import { bindContentSafetyConnection } from '../content-safety-schema.mjs';
import { createPrivateEvidenceStorage } from '../private-evidence-storage.mjs';
import { receiptDenialTokens } from '../content-safety.mjs';
import { appendReceipts, trace, isLookup } from '../testing/shared-source-fixture.mjs';

test('evidence readers derive coverage from bounded headers without coordinate metadata', {timeout:15000}, async t => {
  const f = await lineageFixture(t, {base:33}), refs = [], expected = [];
  for (const [index, count] of [1,16,17,50,51].entries()) {
    const memory = ok(f.core.admit({namespace:ns, memory:{content:'Synthetic reader claim '+index,kind:'fact'},
      receipts:[receipt('synthetic-reader-'+index+'-0')]})).memory;
    appendReceipts(f,memory,Array.from({length:count-1}, (_,i)=>receipt('synthetic-reader-'+index+'-'+(i+1))));
    refs.push({type:'memory',namespace:ns,memoryId:memory.id,revision:memory.revision});
    if (count >= 50) {
      const rows = f.db.prepare('SELECT * FROM receipts WHERE memory_id=? ORDER BY created_at,id').all(memory.id);
      for (const row of rows.slice(0,50)) for (const token of receiptDenialTokens([row]))
        f.db.prepare('INSERT INTO suppressed VALUES(?,?,?,?)').run(ns.ownerId,ns.scope,ns.projectId,token);
    }
    expected.push({status:count===1||count===16?'complete':'budget_exhausted',
      included:count>=50?count-50:Math.min(count,16), omitted:count===17?null:count>=50?50:0});
  }
  const sql = [];
  const reader = bindContentSafetyConnection({
    get isTransaction() { return f.db.isTransaction; },
    prepare(text) {
      assert.match(text, /^\s*SELECT\b/);
      assert.doesNotMatch(text, /total_changes|data_version|SELECT count\(\*\) AS n FROM receipts/);
      sql.push(text);
      return f.db.prepare(text);
    },
  }, f.db);
  const storage = createPrivateEvidenceStorage({db:reader,identity:f.identity,
    cardDetailInside() { assert.fail('Memory-only read'); },
    receiptRefInside() { assert.fail('Selected rows bind receipt references directly'); }});
  f.db.exec('BEGIN');
  try {
    const result = storage.call('fetchEvidence',ns,{refs,intent:'current',responseByteLimit:65536},1);
    assert.deepEqual(result.items.map(item=>item.provenance.coverage),expected);
    assert.equal(result.items.at(-2).provenance.sources.length,0);
    assert.equal(result.items.at(-1).provenance.sources.length,1);
    assert.ok(sql.some(text=>text.includes('FROM json_each(?) j CROSS JOIN memories')));
  } finally { f.db.exec('ROLLBACK'); }
});

test('mixed selection warms only headers and shares one marker union', {timeout:15000}, async t => {
  const f = await lineageFixture(t, {base:33}), memories = [];
  for (let i=0; i<2; i++) memories.push(ok(f.core.admit({namespace:ns,
    memory:{content:'Synthetic mixed reader '+i,kind:'fact'},receipts:[receipt('synthetic-mixed-reader-'+i)]})).memory);
  const card = ok(f.call('createCardDraft',{actionId:'synthetic-reader-card',drafting:'authored',
    input:{title:'Synthetic reader Card',body:'Synthetic reader body',sourcePolicy:'retained-receipts-v1',
      memoryRefs:[{type:'memory',namespace:ns,memoryId:memories[0].id,revision:memories[0].revision}]}}));
  f.confirm(card);
  const measured = await trace(()=>f.call('selectEvidence',{query:'Synthetic',types:['memory','card'],intent:'current',limit:24}));
  const selected = ok(measured.result);
  assert.equal(selected.items.length,3);
  assert.equal(measured.rows.filter(isLookup).length,1);
  const first = measured.rows.find(row=>row.sql.startsWith('SELECT id,revision,currentness,review_state FROM memories'));
  assert.ok(first);
  assert.doesNotMatch(first.sql,/content|excerpt/);
});
