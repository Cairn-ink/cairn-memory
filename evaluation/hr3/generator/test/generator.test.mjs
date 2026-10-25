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
import { validateInventory, validateFamily, validateValue, validateAnswer, validateLegacyAnswer, validateScope } from '../validate.mjs';
import { renderSentence, SENTENCES } from '../bank.mjs';
import { appendSource, captureEmission, triviaRegistry, validateTriviaRegistry, validateTriviaRules, TRIVIA_RULES, createFamilyTriviaHandle, verifyFamilyTrivia } from '../trivia.mjs';
import { workedExamples } from '../examples.mjs';
import { publicContract, validatePublicContract, HISTORICAL_LABELS, validNameAnchor, assertExampleFree } from '../contract.mjs';
import { slotRowsKey, slotHistoryKey } from '../slots.mjs';
import { leakageReport, matchedWorlds } from '../leakage.mjs';
import { inspectedRegistry, assertUninspected } from '../exclusions.mjs';
import { normalizeText, rational, valueKey, claimSetKey, taipeiBoundary } from '../canonicalize.mjs';

const inv=inventory(), pilot=generateSplit('pilot'), engineering=generateSplit('engineering');
const root=fileURLToPath(new URL('..',import.meta.url));
function choose(type, cause='direct', member=0) {
  const lineage=inv.lineages.find(l=>l.split==='pilot' && l.type===type && l.causal_class===cause);
  return {lineage,bundle:generateFamily(lineage,lineage.members[member])};
}
const clone=structuredClone;

test('all 310 specifications: exact allocation, disclosed revisions and split-disjoint banks; no held-out rendering',()=>{
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
      for (const alias of [l.bank.subjectZh,l.bank.subjectEn,...l.bank.routes,...l.bank.reasons.flatMap(r=>[r.en,r.zh])]) { assert(!aliases.has(alias)||aliases.get(alias)===split,`cross-split alias collision ${alias}`); aliases.set(alias,split); }
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
  assert.equal(correction.gold.checkpoints[0].private_causal.old.records[0].status,'erroneous');
  assert.equal(correction.gold.checkpoints[1].private_causal.old.records[0].claims[0].value.text,correction.family.ast.events.find(e=>e.source_turns[0]==='b2-focal' && !e.distractor).claims[0].value.text);
  const refinement=choose('refinement').bundle;
  const initial=refinement.family.ast.events.find(e=>e.source_turns[0]==='b1-focal' && !e.distractor);
  const refined=refinement.gold.checkpoints[1].private_causal.current.claims[0];
  assert.equal(refined.value.text,initial.claims[0].value.text);
  assert.equal(refined.qualifiers.find(q=>q.key==='cap').value.decimal,String(Number(initial.claims.find(x=>x.field==='cap').value.decimal)+40));
  const overlap=choose('scope_change').bundle;
  const cp2=overlap.gold.checkpoints[0].private_causal, cp4=overlap.gold.checkpoints[1].private_causal;
  assert.equal(cp2.current.claims.length,2); assert.equal(cp2.old.records.length,1);
  assert.equal(cp4.current.claims.length,2); assert.equal(cp4.old.records.length,2);
  assert.deepEqual(cp4.current.claims.map(c=>cellsOf(c.scope).length),[8,4]);
  assert(cp4.current.claims[0].scope.any[0].all[0].values.includes('TW'));
  const expiry=choose('expiry').bundle;
  for (const cp of expiry.gold.checkpoints) { assert.equal(cp.private_causal.current.status,'no_active_decision'); assert.equal(cp.private_causal.current.claims.length,0); assert.equal(cp.private_causal.old.records[0].status,'expired'); }
  assert.equal(expiry.family.ast.events.filter(e=>!e.distractor && e.change_type==='initial').length,2,'later adoption must be explicit');
});

test('future writes stay pending at both probes; correction can apply retroactively',()=>{
  const future=choose('reversal','direct',1).bundle;
  const events=future.family.ast.events.filter(e=>!e.distractor);
  assert.equal(future.gold.checkpoints[0].private_causal.current.claims[0].value.text,events[0].claims[0].value.text);
  assert.equal(future.gold.checkpoints[1].private_causal.current.claims[0].value.text,events[1].claims[0].value.text);
  assert(Date.parse(events[2].effective_interval.from)>Date.parse(future.family.checkpoints[1].at));
  const retro=choose('correction','direct',1).bundle;
  assert.equal(retro.family.ast.events.find(e=>e.source_turns[0]==='b1-focal' && !e.distractor).effective_interval.from,retro.gold.checkpoints[1].private_causal.current.claims[0].valid.from);
  assert.equal(taipeiBoundary('2031-03-02'),'2031-03-01T16:00:00.000Z');
  assert.equal(taipeiBoundary('2031-03-02',{through:true}),'2031-03-02T16:00:00.000Z');
});

test('causal classes encode AND/OR, serial paths, absent reasons, no implicit shortcuts',()=>{
  for (const cause of CAUSES) {
    const {bundle}=choose('reversal',cause), gold=bundle.gold.checkpoints[1].private_causal, support=bundle.support.checkpoints[1];
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
  const {bundle,lineage}=choose('reversal'), c=bundle.gold.checkpoints[0].private_causal.current.claims[0];
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
  const g=clone(choose('reversal').bundle.gold.checkpoints[0].private_causal); delete g.acceptedGraphs;
  assert.doesNotThrow(()=>validateLegacyAnswer(g,true));
  g.current.extra=1; assert.throws(()=>validateLegacyAnswer(g,true),{code:'closed_schema'});
});

const negativeCases=[
  ['observed_order','reversal','direct',b=>{b.family.batches[1].observed_at=b.family.batches[0].observed_at;}],
  ['anchor_resolution','reversal','direct',b=>{b.family.ast.events.find(e=>e.source_turns[0]==='b2-focal' && !e.distractor).predecessor_anchors[0].source_turn='missing';}],
  ['historical_anchor','reversal','direct',b=>{const a=b.family.ast.events.find(e=>e.source_turns[0]==='b1-focal' && !e.distractor); const d=b.family.ast.events.find(e=>e.source_turns[0]==='b4-focal' && !e.distractor); const prior=d.predecessor_anchors[0].record_name; d.predecessor_anchors=[{source_turn:a.source_turns[0],record_name:a.record_name,subject:a.subject,predicate:a.predicate}]; const turn=b.family.batches[3].turns[0];turn.text=turn.text.replace(`records ${prior}`,`records ${a.record_name}`).replace(`紀錄 ${prior}`,`紀錄 ${a.record_name}`);d.source_quotes[0].quote=turn.text;}],
  ['empty_scope','scope_change','direct',b=>{b.family.ast.events.find(e=>e.source_turns[0]==='b2-focal' && !e.distractor).scope={any:[]};}],
  ['span_quote','reversal','direct',b=>{b.support.checkpoints[0].acceptedGraphs[0].edges[0].support[0][0].quote='fabricated quote';}],
  ['batch_byte_limit','reversal','direct',b=>{b.family.batches[0].turns[0].text='a'.repeat(12289);}],
  ['gold_leakage','reversal','direct',b=>{b.family.batches[2].turns[0].text+=' G_correct';}],
  ['semantic_current','refinement','direct',b=>{b.gold.checkpoints[1].private_causal.current.claims[0].value.text='wrong route';}],
  ['semantic_history','correction','direct',b=>{b.gold.checkpoints[0].private_causal.old.records[0].status='previously_adopted';}],
  ['causal_topology','reversal','three_edge_serial',b=>{b.gold.checkpoints[0].private_causal.acceptedGraphs[0].edges=[{from:'a',to:'decision'}];}],
  ['empty_edge_support','reversal','direct',b=>{b.support.checkpoints[0].acceptedGraphs[0].edges[0].support=[];}],
  ['requested_predecessor_set','scope_change','direct',b=>{b.family.checkpoints[1].requested_predecessor_turns.pop();}],
  ['source_erroneous','correction','direct',b=>{const t=b.family.batches[1].turns[0]; t.text=t.text.replace(/never an adopted|從未是實際採用/,'previously adopted'); const e=b.family.ast.events.find(e=>e.source_turns[0]==='b2-focal' && !e.distractor); e.source_quotes=[{turn_id:t.turn_id,start:0,end:t.text.length,quote:t.text,offset_unit:'utf16'}];}],
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
    assert.equal(Object.keys(manifest.optional_trivia.family_handles).length,60);
    const listing=(await readdir(a)).sort(); assert.equal(listing.length,8);
    assert.deepEqual(listing,[...Object.keys(manifest.hashes),'manifest.json'].sort());
    for (const file of listing) { const one=await readFile(path.join(a,file)),two=await readFile(path.join(b,file)); assert(one.equals(two),file); if (file!=='manifest.json') assert.equal(sha256(one),manifest.hashes[file].sha256); }
    const duplicate=run(a); assert.equal(duplicate.status,1); assert.match(duplicate.stderr,/output_not_empty/);
    const invalid=invoke(['--split','unregistered','--out',path.join(base,'bad')]);
    assert.equal(invalid.status,1); assert.match(invalid.stderr,/unknown_split/);
  } finally { await rm(base,{recursive:true,force:true}); }
});

test('frozen source delivery list cross-checks root and test directory enumeration',async()=>{
  const rootNames=(await readdir(root)).filter(n=>n.endsWith('.mjs') || n==='answer.schema.json' || n==='README.md' || n==='public-contract.json' || n==='public-contract.schema.json' || n==='trivia-rules.json');
  const tests=(await readdir(path.join(root,'test'))).filter(n=>n.endsWith('.mjs')).map(n=>`test/${n}`);
  assert.deepEqual([...SOURCE_NAMES].sort(),[...rootNames,...tests].sort());
  console.log(`Source manifest cross-check: ${SOURCE_NAMES.length} files (explicit delivery map vs filesystem directories).`);
  const schema=JSON.parse(await readFile(path.join(root,'answer.schema.json'),'utf8'));
  const walk=x=>{if (x && typeof x==='object') { if (x.type==='object') {assert.equal(x.additionalProperties,false); assert.deepEqual([...x.required].sort(),Object.keys(x.properties).sort());} for (const child of Object.values(x)) walk(child);}};
  walk(schema);
  assert.deepEqual(schema.required,['current','old','reason']);
  assert.deepEqual(schema.$defs.RouteSlot.properties.state.enum,['value','not_specified','unavailable','unresolved']);
});

test('correctness projection never adds support text, offsets, citations or delivery labels',()=>{
  const bundle=choose('reversal','alternative_mediated').bundle;
  const projection=correctnessOnly(bundle.gold.checkpoints[1]);
  assert(projection.acceptedGraphs.length===2);
  assert(!/"(?:quote|turn_id|start|end|delivered|delivery)":/.test(canonical(projection)));
  assert.deepEqual(projection.reason.support,[]);
  projection.current.rows[0].route.value='mutation';
  assert.notEqual(bundle.gold.checkpoints[1].private_causal.current.claims[0].value.text,'mutation');
  const input=extractionInput(bundle.family,2);
  assert.deepEqual(Object.keys(input).sort(),['observed_at','public_contract','public_header','turns']);
  const {public_contract,...sourceInput}=input;
  assert.deepEqual(public_contract,publicContract());
  assert(!/"(?:ast|change_type|causal_class|G_correct|expected|controls|acceptedGraphs|optional_trivia)":/.test(canonical(sourceInput)));
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
  bundle.family.ast.events.find(e=>e.source_turns[0]==='b2-focal' && !e.distractor).source_quotes[0].quote=turn.text;
  assert.throws(()=>validateFamily(bundle,lineage),{code:'causal_direction_support'});
});

test('inventory validator rejects cross-lineage aliases and missing causal allocations',()=>{
  const alias=clone(inv); alias.lineages[1].bank.reasons[0].en=alias.lineages[0].bank.reasons[0].en;
  assert.throws(()=>validateInventory(alias),{code:'alias_overlap'});
  const counts=clone(inv); const l=counts.lineages.find(l=>l.split==='test' && l.causal_class==='direct'); l.causal_class='unstated';
  assert.throws(()=>validateInventory(counts),{code:'causal_allocation'});
});



test('R3 effective reason strata match frozen counts at both checkpoints, including expiry',()=>{
  for (const [split,run,multi,unstated] of [['engineering',engineering,20,5],['pilot',pilot,40,10]]) {
    for (const batch of [2,4]) {
      const strata=run.bundles.map(b=>reasonStratum(b.gold.checkpoints.find(c=>c.batch===batch).private_causal));
      assert.equal(strata.filter(s=>s.multiHop).length,multi);
      assert.equal(strata.filter(s=>s.status==='not_stated').length,unstated);
    }
    for(const b of run.bundles) for(const cp of b.gold.checkpoints) {
      const actual=reasonStratum(cp.private_causal);
      assert.deepEqual(b.family.reason_strata.find(s=>s.batch===cp.batch),{batch:cp.batch,...actual});
      assert.equal(b.family.multi_hop,actual.multiHop);
      if(b.family.change_type!=='expiry')continue;
      const parent=b.family.ast.events.find(e=>e.source_turns[0]===`b${cp.batch===2?1:3}-focal` && !e.distractor);
      if(b.family.expiry_mode==='deadline') {
        assert.deepEqual(cp.private_causal.acceptedGraphs.at(-1),{edges:[{from:'deadline',to:'decision'}]});
        assert.ok(parent.effective_interval.to);
      } else {
        assert.equal(parent.effective_interval.to,null);
        assert.ok(!cp.private_causal.reason.nodes.some(n=>n.id==='deadline'));
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
  cp.private_causal.acceptedGraphs.push({edges:[{from:'b',to:'decision'}]});
  assert.equal(reasonStratum(cp.private_causal).multiHop,false);
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


test('R3 revisions disclose retired same-split parents; held-out freshness remains a post-calibration gate',()=>{
  const revisions=inv.lineages.filter(l=>l.ancestry.relation==='revision');
  assert.equal(revisions.length,48);assert.equal(inv.retired_lineages.length,48);
  for(const l of revisions){
    const parent=inv.retired_lineages.find(p=>p.lineage_id===l.ancestry.parent);
    assert.ok(parent);assert.equal(parent.split,l.split);assert.equal(parent.status,'retired');
    assert.equal(parent.lineage_id,l.lineage_id.replace('-R3',''));
    assert.deepEqual(parent.ancestry.derivatives,[l.lineage_id]);
    if(['development','test'].includes(l.split))assert.deepEqual(JSON.parse(JSON.stringify(l.bank.reasons).replaceAll('-R3','').replaceAll('R3','')),parent.bank.reasons);
    else assert.equal(l.fixture_amendment.amendment,'A-4');
  }
});


test('ancestry validation rejects cross-split parents, cycles and falsely independent R3 roots',()=>{
  const cross=clone(inv),child=cross.lineages.find(l=>l.split==='engineering'&&l.ancestry.parent);
  child.ancestry.parent=cross.retired_lineages.find(l=>l.split==='pilot').lineage_id;
  assert.throws(()=>validateInventory(cross),{code:'ancestry_crossing'});
  const missing=clone(inv);missing.lineages.find(l=>l.ancestry.parent).ancestry.parent='engineering-missing-parent';
  assert.throws(()=>validateInventory(missing),{code:'ancestry_parent'});
  const cycle=clone(inv),c=cycle.lineages.find(l=>l.ancestry.parent),p=cycle.retired_lineages.find(l=>l.lineage_id===c.ancestry.parent);
  p.ancestry.parent=c.lineage_id;p.ancestry.relation='revision';
  assert.throws(()=>validateInventory(cycle),{code:'ancestry_cycle'});
  const root=clone(inv),r=root.lineages.find(l=>l.ancestry.parent);
  const old=root.retired_lineages.find(l=>l.lineage_id===r.ancestry.parent);old.ancestry.derivatives=[];
  r.ancestry.parent=null;r.ancestry.relation='root';
  assert.throws(()=>validateInventory(root),{code:'revision_provenance'});
});

test('ancestry validation rejects active/retired alias reuse, including cross-split reuse',()=>{
  const cross=clone(inv);cross.lineages.find(l=>l.split==='engineering').bank.routes[0]=cross.lineages.find(l=>l.split==='pilot').bank.routes[0];
  assert.throws(()=>validateInventory(cross),{code:'alias_overlap'});
  for(const sameSplit of [true,false]) {
    const bad=clone(inv),child=bad.lineages.find(l=>l.split==='engineering'&&l.ancestry.parent);
    child.bank.routes[0]=bad.retired_lineages.find(l=>sameSplit?l.split==='engineering':l.split==='pilot').bank.routes[0];
    assert.throws(()=>validateInventory(bad),{code:'alias_overlap'});
  }
});

test('8 development and 30 test replacements remain provisional; no fresh banks instantiated',()=>{
  const gate=inv.preDevelopmentGates.freshAffectedHeldOutBanks;
  assert.equal(gate.status,'pending');assert.match(gate.after,/calibration v2/);assert.match(gate.before,/development.*held-out generation/);
  for(const [split,count,multiplicity] of [['development',8,4],['test',30,8]]) {
    assert.equal(gate.lineages[split].length,count);
    const rows=inv.lineages.filter(l=>gate.lineages[split].includes(l.lineage_id));
    assert.equal(rows.length,count);assert.ok(rows.every(l=>l.freshness==='provisional_revision_fresh_bank_pending'&&l.multiplicity===multiplicity&&l.ancestry.parent));
  }
});

test('A-4 contract schema, bilingual aliases and fixed historical vocabulary have no answer mappings',()=>{
  assert.equal(validatePublicContract(),true);
  const contract=publicContract();
  assert.deepEqual(contract.slots.map(s=>[s.name,s.type,s.unit]),[['route','string','literal identifier'],['approval','boolean','none'],['cap','quantity','requests/day']]);
  assert.equal(contract.aliases.subjects.length,25);
  for(const row of [...contract.aliases.subjects,...contract.aliases.predicates,...contract.aliases.fields]) {
    for(const lang of ['zh-Hant','en','mixed'])assert(row[lang].length>0);
  }
  assert(!/"(?:lineage_id|change_type|expected|acceptedGraphs|event_id|causal_class)":/.test(canonical(contract.aliases)));
  const bad=clone(contract);bad.hidden='answer';assert.throws(()=>validatePublicContract(bad),{code:'contract_schema'});
  const badSlot=clone(contract);badSlot.slots[0].type='number';
  // The published schema fixes slot domain definitions, not just object shape.
  assert.throws(()=>validatePublicContract(badSlot),{code:'contract_schema'});
});

test('A-4 every question names slots, complete label vocabulary and exact predecessor turns',()=>{
  for(const {family:f}of pilot.bundles)for(const cp of f.checkpoints){
    for(const word of ['route','approval','cap',cp.focal_turn,...cp.requested_predecessor_turns,...HISTORICAL_LABELS])assert(cp.question.includes(word));
    assert.deepEqual(cp.requested_predecessor_turns,pilot.bundles.find(b=>b.family===f).gold.checkpoints.find(g=>g.batch===cp.batch).G_correct.old.records.map(r=>r.predecessor_turn));
  }
  assert.equal(choose('scope_change').bundle.gold.checkpoints[1].G_correct.old.records.length,2);
});

test('A-4 slot rows agree with independently replayed private semantics; absent is not false or unavailable',()=>{
  for(const {family,gold,support}of pilot.bundles){
    for(const cp of gold.checkpoints){
      const {acceptedGraphs,...answer}=cp.G_correct;
      validateAnswer(answer,true);
      assert.deepEqual(acceptedGraphs,cp.private_causal.acceptedGraphs);
      assert.equal(cp.G_correct.reason.status,cp.private_causal.reason.status);
      assert.deepEqual(cp.G_correct.reason.support,[]);
      for(const row of answer.current.rows){
        assert.equal(row.approval.value,true);
        assert.equal(row.route.state,'value');
        assert.equal(row.cap.state,family.change_type==='correction'?'not_specified':'value');
      }
      assert.equal(support.checkpoints.find(s=>s.batch===cp.batch).acceptedGraphs.length,acceptedGraphs.length);
    }
  }
  const {acceptedGraphs,...answer}=clone(choose('correction').bundle.gold.checkpoints[0].G_correct);
  const row=answer.current.rows[0];row.approval={state:'value',value:false};assert.doesNotThrow(()=>validateAnswer(answer));
  row.cap={state:'unavailable',value:null};assert.doesNotThrow(()=>validateAnswer(answer));
  row.cap.value={decimal:'0',unit:'requests/day'};assert.throws(()=>validateAnswer(answer),{code:'slot_null'});
  row.cap={state:'not_specified',value:null};row.route.value=true;assert.throws(()=>validateAnswer(answer),{code:'slot_type'});
});

test('A-4 equivalent row partitions, exact quantity conversions and duplicates collapse without hiding contradictions',()=>{
  const row=choose('reversal').bundle.gold.checkpoints[0].G_correct.current.rows[0];
  const expanded=CELLS.map(cell=>({...clone(row),scope:{any:[{all:Object.entries(cell).map(([field,value])=>({field,values:[value]}))}]}}));
  assert.equal(slotRowsKey([row,row]),slotRowsKey(expanded));
  const a=clone(row),b=clone(row);a.cap.value={decimal:'48',unit:'requests/day'};b.cap.value={decimal:'2.00',unit:'requests/hour'};
  assert.equal(slotRowsKey([a]),slotRowsKey([b]));
  b.approval.value=false;assert.notEqual(slotRowsKey([a,b]),slotRowsKey([a]));
});

test('A-4 independent matched worlds make question/contract-only answers non-identifiable and names are balanced',()=>{
  const report=leakageReport(pilot.bundles);
  assert.equal(report.matchedPairs,18);assert.equal(report.questionContractOnlyDeterministicPairAccuracyUpperBound,0.5);
  assert.deepEqual(report,leakageReport(generateSplit('pilot').bundles));
  for(const pair of matchedWorlds()){
    assert.notDeepEqual(pair.worlds[0].answer,pair.worlds[1].answer);
    for(const world of pair.worlds){validateAnswer(world.answer);for(const c of world.answer.reason.support)assert(world.source.includes(c.quote));}
  }
  const wrong=clone(pilot.bundles);wrong[0].family.ast.events.filter(e=>!e.distractor)[0].claims[0].value.text='answer-encoded-route';
  assert.throws(()=>leakageReport(wrong),{code:'literal_route'});
});

test('A-4 inspected registry excludes exact families, lineages, ancestors and both retained hash forms',()=>{
  const {registry}=inspectedRegistry();assert.equal(registry.counts.cases,504);assert.equal(registry.counts.lineages,66);
  assert.equal(registry.counts.developmentLineages,33);assert.equal(registry.counts.testLineages,33);
  const example=registry.cases[0];
  for(const candidate of [{lineage_id:example.lineageId},{family_id:example.familyId},{lineage_id:'fresh-name',ancestors:[example.lineageId]},{serializationSHA256:example.serializationSHA256},{referenceRowSHA256:example.referenceRowSHA256}])assert.throws(()=>assertUninspected(candidate,inv,registry),{code:'inspected_reference_exclusion'});
  const revised=clone(inv);revised.retired_lineages.push({lineage_id:'independent-looking-child',ancestry:{parent:example.lineageId}});
  assert.throws(()=>assertUninspected({lineage_id:'independent-looking-child'},revised,registry),{code:'inspected_reference_exclusion'});
  for(const b of pilot.bundles)assert.equal(assertUninspected(b.family,inv,registry),true);
  for(const split of ['development','test']) {
    assert.throws(()=>generateSplit(split),{code:'heldout_freshness_gate'});
    const l=inv.lineages.find(l=>l.split===split);assert.throws(()=>generateFamily(l,l.members[0]),{code:'heldout_freshness_gate'});
  }
});


test('A-4 rejects slot errors independently of the retained private causal projection',()=>{
  for(const [component,mutate]of [
    ['current',b=>{b.gold.checkpoints[0].G_correct.current.rows[0].route.value='wrong';}],
    ['history',b=>{b.gold.checkpoints[0].G_correct.old.records[0].status='erroneous';}],
    ['reason',b=>{b.gold.checkpoints[0].G_correct.reason.status='not_stated';}],
  ]){
    const {lineage,bundle}=choose('reversal');mutate(bundle);
    assert.throws(()=>validateFamily(bundle,lineage),{code:`slot_semantic_${component}`});
  }
});

test('A-4 history scope partitions and requested-record ordering compare extensionally',()=>{
  const {bundle,lineage}=choose('scope_change');
  const cp=bundle.gold.checkpoints[1],original=slotHistoryKey(cp.G_correct.old);
  cp.G_correct.old.records.reverse();
  for(const r of cp.G_correct.old.records)r.rows=r.rows.flatMap(row=>cellsOf(row.scope).map(cell=>({...clone(row),scope:{any:[{all:Object.entries(cell).map(([field,value])=>({field,values:[value]}))}]}})));
  assert.equal(slotHistoryKey(cp.G_correct.old),original);
  assert.doesNotThrow(()=>validateFamily(bundle,lineage));
});

test('A-6 public bilingual worked examples and schema are independently authored and excluded from worlds',()=>{
  const c=publicContract();assert.equal(c.version,'hr3-public-contract-a6-v1');
  assert.deepEqual(c.worked_examples,workedExamples());assert.deepEqual(c.worked_examples.excluded_from,['research','calibration']);
  for(const group of ['extraction','citation_address','inheritance_pairs','slot_recovery','causal_selection']){
    const examples=c.worked_examples[group];assert(examples.length>=2);
    assert.deepEqual([...new Set(examples.map(e=>e.language))].sort(),['en','zh-Hant']);
    for(const e of examples)assert(e.id.startsWith('demo'));
  }
  assert.deepEqual(c.extraction.crosswalk.kind,['fact','preference','decision','instruction','context']);
  const bad=clone(c);bad.worked_examples.extraction[0].batches[0].expected[0].record_name.hidden='extra';
  assert.throws(()=>validatePublicContract(bad),{code:'contract_schema'});
  assert.throws(()=>assertExampleFree({batches:[{text:'Record demoIndependent: adopt route demoOther.'}]}),{code:'public_example_world_exclusion'});
  for(const {family}of pilot.bundles)assert.doesNotThrow(()=>assertExampleFree({batches:family.batches,header:family.header}));
});

test('A-6 own/reference examples anchor complete current-batch tokens without earlier-turn guesses',()=>{
  const examples=publicContract().worked_examples.extraction;
  for(const example of examples){
    const batches=example.batches??[{turns:example.turns,expected:example.expected}];
    for(const batch of batches){
      const turns=new Map(batch.turns.map(t=>[t.turn_id,t.text]));
      for(const event of batch.expected){
        const used=new Set();
        const check=a=>{assert(event.source_turns.includes(a.turn_id));assert(turns.has(a.turn_id));let start=-1;for(let i=0;i<a.occurrence;i++)start=turns.get(a.turn_id).indexOf(a.quote,start+1);assert(start>=0);used.add(a.turn_id);};
        for(const a of event.source_quotes)check(a);
        if(event.record_name){check(event.record_name.anchor);assert(validNameAnchor(event.record_name.name,event.record_name.anchor,turns));}
        for(const r of event.predecessor_refs){check(r.anchor);assert(validNameAnchor(r.record_name,r.anchor,turns));}
        for(const a of event.reason_quotes)check(a);
        if(event.payload.type==='slots')for(const name of ['route','approval','cap'])for(const a of event.payload[name]?.anchors??[])check(a);
        else for(const a of event.payload.anchors)check(a);
        assert.deepEqual([...used].sort(),event.source_turns.slice().sort());
        for(const key of ['kind','commitment','change_type','replacement_extent'])assert(publicContract().extraction.crosswalk[key].includes(event[key]));
      }
    }
    if(example.id.startsWith('demo-own-reference-')){
      const event=batches[1].expected[0];assert.equal(event.record_name.name,'demoNeso');assert.equal(event.predecessor_refs[0].record_name,'demoLira');
      assert.equal(event.record_name.anchor.turn_id,'demo-decision');assert.equal(event.predecessor_refs[0].anchor.turn_id,'demo-decision');
      assert.equal(event.commitment,'adopted');assert.equal(event.change_type,'correction');
    }
    if(example.id.startsWith('demo-reason-anchors-'))assert.deepEqual(batches[0].expected[0].source_turns,['demo-decision','demo-cause']);
    if(example.id.startsWith('demo-cap-only-')){const p=batches[0].expected[0].payload;assert.equal(p.route,null);assert.equal(p.approval,null);assert.equal(p.cap.value.type,'Quantity');}
    if(example.id.startsWith('demo-future-complete-'))assert(Date.parse(batches[0].expected[0].effective_interval.from)>Date.parse(batches[0].expected[0].observed_at));
  }
});

test('A-6 name token syntax, adjacent-token boundaries, exact occurrence and case rules',()=>{
  assert.equal(publicContract().name_tokens.pattern,'[A-Za-z0-9_-]+');
  const turns=new Map([['demo-turn','demo70 demo7_suffix demo7-suffix (demo7) demo7 Demo7']]);
  const a=occurrence=>({turn_id:'demo-turn',quote:'demo7',occurrence});
  for(const n of [1,2,3])assert.equal(validNameAnchor('demo7',a(n),turns),false);
  for(const n of [4,5])assert.equal(validNameAnchor('demo7',a(n),turns),true);
  assert.equal(validNameAnchor('demo7',a(6),turns),false);
  for(const name of ['demo.name','demo name','demo+name','ｄｅｍｏ7',''])assert.equal(validNameAnchor(name,{turn_id:'demo-turn',quote:name,occurrence:1},turns),false);
  assert.equal(validNameAnchor('demo7',{...a(4),quote:'Demo7'},turns),false);
  assert.equal(validNameAnchor('Demo7',{turn_id:'demo-turn',quote:'Demo7',occurrence:1},turns),true);
});

test('A-6 worked receipt/body addresses and unit-local repeat occurrence stay exact',()=>{
  for(const e of publicContract().worked_examples.citation_address){
    const item=e.delivered.items[0];const r=e.valid_receipt,b=e.valid_body;
    assert.equal(r.intent,'history');assert.equal(r.item,0);assert.equal(r.unit,'receipt');assert.equal(r.source,item.sources[0].index);assert.equal(r.quote,item.sources[0].excerpt);
    assert.equal(b.unit,'body');assert.equal(b.source,null);assert.equal(b.quote,item.body);
    assert(!item.body.includes(e.invalid_body.quote));
    const first=e.repeat.unit_text.indexOf(e.repeat.valid.quote),second=e.repeat.unit_text.indexOf(e.repeat.valid.quote,first+1);
    assert(second>first);assert.equal(e.repeat.valid.occurrence,2);assert.equal(e.repeat.valid.item,0);assert.equal(e.repeat.valid.source,0);
  }
});

test('A-6 bilingual partial-refinement pairs inherit identically with and without an explicit preservation sentence',()=>{
  for(const e of publicContract().worked_examples.inheritance_pairs){
    assert.deepEqual(e.variants.map(v=>v.explicit_preservation),[false,true]);
    assert(e.variants[1].turn.text.startsWith(e.variants[0].turn.text));
    const expected=e.expected_current.rows[0];assert.equal(expected.route.value,'demoRoute9');assert.equal(expected.approval.value,false);
    for(const v of e.variants){
      assert.equal(v.supplied_slots.route,null);assert.equal(v.supplied_slots.approval,null);
      assert.deepEqual(valueKey(v.supplied_slots.cap),valueKey({type:'Quantity',...expected.cap.value}));
    }
  }
  for(const e of publicContract().worked_examples.slot_recovery){
    assert.deepEqual(e.expiry_current,{status:'no_active_decision',rows:[]});
    assert.equal(e.complete_replacement.current_after_effective.rows[0].approval.state,'not_specified');
    assert.equal(e.missing_predecessor.rows[0].approval.state,'unavailable');
  }
});

test('A-6 independent causal selection examples retain all serial/conjunctive/sufficiency clauses',()=>{
  for(const e of publicContract().worked_examples.causal_selection){
    assert.equal(e.serial.required_quotes.length,2);for(const q of e.serial.required_quotes)assert(e.serial.source.text.includes(q));
    assert.equal(e.conjunctive.required_quotes.length,2);for(const q of e.conjunctive.required_quotes)assert(e.conjunctive.source.text.includes(q));
    assert.notDeepEqual(e.conjunctive.insufficient_quotes,e.conjunctive.required_quotes);
    assert.equal(e.alternative.accepted_alternatives.length,2);
    e.alternative.accepted_alternatives.forEach((path,i)=>{assert.equal(path.length,3);for(const q of path)assert(e.alternative.sources[i].text.includes(q));});
    assert.deepEqual(e.missing_delivery,{status:'unavailable',support:[]});assert.deepEqual(e.factual_unstated,{status:'not_stated',support:[]});
  }
});

test('A-6 trivia is licensed by predeclared literal provenance and protects all interpolations and operators',()=>{
  assert.equal(validateTriviaRules(),true);
  for(const language of ['en','zh-Hant'])for(const key of ['edge','joint','fact']){
    const vars={fromFact:'demoDevice.v2 at 1.5 😀 (why?!)',toFact:'demoValve-1 >= demoThreshold',a:'demo-A',b:'demo_B',c:'demoC',fact:'demoGauge = -1.5 requests/hour'};
    const turn={turn_id:'demo-provenance',text:''},origin={turn_id:turn.turn_id,positions:[],segments:[]};
    const inputs=[captureEmission(turn.turn_id,key,language,vars)];
    appendSource(turn,origin,key,language,vars);
    const registry=triviaRegistry(new Map([[turn.turn_id,origin]]),inputs);assert(validateTriviaRegistry(registry,new Map([[turn.turn_id,turn]]),inputs));
    const optional=new Set(origin.positions);assert.equal(optional.size,1);assert(optional.has(turn.text.length-1));
    for(const part of origin.segments[0].parts)if(part.kind==='interpolated')for(let i=part.start;i<part.end;i++)assert(!optional.has(i));
    for(let i=0;i<turn.text.length-1;i++)assert(!optional.has(i),'all literal causal words, qualifiers and operators remain protected');
    const bad=clone(registry);bad.origins[0].positions.push(0);assert.throws(()=>validateTriviaRegistry(bad,new Map([[turn.turn_id,turn]]),inputs),{code:'trivia_positions'});
  }
  for(const bundle of pilot.bundles){
    const turns=new Map(bundle.family.batches.flatMap(b=>b.turns).map(t=>[t.turn_id,t]));
    const lineage=inv.lineages.find(l=>l.lineage_id===bundle.family.lineage_id),member=lineage.members.find(m=>m.family_id===bundle.family.family_id);
    const trusted=generateFamily(lineage,member,bundle.family.seed).support.optional_trivia.emission_inputs;
    assert(validateTriviaRegistry(bundle.support.optional_trivia,turns,trusted));
    for(const o of bundle.support.optional_trivia.origins)for(const p of o.positions)assert(['.','。',' '].includes(turns.get(o.turn_id).text[p]));
    const input=extractionInput(bundle.family,2);assert(!Object.hasOwn(input,'optional_trivia'));assert(!Object.hasOwn(correctnessOnly(bundle.gold.checkpoints[0]),'optional_trivia'));
  }
});

test('A-6 literal rendering preserves source words and final punctuation is the only licensed causal omission',()=>{
  for(const [production,langs]of Object.entries(SENTENCES))for(const [lang,template]of Object.entries(langs)){
    const vars=Object.fromEntries([...template.matchAll(/\{(\w+)\}/g)].map(m=>[m[1],`demo-${m[1]}.1.5 -> +2`]));
    assert.equal(renderSentence(production,lang==='zh'?'zh-Hant':'en',vars).text,template.replace(/\{(\w+)\}/g,(_,k)=>vars[k]));
  }
  assert(TRIVIA_RULES.rules.every(r=>r.role==='sentence-final separator'||r.production==='source_join'));
  const turn={turn_id:'demo-trivia',text:''},origin={turn_id:'demo-trivia',positions:[],segments:[]};appendSource(turn,origin,'edge','en',{fromFact:'A',toFact:'B'});
  assert.equal(turn.text,'A caused B.');assert.deepEqual(origin.positions,[10]);
  const protectedPositions=Array.from({length:turn.text.length},(_,i)=>i).filter(i=>!origin.positions.includes(i));
  assert(protectedPositions.every(i=>i<turn.text.indexOf('.')));
  assert(protectedPositions.some(i=>i>0&&i<turn.text.indexOf('B')),'endpoint-only citations leave required causal operator content uncovered');
});

test('A-6 fresh pilot has new source worlds with frozen allocation, controls, multiplicity and naming balance',async()=>{
  assert.equal(DEFAULT_SEED,'hr3-worlds-a6-pilot-v1');
  const old=JSON.parse(await readFile(path.join(root,'artifacts/previous-12355a8e/archive-manifest.json'),'utf8'));
  assert.equal(old.source_head,'12355a8e');assert.equal(Object.keys(old.source_fingerprints).length,60);
  for(const {family}of pilot.bundles)assert.notEqual(sha256(canonical(family.batches)),old.source_fingerprints[family.family_id]);
  const oldManifest=JSON.parse(await readFile(path.join(root,'artifacts/previous-12355a8e/pilot/manifest.json'),'utf8'));
  assert.equal(pilot.bundles.length,oldManifest.counts.families);assert.equal(pilot.rejections.length,0);
  const oldInventory=JSON.parse(await readFile(path.join(root,'artifacts/previous-12355a8e/pilot/lineage-inventory.json'),'utf8'));
  const allocation=x=>x.lineages.map(l=>({id:l.lineage_id,split:l.split,type:l.type,cause:l.causal_class,multiplicity:l.multiplicity,parent:l.ancestry.parent,members:l.members}));
  assert.deepEqual(allocation(inv),allocation(oldInventory));
  const report=leakageReport(pilot.bundles);assert.equal(report.matchedPairs,18);assert.equal(report.questionContractOnlyDeterministicPairAccuracyUpperBound,0.5);
  assert.equal(pilot.bundles.filter(b=>b.family.controls.some(c=>c.kind==='card')).length,40);
  assert.equal(pilot.bundles.filter(b=>b.family.controls.some(c=>c.kind==='named_forget_replay_foreign')).length,20);
});


test('A-6 trivia provenance changes no existing source production and inserts no earlier-turn IDs',async()=>{
  const previous=JSON.parse(await readFile(path.join(root,'artifacts/previous-12355a8e/pilot/grammar-and-sentence-bank.json'),'utf8'));
  for(const [key,value]of Object.entries(previous.sentences))assert.deepEqual(SENTENCES[key],value);
  for(const {family}of pilot.bundles)for(const b of family.batches)for(const t of b.turns)assert(!/\bb[1-4]-focal\b/.test(t.text));
});

// Independent authoring records are captured before rendering and are kept
// separate from the untrusted registries deliberately forged below.
function triviaFixture(language,emissions) {
  const turn={turn_id:'demo-auth-source',text:''},origin={turn_id:'demo-auth-source',positions:[],segments:[]},inputs=[];
  for(const [production,variables]of emissions) {
    inputs.push(captureEmission(turn.turn_id,production,language,variables));
    appendSource(turn,origin,production,language,variables);
  }
  return {turn,turns:new Map([[turn.turn_id,turn]]),inputs,registry:triviaRegistry(new Map([[turn.turn_id,origin]]),inputs)};
}
for(const language of ['en','zh-Hant']) {
  test(`P1-2 actual emission rejects alternative parse licensing interpolated separators (${language})`,()=>{
    const en=language==='en';
    const original=triviaFixture(language,[['edge',{fromFact:'A',toFact:en?'B. C caused D.':'B。 因為C，所以造成D。'}]]);
    const alternative=triviaFixture(language,[['edge',{fromFact:'A',toFact:'B'}],['source_join',{}],['edge',{fromFact:'C',toFact:en?'D.':'D。'}]]);
    assert.equal(original.turn.text,alternative.turn.text);
    assert(validateTriviaRegistry(original.registry,original.turns,original.inputs));
    const newlyLicensed=alternative.registry.origins[0].positions.filter(p=>!original.registry.origins[0].positions.includes(p));
    assert(newlyLicensed.length>=2);if(en)assert.deepEqual(newlyLicensed,[10,11]);
    assert.throws(()=>validateTriviaRegistry(alternative.registry,original.turns,original.inputs),{code:'trivia_emission_inputs'});
    const family={family_id:'demoAuthFamily',lineage_id:'demoAuthLineage',seed:'demo-auth-world',namespace:{ownerId:'demoAuthOwner'},batches:[{turns:[original.turn]}]};
    const pinned=createFamilyTriviaHandle(family,original.registry,original.inputs);
    const recomputed=createFamilyTriviaHandle(family,alternative.registry,alternative.inputs);assert.notDeepEqual(recomputed,pinned);
    assert.throws(()=>verifyFamilyTrivia({family,registry:alternative.registry},pinned),{code:'trivia_authentication'});
    const forged=clone(alternative.registry);forged.emission_inputs=clone(original.inputs);
    assert.throws(()=>validateTriviaRegistry(forged,original.turns,original.inputs),{code:'trivia_emission_parts'});
    assert.throws(()=>validateTriviaRegistry(original.registry,original.turns),{code:'trivia_trusted_emissions_required'});
  });
  test(`P1-1 forged edge/fact literals cannot license an interpolated decimal (${language})`,()=>{
    const en=language==='en',f=triviaFixture(language,[['edge',{fromFact:en?'Gauge 1.5':'量測值1.5',toFact:en?'alarm':'警報'}]]);
    const decimal=f.turn.text.indexOf('.'),end=f.turn.text.length;
    assert(decimal>=0&&!f.registry.origins[0].positions.includes(decimal));
    const literal=(literal_index,start,end)=>({kind:'literal',literal_index,start,end});
    const interpolation=(name,start,end)=>({kind:'interpolated',name,start,end});
    const bad=clone(f.registry);
    // The previous consumer accepted these complete but false boundaries:
    // an English edge's alleged final '.' is really the decimal in 1.5,
    // followed by a fact whose mandatory literal prefix was never emitted.
    bad.origins[0].segments=[
      {production:'edge',language:'en',start:0,end:decimal+1,parts:[literal(0,0,0),interpolation('fromFact',0,decimal),literal(1,decimal,decimal),interpolation('toFact',decimal,decimal),literal(2,decimal,decimal+1)]},
      {production:'fact',language:en?'en':'zh',start:decimal+1,end,parts:[literal(0,decimal+1,decimal+1),interpolation('fact',decimal+1,end-1),literal(1,end-1,end)]}
    ];
    bad.origins[0].positions=[decimal,end-1];
    assert.equal(f.turn.text.slice(decimal,decimal+1),'.');
    assert.throws(()=>validateTriviaRegistry(bad,f.turns,f.inputs),{code:'trivia_emission_parts'});
  });
  test(`Authenticated emission rejects labels, licenses, drift and substituted literals (${language})`,()=>{
    const f=triviaFixture(language,[['edge',{fromFact:'demoGauge.v2 = 1.5',toFact:'demoAlarm'}]]);
    const changes=[
      r=>{r.origins[0].segments[0].parts.find(p=>p.kind==='interpolated').kind='literal';},
      r=>{r.origins[0].positions.push(f.turn.text.indexOf('.'));},
      r=>{r.origins[0].positions.pop();},
      r=>{r.origins[0].segments[0].parts[1].end++;},
      r=>{r.origins[0].segments[0].start++;},
      r=>{r.origins[0].segments.pop();},
      r=>{r.origins[0].segments[0].language=language==='en'?'zh':'en';},
      r=>{r.emission_inputs[0].template=r.emission_inputs[0].template.replace(language==='en'?' caused ':'所以造成',' -> ');},
      r=>{r.emission_inputs[0].variables.toFact='demoForged';},
      r=>{r.origins[0].unlicensed_literal='.';},
      r=>{r.rules_sha256='0'.repeat(64);},
    ];
    for(const mutate of changes){const bad=clone(f.registry);mutate(bad);assert.throws(()=>validateTriviaRegistry(bad,f.turns,f.inputs));}
    const changed=clone(f.inputs);changed[0].template+='.';
    assert.throws(()=>validateTriviaRegistry(f.registry,f.turns,changed),{code:'trivia_template'});
    const wrongTurns=new Map([[f.turn.turn_id,{...f.turn,text:f.turn.text.replace(language==='en'?' caused ':'所以造成',' -> ')}]]);
    assert.throws(()=>validateTriviaRegistry(f.registry,wrongTurns,f.inputs),{code:'trivia_source_correspondence'});
    const snapshot=clone(f.inputs),variables={fromFact:'demoOriginal',toFact:'demoOther'};
    const captured=captureEmission('demo-turn','edge',language,variables);variables.fromFact='changed after authoring';
    assert.equal(captured.variables.fromFact,'demoOriginal');assert.deepEqual(f.inputs,snapshot);
  });
}

test('Family validation uses independent world/bank replay rather than the candidate input tape',()=>{
  const {bundle,lineage}=choose('reversal');
  bundle.support.optional_trivia.emission_inputs[0].variables.record='demoForged';
  assert.throws(()=>validateFamily(bundle,lineage),{code:'trivia_emission_inputs'});
});

test('Frozen consumer handle binds family, namespace, source, emission inputs, registry, rules and templates',()=>{
  const {family,support}=choose('reversal').bundle,registry=support.optional_trivia;
  const handle=createFamilyTriviaHandle(family,registry,registry.emission_inputs);
  const verified=verifyFamilyTrivia({family,registry},handle);
  assert.deepEqual(verified,registry);assert(Object.isFrozen(verified));assert(Object.isFrozen(verified.origins[0].segments));
  assert.notEqual(verified,registry);
  const bad=clone(registry);bad.origins[0].positions.pop();
  assert.throws(()=>verifyFamilyTrivia({family,registry:bad},handle),{code:'trivia_authentication'});
  const badInputs=clone(registry);badInputs.emission_inputs[0].variables.record='demoForged';
  assert.throws(()=>verifyFamilyTrivia({family,registry:badInputs},handle),{code:'trivia_authentication'});
  for(const change of [f=>{f.family_id='demo-other-family';},f=>{f.lineage_id='demo-other-lineage';},f=>{f.namespace.ownerId='demo-other-owner';},f=>{f.seed='demo-other-seed';},f=>{f.batches[0].turns[0].text+=' ';}]) {
    const changed=clone(family);change(changed);assert.throws(()=>verifyFamilyTrivia({family:changed,registry},handle),{code:'trivia_authentication'});
  }
  assert.throws(()=>verifyFamilyTrivia({family,registry}),{code:'trivia_trusted_handle_required'});
  registry.origins[0].positions.pop();assert.notDeepEqual(verified,registry,'verified copy is insulated from later candidate mutation');
  assert.throws(()=>{verified.origins[0].positions.push(0);},TypeError);
});


test('Trivia authentication repair preserves source bytes, questions, G_correct and extraction inputs',async()=>{
  const baseline=JSON.parse(await readFile(path.join(root,'artifacts/verification/trivia-auth-baseline.json'),'utf8'));
  assert.equal(sha256(jsonl(pilot.bundles.map(b=>b.family))),baseline.pilot_payload_hashes['families.jsonl']);
  assert.equal(sha256(jsonl(pilot.bundles.map(b=>b.gold))),baseline.pilot_payload_hashes['gold.jsonl']);
  for(const {family,gold,support}of pilot.bundles) {
    const before=baseline.families.find(f=>f.family_id===family.family_id);
    assert.equal(sha256(canonical(family.batches)),before.source_sha256);
    for(const cp of family.checkpoints)assert.equal(sha256(cp.question),before.questions.find(c=>c.batch===cp.batch).sha256);
    for(const cp of gold.checkpoints)assert.equal(sha256(canonical(cp.G_correct)),before.G_correct.find(c=>c.batch===cp.batch).sha256);
    const emittedFamily=JSON.parse(canonical(family));
    for(const b of family.batches)assert.equal(sha256(JSON.stringify(extractionInput(emittedFamily,b.ordinal))),before.extraction_inputs.find(x=>x.batch===b.ordinal).sha256);
    assert.equal(sha256(canonical(support.checkpoints)),before.support_checkpoints_sha256);
    assert.equal(sha256(canonical(support.optional_trivia.origins)),before.trivia_origins_sha256);
  }
});
