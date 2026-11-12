import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { transaction } from '../database.mjs';
import { createRawLineageStorage, isSourceSnapshotOverflow } from '../raw-lineage-storage.mjs';
import { createLegacyReceiptWalk, isSourceSnapshotOverflow as legacyOverflow } from '../testing/receipt-walk-reference.mjs';
import { safetyFixture } from '../testing/content-safety-s2h-fixture.mjs';
import { eventTimeSafetyFixture } from '../testing/receipt-event-time-fixture.mjs';
import { writeContentSuppressionInside, withContentSuppressionRequest, contentSuppressionRequestInside } from '../content-suppression-storage.mjs';

const ns={ownerId:'synthetic-owner',scope:'project',projectId:'synthetic-project'};
// The final seed was randomly drawn once and retained for replay.
const seeds=[1,0x12345678,0xdeadbeef,0xffffffff,0xa577354];
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
    if(layout===53){
      const source=receipt('raw-ancestry'),parent=add(source);
      db.prepare("INSERT INTO raw_conversations VALUES('ancestry',?,?,?,'claude-code','ancestry-session',1,'time','time')").run(ns.ownerId,ns.scope,ns.projectId);
      db.prepare("INSERT INTO raw_messages(conversation_id,message_id,ordinal,role,total_units,total_bytes,assembly_state,first_event_id) VALUES('ancestry','message',1,'user',10,10,'pending','event')").run();
      db.prepare("INSERT INTO raw_receipt_lineage VALUES(?,'ancestry','message',0,10,'exact')").run(parent.rid);
      writeContentSuppressionInside(db,{namespace:ns,kind:'raw',matchMode:'span',key:'ancestry',messageId:'message',start:0,end:10,reason:'purge',actionId:'ancestry'});
      sources.push(source);
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
  const legacy=createLegacyReceiptWalk(db),current=createRawLineageStorage(db);let cases=0,accepted=0,refused=0;
  const compare=(batch,label)=>{
    const old=transaction(db,()=>decide(()=>legacy.assertReceipts(ns,batch)));
    const actual=transaction(db,()=>decide(()=>current.assertReceipts(ns,batch)));
    assert.equal(actual,old,JSON.stringify({layout,seed,label,batch}));cases++;if(old==='accept')accepted++;else refused++;
    return actual;
  };
  for(const [label,source]of Object.entries(controls)){
    const result=compare([source],label);
    assert.equal(result,layout===18||['foreign','safe','near','withheld','empty','historical','awaiting','suppressed'].includes(label)?'accept':'source_excluded',label);
  }
  for(const source of sources)compare([source],'single');
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
      if(sql.startsWith('SELECT id,revision,deleted,updated_at FROM memories'))statement.all=(...args)=>{if(args.length===5)starts++;return all(...args);};
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
    const actual=snapshotDecision(current,isSourceSnapshotOverflow,namespace,[source,source]);
    assert.deepEqual(actual,old,JSON.stringify({layout,seed,kind,route:'snapshot'}));
    assert.equal(old.decision,layout===18||kind==='validated'||kind==='ancestry'&&layout!==53?'accept':kind==='deleted'?'source_excluded':'source_budget_exceeded');
    snapshotComparisons++;
  }
  const old=snapshotDecision(legacy,legacyOverflow,ns,[controls.safe]);
  const actual=snapshotDecision(current,isSourceSnapshotOverflow,ns,[controls.safe]);
  assert.deepEqual(actual,old,JSON.stringify({layout,seed,route:'generated snapshot'}));snapshotComparisons++;
  assert.ok(accepted>0);if(layout===53)assert.ok(refused>0);
  for(const state of ['deleted','forgotten','suppressed','withheld','memory-fact','receipt-fact'])assert.ok(states.get(state)>0,state);
  t.diagnostic(JSON.stringify({node:process.version,layout,seed,cases,snapshotComparisons,accepted,refused,states:Object.fromEntries(states)}));
});
