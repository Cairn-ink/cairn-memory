import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { fixture } from '../testing/context-read-fixture.mjs';
import { four, descriptor } from '../testing/context-product-owner-fixture.mjs';
import { openContextProductFacade } from '../context-read-facade.mjs';
import { productSidecar, PRODUCT_SIDECAR_SUFFIX } from '../context-product-sidecar.mjs';
import { productVectors } from '../context-product-vectors.mjs';
import { accessDigest } from '../context-product-validation.mjs';
import { maintenanceQuantum } from '../context-product-quantum.mjs';
import { HOSTED_ID, MODEL } from '../context-semantic-input.mjs';

const budget={maxItems:1024,maxMs:5000};
const identity={provider:'openai',model:MODEL,id:HOSTED_ID,revision:'provider-unversioned',dimensions:1536,normalization:'l2'};
const snapshot={identity,policy:{semantic:true,purgeEpoch:0}};
function setup(t,count=3) {
  const f=fixture(t);for(let i=0;i<count;i++)f.admit('orchard semantic '+i,four[i%4]);
  const facade=openContextProductFacade(f.path,{});
  const storage=productSidecar({path:f.path,db:facade.port.db,identity:facade.port.identity,features:facade.port.features,writable:true});
  const p={readSet:four,types:['memory'],intent:'current',ownerCoverage:descriptor(four),deadlineAt:Infinity};
  const access=accessDigest({ownerId:four[0].ownerId,namespaces:{readSet:four}});
  const build=(selection=p)=>{for(let i=0;i<100;i++){storage.refresh(selection,access,budget);const r=storage.observe(selection,access);if(r.dto.lexical.state==='ready')return r.publication;}assert.fail('lexical build');};
  const lexical=build(),db=new DatabaseSync(f.path+PRODUCT_SIDECAR_SUFFIX);
  t.after(()=>{db.close();storage.close();facade.close();});
  const vectors=productVectors({storage,facade});
  const quantum=()=>maintenanceQuantum({now:()=>0,cutoff:5000,maxMs:5000});
  const put=(publication=lexical,selection=p)=>{for(let i=0;i<100;i++){const rows=vectors.plan(selection,publication,snapshot,64);if(!rows.length)return;vectors.put(selection,publication,snapshot,rows,rows.map(()=>{const v=Array(1536).fill(0);v[0]=1;return v;}));}assert.fail('vector planning must finish');};
  return {f,facade,storage,p,access,build,lexical,db,vectors,put,quantum};
}
for(const format of [1,2])test(`format 3 refuses deployed format ${format} without semantic configuration`,t=>{
  const a=setup(t);a.storage.close();a.db.exec(`PRAGMA user_version=${format}`);
  if(format===2)for(const table of ['semantic_vectors','vector_rows','vector_generations','vector_work','vector_publications','vector_validation_records','vector_purge_checkpoints'])a.db.exec(`DROP TABLE ${table}`);
  const storage=productSidecar({path:a.f.path,db:a.facade.port.db,identity:a.facade.port.identity,features:a.facade.port.features,writable:true});t.after(()=>storage.close());
  assert.equal(storage.observe(a.p,a.access).dto.lexical.reason,'incompatible');
  assert.throws(()=>storage.refresh(a.p,a.access,budget),{code:'index_unavailable',reason:'incompatible'});
  assert.equal(a.db.prepare('PRAGMA user_version').get().user_version,format);
});

test('format 3 certifies integer-key vectors, preserves lexical manifest and ranks fake embeddings',t=>{
  const a=setup(t);a.put();assert.equal(a.vectors.certify(a.p,a.lexical,snapshot,a.quantum()),true);
  const result=a.vectors.observe(a.p,a.lexical,snapshot,{load:true});assert.equal(result.status,'complete');
  assert.equal(result.record.format,3);assert.equal(a.lexical.format,3);
  assert.equal(a.storage.observe(a.p,a.access).publication.manifestDigest,a.lexical.manifestDigest);
  assert.equal(a.vectors.rank(result,Array.from({length:1536},(_,i)=>i===0?1:0)).length,3);
  assert.equal(a.db.prepare('SELECT count(*) n FROM vector_rows WHERE typeof(generation)!=\'integer\' OR doc<=0').get().n,0);
  assert.throws(()=>a.db.exec('UPDATE vector_rows SET doc=0'),/CHECK/);
  assert.throws(()=>a.db.exec('UPDATE semantic_vectors SET doc=-1'),/CHECK/);
});

// One transaction per deterministic quantum exposes the production checkpoint
// between construction and verification, without a timing gate or fake state.
function staged(a) {
  let clock=0;
  const storage={...a.storage,vectors(work,mutation){const result=a.storage.vectors(work,mutation);if(mutation)clock=900;return result;}};
  const vectors=productVectors({storage,facade:a.facade});
  const step=()=>{clock=0;return vectors.certify(a.p,a.lexical,snapshot,maintenanceQuantum({now:()=>clock,cutoff:1000,maxMs:1000}));};
  a.put();assert.equal(step(),false);
  assert.equal(JSON.parse(a.db.prepare('SELECT state FROM vector_generations').get().state).body.phase,1);
  return {vectors,step};
}
for(const doc of [-1,0,999999])test(`format 3 deep vector verification rejects ${doc<=0?'nonpositive':'orphan'} document key ${doc}`,t=>{
  const a=setup(t),s=staged(a);
  a.db.exec('PRAGMA ignore_check_constraints=ON');
  a.db.prepare('UPDATE vector_rows SET doc=? WHERE doc=(SELECT min(doc) FROM vector_rows)').run(doc);
  assert.throws(()=>s.step(),{code:'index_unavailable'});
  assert.equal(a.db.prepare('SELECT count(*) n FROM vector_validation_records').get().n,0);
  assert.equal(a.db.prepare('SELECT count(*) n FROM vector_publications').get().n,0);
});
for(const doc of [-1,0,999999])test(`format 3 deep cache audit rejects physical document key ${doc}`,t=>{
  const a=setup(t),s=staged(a);a.db.exec('PRAGMA ignore_check_constraints=ON');
  a.db.prepare('UPDATE semantic_vectors SET doc=? WHERE doc=(SELECT min(doc) FROM semantic_vectors)').run(doc);
  assert.equal(s.step(),false);assert.throws(()=>s.step(),{code:'index_unavailable'});
  assert.equal(a.db.prepare('SELECT count(*) n FROM vector_validation_records').get().n,0);
});

test('format 3 vector verification commits every admitted row before advancing a partial cursor',t=>{
  const a=setup(t,130);a.put();let clock=600,checked=0;
  const q=()=>{
    const quantum=maintenanceQuantum({now:()=>clock,cutoff:1000,maxMs:1000});
    return {...quantum,measure(work,kind){return quantum.measure(()=>{const r=work();if(kind==='vector-scan')clock+=100;if(kind==='vector-verification'){clock+=70;checked++;}return r;},kind);}};
  };
  let done=false,prior=0;
  for(let i=0;i<1000&&!done;i++) {
    clock=600;done=a.vectors.certify(a.p,a.lexical,snapshot,q());
    assert.ok(clock<1000,'admitted rows and signed checkpoint fit original cutoff');
    const state=JSON.parse(a.db.prepare('SELECT state FROM vector_generations ORDER BY storage_id DESC LIMIT 1').get().state).body;
    const completed=Object.values(state.seen).reduce((n,c)=>n+c,0)+(state.verified??0);
    assert.ok(completed>=prior);prior=completed;
  }
  assert.equal(done,true);assert.ok(checked>=390);
  assert.equal(a.vectors.observe(a.p,a.lexical,snapshot,{load:true}).rows.length,130);
});

test('format 3 GC deletes retired and superseded integer-key vectors after documents, preserving other intents',t=>{
  const a=setup(t);a.put();a.vectors.certify(a.p,a.lexical,snapshot,a.quantum());
  const oldVector=a.db.prepare('SELECT storage_id FROM vector_generations').get().storage_id;
  // A second certificate supersedes only the vector publication.
  a.vectors.certify(a.p,a.lexical,snapshot,a.quantum());
  a.storage.refresh(a.p,a.access,budget);
  assert.equal(a.db.prepare('SELECT count(*) n FROM vector_rows WHERE generation=?').get(oldVector).n,0);
  const history=a.build({...a.p,intent:'history'});a.put(history,{...a.p,intent:'history'});a.vectors.certify({...a.p,intent:'history'},history,snapshot,a.quantum());
  const keep=a.db.prepare('SELECT storage_id FROM vector_generations WHERE lexical_generation=(SELECT storage_id FROM generations WHERE id=?)').get(history.generation.id).storage_id;
  const retired=a.db.prepare('SELECT storage_id FROM generations WHERE id=?').get(a.lexical.generation.id).storage_id;
  const selected={...a.p,readSet:[four[0]],ownerCoverage:descriptor([four[0]])};a.build(selected);
  for(let i=0;i<10;i++)a.storage.refresh(selected,a.access,budget);
  assert.equal(a.db.prepare('SELECT count(*) n FROM semantic_vectors WHERE owner=? AND generation=?').get(four[0].ownerId,retired).n,0);
  assert.equal(a.db.prepare('SELECT count(*) n FROM vector_generations WHERE lexical_generation=?').get(retired).n,0);
  assert.ok(a.db.prepare('SELECT count(*) n FROM vector_rows WHERE generation=?').get(keep).n>0);
  assert.equal(a.db.prepare('SELECT count(*) n FROM vector_validation_records c LEFT JOIN vector_generations g ON g.storage_id=c.generation WHERE g.storage_id IS NULL').get().n,0);
});

test('format 3 embedding quanta include open, reserve settlement, and commit received vectors before yielding',async t=>{
  const {openProductIndex}=await import('../context-product-index.mjs');
  const f=fixture(t);for(let i=0;i<5;i++)f.admit('semantic orchard '+i,four[0]);
  const facade=openContextProductFacade(f.path,{}),readSet=[four[0]],ownerCoverage=descriptor(readSet);
  let clock=0,slow=false,sends=0,cutoffSeen,operationCutoff;
  const access=accessDigest({ownerId:four[0].ownerId,namespaces:{readSet}});
  const semantic={configuration:{selection:{maxBatchDocuments:1}},snapshot:async()=>snapshot,gate:{enter:()=>()=>{}},async call(method,input,cutoff){
    if(method==='embed') {
      sends++;cutoffSeen=cutoff;clock+=70;
      const vector=Array(1536).fill(0);vector[0]=1;
      assert.equal(input.maxUsd,'0.5');
      return {vectors:[vector],chargedUsd:'0.1'};
    }
  }};
  // Instrument actual opening and page work. No native policy is replaced.
  const observer={invoke(stage,_kind,work){const result=work();if(slow&&stage==='open')clock+=200;return result;},database(db){return new Proxy(db,{get(target,key){
    if(key==='prepare')return sql=>{const stmt=target.prepare(sql);return new Proxy(stmt,{get(s,m){const value=Reflect.get(s,m,s);return typeof value==='function'?(...args)=>{const result=Reflect.apply(value,s,args);if(slow&&m==='all'&&/SELECT \* FROM documents WHERE generation=\? AND stream=\?/.test(sql))clock+=100;return result;}:value;}});};
    const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
  }});}};
  const options={path:f.path,facade,ownerCoverage,maintenance:true,semantic,now:()=>clock,observer,
    operation:()=>({operationCutoffMonoNs:String(operationCutoff=process.hrtime.bigint()+1000000000n)}),
    authorize:()=>({accessGenerations:access,check(){},envelope:fn=>fn()})};
  let index=openProductIndex(options);t.after(()=>{index.close();facade.close();});
  const base={readSet,types:['memory'],intent:'current'};
  assert.equal(index.run('refreshContextIndex',{...base,mode:'lexical',budget},{}).ok,true);
  index.close();slow=true;
  const db=new DatabaseSync(f.path+PRODUCT_SIDECAR_SUFFIX,{readOnly:true});t.after(()=>db.close());
  for(let i=0;i<5;i++) {
    clock=0;index=openProductIndex(options);
    const before=sends;
    const result=await index.run('refreshContextIndex',{...base,mode:'embeddings',budget:{maxItems:1024,maxMs:1000,maxUsd:'0.50'}},{},1000);
    assert.equal(result.ok,true,JSON.stringify(result));assert.equal(result.value.status,'partial');
    assert.equal(sends,before+1);assert.equal(result.value.progress.embedded,1);
    assert.ok(cutoffSeen<=operationCutoff-150000000n,'provider cutoff leaves the shared 150ms reserve');
    assert.ok(clock<1000);assert.equal(db.prepare('SELECT count(*) n FROM semantic_vectors').get().n,i+1);
    index.close();
  }
  // A later ordinary quantum certifies all received vectors without sending.
  slow=false;clock=0;index=openProductIndex(options);
  const before=sends,result=await index.run('refreshContextIndex',{...base,mode:'embeddings',budget:{maxItems:1024,maxMs:5000,maxUsd:'0.50'}},{},5000);
  assert.equal(result.ok,true,JSON.stringify(result));assert.equal(result.value.status,'complete');assert.equal(sends,before);
});


test('format 3 lexical-only opening attests exact vector index SQL',t=>{
  const a=setup(t);a.storage.close();
  a.db.exec('DROP INDEX semantic_vector_owner; CREATE INDEX semantic_vector_owner ON semantic_vectors(owner,item)');
  const storage=productSidecar({path:a.f.path,db:a.facade.port.db,identity:a.facade.port.identity,features:a.facade.port.features});t.after(()=>storage.close());
  assert.equal(storage.observe(a.p,a.access).dto.lexical.reason,'incompatible');
});


test('format 3 deep vector verification rejects removed payloads before issuing complete coverage',t=>{
  const a=setup(t),s=staged(a);
  a.db.exec('UPDATE vector_rows SET vector=NULL WHERE doc=(SELECT min(doc) FROM vector_rows)');
  assert.throws(()=>s.step(),{code:'index_unavailable'});
  assert.equal(a.db.prepare('SELECT count(*) n FROM vector_validation_records').get().n,0);
});


test('format 3 cross-intent cache reuse rejects an orphan storage generation',t=>{
  const a=setup(t);a.put();
  const p={...a.p,intent:'history'},history=a.build(p);
  a.db.prepare('DELETE FROM generations WHERE id=?').run(a.lexical.generation.id);
  assert.throws(()=>a.vectors.certify(p,history,snapshot,a.quantum()),{code:'index_unavailable'});
  assert.equal(a.db.prepare('SELECT count(*) n FROM vector_publications').get().n,0);
});
