import { answerSchema, validate } from '../scorer/schema.mjs';
import { cells, fail, DIMENSIONS } from './common.mjs';
export { answerSchema };
import {preflightExtractionSchema} from './preflight-a4-schema.mjs';
import {canonicalPublicName} from '../generator/slots.mjs';
import {PUBLIC_CONTRACT} from './contract-projection-a4.mjs';
export const EXTRACTION_VERSION='hr3-extraction-a4-audit-v2';
export const extractionSchema=preflightExtractionSchema;
// Responses strict JSON schema uses anyOf rather than the algebraic oneOf.
export function providerSchema(schema) {
  const out=JSON.parse(JSON.stringify(schema, (key,value)=>key==='$schema'||key==='title'?undefined:value));
  function visit(v) {if(!v||typeof v!=='object')return;if(v.oneOf){v.anyOf=v.oneOf;delete v.oneOf;}if(v.enum&&!v.type)v.type=typeof v.enum[0];if(Object.hasOwn(v,'const')&&!v.type)v.type=v.const===null?'null':Number.isInteger(v.const)?'integer':typeof v.const;for(const child of Object.values(v))visit(child);}
  visit(out);
  // Annotate plain nodes only: OpenAI strict mode rejects `type` beside `$ref`
  // and accepts `anyOf` unions without a top-level `type`.
  function types(node) {
    if(node.type)return Array.isArray(node.type)?node.type:[node.type];
    if(node.$ref)return types(out.$defs[node.$ref.split('/').at(-1)]);
    return [...new Set((node.anyOf??[]).flatMap(types))];
  }
  function annotate(node) {
    if(!node.type&&!node.$ref&&!node.anyOf){const inferred=types(node);if(!inferred.length)fail('provider_schema_type');node.type=inferred.length===1?inferred[0]:inferred;}
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
// matches for extraction anchors only. The reader/scorer retains its separate
// ambiguity check when overlapping and non-overlapping interpretations differ.
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
  const strip=q=>{if(q&&typeof q==='object'){delete q.start;delete q.end;}};
  for(const e of copy?.events??[]) {
    for(const q of [...(e?.source_quotes??[]),...(e?.reason_quotes??[]),...(e?.payload?.anchors??[])])strip(q);
    for(const slot of ['route','approval','cap'])for(const q of e?.payload?.[slot]?.anchors??[])strip(q);
  }
  return copy;
}
const legacy={route:'value',approval:'approval',cap:'cap'};
function slotValue(slot,value) {
  const expected={route:'Text',approval:'Boolean',cap:'Quantity'};
  if(value.type!==expected[slot])return null;
  if(slot==='route')return {...value,text:value.text.normalize('NFKC').replace(/\s+/gu,' ').trim()};
  if(slot==='approval')return value;
  const unit=PUBLIC_CONTRACT.values.units.find(u=>u.alias===value.unit.normalize('NFKC').trim());
  if(!unit)return null;
  // Public unit factors have denominator one; exact decimal scaling uses BigInt.
  const match=/^([+-]?)([0-9]*)(?:\.([0-9]*))?$/.exec(value.decimal);
  if(!match||!match[2]&&!match[3])return null;
  const scale=(match[3]??'').length,n=BigInt((match[2]||'0')+(match[3]??''))*BigInt(unit.numerator);
  if(BigInt(unit.denominator)!==1n)return null;
  const digits=n.toString().padStart(scale+1,'0');
  const decimal=(match[1]==='-'&&n!==0n?'-':'')+(scale?digits.slice(0,-scale)+'.'+digits.slice(-scale):digits);
  return {type:'Quantity',decimal,unit:unit.canonical};
}
export function validateExtraction(value,input) {
  let raw;try {raw=withoutOffsets(value);}catch {fail('malformed_extraction');}
  if(validate(extractionSchema,raw).length)fail('malformed_extraction');
  const counts=new Map(),turns=new Map(input.turns.map(t=>[t.turn_id,t.text]));
  for(const e of raw.events)counts.set(e.event_id,(counts.get(e.event_id)??0)+1);
  const events=[],rejected=[],assignments=[],quotations=[];
  const totals={rawAssignments:0,admittedAssignments:0,excludedAssignments:0,rawQuotations:0,admittedQuotations:0,excludedQuotations:0};
  for(const [index,e] of raw.events.entries()) {
    const reasons=new Set();
    for(const [field,allowed] of Object.entries({kind:['fact','preference','decision','instruction','context'],commitment:['adopted','proposed','quoted','rejected','unresolved'],change_type:['initial','correction','reversal','refinement','scope_change','expiry','unchanged'],replacement_extent:['entire_predecessor','partial','unresolved']}))if(!allowed.includes(e[field]))reasons.add('invalid_'+field);
    if(!e.subject.normalize('NFKC').trim()||!e.predicate.normalize('NFKC').trim()||!e.event_id.trim()||counts.get(e.event_id)>1||e.observed_at!==input.observed_at||!e.source_turns.length||e.source_turns.some(t=>!turns.has(t))||!cells(e.scope).length)reasons.add('invalid_extraction_provenance');
    for(const clause of e.scope.any)for(const atom of clause.all)if(atom.values.some(v=>!DIMENSIONS[atom.field]?.includes(v)))reasons.add('invalid_extraction_scope');
    for(const boundary of Object.values(e.effective_interval))if(boundary!==null&&(!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(boundary)||!Number.isFinite(Date.parse(boundary))||new Date(boundary).toISOString()!==boundary))reasons.add('invalid_extraction_interval');
    if(e.effective_interval.from&&e.effective_interval.to&&Date.parse(e.effective_interval.from)>=Date.parse(e.effective_interval.to))reasons.add('invalid_extraction_interval');
    const anchor=q=>e.source_turns.includes(q.turn_id)?anchorQuote(q,turns):null;
    const core=e.source_quotes.map(anchor);
    if(!core.length||core.some(q=>!q))reasons.add('invalid_event_anchor');
    const claims=[],factQuotes=[],admittedSlots={route:null,approval:null,cap:null};
    if(e.payload.type==='slots')for(const slot of ['route','approval','cap']) {
      const supplied=e.payload[slot];if(supplied===null)continue;
      totals.rawAssignments++;
      const errors=[],anchors=supplied.anchors.map(anchor),converted=slotValue(slot,supplied.value);
      if(!converted)errors.push('incompatible_slot_value');
      if(!anchors.length||anchors.some(q=>!q))errors.push('invalid_assignment_anchor');
      if(reasons.size)errors.push('invalid_event_core');
      const admitted=!errors.length;totals[admitted?'admittedAssignments':'excludedAssignments']++;
      assignments.push({index,event_id:e.event_id,slot,admitted,reasons:errors});
      if(admitted){claims.push({field:legacy[slot],value:converted});factQuotes.push(...anchors);admittedSlots[slot]={value:converted,anchors};}
    }
    let context=null;
    if(e.payload.type==='context') {
      const anchors=e.payload.anchors.map(anchor);
      // Extracted text must itself be an exact anchored quotation, never a raw-source harvest.
      if(!e.payload.text||!anchors.length||anchors.some(q=>!q)||!anchors.some(q=>q?.quote===e.payload.text))reasons.add('invalid_context_anchor');
      else {context={text:e.payload.text,anchors};factQuotes.push(...anchors);}
    } else if(!claims.length&&e.change_type!=='expiry')reasons.add('no_admitted_assignment');
    const reason_quotes=[];
    for(const [quoteIndex,q] of e.reason_quotes.entries()) {
      totals.rawQuotations++;const anchored=anchor(q),errors=[];
      if(!anchored)errors.push('invalid_reason_anchor');if(reasons.size)errors.push('invalid_event_core');
      const admitted=!errors.length;totals[admitted?'admittedQuotations':'excludedQuotations']++;
      quotations.push({index,event_id:e.event_id,quoteIndex,admitted,reasons:errors});
      if(admitted)reason_quotes.push(anchored);
    }
    if(reasons.size)rejected.push({index,event_id:e.event_id,raw_event_id:e.event_id,reasons:[...reasons].sort()});
    else {
      const {payload,...metadata}=e;
      const unique=qs=>[...new Map(qs.map(q=>[JSON.stringify([q.turn_id,q.start,q.end]),q])).values()];
      events.push({...metadata,subject:canonicalPublicName(e.subject,'subjects'),predicate:canonicalPublicName(e.predicate,'predicates'),
        predecessor_anchors:e.predecessor_anchors.map(a=>({...a,subject:canonicalPublicName(a.subject,'subjects'),predicate:canonicalPublicName(a.predicate,'predicates')})),
        payload:context?{type:'context',...context}:{type:'slots',...admittedSlots},context,claims,field_mask:claims.map(c=>c.field),
        source_quotes:unique([...core,...factQuotes,...reason_quotes]),reason_quotes});
    }
  }
  const diagnostics={version:EXTRACTION_VERSION,stage:'extraction',armIndependent:true,totalEvents:raw.events.length,validEvents:events.length,rejectedEvents:rejected.length,...totals,
    reasons:Object.fromEntries([...new Set(rejected.flatMap(e=>e.reasons))].sort().map(r=>[r,rejected.filter(e=>e.reasons.includes(r)).length])),rejected,assignments,quotations};
  return {events,diagnostics};
}
