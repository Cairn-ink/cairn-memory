import test from 'node:test';
import assert from 'node:assert/strict';
import { productVectors } from '../context-product-vectors.mjs';
import { subsetFixture,personal,project,ok,snapshot,vector,sqlMeter,publication,card } from '../testing/context-product-subset-fixture.mjs';

const odd=project('a"\\,é'),collision=project('a"\\,é-more');
for(const namespaces of [[personal],[personal,odd]])test(`indexed vector ranges isolate exact escaped namespace, ${namespaces.length} selected`,t=>{
  const s=subsetFixture(t,{semantic:true,readSet:[personal,odd,collision],seed(f){
    return [personal,odd,collision].flatMap(ns=>Array.from({length:3},(_,i)=>f.admit('orchard vector '+i,ns)));
  }});
  const observed=s.vectors.observe({...s.p,namespaces},s.lexical,snapshot,{load:true});
  assert.equal(observed.status,'complete');assert.equal(observed.rows.length,namespaces.length*3);
  assert.ok(observed.rows.every(row=>namespaces.some(ns=>JSON.stringify(ns)===JSON.stringify(row.ref.namespace))));
  assert.equal(s.vectors.rank(observed,vector()).length,namespaces.length*3);
  assert.equal(observed.record.counts.vectors,9,'certificate stays publication-wide');
});

for(const damage of ['missing','extra','revision','body','representation','bytes','identity','stream','orphan'])test(`scoped vector ${damage} fails closed against same-snapshot documents`,async t=>{
  const s=subsetFixture(t,{semantic:true}),db=s.side();t.after(()=>db.close());
  const doc=db.prepare("SELECT d.doc,d.generation FROM documents d WHERE d.identity LIKE '%personal%' AND d.eligible=1").get();
  switch(damage){
    case 'missing':db.prepare('DELETE FROM vector_rows WHERE doc=?').run(doc.doc);break;
    case 'extra':{
      const r=db.prepare('SELECT * FROM vector_rows WHERE doc=?').get(doc.doc);
      // A syntactically selected item with no lexical document must be visible
      // to the range loader and refused, never silently dropped by an INNER JOIN.
      const item=JSON.stringify([personal.ownerId,'personal','','memory','orphan']);
      db.prepare('INSERT INTO vector_rows VALUES(?,?,?,?,?,?,?,?)').run(r.generation,999999,item,r.revision,r.body_revision,r.representation,r.vector,Buffer.from('orphan'));break;
    }
    case 'revision':db.prepare('UPDATE vector_rows SET revision=revision+1 WHERE doc=?').run(doc.doc);break;
    case 'body':db.prepare('UPDATE vector_rows SET body_revision=body_revision+1 WHERE doc=?').run(doc.doc);break;
    case 'representation':db.prepare("UPDATE vector_rows SET representation='bad' WHERE doc=?").run(doc.doc);break;
    case 'bytes':db.prepare("UPDATE vector_rows SET vector=x'00' WHERE doc=?").run(doc.doc);break;
    case 'identity':db.prepare("UPDATE vector_rows SET item=replace(item,'personal','project') WHERE doc=?").run(doc.doc);break;
    case 'stream':db.prepare('UPDATE documents SET stream=999 WHERE doc=? AND generation=?').run(doc.doc,doc.generation);break;
    case 'orphan':db.prepare('UPDATE vector_rows SET doc=999999 WHERE doc=?').run(doc.doc);break;
  }
  const observed=s.vectors.observe({...s.p,namespaces:[personal]},s.lexical,snapshot,{load:true});
  assert.equal(observed.status,'unavailable');assert.equal(observed.reason,'validation_invalid');assert.deepEqual(observed.rows,[]);
  // Public delivery may use the existing lexical degradation path. It must
  // refuse the damaged vector channel and never pretend the missing row is an
  // empty, ready subset. Selected canonical evidence still guards delivery.
  const result=await s.run('findCandidates',{namespaces:[personal],semantic:true});
  if(result.ok){assert.equal(result.value.trace.semantic.degradedReason,'validation_invalid');assert.notEqual(result.value.channels.semantic.state,'ready');}
  else assert.ok(['index_unavailable','evidence_unavailable'].includes(result.error.code));
});

test('missing excluded vectors do not relax the global complete-publication gate',async t=>{
  const s=subsetFixture(t,{semantic:true}),db=s.side();t.after(()=>db.close());
  db.exec('DELETE FROM vector_publications');
  const result=ok(await s.run('findCandidates',{namespaces:[personal],semantic:true}));
  assert.equal(result.trace.semantic.degradedReason,'missing_vectors');assert.equal(s.calls.provider,0);
  assert.equal(result.items.length,1);assert.deepEqual(result.items[0].ref.namespace,personal);
});

test('deleted vector outside selected ranges has no scoped effect; full load still refuses',async t=>{
  const s=subsetFixture(t,{semantic:true}),db=s.side();t.after(()=>db.close());
  const before=s.vectors.observe({...s.p,namespaces:[personal]},s.lexical,snapshot,{load:true});
  assert.equal(before.status,'complete');
  const excluded=db.prepare('SELECT doc FROM documents WHERE stream=1 AND eligible=1').get();
  db.prepare('DELETE FROM vector_rows WHERE doc=?').run(excluded.doc);
  const scoped=s.vectors.observe({...s.p,namespaces:[personal]},s.lexical,snapshot,{load:true});
  assert.equal(scoped.status,'complete');assert.deepEqual(scoped.rows,before.rows);
  const full=s.vectors.observe(s.p,s.lexical,snapshot,{load:true});
  assert.equal(full.status,'unavailable');assert.equal(full.reason,'validation_invalid');assert.deepEqual(full.rows,[]);
  assert.equal(ok(await s.run('findCandidates',{namespaces:[personal],semantic:true})).trace.effective,'hybrid');
});

test('selected document proof shares vector snapshot and is skipped without a ready vector load',async t=>{
  const s=subsetFixture(t,{semantic:true}),meter=sqlMeter();t.after(()=>meter.close());
  const ready=await meter.measure(()=>s.vectors.observe({...s.p,namespaces:[personal]},s.lexical,snapshot,{load:true}));
  assert.equal(ready.value.status,'complete');
  const begin=ready.events.findLastIndex(e=>e.sql==='BEGIN'),commit=ready.events.findLastIndex(e=>e.sql==='COMMIT');
  const ranges=ready.events.map((e,i)=>[e,i]).filter(([e])=>e.sql.includes('r.item<?')||e.sql.includes('selected_document'));
  assert.ok(ranges.length>=2);assert.ok(ranges.every(([,i])=>i>begin&&i<commit));
  for(const patch of [{semantic:false},{semantic:true}]){
    if(patch.semantic)s.setPolicy({semantic:false,purgeEpoch:0});
    const off=await meter.measure(()=>s.run('findCandidates',{namespaces:[personal],...patch}));
    ok(off.value);assert.ok(!off.events.some(e=>e.sql.includes('selected_document')));
  }
  const db=s.side();t.after(()=>db.close());db.exec('DELETE FROM vector_publications');
  const missing=await meter.measure(()=>s.vectors.observe({...s.p,namespaces:[personal]},s.lexical,snapshot,{load:true}));
  assert.equal(missing.value.status,'partial');assert.ok(!missing.events.some(e=>e.sql.includes('selected_document')));
});

test('storage unavailable after vector preflight refuses an empty ready subset',t=>{
  const s=subsetFixture(t,{semantic:true});let calls=0;
  const vectors=productVectors({facade:s.facade,storage:{...s.storage,vectors(...args){return ++calls===2?null:s.storage.vectors(...args);}}});
  const observed=vectors.observe({...s.p,namespaces:[personal]},s.lexical,snapshot,{load:true});
  assert.equal(observed.status,'unavailable');assert.equal(observed.reason,'validation_invalid');assert.deepEqual(observed.rows,[]);
});

test('a genuinely empty selected population stays ready without admitting excluded vectors',async t=>{
  const s=subsetFixture(t,{semantic:true,seed:f=>[f.admit('orchard excluded',project('b'))]});
  const observed=s.vectors.observe({...s.p,namespaces:[personal]},s.lexical,snapshot,{load:true});
  assert.equal(observed.status,'complete');assert.deepEqual(observed.rows,[]);
  const value=ok(await s.run('findCandidates',{namespaces:[personal],semantic:true}));
  assert.deepEqual(value.items,[]);assert.equal(value.channels.semantic.state,'ready');
  assert.equal(value.coverage.omitted.lexical,0);assert.equal(value.coverage.omitted.semantic,0);
});

test('a document stream reassigned within the selected namespaces still refuses',t=>{
  const s=subsetFixture(t,{semantic:true}),db=s.side();t.after(()=>db.close());
  db.prepare('UPDATE documents SET stream=1 WHERE stream=0').run();
  const observed=s.vectors.observe({...s.p,namespaces:[personal,project('a')]},s.lexical,snapshot,{load:true});
  assert.equal(observed.status,'unavailable');assert.equal(observed.reason,'validation_invalid');assert.deepEqual(observed.rows,[]);
});

test('ready hybrid restricts Card and Memory vectors with original full-publication stream numbers',async t=>{
  const s=subsetFixture(t,{cards:true,semantic:true,seed(f){
    const rows=publication.map((namespace,i)=>f.admit('orchard memory '+i,namespace));
    for(const [i,namespace] of publication.entries())card(f,namespace,'orchard card '+i,'synthetic authored support '+i);
    return rows;
  }});
  for(const namespaces of [[personal],[personal,project('a')]]){
    const observed=s.vectors.observe({...s.p,namespaces},s.lexical,snapshot,{load:true});
    assert.equal(observed.status,'complete');assert.equal(observed.rows.length,namespaces.length*2);
    assert.equal(observed.record.counts.vectors,6);
    assert.deepEqual([...new Set(observed.rows.map(row=>row.ref.type))].sort(),['card','memory']);
    const value=ok(await s.run('findCandidates',{namespaces,semantic:true,limit:24}));
    assert.equal(value.channels.semantic.state,'ready');assert.equal(value.items.length,namespaces.length*2);
    assert.ok(value.items.every(item=>item.channels.semantic!==null&&namespaces.some(ns=>JSON.stringify(ns)===JSON.stringify(item.ref.namespace))));
    assert.equal(value.coverage.byType.card.eligible,null);assert.equal(value.coverage.byType.card.embedded,null);
    assert.equal(value.coverage.byType.card.scanned,namespaces.length);
  }
});
