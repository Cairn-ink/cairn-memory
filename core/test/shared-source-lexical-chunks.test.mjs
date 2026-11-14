import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { DatabaseSync } from 'node:sqlite';
import { Worker, MessageChannel, receiveMessageOnPort } from 'node:worker_threads';
import { once } from 'node:events';
import { fixture, trace, memoryRef, hasId, isLookup } from '../testing/shared-source-fixture.mjs';
import { lineageFixture, lineageHost, ns, ok, receipt } from '../testing/card-lineage-fixture.mjs';
import { layoutFixture } from '../testing/recall-recency-fixture.mjs';
import { openMemoryCore } from '../index.mjs';
import { openContextReadSidecar } from '../context-read-sidecar.mjs';
import { openContextProductFacade } from '../context-read-facade.mjs';
import { openProductIndex } from '../context-product-index.mjs';
import { productSidecar, PRODUCT_SIDECAR_SUFFIX } from '../context-product-sidecar.mjs';
import { createProductSqlitePolicy } from '../context-product-sqlite.mjs';
import { accessDigest } from '../context-product-validation.mjs';
import { descriptor } from '../testing/context-product-owner-fixture.mjs';
import { createBM25 } from '../context-read-bm25.mjs';
import { tokenizeT1 } from '../context-read-tokenize.mjs';
import { cardDeliverySnapshot, cardDeliverable, receiptDenialTokens } from '../content-safety.mjs';
import { readTransaction } from '../database.mjs';
import { withContentSuppressionRequest, contentSuppressionRequestInside } from '../content-suppression-storage.mjs';

const routes=['embedded','ordinary','suppressed'];
const collector=row=>row.sql.includes('CROSS JOIN card_memory_bindings b');
const query='needle pear';
const selection={readSet:[ns],types:['card'],intent:'current'};
const projection={...selection,accessGeneration:1};

// A lineage-enabled, Raw-incapable package keeps this public route valid on
// the pre-chunking implementation as well as on the current implementation.
const lexicalFixture=(t,route)=>route==='suppressed'?lineageFixture(t,{base:23}):
  fixture(t,route==='ordinary'?'ordinary-48':'ordinary-53');

// Public Card creation follows the existing shared-source context fixture;
// admit avoids model work. Independent Memories avoid dependent-Card limits.
function card(f,i,{title='Synthetic needle '+i,body=i%2?'needle pear pear':'needle needle pear'}={}){
  const memory=ok(f.core.admit({namespace:ns,memory:{content:'Synthetic support '+i,kind:'fact'},
    receipts:[receipt('synthetic-chunk-'+i)]})).memory;
  let value=ok(f.call('createCardDraft',{actionId:'synthetic-chunk-draft-'+i,drafting:'authored',
    input:{title,body,memoryRefs:[memoryRef(memory)],sourcePolicy:'retained-receipts-v1'}}));
  value=ok(f.call('confirmCardDraft',{actionId:'synthetic-chunk-confirm-'+i,cardId:value.id,
    expectedRevision:value.revision,applicability:'current'}));
  return {memory,ref:{type:'card',namespace:ns,cardId:value.id,revision:value.revision,bodyRevision:value.bodyRevision},text:title+'\n'+body};
}

function sidecar(t,f,route,clock=()=>performance.now(),options={}){
  if(route==='embedded'){
    const storage=openContextReadSidecar({path:f.path,db:f.db});t.after(()=>storage.close());
    return {storage,refresh(){
      for(let i=0;i<16;i++)if(storage.reconcile({...projection,budget:{maxItems:1024,maxMs:5000}}).status==='complete')return;
      assert.fail('embedded publication did not finish');
    },lexical(deadlineAt=Infinity){return storage.lexicalPage(projection,query,24,{deadlineAt});}};
  }
  const facade=openContextProductFacade(f.path,{sqlite:options.sqlite}),p={...projection,ownerCoverage:descriptor([ns])};
  const storage=productSidecar({path:f.path,db:facade.port.db,identity:facade.port.identity,
    features:facade.port.features,writable:true,now:clock,...options});
  t.after(()=>{storage.close();facade.close();});
  const access=accessDigest({ownerId:ns.ownerId,namespaces:{readSet:[ns]}});let publication;
  const observe=()=>{
    const observed=storage.observe(p,access);
    if(observed.dto.lexical.state==='ready')publication=observed.publication;
    return observed;
  };
  return {storage,observe,withCanonicalRead:work=>readTransaction(facade.port.db,work),refresh(){
    for(let i=0;i<16;i++){
      storage.refresh(p,access,{maxItems:1024,maxMs:5000});
      const observed=observe();
      if(observed.dto.lexical.state==='ready'){publication=observed.publication;return;}
    }
    assert.fail('product publication did not finish');
  },lexical(deadlineAt=Infinity,text=query){return withContentSuppressionRequest(()=>{
    // Match the public index: request-scoped observation finishes its read
    // before lexical work reuses the cached suppression proof.
    contentSuppressionRequestInside(facade.port.db,p.readSet,{defer:true});
    if(facade.port.db.isTransaction)observe();else readTransaction(facade.port.db,observe);
    return storage.lexical({...p,deadlineAt},publication,text);
  });}};
}

function pages(t,f,route,options={}){
  if(route==='embedded')return input=>f.trusted.call(f.context,'findCandidates',input);
  const facade=openContextProductFacade(f.path,{sqlite:options.sqlite});
  if(options.onCursor){
    const encode=facade.port.encode;
    facade.port.encode=(purpose,value,...args)=>{
      const token=encode(purpose,value,...args);
      if(purpose==='cursor')options.onCursor(token,facade.port.db);
      return token;
    };
  }
  const index=openProductIndex({path:f.path,facade,ownerCoverage:descriptor([ns]),maintenance:true,
    ...options,
    authorize:()=>({accessGenerations:accessDigest({ownerId:ns.ownerId,namespaces:{readSet:[ns]}}),check(){},envelope:work=>work()})});
  t.after(()=>{index.close();facade.close();});
  const call=input=>index.run('findCandidates',input,{});
  call.refresh=()=>{
    for(let i=0;i<16;i++){
      const value=ok(index.run('refreshContextIndex',{...selection,mode:'lexical',budget:{maxItems:1024,maxMs:5000}},{}));
      if(value.status==='complete')return;
    }
    assert.fail('public product publication did not finish');
  };
  return call;
}

async function cachedPages(call){
  const values=[];let cursor;
  for(let i=0;i<24;i++){
    const value=ok(await call({...selection,query,semantic:false,limit:1,deadlineMs:5000,...(cursor?{cursor}:{})}));
    values.push(value);cursor=value.nextCursor;
    if(!cursor)return values;
  }
  assert.fail('ranking pagination exceeded its 24-row horizon');
}

function mark(f,document){
  const headers=f.db.prepare('SELECT receipt_key,client,session_id,event_id,role FROM receipts WHERE memory_id=?').all(document.memory.id);
  for(const token of receiptDenialTokens(headers))f.db.prepare('INSERT INTO suppressed VALUES(?,?,?,?)')
    .run(ns.ownerId,ns.scope,ns.projectId,token);
}

function sibling(f,i){
  return ok(f.core.admit({namespace:ns,memory:{content:'Synthetic sibling '+i,kind:'fact'},
    receipts:[receipt('synthetic-chunk-'+i)]})).memory;
}
function forget(f,memory){
  return ok(f.core.forget({namespace:ns,memoryId:memory.id,expectedRevision:memory.revision}));
}
const expectedRows=(documents,text=query)=>createBM25(documents.map(({ref,text})=>({ref,text}))).search(text);
const publicRows=value=>value.items.map(({ref,channels})=>({ref,score:channels.lexical.rawScore}));
const posting=sql=>sql.startsWith('SELECT p.doc FROM postings p INDEXED BY product_term');

// The trace hook arms the existing clock after the last first-pass marker
// lookup. There is then exactly one clock check per remaining chunk document.
// The following check is the replay entry, before its first posting statement:
// both the denial aggregates and the first-pass heap have finished by then.
function replayBoundary(population,write){
  let chunks=0,remaining=null,armed=false,committed=false,canonical,side;
  const events=[],writers=new Set();
  return {events,writers,get committed(){return committed;},
    now(){
      if(remaining===0){remaining=null;committed=true;write({canonical,side});}
      else if(remaining!==null)remaining--;
      return 0;
    },
    onSql(sql,args,connection){
      if(committed&&/^(INSERT|UPDATE|DELETE)\b/.test(sql))writers.add(connection);
      if(posting(sql)&&!side)side=connection;
      if(collector({sql})&&!canonical)canonical=connection;
      if(((collector({sql})||isLookup({sql}))&&connection===canonical)||(posting(sql)&&connection===side)){
        events.push({sql,connection,transaction:connection.isTransaction});
      }
      if(committed)return;
      if(collector({sql}))chunks++;
      if(!armed&&chunks===Math.ceil(population/128)&&isLookup({sql})){
        armed=true;remaining=(population-1)%128+1;
      }
    },
  };
}

function assertReplaySnapshots(measured,boundary){
  assert.equal(boundary.committed,true,'the inter-pass write actually committed');
  assert.ok(boundary.events.every(event=>event.transaction),'both connections remain inside read transactions');
  assert.ok(boundary.writers.size>0,'real mutation statements executed');
  for(const connection of boundary.writers){
    assert.equal(connection.isTransaction,false,'the other connections committed');
    assert.equal(boundary.events.some(event=>event.connection===connection),false,'writes use other connections');
  }
  const tokens=measured.rows.filter(collector),postings=measured.rows.filter(row=>posting(row.sql));
  const markers=measured.rows.filter(isLookup);
  assert.equal(markers.length,2,'one marker statement in each pass');
  assert.ok(markers.every(row=>row.snapshot===tokens[0].snapshot),'both marker reads share the token snapshot');
  assert.equal(tokens.length,2,'one collector in each pass');
  for(const rows of [tokens,postings]){
    assert.ok(rows.length>1);
    assert.notEqual(rows[0].snapshot,undefined,'an explicit BEGIN owns the reads');
    assert.equal(new Set(rows.map(row=>row.snapshot)).size,1,'both passes use one snapshot on this database');
  }
  assert.notEqual(tokens[0].snapshot,postings[0].snapshot,'canonical and sidecar have separate connections');
}

// The deadline aborts canonical lexical work before the next statement.
// readTransaction's ROLLBACK passes through the WAL wait-policy proxy, which
// can refresh its native busy timeout before releasing the snapshot. The
// checkpoint probe runs outside trace; the public failure fence is independent.
const cutoffCleanupStatements=[{
  shape:/^PRAGMA busy_timeout=(?:0|[1-9][0-9]*)$/,
  reason:'topic-reader-sqlite invoke configures the WAL timeout immediately before readTransaction ROLLBACK',
}];
function assertNoCanonicalReadAfterCutoff(measured,number=1,cutoffRow){
  const row=cutoffRow??measured.rows.filter(collector)[number-1],start=measured.rows.indexOf(row);
  assert.ok(row);
  const end=measured.rows.findIndex((item,i)=>i>start&&item.snapshot===row.snapshot&&item.sql==='ROLLBACK');
  assert.ok(end>start,'the timed canonical snapshot rolled back');
  const after=measured.rows.slice(start+1,end).filter(item=>item.snapshot===row.snapshot);
  const lexical=after.filter(item=>!cutoffCleanupStatements.some(({shape})=>shape.test(item.sql)));
  assert.deepEqual(lexical,[],
    'no canonical lexical statement (collector, marker lookup, candidate validation or snapshot SELECT) starts after cutoff; '+
    'only cleanup is allowed: '+cutoffCleanupStatements.map(item=>item.reason).join('; '));
  for(const item of after){
    assert.deepEqual(item.args,[],'cleanup configures the connection without lexical bindings');
    const next=measured.rows[measured.rows.indexOf(item)+1];
    assert.equal(next?.sql,'ROLLBACK',
      'the allowed busy_timeout belongs to rollback cleanup, never subsequent lexical work');
    assert.equal(next?.snapshot,row.snapshot,'cleanup releases the timed canonical snapshot');
  }
  assert.equal(measured.rows.slice(start+1).filter(isLookup).length,0,'no subsequent marker lookup on the call');
}

// Same reader-release witness as sqlite-lock-safety's WAL checkpoint case.
// Commit fresh frames after the read so a leaked snapshot cannot pass vacuously.
function assertReadersReleased(f){
  for(const [path,table]of [[f.path,'store_metadata'],[f.path+PRODUCT_SIDECAR_SUFFIX,'product_metadata']]){
    const writer=new DatabaseSync(path);
    try{
      writer.exec('PRAGMA busy_timeout=0');
      assert.equal(writer.prepare('PRAGMA journal_mode').get().journal_mode,'wal');
      const original=writer.prepare(`SELECT store_id FROM ${table} WHERE singleton=1`).get().store_id;
      const update=writer.prepare(`UPDATE ${table} SET store_id=? WHERE singleton=1`);
      try{update.run(original+'-synthetic-checkpoint');}finally{update.run(original);}
      const checkpoint=writer.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get();
      assert.equal(checkpoint.busy,0,JSON.stringify(checkpoint));
      assert.equal(checkpoint.log,0,'WAL was truncated');
      assert.equal(checkpoint.checkpointed,0);
    }finally{writer.close();}
  }
}

// Extend the cooperative lexical deadline contract and product timeout mapping
// with expiry inside the Card population, rather than only at entry/guard time.
for(const route of routes)test(`Card token chunks and mid-population deadline: ${route}`,{timeout:120000},async t=>{
  const f=await lexicalFixture(t,route);
  const documents=Array.from({length:300},(_,i)=>card(f,i));
  let clock=0,samples=0;
  const a=sidecar(t,f,route,()=>{samples++;return clock;});a.refresh();
  const measured=await trace(()=>a.lexical()),collections=measured.rows.filter(collector);
  // The embedded final validation is a separate canonical snapshot of <=24
  // selected rows. Population chunks share one fence snapshot.
  const population=route==='embedded'?collections.filter(row=>row.snapshot===collections[0].snapshot):collections;
  assert.deepEqual(population.map(row=>JSON.parse(row.args[0]).length),[128,128,44]);
  assert.equal(population.length,Math.ceil(documents.length/128));
  assert.ok(collections.every(row=>JSON.parse(row.args[0]).length<=128));
  assert.equal(measured.result.matched,300);
  const expected=createBM25(documents.map(d=>({ref:d.ref,text:d.text}))).search(query);
  assert.deepEqual(measured.result.rows,expected,'unchanged BM25 arithmetic, order and ties');
  const ordered=expected.map(({ref,score})=>{
    const selected=route==='embedded'?{type:ref.type,namespace:ref.namespace,revision:ref.revision,
      cardId:ref.cardId,bodyRevision:ref.bodyRevision}:ref;
    return route==='ordinary'?{score,ref:selected}:{ref:selected,score};
  });
  assert.equal(JSON.stringify(measured.result.rows),JSON.stringify(ordered),'base row/ref key order and bytes');
  const original=performance.now.bind(performance);let expired=false,reads=0,checksAfterExpiry=0,samplesAtExpiry;
  t.mock.method(performance,'now',()=>{
    if(expired)checksAfterExpiry++;
    return expired?Number.MAX_SAFE_INTEGER:original();
  });
  const cutoff=route==='embedded'?original()+5000:1;
  const timed=await trace(()=>{
    assert.throws(()=>a.lexical(cutoff),route==='embedded'?{code:'index_unavailable',reason:'timeout'}:{code:'read_timeout'});
  },(sql)=>{
    if(collector({sql})&&++reads===1){expired=true;clock=1;samplesAtExpiry=samples;}
  });
  assert.equal(timed.rows.filter(collector).length,1,'no second token statement after cutoff');
  assertNoCanonicalReadAfterCutoff(timed);
  assert.ok(route==='embedded'?checksAfterExpiry>0:samples>samplesAtExpiry,'existing clock consulted after the first chunk');
  if(route!=='ordinary'){
    expired=false;clock=0;let canonical,markers=false,cutoffSql;
    const validation=await trace(()=>{
      assert.throws(()=>a.lexical(cutoff),route==='embedded'?{code:'index_unavailable',reason:'timeout'}:{code:'read_timeout'});
    },(sql,args,connection)=>{
      if(collector({sql}))canonical=connection;
      else if(connection===canonical&&isLookup({sql}))markers=true;
      else if(markers&&connection===canonical&&!cutoffSql){cutoffSql=sql;expired=true;clock=1;}
    });
    assert.ok(cutoffSql,'expiry also occurs during canonical candidate validation');
    const marker=validation.rows.findIndex(isLookup);
    const cutoffRow=validation.rows.find((row,i)=>i>marker&&row.sql===cutoffSql);
    assertNoCanonicalReadAfterCutoff(validation,1,cutoffRow);
    expired=false;clock=0;
    assert.deepEqual(a.lexical().rows,expected,'a validator deadline does not poison the canonical connection');
  }
  expired=false;clock=0;reads=0;
  const call=pages(t,f,route);
  const delivered=await trace(()=>call({...selection,query,semantic:false,limit:1,deadlineMs:5000}),sql=>{
    if(collector({sql})&&++reads===1)expired=true;
  });
  assert.equal(delivered.rows.filter(collector).length,1);
  assertNoCanonicalReadAfterCutoff(delivered);
  if(route==='embedded'){
    assert.equal(delivered.result.ok,false);assert.equal(delivered.result.error.code,'index_unavailable');
    const details=delivered.result.error.details;
    assert.equal(details.channels.lexical.state,'timeout');assert.equal(details.coverage.stops.deadline,true);
  }else assert.deepEqual(delivered.result,{ok:false,error:{code:'read_timeout',retryable:false}});
  // A deadline inside the population is a cooperative stop between statements:
  // the same handles serve the next read completely.
  expired=false;clock=0;reads=0;
  const next=a.lexical();
  assert.equal(next.matched,300);
  assert.deepEqual(next.rows,expected,'the next storage read on the same connection is complete');
  const served=await call({...selection,query,semantic:false,limit:1,deadlineMs:5000});
  assert.equal(served.ok,true,'the next public read on the same handles succeeds');
});

for(const route of ['ordinary','suppressed'])
test(`deadline before the canonical lexical enclosure: ${route}`,async t=>{
  const f=await lexicalFixture(t,route),documents=Array.from({length:3},(_,i)=>card(f,i));
  sidecar(t,f,route).refresh();
  let expire=false,atEntry=false,lexicalPending=false,samplesAtEntry;
  const samples=[],now=()=>{const value=expire&&atEntry?1:0;samples.push(value);return value;};
  const rendezvous=phase=>{
    if(phase==='lexical')lexicalPending=true;
    if(phase==='snapshot'&&lexicalPending){
      lexicalPending=false;atEntry=true;samplesAtEntry=samples.length;
    }
  };
  // Separate readers retain the same native connections after a timeout.
  const a=sidecar(t,f,route,now,{rendezvous});
  const call=pages(t,f,route,{now,storageOptions:{rendezvous}});
  const expected=expectedRows(documents);
  for(const entry of ['storage','held-storage','public']){
    const connections=new Map(),afterEntry=[];
    const onSql=(sql,args,connection)=>{
      if(expire&&atEntry)afterEntry.push(sql);
      const key=collector({sql})?'canonical':posting(sql)?'sidecar':null;
      if(!key)return;
      if(!connections.has(key))connections.set(key,connection);
      else assert.equal(connection,connections.get(key),'reuse the same native '+key+' connection');
    };
    const work=()=>entry==='public'?call({...selection,query,semantic:false,limit:3,deadlineMs:1}):
      entry==='held-storage'?a.withCanonicalRead(()=>a.lexical(1)):a.lexical(1);
    const complete=result=>{
      if(entry==='public'){
        const value=ok(result);
        assert.deepEqual(publicRows(value),expected);
        assert.equal(value.coverage.omitted.lexical,0);assert.equal(value.nextCursor,null);
      }else{assert.equal(result.matched,3);assert.deepEqual(result.rows,expected);}
    };
    expire=false;atEntry=false;
    complete((await trace(work,onSql)).result);
    assert.equal(connections.size,2);
    expire=true;atEntry=false;
    const timed=await trace(()=>{
      if(entry==='public')assert.deepEqual(work(),{ok:false,error:{code:'read_timeout',retryable:false}});
      else assert.throws(work,{code:'read_timeout'});
    },onSql);
    assert.equal(atEntry,true,'the call reached the canonical enclosure decision');
    assert.equal(samples[samplesAtEntry-1],0,'the preceding clock sample passed');
    assert.deepEqual(samples.slice(samplesAtEntry),[1],'the entry check reports exactly the cutoff');
    const boundary=timed.rows.findLastIndex(row=>row.sql==='PRAGMA schema_version');
    assert.ok(boundary>=0,'the sidecar snapshot was acquired before the entry check');
    assert.equal(timed.rows.slice(boundary+1).some(row=>/^BEGIN\b/.test(row.sql)),false,
      'no canonical BEGIN starts at the cutoff, including when the caller already owns the read');
    assert.deepEqual(afterEntry,[],'no canonical lexical statement starts at the cutoff');
    assert.equal(timed.rows.filter(collector).length,0);assert.equal(timed.rows.filter(row=>posting(row.sql)).length,0);
    assert.ok([...connections.values()].every(connection=>connection.isOpen&&!connection.isTransaction));
    expire=false;atEntry=false;
    complete((await trace(work,onSql)).result);
  }
});

test('ordinary replay deadline rolls back and the same connections serve a complete next read',{timeout:120000},async t=>{
  const f=await fixture(t,'ordinary-48'),documents=Array.from({length:300},(_,i)=>card(f,i));
  mark(f,documents[0]);
  let clock=0,reads=0,samples=0,samplesAtExpiry;
  sidecar(t,f,'ordinary').refresh();
  // Open a separate reader, as the product does. Maintenance handles may be
  // discarded after errors; this read-only native handle must remain usable.
  const a=sidecar(t,f,'ordinary',()=>{samples++;return clock;});
  assert.equal(a.observe().dto.lexical.state,'ready');
  const expected=expectedRows(documents.slice(1)),firstPass=Math.ceil(documents.length/128);
  const complete=await trace(()=>a.lexical());
  assert.equal(complete.rows.filter(collector).length,2*firstPass,'the marked ordinary branch really replays');
  assert.equal(complete.result.matched,299);assert.deepEqual(complete.result.rows,expected);
  const original=performance.now.bind(performance);let expired=false;
  t.mock.method(performance,'now',()=>expired?Number.MAX_SAFE_INTEGER:original());
  const connections=new Map(),sameConnections=(sql,args,connection)=>{
    const key=collector({sql})?'canonical':posting(sql)?'sidecar':null;
    if(!key)return;
    if(!connections.has(key))connections.set(key,connection);
    else assert.equal(connection,connections.get(key),'reuse the same native '+key+' connection');
  };
  const expire=(sql,args,connection)=>{
    sameConnections(sql,args,connection);
    if(collector({sql})&&++reads===firstPass+1){expired=true;clock=1;samplesAtExpiry=samples;}
  };
  const timed=await trace(()=>{
    assert.throws(()=>a.lexical(1),{code:'read_timeout'});
  },expire);
  assert.equal(timed.rows.filter(collector).length,firstPass+1,'no later replay collector executes');
  assertNoCanonicalReadAfterCutoff(timed,firstPass+1);
  assert.ok(samples>samplesAtExpiry,'the existing clock is checked after the first replay collector');
  assert.ok(timed.rows.some(row=>row.sql==='ROLLBACK'),'timeout releases the read transactions');
  assert.equal(connections.size,2);
  assert.ok([...connections.values()].every(connection=>!connection.isTransaction),'both read transactions were released');
  expired=false;clock=0;reads=0;
  const next=(await trace(()=>a.lexical(),sameConnections)).result;
  assert.equal(next.matched,299);assert.deepEqual(next.rows,expected,'same canonical and sidecar connections recover');
  const call=pages(t,f,'ordinary');
  connections.clear();
  const delivered=await trace(()=>call({...selection,query,semantic:false,limit:24,deadlineMs:5000}),expire);
  assert.equal(delivered.rows.filter(collector).length,firstPass+1);
  assertNoCanonicalReadAfterCutoff(delivered,firstPass+1);
  assert.deepEqual(delivered.result,{ok:false,error:{code:'read_timeout',retryable:false}},'no partial ranking DTO');
  expired=false;clock=0;reads=0;
  const served=ok((await trace(()=>call({...selection,query,semantic:false,limit:24,deadlineMs:5000}),sameConnections)).result);
  assert.deepEqual(publicRows(served),expected.map(({ref,score})=>({ref,score})));
  assert.equal(served.coverage.omitted.lexical,299-24,'same public handle returns the full correct horizon');
});

for(const route of ['ordinary','suppressed'])
test(`canonical and sidecar readers release success, deadline and thrown error: ${route}`,async t=>{
  const f=await lexicalFixture(t,route),documents=Array.from({length:3},(_,i)=>card(f,i));
  mark(f,documents[1]);
  assert.equal(f.db.prepare('PRAGMA journal_mode=WAL').get().journal_mode,'wal');
  const sqlite=createProductSqlitePolicy();sqlite.start(Infinity);
  const options={sqlite,sidecarJournalMode:'WAL'};
  let clock=0;
  const a=sidecar(t,f,route,()=>clock,options);a.refresh();
  const call=pages(t,f,route,{...options,now:()=>clock});
  for(const entry of ['storage','public'])for(const exit of ['success','deadline','error']){
    clock=0;let collected=false;
    const thrown=new Error('Synthetic collector failure');
    const measured=await trace(()=>{
      const work=()=>entry==='storage'?a.lexical(1):call({...selection,query,semantic:false,limit:1,deadlineMs:1});
      if(entry==='storage'&&exit!=='success')assert.throws(work,exit==='deadline'?{code:'read_timeout'}:error=>error===thrown);
      else{
        const result=work();
        if(entry==='storage')assert.equal(result.matched,2);
        else if(exit==='success')assert.equal(result.ok,true);
        else assert.deepEqual(result,{ok:false,error:{code:exit==='deadline'?'read_timeout':'storage_error',retryable:false}});
      }
    },sql=>{
      if(!collected&&collector({sql})){
        collected=true;
        if(exit==='deadline')clock=1;
        if(exit==='error')throw thrown;
      }
    });
    assert.equal(collected,true);
    if(exit==='deadline')assertNoCanonicalReadAfterCutoff(measured);
    assertReadersReleased(f);
  }
  clock=0;
  // Reusing an already-open canonical read must not BEGIN a nested one, and
  // completion must release it when its owner exits.
  assert.equal(a.withCanonicalRead(()=>a.lexical()).matched,2);
  assertReadersReleased(f);
});

for(const entry of ['storage','public'])
test(`three equal Cards retain one replay population and fence cached pages: ${entry}`,async t=>{
  const f=await fixture(t,'fresh-cards');
  const documents=Array.from({length:3},(_,i)=>card(f,i,{title:'Synthetic',body:'needle'}));
  const B=documents[1];mark(f,B);
  const survivors=documents.filter(d=>d!==B),expected=expectedRows(survivors,'needle');
  const A=survivors.find(d=>d.ref.cardId===expected[1].ref.cardId),C=survivors.find(d=>d!==A);
  const withheld=sibling(f,documents.indexOf(A));
  assert.equal(f.db.prepare('PRAGMA journal_mode=WAL').get().journal_mode,'wal');
  const sqlite=createProductSqlitePolicy();sqlite.start(Infinity);
  let boundary;
  const a=sidecar(t,f,'ordinary',()=>boundary?.now()??0,{sqlite});a.refresh();
  let provisionalCursor;
  const call=pages(t,f,'ordinary',{sqlite,now:()=>boundary?.now()??0,onCursor:cursor=>{provisionalCursor=cursor;}});
  const input={...selection,query:'needle',semantic:false,limit:1,deadlineMs:5000};
  const first=ok(call(input));
  assert.deepEqual(publicRows(first),[expected[0]]);
  assert.equal(first.items[0].ref.cardId,C.ref.cardId);
  assert.ok(first.nextCursor);
  assert.equal(first.coverage.omitted.lexical,0);
  assert.deepEqual(publicRows(ok(call({...input,cursor:first.nextCursor}))),[expected[1]],
    'the cached pre-write ranking contains A and C with the same population scores');
  boundary=replayBoundary(3,()=>forget(f,withheld));
  const measured=await trace(()=>entry==='storage'?a.lexical(Infinity,'needle'):call(input),boundary.onSql);
  assertReplaySnapshots(measured,boundary);
  if(entry==='storage'){
    assert.equal(measured.result.matched,2);
    assert.deepEqual(measured.result.rows,expected,'A and C, scored with B absent');
    assert.ok(measured.result.rows.every(row=>Object.is(row.score,expected[0].score)));
  }else{
    assert.deepEqual(measured.result,{ok:false,error:{code:'index_unavailable',retryable:false}},
      'the final namespace fence rejects the provisional pre-write ranking');
    assert.ok(provisionalCursor);assert.notEqual(provisionalCursor,first.nextCursor);
    assert.deepEqual(call({...input,cursor:provisionalCursor}),{ok:false,error:{code:'cursor_stale',retryable:false}},
      'a ranking refused by the final fence cannot be paged');
  }
  assert.deepEqual(call({...input,cursor:first.nextCursor}),{ok:false,error:{code:'cursor_stale',retryable:false}},
    'page two refuses the changed population rather than mixing rows, scores and coverage');
  call.refresh();assert.equal(a.observe().dto.lexical.state,'ready');
  const next=a.lexical(Infinity,'needle');
  assert.equal(next.matched,1);assert.deepEqual(next.rows,expectedRows([C],'needle'));
  const fresh=ok(call(input));
  assert.deepEqual(publicRows(fresh),next.rows);
  assert.equal(fresh.coverage.omitted.lexical,0);assert.equal(fresh.nextCursor,null);
  for(const result of [next,fresh])for(const denied of [A,B])assert.equal(hasId(result,denied.ref.cardId),false);
});

test('marker-only fixture writes preserve the storage replay snapshot',async t=>{
  const f=await fixture(t,'ordinary-48');
  const documents=Array.from({length:3},(_,i)=>card(f,i,{title:'Synthetic',body:'needle'}));
  mark(f,documents[1]);
  assert.equal(f.db.prepare('PRAGMA journal_mode=WAL').get().journal_mode,'wal');
  const sqlite=createProductSqlitePolicy();sqlite.start(Infinity);
  const boundary=replayBoundary(3,()=>mark(f,documents[0]));
  const a=sidecar(t,f,'ordinary',()=>boundary.now(),{sqlite});a.refresh();
  const measured=await trace(()=>a.lexical(Infinity,'needle'),boundary.onSql);
  assertReplaySnapshots(measured,boundary);
  assert.equal(measured.result.matched,2);
  assert.deepEqual(measured.result.rows,expectedRows([documents[0],documents[2]],'needle'));
  const next=a.lexical(Infinity,'needle');
  assert.equal(next.matched,1);assert.deepEqual(next.rows,expectedRows([documents[2]],'needle'));
});

test('packaged public forget fences delivery and previously cached pages',async t=>{
  const f=await lexicalFixture(t,'suppressed');
  const documents=Array.from({length:3},(_,i)=>card(f,i,{title:'Synthetic',body:'needle'}));
  const a=sidecar(t,f,'suppressed');a.refresh();
  const expected=expectedRows(documents,'needle');
  const A=documents.find(d=>d.ref.cardId===expected[1].ref.cardId),withheld=sibling(f,documents.indexOf(A));
  a.refresh();
  let armed=false,provisionalCursor,committed=false;
  assert.equal(f.db.prepare('PRAGMA journal_mode').get().journal_mode,'delete');
  const call=pages(t,f,'suppressed',{onCursor:(cursor,reader)=>{
    provisionalCursor=cursor;
    if(armed){
      assert.equal(reader.isTransaction,false,'ranking released its canonical read before the public forget');
      armed=false;forget(f,withheld);committed=true;
    }
  }});
  const input={...selection,query:'needle',semantic:false,limit:1,deadlineMs:5000};
  const first=ok(call(input));assert.ok(first.nextCursor);
  const before=a.lexical(Infinity,'needle');
  assert.equal(before.matched,3);assert.deepEqual(before.rows,expected);
  armed=true;
  assert.deepEqual(call(input),{ok:false,error:{code:'evidence_unavailable',retryable:false}});
  assert.equal(committed,true);assert.equal(f.db.isTransaction,false);
  const refusedCursor=provisionalCursor;
  assert.ok(refusedCursor);assert.notEqual(refusedCursor,first.nextCursor);
  assert.deepEqual(call({...input,cursor:refusedCursor}),{ok:false,error:{code:'cursor_stale',retryable:false}},
    'the refused ranking never entered the cache');
  assert.deepEqual(call({...input,cursor:first.nextCursor}),{ok:false,error:{code:'evidence_unavailable',retryable:false}},
    'the base keeps the suppression-fence classification on cached pages');
  call.refresh();assert.equal(a.observe().dto.lexical.state,'ready');
  const next=a.lexical(Infinity,'needle');
  assert.equal(next.matched,2);assert.deepEqual(next.rows,expectedRows(documents.filter(d=>d!==A),'needle'));
  const fresh=ok(call(input)),second=ok(call({...input,cursor:fresh.nextCursor}));
  assert.deepEqual([...publicRows(fresh),...publicRows(second)],next.rows);
  assert.deepEqual(second.coverage,fresh.coverage);assert.equal(fresh.coverage.omitted.lexical,0);
  assert.equal(second.nextCursor,null);
  for(const value of [fresh,second])assert.equal(hasId(value,A.ref.cardId),false);
});

// Public capture awaits extraction, so a second thread commits it while the
// synchronous reader is paused at the cursor-encoding seam before final().
// No engine method is replaced and no direct SQL simulates the capture.
async function unrelatedCaptureWorker(){
  const {workerData,parentPort}=await import('node:worker_threads');
  const {openMemoryCore}=await import(workerData.coreURL);
  const signal=new Int32Array(workerData.signal);
  const core=openMemoryCore({path:workerData.path,model:{contextWindow:8192,countTokens:()=>1,
    extract:()=>({items:[{content:'Synthetic unrelated capture',kind:'fact',confidence:.8,sourceIndices:[0]}]})}});
  parentPort.postMessage('ready');
  let result;
  try{
    if(Atomics.wait(signal,0,0,30000)==='timed-out')throw Error('capture trigger timed out');
    result=await core.capture({namespace:workerData.namespace,client:'synthetic',sessionId:'synthetic-unrelated',
      eventId:'synthetic-unrelated-capture',messages:[{id:'synthetic-unrelated-message',role:'user',content:'Synthetic unrelated capture'}]});
  }catch(error){result={ok:false,error:{code:error.code??error.message}};}
  finally{core.close();}
  workerData.port.postMessage(result);
  Atomics.store(signal,1,1);Atomics.notify(signal,1);
  workerData.port.close();parentPort.close();
}

async function captureWriter(t,f,namespace){
  const signal=new Int32Array(new SharedArrayBuffer(8)),{port1,port2}=new MessageChannel();
  const worker=new Worker('('+unrelatedCaptureWorker.toString()+')()',{eval:true,
    workerData:{path:f.path,namespace,signal:signal.buffer,port:port2,coreURL:new URL('../index.mjs',import.meta.url).href},
    transferList:[port2]});
  const exited=once(worker,'exit');
  t.after(async()=>{port1.close();await worker.terminate();});
  assert.deepEqual((await once(worker,'message'))[0],'ready');
  return {exited,commit(){
    Atomics.store(signal,0,1);Atomics.notify(signal,0);
    assert.notEqual(Atomics.wait(signal,1,0,30000),'timed-out','the public capture completed');
    const result=receiveMessageOnPort(port1)?.message;
    assert.equal(result?.ok,true,JSON.stringify(result));
    assert.equal(result.value.admission.memories.length,1,'a new Memory was captured');
    const stored=f.db.prepare('SELECT id FROM memories WHERE owner_id=? AND scope=? AND project_id=? AND deleted=0 AND content=?')
      .all(namespace.ownerId,namespace.scope,namespace.projectId,'Synthetic unrelated capture');
    assert.equal(stored.length,1,'the reader sees the other connection commit');
  }};
}

for(const kind of ['fresh-cards','ordinary-48'])for(const namespace of ['other','same'])for(const phase of ['delivery','page'])
test(`unrelated capture preserves the base namespace fence: ${kind} / ${namespace} / ${phase}`,{timeout:60000},async t=>{
  const f=await fixture(t,kind),documents=Array.from({length:3},(_,i)=>card(f,i,{title:'Synthetic',body:'needle'}));
  // The public facade opens on its supported DELETE store shape. The cursor
  // seam runs after ranking releases the read, so the other connection can
  // commit without WAL or a held canonical snapshot.
  assert.equal(f.db.prepare('PRAGMA journal_mode').get().journal_mode,'delete');
  let writer;
  let armed=false,committed=false,provisionalCursor;
  const call=pages(t,f,'ordinary',{now:()=>0,onCursor:(cursor,reader)=>{
    provisionalCursor=cursor;
    if(armed){
      assert.equal(reader.isTransaction,false,'ranking released its canonical read before the public capture');
      armed=false;writer.commit();committed=true;
    }
  }});
  call.refresh();
  writer=await captureWriter(t,f,namespace==='same'?ns:{...ns,projectId:'synthetic-other-project'});
  const input={...selection,query:'needle',semantic:false,limit:1,deadlineMs:5000};
  const first=ok(call(input)),second=ok(call({...input,cursor:first.nextCursor}));
  assert.ok(second.nextCursor);
  const before=f.db.prepare('SELECT generation FROM card_epochs WHERE owner_id=? AND scope=? AND project_id=?')
    .get(ns.ownerId,ns.scope,ns.projectId);
  let result;
  if(phase==='delivery'){
    armed=true;result=call(input);assert.equal(committed,true,'capture committed between ranking and final delivery');
  }else{
    writer.commit();committed=true;result=call({...input,cursor:first.nextCursor});
  }
  assert.deepEqual(await writer.exited,[0],'the capture worker exited successfully');
  assert.deepEqual(f.db.prepare('SELECT generation FROM card_epochs WHERE owner_id=? AND scope=? AND project_id=?')
    .get(ns.ownerId,ns.scope,ns.projectId),before,'the capture touched no Card');
  const expected=phase==='delivery'?first:second;
  if(namespace==='other'){
    const value=ok(result);
    assert.deepEqual(publicRows(value),publicRows(expected));
    assert.deepEqual(value.coverage,expected.coverage);assert.deepEqual(value.channels,expected.channels);
    const next=ok(call({...input,cursor:phase==='delivery'?value.nextCursor:first.nextCursor}));
    assert.deepEqual(publicRows(next),publicRows(second));assert.deepEqual(next.coverage,second.coverage);
  }else{
    assert.deepEqual(result,{ok:false,error:{code:phase==='delivery'?'index_unavailable':'cursor_stale',retryable:false}},
      'the base fences every namespace epoch, including a Card-only projection');
    if(phase==='delivery')assert.deepEqual(call({...input,cursor:provisionalCursor}),
      {ok:false,error:{code:'cursor_stale',retryable:false}},'failed final delivery leaves no cache entry');
    call.refresh();
    const fresh=ok(call(input));
    assert.deepEqual(publicRows(fresh),expectedRows(documents,'needle').slice(0,1));
    assert.deepEqual(fresh.coverage.byType,first.coverage.byType);
    assert.deepEqual(fresh.coverage.omitted,first.coverage.omitted);
  }
});

for(const kind of ['fresh-cards','ordinary-48'])
test(`ordinary replay retains the canonical snapshot across a committed sibling forget: ${kind}`,{timeout:60000},async t=>{
  const f=await fixture(t,kind),documents=Array.from({length:32},(_,i)=>card(f,i));
  const second=sibling(f,1);
  // The package case keeps facts empty to select the ordinary branch. On the
  // legacy layout an actual sibling forget also leaves the fact set empty.
  if(kind==='fresh-cards')forget(f,sibling(f,0));else mark(f,documents[0]);
  assert.equal(f.db.prepare('PRAGMA journal_mode=WAL').get().journal_mode,'wal');
  const sqlite=createProductSqlitePolicy();sqlite.start(Infinity);
  let writer;
  const boundary=replayBoundary(documents.length,({canonical,side})=>{
    assert.notEqual(canonical,side);assert.equal(canonical.isTransaction,true);
    writer=f.db;assert.notEqual(writer,canonical);
    forget(f,second);
    assert.equal(writer.isTransaction,false,'public forget has returned after COMMIT');
    const header=writer.prepare('SELECT receipt_key,client,session_id,event_id,role FROM receipts WHERE memory_id=?').get(documents[1].memory.id);
    for(const token of receiptDenialTokens([header]))assert.ok(writer.prepare(
      'SELECT 1 FROM suppressed WHERE owner_id=? AND scope=? AND project_id=? AND fingerprint=?')
      .get(ns.ownerId,ns.scope,ns.projectId,token),'another connection sees the committed marker');
  });
  const a=sidecar(t,f,'ordinary',()=>boundary.now(),{sqlite});a.refresh();
  const before=a.lexical();
  assert.equal(before.matched,31);assert.deepEqual(before.rows,expectedRows(documents.slice(1)));
  const measured=await trace(()=>a.lexical(),boundary.onSql);
  assertReplaySnapshots(measured,boundary);
  assert.equal(measured.result.matched,before.matched);
  assert.deepEqual(measured.result.rows,before.rows,'replay cannot mix old BM25 inputs with new withholding');
  const next=a.lexical();
  assert.equal(next.matched,30);assert.deepEqual(next.rows,expectedRows(documents.slice(2)),'fresh read sees the committed forget');
  assert.equal(hasId(next,documents[1].ref.cardId),false);
});

test('ordinary replay retains the sidecar snapshot across a new Card publication and retirement',{timeout:60000},async t=>{
  const f=await fixture(t,'fresh-cards'),documents=Array.from({length:32},(_,i)=>card(f,i));
  forget(f,sibling(f,0));
  assert.equal(f.db.prepare('PRAGMA journal_mode=WAL').get().journal_mode,'wal');
  const sqlite=createProductSqlitePolicy();sqlite.start(Infinity);
  const options={sqlite,sidecarJournalMode:'WAL'};
  let added,publisher;
  const boundary=replayBoundary(documents.length,({canonical,side})=>{
    assert.equal(canonical.isTransaction,true);assert.equal(side.isTransaction,true);
    added=card(f,documents.length);
    // Public maintenance retires the old generation, making a missing sidecar
    // snapshot observable in the replay, rather than merely changing a pointer.
    const count=reader=>reader.prepare('SELECT count(*) AS n FROM documents').get().n;
    const probe=new DatabaseSync(f.path+PRODUCT_SIDECAR_SUFFIX,{readOnly:true});
    try{
      assert.notEqual(probe,side);
      for(let i=0;i<4;i++){
        publisher.refresh();
        if(count(probe)===documents.length+1)break;
      }
      assert.equal(count(probe),documents.length+1,'the publisher committed and retired the old documents');
      assert.equal(count(side),documents.length,'the in-flight sidecar still sees the old generation');
    }finally{probe.close();}
  });
  const a=sidecar(t,f,'ordinary',()=>boundary.now(),options);a.refresh();
  publisher=pages(t,f,'ordinary',options);
  const before=a.lexical(),measured=await trace(()=>a.lexical(),boundary.onSql);
  assertReplaySnapshots(measured,boundary);
  assert.equal(measured.result.matched,31);assert.deepEqual(measured.result.rows,before.rows);
  assert.equal(hasId(measured.result,added.ref.cardId),false);
  assert.equal(a.observe().dto.lexical.state,'ready','fresh observation sees the committed publication');
  const next=a.lexical();
  assert.equal(next.matched,32);assert.deepEqual(next.rows,expectedRows([...documents.slice(1),added]));
});

for(const withheld of [1,3])
test(`ordinary marked ranking exactly equals public deletion and republication: ${withheld} withheld Cards`,{timeout:60000},async t=>{
  const f=await fixture(t,'ordinary-48');
  const survivors=Array.from({length:36},(_,i)=>card(f,i,{title:'Synthetic document '+i,
    body:['needle pear','needle','pear'][i%3]+' padding'.repeat(8+i%7)}));
  const shapes=[{title:'needle',body:'needle '.repeat(18)},
    {title:'needle pear',body:'needle pear '.repeat(10)},{title:'pear',body:'pear '.repeat(18)}];
  const denied=shapes.slice(0,withheld).map((shape,i)=>card(f,36+i,shape));
  const terms=new Set(tokenizeT1(query));
  const matchedTerms=denied.map(document=>new Set(tokenizeT1(document.text).filter(term=>terms.has(term))).size);
  assert.equal(matchedTerms[0],1,'a withheld Card matches only some query terms');
  if(withheld===3)assert.ok(matchedTerms.includes(terms.size),'another withheld Card matches several terms');
  const a=sidecar(t,f,'ordinary');a.refresh();
  const unmarked=a.lexical();
  assert.ok(denied.some(document=>unmarked.rows.some(row=>row.ref.cardId===document.ref.cardId)),
    'a withheld Card would occupy the first 24 slots');
  for(const document of denied)mark(f,document);
  const measured=await trace(()=>a.lexical()),marked=measured.result;
  assert.equal(measured.rows.filter(collector).length,2,'ordinary/no-fact path corrects statistics and replays');
  assert.equal(marked.matched,survivors.length);assert.deepEqual(marked.rows,expectedRows(survivors));
  const call=pages(t,f,'ordinary'),markedPages=await cachedPages(call);
  assert.equal(markedPages.length,24);
  assert.ok(markedPages.every(page=>page.coverage.omitted.lexical===survivors.length-24));
  assert.deepEqual(markedPages.flatMap(publicRows),marked.rows.map(({ref,score})=>({ref,score})));
  // Keep this exact store and all surviving refs/text. Only public Card
  // deletion and normal index maintenance construct the comparison corpus.
  for(const {ref}of denied)ok(f.call('deleteKnowledgeCard',{actionId:'synthetic-chunk-delete-'+ref.cardId,
    cardId:ref.cardId,expectedRevision:ref.revision}));
  call.refresh();
  assert.equal(a.observe().dto.lexical.state,'ready');
  const absent=a.lexical(),absentPages=await cachedPages(call);
  assert.equal(absent.matched,marked.matched);assert.deepEqual(absent.rows,marked.rows,'ids, order and exact numeric scores');
  assert.deepEqual(absentPages.map(page=>page.coverage.omitted.lexical),markedPages.map(page=>page.coverage.omitted.lexical));
  assert.deepEqual(absentPages.flatMap(publicRows),markedPages.flatMap(publicRows),'public ordered refs and raw scores');
  for(let i=0;i<marked.rows.length;i++)assert.ok(Object.is(marked.rows[i].score,absent.rows[i].score),'bit-identical score '+i);
  for(const document of denied)for(const result of [marked,absent,...markedPages,...absentPages])
    assert.equal(hasId(result,document.ref.cardId),false,'no withheld id in results, coverage or cached pages');
});

for(const kind of ['ordinary-48','ordinary-53'])
test(`one Card token statement for a chunk spanning namespaces: ${kind}`,async t=>{
  const f=await fixture(t,kind),first=card(f,0),other={...ns,scope:'personal',projectId:null};
  const memory=ok(f.core.admit({namespace:other,memory:{content:'Synthetic other support',kind:'fact'},
    receipts:[receipt('synthetic-other-chunk')]})).memory;
  let second=ok(f.call('createCardDraft',{namespace:other,actionId:'synthetic-other-draft',drafting:'authored',
    input:{title:'Synthetic needle',body:'Synthetic pear',memoryRefs:[{...memoryRef(memory),namespace:other}],sourcePolicy:'retained-receipts-v1'}}));
  second=ok(f.call('confirmCardDraft',{namespace:other,actionId:'synthetic-other-confirm',cardId:second.id,
    expectedRevision:second.revision,applicability:'current'}));
  const refs=[first.ref,{type:'card',namespace:other,cardId:second.id}];
  const header=f.db.prepare('SELECT receipt_key,client,session_id,event_id,role FROM receipts WHERE memory_id=?').get(memory.id);
  // The same token under the other boundary cannot deny the first Card.
  for(const token of receiptDenialTokens([header]))f.db.prepare('INSERT INTO suppressed VALUES(?,?,?,?)')
    .run(other.ownerId,other.scope,'',token);
  const measured=await trace(()=>readTransaction(f.db,()=>{
    const memo=cardDeliverySnapshot(f.db,[...refs,...refs]);
    cardDeliverySnapshot(f.db,refs,memo);
    return refs.map(ref=>cardDeliverable(f.db,ref.namespace,ref.cardId,memo));
  }));
  assert.deepEqual(measured.result,[true,false]);
  const collections=measured.rows.filter(collector);assert.equal(collections.length,1);
  assert.equal(JSON.parse(collections[0].args[0]).length,2,'deduplicated full boundary tuples');
  assert.doesNotMatch(collections[0].sql,/excerpt|r\.\*/);
});

for(const route of routes)test(`withheld Card has no lexical population or cached ranking contribution: ${route}`,{timeout:60000},async t=>{
  const f=await lexicalFixture(t,route);
  Array.from({length:30},(_,i)=>card(f,i));
  const a=sidecar(t,f,route);a.refresh();
  const call=pages(t,f,route),before=a.lexical(),beforePages=await cachedPages(call);
  const denied=card(f,30);
  const headers=f.db.prepare('SELECT receipt_key,client,session_id,event_id,role FROM receipts WHERE memory_id=?').all(denied.memory.id);
  for(const token of receiptDenialTokens(headers))f.db.prepare('INSERT INTO suppressed VALUES(?,?,?,?)').run(ns.ownerId,ns.scope,ns.projectId,token);
  a.refresh();
  const measured=await trace(()=>a.lexical()),after=measured.result,afterPages=await cachedPages(call);
  assert.equal(measured.rows.filter(collector).length,route==='ordinary'?2:route==='embedded'?2:1,
    'ordinary statistics correction replays bounded chunks; embedded retains its independent final fence');
  assert.equal(before.matched,30);assert.equal(after.matched,before.matched);
  assert.deepEqual(after.rows,before.rows,'withholding equals absence, including scores and ties');
  assert.deepEqual(afterPages.map(p=>p.coverage.omitted),beforePages.map(p=>p.coverage.omitted));
  assert.deepEqual(afterPages.flatMap(p=>p.items),beforePages.flatMap(p=>p.items));
  for(const value of [after,...afterPages])assert.equal(hasId(value,denied.ref.cardId),false,'id absent from results, diagnostics and cached pages');
});

// On the packaged store that also carries Raw source maps with Card lineage,
// the public Card lexical read returns its ranking: the lexical work owns a
// canonical read transaction, which contributor validation requires there.
test('public Card lexical read returns a value on the Raw-capable package with Card lineage',{timeout:60000},async t=>{
  const f=await fixture(t,'ordinary-53');
  const documents=Array.from({length:3},(_,i)=>card(f,i));
  const call=pages(t,f,'suppressed');call.refresh();
  for(let attempt=0;attempt<2;attempt++){
    const served=await call({...selection,query,semantic:false,limit:3,deadlineMs:5000});
    assert.equal(served.ok,true,JSON.stringify(served).slice(0,200));
    assert.deepEqual(publicRows(served.value),expectedRows(documents),'exact ranking and scores');
  }
});

test('public Card lexical read returns a value on packaged layout 53 with Card lineage off and receipt event time',{timeout:60000},async t=>{
  const model={contextWindow:8192,countTokens:()=>1,contents:[],
    extract:()=>({items:model.contents.map(content=>({content,kind:'fact',confidence:1,sourceIndices:[0]}))}),
    classify:({input})=>({items:input.memories.map(memory=>({memoryId:memory.id,parentIds:[]}))})};
  // layoutFixture(53) is eventTimeSafetyFixture(t,33) followed by migrate():
  // suppression and receipt event time are enabled; Card lineage stays off.
  const f=await layoutFixture(t,53,model),host=lineageHost();
  const writer=openMemoryCore({path:f.path,model,privateCards:host.options});
  f.workspace.defer(()=>writer.close());
  const control=f.db.prepare('SELECT * FROM content_safety_control WHERE singleton=1').get();
  assert.equal(f.db.prepare('PRAGMA user_version').get().user_version,53);
  assert.equal(control.base_layout,33);assert.equal(control.card_lineage_revision,0);
  assert.equal(control.receipt_event_time,1);assert.equal(control.suppression_revision,1);
  async function capture(tag,content){
    model.contents=[content];
    const value=ok(await writer.capture({namespace:ns,client:'synthetic',sessionId:'synthetic-event-time-'+tag,
      eventId:'synthetic-event-time-'+tag,messages:[{id:'synthetic-message-'+tag,role:'user',content}]}));
    assert.equal(value.admission.memories.length,1);
    assert.equal(value.classification.status,'applied');
    return ok(writer.get({namespace:ns,memoryId:value.admission.memories[0].id})).memory;
  }
  const documents=[];
  for(let i=0;i<3;i++){
    const memory=await capture('support-'+i,'Synthetic retained support '+i);
    const title='Synthetic needle '+i,body=i%2?'needle pear pear':'needle needle pear';
    let value=ok(host.call(writer,'createCardDraft',{actionId:'synthetic-event-time-draft-'+i,drafting:'authored',
      input:{title,body,memoryRefs:[memoryRef(memory)],sourcePolicy:'retained-receipts-v1'}}));
    value=ok(host.call(writer,'confirmCardDraft',{actionId:'synthetic-event-time-confirm-'+i,cardId:value.id,
      expectedRevision:value.revision,applicability:'current'}));
    assert.equal(value.state,'confirmed');
    documents.push({ref:{type:'card',namespace:ns,cardId:value.id,revision:value.revision,bodyRevision:value.bodyRevision},
      text:title+'\n'+body});
  }
  const unrelated=await capture('unrelated','Synthetic unrelated forget target');
  ok(writer.forget({namespace:ns,memoryId:unrelated.id,expectedRevision:unrelated.revision}));
  assert.ok(f.db.prepare('SELECT count(*) AS n FROM content_suppressions WHERE owner_id=? AND scope=? AND project_id=?')
    .get(ns.ownerId,ns.scope,ns.projectId).n>0,'the unrelated public forget selects the suppression-aware branch');
  const call=pages(t,f,'suppressed');call.refresh();
  const expected=expectedRows(documents);
  for(let attempt=0;attempt<2;attempt++){
    const measured=await trace(()=>call({...selection,query,semantic:false,limit:3,deadlineMs:5000}));
    const served=ok(measured.result);
    assert.equal(served.coverage.byType.card.eligible,null,'the suppression-aware Card population is unknown');
    assert.ok(measured.rows.some(collector),'the public read collects the matching Cards');
    assert.equal(measured.rows.some(row=>row.sql==='SELECT df FROM statistics WHERE generation=? AND term=?'),false,
      'the ordinary published-df branch did not execute');
    assert.deepEqual(publicRows(served),expected,'exact public ranking and scores on both reads');
    assert.equal(served.items.length,3);assert.equal(served.nextCursor,null);
    assert.equal(served.coverage.omitted.lexical,0);
  }
});
