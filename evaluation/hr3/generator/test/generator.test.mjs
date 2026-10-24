import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, mkdtemp, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { openSync, closeSync, readFileSync } from 'node:fs';
import { DEFAULT_SEED, TYPES, CAUSES, canonical, jsonl, sha256, CELLS, cellsOf, scope, scopeFromCells } from '../common.mjs';
import { inventory, SPLITS } from '../inventory.mjs';
import { reasonStratum } from '../reason-strata.mjs';
import { generateFamily, correctnessOnly, extractionInput } from '../generate.mjs';
import { generateSplit, SOURCE_NAMES } from '../deliver.mjs';
import { validateInventory, validateFamily, validateValue, validateAnswer, validateScope } from '../validate.mjs';
import { normalizeText, rational, valueKey, claimSetKey, taipeiBoundary } from '../canonicalize.mjs';

const inv=inventory(), pilot=generateSplit('pilot'), engineering=generateSplit('engineering');
const root=fileURLToPath(new URL('..',import.meta.url));
function choose(type, cause='direct', member=0) {
  const lineage=inv.lineages.find(l=>l.split==='pilot' && l.type===type && l.causal_class===cause);
  return {lineage,bundle:generateFamily(lineage,lineage.members[member])};
}
const clone=structuredClone;

test('all 310 specifications: exact allocation and independent disjoint bank inventories, no held-out rendering',()=>{
  assert.equal(validateInventory(inv).lineages,310);
  assert.equal(inv.lineages.reduce((n,l)=>n+l.rendered_world_audit_members.length,0),690);
  assert(inv.lineages.filter(l=>l.split==='test').every(l=>l.rendered_world_audit_members.length===2 && l.rendered_world_audit_members.every(id=>l.members.slice(0,2).some(m=>m.family_id===id))));
  const expected={engineering:[30,1,30,10,10,10,20,10],pilot:[30,2,60,33,18,9,40,20],development:[50,4,200,110,60,30,40,20],test:[200,8,1600,880,480,240,160,160]};
  const ids=new Set(),aliases=new Map();
  for (const [split,[n,m,total,zh,en,mixed,cards,safety]] of Object.entries(expected)) {
    const ls=inv.lineages.filter(l=>l.split===split), members=ls.flatMap(l=>l.members);
    assert.equal(ls.length,n); assert.equal(members.length,total); assert(ls.every(l=>l.multiplicity===m));
    assert.deepEqual(['zh-Hant','en','mixed'].map(lang=>members.filter(w=>w.language===lang).length),[zh,en,mixed]);
    assert.equal(members.filter(w=>w.card).length,cards); assert.equal(members.filter(w=>w.safety).length,safety);
    assert.equal(ls.filter(l=>l.multi_hop).length,{engineering:20,pilot:20,development:30,test:100}[split]);
    for (const l of ls) {
      assert(!ids.has(l.lineage_id)); ids.add(l.lineage_id);
      for (const alias of [l.bank.subjectZh,l.bank.subjectEn,...l.bank.routes,...l.bank.reasons.flatMap(r=>[r.en,r.zh])]) { assert(!aliases.has(alias),`alias collision ${alias}`); aliases.set(alias,split); }
    }
    for (const type of TYPES) {
      assert.equal(ls.filter(l=>l.type===type).length,n/5);
      assert.deepEqual(CAUSES.map(c=>ls.filter(l=>l.type===type && l.causal_class===c).length*m),split==='engineering'?[1,1,1,1,1,1]:split==='pilot'?[2,2,2,2,2,2]:split==='development'?[8,8,8,8,4,4]:[80,80,40,40,40,40]);
    }
  }
  assert.deepEqual(inventory('different-world-seed').lineages,inv.lineages,'world seed may not alter frozen allocation');
  assert.equal(SPLITS.test.multiplicity,8);
});

test('30 engineering worlds validate independently before the pilot; pilot counts are exact',()=>{
  assert.equal(engineering.bundles.length,30); assert.equal(engineering.rejections.length,0);
  assert.equal(pilot.bundles.length,60); assert.equal(pilot.rejections.length,0);
  assert.equal(pilot.bundles.filter(x=>x.family.multi_hop).length,40);
  assert.equal(pilot.bundles.filter(x=>x.family.causal_class==='unstated').length,10);
  assert.deepEqual(pilot.bundles.reduce((a,x)=>({...a,[x.family.change_type]:(a[x.family.change_type]??0)+1}),{}),Object.fromEntries(TYPES.map(t=>[t,12])));
});

test('same seed has byte-identical families, gold, support and rejection log; world seeds are independent',()=>{
  const again=generateSplit('pilot');
  for (const key of ['family','gold','support']) assert.equal(sha256(jsonl(pilot.bundles.map(x=>x[key]))),sha256(jsonl(again.bundles.map(x=>x[key]))));
  assert.equal(jsonl(pilot.rejections),jsonl(again.rejections));
  const l=inv.lineages.find(l=>l.split==='pilot');
  const a=generateFamily(l,l.members[0],DEFAULT_SEED), b=generateFamily(l,l.members[0],'another-seed');
  assert.notEqual(canonical(a.family.ast),canonical(b.family.ast));
  assert.equal(validateFamily(b,l).structural,'pass');
  const second=generateFamily(l,l.members[1]);
  assert.notEqual(canonical(a.family.ast),canonical(second.family.ast));
});

test('hand-worked typed outcomes: erroneous history, partial field inheritance, scopes and no expiry fallback',()=>{
  const correction=choose('correction').bundle;
  assert.equal(correction.gold.checkpoints[0].G_correct.old.records[0].status,'erroneous');
  assert.equal(correction.gold.checkpoints[1].G_correct.old.records[0].claims[0].value.text,correction.family.ast.events.find(e=>e.record_name==='B').claims[0].value.text);
  const refinement=choose('refinement').bundle;
  const initial=refinement.family.ast.events.find(e=>e.record_name==='A');
  const refined=refinement.gold.checkpoints[1].G_correct.current.claims[0];
  assert.equal(refined.value.text,initial.claims[0].value.text);
  assert.equal(refined.qualifiers.find(q=>q.key==='cap').value.decimal,String(Number(initial.claims.find(x=>x.field==='cap').value.decimal)+40));
  const overlap=choose('scope_change').bundle;
  const cp2=overlap.gold.checkpoints[0].G_correct, cp4=overlap.gold.checkpoints[1].G_correct;
  assert.equal(cp2.current.claims.length,2); assert.equal(cp2.old.records.length,1);
  assert.equal(cp4.current.claims.length,2); assert.equal(cp4.old.records.length,2);
  assert.deepEqual(cp4.current.claims.map(c=>cellsOf(c.scope).length),[8,4]);
  assert(cp4.current.claims[0].scope.any[0].all[0].values.includes('TW'));
  const expiry=choose('expiry').bundle;
  for (const cp of expiry.gold.checkpoints) { assert.equal(cp.G_correct.current.status,'no_active_decision'); assert.equal(cp.G_correct.current.claims.length,0); assert.equal(cp.G_correct.old.records[0].status,'expired'); }
  assert.equal(expiry.family.ast.events.filter(e=>!e.distractor && e.change_type==='initial').length,2,'later adoption must be explicit');
});

test('future writes stay pending at both probes; correction can apply retroactively',()=>{
  const future=choose('reversal','direct',1).bundle;
  const events=future.family.ast.events.filter(e=>!e.distractor);
  assert.equal(future.gold.checkpoints[0].G_correct.current.claims[0].value.text,events[0].claims[0].value.text);
  assert.equal(future.gold.checkpoints[1].G_correct.current.claims[0].value.text,events[1].claims[0].value.text);
  assert(Date.parse(events[2].effective_interval.from)>Date.parse(future.family.checkpoints[1].at));
  const retro=choose('correction','direct',1).bundle;
  assert.equal(retro.family.ast.events.find(e=>e.record_name==='A').effective_interval.from,retro.gold.checkpoints[1].G_correct.current.claims[0].valid.from);
  assert.equal(taipeiBoundary('2031-03-02'),'2031-03-01T16:00:00.000Z');
  assert.equal(taipeiBoundary('2031-03-02',{through:true}),'2031-03-02T16:00:00.000Z');
});

test('causal classes encode AND/OR, serial paths, absent reasons, no implicit shortcuts',()=>{
  for (const cause of CAUSES) {
    const {bundle}=choose('reversal',cause), gold=bundle.gold.checkpoints[1].G_correct, support=bundle.support.checkpoints[1];
    assert.equal(gold.acceptedGraphs.length,cause==='unstated'?0:cause==='alternative_mediated'?2:1);
    const count={direct:1,unstated:0,two_edge_serial:2,three_edge_serial:3,conjunctive_mediated:3,alternative_mediated:2}[cause];
    for (const graph of gold.acceptedGraphs) assert.equal(graph.edges.length,count);
    for (const graph of support.acceptedGraphs) for (const edge of graph.edges) assert(edge.support.every(group=>group.length>0 && group.every(s=>s.quote.length>0)));
    assert.equal(gold.reason.status,cause==='unstated'?'not_stated':'stated');
  }
});

test('all eight Card branches, authority refusals, separate assertion and forget/foreign isolation',()=>{
  const cards=pilot.bundles.flatMap(x=>x.family.controls).filter(c=>c.kind==='card');
  assert.equal(cards.length,40); assert.equal(new Set(cards.map(c=>c.branch)).size,8);
  assert(cards.every(c=>c.separate_assertion));
  assert(cards.every(c=>c.execution_status==='fixture_clarified_E-2'));
  const byName=Object.fromEntries(cards.map(c=>[c.branch,c]));
  for (const name of ['adopt_v2','readopt_v1','v1_v2_v1','edit_without_review']) assert.equal(byName[name].checkpoints[1].currentEligible,false);
  for (const name of ['unadopted_v2','review_unchanged','edit_then_review','unauthorized_mcp']) assert.equal(byName[name].checkpoints[1].currentEligible,true);
  assert.equal(byName.edit_then_review.checkpoints[0].currentEligible,false);
  assert.equal(byName.edit_then_review.checkpoints[1].overwrittenBodyRecoverable,false);
  assert.equal(byName.unauthorized_mcp.actions.filter(a=>a.authority==='unauthorized-mcp').length,3);
  for (const c of cards) for (const a of c.actions.filter(a=>a.call==='importMethodVersion' && a.payload.package)) assert(a.payload.expectedPackageRevision);
  const safe=pilot.bundles.flatMap(x=>x.family.controls).filter(c=>c.kind==='named_forget_replay_foreign');
  assert.equal(safe.length,20);
  for (const s of safe) { assert.equal(s.actions[0].content,s.actions[4].content); assert.equal(s.actions[3].target,'$forgotten'); assert.equal(s.expected.independentCopyEligible,true); assert(!s.readSet.includes(s.foreignNamespace)); }
});

test('normalization, rational units, extensional scopes and equivalent duplicate collapse',()=>{
  assert.equal(normalizeText('  Ａ\n B\t'),'A B');
  assert.deepEqual(rational('-1.2500'),{numerator:'-5',denominator:'4'});
  assert.deepEqual(valueKey({type:'Quantity',decimal:'1.5',unit:'requests/hour'}),valueKey({type:'Quantity',decimal:'36.00',unit:'requests/day'}));
  assert.throws(()=>valueKey({type:'Quantity',decimal:'1',unit:'mystery'}),{code:'unknown_equivalence'});
  assert.deepEqual(scopeFromCells(CELLS),scope());
  const {bundle,lineage}=choose('reversal'), c=bundle.gold.checkpoints[0].G_correct.current.claims[0];
  const expanded=clone(c); expanded.scope={any:CELLS.map(cell=>({all:Object.entries(cell).map(([field,value])=>({field,values:[value]}))}))};
  assert.equal(claimSetKey([c,c],lineage),claimSetKey([expanded],lineage));
  const extra=clone(c); extra.value.text='contradictory route';
  assert.notEqual(claimSetKey([c,extra],lineage),claimSetKey([c],lineage));
});

test('closed schema accepts all five Value variants and rejects extras, bad ranges and malformed output',()=>{
  for (const v of [{type:'Text',text:'x'},{type:'Boolean',value:false},{type:'Quantity',decimal:'2.50',unit:'requests/day'},{type:'Instant',iso:'2031-03-01T16:00:00.000Z'},{type:'Range',lower:'-2.5',upper:'1.5',lowerClosed:false,upperClosed:true,unit:'requests/day'}]) assert.doesNotThrow(()=>validateValue(v));
  assert.throws(()=>validateValue({type:'Text',text:'x',hidden:'extra'}),{code:'closed_schema'});
  assert.throws(()=>validateValue({type:'Range',lower:'2',upper:'1',lowerClosed:true,upperClosed:true,unit:'x'}),{code:'range_order'});
  assert.throws(()=>validateScope({any:[]}),{code:'empty_scope'});
  assert.throws(()=>validateScope({any:[{all:[{field:'country',values:['ZZ']}]}]}),{code:'scope_value'});
  const g=clone(choose('reversal').bundle.gold.checkpoints[0].G_correct); delete g.acceptedGraphs;
  assert.doesNotThrow(()=>validateAnswer(g,true));
  g.current.extra=1; assert.throws(()=>validateAnswer(g,true),{code:'closed_schema'});
});

const negativeCases=[
  ['observed_order','reversal','direct',b=>{b.family.batches[1].observed_at=b.family.batches[0].observed_at;}],
  ['anchor_resolution','reversal','direct',b=>{b.family.ast.events.find(e=>e.record_name==='B').predecessor_anchors[0].source_turn='missing';}],
  ['historical_anchor','reversal','direct',b=>{const a=b.family.ast.events.find(e=>e.record_name==='A'); const d=b.family.ast.events.find(e=>e.record_name==='D'); d.predecessor_anchors=[{source_turn:a.source_turns[0],record_name:a.record_name,subject:a.subject,predicate:a.predicate}];}],
  ['empty_scope','scope_change','direct',b=>{b.family.ast.events.find(e=>e.record_name==='B').scope={any:[]};}],
  ['span_quote','reversal','direct',b=>{b.support.checkpoints[0].acceptedGraphs[0].edges[0].support[0][0].quote='fabricated quote';}],
  ['batch_byte_limit','reversal','direct',b=>{b.family.batches[0].turns[0].text='a'.repeat(12289);}],
  ['gold_leakage','reversal','direct',b=>{b.family.batches[2].turns[0].text+=' G_correct';}],
  ['semantic_current','refinement','direct',b=>{b.gold.checkpoints[1].G_correct.current.claims[0].value.text='wrong route';}],
  ['semantic_history','correction','direct',b=>{b.gold.checkpoints[0].G_correct.old.records[0].status='previously_adopted';}],
  ['causal_topology','reversal','three_edge_serial',b=>{b.gold.checkpoints[0].G_correct.acceptedGraphs[0].edges=[{from:'a',to:'decision'}];}],
  ['empty_edge_support','reversal','direct',b=>{b.support.checkpoints[0].acceptedGraphs[0].edges[0].support=[];}],
  ['requested_predecessor_set','scope_change','direct',b=>{b.family.checkpoints[1].requested_predecessor_turns.pop();}],
  ['source_erroneous','correction','direct',b=>{const t=b.family.batches[1].turns[0]; t.text=t.text.replace(/never an adopted|從未是實際採用/,'previously adopted'); const e=b.family.ast.events.find(e=>e.record_name==='B'); e.source_quotes=[{turn_id:t.turn_id,start:0,end:t.text.length,quote:t.text,offset_unit:'utf16'}];}],
];
for (const [code,type,cause,mutate] of negativeCases) test(`validator rejects ${code}`,()=>{
  const {lineage,bundle}=choose(type,cause); mutate(bundle);
  assert.throws(()=>validateFamily(bundle,lineage),{code});
});

test('rejected-candidate logging is deterministic, retains IDs and does not silently replace failures',()=>{
  const mutate=(l,m,seed)=>{const b=generateFamily(l,m,seed); if (m.member===0) b.family.batches[0].turns[0].text+=' expected_answer'; return b;};
  const a=generateSplit('pilot',DEFAULT_SEED,mutate), b=generateSplit('pilot',DEFAULT_SEED,mutate);
  assert.equal(a.rejections.length,30); assert.equal(a.bundles.length,30);
  assert.equal(jsonl(a.rejections),jsonl(b.rejections));
  for (const r of a.rejections) { assert.equal(r.code,'gold_leakage'); assert.equal(r.attempt,0); assert.match(r.candidate_sha256,/^[a-f0-9]{64}$/); }
});

test('CLI writes deterministic complete bytes and disk-verified hashes; rejects overwrite and unknown splits',async()=>{
  const base=await mkdtemp(path.join(root,'test','.cli-'));
  try {
    let child=0;
    const invoke=args=>{
      const stdoutFile=path.join(base,`child-${++child}.out`),stderrFile=path.join(base,`child-${child}.err`);
      const stdoutFd=openSync(stdoutFile,'wx'),stderrFd=openSync(stderrFile,'wx');
      let result;
      try { result=spawnSync(process.execPath,[path.join(root,'cli.mjs'),...args],{stdio:['ignore',stdoutFd,stderrFd]}); }
      finally { closeSync(stdoutFd); closeSync(stderrFd); }
      assert.equal(result.error,undefined,'CLI subprocess execution must succeed independently of its exit status');
      return {...result,stdout:readFileSync(stdoutFile,'utf8'),stderr:readFileSync(stderrFile,'utf8')};
    };
    const run=out=>invoke(['--split','pilot','--out',out]);
    const a=path.join(base,'a'), b=path.join(base,'b'), first=run(a), second=run(b);
    assert.equal(first.status,0,first.stderr); assert.equal(second.status,0,second.stderr);
    const manifest=JSON.parse(await readFile(path.join(a,'manifest.json'),'utf8'));
    assert.equal(manifest.counts.families,60); assert.equal(manifest.counts.rejected,0);
    const listing=(await readdir(a)).sort(); assert.equal(listing.length,8);
    assert.deepEqual(listing,[...Object.keys(manifest.hashes),'manifest.json'].sort());
    for (const file of listing) { const one=await readFile(path.join(a,file)),two=await readFile(path.join(b,file)); assert(one.equals(two),file); if (file!=='manifest.json') assert.equal(sha256(one),manifest.hashes[file].sha256); }
    const duplicate=run(a); assert.equal(duplicate.status,1); assert.match(duplicate.stderr,/output_not_empty/);
    const invalid=invoke(['--split','unregistered','--out',path.join(base,'bad')]);
    assert.equal(invalid.status,1); assert.match(invalid.stderr,/unknown_split/);
  } finally { await rm(base,{recursive:true,force:true}); }
});

test('frozen source delivery list cross-checks root and test directory enumeration',async()=>{
  const rootNames=(await readdir(root)).filter(n=>n.endsWith('.mjs') || n==='answer.schema.json' || n==='README.md');
  const tests=(await readdir(path.join(root,'test'))).filter(n=>n.endsWith('.mjs')).map(n=>`test/${n}`);
  assert.deepEqual([...SOURCE_NAMES].sort(),[...rootNames,...tests].sort());
  console.log(`Source manifest cross-check: ${SOURCE_NAMES.length} files (explicit delivery map vs filesystem directories).`);
  const schema=JSON.parse(await readFile(path.join(root,'answer.schema.json'),'utf8'));
  const walk=x=>{if (x && typeof x==='object') { if (x.type==='object') {assert.equal(x.additionalProperties,false); assert.deepEqual([...x.required].sort(),Object.keys(x.properties).sort());} for (const child of Object.values(x)) walk(child);}};
  walk(schema);
  assert.equal(schema.$defs.Value.oneOf.length,5);
});

test('correctness projection never adds support text, offsets, citations or delivery labels',()=>{
  const bundle=choose('reversal','alternative_mediated').bundle;
  const projection=correctnessOnly(bundle.gold.checkpoints[1]);
  assert(projection.acceptedGraphs.length===2);
  assert(!/"(?:quote|support|turn_id|start|end|delivered|delivery)":/.test(canonical(projection)));
  projection.current.claims[0].value.text='mutation';
  assert.notEqual(bundle.gold.checkpoints[1].G_correct.current.claims[0].value.text,'mutation');
  const input=extractionInput(bundle.family,2);
  assert.deepEqual(Object.keys(input).sort(),['observed_at','public_header','turns']);
  assert(!/"(?:ast|change_type|causal_class|G_correct|expected|controls|acceptedGraphs)":/.test(canonical(input)));
  assert.throws(()=>extractionInput(bundle.family,5));
});

test('semantic validator rejects reversed causal support even when offsets and quotations remain exact',()=>{
  const {lineage,bundle}=choose('reversal','direct'), span=bundle.support.checkpoints[0].acceptedGraphs[0].edges[0].support[0][0];
  const turn=bundle.family.batches[1].turns[0], original=span.quote;
  const from=lineage.bank.reasons[0][bundle.family.language==='zh-Hant'?'zh':'en'];
  const to=bundle.family.language==='zh-Hant'?'這次決定變更':'this decision change';
  const reversed=original.replace(from,'\u0001').replace(to,from).replace('\u0001',to);
  assert.equal(reversed.length,original.length);
  turn.text=turn.text.slice(0,span.start)+reversed+turn.text.slice(span.end);
  span.quote=reversed;
  bundle.family.ast.events.find(e=>e.record_name==='B').source_quotes[0].quote=turn.text;
  assert.throws(()=>validateFamily(bundle,lineage),{code:'causal_direction_support'});
});

test('inventory validator rejects cross-lineage aliases and missing causal allocations',()=>{
  const alias=clone(inv); alias.lineages[1].bank.routes[0]=alias.lineages[0].bank.routes[0];
  assert.throws(()=>validateInventory(alias),{code:'alias_overlap'});
  const counts=clone(inv); const l=counts.lineages.find(l=>l.split==='test' && l.causal_class==='direct'); l.causal_class='unstated';
  assert.throws(()=>validateInventory(counts),{code:'causal_allocation'});
});



test('R3 effective reason strata match frozen counts at both checkpoints, including expiry',()=>{
  for (const [split,run,multi,unstated] of [['engineering',engineering,20,5],['pilot',pilot,40,10]]) {
    for (const batch of [2,4]) {
      const strata=run.bundles.map(b=>reasonStratum(b.gold.checkpoints.find(c=>c.batch===batch).G_correct));
      assert.equal(strata.filter(s=>s.multiHop).length,multi);
      assert.equal(strata.filter(s=>s.status==='not_stated').length,unstated);
    }
    for(const b of run.bundles) for(const cp of b.gold.checkpoints) {
      const actual=reasonStratum(cp.G_correct);
      assert.deepEqual(b.family.reason_strata.find(s=>s.batch===cp.batch),{batch:cp.batch,...actual});
      assert.equal(b.family.multi_hop,actual.multiHop);
      if(b.family.change_type!=='expiry')continue;
      const parent=b.family.ast.events.find(e=>e.record_name===(cp.batch===2?'A':'C'));
      if(b.family.expiry_mode==='deadline') {
        assert.deepEqual(cp.G_correct.acceptedGraphs.at(-1),{edges:[{from:'deadline',to:'decision'}]});
        assert.ok(parent.effective_interval.to);
      } else {
        assert.equal(parent.effective_interval.to,null);
        assert.ok(!cp.G_correct.reason.nodes.some(n=>n.id==='deadline'));
        assert.match(b.family.lineage_id,/-R3$/);
        assert.equal(actual.status,b.family.causal_class==='unstated'?'not_stated':'stated');
      }
    }
  }
  // Prospective counts only: no development/test conversations or gold rendered.
  for(const [split,multi,unstated] of [['development',120,40],['test',800,400]]) {
    const ls=inv.lineages.filter(l=>l.split===split);
    assert.equal(ls.filter(l=>l.multi_hop).reduce((n,l)=>n+l.multiplicity,0),multi);
    assert.equal(ls.filter(l=>l.causal_class==='unstated').reduce((n,l)=>n+l.multiplicity,0),unstated);
    assert.ok(ls.filter(l=>l.type==='expiry'&&l.causal_class!=='direct').every(l=>l.lineage_id.endsWith('-R3')&&l.expiry_mode!=='deadline'));
  }
});

test('gold-derived guard rejects a shortcut even when legacy topology says multi-hop',()=>{
  const {lineage,bundle}=choose('expiry','two_edge_serial');
  const cp=bundle.gold.checkpoints[0];
  cp.G_correct.acceptedGraphs.push({edges:[{from:'b',to:'decision'}]});
  assert.equal(reasonStratum(cp.G_correct).multiHop,false);
  assert.throws(()=>validateFamily(bundle,lineage),{code:'causal_topology'});
});

test('E-2 fixtures cover both authoring paths in every Card branch without ambiguous null redeclaration',()=>{
  const cards=pilot.bundles.flatMap(b=>b.family.controls).filter(c=>c.kind==='card');
  for(const branch of new Set(cards.map(c=>c.branch))) {
    assert.deepEqual([...new Set(cards.filter(c=>c.branch===branch).map(c=>c.authoring_path))].sort(),['confirm_with_dependencies','declare_separately']);
  }
  for(const card of cards) {
    assert.deepEqual(card.unresolved_protocol,[]);
    assert.equal(card.certification.paidReadiness,false);
    const confirm=card.actions.find(a=>a.call==='confirmCardDraft'&&a.authority==='explicit-user');
    const declarations=card.actions.filter(a=>a.call==='declareCardCurrentDependencies'&&a.authority==='explicit-user');
    if(card.authoring_path==='confirm_with_dependencies'){assert.ok(confirm.payload.currentDependencies);assert.equal(declarations.length,0);}
    else {assert.equal(confirm.payload.currentDependencies,undefined);assert.equal(declarations.length,1);assert.equal(declarations[0].payload.expectedDependencyRevision,null);}
  }
});
