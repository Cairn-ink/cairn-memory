import test from 'node:test';
import assert from 'node:assert/strict';
import { safetyFixture, ns, ok, receipt } from '../testing/content-safety-s2h-fixture.mjs';
import { eventTimeSafetyFixture } from '../testing/receipt-event-time-fixture.mjs';
import { openMemoryCore } from '../index.mjs';
import { openContextReadSidecar } from '../context-read-sidecar.mjs';
import { drain, request } from '../testing/context-read-fixture.mjs';
import { transaction } from '../database.mjs';
import { withContentSuppressionRequest, writeContentSuppressionInside } from '../content-suppression-storage.mjs';

for(const layout of [48,53])for(const n of [130,1025])
test(`Raw-uncertain final fence bounds canonical keys and SELECT v${layout} n${n}`,async t=>{
  const f=(layout===53?eventTimeSafetyFixture:safetyFixture)(t,33);await f.migrate();
  const core=openMemoryCore({path:f.path}),db=f.connect();
  t.after(()=>{core.close();db.close();});
  assert.equal(db.prepare('PRAGMA user_version').get().user_version,layout);
  const memories=Array.from({length:n},(_,i)=>ok(core.admit({namespace:ns,
    memory:{content:'Synthetic fence common token '+i,kind:'fact'},receipts:[receipt('fence-'+i)]})).memory);
  const ordered=[...memories].sort((a,b)=>a.id<b.id?-1:1),suppressed=ordered[0],invalid=ordered.at(-1);
  const index=openContextReadSidecar({path:f.path,db});t.after(()=>index.close());drain(index);
  transaction(db,()=>writeContentSuppressionInside(db,{namespace:ns,kind:'memory',key:'unrelated-fence',reason:'purge',actionId:'unrelated'}));
  // Controls: direct suppression and invalid Raw ancestry in the last chunk
  // still win. Posting order is the canonical id order, not admission order.
  transaction(db,()=>{
    writeContentSuppressionInside(db,{namespace:ns,kind:'memory',key:suppressed.id,reason:'purge',actionId:'suppressed'});
    db.prepare('INSERT INTO raw_conversations VALUES(?,?,?,?,?,?,1,?,?)').run('foreign-raw','foreign-owner',ns.scope,ns.projectId,'codex','session','time','time');
    const id=db.prepare('SELECT id FROM receipts WHERE memory_id=?').get(invalid.id).id;
    db.prepare('INSERT INTO raw_receipt_lineage VALUES(?,?,?,?,?,?)').run(id,'foreign-raw','message',0,2,'exact');
  });
  const prepare=db.prepare.bind(db),batches=[];
  const hook=t.mock.method(db,'prepare',sql=>{
    const st=prepare(sql);
    if(!sql.includes('AS candidate_memories'))return st;
    const get=st.get.bind(st);
    st.get=(...args)=>{
      const keys=JSON.parse(args[0]),row=get(...args),selected=JSON.parse(row.candidate_memories);
      batches.push({keys:keys.length,selected:selected.length,invalidPresent:keys.some(key=>key[3]===invalid.id),sql});return row;
    };return st;
  });
  const started=performance.now();
  const result=withContentSuppressionRequest(()=>index.lexicalPage(request(),'Synthetic fence',24,{deadlineAt:started+5000}));
  hook.mock.restore();
  const elapsed=performance.now()-started;
  assert.equal(result.rows.length,24);
  assert.equal(result.matched,n-2,'all candidates, including later chunks, receive canonical validation');
  assert.ok(!result.rows.some(row=>[invalid.id,suppressed.id].includes(row.ref.memoryId)));
  assert.ok(elapsed<5000);t.diagnostic('FINAL_FENCE '+JSON.stringify({node:process.version,layout,n,elapsed,batches:batches.map(({keys,selected})=>({keys,selected}))}));

  // Control: let a deterministic clock expire after the first native
  // aggregate. The next chunk must not be prepared or executed.
  let aggregates=0,expired=false;
  const clock=performance.now.bind(performance);
  const timeHook=t.mock.method(performance,'now',()=>expired?Number.MAX_SAFE_INTEGER:clock());
  const sqlHook=t.mock.method(db,'prepare',sql=>{
    const st=prepare(sql);if(!sql.includes('AS candidate_memories'))return st;
    const get=st.get.bind(st);st.get=(...args)=>{aggregates++;const row=get(...args);expired=true;return row;};return st;
  });
  try {
    assert.throws(()=>withContentSuppressionRequest(()=>index.lexicalPage(request(),'Synthetic fence',24,{deadlineAt:clock()+5000})),{code:'index_unavailable',reason:'timeout'});
    assert.equal(aggregates,1,'deadline interrupts between bounded chunks');
  } finally {timeHook.mock.restore();sqlHook.mock.restore();}
  assert.ok(batches.length>=Math.ceil((n-1)/128),'fail-before: every canonical worklist is capped');
  assert.ok(batches.every(row=>row.keys<=128&&row.selected<=128),'fail-before: SELECT cannot aggregate more than 128 canonical rows');
  assert.ok(batches.every(row=>/LIMIT 128/.test(row.sql)),'fail-before: keyed input and SELECT carry explicit bounds');
  assert.equal(batches.at(-1).invalidPresent,true,'the last capped chunk still performs canonical Raw validation');
});
