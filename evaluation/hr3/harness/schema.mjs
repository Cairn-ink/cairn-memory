import { answerSchema, validate } from '../scorer/schema.mjs';
import { cells, fail, DIMENSIONS } from './common.mjs';
export { answerSchema };
const s={type:'string'}, arr=items=>({type:'array',items}), obj=properties=>({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
const en=(...values)=>({type:'string',enum:values});
const span=obj({turn_id:s,start:{type:'integer',minimum:0},end:{type:'integer',minimum:1},quote:s});
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
  function visit(v) {if(!v||typeof v!=='object')return;if(v.oneOf){v.anyOf=v.oneOf;delete v.oneOf;}if(v.enum&&!v.type)v.type=typeof v.enum[0];for(const child of Object.values(v))visit(child);}
  visit(out);
  const used=new Set();function refs(v){if(!v||typeof v!=='object')return;if(v.$ref){const name=v.$ref.split('/').at(-1);if(!used.has(name)){used.add(name);refs(out.$defs[name]);}}for(const [k,child]of Object.entries(v))if(k!=='$defs')refs(child);}
  refs(out);if(out.$defs)out.$defs=Object.fromEntries(Object.entries(out.$defs).filter(([k])=>used.has(k)));return out;
}
export function validateExtraction(value,input) {
  if(validate(extractionSchema,value).length)fail('malformed_extraction');
  const ids=new Set(), turns=new Map(input.turns.map(t=>[t.turn_id,t.text]));
  for(const e of value.events) {
    if(!e.event_id||ids.has(e.event_id)||e.observed_at!==input.observed_at||!e.source_turns.length||e.source_turns.some(t=>!turns.has(t))||!cells(e.scope).length)fail('invalid_extraction_provenance');
    ids.add(e.event_id);
    for(const clause of e.scope.any)for(const atom of clause.all)if(atom.values.some(v=>!DIMENSIONS[atom.field].includes(v)))fail('invalid_extraction_scope');
    for(const boundary of Object.values(e.effective_interval))if(boundary!==null&&(!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(boundary)||!Number.isFinite(Date.parse(boundary))))fail('invalid_extraction_interval');
    if(e.effective_interval.from&&e.effective_interval.to&&Date.parse(e.effective_interval.from)>=Date.parse(e.effective_interval.to))fail('invalid_extraction_interval');
    if(new Set(e.field_mask).size!==e.field_mask.length||e.claims.some(c=>!e.field_mask.includes(c.field))||new Set(e.claims.map(c=>c.field)).size!==e.claims.length)fail('invalid_field_mask');
    const nodeIds=new Set(e.reason_nodes.map(n=>n.id));
    for(const edge of e.reason_edges)if(!nodeIds.has(edge.from)||!nodeIds.has(edge.to))fail('dangling_reason');
    for(const q of [...e.source_quotes,...e.reason_edges.flatMap(x=>x.source_quotes)])if(!turns.has(q.turn_id)||q.end<=q.start||turns.get(q.turn_id).slice(q.start,q.end)!==q.quote)fail('invalid_extraction_quote');
  }
  return value;
}
