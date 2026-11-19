import test from 'node:test';
import assert from 'node:assert/strict';
import { subsetFixture,personal,project,ok,sqlMeter } from '../testing/context-product-subset-fixture.mjs';

test('nonempty scoped posting and vector joins use bounded index ranges and point document probes',async t=>{
  const s=subsetFixture(t,{semantic:true,seed(f){
    for(let i=0;i<260;i++)f.admit('orchard excluded '+i,project('b'));
    return [...Array.from({length:260},(_,i)=>f.admit('orchard selected '+i,personal)),f.admit('different nonmatching term',project('a'))];
  }}),meter=sqlMeter();t.after(()=>meter.close());
  const measured=await meter.measure(()=>s.run('findCandidates',{namespaces:[personal],semantic:true,limit:24}));
  const value=ok(measured.value);assert.equal(value.items.length,24);
  const db=s.side();t.after(()=>db.close());
  const posting=measured.events.filter(e=>e.sql.includes('FROM postings p INDEXED BY product_term LEFT JOIN documents d'));
  assert.ok(posting.length>=3,'all-excluded pages still advance the raw cursor');
  assert.equal(posting.reduce((n,e)=>n+e.rows,0),520);
  const vector=measured.events.filter(e=>e.sql.includes('FROM vector_rows r')&&e.sql.includes('r.item<?'));
  assert.ok(vector.length>=3);assert.equal(vector.reduce((n,e)=>n+e.rows,0),260);
  const proof=measured.events.filter(e=>e.sql.includes('FROM documents selected_document'));
  assert.ok(proof.length>=3);assert.equal(proof.reduce((n,e)=>n+e.rows,0),260);
  for(const event of proof){
    const plan=db.prepare('EXPLAIN QUERY PLAN '+event.sql).all(...event.args).map(row=>row.detail).join('\n');
    assert.match(plan,/SEARCH selected_document USING INDEX .*\(generation=\? AND stream=\? AND id>\?\)/);
    assert.doesNotMatch(plan,/SCAN selected_document/);assert.ok(event.rows<=128);
    t.diagnostic(JSON.stringify({sql:event.sql,plan,rows:event.rows}));
  }
  for(const event of [...posting,...vector]){
    const plan=db.prepare('EXPLAIN QUERY PLAN '+event.sql).all(...event.args).map(row=>row.detail).join('\n');
    assert.match(plan,/SEARCH .*statistics.*\(generation=\? AND term=\?\)|SEARCH .*vector_rows.*\(generation=\? AND item>\? AND item<\?\)/);
    assert.match(plan,/SEARCH d USING PRIMARY KEY \(generation=\? AND doc=\?\) LEFT-JOIN/);
    assert.doesNotMatch(plan,/SCAN (?:d|documents|r|vector_rows)\b/);
    assert.ok(event.rows<=128);
    t.diagnostic(JSON.stringify({sql:event.sql,plan,rows:event.rows}));
  }
  for(const event of posting){
    const plan=db.prepare('EXPLAIN QUERY PLAN '+event.sql).all(...event.args).map(row=>row.detail).join('\n');
    assert.match(plan,/SEARCH p USING COVERING INDEX product_term \(generation=\? AND term=\? AND doc>\?\)/);
    assert.doesNotMatch(plan,/MATERIALIZE|TEMP B-TREE/);
  }
  // EQP reports a range even if SQLite chose a constant namespace prefix as
  // its lower bound. Verify the actual VDBE seek advances to the prior page's
  // last item; otherwise every page can rescan the namespace from its start.
  const cursors=new Map();
  for(const event of vector){
    const plan=db.prepare('EXPLAIN QUERY PLAN '+event.sql).all(...event.args).map(row=>row.detail).join('\n');
    const indexName=/SEARCH r USING INDEX (\w+)/.exec(plan)?.[1];assert.ok(indexName);
    const root=db.prepare('SELECT rootpage FROM sqlite_schema WHERE name=?').get(indexName).rootpage;
    const program=db.prepare('EXPLAIN '+event.sql).all(...event.args);
    const cursor=program.find(op=>op.opcode==='OpenRead'&&op.p2===root);assert.ok(cursor);
    const seek=program.find(op=>['SeekGT','SeekGE'].includes(op.opcode)&&op.p1===cursor.p1);assert.ok(seek);
    const parameter=program.filter(op=>op.opcode==='Variable'&&op.addr<seek.addr&&op.p2===seek.p3+1).at(-1);assert.ok(parameter);
    const key=event.args[3],after=cursors.get(key)??event.args[2];
    assert.equal(event.args[parameter.p1-1],after,'the native index seek uses the moving page cursor');
    const page=db.prepare(event.sql).all(...event.args);if(page.length)cursors.set(key,page.at(-1).item);
    t.diagnostic(JSON.stringify({seek:seek.opcode,cursorParameter:parameter.p1,rows:page.length}));
  }
  assert.equal(measured.events.filter(e=>e.sql==='BEGIN').length,measured.events.filter(e=>['COMMIT','ROLLBACK'].includes(e.sql)).length);
  assert.ok(!measured.events.some(e=>/^(INSERT|UPDATE|DELETE|CREATE)\b/.test(e.sql)),'reads perform no maintenance writes');
  const missing=await meter.measure(()=>s.run('findCandidates',{namespaces:[personal],query:'absentterm'}));
  assert.equal(ok(missing.value).items.length,0);
  assert.equal(missing.events.filter(e=>e.sql.includes('FROM postings p INDEXED BY product_term LEFT JOIN documents d')).reduce((n,e)=>n+e.rows,0),0);
});
