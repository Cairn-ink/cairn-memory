import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { transaction } from '../database.mjs';
import { installedContentLayout } from '../content-safety-schema.mjs';
import { createRawLineageStorage as patchedReceiptWalk, isSourceSnapshotOverflow } from '../raw-lineage-storage.mjs';
import { createLegacyReceiptWalk, isSourceSnapshotOverflow as legacyOverflow } from '../testing/receipt-walk-reference.mjs';
import { safetyFixture } from '../testing/content-safety-s2h-fixture.mjs';
import { eventTimeSafetyFixture } from '../testing/receipt-event-time-fixture.mjs';
import { writeContentSuppressionInside, withContentSuppressionRequest, contentSuppressionRequestInside } from '../content-suppression-storage.mjs';

const createRawLineageStorage=process.env.RECEIPT_WALK_BASELINE==='1'?createLegacyReceiptWalk:patchedReceiptWalk;
const ns={ownerId:'synthetic-owner',scope:'project',projectId:'synthetic-project'};
// The final seed was randomly drawn once and retained for replay.
const seeds=[1,0x12345678,0xdeadbeef,0xffffffff,173503316,3104539138,3606551382];
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const receipt=i=>({client:'synthetic',sessionId:'session-'+i,eventId:'event-'+i,role:'user',excerpt:i===0?'':'Synthetic excerpt '+i});
const decide=work=>{try{work();return 'accept';}catch(error){assert.equal(typeof error.code,'string');return error.code;}};
function random(seed){let value=seed>>>0;return n=>{value^=value<<13;value^=value>>>17;value^=value<<5;return (value>>>0)%n;};}

for(const layout of [18,53])for(const seed of seeds)test(`receipt walk equivalence layout=${layout} seed=${seed}`,async t=>{
  const f=layout===18?safetyFixture(t):eventTimeSafetyFixture(t,33);
  if(layout===53)await f.migrate();
  const db=f.connect();t.after(()=>db.close());
  assert.equal(db.prepare('PRAGMA user_version').get().user_version,layout);
  const rnd=random(seed),sources=Array.from({length:32},(_,i)=>receipt(i));
  for(const field of ['client','sessionId','eventId','role','excerpt'])sources.push({...sources[0],[field]:field==='role'?'assistant':'near-'+field});
  const rows=[],states=new Map();let serial=0;
  const add=(source,state='live',namespace=ns,{key=digest(source),time='time',revision=1}={})=>{
    const id='memory-'+String(serial++).padStart(5,'0'),rid='receipt-'+id;
    db.prepare(`INSERT INTO memories(id,owner_id,scope,project_id,fingerprint,content,kind,origin,confidence,revision,deleted,created_at,updated_at)
      VALUES(?,?,?,?,?,?,'fact','explicit',1,?,?,?,?)`).run(id,namespace.ownerId,namespace.scope,namespace.projectId??'',id,
        state==='deleted'||state==='forgotten'?null:'Synthetic '+id,revision,state==='deleted'||state==='forgotten'?1:0,time,time);
    db.prepare(`INSERT INTO receipts(id,memory_id,receipt_key,client,session_id,event_id,role,excerpt,created_at)
      VALUES(?,?,?,?,?,?,?,?,?)`).run(rid,id,key,source.client,source.sessionId,source.eventId,source.role,source.excerpt,time);
    if(state==='suppressed')db.prepare('INSERT INTO suppressed VALUES(?,?,?,?)').run(namespace.ownerId,namespace.scope,namespace.projectId??'',id);
    if(state==='withheld')db.prepare("UPDATE memories SET currentness='historical',review_state='awaiting' WHERE id=?").run(id);
    if(layout===53&&['memory-fact','receipt-fact','forgotten'].includes(state))writeContentSuppressionInside(db,{
      namespace,kind:state==='receipt-fact'?'receipt':'memory',key:state==='receipt-fact'?rid:id,
      reason:state==='forgotten'?'user_forget':'purge',actionId:id});
    rows.push({id,rid,source,state});states.set(state,(states.get(state)??0)+1);return {id,rid};
  };
  const controls={deleted:receipt('deleted'),later:receipt('later'),badKey:receipt('bad-key'),foreign:receipt('foreign'),safe:receipt('safe'),near:receipt('near-target'),memoryFact:receipt('memory-fact'),receiptFact:receipt('receipt-fact'),withheld:receipt('withheld'),suppressed:receipt('suppressed'),forgotten:receipt('forgotten'),historical:receipt('historical'),awaiting:receipt('awaiting'),empty:{...receipt('empty'),excerpt:''},overflow:receipt('overflow')};
  transaction(db,()=>{
    add(controls.deleted,'deleted');
    add(controls.later);add(controls.later,'deleted');
    add(controls.badKey,'live',ns,{key:'inconsistent-key'});
    for(const other of [{...ns,ownerId:'another-owner'},{...ns,scope:'personal',projectId:''},{...ns,projectId:'another-project'}])add(controls.foreign,'deleted',other);
    add(controls.suppressed,'suppressed');add(controls.forgotten,'forgotten');
    const historical=add(controls.historical),awaiting=add(controls.awaiting);
    db.prepare("UPDATE memories SET currentness='historical' WHERE id=?").run(historical.id);
    db.prepare("UPDATE memories SET review_state='awaiting' WHERE id=?").run(awaiting.id);
    add(controls.safe);add(sources[0]);add(controls.empty);
    add(controls.memoryFact,'memory-fact');add(controls.receiptFact,'receipt-fact');add(controls.withheld,'withheld');
    for(const field of ['client','sessionId','eventId','role','excerpt'])add({...controls.near,[field]:field==='role'?'assistant':'near-'+field},'deleted');
    // Cross both namespace page boundaries, including equal-timestamp seeks.
    for(let i=0;i<270;i++)add(sources[rnd(sources.length)],['live','deleted','forgotten','suppressed','withheld','memory-fact','receipt-fact'][rnd(7)],ns,{time:'time-'+rnd(3),revision:1+rnd(3)});
    for(const state of ['live','deleted'])for(let i=0;i<140;i++)add(receipt('equal-'+state+'-'+i),state,ns,{time:'equal-time'});
    const parent=add(receipt('overflow-parent'));
    // More than four receipts on one memory; the matching bad key is last.
    for(let i=0;i<13;i++){
      const source=i===12?controls.overflow:receipt('extra-'+i);
      db.prepare(`INSERT INTO receipts(id,memory_id,receipt_key,client,session_id,event_id,role,excerpt,created_at)
        VALUES(?,?,?,?,?,?,?,?,?)`).run('extra-'+i,parent.id,i===12?'bad-overflow-key':digest(source),source.client,source.sessionId,source.eventId,source.role,source.excerpt,'z'+String(i).padStart(2,'0'));
    }
    // Random-sized receipt groups cross continuation pages at equal timestamps.
    for(let group=0;group<8;group++){
      const parent=add(receipt('tie-parent-'+group)),count=9+rnd(9);
      for(let i=0;i<count;i++){
        const source=receipt('tie-'+group+'-'+i);sources.push(source);
        db.prepare(`INSERT INTO receipts(id,memory_id,receipt_key,client,session_id,event_id,role,excerpt,created_at)
          VALUES(?,?,?,?,?,?,?,?,?)`).run('tie-'+group+'-'+String(i).padStart(3,'0'),parent.id,
            i===count-1?'bad-tie-key':digest(source),source.client,source.sessionId,source.eventId,source.role,source.excerpt,'equal-receipt-time');
      }
    }
    if(layout===53){
      const source=receipt('raw-ancestry'),parent=add(source);
      db.prepare("INSERT INTO raw_conversations VALUES('ancestry',?,?,?,'claude-code','ancestry-session',1,'time','time')").run(ns.ownerId,ns.scope,ns.projectId);
      db.prepare("INSERT INTO raw_messages(conversation_id,message_id,ordinal,role,total_units,total_bytes,assembly_state,first_event_id) VALUES('ancestry','message',1,'user',10,10,'pending','event')").run();
      db.prepare("INSERT INTO raw_receipt_lineage VALUES(?,'ancestry','message',0,10,'exact')").run(parent.rid);
      writeContentSuppressionInside(db,{namespace:ns,kind:'raw',matchMode:'span',key:'ancestry',messageId:'message',start:0,end:10,reason:'purge',actionId:'ancestry'});
      sources.push(source);
    }
  });
  const adversarial=[];
  transaction(db,()=>{
    for(const field of ['client','sessionId','eventId','excerpt'])for(const value of
      ['\ud800','\udfff','\uFFFD','\0x','l\0r','x\0','e\u0301','é','\u{1f680}','trailing ','Case','case','','\uFEFFbom']) {
      const incoming={...receipt('unicode-'+adversarial.length),[field]:value};
      const stored=add(incoming,'deleted');
      const row=db.prepare('SELECT * FROM receipts WHERE id=?').get(stored.rid);
      const readBack={client:row.client,sessionId:row.session_id,eventId:row.event_id,role:row.role,excerpt:row.excerpt};
      assert.ok(!/[\ud800-\udfff]/u.test(readBack[field]),'stored text has no lone surrogate');
      adversarial.push({field,value,incoming,readBack});
    }
  });
  // Source bytes remain adversarial; paging keys are valid NUL-free UTF-8.
  // Engine writers use UUID ids and ISO timestamps (pinned by the contract test).
  transaction(db,()=>{
    const columns={client:'client',sessionId:'session_id',eventId:'event_id',excerpt:'excerpt'};
    for(const [field,column] of Object.entries(columns))for(const hex of ['80','E282','C0AF','FF']) {
      const incoming={...receipt('invalid-'+adversarial.length),[field]:'placeholder'};
      const stored=add(incoming,'deleted');
      db.prepare(`UPDATE receipts SET ${column}=CAST(x'${hex}' AS TEXT) WHERE id=?`).run(stored.rid);
      const row=db.prepare('SELECT * FROM receipts WHERE id=?').get(stored.rid);
      const readBack={client:row.client,sessionId:row.session_id,eventId:row.event_id,role:row.role,excerpt:row.excerpt};
      assert.ok(readBack[field].includes('\uFFFD'));
      adversarial.push({field,value:'invalid UTF-8 '+hex,incoming:readBack,readBack});
    }
  });
  const roleRefusals=[];
  for(const role of ['\ud800','\udfff','user\0suffix','u\u0301ser','úser','\u{1f680}','user ','User','']) {
    const incoming={...receipt('role-near'),role};
    const attempt=storage=>transaction(db,()=>decide(()=>{
      // The engine rejects these stored roles before either validator runs.
      db.prepare('UPDATE receipts SET role=? WHERE id=?').run(role,rows[0].rid);
      storage.assertReceipts(ns,[incoming]);
    }));
    roleRefusals.push({incoming,attempt});
  }
  const interleaved=[];
  transaction(db,()=>{
    for(const badIndex of [-1,4,8,12,20]) {
      const parent=add(receipt('interleaved-parent-'+badIndex)),batch=[];
      for(let i=0;i<43;i++) {
        const source=receipt('interleaved-'+badIndex+'-'+i),matching=i%2===0;
        if(matching)batch.push(source);
        const key=matching&&batch.length-1===badIndex?'invalid-witness-key':digest(source);
        db.prepare(`INSERT INTO receipts(id,memory_id,receipt_key,client,session_id,event_id,role,excerpt,created_at)
          VALUES(?,?,?,?,?,?,?,?,?)`).run('interleaved-'+badIndex+'-'+String(i).padStart(3,'0'),parent.id,key,
            source.client,source.sessionId,source.eventId,source.role,source.excerpt,'same-created-at');
      }
      interleaved.push({badIndex,batch});
    }
  });
  const collisionCases=[];
  transaction(db,()=>{
    // Memory ids remain inside the equivalence domain even when decoding is
    // many-to-one. Only receipt cursor keys must round-trip through the driver.
    for(const kind of ['invalid','NUL'])for(let group=0;group<6;group++) {
      const prefix='collision-'+kind+'-'+group+'-',good=prefix+(kind==='invalid'?'\uFFFD':'');
      const revision=1+rnd(3),deleted=rnd(2),source=receipt('collision-source-'+kind+'-'+group);
      const count=1+rnd(12),batch=[];
      const insert=db.prepare(`INSERT INTO memories(id,owner_id,scope,project_id,fingerprint,content,kind,origin,confidence,revision,deleted,created_at,updated_at)
        VALUES(?,?,?,?,?,?,'fact','explicit',1,?,?, 'time','time')`);
      insert.run(good,ns.ownerId,ns.scope,ns.projectId,good,deleted?null:'Synthetic',revision,deleted);
      const raw=Buffer.concat([Buffer.from(prefix),Buffer.from(kind==='invalid'?[0x80]:[0,0x78])]).toString('hex');
      db.prepare(`INSERT INTO memories(id,owner_id,scope,project_id,fingerprint,content,kind,origin,confidence,revision,deleted,created_at,updated_at)
        VALUES(CAST(x'${raw}' AS TEXT),?,?,?,?,'Synthetic','fact','explicit',1,?,0,'time','time')`)
        .run(ns.ownerId,ns.scope,ns.projectId,prefix+'raw',1+rnd(3));
      for(let i=0;i<count;i++) {
        const value={...source,eventId:source.eventId+'-'+i};batch.push(value);
        db.prepare(`INSERT INTO receipts(id,memory_id,receipt_key,client,session_id,event_id,role,excerpt,created_at)
          VALUES(?,?,?,?,?,?,?,?,? )`).run(prefix+String(i).padStart(3,'0'),good,digest(value),value.client,value.sessionId,value.eventId,value.role,value.excerpt,'same-time');
      }
      if(layout===53&&group%2===0)writeContentSuppressionInside(db,{namespace:ns,kind:'memory',key:good,matchMode:'version',
        sourceVersion:JSON.stringify(['memory-revision-v1',revision]),reason:'purge',actionId:prefix+'suppression'});
      collisionCases.push({kind,group,revision,deleted,count,batch});
    }
  });
  const snapshotCases=[];
  transaction(db,()=>{
    for(const kind of ['validated','deleted','overflow','ancestry']) {
      const namespace={...ns,ownerId:'snapshot-'+kind},source=receipt('snapshot-'+kind);
      const memory=add(source,kind==='deleted'?'deleted':'live',namespace);
      if(kind==='overflow')for(let i=0;i<140;i++)add(receipt('snapshot-overflow-'+i),'live',namespace);
      if(kind==='ancestry'&&layout===53)db.prepare("INSERT INTO raw_receipt_lineage VALUES(?,'ancestry','message',0,10,'exact')").run(memory.rid);
      snapshotCases.push({kind,namespace,source});
    }
  });
  const legacy=createLegacyReceiptWalk(db),current=process.env.RECEIPT_WALK_BASELINE==='1'?createLegacyReceiptWalk(db):createRawLineageStorage(db);let cases=0,accepted=0,refused=0;
  const compare=(batch,label)=>{
    const old=transaction(db,()=>decide(()=>legacy.assertReceipts(ns,batch)));
    const actual=transaction(db,()=>decide(()=>current.assertReceipts(ns,batch)));
    assert.equal(actual,old,JSON.stringify({layout,seed,label,batch}));cases++;if(old==='accept')accepted++;else refused++;
    return actual;
  };
  for(const {kind,group,batch} of collisionCases) {
    compare(batch,'decoded memory collision '+kind+'-'+group);
    compare([receipt('absent-collision'),...batch],'absent first decoded memory collision '+kind+'-'+group);
    for(const value of batch)compare([value],'single decoded memory collision '+kind+'-'+group);
  }
  const adversarialResults=[];
  for(const {field,value,incoming,readBack} of adversarial) {
    const decisions=[compare([incoming],'adversarial incoming '+field+JSON.stringify(value)),
      compare([readBack],'adversarial stored readback '+field+JSON.stringify(value)),
      compare([incoming,readBack,incoming],'adversarial repeated '+field+JSON.stringify(value))];
    adversarialResults.push({field,value,readBack:readBack[field],decisions});
  }
  for(const {incoming,attempt} of roleRefusals) {
    assert.equal(attempt(current),attempt(legacy));
    const decision=compare([incoming],'role near miss '+JSON.stringify(incoming.role));
    adversarialResults.push({field:'role',value:incoming.role,storeDecision:attempt(legacy),decisions:[decision]});
  }
  for(const {badIndex,batch} of interleaved)assert.equal(compare(batch,'interleaved witness '+badIndex),
    layout===18||badIndex===-1?'accept':'source_excluded');
  t.diagnostic(JSON.stringify({adversarialResults}));
  for(const [label,source]of Object.entries(controls)){
    const result=compare([source],label);
    assert.equal(result,layout===18||['foreign','safe','near','withheld','empty','historical','awaiting','suppressed'].includes(label)?'accept':'source_excluded',label);
  }
  for(const source of sources)compare([source],'single');
  assert.equal(compare([receipt('absent-first'),controls.deleted],'absent first receipt retains later refusal'),
    layout===18?'accept':'source_excluded');
  compare([],'empty batch');compare([controls.safe,controls.safe],'duplicate batch');
  for(let i=0;i<80;i++)compare(Array.from({length:1+rnd(7)},()=>rnd(4)===0?controls.safe:sources[rnd(sources.length)]),'random-'+i);
  // A second call observes writes made after an earlier call; no cross-call set.
  compare([receipt('own-write')],'before own write');
  transaction(db,()=>add(receipt('own-write'),'deleted'));
  assert.equal(compare([receipt('own-write')],'after own write'),layout===18?'accept':'source_excluded');
  if(layout===53 && process.env.RECEIPT_WALK_BASELINE!=='1'){
    let starts=0,batches=0;const prepare=db.prepare.bind(db);
    const hook=t.mock.method(db,'prepare',sql=>{
      const statement=prepare(sql),all=statement.all.bind(statement);
      if(/^SELECT id,revision,deleted,updated_at(?:, \(SELECT encoding FROM pragma_encoding\) AS receipt_encoding)? FROM memories/.test(sql))statement.all=(...args)=>{if(args.length===5)starts++;return all(...args);};
      if(sql.includes('FROM json_each(?) wanted CROSS JOIN receipts r ON r.rowid IN'))statement.all=(...args)=>{
        const result=all(...args);assert.ok(result.length<=128*5,'per-memory bounded batch');batches++;return result;
      };
      return statement;
    });
    try{transaction(db,()=>current.assertReceipts(ns,[controls.safe,controls.foreign,controls.near]));}finally{hook.mock.restore();}
    assert.equal(starts,2,'one namespace walk: one initial page for each deleted range');assert.ok(batches>0);
  }
  let snapshotComparisons=0;
  const snapshotDecision=(storage,overflow,namespace,batch)=>withContentSuppressionRequest(()=>transaction(db,()=>{
    const proof=contentSuppressionRequestInside(db,[namespace]);
    const trace=[],prepare=db.prepare.bind(db);
    const hook=t.mock.method(db,'prepare',sql=>{
      const statement=prepare(sql);
      for(const method of ['get','all','run','iterate']) {
        const execute=statement[method].bind(statement);
        statement[method]=(...args)=>{trace.push([sql,method,args]);return execute(...args);};
      }
      return statement;
    });
    try {
      const targets=[];
      storage.sourceSnapshot(()=>{
        storage.assertReceipts(namespace,batch,false,targets);
        storage.assertReceipts(namespace,batch,false,targets);
      },proof,performance.now()+60000);
      return {decision:'accept',targets,trace};
    } catch(error) { assert.equal(typeof error.code,'string');return {decision:error.code,overflow:overflow(error),trace}; } finally {hook.mock.restore();}
  }));
  for(const {kind,namespace,source} of snapshotCases) {
    const old=snapshotDecision(legacy,legacyOverflow,namespace,[source,source]);
    const actual=snapshotDecision(current,process.env.RECEIPT_WALK_BASELINE==='1'?legacyOverflow:isSourceSnapshotOverflow,namespace,[source,source]);
    assert.deepEqual(actual,old,JSON.stringify({layout,seed,kind,route:'snapshot'}));
    assert.equal(old.decision,layout===18||kind==='validated'||kind==='ancestry'&&layout!==53?'accept':kind==='deleted'?'source_excluded':'source_budget_exceeded');
    snapshotComparisons++;
  }
  const old=snapshotDecision(legacy,legacyOverflow,ns,[controls.safe]);
  const actual=snapshotDecision(current,process.env.RECEIPT_WALK_BASELINE==='1'?legacyOverflow:isSourceSnapshotOverflow,ns,[controls.safe]);
  assert.deepEqual(actual,old,JSON.stringify({layout,seed,route:'generated snapshot'}));snapshotComparisons++;
  assert.ok(accepted>0);if(layout===53)assert.ok(refused>0);
  for(const state of ['deleted','forgotten','suppressed','withheld','memory-fact','receipt-fact'])assert.ok(states.get(state)>0,state);
  t.diagnostic(JSON.stringify({node:process.version,layout,seed,cases,snapshotComparisons,accepted,refused,states:Object.fromEntries(states)}));
});


const precedenceConnections=new WeakMap();
async function precedenceFixture(t) {
  const f=eventTimeSafetyFixture(t,33);await f.migrate();
  const db=f.connect();t.after(()=>db.close());installedContentLayout(db);
  precedenceConnections.set(db,()=>f.connect());return db;
}
function precedenceMemory(db,i,{revision=1}={}) {
  const id='memory-'+String(i).padStart(5,'0');
  db.prepare(`INSERT INTO memories(id,owner_id,scope,project_id,fingerprint,content,kind,origin,confidence,revision,deleted,created_at,updated_at)
    VALUES(?,?,?,?,?,?,'fact','explicit',1,?,0,'time','time')`).run(id,ns.ownerId,ns.scope,ns.projectId,id,'Synthetic '+id,revision);
  return id;
}
function precedenceReceipt(db,id,source,{key=digest(source),rid='receipt-'+id}={}) {
  db.prepare(`INSERT INTO receipts(id,memory_id,receipt_key,client,session_id,event_id,role,excerpt,created_at)
    VALUES(?,?,?,?,?,?,?,?,'time')`).run(rid,id,key,source.client,source.sessionId,source.eventId,source.role,source.excerpt);
}
const errorOutcome=error=>({code:error.code,errcode:error.errcode??null});
function chargedDecision(t,db,create,batch,{at=Infinity,injected,fromWalk=false}={}) {
  // Each injected failure gets a fresh connection: failed schema probes can
  // invalidate connection-local attestation caches. Keep fault indices isolated.
  db=precedenceConnections.get(db)();installedContentLayout(db);
  const storage=create(db),native=db.prepare.bind(db);let executions=0,started=!fromWalk;
  const trace=[];
  const hook=t.mock.method(db,'prepare',sql=>{
    const statement=native(sql);
    for(const method of ['get','all','run','iterate']) {
      const execute=statement[method].bind(statement);
      statement[method]=(...args)=>{
        if(/^SELECT id,revision,deleted,updated_at(?:, \(SELECT encoding FROM pragma_encoding\) AS receipt_encoding)? FROM memories/.test(sql))started=true;
        if(started){executions++;trace.push(sql);if(executions===at)throw Object.assign(Error('synthetic statement interruption'),injected);}
        return execute(...args);
      };
    }
    return statement;
  });
  let outcome;
  try{transaction(db,()=>storage.assertReceipts(ns,batch));outcome={code:'accept',errcode:null};}
  catch(error){assert.equal(typeof error.code,'string');outcome=errorOutcome(error);}
  finally{hook.mock.restore();db.close();}
  return {outcome,executions,trace};
}
function fillPrecedence(db,target,{lateError=false,second,lateRefusal=false}={}) {
  transaction(db,()=>{for(let i=0;i<140;i++){
    const id=precedenceMemory(db,i,{revision:lateError&&i===139?9007199254740993n:1});
    const source=second&&i===0?second:i===(lateRefusal?138:0)?target:receipt('filler-'+i);
    precedenceReceipt(db,id,source,{key:second&&i===0||source===target&&(!lateError||!second)?'inconsistent-key':digest(source)});
  }});
}

test('first receipt refusal precedes later statement budgets and interrupts at every index',async t=>{
  const db=await precedenceFixture(t),target=receipt('early');fillPrecedence(db,target);
  const reference=chargedDecision(t,db,createLegacyReceiptWalk,[target]);
  assert.equal(reference.outcome.code,'source_excluded');
  const candidate=chargedDecision(t,db,createRawLineageStorage,[target]);
  assert.deepEqual(candidate.outcome,reference.outcome);
  // Include the entire call, plus one index beyond either uninterrupted trace.
  const last=Math.max(reference.executions,candidate.executions)+1;
  for(const injected of [{code:'source_budget_exceeded',errcode:null},{code:'ERR_SQLITE_ERROR',errcode:9}]) {
    const outcomes=[];
    for(let at=1;at<=last;at++){
      const old=chargedDecision(t,db,createLegacyReceiptWalk,[target],{at,injected});
      const actual=chargedDecision(t,db,createRawLineageStorage,[target],{at,injected});
      assert.ok(JSON.stringify(actual.outcome)===JSON.stringify(old.outcome)||
        JSON.stringify(actual.outcome)===JSON.stringify(injected),JSON.stringify({at,injected,reference:old.outcome,current:actual.outcome}));
      assert.notEqual(old.outcome.code,'accept');assert.notEqual(actual.outcome.code,'accept');
      outcomes.push({at,reference:old.outcome,current:actual.outcome});
    }
    const atThird=chargedDecision(t,db,createRawLineageStorage,[target],{at:3,injected,fromWalk:true});
    const oldThird=chargedDecision(t,db,createLegacyReceiptWalk,[target],{at:3,injected,fromWalk:true});
    assert.deepEqual(oldThird.outcome,reference.outcome,'the reference refuses before the third walk statement');
    assert.deepEqual(atThird.outcome,oldThird.outcome,'third charged statement after enumeration starts');
    t.diagnostic(JSON.stringify({injected,last,outcomes,third:atThird.outcome}));
  }
});

test('first receipt refusal precedes a later non-representable revision',async t=>{
  const db=await precedenceFixture(t),target=receipt('early');fillPrecedence(db,target,{lateError:true});
  for(const create of [createLegacyReceiptWalk,createRawLineageStorage]){
    const result=chargedDecision(t,db,create,[target]);assert.deepEqual(result.outcome,{code:'source_excluded',errcode:null});
    t.diagnostic(JSON.stringify({implementation:create.name,outcome:result.outcome}));
  }
});

test('nine equal-timestamp receipts retain the malformed final key',async t=>{
  const db=await precedenceFixture(t),target=receipt('equal-last');
  transaction(db,()=>{const id=precedenceMemory(db,0);for(let i=0;i<9;i++){
    const source=i===8?target:receipt('equal-'+i);
    precedenceReceipt(db,id,source,{rid:'receipt-'+i,key:i===8?'inconsistent-key':digest(source)});
  }});
  for(const create of [createLegacyReceiptWalk,createRawLineageStorage])assert.equal(chargedDecision(t,db,create,[target]).outcome.code,'source_excluded');
});

test('first receipt later read error precedes second receipt early refusal',async t=>{
  const db=await precedenceFixture(t),first=receipt('first'),second=receipt('second');
  fillPrecedence(db,first,{lateError:true,second});
  const old=chargedDecision(t,db,createLegacyReceiptWalk,[first,second]);
  const actual=chargedDecision(t,db,createRawLineageStorage,[first,second]);
  assert.equal(old.outcome.code,'ERR_OUT_OF_RANGE');assert.deepEqual(actual.outcome,old.outcome);
  t.diagnostic(JSON.stringify({reference:old.outcome,current:actual.outcome}));
});

test('first receipt late refusal precedes second receipt early refusal',async t=>{
  const db=await precedenceFixture(t),first=receipt('late-first'),second=receipt('early-second');
  fillPrecedence(db,first,{second,lateRefusal:true});
  for(const create of [createLegacyReceiptWalk,createRawLineageStorage]){
    const result=chargedDecision(t,db,create,[first,second]);assert.equal(result.outcome.code,'source_excluded');
    // Reaching the continuation page proves the early second receipt did not refuse inline.
    assert.ok(result.trace.some(sql=>sql.includes('AND updated_at=? AND id>?')));
    t.diagnostic(JSON.stringify({implementation:create.name,outcome:result.outcome,executions:result.executions}));
  }
});

// Keep malformed cursor keys mixed with valid keys. Unwanted prefix rows move
// the filtered boundary without putting the same key at the reference boundary.
for(const placement of ['cursor','non-cursor','both'])test(`stored-key receipt walk inclusion: ${placement}`,async t=>{
  const db=await precedenceFixture(t),native=db.prepare.bind(db);
  const byteKinds=['80','C0AF','E08080','6C0072','EDA080','EDB080','6D6964'];
  let cases=0,roundTrips=0,safeRefusals=0;
  for(const columns of [['created_at'],['id'],['created_at','id']])for(const hex of byteKinds)
    for(const unwanted of [1,2,3])for(const deny of [true,false]) {
      const label=JSON.stringify({placement,columns,hex,unwanted,deny}),namespace={...ns,ownerId:'stored-key-'+cases};
      const wanted=Array.from({length:5},(_,i)=>receipt('stored-key-'+i));
      const batch=[receipt('absent-stored-key'),...wanted];
      transaction(db,()=>{
        const parent='stored-key-parent-'+cases;
        native(`INSERT INTO memories(id,owner_id,scope,project_id,fingerprint,content,kind,origin,confidence,revision,deleted,created_at,updated_at)
          VALUES(?,?,?,?,?,'Synthetic','fact','explicit',1,1,0,'time','time')`).run(parent,namespace.ownerId,namespace.scope,namespace.projectId,parent);
        const insert=(source,id,time,key=digest(source))=>native(`INSERT INTO receipts(id,memory_id,receipt_key,client,session_id,event_id,role,excerpt,created_at)
          VALUES(CAST(? AS TEXT),?,?,?,?,?,?,?,CAST(? AS TEXT))`).run(Buffer.concat([Buffer.from(parent+'-'),id]),parent,key,source.client,source.sessionId,source.eventId,source.role,source.excerpt,time);
        for(let i=0;i<unwanted;i++)insert(receipt('unwanted-'+i),Buffer.from('a'+i),Buffer.from('a'));
        for(let i=0;i<3;i++)insert(wanted[i],Buffer.from('b'+i),Buffer.from('a'));
        const bad=Buffer.concat([Buffer.from('z'),Buffer.from(hex,'hex')]);
        const cursor=placement==='non-cursor'?Buffer.from('y'):bad;
        const target=placement==='cursor'?Buffer.from('z\uE000'):Buffer.concat([bad,Buffer.from('z')]);
        insert(wanted[3],columns.includes('id')?cursor:Buffer.from('c3'),columns.includes('created_at')?cursor:Buffer.from('time'));
        insert(wanted[4],columns.includes('id')?target:Buffer.from('c4'),columns.includes('created_at')?target:Buffer.from('time'),deny?'inconsistent-key':digest(wanted[4]));
        // Earlier rows share the timestamp for id-only cases, so id decides ties.
        if(!columns.includes('created_at'))native("UPDATE receipts SET created_at='time' WHERE memory_id=?").run(parent);
      });
      const stored=native(`SELECT *,hex(created_at) time_hex,hex(id) id_hex FROM receipts
        WHERE memory_id=? ORDER BY created_at,id`).all('stored-key-parent-'+cases);
      const admitted=new Set(wanted.map(source=>source.eventId));
      const expected=stored.filter(row=>admitted.has(row.event_id)).map(row=>row.event_id);
      assert.equal(expected[3],wanted[3].eventId,label+' cursor placement');
      const inDomain=stored.every(row=>Buffer.from(row.created_at).toString('hex').toUpperCase()===row.time_hex&&Buffer.from(row.id).toString('hex').toUpperCase()===row.id_hex);
      const walk=create=>{
        let starts=0,pages=0;const visited=[];
        const hook=t.mock.method(db,'prepare',sql=>{
          const statement=native(sql),all=statement.all.bind(statement);
          statement.all=(...args)=>{
            if(sql.startsWith('SELECT id,revision,deleted,updated_at')&&args[3]===0&&args.length===5)starts++;
            const isBatch=sql.includes('FROM json_each(?) wanted CROSS JOIN receipts');
            const isPage=sql.includes('FROM receipts r INDEXED BY memory_receipts')&&sql.includes('ORDER BY created_at,id LIMIT 5');
            if(isPage&&++pages>128)throw Object.assign(Error('synthetic page bound'),{code:'source_budget_exceeded'});
            const rows=all(...args);
            // The reference discards its batch witness prefix and starts a page
            // at the beginning; the filtered batch itself emits the first four rows.
            if(starts===1&&(isPage||isBatch&&(create!==createLegacyReceiptWalk||rows.length<=4)))visited.push(...rows.slice(0,4).map(row=>row.event_id));
            return rows;
          };
          return statement;
        });
        try{return {decision:transaction(db,()=>decide(()=>create(db).assertReceipts(namespace,batch))),visited};}
        finally{hook.mock.restore();}
      };
      const reference=walk(createLegacyReceiptWalk),filtered=walk(patchedReceiptWalk);
      assert.notEqual(reference.decision,'source_budget_exceeded',label+' reference completes');
      assert.notEqual(filtered.decision,'source_budget_exceeded',label+' filtered completes');
      assert.ok(filtered.decision!=='accept'||reference.decision==='accept',label+' never accepts a reference refusal');
      assert.deepEqual(filtered.visited,expected,label+' exact filtered stored order');
      const required=reference.visited.filter(id=>admitted.has(id));
      let offset=0;
      for(const id of filtered.visited)if(id===required[offset])offset++;
      assert.equal(offset,required.length,label+' every admitted reference row is visited in order');
      if(inDomain){assert.equal(filtered.decision,reference.decision,label+' round-tripping decision and error code');roundTrips++;}
      if(filtered.decision!==reference.decision)safeRefusals++;
      assert.equal(filtered.decision,deny?'source_excluded':'accept',label+' reaches the final key');
      cases++;
    }
  t.diagnostic(JSON.stringify({node:process.version,placement,cases,roundTrips,safeRefusals,byteKinds,columnSets:3,unwantedCounts:[1,2,3]}));
});
