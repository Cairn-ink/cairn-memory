import {installRawSearchTestClock} from '../testing/raw-search-clock.mjs';
import test from 'node:test';
test.beforeEach(installRawSearchTestClock);
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createRawSearchAuthority} from '../raw-search-authority.mjs';
import {openReadDatabase} from '../read-database.mjs';
import {transaction} from '../database.mjs';
import {writeContentSuppressionInside} from '../content-suppression-storage.mjs';
import {safetySourceFixture,searchFixture} from '../testing/raw-search-fixtures.mjs';
import {savedSource,ns,cardHost,localPlainPort} from '../testing/raw-source-fixtures.mjs';
import {eventTimeFixture} from '../testing/receipt-event-time-fixture.mjs';
import {openRawCaptureCore} from '../raw-capture.mjs';
import {rationaleModel} from '../testing/rationale-model.mjs';
import {commitmentReference} from '../testing/raw-search-commitment-reference.mjs';

const groups=['conversations','parts','exclusions','fences','lineage','ancestors','receipts','maps','controls','facts','suppressions','schema','control'];
function copy(db,table,row,patch){
  const value={...row,...patch},names=Object.keys(value);
  db.prepare('INSERT INTO '+table+' ('+names.join(',')+') VALUES ('+names.map(()=>'?').join(',')+')').run(...Object.values(value));
}
function widen(db,table){
  // Singleton/header and client-domain constraints preclude large production
  // cardinalities. Only these synthetic tables widen them to exercise paging.
  db.exec('CREATE TABLE page_copy AS SELECT * FROM '+table+'; DROP TABLE '+table+'; CREATE TABLE '+table+' AS SELECT * FROM page_copy; DROP TABLE page_copy;');
}
function observe(reader){
  const prepare=reader.db.prepare.bind(reader.db),scans=[];let active;
  reader.db.prepare=sql=>{
    const statement=prepare(sql),columns=statement.columns.bind(statement),get=statement.get.bind(statement);
    statement.columns=()=>{const cols=columns();active={columns:cols.map(c=>c.name),rows:[],sizes:[],
      parameters:(sql.match(/\?/g)||[]).length,order:sql.match(/ ORDER BY (.+) LIMIT 50001$/s)[1].split(',').map(name=>name.split('.').at(-1))};scans.push(active);return cols;};
    if(sql.startsWith('SELECT count(*) AS count,json_group_array'))statement.get=(...args)=>{
      const page=get(...args),rows=JSON.parse(page.rows),positions=active.order.map(name=>active.columns.indexOf(name));
      const key=row=>positions.map(index=>row[index]);
      const compare=(a,b)=>{let value=0;for(let i=0;i<a.length&&!value;i++)
        value=typeof a[i]==='number'?Math.sign(a[i]-b[i]):Buffer.compare(Buffer.from(a[i]),Buffer.from(b[i]));return value;};
      if(rows.length&&active.rows.length)assert.ok(compare(key(rows[0]),key(active.rows.at(-1)))>0,'each page advances beyond the previous key');
      for(let i=1;i<rows.length;i++)assert.ok(compare(key(rows[i]),key(rows[i-1]))>0,'page keys are strictly ordered');
      active.rows.push(...rows);active.sizes.push(page.count);
      if(rows.length&&args.length===active.parameters+active.order.length){
        // Exercise the actual native pager with a cursor inside this batch.
        // A predicate accidentally attached to a LEFT JOIN still returns the
        // earlier rows, even when ordinary batch cursors happen to mask it.
        const cursor=positions.map(index=>rows[Math.floor(rows.length/2)][index]);
        const probe=[...args.slice(0,-cursor.length),...cursor],replayed=JSON.parse(get(...probe).rows);
        for(const row of replayed)assert.ok(compare(key(row),cursor)>0,'keyset predicate filters projected rows before pagination');
      }
      return page;
    };
    return statement;
  };
  return scans;
}
function compare(f,authority,scans){
  const bounds={conversations:f.db.prepare('SELECT max(rowid) n FROM raw_conversations').get().n,
    messages:f.db.prepare('SELECT max(rowid) n FROM raw_messages').get().n};
  f.db.exec('BEGIN');let expected;
  try{expected=commitmentReference(f.db,[ns],bounds);}finally{f.db.exec('COMMIT');}
  authority.fence();
  const ordered=[...groups.slice(0,11).map(name=>expected.rows[0][name]),expected.schema,expected.control];
  assert.equal(scans.length,groups.length);
  for(const [i,want] of ordered.entries()){
    assert.deepEqual(scans[i].columns,want.columns,groups[i]+' columns');
    assert.deepEqual(scans[i].rows,want.rows,groups[i]+' ordered rows');
    assert.deepEqual(scans[i].rows.map(JSON.stringify).sort(),want.rows.map(JSON.stringify).sort(),groups[i]+' multiset');
    assert.ok(scans[i].sizes.every(n=>n<=32),groups[i]+' page bound');
  }
  return scans;
}
for(const large of [false,true,'event-time'])test(`commitment pages equal unpaged projections in order and multiplicity: large ${large}`,async t=>{
  const model={extract:()=>({items:[{content:'Synthetic copper fact.',kind:'fact',confidence:.8,sourceIndices:[0]}]})};
  let f;
  if(large==='event-time'){
    const base=await eventTimeFixture(t,33),host=cardHost(),port=localPlainPort(),db=base.connect();
    const core=openRawCaptureCore({path:base.path,model:{...rationaleModel(),...model},privateCards:host.options},
      {mode:'raw-v1',sources:true,port,readPolicy:()=>({generation:'synthetic',reason:null})});
    base.workspace.defer(()=>core.close());base.workspace.defer(()=>db.close());
    f={...base,db,core,host,port,call:(method,input)=>host.call(core,method,input)};
  }else f=safetySourceFixture(t,{model});
  const saved=await savedSource(f,'copper retained'),s=await searchFixture(f);
  const reader=openReadDatabase(f.path,{contextRead:true});f.workspace.defer(()=>reader.db.close());
  const authority=createRawSearchAuthority(reader,s.options);
  const sealed=value=>value===null?null:createHash('sha256').update(value).digest('hex');
  f.db.function('raw_search_sealed_digest',{deterministic:true},sealed);
  if(large){
    const c=f.db.prepare('SELECT * FROM raw_conversations').get(),m=f.db.prepare('SELECT * FROM raw_messages').get();
    const p=f.db.prepare('SELECT * FROM raw_parts').get(),a=f.db.prepare('SELECT * FROM raw_source_maps').get();
    const r=f.db.prepare('SELECT * FROM receipts').get(),control=f.db.prepare('SELECT * FROM content_safety_control').get();
    f.db.exec('BEGIN IMMEDIATE');
    try{
      for(let i=0;i<97;i++){
        const id='page-'+String(i).padStart(3,'0'),owner='page-owner-'+i;
        copy(f.db,'raw_conversations',c,{id,session_key:id});copy(f.db,'raw_messages',m,{conversation_id:id});
        copy(f.db,'raw_parts',p,{conversation_id:id});copy(f.db,'raw_source_maps',a,{conversation_id:id});
        f.db.prepare('INSERT INTO raw_source_exclusions VALUES(?,?,?,?,1)').run(id,m.message_id,0,1);
        f.db.prepare('INSERT INTO raw_session_fences VALUES(?,?,?,?,?)').run(ns.ownerId,ns.scope,ns.projectId??'','codex',id);
        copy(f.db,'receipts',r,{id,receipt_key:id});f.db.prepare("INSERT INTO raw_receipt_origins VALUES(?,'derived')").run(id);
        f.db.prepare('INSERT INTO raw_receipt_lineage VALUES(?,?,?,?,?,?)').run(id,saved.conversationId,m.message_id,0,1,'exact');
        const ancestor='ancestor-'+id;
        copy(f.db,'raw_conversations',c,{id:ancestor,owner_id:owner,session_key:ancestor});
        copy(f.db,'raw_messages',m,{conversation_id:ancestor});
        f.db.prepare('INSERT INTO raw_receipt_lineage VALUES(?,?,?,?,?,?)').run(id,ancestor,m.message_id,0,1,'exact');
        writeContentSuppressionInside(f.db,{namespace:{...ns,ownerId:owner},kind:'raw',key:ancestor,
          reason:'privacy_erase',actionId:'page-fact-'+i});
        // Equal leading keys straddle page boundaries, with distinct part indices.
        copy(f.db,'raw_parts',p,{part_index:i+1});
      }
    }finally{f.db.exec('COMMIT');}
    assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(),[]);
    widen(f.db,'content_safety_control');widen(f.db,'local_capture_controls');
    for(let i=0;i<97;i++){
      f.db.prepare('INSERT INTO local_capture_controls(owner_id,scope,project_id,client,revision) VALUES(?,?,?,?,1)')
        .run(ns.ownerId,ns.scope,ns.projectId??'','page-client-'+i);
      copy(f.db,'content_safety_control',control,{singleton:i+2});
    }
  }
  const scans=compare(f,authority,observe(reader));
  if(large){
    for(const [i,scan] of scans.entries())assert.ok(scan.rows.length>64,groups[i]+' crosses two boundaries');
    const parts=scans[1].rows;
    assert.equal(parts[31][0],parts[32][0]);assert.equal(parts[31][1],parts[32][1]);assert.notEqual(parts[31][2],parts[32][2]);
  }
});
