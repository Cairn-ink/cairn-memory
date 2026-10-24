import { answerSchema, validate } from '../scorer/schema.mjs';
import { cells, fail, DIMENSIONS } from './common.mjs';
export { answerSchema };
const s={type:'string'}, arr=items=>({type:'array',items}), obj=properties=>({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
const en=(...values)=>({type:'string',enum:values});
const span=obj({turn_id:s,quote:s,occurrence:{type:'integer',minimum:1}});
const defs=structuredClone(answerSchema.$defs);
delete defs.DeliveredUnit; delete defs.GoldClaim;
export const extractionSchema={type:'object',properties:{events:arr(obj({
  event_id:s,source_turns:arr(s),observed_at:s,kind:en('fact','preference','decision','instruction','context'),commitment:en('adopted','proposed','quoted','rejected','unresolved'),
  change_type:en('initial','correction','reversal','refinement','scope_change','expiry','unchanged'),subject:s,predicate:s,
  claims:arr(obj({field:s,value:{$ref:'#/$defs/Value'}})),scope:{$ref:'#/$defs/Scope'},effective_interval:{$ref:'#/$defs/Interval'},
  predecessor_anchors:arr(obj({source_turn:s,record_name:s,subject:s,predicate:s})),replacement_extent:en('entire_predecessor','partial','unresolved'),field_mask:arr(s),
  reason_nodes:arr(obj({id:s,claim:{$ref:'#/$defs/Claim'}})),reason_edges:arr(obj({from:s,to:s,source_quotes:arr(span)})),source_quotes:arr(span)
}))},required:['events'],additionalProperties:false,$defs:defs};
// Responses strict JSON schema uses anyOf rather than the algebraic oneOf.
export function providerSchema(schema) {
  const out=JSON.parse(JSON.stringify(schema, (key,value)=>key==='$schema'||key==='title'?undefined:value));
  function visit(v) {if(!v||typeof v!=='object')return;if(v.oneOf){v.anyOf=v.oneOf;delete v.oneOf;}if(v.enum&&!v.type)v.type=typeof v.enum[0];if(Object.hasOwn(v,'const')&&!v.type)v.type=v.const===null?'null':Number.isInteger(v.const)?'integer':typeof v.const;for(const child of Object.values(v))visit(child);}
  visit(out);
  // Annotate union and reference nodes too, without changing their alternatives.
  function types(node) {
    if(node.type)return Array.isArray(node.type)?node.type:[node.type];
    if(node.$ref)return types(out.$defs[node.$ref.split('/').at(-1)]);
    return [...new Set((node.anyOf??[]).flatMap(types))];
  }
  function annotate(node) {
    if(!node.type){const inferred=types(node);if(!inferred.length)fail('provider_schema_type');node.type=inferred.length===1?inferred[0]:inferred;}
    for(const child of Object.values(node.properties??{}))annotate(child);
    if(node.items)annotate(node.items);
    for(const child of node.anyOf??[])annotate(child);
    for(const child of Object.values(node.$defs??{}))annotate(child);
  }
  annotate(out);
  const used=new Set();function refs(v){if(!v||typeof v!=='object')return;if(v.$ref){const name=v.$ref.split('/').at(-1);if(!used.has(name)){used.add(name);refs(out.$defs[name]);}}for(const [k,child]of Object.entries(v))if(k!=='$defs')refs(child);}
  refs(out);if(out.$defs)out.$defs=Object.fromEntries(Object.entries(out.$defs).filter(([k])=>used.has(k)));return out;
}

// indexOf and string.length use UTF-16 code units. Count overlapping exact
// matches, in the same way as the scorer's occurrence-addressed citations.
export function anchorQuote(q,turns) {
  const text=turns.get(q.turn_id);
  if(typeof text!=='string'||!q.quote||!Number.isSafeInteger(q.occurrence)||q.occurrence<1)return null;
  let start=-1;
  for(let n=0;n<q.occurrence;n++){start=text.indexOf(q.quote,start+1);if(start<0)return null;}
  return {turn_id:q.turn_id,quote:q.quote,occurrence:q.occurrence,start,end:start+q.quote.length};
}

// Offset extras alone are explicitly ignored under A-3. No other schema repair
// or legacy occurrence default is permitted in live validation.
function withoutOffsets(value) {
  const copy=structuredClone(value);
  if(Array.isArray(copy?.events))for(const e of copy.events) {
    const quotes=[...(Array.isArray(e?.source_quotes)?e.source_quotes:[]),
      ...(Array.isArray(e?.reason_edges)?e.reason_edges.flatMap(x=>Array.isArray(x?.source_quotes)?x.source_quotes:[]):[])];
    for(const q of quotes)if(q&&typeof q==='object'){delete q.start;delete q.end;}
  }
  return copy;
}
export function validateExtraction(value,input) {
  const raw=withoutOffsets(value);
  if(validate(extractionSchema,raw).length)fail('malformed_extraction');
  const counts=new Map(),turns=new Map(input.turns.map(t=>[t.turn_id,t.text]));
  for(const e of raw.events)counts.set(e.event_id,(counts.get(e.event_id)??0)+1);
  const events=[],rejected=[];
  for(const [index,e] of raw.events.entries()) {
    const reasons=new Set();
    if(!e.event_id||counts.get(e.event_id)>1||e.observed_at!==input.observed_at||!e.source_turns.length||e.source_turns.some(t=>!turns.has(t))||!cells(e.scope).length)reasons.add('invalid_extraction_provenance');
    for(const clause of e.scope.any)for(const atom of clause.all)if(atom.values.some(v=>!DIMENSIONS[atom.field].includes(v)))reasons.add('invalid_extraction_scope');
    for(const boundary of Object.values(e.effective_interval))if(boundary!==null&&(!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(boundary)||!Number.isFinite(Date.parse(boundary))))reasons.add('invalid_extraction_interval');
    if(e.effective_interval.from&&e.effective_interval.to&&Date.parse(e.effective_interval.from)>=Date.parse(e.effective_interval.to))reasons.add('invalid_extraction_interval');
    if(new Set(e.field_mask).size!==e.field_mask.length||e.claims.some(c=>!e.field_mask.includes(c.field))||new Set(e.claims.map(c=>c.field)).size!==e.claims.length)reasons.add('invalid_field_mask');
    const nodeIds=new Set(e.reason_nodes.map(n=>n.id));
    for(const edge of e.reason_edges)if(!nodeIds.has(edge.from)||!nodeIds.has(edge.to))reasons.add('dangling_reason');
    const anchored=e.source_quotes.map(q=>anchorQuote(q,turns));
    const edges=e.reason_edges.map(edge=>({...edge,source_quotes:edge.source_quotes.map(q=>anchorQuote(q,turns))}));
    const invalidQuoteEdges=edges.flatMap((edge,i)=>edge.source_quotes.some(q=>!q)?[i]:[]);
    if(anchored.some(q=>!q)||invalidQuoteEdges.length)reasons.add('invalid_extraction_quote');
    if(reasons.size)rejected.push({index,event_id:e.event_id,reasons:[...reasons].sort(),invalidQuoteEdges});
    else events.push({...e,source_quotes:anchored,reason_edges:edges});
  }
  const diagnostics={stage:'extraction',armIndependent:true,totalEvents:raw.events.length,validEvents:events.length,rejectedEvents:rejected.length,
    reasons:Object.fromEntries([...new Set(rejected.flatMap(e=>e.reasons))].sort().map(r=>[r,rejected.filter(e=>e.reasons.includes(r)).length])),rejected};
  return {events,diagnostics};
}
