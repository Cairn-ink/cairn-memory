// Independently authored engineering fixtures. No research inventory, world
// renderer, random seed, or development/test lexical bank is imported.
import assert from 'node:assert/strict';
import { TYPES, CAUSES, CELLS, text, bool, quantity, scope, scopeFromCells, cellsOf, claim, cellKey } from '../generator/common.mjs';
import { sentence, fieldText } from '../generator/bank.mjs';
import { canonicalGold } from '../generator/canonicalize.mjs';

export const STRESS_SPEC = {
  version: 'independent-engineering-cap-stress-v1', split: 'engineering-stress',
  changes: TYPES, causes: CAUSES, languages: ['en','zh-Hant','mixed'], boundaryCases: [0,1],
  bounds: { batches: 4, checkpoints: [2,4], audienceCells: 12, initialCap: [100,899], finalCap: [140,939], baseDay: [1,15], batchSourceBytes: 12288, familySourceBytes: 32000 },
  coverage: 'Full change × causal-topology × language × numeric/time-boundary cross product; odd reversal is future-effective, odd correction retroactive. Covers deadline and non-clock expiry, two residual current sets, two predecessors, inherited fields, every non-adopted commitment and causal union.',
  lexicalPolicy: 'Separate engineering metallurgy vocabulary, no research-lineage aliases. Text lengths are stress choices rather than universal schema bounds; replacement banks require recertification.',
};
const topology = {
  direct: [[['a','decision']]], unstated: [],
  two_edge_serial: [[['a','b'],['b','decision']]],
  three_edge_serial: [[['a','b'],['b','c'],['c','decision']]],
  conjunctive_mediated: [[['a','c'],['b','c'],['c','decision']]],
  alternative_mediated: [[['a','b'],['b','decision']],[['c','d'],['d','decision']]],
};
const span = (turn, start=0, end=turn.text.length) => ({turn_id:turn.turn_id,start,end,offset_unit:'utf16',quote:turn.text.slice(start,end)});
const interval = (from,to=null) => ({from,to});
const fields = (route,cap,atomic=false) => [{field:'value',value:text(route)},{field:'approval',value:bool(true)},...(atomic?[]:[{field:'cap',value:quantity(cap)}])];
function audience(s,language) {
  const atoms=s.any.flatMap(t=>t.all);
  return atoms.length ? `${atoms.map(a=>`${a.field} = ${a.values.join('/')}`).join('; ')}; ${language==='zh-Hant'?'其他維度皆適用':'all other dimensions'}` : language==='zh-Hant'?'全部國家（TW、JP、US）、free/pro 方案及 web/app 通路':'all countries (TW, JP, US), free/pro plans and web/app channels';
}

function engineeringFixture(type,cause,language,boundary) {
  const suffix='503R3', id=`engineering-cap-${type}-${cause}-${language}-B${boundary}`;
  const bank={subjectEn:`Forging ${suffix} service`,subjectZh:`鍛造壓測${suffix}服務`,predicateEn:'dispatch configuration',predicateZh:'派送設定',
    routes:['A','B','C'].map(x=>`Forging${suffix}-${x}`),
    reasons:[['pressure instability','壓力不穩'],['coolant shortage','冷卻液短缺'],['thermal expansion','熱膨脹異常'],['bearing vibration','軸承振動']].map(([en,zh],i)=>({id:`engineering-cap/reason${i+1}`,en:`${en} at station ${suffix}.${i+1}`,zh:`${zh}，檢查點 ${suffix}.${i+1}`}))};
  const zh=language==='zh-Hant',subject=zh?bank.subjectZh:bank.subjectEn,predicate=zh?bank.predicateZh:bank.predicateEn;
  const cap=boundary?899:100, day=boundary?15:1;
  const at=(n,hour='00')=>`2031-03-${String(day+n-1).padStart(2,'0')}T${hour}:00:00.000Z`;
  const effective=n=>new Date(Date.parse(at(n))-8*3600000).toISOString();
  const deadline=type==='expiry'&&cause==='direct';
  const family={family_id:id,lineage_id:`engineering-cap-${type}-${cause}`,split:STRESS_SPEC.split,language,change_type:type,causal_class:cause,
    header:{subject,predicate,scope_text:audience(scope(),language)},batches:Array.from({length:4},(_,i)=>({ordinal:i+1,observed_at:at(i+1,'02'),effective_at:effective(i+1),turns:[]})),checkpoints:[],ast:{events:[]}};
  const focal=[], accepted=new Map();
  const base=(turn,batch,patch)=>({event_id:`${id}/${batch.ordinal}/${turn.turn_id}`,source_turns:[turn.turn_id],observed_at:batch.observed_at,kind:'decision',commitment:'adopted',change_type:'initial',subject,predicate,claims:[],scope:scope(),effective_interval:interval(batch.effective_at),predecessor_anchors:[],replacement_extent:'entire_predecessor',field_mask:[],reason_nodes:[],reason_edges:[],source_quotes:[],...patch});
  function emit(n,change,assignments,aud,previous,from,to=null) {
    const batch=family.batches[n-1],turn={turn_id:`b${n}-focal`,speaker:'user',text:''};
    const event=base(turn,batch,{record_name:'ABCD'[n-1],change_type:change,claims:assignments,field_mask:assignments.map(f=>f.field),scope:aud,effective_interval:interval(from,to),replacement_extent:['refinement','scope_change'].includes(change)?'partial':'entire_predecessor',predecessor_anchors:previous.map(i=>({source_turn:focal[i].source_turns[0],record_name:focal[i].record_name,subject,predicate}))});
    turn.text=sentence(change==='expiry'&&!deadline?'expiry_lapse':change,language,{record:event.record_name,predecessors:event.predecessor_anchors.map(a=>a.record_name).join(', '),subject,predicate,fields:fieldText(assignments,language),scope:audience(aud,language),from,to:to??(zh?'無上限（不含終點）':'unbounded (exclusive endpoint)')});
    if(deadline&&change==='initial')turn.text+=zh?' 這是明確的到期日；到期後不會自動採用接續決定。':' This is an explicit expiry deadline; expiry adopts no successor.';
    if(change!=='initial') {
      const trigger=deadline?span(turn):null;
      const facts=Object.fromEntries(['a','b','c','d'].map((x,i)=>[x,zh?bank.reasons[i].zh:bank.reasons[i].en]));
      facts.decision=zh?(change==='expiry'?'這次到期政策變更':'這次決定變更'):(change==='expiry'?'this expiry-policy change':'this decision change');
      const graphs=topology[cause],ids=[...new Set(graphs.flat(2))],supports=new Map();
      const append=(key,vars={})=>{const start=turn.text.length+1;turn.text+=' '+sentence(key,language,vars);return span(turn,start);};
      if(!graphs.length)append('unstated');
      ids.filter(x=>x!=='decision').forEach(x=>append('fact',{fact:facts[x]}));
      if(cause==='conjunctive_mediated'){const q=append('joint',{a:facts.a,b:facts.b,c:facts.c});supports.set('a:c',[[q]]);supports.set('b:c',[[q]]);}
      for(const [from,to] of graphs.flat())if(!supports.has(from+':'+to))supports.set(from+':'+to,[[append('edge',{fromFact:facts[from],toFact:facts[to]})]]);
      if(graphs.length>1)append('alternative');
      const node=(id,predicate,value)=>({id,claim:{subject,predicate,value,scope:aud,valid:event.effective_interval,qualifiers:[],citations:[]}});
      event.reason_nodes=ids.map(x=>node(x,'causal_condition',text(x==='decision'?`${change}_change`:bank.reasons[['a','b','c','d'].indexOf(x)].en)));
      event.reason_edges=[...supports].map(([key,support])=>({from:key.split(':')[0],to:key.split(':')[1],support}));
      const choices=graphs.map(g=>({edges:g.map(([from,to])=>({from,to,support:supports.get(from+':'+to)}))}));
      if(trigger){event.reason_nodes.push(node('deadline','expiry_deadline_passed',{type:'Instant',iso:from}));const edge={from:'deadline',to:'decision',support:[[trigger]]};event.reason_edges.push(edge);choices.push({edges:[edge]});}
      accepted.set(n,choices);
    }
    event.source_quotes=[span(turn)];batch.turns.push(turn);focal.push(event);return event;
  }
  const initial=fields(bank.routes[0],cap,type==='correction');
  emit(1,'initial',initial,scope(),[],effective(1),deadline?effective(2):null);
  if(type==='expiry') {
    emit(2,type,[],scope(),[0],effective(2));emit(3,'initial',fields(bank.routes[1],cap+20),scope(),[],effective(3),deadline?effective(4):null);emit(4,type,[],scope(),[2],effective(4));
  } else {
    const when=n=>boundary&&type==='correction'?effective(1):boundary&&type==='reversal'?effective(n+1):effective(n);
    for(const [n,delta] of [[2,20],[4,40]]) {
      if(n===4)family.batches[2].turns.push({turn_id:'b3-focal',speaker:'user',text:sentence('idle',language)});
      emit(n,type,type==='refinement'?[{field:'cap',value:quantity(cap+delta)}]:fields(bank.routes[n===2?1:2],cap+delta,type==='correction'),type==='scope_change'?scope(n===2?['TW']:['JP','TW']):scope(),n===2?[0]:type==='scope_change'?[0,1]:[1],when(n));
    }
  }
  for(const batch of family.batches) {
    const turn={turn_id:`b${batch.ordinal}-distractor`,speaker:'user',text:sentence('distractor',language==='mixed'?'zh-Hant':language,{subject,route:`unadopted-${bank.routes[0]}`,other:`rejected-${bank.routes[1]}`,collision:subject+' Annex',scope:'JP/pro/app',date:effective(4)})};batch.turns.push(turn);
    for(const [tag,commitment,s,aud,value] of [
      ['proposal','proposed',subject,scope(),`unadopted-${bank.routes[0]}`],['rejection','rejected',subject,scope(),`rejected-${bank.routes[1]}`],['quotation','quoted',subject,scope(),`unadopted-${bank.routes[0]}`],['subject_collision','adopted',subject+' Annex',scope(),`unadopted-${bank.routes[0]}`],['scope_date_collision','proposed',subject,{any:[{all:[{field:'country',values:['JP']},{field:'plan',values:['pro']},{field:'channel',values:['app']}]}]},`unadopted-${bank.routes[0]}`],['unsupported_cause','unresolved',subject,scope(),'paint colour'],
    ])family.ast.events.push(base(turn,batch,{event_id:`${id}/${batch.ordinal}/${tag}`,kind:tag==='unsupported_cause'?'context':'decision',commitment,subject:s,predicate:tag==='unsupported_cause'?'speculative_cause':predicate,claims:[{field:'value',value:text(value)}],field_mask:['value'],scope:aud,effective_interval:interval(tag==='scope_date_collision'?effective(4):batch.effective_at),source_quotes:[span(turn)],distractor:tag}));
  }
  family.ast.events.push(...focal);family.ast.events.sort((a,b)=>a.observed_at.localeCompare(b.observed_at)||Number(!!a.distractor)-Number(!!b.distractor));
  const gold={family_id:id,checkpoints:[]},support={family_id:id,checkpoints:[]};
  for(const n of [2,4]) {
    const e=focal.find(e=>e.source_turns[0]===`b${n}-focal`),graphs=accepted.get(n),isFinal=n===4;
    family.checkpoints.push({batch:n,at:family.batches[n-1].observed_at,focal_turn:e.source_turns[0],question:'Engineering stress: current decision, specified predecessors, and complete directed causal explanation.'});
    const merged=event=>initial.map(f=>f.field==='cap'?event.claims[0]:f);
    let current=[];
    if(type==='scope_change')current=[claim(focal[0],focal[0].claims,scope(isFinal?['US']:['JP','US'])),claim(e,e.claims,scope(isFinal?['JP','TW']:['TW']))];
    else if(type==='refinement')current=[claim(e,merged(e))];
    else if(type!=='expiry'){const active=boundary&&type==='reversal'?(isFinal?focal[1]:focal[0]):e;current=[claim(active)];}
    current.sort((a,b)=>cellsOf(a.scope).map(cellKey).sort()[0].localeCompare(cellsOf(b.scope).map(cellKey).sort()[0],'en'));
    const old=e.predecessor_anchors.map(a=>{const p=focal.find(e=>e.source_turns[0]===a.source_turn);return {status:type==='correction'?'erroneous':type==='expiry'?'expired':'previously_adopted',claims:[claim(p,type==='refinement'&&p!==focal[0]?merged(p):p.claims,scopeFromCells(cellsOf(p.scope)))]};});
    const answer={current:{status:current.length?'active':'no_active_decision',claims:current},old:{status:'available',records:old},reason:{status:graphs.length?'stated':'not_stated',nodes:e.reason_nodes,edges:[]},acceptedGraphs:graphs.map(g=>({edges:g.edges.map(({from,to})=>({from,to}))}))};
    gold.checkpoints.push({batch:n,G_correct:canonicalGold(answer,{bank})});
    support.checkpoints.push({batch:n,acceptedGraphs:graphs,assertion_spans:focal.filter(e=>e.observed_at<=family.batches[n-1].observed_at).map(e=>({event_id:e.event_id,spans:e.source_quotes}))});
  }
  const sizes=family.batches.map(b=>Buffer.byteLength(b.turns.map(t=>t.text).join('\n')));
  assert.ok(sizes.every(n=>n<=STRESS_SPEC.bounds.batchSourceBytes));assert.ok(sizes.reduce((a,b)=>a+b,0)<=STRESS_SPEC.bounds.familySourceBytes);
  return {family,gold,support};
}

export function engineeringStressFixtures() {
  return TYPES.flatMap(type=>CAUSES.flatMap(cause=>STRESS_SPEC.languages.flatMap(language=>STRESS_SPEC.boundaryCases.map(boundary=>engineeringFixture(type,cause,language,boundary)))));
}
