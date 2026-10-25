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
function evidence(events) {return events.flatMap(e=>e.source_quotes.map(q=>({...q,event_id:e.event_id})));}
function record(e,fields=e.claims,scope=e.scope,status='active',support=[e]) {
  return {id:e.event_id,subject:e.subject,predicate:e.predicate,scope,fields,valid:e.effective_interval,status,change_type:e.change_type,commitment:e.commitment,unresolved:e.unresolved,link_errors:e.link_errors,predecessors:e.targets,reason_nodes:e.reason_nodes,reason_edges:e.reason_edges,supporting_events:support.map(x=>x.event_id),receipts:evidence(support)};
}
export function materialize(arm,raw,atISO) {
  if(!['T','U','O'].includes(arm))throw Error('unknown_arm');
  const at=Date.parse(atISO),events=resolveLinks(raw.filter(e=>Date.parse(e.observed_at)<=at)),committed=events.filter(adopted),active=committed.filter(e=>eligible(e,at)&&!e.unresolved);
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
      if(e.change_type==='expiry') {
        for(const [field,value]of fields)if(!e.targets.length||e.targets.includes(value.event.event_id)||value.support.some(x=>e.targets.includes(x.event_id)))fields.delete(field);
      } else {
        if(entire&&e.change_type!=='initial')for(const [field,value]of fields)if(affected.length&&value.support.some(x=>e.targets.includes(x.event_id)))fields.delete(field);
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
// Frozen serializer: body indexes interpretations; receipts are separate assembly units.
export function serializeRecord(r,aliases) {
  const {receipts,...record}=r;
  const body={...record,id:aliases.id(r.id),predecessors:r.predecessors?.map(id=>aliases.id(id)),supporting_events:r.supporting_events?.map(id=>aliases.id(id)),
    reason_nodes:r.reason_nodes?.map(n=>({...n,id:aliases.node(r.id,n.id)})),reason_edges:r.reason_edges?.map(e=>({...e,from:aliases.node(r.id,e.from),to:aliases.node(r.id,e.to)}))};
  for(const k of Object.keys(body))if(body[k]===false||body[k]===undefined||Array.isArray(body[k])&&!body[k].length)delete body[k];
  return {id:aliases.id(r.id)+':'+canonical(r.scope),body:canonical(body),receipts:receipts.map(q=>({text:q.quote,origin:q.turn_id,start:q.start,normalize:false,truncate:null}))};
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
    const ranked=[...fused].sort((a,b)=>b[1]-a[1]||compare(a[0],b[0])).slice(0,12),selected=[];
    const wire=items=>canonical({intent,items});
    for(const [id]of ranked) {
      const r=records.find(r=>r.id===id),candidate={body:r.body,sources:r.receipts.map((q,index)=>({index,excerpt:q.text}))};
      if(counter.countTokens(wire([...selected,candidate]))>2000)continue;
      const item=selected.length;selected.push(candidate);
      delivered.push(unit(intent,item,'body',null,r.body,`research:${r.id}`,0));
      r.receipts.forEach((q,index)=>delivered.push(unit(intent,item,'receipt',index,q.text,q.origin,q.start,q.normalize,q.truncate)));
    }
    blocks[intent]=wire(selected);diagnostics[intent]={lexical,semantic,fused:ranked,tokens:counter.countTokens(blocks[intent]),selected:selected.length};
  }
  return {blocks,delivered,diagnostics};
}
export function unit(intent,item,kind,source,text,origin,start=0,normalize=false,truncate=null) {return {intent,item,unit:kind,source,aliases:[],segments:[{origin,start,text}],normalize,truncate};}
