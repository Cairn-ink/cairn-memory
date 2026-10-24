import { VERSION, DEFAULT_SEED, rng, text, bool, quantity, scope, scopeFromCells, cellsOf, CELLS, claim, cellKey } from './common.mjs';
import { sentence, fieldText } from './bank.mjs';
import { cardControl, safetyControl } from './controls.mjs';
import { canonicalGold } from './canonicalize.mjs';

const interval = (from,to = null) => ({from,to});
const assignments = (route, cap, atomic = false) => [{field:'value',value:text(route)}, {field:'approval',value:bool(true)}, ...(atomic?[]:[{field:'cap',value:quantity(cap)}])];
function phrases(lineage, language) {
  const zh = language === 'zh-Hant';
  return {subject:zh?lineage.bank.subjectZh:lineage.bank.subjectEn,predicate:zh?lineage.bank.predicateZh:lineage.bank.predicateEn};
}
function scopeText(s, language) {
  const atoms = s.any.flatMap(x => x.all);
  return !atoms.length ? (language === 'zh-Hant'?'全部國家（TW、JP、US）、free/pro 方案及 web/app 通路':'all countries (TW, JP, US), free/pro plans and web/app channels') : `${atoms.map(x => `${x.field} = ${x.values.join('/')}`).join('; ')}; ${language === 'zh-Hant'?'其他維度皆適用':'all other dimensions'}`;
}
function sourceSpan(turn, start = 0, end = turn.text.length) {
  return {turn_id:turn.turn_id,start,end,offset_unit:'utf16',quote:turn.text.slice(start,end)};
}
function eventBase(id, turn, batch, overrides) {
  return {event_id:id,source_turns:[turn.turn_id],observed_at:batch.observed_at,kind:'decision',commitment:'adopted',change_type:'initial',
    subject:'',predicate:'',claims:[],scope:scope(),effective_interval:interval(batch.effective_at),predecessor_anchors:[],replacement_extent:'entire_predecessor',field_mask:[],reason_nodes:[],reason_edges:[],source_quotes:[],...overrides};
}
function reasonStructure(lineage, language, changeType) {
  const zh = language === 'zh-Hant';
  const facts = Object.fromEntries(['a','b','c','d'].map((id,i) => [id,zh?lineage.bank.reasons[i].zh:lineage.bank.reasons[i].en]));
  facts.decision = zh ? (changeType === 'expiry'?'這次到期政策變更':'這次決定變更') : (changeType === 'expiry'?'this expiry-policy change':'this decision change');
  const serial = pairs => [pairs];
  const graphs = {
    direct:serial([['a','decision']]),unstated:[],two_edge_serial:serial([['a','b'],['b','decision']]),
    three_edge_serial:serial([['a','b'],['b','c'],['c','decision']]),
    conjunctive_mediated:serial([['a','c'],['b','c'],['c','decision']]),
    alternative_mediated:[[['a','b'],['b','decision']],[['c','d'],['d','decision']]],
  }[lineage.causal_class];
  return {facts,graphs};
}
function addReasons(turn, event, lineage, language) {
  const {facts,graphs} = reasonStructure(lineage,language,event.change_type);
  const nodes = [...new Set(graphs.flat(2))];
  const spans = new Map();
  const append = (key,vars) => {
    const fragment = sentence(key,language,vars), start = turn.text.length + 1;
    turn.text += ` ${fragment}`;
    return sourceSpan(turn,start,turn.text.length);
  };
  if (!graphs.length && event.change_type !== 'expiry') append('unstated');
  for (const node of nodes.filter(x => x !== 'decision')) append('fact',{fact:facts[node]});
  if (lineage.causal_class === 'conjunctive_mediated') {
    const s = append('joint',{a:facts.a,b:facts.b,c:facts.c});
    spans.set('a:c',[[s]]); spans.set('b:c',[[s]]);
  }
  for (const [from,to] of graphs.flat()) if (!spans.has(`${from}:${to}`)) spans.set(`${from}:${to}`,[[append('edge',{fromFact:facts[from],toFact:facts[to]})]]);
  if (graphs.length > 1) append('alternative');
  event.reason_nodes = nodes.map(id => ({id,claim:{subject:event.subject,predicate:'causal_condition',value:id === 'decision'?text(`${event.change_type}_change`):text(lineage.bank.reasons[['a','b','c','d'].indexOf(id)].en),scope:event.scope,valid:event.effective_interval,qualifiers:[],citations:[]}}));
  event.reason_edges = [...spans].map(([key,support]) => ({from:key.split(':')[0],to:key.split(':')[1],support}));
  return graphs.map(edges => ({edges:edges.map(([from,to]) => ({from,to,support:spans.get(`${from}:${to}`)}))}));
}

export function generateFamily(lineage, member, seed = DEFAULT_SEED) {
  const random = rng(`${seed}/${lineage.lineage_id}/${member.member}/world`);
  const cap = 100 + Math.floor(random() * 800), baseDay = 1 + Math.floor(random() * 15);
  const at = (batch,hour = '00') => `2031-03-${String(baseDay + batch - 1).padStart(2,'0')}T${hour}:00:00.000Z`;
  // UTC 16:00 on the preceding date is midnight in Asia/Taipei.
  const effective = batch => new Date(Date.parse(at(batch)) - 8*3600000).toISOString();
  const language = member.language, type = lineage.type;
  const {subject,predicate} = phrases(lineage,language);
  const family = {schema_version:VERSION,family_id:member.family_id,lineage_id:lineage.lineage_id,split:lineage.split,seed,
    language,change_type:type,causal_class:lineage.causal_class,multi_hop:lineage.multi_hop,namespace:{ownerId:`hr3-${member.family_id}`,scope:'personal',projectId:null},
    header:{subject,predicate,scope_text:scopeText(scope(),language)},query_scope:scope(),
    batches:Array.from({length:4},(_,i) => ({ordinal:i+1,observed_at:at(i+1,'02'),effective_at:effective(i+1),turns:[]})),
    checkpoints:[],controls:[],ast:{events:[],focal_changes:[],time_zone:'Asia/Taipei',interval_convention:'[from,to)',variant:{future_effective:type === 'reversal' && member.member%2 === 1,retroactive:type === 'correction' && member.member%2 === 1}}};
  const events = [], accepted = [];
  const initialFields = assignments(lineage.bank.routes[0],cap,type === 'correction');
  function emit(batchNo, changeType, fields, audience, predecessorIndices, from, to = null) {
    const batch = family.batches[batchNo-1];
    const turn = {turn_id:`b${batchNo}-focal`,speaker:'user',text:''};
    const record = String.fromCharCode(65 + batchNo-1);
    const predecessors = predecessorIndices.map(i => events[i]);
    const predNames = predecessors.map(e => e.record_name).join(', ');
    const vars = {record,predecessors:predNames,subject,predicate,fields:fieldText(fields,language),scope:scopeText(audience,language),from,to:to??(language === 'zh-Hant'?'無上限（不含終點）':'unbounded (exclusive endpoint)')};
    turn.text = sentence(changeType === 'initial'?'initial':changeType,language,vars);
    if (type === 'expiry' && changeType === 'initial') turn.text += language === 'zh-Hant'?' 這是明確的到期日；到期後不會自動採用接續決定。':' This is an explicit expiry deadline; expiry adopts no successor.';
    const event = eventBase(`${family.family_id}/e${batchNo}`,turn,batch,{record_name:record,change_type:changeType,subject,predicate,claims:fields,scope:audience,effective_interval:interval(from,to),
      predecessor_anchors:predecessors.map(e => ({source_turn:e.source_turns[0],record_name:e.record_name,subject:e.subject,predicate:e.predicate})),
      replacement_extent:['refinement','scope_change'].includes(changeType)?'partial':'entire_predecessor',field_mask:fields.map(x => x.field)});
    if (changeType !== 'initial') {
      // E-1: the existing expiry source explicitly connects the passed deadline
      // to expiry. Preserve rationale paths as alternatives to this trigger.
      const triggerSpan = changeType === 'expiry' ? sourceSpan(turn) : null;
      const graphs = addReasons(turn,event,lineage,language);
      if (triggerSpan) {
        const node = (id,pred,value) => ({id,claim:{subject:event.subject,predicate:pred,value,scope:event.scope,valid:event.effective_interval,qualifiers:[],citations:[]}});
        if (!event.reason_nodes.some(n => n.id === 'decision')) event.reason_nodes.push(node('decision','causal_condition',text('expiry_change')));
        event.reason_nodes.push(node('deadline','expiry_deadline_passed',{type:'Instant',iso:from}));
        const edge = {from:'deadline',to:'decision',support:[[triggerSpan]]};
        event.reason_edges.push(edge);
        graphs.push({edges:[edge]});
      }
      accepted.push({event_id:event.event_id,graphs});
    }
    event.source_quotes = [sourceSpan(turn)];
    batch.turns.push(turn); events.push(event);
    return event;
  }
  emit(1,'initial',initialFields,scope(),[],effective(1),type === 'expiry'?effective(2):null);
  let first, last;
  if (type === 'expiry') {
    first = emit(2,type,[],scope(),[0],effective(2));
    emit(3,'initial',assignments(lineage.bank.routes[1],cap+20),scope(),[],effective(3),effective(4));
    last = emit(4,type,[],scope(),[2],effective(4));
  } else {
    const firstFields = type === 'refinement'?[{field:'cap',value:quantity(cap+20)}]:assignments(lineage.bank.routes[1],cap+20,type === 'correction');
    const finalFields = type === 'refinement'?[{field:'cap',value:quantity(cap+40)}]:assignments(lineage.bank.routes[2],cap+40,type === 'correction');
    const firstScope = type === 'scope_change'?scope(['TW']):scope(), finalScope = type === 'scope_change'?scope(['JP','TW']):scope();
    const start = batch => family.ast.variant.retroactive?effective(1):family.ast.variant.future_effective?effective(batch+1):effective(batch);
    first = emit(2,type,firstFields,firstScope,[0],start(2));
    family.batches[2].turns.push({turn_id:'b3-focal',speaker:'user',text:sentence('idle',language)});
    last = emit(4,type,finalFields,finalScope,type === 'scope_change'?[0,1]:[1],start(4));
  }
  for (const batch of family.batches) {
    const distractLanguage = language === 'mixed' ? 'zh-Hant' : language;
    const turn = {turn_id:`b${batch.ordinal}-distractor`,speaker:'user',text:sentence('distractor',distractLanguage,{subject,route:`unadopted-${lineage.bank.routes[0]}`,other:`rejected-${lineage.bank.routes[1]}`,collision:`${subject} Annex`,scope:'JP/pro/app',date:effective(4)})};
    batch.turns.push(turn);
    const variants = [
      ['proposal','proposed',subject,scope(),`unadopted-${lineage.bank.routes[0]}`],
      ['rejection','rejected',subject,scope(),`rejected-${lineage.bank.routes[1]}`],
      ['quotation','quoted',subject,scope(),`unadopted-${lineage.bank.routes[0]}`],
      ['subject_collision','adopted',`${subject} Annex`,scope(),`unadopted-${lineage.bank.routes[0]}`],
      ['scope_date_collision','proposed',subject,{any:[{all:[{field:'country',values:['JP']},{field:'plan',values:['pro']},{field:'channel',values:['app']}]}]},`unadopted-${lineage.bank.routes[0]}`],
      ['unsupported_cause','unresolved',subject,scope(),'paint colour'],
    ];
      for (const [tag,commitment,s,sc,value] of variants) family.ast.events.push(eventBase(`${family.family_id}/${batch.ordinal}/${tag}`,turn,batch,{kind:tag==='unsupported_cause'?'context':'decision',commitment,subject:s,predicate:tag==='unsupported_cause'?'speculative_cause':predicate,claims:[{field:'value',value:text(value)}],field_mask:['value'],scope:sc,effective_interval:interval(tag==='scope_date_collision'?effective(4):batch.effective_at),source_quotes:[sourceSpan(turn)],distractor:tag}));
  }
  family.ast.events.push(...events);
  family.ast.events.sort((a,b) => a.observed_at.localeCompare(b.observed_at) || family.batches.flatMap(b => b.turns).findIndex(t => t.turn_id===a.source_turns[0])-family.batches.flatMap(b => b.turns).findIndex(t => t.turn_id===b.source_turns[0]));
  family.ast.focal_changes = [first.event_id,last.event_id];
  for (const [batch,event] of [[2,first],[4,last]]) {
    const languageForQuestion = language === 'mixed'?'zh-Hant':language;
    const vars = {batch,at:family.batches[batch-1].observed_at,subject,predicate,scope:scopeText(scope(),languageForQuestion),turn:event.source_turns[0],predecessors:event.predecessor_anchors.map(x => x.record_name).join(', ')};
    const en = `${subject} ${predicate} ${family.header.scope_text} decision correction change reason`;
    const zh = `${subject} ${predicate} ${family.header.scope_text} 決定 修正 變更 原因`;
    family.checkpoints.push({batch,primary:batch===4,at:vars.at,focal_turn:vars.turn,requested_predecessor_turns:event.predecessor_anchors.map(x => x.source_turn),question:sentence('question',languageForQuestion,vars),query:language==='en'?en:language==='zh-Hant'?zh:`${en}\n${zh}`});
  }
  if (member.card) family.controls.push(cardControl(family,member.card_branch));
  if (member.safety) family.controls.push(safetyControl(family));
  const gold = {family_id:family.family_id,lineage_id:family.lineage_id,checkpoints:[]};
  const support = {family_id:family.family_id,checkpoints:[]};
  for (const checkpoint of family.checkpoints) {
    const isFinal = checkpoint.batch === 4, focal = isFinal?last:first;
    const historical = focal.predecessor_anchors.map(anchor => events.find(e => e.source_turns.includes(anchor.source_turn)));
    let currentClaims;
    if (type === 'expiry') currentClaims = [];
    else if (type === 'scope_change') {
      const untouched = CELLS.filter(c => !(isFinal?['TW','JP']:['TW']).includes(c.country));
      currentClaims = [claim(events[0],events[0].claims,scopeFromCells(untouched)),claim(focal,focal.claims,scopeFromCells(CELLS.filter(c => (isFinal?['TW','JP']:['TW']).includes(c.country))))];
    } else if (type === 'refinement') {
      const fields = initialFields.map(x => x.field==='cap'?focal.claims[0]:x);
      currentClaims = [claim(focal,fields,scopeFromCells(CELLS))];
    } else {
      const active = family.ast.variant.future_effective ? (isFinal?first:events[0]) : focal;
      currentClaims = [claim(active,active.claims,scopeFromCells(CELLS))];
    }
    const firstCell=c=>cellsOf(c.scope).map(cellKey).sort()[0];
    currentClaims.sort((a,b)=>firstCell(a).localeCompare(firstCell(b),'en'));
    const old = historical.map(event => {
      let fields = event.claims;
      if (type === 'refinement' && event !== events[0]) fields = initialFields.map(x => x.field==='cap'?event.claims[0]:x);
      return {status:type==='correction'?'erroneous':type==='expiry'?'expired':'previously_adopted',claims:[claim(event,fields,scopeFromCells(CELLS.filter(c => !event.scope.any[0].all.length || event.scope.any[0].all[0].values.includes(c.country))))]};
    });
    const graph = accepted.find(x => x.event_id===focal.event_id).graphs;
    const answer = {current:{status:currentClaims.length?'active':'no_active_decision',claims:currentClaims},old:{status:'available',records:old},reason:{status:graph.length?'stated':'not_stated',nodes:focal.reason_nodes,edges:[]}};
    // Answer citations are deliberately empty here. These are semantic gold claims, not fabricated delivered citations.
    gold.checkpoints.push({batch:checkpoint.batch,G_correct:canonicalGold({...answer,acceptedGraphs:graph.map(g => ({edges:g.edges.map(({from,to}) => ({from,to}))}))},lineage)});
    support.checkpoints.push({batch:checkpoint.batch,assertion_spans:events.filter(e => Date.parse(e.observed_at)<=Date.parse(checkpoint.at)).map(e => ({event_id:e.event_id,spans:e.source_quotes})),acceptedGraphs:graph});
  }
  return {family,gold,support};
}

export function correctnessOnly(goldCheckpoint) {
  return structuredClone(goldCheckpoint.G_correct);
}

export function extractionInput(family,batchOrdinal) {
  const batch=family.batches.find(b=>b.ordinal===batchOrdinal);
  if (!batch) throw new Error('Unknown batch ordinal');
  return structuredClone({observed_at:batch.observed_at,public_header:family.header,turns:batch.turns});
}
