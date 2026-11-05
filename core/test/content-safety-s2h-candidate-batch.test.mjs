import { costFamilyFixture, costFamilyPhysical, costGateFamilies } from '../testing/content-safety-cost-families.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as sidecar from '../context-product-sidecar.mjs';
import { memoryReadEligible } from '../content-safety.mjs';
import { expectedCandidateDecision } from '../testing/content-safety-s2h-candidate-oracle.mjs';
import { candidateAllowedReference } from '../testing/content-safety-s2h-candidate-equivalence.mjs';
import { readFileSync } from 'node:fs';
import { isBuiltin } from 'node:module';
import { spawnSync } from 'node:child_process';
import { safetyFixture, ns, ok, receipt } from '../testing/content-safety-s2h-fixture.mjs';
import { openMemoryCore } from '../index.mjs';
import { openRawCaptureCore } from '../raw-capture.mjs';
import { request, splitRaw, localPlainPort } from '../testing/raw-capture-fixtures.mjs';
import { readTransaction, transaction } from '../database.mjs';
import { withContentSuppressionRequest, withContentSuppressionReadInside, writeContentSuppressionInside } from '../content-suppression-storage.mjs';

const seeds=[17,41];
const ancestries=['none','in-scope','foreign-owner','foreign-namespace','mixed'];
const states=['live','forgotten','conversation','overlap','disjoint','whole-message'];
const memoryFacts=['zero','forgotten','receipt','correction','owner','namespace','disjoint','version'];
const precisions=['exact','whole-message'];
// Isolate eligibility without a suppression or Raw-origin refusal masking it.
const eligibilities=['current','superseded','awaiting','deleted'];
// Fixture order, subset order and duplicate positions are deterministic. UUIDs
// are supplied by public writers; no generated decision is sampled or skipped.
function random(seed){return ()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/2**32;};}
for(const family of costGateFamilies())for(const base of [18,23,33])test(`Memory independent safety gate and old-path equivalence control ${family} v${base}`,async t=>{
 const f=costFamilyFixture(t,base,family);await f.migrate();
 const db=f.connect();assert.equal(db.prepare('PRAGMA user_version').get().user_version,costFamilyPhysical(base,family),'actual differential physical layout');const core=openMemoryCore({path:f.path});
 const raw=base===33?openRawCaptureCore({path:f.path,model:{contextWindow:8192,countTokens:()=>1,extract:()=>({items:[{content:'Synthetic captured interpretation',kind:'fact',confidence:.8,sourceIndices:[0]}]})}},
  {mode:'raw-v1',deletion:true,port:localPlainPort(),readPolicy:()=>({generation:'synthetic',reason:null})}):null;
 t.after(()=>{raw?.close();core.close();db.close();});
 let fixtures=0,cases=0,candidates=0,allowedCount=0,deniedCount=0,actualAllowedCount=0;
 const mismatches=[],equivalenceMismatches=[];
 let measuring=false,statementCount=0,sqlReported=false;const prepare=db.prepare;
 db.prepare=function(sql){if(measuring){statementCount++;if(!sqlReported&&sql.startsWith('WITH candidates')){t.diagnostic('BATCH_SQL '+JSON.stringify({base,sql}));sqlReported=true;}}return prepare.call(this,sql);};
 const exec=db.exec;db.exec=function(sql){assert.equal(measuring,false,'batch never executes transaction control');return exec.call(this,sql);};
 const ancestryValues=base===33?ancestries:['none'],stateValues=base===33?states:['live'],precisionValues=base===33?precisions:['exact'];
 for(const seed of seeds){const rng=random(seed);
  for(const ancestry of ancestryValues)for(const state of stateValues)for(const precision of precisionValues)for(const fact of memoryFacts)for(const eligibility of fact==='zero'&&ancestry==='none'&&state==='live'&&precision==='exact'?eligibilities:['current']){
   const serial=fixtures++,a={...ns,ownerId:'synthetic-batch-'+base+'-'+serial,projectId:'selected'},b={...a,projectId:'second'},foreign={...a,ownerId:a.ownerId+'-foreign',projectId:'foreign'};
   const admit=(namespace,label)=>ok(core.admit({namespace,memory:{content:'Synthetic '+label+' '+serial,kind:'fact'},receipts:[receipt('batch-'+serial+'-'+label)]})).memory;
   const m=admit(a,'subject'),neighbor=admit(a,'neighbor'),second=admit(b,'second'),other=admit(foreign,'foreign');
   const originalReceiptId=db.prepare('SELECT id FROM receipts WHERE memory_id=?').get(m.id).id;
   const ref=(memory,namespace)=>({type:'memory',namespace,memoryId:memory.id,revision:memory.revision});
   // Perform public Memory mutations before injecting unsafe ancestry.
   if(fact==='forgotten')ok(core.forget({namespace:a,memoryId:m.id,expectedRevision:m.revision}));
   else if(fact==='correction')ok(core.correct({namespace:a,memoryId:m.id,expectedRevision:m.revision,content:'Synthetic corrected '+serial,kind:'fact',receipt:receipt('correct-'+serial)}));
   // Eligibility is independent of suppression. Supersession uses the public
   // writer and binds its latest revision, so stale-ref refusal cannot mask it.
   if(eligibility==='superseded'){
    ok(core.supersede({namespace:a,memoryId:m.id,expectedRevision:m.revision,replacement:{content:'Synthetic successor '+serial,kind:'fact'},receipts:[receipt('successor-'+serial)]}));
    const row=db.prepare('SELECT revision,currentness FROM memories WHERE id=?').get(m.id);
    assert.equal(row.currentness,'historical');m.revision=row.revision;
   }else if(eligibility==='awaiting'){
    // Isolate the review-state rule without adding a suppression fact.
    db.prepare("UPDATE memories SET review_state='awaiting' WHERE id=?").run(m.id);
   }else if(eligibility==='deleted'){
    // Isolate deletion from public forget's additional suppression/revision rules.
    db.prepare('UPDATE memories SET deleted=1,content=NULL WHERE id=?').run(m.id);
   }
   if(fact==='zero'){
   const canonical=db.prepare('SELECT revision,deleted,currentness,review_state FROM memories WHERE id=?').get(m.id);
   assert.equal(canonical.revision,m.revision,'eligibility fixture binds latest canonical revision');
   assert.equal(Boolean(canonical.deleted),eligibility==='deleted');
   assert.equal(canonical.review_state==='awaiting',eligibility==='awaiting');
   }
   let captured;
   if(ancestry!=='none'){
    const sourceNS=ancestry==='foreign-owner'?foreign:ancestry==='foreign-namespace'?b:a;
    const part=splitRaw('Synthetic captured source for batch '+serial)[0];
    captured=ok(await raw.captureRaw(request(part,{namespace:sourceNS,sessionId:'batch-'+serial,eventId:'batch-'+serial})));
    // Public capture supplies authentic roots/receipts. Transplanting a stored
    // lineage edge is intentional fault injection: public writers forbid the
    // foreign/mixed ancestry which canonical S1 must nevertheless refuse.
    const source=db.prepare('SELECT * FROM raw_receipt_lineage WHERE conversation_id=? LIMIT 1').get(captured.raw.conversationId);
    assert.ok(source,'public Raw capture creates lineage');
    // Delete authentic sources before installing impossible ancestry. A
    // deleted source has no live header: the deliberately dangling edge tests
    // S1's missing-origin refusal. Only this fixture connection disables FKs,
    // synchronously and temporarily; public writers keep their own FK checks.
    if(state==='forgotten'){
     const revision=db.prepare('SELECT revision FROM raw_conversations WHERE id=?').get(source.conversation_id).revision;
     ok(raw.deleteConversation({namespace:sourceNS,conversationId:source.conversation_id,expectedRevision:revision,actionId:'delete-'+serial}));
     db.exec('PRAGMA foreign_keys=OFF');
    }
    try{transaction(db,()=>{
     const rid=db.prepare('SELECT id FROM receipts WHERE memory_id=?').get(m.id)?.id;
     if(rid)db.prepare('INSERT INTO raw_receipt_lineage VALUES(?,?,?,?,?,?)').run(rid,source.conversation_id,source.message_id,source.start,source.end,precision);
     if(rid&&ancestry==='mixed'){
      const foreignRoot='synthetic-mixed-'+serial;
      db.prepare('INSERT INTO raw_conversations VALUES(?,?,?,?,?,?,1,?,?)').run(foreignRoot,foreign.ownerId,foreign.scope,foreign.projectId,'codex','mixed-'+serial,'time','time');
      db.prepare('INSERT INTO raw_receipt_lineage VALUES(?,?,?,?,?,?)').run(rid,foreignRoot,source.message_id,0,1,precision);
     }
     if(['conversation','overlap','disjoint','whole-message'].includes(state))writeContentSuppressionInside(db,{namespace:sourceNS,kind:'raw',key:source.conversation_id,
      ...(state==='conversation'?{}:{matchMode:'span',messageId:source.message_id,start:state==='disjoint'?source.end+1:0,end:state==='disjoint'?source.end+2:state==='whole-message'?10000:1}),reason:'privacy_erase',actionId:'raw-'+serial});
    });}finally{if(state==='forgotten')db.exec('PRAGMA foreign_keys=ON');}
   }
   if(!['zero','forgotten','correction'].includes(fact))transaction(db,()=>writeContentSuppressionInside(db,{namespace:fact==='owner'?{ownerId:a.ownerId,scope:'owner',projectId:''}:a,
    kind:fact==='receipt'?'receipt':fact==='owner'?'owner':fact==='namespace'?'namespace':'memory',key:['owner','namespace'].includes(fact)?'':fact==='receipt'?originalReceiptId:fact==='disjoint'?'unrelated-'+serial:m.id,
    ...(fact==='owner'?{matchMode:'owner'}:fact==='namespace'?{matchMode:'namespace'}:fact==='version'?{matchMode:'version',sourceVersion:JSON.stringify(['memory-revision-v1',m.revision])}:{}),reason:'purge',actionId:'memory-'+serial}));
   const refs=[ref(m,a),ref(neighbor,a),ref(second,b),ref(other,foreign),{...ref(m,a),revision:99},{...ref(m,a),memoryId:'missing-'+serial}];
   // Include pre-correction and current revision; include duplicates across
   // terms in nontrivial orders, then validate the entire retained order.
   if(fact==='correction')refs.push({...ref(m,a),revision:db.prepare('SELECT revision FROM memories WHERE id=?').get(m.id).revision});
   const variants=new Map(refs.map((r,i)=>[r,['target','neighbour','second','foreign','wrong-revision','missing','correction'][i]]));
   const shuffled=[...refs];for(let i=shuffled.length-1;i>0;i--){const j=Math.floor(rng()*(i+1));[shuffled[i],shuffled[j]]=[shuffled[j],shuffled[i]];}
   shuffled.push(shuffled[0],shuffled[1]);
   for(const readSet of [[a],[a,b],[a,b,foreign]])for(const intent of ['current','history']){
    const p={readSet,intent},identity={};
    withContentSuppressionRequest(()=>readTransaction(db,()=>withContentSuppressionReadInside(db,readSet,()=>{
     const expected=shuffled.map(r=>expectedCandidateDecision({ancestry,state,precision,fact,eligibility,variant:variants.get(r),intent}));
     // Old-path equivalence is a distinct control, never the safety expectation.
     const oldPath=shuffled.map(r=>candidateAllowedReference(db,identity,r,p));
     for(const indices of [[],[0],shuffled.map((_,i)=>i),expected.flatMap((yes,i)=>yes?[i]:[]),expected.flatMap((yes,i)=>yes?[]:[i]),Array.from({length:24},(_,i)=>i%shuffled.length)]){
      const input=indices.map(i=>shuffled[i]),reference=indices.map(i=>expected[i]);
      statementCount=0;measuring=true;
      const actual=sidecar.memoryCandidatesAllowedInside(db,input,p,identity);
      measuring=false;
      assert.equal(statementCount,input.length?1:0,'one statement for every nonempty batch, including 24 candidates');
      const label=JSON.stringify({base,seed,ancestry,state,precision,fact,eligibility,readSet:readSet.length,intent,case:cases});
      if(JSON.stringify(actual)!==JSON.stringify(reference)) {
       const mismatch={label,actual,reference};mismatches.push(mismatch);
       t.diagnostic('INDEPENDENT_MISMATCH '+JSON.stringify(mismatch));
       assert.deepEqual(actual,reference,'independent expected-by-construction safety decision '+label);
      }
      const old=indices.map(i=>oldPath[i]);
      if(JSON.stringify(actual)!==JSON.stringify(old))equivalenceMismatches.push({label,actual,old});
      if(JSON.stringify(input.filter((_,i)=>actual[i]))!==JSON.stringify(input.filter((_,i)=>reference[i])))assert.ok(mismatches.some(m=>m.label===label),'retained order '+label);
      cases++;candidates+=input.length;allowedCount+=reference.filter(Boolean).length;deniedCount+=reference.filter(x=>!x).length;actualAllowedCount+=actual.filter(Boolean).length;
     }
    })));
   }
  }
 }
 t.diagnostic('BATCH_DIFFERENTIAL '+JSON.stringify({node:process.version,family,base,seeds,fixtures,cases,candidates,allowed:allowedCount,denied:deniedCount,actualAllowed:actualAllowedCount,actualDenied:candidates-actualAllowedCount,oracle:'fixture-labels',mismatchCases:mismatches.length,equivalenceMismatchCases:equivalenceMismatches.length}));
 assert.ok(cases&&allowedCount&&deniedCount);
 await t.test('independent expected-by-construction safety decisions',()=>assert.equal(mismatches.length,0,JSON.stringify({count:mismatches.length,first:mismatches.slice(0,3)})));
 await t.test('equivalence control: old per-candidate predicate versus batch',()=>assert.equal(equivalenceMismatches.length,0,JSON.stringify({count:equivalenceMismatches.length,first:equivalenceMismatches.slice(0,3)})));
});

// Traverse literal static imports/re-exports. Every non-builtin dependency is
// rejected: an indirect production decision import is just as unsafe as a direct
// one. Reject runtime imports/loaders too, so an uninspectable edge fails closed.
const oracleURL=new URL('../testing/content-safety-s2h-candidate-oracle.mjs',import.meta.url);
function oracleImportGraph(root, overrides=new Map()) {
 const visited=new Set(),edges=[];
 function visit(url) {
  if(visited.has(url.href))return;
  visited.add(url.href);
  const source=overrides.get(url.href)??readFileSync(url,'utf8');
  assert.doesNotMatch(source,/\b(?:import|require|createRequire|eval|Function|getBuiltinModule|process|globalThis)\b/,'oracle cannot load hidden dependencies');
  // Deliberately reject these words even in comments/strings: this pure oracle
 // needs no loader or ambient runtime capability. Static re-exports remain
 // covered by V8, including escaped specifiers.
 // V8 parses all static import forms, including multiline imports and re-exports.
  // The parser child imports no SQLite and evaluates none of the supplied code.
  const parsed=spawnSync(process.execPath,['--experimental-vm-modules','--input-type=module','-e',
   "import {SourceTextModule} from 'node:vm';import {readFileSync} from 'node:fs';process.stdout.write(JSON.stringify(new SourceTextModule(readFileSync(0,'utf8')).dependencySpecifiers));"],
   {input:source,encoding:'utf8',env:{}});
  assert.equal(parsed.status,0,parsed.stderr);
  for(const specifier of JSON.parse(parsed.stdout)) {
   edges.push([url.href,specifier]);
   if(isBuiltin(specifier))continue;
   assert.ok(specifier.startsWith('.'),'oracle dependency must be statically resolvable');
   visit(new URL(specifier,url));
  }
 }
 visit(root);
 assert.deepEqual([...visited],[root.href],'oracle graph must contain no production or eligibility dependency');
 return {modules:visited.size,edges:edges.length};
}
test('independent oracle static import graph excludes all production decision code',t=>{
 const graph=oracleImportGraph(oracleURL);
 assert.deepEqual(graph,{modules:1,edges:0});
 t.diagnostic('ORACLE_IMPORT_GRAPH '+JSON.stringify(graph));
 // Exercise the same traversal against a regression to the original wrapper.
 assert.throws(()=>oracleImportGraph(oracleURL,new Map([[oracleURL.href,
  "import { contentReadSafety } from '../content-safety.mjs';\nexport const expectedCandidateDecision=contentReadSafety;\n"]])));
 for(const [label,source] of Object.entries({
  'commented dynamic':"await import/* x */('../content-safety.mjs');",
  'line-comment dynamic':"await import //x\n('../content-safety.mjs');",
  'newline dynamic':"await import\n('../content-safety.mjs');",
  'string-built specifier':"await import('../content-'+'safety.mjs');",
  eval:"eval('1');",Function:"new Function('return 1');",
  createRequire:"createRequire('synthetic');",
  getBuiltinModule:"process.getBuiltinModule('module');",
  require:"require('synthetic');",globalThis:"globalThis['synthetic'];",
  'comment token':"// import\nexport const safe=true;",
  'string token':"export const safe='require';",
 })){
  assert.throws(()=>oracleImportGraph(oracleURL,new Map([[oracleURL.href,source]])),undefined,label);
  t.diagnostic('ORACLE_GUARD_REJECTED '+label);
 }
 // An indirect wrapper is also rejected, rather than checking root text only.
 const wrapper=new URL('./synthetic-oracle-wrapper.mjs',oracleURL);
 assert.throws(()=>oracleImportGraph(oracleURL,new Map([
  [oracleURL.href,"export { expectedCandidateDecision } from './synthetic-oracle-wrapper.mjs';"],
  [wrapper.href,"export { contentReadSafety as expectedCandidateDecision } from '../content-safety.mjs';"],
 ])));
});

// Store a NULL fault with SQL only, restoring the original attested schema
// before decisions. Public writers reject this deliberately corrupt fixture.
function nullRawProject(db,id) {
 const ddl=db.prepare("SELECT sql FROM sqlite_schema WHERE type='table' AND name='raw_conversations'").get().sql;
 const triggers=db.prepare("SELECT name,sql FROM sqlite_schema WHERE type='trigger' AND tbl_name='raw_conversations'").all();
 for(const trigger of triggers)db.exec('DROP TRIGGER '+JSON.stringify(trigger.name));
 db.enableDefensive?.(false);
 db.exec('PRAGMA foreign_keys=OFF; PRAGMA writable_schema=ON');
 db.prepare("UPDATE sqlite_schema SET sql=? WHERE type='table' AND name='raw_conversations'").run(ddl.replace(/(?<!IS) NOT NULL/g,'').replace(/\s+STRICT\s*$/,''));
 db.exec('PRAGMA writable_schema=RESET');
 try { db.prepare('UPDATE raw_conversations SET project_id=NULL WHERE id=?').run(id); }
 finally {
  db.exec('PRAGMA writable_schema=ON');
  db.prepare("UPDATE sqlite_schema SET sql=? WHERE type='table' AND name='raw_conversations'").run(ddl);
  db.exec('PRAGMA writable_schema=RESET; PRAGMA foreign_keys=ON');
  for(const trigger of triggers)db.exec(trigger.sql);
 }
 assert.equal(db.prepare('SELECT project_id FROM raw_conversations WHERE id=?').get(id).project_id,null);
}
for(const family of costGateFamilies())for(const ancestry of ['foreign-scope','null-project'])test(`independent zero-fact ancestry safety and equivalence control: ${family} ${ancestry}`,async t=>{
 const f=costFamilyFixture(t,33,family);await f.migrate();const db=f.connect(),core=openMemoryCore({path:f.path});
 t.after(()=>{core.close();db.close();});
 const m=ok(core.admit({namespace:ns,memory:{content:'Synthetic boundary candidate',kind:'fact'},receipts:[receipt('boundary')]})).memory;
 const rid=db.prepare('SELECT id FROM receipts WHERE memory_id=?').get(m.id).id;
 const root='synthetic-boundary-root';
 db.prepare('INSERT INTO raw_conversations VALUES(?,?,?,?,?,?,1,?,?)').run(root,ns.ownerId,ancestry==='foreign-scope'?'personal':ns.scope,ancestry==='foreign-scope'?'':ns.projectId,'codex','boundary','time','time');
 db.prepare('INSERT INTO raw_receipt_lineage VALUES(?,?,?,?,?,?)').run(rid,root,'synthetic-message',0,1,'exact');
 if(ancestry==='null-project')nullRawProject(db,root);
 const ref={type:'memory',namespace:ns,memoryId:m.id,revision:m.revision};
 for(const intent of ['current','history'])withContentSuppressionRequest(()=>readTransaction(db,()=>withContentSuppressionReadInside(db,[ns],()=>{
  const p={readSet:[ns],intent};
  const expected=expectedCandidateDecision({ancestry,state:'live',precision:'exact',fact:'zero',eligibility:'current',variant:'target',intent});
  const old=candidateAllowedReference(db,{},ref,p);
  const actual=sidecar.memoryCandidatesAllowedInside(db,[ref],p,{});
  assert.deepEqual(actual,[expected],'independent unresolved/foreign-origin rule');
  assert.deepEqual(actual,[old],'equivalence control');
 })));
});

test('equivalence control: intended conservative numeric helper and missing/type cases',async t=>{
 const f=safetyFixture(t);await f.migrate();const db=f.connect(),core=openMemoryCore({path:f.path});
 t.after(()=>{core.close();db.close();});
 const m=ok(core.admit({namespace:ns,memory:{content:'Synthetic helper binding',kind:'fact'},receipts:[receipt('helper')]})).memory;
 const ref={type:'memory',namespace:ns,memoryId:m.id,revision:m.revision};
 const p={readSet:[ns],intent:'current'};
 for(const id of [1,9007199254740992]) {
  const row=db.prepare('SELECT * FROM memories WHERE id=?').get(m.id);
  row.id=db.prepare('SELECT CAST(? AS TEXT) id').get(id).id;row.fingerprint='synthetic-number-'+id;
  const columns=Object.keys(row);
  db.prepare(`INSERT INTO memories(${columns.join(',')}) VALUES(${columns.map(()=>'?').join(',')})`).run(...Object.values(row));
  withContentSuppressionRequest(()=>readTransaction(db,()=>withContentSuppressionReadInside(db,[ns],()=>{
   const numeric={...ref,memoryId:id};
   // Intended difference: old REAL binding finds text ids; batch requires a TEXT product ref.
   assert.equal(candidateAllowedReference(db,{},numeric,p),true);
   assert.deepEqual(sidecar.memoryCandidatesAllowedInside(db,[numeric],p,{}),[false]);
  })));
 }
 withContentSuppressionRequest(()=>readTransaction(db,()=>withContentSuppressionReadInside(db,[ns],()=>{
  const refs=[{...ref,memoryId:'missing-synthetic'},{...ref,memoryId:0},{...ref,revision:String(m.revision)}];
  // Intended conservative behavior: missing rows and type misses retain positions and fail closed.
  assert.deepEqual(sidecar.memoryCandidatesAllowedInside(db,refs,p,{}),[false,false,false]);
  assert.deepEqual(refs.map(r=>candidateAllowedReference(db,{},r,p)),[false,false,false]);
 })));
 t.diagnostic('CONSERVATIVE_CONTROL '+JSON.stringify({numericDifferences:2,missingOrTypeMisses:3}));
});

// Contract checks isolate each helper conjunct, which the batch and canonical S1
// share. Generated decisions above independently cover their real-store effects.
test('Memory eligibility conjuncts follow the intent-specific spec',()=>{
 const current={deleted:0,currentness:'current',review_state:'none'};
 for(const intent of ['current','history'])for(const [eligibility,row] of [
  ['current',current],['missing',null],['deleted',{...current,deleted:1}],
  ['superseded',{...current,currentness:'historical'}],['awaiting',{...current,review_state:'awaiting'}],
 ]){
  // incremental-catchup.md:237-258; context-read-product.md:2086.
  const expected=eligibility==='current'||intent==='history'&&['superseded','awaiting'].includes(eligibility);
  assert.equal(memoryReadEligible(row,intent),expected,eligibility+' '+intent);
 }
});
