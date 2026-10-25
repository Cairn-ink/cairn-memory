import {sourceOrderAliases} from './privacy.mjs';
import { canonical, normalize, compare, cells, scopeOf, intervalStart, intervalEnd, orderEvents, effectiveOrder } from './common.mjs';
const key=e=>canonical([normalize(e.subject),normalize(e.predicate),cells(e.scope)]);
const adopted=e=>e.commitment==='adopted';
const eligible=(e,at)=>intervalStart(e)<=at;
const live=(e,at)=>eligible(e,at)&&intervalEnd(e)>at;
export function resolveLinks(events) {
  const prior=[], retired=new Map(),ids=new Set();
  return [...events].sort(orderEvents).map(e=>{
    const targets=[],errors=[];
    if(ids.has(e.event_id))errors.push('duplicate_event_id');ids.add(e.event_id);
    for(const a of e.predecessor_anchors) {
      const matches=prior.filter(p=>p.source_turns.includes(a.source_turn)&&normalize(p.subject)===normalize(a.subject)&&normalize(p.predicate)===normalize(a.predicate));
      if(matches.length!==1){errors.push(matches.length?'nonunique_anchor':'missing_anchor');continue;}
      const p=matches[0];
      if(!adopted(p)||p.unresolved||normalize(p.subject)!==normalize(e.subject)||normalize(p.predicate)!==normalize(e.predicate)||!cells(p.scope).some(c=>cells(e.scope).some(d=>canonical(c)===canonical(d)))||(retired.get(p.event_id)??Infinity)<=Date.parse(e.observed_at))errors.push('incompatible_or_historical_anchor');
      targets.push(p);
    }
    if(new Set(targets).size!==targets.length)errors.push('duplicate_anchor');
    if(e.change_type!=='initial'&&e.change_type!=='unchanged'&&!e.predecessor_anchors.length)errors.push('missing_predecessor');
    if(e.replacement_extent==='unresolved')errors.push('unresolved_extent');
    targets.sort(orderEvents);
    const event={...structuredClone(e),targets:targets.map(p=>p.event_id),unresolved:errors.length>0,link_errors:errors};
    if(!event.unresolved&&adopted(event)&&['correction','reversal','expiry'].includes(event.change_type)&&event.replacement_extent==='entire_predecessor')for(const p of targets)retired.set(p.event_id,intervalStart(event));
    prior.push(event);return event;
  });
}
export function distinctQuotes(events) {return [...new Map(events.flatMap(e=>(e.source_quotes??[]).map(q=>[canonical([q.turn_id,q.start,q.end]),q]))).values()];}
function evidence(events) {return distinctQuotes(events);}
function record(e,fields=e.claims,scope=e.scope,status='active',support=[e]) {
  return {id:e.event_id,subject:e.subject,predicate:e.predicate,scope,fields,valid:e.effective_interval,status,change_type:e.change_type,commitment:e.commitment,unresolved:e.unresolved,link_errors:e.link_errors,predecessors:e.targets,context:e.context??null,kind:e.kind,supporting_events:support.map(x=>x.event_id),receipts:evidence(support)};
}
function materializeSlots(arm,raw,atISO) {
  if(!['T','U','O'].includes(arm))throw Error('unknown_arm');
  const at=Date.parse(atISO),events=raw,committed=events.filter(adopted),active=committed.filter(e=>eligible(e,at)&&!e.unresolved);
  const unresolved=events.filter(e=>e.commitment==='unresolved'||adopted(e)&&e.unresolved).map(e=>record(e,e.claims,e.scope,'unresolved'));
  if(arm!=='T') {
    const groups=new Map();for(const e of active){const k=key(e);if(!groups.has(k))groups.set(k,[]);groups.get(k).push(e);}
    const heads=[...groups.values()].map(list=>[...list].sort(arm==='U'?effectiveOrder:orderEvents).at(-1));
    const current=heads.map(e=>record(e,e.claims,e.scope,live(e,at)&&e.change_type!=='expiry'?'active':'no_active_decision'));
    const headIds=new Set(heads.map(e=>e.event_id));
    // O destroys replaced queryable versions, including their evidence. Expired heads never fall back.
    const history=arm==='O'?[]:committed.filter(e=>!headIds.has(e.event_id)||intervalEnd(e)<=at).map(e=>record(e,e.claims,e.scope,intervalEnd(e)<=at?'expired':'historical'));
    return {arm,at:atISO,current:[...current,...unresolved],history,pending:committed.filter(e=>!eligible(e,at)).map(e=>record(e)),events:arm==='O'?undefined:events};
  }
  // Versions are immutable maps per audience cell and field. Tombstones prevent fallback.
  const grid=new Map(), snapshots=new Map(),closed=new Map();
  const address=(e,c)=>canonical([normalize(e.subject),normalize(e.predicate),c]);
  for(const e of [...active].sort(effectiveOrder)) {
    if(e.change_type==='unchanged')continue;
    const predecessors=e.targets.map(id=>snapshots.get(id)).filter(Boolean), before=[];
    for(const c of cells(e.scope)) {
      const k=address(e,c),existing=grid.get(k),fields=new Map(existing?.fields??[]);
      const affected=predecessors.filter(p=>p.cells.has(canonical(c)));
      const entire=e.replacement_extent==='entire_predecessor';
      // A predecessor snapshot owns inherited fields too. Clear only fields
      // still carrying that snapshot's provenance; independent later writes survive.
      const selectedField=(field,value)=>affected.some(p=>p.cells.get(canonical(c)).fields.get(field)?.event.event_id===value.event.event_id);
      if(e.change_type==='expiry') {
        for(const [field,value]of fields)if(!e.targets.length||selectedField(field,value))fields.delete(field);
      } else {
        if(entire&&e.change_type!=='initial')for(const [field,value]of fields)if(selectedField(field,value))fields.delete(field);
        // Patches inherit unspecified fields and provenance from their named predecessor in this cell.
        if(!entire&&affected.length)for(const p of affected)for(const [field,value]of p.cells.get(canonical(c)).fields)if(!fields.has(field))fields.set(field,value);
        if(e.change_type==='initial')fields.clear();
        for(const field of e.field_mask)fields.delete(field);
        for(const assignment of e.claims)fields.set(assignment.field,{value:assignment.value,event:e,support:[e]});
      }
      const cell={cell:c,fields,event:e};grid.set(k,cell);before.push(cell);
    }
    snapshots.set(e.event_id,{event:e,cells:new Map(before.map(c=>[canonical(c.cell),{...c,fields:new Map(c.fields)}]))});
    for(const id of e.targets)closed.set(id,e.change_type==='correction'?'erroneous':e.change_type==='expiry'?'expired':'previously_adopted');
  }
  const group=new Map();
  for(const {cell,fields,event}of grid.values()) {
    const liveFields=[...fields].filter(([,v])=>intervalEnd(v.event)>at);
    const support=[...new Map([...liveFields.flatMap(([,v])=>v.support),event].map(e=>[e.event_id,e])).values()].sort(orderEvents);
    const assignments=liveFields.map(([field,v])=>({field,value:v.value})).sort((a,b)=>compare(a.field,b.field));
    const identity=canonical([event.subject,event.predicate,assignments,event.effective_interval,support.map(e=>e.event_id)]);
    if(!group.has(identity))group.set(identity,{event,assignments,support,cells:[]});group.get(identity).cells.push(cell);
  }
  const current=[...group.values()].map(g=>record(g.event,g.assignments,scopeOf(g.cells),g.assignments.length?'active':'no_active_decision',g.support));
  current.sort((a,b)=>compare(canonical(cells(a.scope)[0]),canonical(cells(b.scope)[0])));
  const history=[];
  for(const e of committed) {
    if(!eligible(e,at))continue;
    const status=closed.get(e.event_id)??(intervalEnd(e)<=at?'expired':null);if(!status)continue;
    const snap=snapshots.get(e.event_id);
    if(!snap){history.push(record(e,e.claims,e.scope,status));continue;}
    const groups=new Map();
    for(const c of snap.cells.values()) {
      const fields=[...c.fields].map(([field,v])=>({field,value:v.value})).sort((a,b)=>compare(a.field,b.field));
      const support=[...new Map([...c.fields.values()].flatMap(v=>v.support).map(x=>[x.event_id,x])).values()].sort(orderEvents),k=canonical([fields,support.map(x=>x.event_id)]);
      if(!groups.has(k))groups.set(k,{fields,support,cells:[]});groups.get(k).cells.push(c.cell);
    }
    for(const g of groups.values())history.push(record(e,g.fields,scopeOf(g.cells),status,g.support));
  }
  return {arm,at:atISO,current:[...current,...unresolved],history,pending:committed.filter(e=>!eligible(e,at)).map(e=>record(e)),events};
}
export function ingestionLosses(raw,atISO,{linkedEvents}={}) {
  const linked=linkedEvents??resolveLinks(raw.filter(e=>Date.parse(e.observed_at)<=Date.parse(atISO)));
  return linked.map((e,i)=>{const prior=linked.slice(0,i),anchors=e.predecessor_anchors.map(a=>{
    const matches=prior.filter(p=>p.source_turns.includes(a.source_turn)&&normalize(p.subject)===normalize(a.subject)&&normalize(p.predicate)===normalize(a.predicate));
    const p=matches.length===1?matches[0]:null;
    return {source_turn:a.source_turn,record_name:a.record_name,missing:matches.length===0,nonunique:matches.length>1,
      incompatible:p?!adopted(p)||p.unresolved||!cells(p.scope).some(c=>cells(e.scope).some(d=>canonical(c)===canonical(d))):null,
      historical:p?prior.some(z=>!z.unresolved&&adopted(z)&&['correction','reversal','expiry'].includes(z.change_type)&&z.replacement_extent==='entire_predecessor'&&z.targets.includes(p.event_id)&&intervalStart(z)<=Date.parse(e.observed_at)):null};
  });return {event:e.event_id,source_turns:e.source_turns,anchors,link_errors:e.link_errors,
    commitment_filtered:e.commitment!=='adopted'&&e.commitment!=='unresolved',unresolved_extent:e.replacement_extent==='unresolved',
    outcome:e.commitment==='unresolved'||adopted(e)&&e.unresolved?'unresolved_record':adopted(e)?'retained':'commitment_filter',at:atISO};});
}
export function materialize(arm,raw,atISO,{linkedEvents}={}) {
  const isContext=e=>e.payload?.type==='context'||!!e.context;
  const common=linkedEvents??resolveLinks(raw.filter(e=>Date.parse(e.observed_at)<=Date.parse(atISO)));
  const slots=common.filter(e=>!isContext(e)),linked=common.filter(isContext);
  const state=materializeSlots(arm,slots,atISO),at=Date.parse(atISO),eligibleContext=linked.filter(e=>adopted(e)&&eligible(e,at)&&!e.unresolved);
  const groups=new Map();for(const e of eligibleContext){const k=key(e);if(!groups.has(k))groups.set(k,[]);groups.get(k).push(e);}
  const heads=[...groups.values()].map(es=>es.sort(arm==='U'?effectiveOrder:orderEvents).at(-1)),headIds=new Set(heads.map(e=>e.event_id));
  state.current.push(...heads.map(e=>record(e,[],e.scope,live(e,at)?'active':'no_active_decision')),
    ...linked.filter(e=>e.commitment==='unresolved'||adopted(e)&&e.unresolved).map(e=>record(e,[],e.scope,'unresolved')));
  if(arm!=='O')state.history.push(...eligibleContext.filter(e=>!headIds.has(e.event_id)||!live(e,at)).map(e=>record(e,[],e.scope,live(e,at)?'historical':'expired')));
  state.pending.push(...linked.filter(e=>adopted(e)&&!eligible(e,at)).map(e=>record(e,[],e.scope,'pending')));
  if(arm!=='O')state.events=common;
  state.linkDecisions=common.map(e=>({event:e.event_id,targets:e.targets,unresolved:e.unresolved,link_errors:e.link_errors}));
  state.ingestionLosses=ingestionLosses(raw,atISO,{linkedEvents:common}).map(row=>{
    const materializedViews=['current','history','pending'].flatMap(view=>state[view].filter(r=>r.id===row.event).map(r=>({view,status:r.status})));
    const outcome=materializedViews.some(r=>r.status==='unresolved')?'unresolved_record':materializedViews.length?'retained':row.commitment_filtered?'commitment_filter':'not_materialized';
    return {...row,arm,eligibility_outcome:row.outcome,outcome,materializedViews};
  });return state;
}
export function compactSlots(fields) {
  return Object.fromEntries(fields.map(({field,value})=>[field==='value'?'route':field,value.type==='Text'?value.text:value.type==='Boolean'?value.value:value.type==='Quantity'?{decimal:value.decimal,unit:value.unit}:value]));
}
// Quotes appear once, as receipt assembly units. Bodies index assignments/context
// and public state metadata only; provenance offsets never enter reader bodies.
export function serializeRecord(r,aliases) {
  const body={record:aliases.id(r.id),subject:r.subject,predicate:r.predicate,kind:r.context?'context':'slots',
    ...(r.context?{}:{slots:compactSlots(r.fields)}),scope:r.scope,valid:r.valid,status:r.status,
    change_type:r.change_type,commitment:r.commitment,predecessors:r.predecessors?.map(id=>aliases.id(id)),
    sources:[...new Set(r.receipts.map(q=>q.turn_id))]};
  // Context text is itself its admitted quotation; carry its source association
  // in a receipt. The receipt is an alias of body only when actually delivered.
  for(const k of Object.keys(body))if(body[k]===undefined||Array.isArray(body[k])&&!body[k].length)delete body[k];
  const contextQuote=r.context?.anchors?.find(q=>q.quote===r.context.text);
  const header=canonical(body),bodyText=header+(contextQuote?'\n'+contextQuote.quote:'');
  const receipts=[...new Map(r.receipts.filter(q=>!contextQuote||canonical([q.turn_id,q.start,q.end])!==canonical([contextQuote.turn_id,contextQuote.start,contextQuote.end])).map(q=>[canonical([q.turn_id,q.start,q.end]),q])).values()];
  return {id:aliases.id(r.id)+':'+canonical(r.scope),body:bodyText,
    ...(contextQuote?{bodySegments:[{origin:'research-format',start:0,text:header+'\n'},{origin:contextQuote.turn_id,start:contextQuote.start,text:contextQuote.quote}]}:{}),
    receipts:receipts.map(q=>({text:q.quote,origin:q.turn_id,start:q.start,normalize:false,truncate:null}))};
}
const STOP=new Set(('a an and are as at be been being but by can could did do does doing for from had has have he her hers him his how i if in into is it its me my no nor not of on or our ours she so than that the their theirs them then there these they this those to too us was we were what when where which who why will with would you your yours').split(' '));
export function tokenizeT1(text) {
  const tokens=[];let run='',prior;
  const flush=()=>{if(prior){const chars=[...run];if(chars.length===1)tokens.push(run);else for(let i=0;i<chars.length-1;i++)tokens.push(chars[i]+chars[i+1]);}else if(run&&!STOP.has(run))tokens.push(run);run='';};
  for(const char of text.normalize('NFKC').toLowerCase()){const han=/\p{Script=Han}/u.test(char);if(!/[\p{L}\p{N}]/u.test(char)){flush();prior=undefined;continue;}if(run&&han!==prior)flush();run+=char;prior=han;}flush();return tokens;
}
export function bm25(records,query) {
  const docs=records.map(r=>{const terms=tokenizeT1(r.body),tf=new Map();for(const t of terms)tf.set(t,(tf.get(t)??0)+1);return {r,tf,length:terms.length};}),df=new Map();
  for(const d of docs)for(const t of d.tf.keys())df.set(t,(df.get(t)??0)+1);
  const average=docs.reduce((n,d)=>n+d.length,0)/(docs.length||1);
  return docs.flatMap(d=>{let score=0;for(const t of new Set(tokenizeT1(query))){const f=d.tf.get(t)??0;if(f)score+=Math.log(1+(docs.length-df.get(t)+.5)/(df.get(t)+.5))*f*2.2/(f+1.2*(.25+.75*d.length/average));}return score?[{id:d.r.id,score}]:[];}).sort((a,b)=>b.score-a.score||compare(a.id,b.id)).slice(0,24);
}
export function literalQuery(header,language) {
  const prefix=`${header.subject} ${header.predicate} ${header.scope_text}`;
  const en=prefix+' decision correction change reason',zh=prefix+' 決定 修正 變更 原因';
  return language==='en'?en:language==='zh-Hant'?zh:en+'\n'+zh;
}
export async function retrieve(state,{query,embedder,counter,controls=[],aliases=sourceOrderAliases(state.events??[])}) {
  const delivered=[],blocks={},diagnostics={};
  for(const intent of ['current','history']) {
    const records=[...state[intent].map(r=>serializeRecord(r,aliases)),...controls.filter(r=>r[intent]).map(r=>({id:r.id,body:r.body,receipts:r.receipts??[]}))];
    const lexical=bm25(records,query),semantic=[];
    if(records.length) {
      const vectors=[];for(let i=0;i<records.length;i+=64)vectors.push(...await embedder.embed(records.slice(i,i+64).map(r=>r.body)));
      const [q]=await embedder.embed([query]);
      for(let i=0;i<records.length;i++)semantic.push({id:records[i].id,score:vectors[i].reduce((sum,x,j)=>sum+x*q[j],0)});
      semantic.sort((a,b)=>b.score-a.score||compare(a.id,b.id));semantic.splice(24);
    }
    const fused=new Map();for(const channel of [lexical,semantic])channel.forEach((r,i)=>fused.set(r.id,(fused.get(r.id)??0)+.5/(10+i+1)));
    const dropped=[];const ranked=[...fused].sort((a,b)=>b[1]-a[1]||compare(a[0],b[0])).slice(0,12),selected=[];
    const wire=items=>canonical({intent,items});
    for(const [id]of ranked) {
      const r=records.find(r=>r.id===id),candidate={body:r.body,sources:r.receipts.map((q,index)=>({index,source_turn:q.origin,excerpt:q.text}))};
      if(counter.countTokens(wire([...selected,candidate]))>2000){dropped.push({id,reason:'whole_record_budget',tokens:counter.countTokens(wire([candidate]))});continue;}
      const item=selected.length;selected.push(candidate);
      delivered.push({...unit(intent,item,'body',null,r.body,`research:${r.id}`,0),...(r.bodySegments?{segments:r.bodySegments}:{})});
      r.receipts.forEach((q,index)=>delivered.push(unit(intent,item,'receipt',index,q.text,q.origin,q.start,q.normalize,q.truncate)));
    }
    blocks[intent]=wire(selected);diagnostics[intent]={lexical,semantic,fused:ranked,tokens:counter.countTokens(blocks[intent]),selected:selected.length,dropped};
  }
  return {blocks,delivered,diagnostics};
}
export function unit(intent,item,kind,source,text,origin,start=0,normalize=false,truncate=null) {return {intent,item,unit:kind,source,aliases:[],segments:[{origin,start,text}],normalize,truncate};}
