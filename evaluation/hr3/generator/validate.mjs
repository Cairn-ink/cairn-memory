import { reasonStratum } from './reason-strata.mjs';
import { assert, canonical, CELLS, DOMAIN, cellsOf, scopeFromCells, claim, TYPES, CAUSES } from './common.mjs';
import { SPLITS, GRAMMAR } from './inventory.mjs';
import { canonicalGold } from './canonicalize.mjs';

const VALUE_KEYS = {Text:['type','text'],Boolean:['type','value'],Quantity:['type','decimal','unit'],Instant:['type','iso'],Range:['type','lower','upper','lowerClosed','upperClosed','unit']};
export function keys(value, required, code = 'closed_schema') {
  assert(value && typeof value === 'object' && !Array.isArray(value),code);
  assert(canonical(Object.keys(value).sort()) === canonical([...required].sort()),code,`expected ${required.join(',')}`);
}
export function validateValue(value) {
  assert(value && Object.hasOwn(VALUE_KEYS,value.type),'value_type');
  keys(value,VALUE_KEYS[value.type]);
  const decimal = s => typeof s === 'string' && /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(s);
  switch (value.type) {
    case 'Text': assert(typeof value.text==='string' && value.text.length>0,'text_value'); break;
    case 'Boolean': assert(typeof value.value==='boolean','boolean_value'); break;
    case 'Quantity': assert(decimal(value.decimal) && typeof value.unit==='string' && value.unit.length>0,'quantity_value'); break;
    case 'Instant': validateInstant(value.iso); break;
    case 'Range': {
      assert((value.lower===null || decimal(value.lower)) && (value.upper===null || decimal(value.upper)),'range_value');
      assert(typeof value.lowerClosed==='boolean' && typeof value.upperClosed==='boolean' && typeof value.unit==='string','range_value');
      if (value.lower !== null && value.upper !== null) {
        const rational = x => { const [a,b='']=x.split('.'); return [BigInt(`${a}${b}`),10n**BigInt(b.length)]; };
        const [a,b]=rational(value.lower),[c,d]=rational(value.upper);
        assert(a*d<c*b || (a*d===c*b && value.lowerClosed && value.upperClosed),'range_order');
      }
      assert((value.lower!==null || !value.lowerClosed) && (value.upper!==null || !value.upperClosed),'unbounded_range');
      break;
    }
  }
}
export function validateInstant(value) { assert(typeof value==='string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString()===value,'utc_instant',String(value)); }
export function validateInterval(value) {
  keys(value,['from','to']);
  for (const x of [value.from,value.to]) if (x!==null) validateInstant(x);
  assert(value.from===null || value.to===null || Date.parse(value.from)<Date.parse(value.to),'interval_order');
}
export function validateScope(s) {
  keys(s,['any']); assert(Array.isArray(s.any),'scope_schema');
  for (const disjunct of s.any) {
    keys(disjunct,['all']); assert(Array.isArray(disjunct.all),'scope_schema');
    const fields = new Set();
    for (const atom of disjunct.all) {
      keys(atom,['field','values']); assert(Object.hasOwn(DOMAIN,atom.field),'scope_field');
      assert(!fields.has(atom.field),'scope_duplicate_field'); fields.add(atom.field);
      assert(Array.isArray(atom.values) && atom.values.length && new Set(atom.values).size===atom.values.length && atom.values.every(x => DOMAIN[atom.field].includes(x)),'scope_value');
    }
  }
  assert(cellsOf(s).length>0,'empty_scope');
}
export function validateClaim(c, gold = false) {
  keys(c,['subject','predicate','value','scope','valid','qualifiers','citations']);
  assert(typeof c.subject==='string' && c.subject && typeof c.predicate==='string' && c.predicate,'claim_referent');
  validateValue(c.value); validateScope(c.scope); validateInterval(c.valid);
  assert(Array.isArray(c.qualifiers) && Array.isArray(c.citations),'claim_schema');
  const seen = new Set();
  for (const q of c.qualifiers) { keys(q,['key','value']); assert(typeof q.key==='string' && q.key && !seen.has(q.key),'qualifier_key'); seen.add(q.key); validateValue(q.value); }
  if (gold) assert(c.citations.length===0,'gold_citation_leak');
  for (const citation of c.citations) {
    keys(citation,['intent','item','unit','source','quote','occurrence']);
    assert(['current','history'].includes(citation.intent) && ['body','receipt'].includes(citation.unit),'citation_enum');
    assert(Number.isInteger(citation.item) && citation.item>=0 && (citation.source===null || Number.isInteger(citation.source) && citation.source>=0) && Number.isInteger(citation.occurrence) && citation.occurrence>0 && typeof citation.quote==='string' && citation.quote.length>0,'citation_schema');
  }
}
export function validateAnswer(answer, gold = false) {
  keys(answer,['current','old','reason']);
  keys(answer.current,['status','claims']); keys(answer.old,['status','records']); keys(answer.reason,['status','nodes','edges']);
  assert(['active','no_active_decision','unresolved'].includes(answer.current.status),'current_status');
  assert(['available','unavailable','none'].includes(answer.old.status),'old_status');
  assert(['stated','not_stated','unavailable'].includes(answer.reason.status),'reason_status');
  assert(Array.isArray(answer.current.claims) && Array.isArray(answer.old.records) && Array.isArray(answer.reason.nodes) && Array.isArray(answer.reason.edges),'answer_arrays');
  assert((answer.current.status==='active') === (answer.current.claims.length>0),'current_status_claims');
  assert((answer.old.status==='available') === (answer.old.records.length>0),'old_status_records');
  for (const c of answer.current.claims) validateClaim(c,gold);
  for (const r of answer.old.records) { keys(r,['status','claims']); assert(['previously_adopted','erroneous','expired'].includes(r.status),'history_label'); assert(Array.isArray(r.claims) && r.claims.length>0,'history_claims'); for (const c of r.claims) validateClaim(c,gold); }
  const ids = new Set();
  for (const n of answer.reason.nodes) { keys(n,['id','claim']); assert(typeof n.id==='string' && !ids.has(n.id),'reason_node'); ids.add(n.id); validateClaim(n.claim,gold); }
  for (const edge of answer.reason.edges) { keys(edge,['from','to','citations']); assert(ids.has(edge.from) && ids.has(edge.to) && edge.from!==edge.to,'edge_referent'); assert(Array.isArray(edge.citations),'edge_citations'); for (const c of edge.citations) validateClaim({...answer.reason.nodes[0].claim,citations:[c]},false); }
  if (answer.reason.status!=='stated') assert(!answer.reason.edges.length && !answer.reason.nodes.length,'unstated_edges');
}

export function validateInventory(inv) {
  const ids = new Set(), banks = new Set(), aliases = new Set();
  assert(inv.lineages.length===310,'lineage_total');
  for (const l of inv.lineages) {
    assert(!ids.has(l.lineage_id),'lineage_overlap'); ids.add(l.lineage_id);
    assert(!banks.has(l.ancestry.bank_id),'bank_overlap'); banks.add(l.ancestry.bank_id);
    assert(l.ancestry.parent===null && l.ancestry.derivatives.length===0 && l.ancestry.aliases.length===0,'ancestry_crossing');
    for (const value of [l.bank.subjectZh,l.bank.subjectEn,...l.bank.routes,...l.bank.reasons.flatMap(x => [x.zh,x.en])]) { assert(!aliases.has(value),'alias_overlap',value); aliases.add(value); }
    assert(l.members.length===l.multiplicity && l.members.length===SPLITS[l.split].multiplicity,'lineage_multiplicity');
    assert(l.multi_hop === (CAUSES.indexOf(l.causal_class)>=2),'multi_hop');
  }
  for (const [split,spec] of Object.entries(SPLITS)) {
    const lineages = inv.lineages.filter(l => l.split===split), members = lineages.flatMap(l => l.members);
    assert(lineages.length===spec.lineagesPerType*5,'split_lineages');
    assert(new Set(members.map(m=>m.family_id)).size===members.length,'family_overlap');
    for (let i=0;i<3;i++) assert(members.filter(m=>m.language===GRAMMAR.languages[i]).length===spec.languages[i],'language_allocation');
    assert(members.filter(m=>m.card).length===spec.cards && members.filter(m=>m.safety).length===spec.safety,'control_allocation');
    for (const type of TYPES) for (let c=0;c<CAUSES.length;c++) assert(lineages.filter(l=>l.type===type && l.causal_class===CAUSES[c]).length===spec.causalLineages[c],'causal_allocation');
  }
  assert(inv.lineages.reduce((sum,l)=>sum+l.rendered_world_audit_members.length,0)===690,'rendered_audit_allocation');
  return {lineages:ids.size,banks:banks.size,lexicalAliases:aliases.size};
}

function checkSpan(span, turns, maxBatch = 4) {
  keys(span,['turn_id','start','end','offset_unit','quote']);
  const turn = turns.get(span.turn_id);
  assert(turn && turn.batch<=maxBatch,'span_turn');
  assert(span.offset_unit==='utf16' && Number.isInteger(span.start) && Number.isInteger(span.end) && span.start>=0 && span.end>span.start && span.end<=turn.text.length,'span_bounds');
  assert(turn.text.slice(span.start,span.end)===span.quote,'span_quote');
  // Offsets may not split UTF-16 surrogate pairs.
  for (const offset of [span.start,span.end]) assert(!(offset>0 && /[\uD800-\uDBFF]/.test(turn.text[offset-1]) && /[\uDC00-\uDFFF]/.test(turn.text[offset]??'')),'span_surrogate');
}

function semanticTruth(family, checkpoint) {
  const events = family.ast.events.filter(e => !e.distractor && e.commitment==='adopted' && Date.parse(e.observed_at)<=Date.parse(checkpoint.at));
  const focal = events.find(e=>e.source_turns.includes(checkpoint.focal_turn));
  const resolve = e => e.predecessor_anchors.map(a=>events.find(x=>x.source_turns.includes(a.source_turn)));
  const completeFields = event => {
    if (event.replacement_extent!=='partial') return event.claims;
    const parents=resolve(event), map = new Map(parents.flatMap(p=>completeFields(p)).map(x=>[x.field,x]));
    for (const x of event.claims) map.set(x.field,x);
    return [...map.values()];
  };
  // Independent cell interpreter: no calls to the generator's gold construction.
  const cellRows = [];
  const effectiveEvents = events.filter(e=>Date.parse(e.effective_interval.from??'0001-01-01T00:00:00Z')<=Date.parse(checkpoint.at)).sort((a,b)=>String(a.effective_interval.from).localeCompare(String(b.effective_interval.from)) || a.observed_at.localeCompare(b.observed_at));
  for (const cell of CELLS) {
    let state = null;
    for (const e of effectiveEvents) if (cellsOf(e.scope).some(c=>canonical(c)===canonical(cell))) {
      if (e.change_type==='expiry') { state=null; continue; }
      const fields = e.replacement_extent==='partial' && state ? new Map(state.fields.map(x=>[x.field,x])) : new Map();
      for (const assignment of e.claims) fields.set(assignment.field,assignment);
      state={event:e,fields:[...fields.values()]};
    }
    // An expired head never falls back to an older value.
    if (state?.event.effective_interval.to && Date.parse(state.event.effective_interval.to)<=Date.parse(checkpoint.at)) state=null;
    if (state) cellRows.push({cell,...state});
  }
  const groups = new Map();
  for (const row of cellRows) {
    const key = canonical({fields:[...row.fields].sort((a,b)=>a.field.localeCompare(b.field)),interval:row.event.effective_interval,event:row.event.event_id});
    if (!groups.has(key)) groups.set(key,{event:row.event,fields:row.fields,cells:[]});
    groups.get(key).cells.push(row.cell);
  }
  const current = [...groups.values()].map(g=>claim(g.event,g.fields,scopeFromCells(g.cells)));
  const old = resolve(focal).map(e=>({status:focal.change_type==='correction'?'erroneous':focal.change_type==='expiry'?'expired':'previously_adopted',claims:[claim(e,completeFields(e),scopeFromCells(cellsOf(e.scope)))]}));
  return {current:{status:current.length?'active':'no_active_decision',claims:current},old:{status:old.length?'available':'none',records:old}};
}
function normalizeClaims(claims) { return [...claims].map(c=>({...c,scope:scopeFromCells(cellsOf(c.scope)),qualifiers:[...c.qualifiers].sort((a,b)=>a.key.localeCompare(b.key))})).sort((a,b)=>canonical(a).localeCompare(canonical(b))); }
const topology = c => {
  const one = edges => [{edges:edges.map(([from,to])=>({from,to}))}];
  return {direct:one([['a','decision']]),unstated:[],two_edge_serial:one([['a','b'],['b','decision']]),three_edge_serial:one([['a','b'],['b','c'],['c','decision']]),conjunctive_mediated:one([['a','c'],['b','c'],['c','decision']]),alternative_mediated:[...one([['a','b'],['b','decision']]),...one([['c','d'],['d','decision']])]}[c];
};
export function validateFamily(bundle, lineage) {
  const {family:f,gold,support} = bundle;
  keys(bundle,['family','gold','support']);
  keys(gold,['family_id','lineage_id','checkpoints']); keys(support,['family_id','checkpoints']);
  assert(f.family_id===gold.family_id && f.family_id===support.family_id,'bundle_identity');
  assert(gold.lineage_id===f.lineage_id,'bundle_identity');
  assert(canonical(gold.checkpoints.map(c=>c.batch))==='[2,4]' && canonical(support.checkpoints.map(c=>c.batch))==='[2,4]','gold_checkpoint_set');
  assert(lineage && f.lineage_id===lineage.lineage_id && lineage.members.some(m=>m.family_id===f.family_id),'lineage_identity');
  assert(f.batches.length===4 && canonical(f.checkpoints.map(c=>c.batch))==='[2,4]','four_batches_two_probes');
  assert(f.checkpoints[0].primary===false && f.checkpoints[1].primary===true,'primary_checkpoint');
  assert(TYPES.includes(f.change_type) && f.change_type===lineage.type && CAUSES.includes(f.causal_class) && f.causal_class===lineage.causal_class,'family_type');
  const turns = new Map();
  let previous = -Infinity;
  for (const [i,b] of f.batches.entries()) {
    assert(b.ordinal===i+1,'batch_ordinal'); validateInstant(b.observed_at); validateInstant(b.effective_at);
    assert(Date.parse(b.observed_at)>previous,'observed_order'); previous=Date.parse(b.observed_at);
    let bytes=0;
    for (const t of b.turns) { assert(!turns.has(t.turn_id) && typeof t.text==='string' && t.text.length>0,'turn_identity'); turns.set(t.turn_id,{...t,batch:b.ordinal}); bytes+=Buffer.byteLength(t.text); }
    assert(bytes<=GRAMMAR.byteGuards.batchSourceBytes,'batch_byte_limit');
  }
  const allText=[...turns.values()].map(t=>t.text).join('\n');
  assert(Buffer.byteLength(allText)<=GRAMMAR.byteGuards.familySourceBytes,'family_byte_limit');
  assert(!/G_correct|acceptedGraphs|gold_id|expected_answer|hr3\/.*\/e\d/.test(allText),'gold_leakage');
  if (f.language==='en') assert(!/[\u3400-\u9fff]/.test(allText),'language_english');
  else assert(/[\u3400-\u9fff]/.test(allText),'language_chinese');
  if (f.language==='mixed') assert(allText.includes('we adopt') && allText.includes('尚未採用'),'language_mixed');
  const eventIds=new Set(), seen=[];
  for (const event of f.ast.events) {
    for (const field of ['event_id','source_turns','observed_at','kind','commitment','change_type','subject','predicate','claims','scope','effective_interval','predecessor_anchors','replacement_extent','field_mask','reason_nodes','reason_edges','source_quotes']) assert(Object.hasOwn(event,field),'event_field',field);
    assert(!eventIds.has(event.event_id),'event_identity'); eventIds.add(event.event_id);
    assert(['fact','preference','decision','instruction','context'].includes(event.kind) && ['adopted','proposed','quoted','rejected','unresolved'].includes(event.commitment),'event_enum');
    assert(['initial',...TYPES,'unchanged'].includes(event.change_type) && ['entire_predecessor','partial','unresolved'].includes(event.replacement_extent),'event_enum');
    validateScope(event.scope); validateInterval(event.effective_interval); validateInstant(event.observed_at);
    assert(event.source_turns.every(t=>turns.has(t)) && event.source_turns.length>0,'source_turn');
    assert(event.source_turns.every(t=>f.batches[turns.get(t).batch-1].observed_at===event.observed_at),'observation_source');
    for (const x of event.claims) { keys(x,['field','value']); validateValue(x.value); }
    assert(new Set(event.claims.map(x=>x.field)).size===event.claims.length && canonical([...event.field_mask].sort())===canonical(event.claims.map(x=>x.field).sort()),'field_mask');
    for (const s of event.source_quotes) checkSpan(s,turns);
    if (!event.distractor) {
      const source=event.source_quotes.map(s=>s.quote).join(' ');
      assert(source.includes(event.subject) && source.includes(event.predicate),'source_referent');
      for (const assignment of event.claims) if (assignment.value.type==='Text') assert(source.includes(assignment.value.text),'source_assertion');
      else if (assignment.value.type==='Quantity') assert(source.includes(assignment.value.decimal),'source_assertion');
      assert(source.includes(event.effective_interval.from),'source_interval');
      if (event.effective_interval.to!==null) assert(source.includes(event.effective_interval.to),'source_interval');
      for (const anchor of event.predecessor_anchors) assert(source.includes(anchor.record_name),'source_anchor');
      if (event.change_type==='refinement') assert(/all unnamed fields|所有未點名/.test(source) && /only|只改/.test(source),'source_replacement_extent');
      if (event.change_type==='reversal') assert(/in full|完整撤回/.test(source),'source_replacement_extent');
      if (event.change_type==='correction') assert(/never an adopted|從未是實際採用/.test(source),'source_erroneous');
    }
    const parents=[];
    for (const anchor of event.predecessor_anchors) {
      const matches = seen.filter(e=>e.source_turns.includes(anchor.source_turn) && e.record_name===anchor.record_name && e.subject===anchor.subject && e.predicate===anchor.predicate);
      assert(matches.length===1,'anchor_resolution');
      const parent=matches[0];
      assert(parent.subject===event.subject && parent.predicate===event.predicate,'anchor_compatibility');
      assert(cellsOf(parent.scope).some(cell=>cellsOf(event.scope).some(c=>canonical(c)===canonical(cell))),'anchor_scope');
      assert(!parents.includes(parent.event_id),'duplicate_predecessor'); parents.push(parent.event_id);
      assert(parent.commitment==='adopted' && !parent.distractor,'historical_anchor');
      const earlierUpdates=seen.filter(e=>e.predecessor_anchors.some(a=>a.source_turn===anchor.source_turn));
      assert(event.change_type==='expiry' || !earlierUpdates.some(e=>['correction','reversal','expiry'].includes(e.change_type) && e.replacement_extent==='entire_predecessor'),'historical_anchor');
      if (event.change_type==='expiry') assert(f.expiry_mode === 'deadline' ? parent.effective_interval.to===event.effective_interval.from : parent.effective_interval.to===null,'expiry_deadline');
    }
    const sourceOrder = event.predecessor_anchors.map(a=>[...turns.keys()].indexOf(a.source_turn));
    assert(sourceOrder.every((v,i)=>i===0 || v>sourceOrder[i-1]),'predecessor_order');
    if (!event.distractor && event.change_type!=='initial') assert(parents.length>0,'missing_predecessor');
    if (event.change_type==='correction') assert(event.claims.length===2 && event.field_mask.includes('approval'),'atomic_correction_qualifications');
    seen.push(event);
  }
  const distractors = new Set(f.ast.events.filter(e=>e.distractor).map(e=>e.distractor));
  assert(['proposal','rejection','quotation','subject_collision','scope_date_collision','unsupported_cause'].every(x=>distractors.has(x)),'distractor_coverage');
  for (const cp of f.checkpoints) {
    assert(cp.at===f.batches[cp.batch-1].observed_at,'checkpoint_time');
    const g=gold.checkpoints.find(x=>x.batch===cp.batch), s=support.checkpoints.find(x=>x.batch===cp.batch);
    assert(g && s,'gold_checkpoint');
    keys(g,['batch','G_correct']); keys(s,['batch','assertion_spans','acceptedGraphs']);
    const {acceptedGraphs,...answer}=g.G_correct;
    validateAnswer(answer,true);
    const focal=f.ast.events.find(e=>!e.distractor && e.source_turns.includes(cp.focal_turn));
    assert(focal && f.ast.focal_changes[cp.batch===2?0:1]===focal.event_id,'focal_change');
    assert(canonical(cp.requested_predecessor_turns)===canonical(focal.predecessor_anchors.map(a=>a.source_turn)),'requested_predecessor_set');
    const expected=canonicalGold({...semanticTruth(f,cp),reason:{nodes:[]}},lineage);
    assert(answer.current.status===expected.current.status && canonical(normalizeClaims(answer.current.claims))===canonical(normalizeClaims(expected.current.claims)),'semantic_current');
    assert(canonical(answer.old)===canonical(expected.old),'semantic_history');
    const expectedGraphs = topology(f.causal_class);
    if (f.change_type === 'expiry' && f.expiry_mode === 'deadline') expectedGraphs.push({edges:[{from:'deadline',to:'decision'}]});
    assert(canonical(acceptedGraphs)===canonical(expectedGraphs),'causal_topology');
    assert(canonical(s.acceptedGraphs.map(g=>({edges:g.edges.map(({from,to})=>({from,to}))})))===canonical(acceptedGraphs),'graph_projection');
    assert(answer.reason.status===(acceptedGraphs.length?'stated':'not_stated'),'semantic_reason');
    const effective = reasonStratum(g.G_correct);
    assert(canonical(f.reason_strata.find(s => s.batch === cp.batch)) === canonical({batch:cp.batch,...effective}),'effective_reason_stratum');
    assert(effective.multiHop === lineage.multi_hop && (effective.status === 'not_stated') === (lineage.causal_class === 'unstated'),'effective_reason_allocation');
    assert(f.multi_hop === effective.multiHop && f.authored_rationale_topology === lineage.causal_class,'effective_guard_membership');
    if (!acceptedGraphs.length) assert(/No reason for this change was stated|這次變更沒有說明原因/.test(turns.get(cp.focal_turn).text),'unstated_source');
    assert(canonical(answer.reason.nodes)===canonical(canonicalGold({current:{claims:[]},old:{records:[]},reason:{nodes:focal.reason_nodes}},lineage).reason.nodes),'reason_nodes');
    for (const node of focal.reason_nodes) {
      if (node.id === 'deadline') {
        const parent = f.ast.events.find(e => e.source_turns.includes(cp.requested_predecessor_turns[0]));
        assert(f.change_type === 'expiry' && f.expiry_mode === 'deadline' && node.claim.predicate === 'expiry_deadline_passed' && node.claim.value.type === 'Instant' && node.claim.value.iso === parent.effective_interval.to && Date.parse(node.claim.value.iso) <= Date.parse(cp.at),'expiry_trigger_node');
        continue;
      }
      const expected=node.id==='decision'?`${focal.change_type}_change`:lineage.bank.reasons[['a','b','c','d'].indexOf(node.id)]?.en;
      assert(node.claim.value.type==='Text' && node.claim.value.text===expected,'reason_node_meaning');
    }
    for (const graph of s.acceptedGraphs) for (const edge of graph.edges) {
      assert(edge.support.length>0 && edge.support.every(conjunction=>Array.isArray(conjunction) && conjunction.length>0),'empty_edge_support');
      const source=focal.reason_edges.find(e=>e.from===edge.from && e.to===edge.to);
      assert(source && canonical(source.support)===canonical(edge.support),'edge_source');
      for (const conjunction of edge.support) for (const span of conjunction) {
        checkSpan(span,turns,cp.batch);
        assert(span.turn_id===cp.focal_turn,'distractor_entailment');
        if (edge.from === 'deadline') {
          const deadline = focal.reason_nodes.find(n => n.id === 'deadline').claim.value.iso;
          assert(edge.to === 'decision' && span.start === 0 && span.quote.includes(deadline) && /reaches its explicit deadline|已到明確期限/.test(span.quote) && /It expires|到期失效/.test(span.quote),'expiry_trigger_support');
          continue;
        }
        assert(/caused|因為|才會造成/.test(span.quote) && !/unsupported|猜測/.test(span.quote),'causal_support');
        const sourceTerm=id=>id==='decision'?(f.language==='zh-Hant'?(f.change_type==='expiry'?'這次到期政策變更':'這次決定變更'):(f.change_type==='expiry'?'this expiry-policy change':'this decision change')):lineage.bank.reasons[['a','b','c','d'].indexOf(id)]?.[f.language==='zh-Hant'?'zh':'en'];
        const from=sourceTerm(edge.from), to=sourceTerm(edge.to);
        assert(from && to && span.quote.includes(from) && span.quote.includes(to) && span.quote.indexOf(from)<span.quote.indexOf(to),'causal_direction_support');
        if (f.causal_class==='conjunctive_mediated' && edge.to==='c') assert(/neither alone|單獨成立都不夠/.test(span.quote),'conjunctive_support');
      }
    }
    for (const entry of s.assertion_spans) for (const span of entry.spans) checkSpan(span,turns,cp.batch);
    const forbiddenKeys=['quote','source_quotes','spans','support','delivered','delivery','event_id','turn_id'];
    function visit(x) { if (!x || typeof x!=='object') return; for (const [key,value] of Object.entries(x)) { assert(!forbiddenKeys.includes(key),'correctness_gold_leakage',key); visit(value); } }
    visit(g.G_correct);
  }
  const member=lineage.members.find(m=>m.family_id===f.family_id);
  assert(f.controls.filter(x=>x.kind==='card').length===Number(member.card) && f.controls.filter(x=>x.kind==='named_forget_replay_foreign').length===Number(member.safety),'family_controls');
  for (const control of f.controls) if (control.kind==='card') {
    const actions=control.actions.filter(x=>x.authority!=='read');
    assert(new Set(actions.map(a=>a.payload.actionId)).size===actions.length,'action_id');
    assert(!control.actions.some(a=>canonical(a.payload).includes(f.header.subject)),'card_focal_leakage');
    assert(control.separate_assertion && !control.historyIsCurrent,'card_isolation');
    const confirm = control.actions.find(a => a.call === 'confirmCardDraft' && a.authority !== 'unauthorized-mcp');
    const declarations = control.actions.filter(a => a.call === 'declareCardCurrentDependencies' && a.authority !== 'unauthorized-mcp');
    assert(control.execution_status === 'fixture_clarified_E-2' && control.unresolved_protocol.length === 0,'card_certification_metadata');
    assert(control.authoring_path === 'confirm_with_dependencies' ? !!confirm.payload.currentDependencies && declarations.length === 0 : control.authoring_path === 'declare_separately' && !Object.hasOwn(confirm.payload,'currentDependencies') && declarations.length === 1 && declarations[0].payload.expectedDependencyRevision === null,'card_authoring_path');
    for (const a of actions.filter(a=>a.authority==='unauthorized-mcp')) assert(a.expected.error==='approval_required' && a.expected.mutation===false,'unauthorized_control');
  } else {
    assert(canonical(control.foreignNamespace)!==canonical(f.namespace) && canonical(control.readSet)===canonical([f.namespace]),'foreign_namespace');
    assert(control.expected.independentCopyEligible && !control.expected.replayResurrection && !control.expected.namedRecordExposed,'forget_control');
  }
  return {family_id:f.family_id,structural:'pass',semantic_ast_gold:'pass',source_span_edges:'pass',non_author_audit:'pending'};
}
