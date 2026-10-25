// Engineering/reference construction only. Never imported by live extraction.
import assert from 'node:assert/strict';
import {canonical} from './common.mjs';
import {extractionInput} from './extraction.mjs';
import {validateExtraction} from './schema.mjs';
import {slotGold} from '../generator/slots.mjs';
export function cleanAnchor(q,input) {
 const text=input.turns.find(t=>t.turn_id===q.turn_id)?.text;
 assert.equal(text?.slice(q.start,q.start+q.quote.length),q.quote);
 let at=-1,occurrence=0;do{at=text.indexOf(q.quote,at+1);occurrence++;}while(at>=0&&at<q.start);
 assert.equal(at,q.start);return {turn_id:q.turn_id,quote:q.quote,occurrence};
}
export function extractionReference(family,ordinal) {
 const input=extractionInput(family,ordinal),turns=new Set(input.turns.map(t=>t.turn_id));
 const events=family.ast.events.filter(e=>e.source_turns.some(t=>turns.has(t))).map((event,i)=>{
  const {event_id,source_turns,observed_at,kind,commitment,change_type,subject,predicate,scope,effective_interval,predecessor_anchors,replacement_extent}=event;
  const original=event.source_quotes[0],source=input.turns.find(t=>t.turn_id===original.turn_id).text;
  let coreQuote=original.quote;
  if(event.distractor){
   const ordinal=['proposal','rejection','quotation','subject_collision','scope_date_collision','unsupported_cause'].indexOf(event.distractor);
   const clauses=coreQuote.split(/(?<=。)|(?<=\.)\s+/u).map(t=>t.trim()).filter(Boolean);
   assert.equal(clauses.length,6);assert.ok(ordinal>=0);coreQuote=clauses[ordinal];
  } else {
   const cuts=[' Confirmed condition:',' 已確認的狀況：',' No reason for',' 這次變更沒有'].map(x=>coreQuote.indexOf(x)).filter(i=>i>=0);
   if(cuts.length)coreQuote=coreQuote.slice(0,Math.min(...cuts));
  }
  const coreStart=source.indexOf(coreQuote,original.start);assert.ok(coreStart>=0);
  const anchorQuote=quote=>{const start=source.indexOf(quote,coreStart);assert.ok(start>=coreStart&&start+quote.length<=coreStart+coreQuote.length);return cleanAnchor({turn_id:original.turn_id,start,quote},input);};
  const anchors=[cleanAnchor({turn_id:original.turn_id,start:coreStart,quote:coreQuote},input)];
  const reason_quotes=[...new Map(event.reason_edges.flatMap(edge=>edge.support.flat()).map(q=>[canonical(cleanAnchor(q,input)),cleanAnchor(q,input)])).values()];
  for(const text of ['No reason for this change was stated.','這次變更沒有說明原因。']){const start=source.indexOf(text,original.start);if(!event.distractor&&start>=0)reason_quotes.push(cleanAnchor({turn_id:original.turn_id,start,quote:text},input));}
  const payload=kind==='context'?{type:'context',text:coreQuote,anchors}:{type:'slots',route:null,approval:null,cap:null};
  if(payload.type==='slots')for(const assignment of event.claims){const slot=assignment.field==='value'?'route':assignment.field;
   if(['route','approval','cap'].includes(slot)){
    const value=assignment.value;
    let quote=value.type==='Text'?value.text:value.type==='Quantity'?value.decimal:null;
    if(value.type==='Boolean')quote=/需經核准 = /.test(coreQuote)?(value.value?'是':'否'):(value.value?'true':'false');
    // Short independent assignment anchors; core anchor separately retains all
    // commitment, identity, scope/time and predecessor language for this event.
    if(value.type==='Boolean') {const m=coreQuote.match(/(?:approval required|需經核准) = [^，,。.]+/u);quote=m?.[0]??quote;}
    if(value.type==='Quantity') {const m=coreQuote.match(/(?:daily request cap|每日請求上限) = [^，,。.]+/u);quote=m?.[0]??quote;}
    payload[slot]={value,anchors:[anchorQuote(quote)]};
   }}
  const namingAnchor=name=>{for(const t of input.turns.filter(t=>source_turns.includes(t.turn_id))){let start=-1;while((start=t.text.indexOf(name,start+1))>=0){if(!/[A-Za-z0-9_-]/.test(t.text[start-1]??'')&&!/[A-Za-z0-9_-]/.test(t.text[start+name.length]??''))return cleanAnchor({turn_id:t.turn_id,start,quote:name},input);}}return null;};
  const own=event.record_name&&namingAnchor(event.record_name);
  const record_name=own?{name:event.record_name,anchor:own}:null;
  const predecessor_refs=predecessor_anchors.map(a=>{const anchor=namingAnchor(a.record_name);assert.ok(anchor,'Reference fixture must name its predecessor in the current batch');return {record_name:a.record_name,anchor};});
  return {event_id:'e'+(i+1),source_turns,observed_at,kind,commitment,change_type,subject,predicate,payload,scope,effective_interval,record_name,predecessor_refs,replacement_extent,reason_quotes,source_quotes:anchors};
 });
 const admitted=validateExtraction({events},input);assert.equal(admitted.diagnostics.rejectedEvents,0);
 return {events};
}
export function readerReference(bundle,batch,{graph='union',assertionCitations=true}={}) {
 const {family,gold,support}=bundle,checkpoint=family.checkpoints.find(c=>c.batch===batch),g=gold.checkpoints.find(c=>c.batch===batch).G_correct;
 const focal=family.ast.events.find(e=>e.source_turns.includes(checkpoint.focal_turn)&&!e.distractor);
 const publicTurns=checkpoint.requested_predecessor_turns??focal.predecessor_anchors.map(a=>a.source_turn);
 const slots=g.current.rows?g:slotGold(g,publicTurns),answer=structuredClone({current:slots.current,old:slots.old,reason:{status:slots.reason.status,support:[]}});
 const citation=(q,intent)=>{const b=family.batches.find(b=>b.turns.some(t=>t.turn_id===q.turn_id));const source=b.turns.findIndex(t=>t.turn_id===q.turn_id);
  return {intent,item:b.ordinal-1,unit:'receipt',source,quote:q.quote,occurrence:cleanAnchor(q,{turns:b.turns}).occurrence};};
 if(assertionCitations){
  const observed=family.ast.events.filter(e=>!e.distractor&&Date.parse(e.observed_at)<=Date.parse(checkpoint.at));
  for(const row of answer.current.rows){const e=observed.find(e=>canonical(e.effective_interval)===canonical(row.valid))??focal;
   row.citations=(family.change_type==='refinement'?[observed[0],e]:[e]).map(e=>citation(e.source_quotes[0],'current'));}
  for(const record of answer.old.records){const e=observed.find(e=>e.source_turns.includes(record.predecessor_turn));assert.ok(e);
   for(const row of record.rows)row.citations=(family.change_type==='refinement'?[observed[0],e]:[e]).map(e=>citation(e.source_quotes[0],'history'));}
 }
 const graphs=support.checkpoints.find(c=>c.batch===batch).acceptedGraphs,selected=graph==='union'?graphs:graphs.slice(graph,graph+1);
 answer.reason.support=[...new Map(selected.flatMap(g=>g.edges.flatMap(e=>e.support[0])).map(q=>[canonical(q),citation(q,'history')])).values()];
 return answer;
}
