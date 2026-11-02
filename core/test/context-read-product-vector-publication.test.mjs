import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { fixture, ns, ok, receipt } from '../testing/context-read-fixture.mjs';
import { openMemoryCore } from '../index.mjs';
import { openDatabase, transaction, readTransaction } from '../database.mjs';
import { openContextProductFacade } from '../context-read-facade.mjs';
import { productSidecar } from '../context-product-sidecar.mjs';
import { productVectors } from '../context-product-vectors.mjs';
import { digest, accessDigest } from '../context-product-validation.mjs';
import { HOSTED_ID } from '../context-semantic-input.mjs';
import { maintenanceQuantum } from '../context-product-quantum.mjs';
import { writeContentSuppressionInside, memorySuppressionObservationInside } from '../content-suppression-storage.mjs';

const identity={provider:'openai',model:'text-embedding-3-small',id:HOSTED_ID,revision:'provider-unversioned',dimensions:1536,normalization:'l2'};
const snapshot=(epoch=0,selected=identity)=>({identity:selected,policy:{purgeEpoch:epoch}});
const coverage={policy:'recent-projects-v1',selectionRevision:'synthetic',requestedNamespaces:1,selectedNamespaces:1,omittedNamespaces:0};
const budget={maxItems:1024,maxMs:5000};
const quantum=()=>maintenanceQuantum({now:()=>performance.now(),cutoff:performance.now()+5000,maxMs:5000});
const vector=axis=>{const v=new Float32Array(1536);v[axis]=1;return v;};
function setup(t,{safety=false,corpus=['semantic specimen']}={}) {
  const f=fixture(t,{coreOptions:safety?{contentSafety:'s2h-v1'}:{}}),memories=corpus.map(text=>f.admit(text));f.core.close();
  const facade=openContextProductFacade(f.path,{});f.workspace.defer(()=>facade.close());
  const storage=productSidecar({path:f.path,db:facade.port.db,identity:facade.port.identity,features:facade.port.features,writable:true});f.workspace.defer(()=>storage.close());
  const p={readSet:[ns],types:['memory'],intent:'current',ownerCoverage:coverage,deadlineAt:performance.now()+60000};
  const access=accessDigest({ownerId:ns.ownerId,namespaces:{readSet:[ns]}}),vectors=productVectors({storage,facade});
  const lexical=()=>{storage.refresh(p,access,budget);const o=storage.observe(p,access);assert.equal(o.dto.lexical.state,'ready');return o.publication;};
  const sql=work=>storage.vectors(work,true);
  const pointer=()=>sql(db=>JSON.parse(db.prepare('SELECT pointer FROM vector_publications WHERE projection=?').get(current.projectionDigest).pointer));
  const inventory=()=>sql(db=>Object.fromEntries(['vector_generations','vector_validation_records','vector_publications','vector_work'].map(table=>[table,db.prepare(`SELECT * FROM ${table} ORDER BY 1`).all()])));
  let current=lexical();
  function refresh(selected=snapshot(),axis=1,engine=vectors,publication=current) {
    const rows=engine.plan(p,publication,selected,64,quantum());
    if(rows.length)engine.put(p,publication,selected,rows,rows.map(()=>vector(axis)));
    engine.plan(p,publication,selected,64,quantum());assert.equal(engine.certify(p,publication,selected,quantum()),true);
    return pointer();
  }
  function add(text='another specimen') {
    const writer=openMemoryCore({path:f.path});
    try{ok(writer.admit({namespace:ns,memory:{content:text,kind:'fact'},receipts:[receipt(text)]}));}finally{writer.close();}
    current=lexical();return current;
  }
  const observe=(selected=snapshot())=>vectors.observe(p,current,selected,{load:true});
  return {f,memories,storage,facade,p,vectors,sql,pointer,inventory,refresh,add,rebuild:()=>current=lexical(),observe,get lexical(){return current;}};
}
function changedFence(before,after,field) {
  assert.notEqual(after.publicationId,before.publicationId);
  assert.notDeepEqual(after.generation,before.generation);
  assert.notEqual(after[field],before[field],`${field} must invalidate reuse`);
}
function unchangedRefresh(s,selected=snapshot()) {
  const before=s.inventory(),pointer=s.pointer();
  for(let n=0;n<3;n++)assert.deepEqual(s.refresh(selected),pointer);
  assert.deepEqual(s.inventory(),before,'no generation, validation record, pointer or checkpoint writes');
}

test('repeated no-op plans and certification preserve every publication row and checkpoint',t=>{
  const s=setup(t);s.refresh();unchangedRefresh(s);
  assert.equal(s.inventory().vector_generations.length,1);assert.equal(s.inventory().vector_validation_records.length,1);assert.equal(s.inventory().vector_work.length,0);
});

for(const mutation of ['forget','correction'])test(`${mutation} changes ld and never ranks stale vectors after publication reuse`,t=>{
  const s=setup(t,{corpus:['semantic specimen','safe specimen']}),old=s.memories[0],before=s.refresh(snapshot(),0),ld=digest(s.lexical);
  const writer=openMemoryCore({path:s.f.path});
  try {
    const target={namespace:ns,memoryId:old.id,expectedRevision:old.revision};
    if(mutation==='forget')ok(writer.forget(target));
    else ok(writer.correct({...target,content:'replacement specimen',kind:'fact',receipt:receipt('replacement','replacement specimen')}));
  } finally {writer.close();}
  s.rebuild();assert.notEqual(digest(s.lexical),ld);
  const after=s.refresh(snapshot(),1);changedFence(before,after,'lexicalPublicationId');
  const check=()=>{
    const observed=s.observe();assert.equal(observed.status,'complete');assert.equal(observed.record.publicationId,after.publicationId);
    const ranked=s.vectors.rank(observed,vector(1)),target=ranked.find(row=>row.ref.memoryId===old.id);
    if(mutation==='forget')assert.equal(target,undefined);
    else {assert.ok(target);assert.equal(target.ref.revision,old.revision+1);assert.equal(target.score,1,'the corrected vector must replace the old orthogonal vector');}
  };
  check();unchangedRefresh(s);check();
});

for(const change of ['purgeEpoch','embedder'])test(`${change} changes the existing fence and publishes only current vectors`,t=>{
  const s=setup(t),old=change==='embedder'?snapshot(0,{...identity,revision:'previous-provider-revision'}):snapshot();
  const before=s.refresh(old,0),selected=change==='purgeEpoch'?snapshot(1):snapshot();
  const after=s.refresh(selected,1);changedFence(before,after,change==='purgeEpoch'?'purgeEpoch':'identityDigest');
  const observed=s.observe(selected);assert.equal(observed.status,'complete');assert.equal(observed.record.publicationId,after.publicationId);
  assert.ok(observed.rows.every(row=>row.vector[0]===0&&row.vector[1]===1));
  assert.equal(s.vectors.observe(s.p,s.lexical,old).reason,'identity_changed');
  unchangedRefresh(s,selected);
});

test('a new lexical publication changes ld even when existing document vectors remain reusable',t=>{
  const s=setup(t),oldLexical=s.lexical,before=s.refresh();s.add();
  assert.notEqual(digest(s.lexical),digest(oldLexical));
  const after=s.refresh();changedFence(before,after,'lexicalPublicationId');
  const observed=s.observe();assert.equal(observed.status,'complete');assert.equal(observed.rows.length,2);
  assert.equal(observed.record.lexical.validationDigest,digest(s.lexical));unchangedRefresh(s);
});

test('representation changes flow through ld and produce a fresh vector publication',t=>{
  const s=setup(t),oldLexical={...s.lexical,representation:'previous-candidate-text'};
  // Install a former producer's representation through the internal seam.
  // Its canonical/lexical fence is otherwise the real published generation.
  const former=productVectors({storage:{...s.storage,vectorFence:(p,l)=>s.storage.vectorFence(p,{...l,representation:s.lexical.representation})},facade:s.facade});
  const before=s.refresh(snapshot(),0,former,oldLexical);
  // A representation rollout rebuilds the lexical generation as well, so its
  // physical cache is audited under the new representation, as in production.
  s.add();assert.notEqual(digest(oldLexical),digest({...oldLexical,representation:s.lexical.representation}));
  const after=s.refresh();changedFence(before,after,'lexicalPublicationId');
  const observed=s.observe();assert.equal(observed.status,'complete');assert.equal(observed.record.representation,s.lexical.representation);
  assert.equal(observed.record.lexical.validationDigest,digest(s.lexical));assert.ok(observed.rows.every(row=>row.vector[0]===0&&row.vector[1]===1));unchangedRefresh(s);
});

test('unpublished planning resumes in place and a published partial generation is replaced',t=>{
  const s=setup(t,{corpus:['first specimen','second specimen']}),selected=snapshot();
  const paused={admit:()=>false,measure:work=>work()};
  assert.deepEqual(s.vectors.plan(s.p,s.lexical,selected,1,paused),[]);
  const planned=s.inventory().vector_generations[0];assert.equal(planned.published,0);assert.equal(JSON.parse(planned.state).body.planning.complete,false);
  const rows=s.vectors.plan(s.p,s.lexical,selected,1,quantum());assert.equal(rows.length,1);
  s.vectors.put(s.p,s.lexical,selected,rows,[vector(1)]);
  assert.equal(s.inventory().vector_generations[0].id,planned.id);
  assert.equal(s.vectors.certify(s.p,s.lexical,selected,quantum()),true);
  const partial=s.observe();assert.equal(partial.status,'partial');assert.equal(partial.record.counts.byType.memory.embedded,1);assert.equal(partial.record.generation.id,planned.id);
  const complete=s.refresh();assert.notEqual(complete.publicationId,partial.record.publicationId);assert.notEqual(complete.generation.id,planned.id);
  assert.equal(s.observe().status,'complete');assert.equal(s.observe().rows.length,2);unchangedRefresh(s);
});

// Suppression is enforced by the safety layer's read-time epoch fence and
// does not depend on publication rotation. This base predates that product
// integration: compare the same vector-observation outcome with its base bytes.
const baseSuppressionOutcome='{"suppressed":true,"lexicalState":"ready","semanticStatus":"complete","reason":null,"rows":[{"target":true,"revision":1,"score":1}]}';
test('suppression outcome remains byte-for-byte identical to base across refresh',t=>{
  const s=setup(t,{safety:true});s.refresh();const old=s.lexical,db=openDatabase(s.f.path);let suppressed;
  try {
    transaction(db,()=>writeContentSuppressionInside(db,{namespace:ns,kind:'memory',key:s.memories[0].id,reason:'purge',actionId:'suppress-specimen'}));
    suppressed=readTransaction(db,()=>memorySuppressionObservationInside(db,ns,{memoryId:s.memories[0].id,revision:1})).suppressed;
  } finally {db.close();}
  const outcome=()=>{const observed=s.observe();return JSON.stringify({suppressed,lexicalState:'ready',semanticStatus:observed.status,reason:observed.reason,rows:s.vectors.rank(observed,vector(1)).map(row=>({target:row.ref.memoryId===s.memories[0].id,revision:row.ref.revision,score:row.score}))});};
  assert.equal(outcome(),baseSuppressionOutcome);s.storage.refresh(s.p,old.accessDigest,budget);s.refresh();assert.equal(outcome(),baseSuppressionOutcome);
  assert.equal(digest(s.lexical),digest(old));
});
test('suppression leaves the three-field no-op publication reusable',t=>{
  const s=setup(t,{safety:true});s.refresh();const db=openDatabase(s.f.path);
  try{transaction(db,()=>writeContentSuppressionInside(db,{namespace:ns,kind:'memory',key:s.memories[0].id,reason:'purge',actionId:'suppress-specimen'}));}finally{db.close();}
  unchangedRefresh(s);
});
