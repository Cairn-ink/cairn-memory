import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync, backup } from 'node:sqlite';
import { chmodSync } from 'node:fs';
import { join } from 'node:path';
import { fork, spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { configured, card } from '../testing/context-product-owner-fixture.mjs';
import { createProductReaderRuntime, maintenancePhaseDiagnostic } from '../context-product-reader.mjs';
import { fixture, ns } from '../testing/context-read-fixture.mjs';
import { local, inspect, workRow, snapshot, authenticate } from '../testing/context-product-verification-fixture.mjs';
import { ManifestHash } from '../context-product-manifest.mjs';
import { REPRESENTATION_VERSION } from '../context-read-tokenize.mjs';
import * as diagnostics from '../context-product-attribution.mjs';
const batchModule=await import('../context-product-verification-batch.mjs').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return {};throw e;});
const implemented=typeof diagnostics.verificationBatchingQualified==='function';
function seeded(t,{mode='DELETE',enabled=true,count=160,state}={}) {
  const f=fixture(t);for(let i=0;i<count;i++)f.admit('orchard needle '+i+' '+Array.from({length:12},(_,j)=>'term'+j).join(' '));
  const a=local(f.path,{mode,enabled,state});f.workspace.defer(()=>a.close());return {f,a};
}
async function captured(t,f,mode,enabled,types) {
  const path=join(f.workspace.path,(enabled?'batch':'single')+'.sqlite');await backup(f.db,path);chmodSync(path,0o600);
  const a=local(path,{mode,enabled,types});f.workspace.defer(()=>a.close());return {a,path};
}
function rows(path,publication) {
  return inspect(path,db=>{
    const key=db.prepare('SELECT storage_id FROM generations WHERE id=?').get(publication.generation.id).storage_id;
    return [
      db.prepare('SELECT stream,id,identity,revision,body_revision,eligible,token_length FROM documents WHERE generation=?').all(key),
      db.prepare('SELECT d.identity,s.term,p.frequency,p.position FROM postings p JOIN documents d ON d.generation=p.generation AND d.doc=p.doc JOIN statistics s ON s.generation=p.generation AND s.term_id=p.term WHERE p.generation=?').all(key),
      db.prepare('SELECT term,df,n,total_length,verified_df FROM statistics WHERE generation=?').all(key)
    ].map(rows=>rows.map(row=>({...row})).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))));
  });
}
for(const mode of ['DELETE','WAL'])test(`verification equivalence and structural counts ${mode}`,async t=>{
  const {f,a}=seeded(t,{mode,enabled:false,count:80});const b=await captured(t,f,mode,true),exec=DatabaseSync.prototype.exec;
  t.mock.method(DatabaseSync.prototype,'exec',function(sql){
    if(sql==='COMMIT'&&this.prepare('PRAGMA application_id').get().application_id===0x43525032){assert.equal(this.prepare('PRAGMA synchronous').get().synchronous,2);assert.equal(this.prepare('PRAGMA journal_mode').get().journal_mode,mode.toLowerCase());}
    return exec.call(this,sql);
  });
  const totals=runner=>{const sum={};let publication;for(let i=0;i<100;i++){
    runner.step();for(const [k,v]of Object.entries(runner.attribution.snapshot()))sum[k]=(sum[k]??0)+v;
    publication=runner.observe().publication;if(publication)break;
  }return {publication,sum};};
  const old=totals(a),batched=totals(b.a);assert.ok(old.publication&&batched.publication);
  assert.equal(old.publication.manifestDigest,batched.publication.manifestDigest);
  assert.deepEqual(old.publication.counts,batched.publication.counts);assert.deepEqual(rows(f.path,old.publication),rows(b.path,batched.publication));
  for(const query of ['orchard','needle','term1'])assert.deepEqual(a.lexical(old.publication,query),b.a.lexical(batched.publication,query));
  t.diagnostic(JSON.stringify({mode,off:Object.fromEntries(Object.entries(old.sum).filter(([k])=>/Commit|Rollbacks/.test(k))),on:Object.fromEntries(Object.entries(batched.sum).filter(([k])=>/Commit|Rollbacks/.test(k)))}));
  assert.ok(batched.sum.verificationCommits<old.sum.verificationCommits,'gated verification reduces actual COMMIT count');
  assert.ok(batched.sum.verificationUnits>batched.sum.verificationCommits,'several verification units share a COMMIT');
  assert.ok(b.a.batchChunks()>1,'several complete chunks share an actual verification COMMIT');
  assert.equal(inspect(b.path,db=>db.prepare('PRAGMA synchronous').get().synchronous),2,'FULL retained');
});
test('gate-off passing control: default equals explicit false; no public option',async t=>{
  assert.equal(diagnostics.verificationBatchingQualified?.()??false,false);
  const {f,a}=seeded(t,{enabled:false,count:9}),b=await captured(t,f,'DELETE',false);
  a.prepare();b.a.prepare();const beforeA=workRow(f.path),beforeB=workRow(b.path);
  let commits=0;const exec=DatabaseSync.prototype.exec,writes=new WeakSet();
  t.mock.method(DatabaseSync.prototype,'exec',function(sql){
    const result=exec.call(this,sql);
    if(sql==='BEGIN IMMEDIATE'&&this.prepare('PRAGMA application_id').get().application_id===0x43525032)writes.add(this);
    if(sql==='COMMIT'&&writes.has(this)){commits++;writes.delete(this);}return result;
  });
  a.step();b.a.step();assert.deepEqual(a.attribution.snapshot(),b.a.attribution.snapshot());
  assert.equal(commits,12,'base control: five verification commits and one publication per build');
  const fields=a.attribution.snapshot();
  for(const [field,value]of Object.entries({unitCount:322,verificationUnits:313,scanUnits:6,scanRows:312,verificationRows:336,publicationUnits:1,gcUnits:2,itemUnits:0}))assert.equal(fields[field],value,field+' equals base fixture accounting');
  assert.equal(a.observe().publication.generation.checkpoint,7,'base checkpoint ordinal');
  assert.equal(a.observe().publication.generation.checkpoint-beforeA.checkpoint,b.a.observe().publication.generation.checkpoint-beforeB.checkpoint);
});
for(const mode of ['DELETE','WAL'])for(const stage of ['documents','postings'])for(const point of ['mid','before','after','native'])
test(`SIGKILL ${mode} ${stage} ${point}: independent old-or-new document prefix oracle (base control)`,async t=>{
  if(point==='native'&&(process.platform!=='linux'||spawnSync('strace',['--version']).status!==0)){t.skip('external syscall rendezvous unavailable');return;}
  const {f,a}=seeded(t,{mode,count:160});a.prepare();
  if(stage==='postings'){
    new Int32Array(a.state)[0]=-1;a.setHook(point=>{if(point==='verification')a.setClock(900);});
    for(let i=0;i<30;i++){a.step();const v=JSON.parse(workRow(f.path).verify);if(v.phase===1&&v.resetDone&&v.postings>0)break;}
  }
  a.close();
  const old=inspect(f.path,snapshot),g=old.generation,v=JSON.parse(g.verify);
  assert.equal(v.phase,stage==='documents'?0:1);
  // Expected prefix comes from independently captured SQL rows, never batch counters.
  const count=implemented?64:128,hash=new ManifestHash(v.hash),expected=structuredClone(v),expectedStatistics=structuredClone(old.statistics);
  if(stage==='documents'){
    const selected=old.documents.slice(0,count);
    for(const r of selected)hash.update(JSON.stringify(['document',JSON.parse(r.identity),r.revision,r.body_revision,r.eligible,REPRESENTATION_VERSION,r.token_length])+'\n');
    expected.last=[selected.at(-1).identity];expected.counts.documents=count;
    expected.counts.totalTokenLength=selected.reduce((n,r)=>n+r.token_length,0);
    expected.counts.byType.memory={eligible:selected.reduce((n,r)=>n+r.eligible,0),indexed:selected.reduce((n,r)=>n+r.eligible,0)};
  }else{
    const docs=new Map(old.documents.map(row=>[row.doc,row])),terms=new Map(old.statistics.map(row=>[row.term_id,row.term]));
    const stream=old.postings.map(row=>({...row,identity:docs.get(row.doc).identity,text:terms.get(row.term)})).sort((a,b)=>Buffer.compare(Buffer.from(a.identity),Buffer.from(b.identity))||a.position-b.position);
    const selected=stream.filter(row=>row.identity>v.last[0]||row.identity===v.last[0]&&row.position>v.last[1]).slice(0,count),last=selected.at(-1);
    for(const r of selected){hash.update(JSON.stringify(['posting',JSON.parse(r.identity),r.text,r.frequency])+'\n');expectedStatistics.find(row=>row.term_id===r.term).verified_df++;}
    expected.last=[last.identity,last.position];expected.postings=v.postings+count;expected.documentIdentity=last.identity;
    expected.documentLength=stream.filter(row=>row.identity===last.identity&&row.position<=last.position).reduce((n,row)=>n+row.frequency,0);
    expected.previousTerm=last.text;delete expected.documentDone;
  }
  expected.hash=hash.state();
  const entry=new URL('../testing/context-product-verification-process.mjs',import.meta.url).pathname;
  let child,trace='',stderr='',pid,stopped,nativeChunks;
  if(point==='native'){
    // External ptrace injects SIGSTOP at the first sync *inside* native COMMIT.
    child=spawn('strace',['-e','trace=fdatasync,fsync','-e','inject=fdatasync:signal=SIGSTOP:when=1','-e','inject=fsync:signal=SIGSTOP:when=1',process.execPath,entry,f.path,mode,point],{env:{},stdio:['ignore','pipe','pipe']});
    stopped=new Promise(resolve=>{const check=()=>{if(/SIGSTOP/.test(stderr)&&pid&&nativeChunks!==undefined)resolve({chunks:nativeChunks});};child.stdout.on('data',b=>{trace+=b;const started=/maintenance-pid (\d+)/.exec(trace);if(started)pid=Number(started[1]);const m=/native-commit (\d+) (\d+)/.exec(trace);if(m){pid=Number(m[1]);nativeChunks=Number(m[2]);}check();});child.stderr.on('data',b=>{stderr+=b;check();});});
  } else {
    child=fork(entry,[f.path,mode,point],{env:{},execArgv:[],stdio:['ignore','ignore','pipe','ipc']});
    stopped=once(child,'message').then(([message])=>{pid=message.pid;return message;});child.stderr.on('data',b=>stderr+=b);
  }
  let exited=false;const reaped=once(child,'exit').then(([code,signal])=>{exited=true;return {code,signal};});
  const stop=()=>{if(exited)return;if(pid)try{process.kill(pid,'SIGKILL');}catch(e){if(e.code!=='ESRCH')throw e;}if(!exited)child.kill('SIGKILL');};
  f.workspace.defer(async()=>{stop();if(!exited)await reaped;});
  const timer=setTimeout(stop,30000);
  let barrier;try{barrier=await Promise.race([stopped,reaped.then(result=>assert.fail('child exited before barrier '+JSON.stringify(result)+' '+stderr))]);}finally{clearTimeout(timer);}
  if(point!=='native')assert.equal(barrier.cacheSize,1,'non-native barriers force bounded cache spill');
  if(implemented)assert.ok(barrier.chunks>=(point==='mid'?1:2),'crash reaches a transaction with multiple admitted chunks');
  process.kill(pid,'SIGKILL');const exit=await reaped; // Recovery only after reaping the maintenance child.
  if(point==='native')assert.match(stderr,/(?:fdatasync|fsync)\(.*\)[\s\S]*SIGSTOP/,'external rendezvous is inside native sync');
  t.diagnostic(JSON.stringify({maintenanceChild:point==='native'?'traced':'direct',...exit}));
  const recovered=inspect(f.path,snapshot),actual=JSON.parse(recovered.generation.verify);
  if(point==='mid'||point==='before')assert.deepEqual(recovered,old,'interrupted transaction leaves exact durable state');
  else if(point==='after')assert.deepEqual(actual,expected,'lost reply retains complete independently computed prefix');
  else assert.ok(JSON.stringify(actual)===JSON.stringify(v)||JSON.stringify(actual)===JSON.stringify(expected),'native interruption is old or complete new');
  const isNew=JSON.stringify(actual)===JSON.stringify(expected);
  assert.equal(recovered.generation.checkpoint,g.checkpoint+Number(isNew));
  assert.deepEqual(recovered.documents,old.documents);assert.deepEqual(recovered.postings,old.postings);assert.deepEqual(recovered.statistics,isNew?expectedStatistics:old.statistics);
  const resumed=local(f.path,{mode,enabled:true});f.workspace.defer(()=>resumed.close());authenticate(resumed,recovered);
  const rebuilt=await captured(t,f,mode,false),publication=resumed.finish(),baseline=rebuilt.a.finish();
  assert.equal(publication.generation.id,g.id,'authenticated crash prefix resumes without rebuilding');
  assert.equal(publication.manifestDigest,baseline.manifestDigest);assert.deepEqual(publication.counts,baseline.counts);
});

test('reserved tail, cap/reset and cooperative time bound',()=>{
  assert.equal(typeof batchModule.verificationBatch,'function','private batching policy is implemented');
  let now=0;const state=new SharedArrayBuffer(8),q={batchStart:0,cutoff:1000,reserve:150,admit:()=>1000-now>160,measure:fn=>fn()};
  const call=batchModule.verificationBatch({now:()=>now,quantum:q,state}),first=call.begin();
  assert.equal(first.width,1,'fresh cap calibrates one chunk');now=850;
  assert.equal(first.work(),false);assert.doesNotThrow(()=>first.tail(),'reserved tail does not reserve headroom again');
  first.committed();now=0;const second=call.begin();assert.equal(second.width,8);
  assert.equal(batchModule.verificationBatch({now:()=>now,quantum:q,state}).begin().width,1,'a fresh call or lane calibrates independently');
  now=100;assert.equal(second.work(),false,'active work ceiling closes prefix');
  now=990;assert.throws(()=>second.tail(),e=>e===batchModule.verificationBound);assert.equal(second.shortage,true);
  const replacement=batchModule.verificationBatch({now:()=>0,quantum:q,state}).begin();assert.equal(replacement.width,1,'shortage cap survives replacement');
  const fresh=new SharedArrayBuffer(8),slow=batchModule.verificationBatch({now:()=>now,quantum:q,state:fresh});now=0;
  const b=slow.begin();b.tail();now=900;b.committed();assert.equal(slow.begin().work(),false,'adaptive reserve is capped inside this call');
  now=0;assert.equal(batchModule.verificationBatch({now:()=>now,quantum:q,state:fresh}).begin().work(),true,'reserve resets next call');
});
test('row and byte preflight are bounded before payload materialization; oversized fallback remains valid',t=>{
  assert.equal(typeof batchModule.verificationMeter,'function','bounded verifier reader is implemented');
  const db=new DatabaseSync(':memory:');t.after(()=>db.close());db.exec('CREATE TABLE sample(value TEXT)');
  for(let i=0;i<32;i++)db.prepare('INSERT INTO sample VALUES(?)').run('x');
  const meter=batchModule.verificationMeter(db);let reads=0;
  while(true){try{meter.db.prepare('SELECT * FROM sample LIMIT 32').all();reads++;}catch(e){assert.equal(e,batchModule.verificationBound);break;}}
  assert.ok(reads>1);assert.ok(meter.rows<=1024);assert.ok(meter.bytes<=1024*1024);
  db.exec('DELETE FROM sample');db.prepare('INSERT INTO sample VALUES(?)').run('x'.repeat(200000));
  assert.throws(()=>batchModule.verificationMeter(db).db.prepare('SELECT * FROM sample LIMIT 32').all(),e=>e===batchModule.verificationBound);
});
for(const mode of ['DELETE','WAL'])for(const outcome of ['prefix','shortage','cutoff','race'])
test(`batch ${mode} ${outcome}: durable state, attempts and no empty checkpoint`,t=>{
  const state=new SharedArrayBuffer(8);new Int32Array(state)[0]=1;
  const {f,a}=seeded(t,{mode,state,count:160});a.prepare();const old=inspect(f.path,snapshot);let chunks=0;
  a.setHook(point=>{
    if(point!=='verification-chunk')return;
    chunks++;
    if(outcome==='race'&&chunks===2){const db=new DatabaseSync(f.path);try{db.exec('UPDATE namespace_epochs SET epoch=epoch+1');}finally{db.close();}}
    if(outcome!=='race'&&chunks===2)a.setClock(outcome==='prefix'?850:outcome==='shortage'?990:1000);
  });
  if(outcome==='cutoff')assert.throws(()=>a.step(),{code:'read_timeout'});else a.step();
  assert.ok(chunks>1,'schedule reached several tentative chunks');
  const after=inspect(f.path,snapshot),fields=a.attribution.snapshot();
  assert.ok(fields.verificationRows>0,'attempts stay charged even after rollback');
  if(outcome==='prefix'){
    assert.equal(after.generation.checkpoint,old.generation.checkpoint+1,'one checkpoint for complete prefix');
    assert.equal(JSON.parse(after.generation.verify).counts.documents,64);
  } else {
    assert.deepEqual(after,old,'whole open batch rolls back without an empty checkpoint');
    assert.equal(fields.verificationRollbacks,1);
  }
  if(outcome==='shortage'){
    assert.equal(new Int32Array(state)[0],-1);a.reopen();chunks=0;a.setHook(point=>{if(point==='verification-chunk')chunks++;if(point==='verification')a.setClock(900);});
    a.step();assert.equal(chunks,1,'successor retains single-chunk backoff');
    assert.ok(workRow(f.path).checkpoint>old.generation.checkpoint,'smaller prefix progresses next call');
  }
});
for(const mode of ['DELETE','WAL'])for(const changed of [false,true])
test(`replay ${mode} ${changed?'changed contribution':'unchanged retarget'}: reuse, verification coverage and rebuild control`,async t=>{
  const {f,a}=seeded(t,{mode,count:40});a.prepare();let chunks=0,items=0;
  a.setHook(point=>{if(point==='verification-chunk'&&++chunks===1||!implemented&&point==='verify-item'&&++items===32)a.setClock(850);});a.step();a.setHook(()=>{});
  const before=workRow(f.path);assert.ok(JSON.parse(before.verify).last.length>0,'nonempty signed verification prefix');
  if(changed)f.admit('new changed contribution');else {const db=new DatabaseSync(f.path);try{db.exec('UPDATE namespace_epochs SET epoch=epoch+1');}finally{db.close();}}
  a.reopen();const observed=[];a.setHook(point=>{if(point==='checkpoint')a.setClock(900);});
  for(let i=0;i<10;i++){const m=a.step();observed.push(m);if(workRow(f.path).phase>=1)break;}
  assert.equal(workRow(f.path).id,before.id,'authenticated artifacts reused on reset');
  assert.ok(observed.some(m=>changed?m.verificationRestarts===1:m.verificationKept===1));
  assert.equal(a.observe().publication,null,'preparation earns no publication/closure credit');a.setHook(()=>{});
  const b=await captured(t,f,mode,false),publication=a.finish(),expected=b.a.finish();
  if(implemented)assert.ok(a.batchChunks()>1,'replay exercises a multi-chunk COMMIT');
  assert.equal(publication.manifestDigest,expected.manifestDigest);assert.deepEqual(publication.counts,expected.counts);
  assert.deepEqual(rows(f.path,publication),rows(b.path,expected));
});
test('verification COMMIT failure preserves initiating cause when rollback also fails',t=>{
  const state=new SharedArrayBuffer(8);new Int32Array(state)[0]=1;
  const {f,a}=seeded(t,{state});a.prepare();const before=inspect(f.path,snapshot),exec=DatabaseSync.prototype.exec;
  let active=false;a.setHook(point=>{if(point==='verification-chunk')active=true;});
  t.mock.method(DatabaseSync.prototype,'exec',function(sql){
    if(active&&sql==='COMMIT'&&this.prepare('PRAGMA application_id').get().application_id===0x43525032)throw new TypeError('initiating commit failure');
    const result=exec.call(this,sql);if(active&&sql==='ROLLBACK'&&this.prepare('PRAGMA application_id').get().application_id===0x43525032)throw Error('secondary rollback failure');return result;
  });
  assert.throws(()=>a.step(),{name:'TypeError',message:'initiating commit failure'});
  assert.equal(a.attribution.failure()?.errorName,'TypeError');assert.equal(a.attribution.snapshot().verificationCommitAttempts,1);
  assert.equal(a.attribution.snapshot().verificationCommits,0);assert.deepEqual(inspect(f.path,snapshot),before);
});
for(const mode of ['DELETE','WAL'])test(`preparation nonempty-cursor SIGKILL ${mode}: resume, fence reset and complete verification (base control)`,async t=>{
  const {f,a}=seeded(t,{mode,count:160});a.step(1);const before=workRow(f.path);assert.ok(before.last_key);a.close();
  const entry=new URL('../testing/context-product-verification-process.mjs',import.meta.url).pathname;
  const child=fork(entry,[f.path,mode,'preparation'],{env:{},execArgv:[],stdio:['ignore','ignore','pipe','ipc']});
  let stderr='';child.stderr.on('data',b=>stderr+=b);const reaped=once(child,'exit');let done=false;
  f.workspace.defer(async()=>{if(!done){child.kill('SIGKILL');await reaped;}});
  const timer=setTimeout(()=>child.kill('SIGKILL'),30000);
  const [message]=await Promise.race([once(child,'message'),reaped.then(value=>assert.fail('preparation barrier '+JSON.stringify(value)+' '+stderr))]);
  clearTimeout(timer);child.kill('SIGKILL');assert.deepEqual(await reaped,[null,'SIGKILL']);done=true;
  assert.equal(message.previous,before.last_key,'child resumes unchanged-binding cursor');
  const crashed=workRow(f.path);assert.equal(crashed.id,before.id);assert.notEqual(crashed.last_key,before.last_key);
  const docs=inspect(f.path,db=>db.prepare('SELECT identity FROM documents WHERE generation=? ORDER BY identity').all(crashed.storage_id));
  assert.equal(docs.length,2,'committed preparation prefix survives lost reply');
  const resumed=local(f.path,{mode,enabled:true});f.workspace.defer(()=>resumed.close());
  resumed.setHook(point=>{if(point==='checkpoint')resumed.setClock(900);});
  const unchanged=resumed.step(1),advanced=workRow(f.path);
  assert.equal(unchanged.reused,0,'unchanged crash bindings resume after the durable cursor');
  assert.equal(advanced.id,crashed.id);assert.equal(advanced.checkpoint,crashed.checkpoint+1);assert.notEqual(advanced.last_key,crashed.last_key);
  assert.equal(resumed.observe().publication,null,'resumed preparation earns no publication or closure credit');
  const db=new DatabaseSync(f.path);try{db.exec('UPDATE namespace_epochs SET epoch=epoch+1');}finally{db.close();}
  const result=resumed.step(1);assert.equal(result.retargets,1);assert.equal(result.reused,3,'reset comparison reuses authenticated artifacts');
  assert.equal(workRow(f.path).id,crashed.id);assert.equal(resumed.observe().publication,null,'preparation cannot publish or earn closure credit');
  const verified=new Set(),prepare=DatabaseSync.prototype.prepare;
  t.mock.method(DatabaseSync.prototype,'prepare',function(sql){const statement=prepare.call(this,sql);
    if(!sql.startsWith('SELECT * FROM documents WHERE generation=?')||!sql.includes('ORDER BY identity LIMIT'))return statement;
    return {all(...args){const rows=statement.all(...args);for(const row of rows)verified.add(row.identity);return rows;},
      get:statement.get.bind(statement),columns:statement.columns.bind(statement)};
  });
  resumed.setHook(()=>{});const rebuilt=await captured(t,f,mode,false),publication=resumed.finish();
  if(implemented)assert.ok(resumed.batchChunks()>1,'resumed preparation is covered by a multi-chunk verification COMMIT');
  const all=inspect(f.path,db=>db.prepare('SELECT identity FROM documents WHERE generation=?').all(crashed.storage_id));
  assert.equal(verified.size,all.length,'full generation verification includes resumed preparation');
  for(const row of all)assert.ok(verified.has(row.identity));
  const expected=rebuilt.a.finish();assert.equal(publication.manifestDigest,expected.manifestDigest);assert.deepEqual(publication.counts,expected.counts);
});
test('oversized logical unit uses the existing valid unbatched path',async t=>{
  const {f,a}=seeded(t,{count:1}),db=new DatabaseSync(f.path);
  try{db.prepare('UPDATE memories SET content=?,revision=revision+1').run('x'.repeat(120000));db.exec('UPDATE namespace_epochs SET epoch=epoch+1');}finally{db.close();}
  const b=await captured(t,f,'DELETE',false),actual=a.finish(),expected=b.a.finish();
  assert.equal(actual.manifestDigest,expected.manifestDigest);assert.deepEqual(actual.counts,expected.counts);
  assert.ok(a.attribution.snapshot().verificationRollbacks>0,'oversized batch attempt falls back without rejecting the item');
});
test('reset-only chunks advance a signed cursor without changing the manifest hash',t=>{
  const state=new SharedArrayBuffer(8);new Int32Array(state)[0]=-1;
  const {f,a}=seeded(t,{count:160,state});a.prepare();a.setHook(point=>{if(point==='verification')a.setClock(900);});
  let found=false;
  for(let i=0;i<20;i++){
    const old=workRow(f.path),before=JSON.parse(old.verify);a.step();const g=workRow(f.path),after=JSON.parse(g.verify);
    if(after.phase===1&&!after.resetDone&&after.resetLast!==undefined){
      assert.equal(a.attribution.snapshot().verificationRows,32,'reset prefix uses the gated bound');assert.deepEqual(after.hash,before.hash);assert.equal(g.checkpoint,old.checkpoint+1);assert.ok(after.resetLast>(before.resetLast??-1));found=true;break;
    }
  }
  assert.ok(found,'bounded reset work is real checkpoint progress');
});
test('fence race preserves an earlier committed batch, discarding all tentative aliases',t=>{
  const {f,a}=seeded(t);a.prepare();let chunks=0,earlier;
  a.setHook(point=>{
    if(point==='verification')earlier=inspect(f.path,snapshot);
    if(point==='verification-chunk'&&++chunks===3){const db=new DatabaseSync(f.path);try{db.exec('UPDATE namespace_epochs SET epoch=epoch+1');}finally{db.close();}}
  });a.step();
  assert.ok(chunks>1,'race reached a batched verification transaction');assert.ok(earlier,'calibration batch committed before race');assert.deepEqual(inspect(f.path,snapshot),earlier);
  assert.equal(JSON.parse(earlier.generation.verify).counts.documents,32);assert.equal(a.attribution.snapshot().verificationRollbacks,1);
});
test('Worker gate and fixed private commit transport; shortage cap survives reopening',async t=>{
  const f=fixture(t);for(let i=0;i<2;i++)f.admit('worker batch orchard '+i);
  const db=new DatabaseSync(f.path);try{db.prepare('UPDATE memories SET content=?,revision=revision+1 WHERE id=(SELECT min(id) FROM memories)').run('x'.repeat(120000));db.exec('UPDATE namespace_epochs SET epoch=epoch+1');}finally{db.close();}
  const service=configured(t,f.path,[ns],{service:true}),open=createProductReaderRuntime({maintenance:true,verificationQualified:()=>true});
  let h=await open(service.options);f.workspace.defer(()=>h.close());let result;
  for(let i=0;i<20;i++){result=await h.refreshContextIndex({readSet:[ns],types:['memory'],intent:'current',mode:'lexical',budget:{maxItems:1024,maxMs:5000}},service.token);assert.equal(result.ok,true);if(result.value.status==='complete')break;}
  assert.equal(result.value.status,'complete');
  assert.ok(maintenancePhaseDiagnostic(result).verificationCommits>0,'Worker carries per-kind private commit counters');
  assert.equal(Object.hasOwn(result.value,'verificationCommits'),false);
  const state=diagnostics.verificationBatchControl(service.supervisor);assert.equal(new Int32Array(state)[0],0,'live calibration stays call-local');assert.ok(new Int32Array(state)[1]>0,'Worker executed gated length preflight');
  new Int32Array(state)[0]=-1;await h.close();h=await open(service.options);
  assert.equal(diagnostics.verificationBatchControl(service.supervisor),state);assert.equal(new Int32Array(state)[0],-1);
});
test('post-BEGIN admission miss rolls back without signing an empty checkpoint',t=>{
  const {f,a}=seeded(t);a.prepare();const old=inspect(f.path,snapshot),exec=DatabaseSync.prototype.exec;
  t.mock.method(DatabaseSync.prototype,'exec',function(sql){const result=exec.call(this,sql);if(sql==='BEGIN IMMEDIATE')a.setClock(900);return result;});
  a.step();assert.deepEqual(inspect(f.path,snapshot),old,'lock acquisition cannot manufacture a successful empty checkpoint');
  assert.equal(a.attribution.snapshot().verificationCommitAttempts,0);assert.equal(a.attribution.snapshot().verificationRollbacks,1);
});
test('passing control: genuine cutoff stays terminal and retains the full reservation',async t=>{
  const {setup}=await import('../testing/context-product-cutoff-fixture.mjs');
  const s=setup(t,{enabled:false}),p=s.create();await s.step();
  assert.equal((await p.completion).error,'read_timeout');assert.equal(p.getStatus().state,'failed');
  assert.equal(p.getStatus().usedItems,1);assert.equal(p.getStatus().usedMs,100);
});
for(const mode of ['DELETE','WAL'])test(`Card and Memory verification equivalence ${mode} (base control)`,async t=>{
  const f=fixture(t,{cards:true});for(let i=0;i<5;i++)f.admit('card memory orchard '+i);card(f,ns,'orchard card','needle card body');
  const types=['memory','card'],a=local(f.path,{mode,enabled:true,types});f.workspace.defer(()=>a.close());const b=await captured(t,f,mode,false,types);
  const actual=a.finish(),expected=b.a.finish();assert.equal(actual.manifestDigest,expected.manifestDigest);assert.deepEqual(actual.counts,expected.counts);
  if(implemented)assert.ok(a.batchChunks()>1,'mixed-type equivalence exercises a multi-chunk COMMIT');
  assert.deepEqual(rows(f.path,actual),rows(b.path,expected));assert.deepEqual(a.lexical(actual,'orchard'),b.a.lexical(expected,'orchard'));
});
test('oversized fallback rechecks ordinary admission and survives resident replacement',t=>{
  const {f,a}=seeded(t,{count:1}),db=new DatabaseSync(f.path);
  try{db.prepare('UPDATE memories SET content=?,revision=revision+1').run('x'.repeat(120000));db.exec('UPDATE namespace_epochs SET epoch=epoch+1');}finally{db.close();}
  a.prepare();a.setHook(point=>{if(point==='verification')a.setClock(900);});a.step();const old=inspect(f.path,snapshot);
  const prepare=DatabaseSync.prototype.prepare;
  t.mock.method(DatabaseSync.prototype,'prepare',function(sql){const statement=prepare.call(this,sql);
    if(!sql.startsWith('SELECT count(*) AS n')||!sql.includes('FROM postings p INDEXED BY product_document_order'))return statement;
    return {get(...args){const hint=statement.get(...args);a.setClock(850);return hint;}};
  });
  a.step();assert.ok(new Int32Array(a.state)[1]&2,'oversized kind remembers its deferred fallback');
  assert.deepEqual(inspect(f.path,snapshot),old,'rejected work cannot spend the reserved tail');
  assert.equal(a.attribution.snapshot().verificationCommitAttempts,0);assert.ok(a.attribution.snapshot().verificationRows>0);
  t.mock.restoreAll();a.reopen();let chunks=0;
  a.setHook(point=>{if(point==='verification-chunk')chunks++;if(point==='verification')a.setClock(900);});a.step();
  assert.equal(chunks,0,'successor selects the existing unbatched path before probing');
  assert.equal(workRow(f.path).checkpoint,old.generation.checkpoint+1,'admitted fallback makes durable progress');
});
test('rollback failure after a cooperative yield is never a successful refresh',t=>{
  const state=new SharedArrayBuffer(8);new Int32Array(state)[0]=1;
  const {f,a}=seeded(t,{state});a.prepare();const old=inspect(f.path,snapshot),exec=DatabaseSync.prototype.exec;let chunks=0;
  a.setHook(point=>{if(point==='verification-chunk'&&++chunks===2)a.setClock(990);});
  t.mock.method(DatabaseSync.prototype,'exec',function(sql){const result=exec.call(this,sql);
    if(sql==='ROLLBACK'&&this.prepare('PRAGMA application_id').get().application_id===0x43525032)throw new TypeError('rollback reply failure');return result;
  });
  assert.throws(()=>a.step(),{name:'TypeError',message:'rollback reply failure'});
  assert.equal(a.attribution.failure()?.errorName,'TypeError');assert.deepEqual(inspect(f.path,snapshot),old);
});
test('passing control: a slow bounded scan commits its admitted first row',t=>{
  const {f,a}=seeded(t);a.prepare();const old=workRow(f.path),prepare=DatabaseSync.prototype.prepare;
  a.setHook(point=>{if(point==='verification')a.setClock(900);});
  t.mock.method(DatabaseSync.prototype,'prepare',function(sql){const statement=prepare.call(this,sql);
    if(!sql.startsWith('SELECT * FROM documents WHERE generation=?')||!sql.endsWith('LIMIT 32'))return statement;
    return {columns:statement.columns.bind(statement),all(...args){const rows=statement.all(...args);a.setClock(110);return rows;}};
  });
  a.step();const current=workRow(f.path);
  const prefix=implemented?1:128;
  assert.equal(current.checkpoint,old.checkpoint+1,'the admitted scan and first row make durable progress');
  assert.equal(JSON.parse(current.verify).counts.documents,prefix);
  a.step();const next=workRow(f.path);
  assert.equal(next.checkpoint,old.checkpoint+2,'the next call advances the same authenticated cursor');
  assert.equal(JSON.parse(next.verify).counts.documents,Math.min(160,2*prefix));
  if(implemented)assert.equal(a.attribution.snapshot().verificationRollbacks,0);
});
