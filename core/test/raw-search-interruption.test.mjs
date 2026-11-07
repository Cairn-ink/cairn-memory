import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {performance} from 'node:perf_hooks';
import {Hmac} from 'node:crypto';
import {openReadDatabase} from '../read-database.mjs';
import {createRawSearchAuthority} from '../raw-search-authority.mjs';
import {sourceFixture,savedSource,ns} from '../testing/raw-source-fixtures.mjs';
import {cachedContentSuppressionRequestInside} from '../content-suppression-storage.mjs';
import {searchFixture,safetySourceFixture} from '../testing/raw-search-fixtures.mjs';
import {createFakeEmbedder,reserveSharedVectors,MAX_CACHE_BYTES} from '../context-read-embedder.mjs';

const partial={version:'raw-search-v1',publication:null,candidates:[],
  coverage:{status:'partial',scanned:null,expanded:null,causes:['deadline']},semantic:{state:'unknown',reason:null}};
function clock(t){
  const own=Object.getOwnPropertyDescriptor(performance,'now');let now=100;
  Object.defineProperty(performance,'now',{configurable:true,value:()=>now});
  t.after(()=>{if(own)Object.defineProperty(performance,'now',own);else delete performance.now;});
  return ms=>{now+=ms;};
}
async function fixture(t,embedded=false,modern=false){
  const f=(modern?safetySourceFixture:sourceFixture)(t);await savedSource(f,'Synthetic copper telescope.');
  const port=embedded?createFakeEmbedder():undefined;
  const s=await searchFixture(f,port?{embedder:port,policy:{family:'local',maxBatchDocuments:1,maxRequests:50,maxConcurrent:1,maxUsd:0}}:{});
  await s.maintain();if(port){await s.tick({embeddings:true});await s.tick();}
  await s.reopen();return {f,s,port};
}
function moves(t,f,{times=1,final=false}={}){
  const prepare=DatabaseSync.prototype.prepare,exec=DatabaseSync.prototype.exec;
  let pending=false,count=0,pages=0,reader,versionAtStage;
  DatabaseSync.prototype.prepare=function(sql){
    const statement=prepare.call(this,sql),db=this;
    const membership=sql.startsWith('SELECT * FROM (');
    if(membership||final&&sql==='PRAGMA data_version'){
      const method=membership?'all':'get',native=statement[method];
      statement[method]=function(...args){const value=native.apply(this,args);
        if(membership)pages++;
        const stack=new Error().stack;
        let stage=final?stack.includes('at fenceInside')&&stack.includes('at inside'):membership;
        if(final&&stage){const previous=versionAtStage;versionAtStage=value.data_version;if(previous!==undefined&&previous!==versionAtStage)stage=false;}
        if(stage&&count<times){pending=true;reader=db;}return value;};
    }
    return statement;
  };
  DatabaseSync.prototype.exec=function(sql){const value=exec.call(this,sql);
    if(pending&&this===reader&&sql==='COMMIT'){
      pending=false;count++;assert.equal(this.isTransaction,false);
      f.db.exec('UPDATE raw_owner_usage SET revision=revision+1');
    }
    return value;
  };
  const restore=()=>{DatabaseSync.prototype.prepare=prepare;DatabaseSync.prototype.exec=exec;};
  t.after(restore);return {restore,get count(){return count;},get pages(){return pages;}};
}
for(const final of [false,true])test(`one canonical version movement retries a complete fresh search; final snapshot ${final}`,async t=>{
  const {f,s}=await fixture(t);clock(t);const change=moves(t,f,{final});
  const result=await s.search({query:'copper'});
  assert.equal(change.count,1);assert.equal(result.candidates.length,1);
  assert.ok(result.publication);if(!final)assert.ok(change.pages>=2);
});
for(const final of [false,true])test(`two canonical movements return only constants and retain no cache or proof; final snapshot ${final}`,async t=>{
  let armed=false,installations=0;const interval=globalThis.setInterval;
  globalThis.setInterval=(work,ms,...args)=>{if(armed&&ms===1000)installations++;return interval(work,ms,...args);};
  t.after(()=>{globalThis.setInterval=interval;});
  const {f,s,port}=await fixture(t,true);armed=true;clock(t);const change=moves(t,f,{times:2,final});
  const result=await s.search({query:'copper'});assert.equal(change.count,2);assert.deepEqual(result,partial);assert.equal(installations,0,'a torn rebuild must never install cache state');armed=false;
  assert.deepEqual(await s.service.classify(result,{},s.host.token),{kind:'denied',reason:'source-or-authority-unavailable'});
  await assert.rejects(s.prepare(result),{code:'stale_publication'});
  assert.throws(()=>s.service.revalidate([result]),{code:'raw_search_unavailable'});
  const lease=reserveSharedVectors(20000,port,MAX_CACHE_BYTES-20000*port.dimensions*4);
  assert.ok(lease,'an aborted operation cannot retain vectors or hint bytes');lease.release();
  change.restore();const prepare=DatabaseSync.prototype.prepare;let loads=0;
  DatabaseSync.prototype.prepare=function(sql){if(sql.startsWith('SELECT s.*,h.sequence'))loads++;return prepare.call(this,sql);};
  try{assert.equal((await s.search({query:'copper'})).candidates.length,1);assert.ok(loads>0);}
  finally{DatabaseSync.prototype.prepare=prepare;}
});
test('an earlier ticket refuses when repeated version movements prevent confirmation',async t=>{
  const {f,s}=await fixture(t);clock(t);
  const candidate=(await s.search({query:'copper'})).candidates[0],handle=await s.prepare(candidate);
  f.db.exec('UPDATE raw_owner_usage SET revision=revision+1');const change=moves(t,f,{times:2});
  assert.throws(()=>s.service.revalidate([handle]),{code:'raw_search_unavailable'});assert.equal(change.count,2);
});
for(const method of ['classify','prepare','revalidate'])test(`earlier proofs retry one native version movement during ${method}`,async t=>{
  const {f,s}=await fixture(t);clock(t);
  const candidate=(await s.search({query:'copper'})).candidates[0],handle=await s.prepare(candidate);
  f.db.exec('UPDATE raw_owner_usage SET revision=revision+1');const change=moves(t,f);
  if(method==='classify')assert.notEqual((await s.service.classify(candidate,{},s.host.token)).kind,'denied');
  else if(method==='prepare')assert.ok((await s.prepare(candidate)).ticket);
  else assert.equal(s.service.revalidate([handle])[0],handle.value);
  assert.equal(change.count,1);
});
test('busy search waits for the guard resume with no transaction and then succeeds',async t=>{
  const {f,s}=await fixture(t);const advance=clock(t),timeout=globalThis.setTimeout;
  const exec=DatabaseSync.prototype.exec,readers=new Set();let waits=0,locked=true;
  f.db.exec('BEGIN EXCLUSIVE');
  globalThis.setTimeout=(work,ms,...args)=>{
    waits++;assert.ok(ms>=25);for(const reader of readers)assert.equal(reader.isTransaction,false);
    f.db.exec('ROLLBACK');locked=false;advance(ms);
    return timeout(work,0,...args);
  };
  DatabaseSync.prototype.exec=function(sql){if(sql==='BEGIN'){readers.add(this);if(waits)assert.equal(this.isTransaction,false);}return exec.call(this,sql);};
  try{assert.equal((await s.search({query:'copper'})).candidates.length,1);assert.equal(waits,1);}
  finally{globalThis.setTimeout=timeout;DatabaseSync.prototype.exec=exec;if(locked)f.db.exec('ROLLBACK');}
});
test('busy exhaustion is the same empty partial and waits only with one page remaining',async t=>{
  const {f,s}=await fixture(t);const advance=clock(t),timeout=globalThis.setTimeout;
  let waits=0;f.db.exec('BEGIN EXCLUSIVE');
  globalThis.setTimeout=(work,ms,...args)=>{waits++;assert.ok(ms>=25);advance(ms);return timeout(work,0,...args);};
  try{assert.deepEqual(await s.search({query:'copper'}),partial);assert.equal(waits,36);}
  finally{globalThis.setTimeout=timeout;f.db.exec('ROLLBACK');}
});
for(const phase of ['snapshot','selection','final'])test(`expiry in ${phase} releases snapshots and returns the constant partial`,async t=>{
  const {s}=await fixture(t);const advance=clock(t),prepare=DatabaseSync.prototype.prepare;
  let crossed=false;
  DatabaseSync.prototype.prepare=function(sql){
    const statement=prepare.call(this,sql);
    const match=phase==='snapshot'?sql.startsWith('SELECT s.*,h.sequence'):
      phase==='selection'?sql.includes('FROM raw_parts WHERE'):sql==='PRAGMA data_version'&&new Error().stack.includes('at fenceInside');
    if(match&&!crossed){crossed=true;advance(1001);}return statement;
  };
  try{assert.deepEqual(await s.search({query:'copper'}),partial);assert.equal(crossed,true);}
  finally{DatabaseSync.prototype.prepare=prepare;}
});
test('bounded commitment and cache hashes preserve the original JSON digest',async t=>{
  clock(t);
  for(const factory of [sourceFixture,safetySourceFixture]){
    const f=factory(t,{model:{extract:()=>({items:[{content:'Synthetic copper fact.',kind:'fact',confidence:.8,sourceIndices:[0]}]})}});
    await savedSource(f,'Synthetic copper "telescope" with Unicode \u00e9.');const s=await searchFixture(f);
    const reader=openReadDatabase(f.path,{contextRead:true});t.after(()=>reader.db.close());
    const authority=createRawSearchAuthority(reader,s.options),ordinary=authority.fence();
    authority.reset();assert.equal(authority.fence(undefined,1100),ordinary);
    const publication={generation:'synthetic',sequence:1,revision:1},metadata={id:'synthetic',revision:'1',dimensions:2,normalization:'l2'};
    assert.equal(authority.cacheKey(publication,metadata,1100),authority.cacheKey(publication,metadata));
  }
});
test('expiry while hashing stops within one value and retains no commitment output',async t=>{
  const {s}=await fixture(t);const advance=clock(t),update=Hmac.prototype.update;let updates=0;
  Hmac.prototype.update=function(...args){
    const result=update.apply(this,args);
    if(new Error().stack.includes('at bindWithin')){updates++;if(updates===2)advance(1001);}
    return result;
  };
  try{assert.deepEqual(await s.search({query:'copper'}),partial);assert.ok(updates>=2&&updates<=3);}
  finally{Hmac.prototype.update=update;}
});
test('a retry discards denial memos before rebuilding in the same request',async t=>{
  const {f,s}=await fixture(t,false,true);clock(t);
  const change=moves(t,f,{final:true}),prepare=DatabaseSync.prototype.prepare,states=[];
  DatabaseSync.prototype.prepare=function(sql){
    if(sql.startsWith('SELECT * FROM (SELECT client,session_key,id FROM raw_conversations WHERE'))
      states.push(Boolean(cachedContentSuppressionRequestInside(this,ns.ownerId)));
    return prepare.call(this,sql);
  };
  try{
    assert.equal((await s.search({query:'copper'})).candidates.length,1);assert.equal(change.count,1);
    assert.ok(states.length>=2);assert.deepEqual(states,states.map(()=>false));
  }finally{change.restore();}
});

for(const modern of [false,true])for(const linked of [false,true])test(`every row statement deadline preserves the service connection; safety ${modern}, linked ${linked}`,async t=>{
  const advance=clock(t),stackLimit=Error.stackTraceLimit;Error.stackTraceLimit=100;t.after(()=>{Error.stackTraceLimit=stackLimit;});
  const f=(modern?safetySourceFixture:sourceFixture)(t,linked?{model:{extract:()=>({items:[{content:'Synthetic copper fact.',kind:'fact',confidence:.8,sourceIndices:[0]}]})}}:{model:{extract:()=>({items:[]})}});
  await savedSource(f,'Synthetic copper telescope.');const s=await searchFixture(f);await s.maintain();await s.reopen();
  const prepare=DatabaseSync.prototype.prepare;let count=0,target=Infinity,armed=true,crossed=false,connection;
  DatabaseSync.prototype.prepare=function(sql){
    const statement=prepare.call(this,sql),stack=new Error().stack;
    if(armed&&stack.includes('at checkInside')&&stack.includes('at selectUnit')){
      connection=this;count++;
      if(count===target){crossed=true;advance(1001);}
    }
    return statement;
  };
  try{
    assert.equal((await s.search({query:'copper'})).candidates.length,1);
    const statements=count;assert.ok(statements>5);
    for(let k=1;k<=statements;k++){
      armed=false;await s.reopen();count=0;target=k;crossed=false;armed=true;
      assert.deepEqual(await s.search({query:'copper'}),partial,`statement ${k}/${statements}`);
      assert.equal(crossed,true);assert.equal(connection.isOpen,true);assert.equal(connection.isTransaction,false);
      armed=false;
      assert.equal((await s.search({query:'copper'})).candidates.length,1,`recovery after statement ${k}`);
    }
  }finally{DatabaseSync.prototype.prepare=prepare;}
});

test('an opening interrupt in layout attestation is deadline-shaped and a later factory open succeeds',async t=>{
  const advance=clock(t),f=safetySourceFixture(t),s=await searchFixture(f);await savedSource(f,'Synthetic copper telescope.');
  await s.maintain();await s.service.close();
  const prepare=DatabaseSync.prototype.prepare;let crossed=false,connection;
  DatabaseSync.prototype.prepare=function(sql){
    const statement=prepare.call(this,sql);
    if(!crossed&&new Error().stack.includes('at installedContentLayout')){connection=this;crossed=true;advance(1001);}
    return statement;
  };
  try{await assert.rejects(s.reopen(),{code:'raw_search_unavailable'});assert.equal(crossed,true);assert.equal(connection.isOpen,false);}
  finally{DatabaseSync.prototype.prepare=prepare;}
  await s.reopen();assert.equal((await s.search({query:'copper'})).candidates.length,1);
});

test('a genuinely invalid layout permanently refuses the same connection after repair',async t=>{
  clock(t);const f=sourceFixture(t),reader=openReadDatabase(f.path,{contextRead:true});t.after(()=>reader.db.close());
  const {installedContentLayout}=await import('../content-safety-schema.mjs');
  assert.ok(installedContentLayout(reader.db));
  f.db.exec('PRAGMA application_id=1');
  assert.throws(()=>installedContentLayout(reader.db),{code:'unsupported_database'});
  f.db.exec('PRAGMA application_id=1128352082');
  assert.throws(()=>installedContentLayout(reader.db),{code:'unsupported_database'});
  const fresh=openReadDatabase(f.path,{contextRead:true});fresh.db.close();
});

for(const phase of ['opening','operation'])test(`native ${phase} deadline inside the layout header permits cleanup and connection reuse`,async t=>{
  const advance=clock(t),f=safetySourceFixture(t);await savedSource(f,'Synthetic copper telescope.');
  const s=await searchFixture(f),reader=openReadDatabase(f.path,{contextRead:true});t.after(()=>reader.db.close());
  const {rawSearchSqlite,rawSearchDeadline}=await import('../raw-search-sqlite.mjs');
  const {bindContentSafetyConnection}=await import('../content-safety-schema.mjs');
  let armed=false,expired=false,crossed=false;
  const db=rawSearchSqlite(reader.db,()=>{if(expired)rawSearchDeadline();});bindContentSafetyConnection(db,reader.db);
  const authority=createRawSearchAuthority({...reader,db},s.options),source=authority.inventory().rows.find(row=>row.source).source;
  const expected=authority.check(source).classification;
  const prepare=DatabaseSync.prototype.prepare;
  DatabaseSync.prototype.prepare=function(sql){const statement=prepare.call(this,sql);
    if(armed&&!crossed&&new Error().stack.includes('at installedContentLayout')){crossed=true;expired=true;advance(1001);}
    return statement;
  };
  try{
    armed=true;assert.throws(()=>authority.check(source),{code:'search_deadline',reason:'deadline'});
    assert.equal(crossed,true);assert.equal(reader.db.isOpen,true);assert.equal(reader.db.isTransaction,false);
    expired=false;armed=false;assert.deepEqual(authority.check(source).classification,expected);
  }finally{DatabaseSync.prototype.prepare=prepare;}
});
