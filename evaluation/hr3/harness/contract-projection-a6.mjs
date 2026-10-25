// A-4 §2 / A-6 §§2–4: self-contained, public-only prospective projections.
// Runtime and offline measurements share these exact projections. The existing
// certifying request/output gates retain all limits and continue to block calls.
import {readFileSync} from 'node:fs';
import {canonical,bytes,normalize,compare} from './common.mjs';
export const PROJECTION_A6_VERSION='hr3-contract-projection-a6-preflight-v1';
export const CONTRACT_A6=JSON.parse(readFileSync(new URL('../generator/public-contract.json',import.meta.url)));
const spellings=r=>[r.canonical,...r['zh-Hant'],...r.en,...r.mixed];
const aliases=r=>({canonical:r.canonical,aliases:[...new Set(spellings(r))].filter(x=>x!==r.canonical)});
const copy=structuredClone;

export function literalProjectionA6(operation,input) {
  if(!['extraction','reader'].includes(operation))throw Error('projection_operation');
  if(operation==='reader'&&Object.hasOwn(input,'delivered'))throw Error('reader_projection_requires_shared_public_context');
  const c=copy(CONTRACT_A6),text=normalize(canonical(input));
  const relevant=r=>spellings(r).some(n=>text.includes(normalize(n)));
  c.aliases={subjects:c.aliases.subjects.filter(relevant).map(aliases),predicates:c.aliases.predicates.filter(relevant).map(aliases),routes:c.aliases.routes};
  for(const slot of c.slots)slot.aliases=[...new Set([...slot.aliases,...spellings(CONTRACT_A6.aliases.fields.find(f=>f.canonical===slot.name))])];
  if(operation==='extraction') {
    for(const k of ['answer','historical_labels','reader'])delete c[k];
    for(const k of ['slot_states','slot_state_rule'])delete c.values[k];
    c.citations={extraction_anchor:c.citations.extraction_anchor};
    // This example teaches delivered-unit addresses, an exclusively reader
    // task. All extraction rules, all 12 bilingual extraction examples and
    // the remaining A-4 examples are retained verbatim.
    c.examples=c.examples.filter(e=>e.id!=='citation');
    for(const k of ['citation_address','inheritance_pairs','slot_recovery','causal_selection'])delete c.worked_examples[k];
  } else {
    for(const k of ['extraction','name_tokens'])delete c[k];
    delete c.citations.extraction_anchor;delete c.values.supplied_null;
    for(const slot of c.slots)delete slot.legacy_field;
    delete c.worked_examples.extraction;delete c.worked_examples.common_input;
  }
  return c;
}

// This is factorization, not summarization: even teaching identifiers, repeated
// source strings, explicit nulls and explanation prose round-trip byte-for-byte
// under canonical serialization. Research evidence is never passed here.
function eventDefaults(worked,{minimumBytes=true}={}) {
  const events=(worked.extraction??[]).flatMap(x=>(x.batches??[x]).flatMap(b=>b.expected));
  if(!events.length)return worked;
  const defaults={};
  for(const k of Object.keys(events[0])) {
    const counts=new Map();for(const e of events){const s=canonical(e[k]);counts.set(s,{value:e[k],count:(counts.get(s)?.count??0)+1});}
    // Minimize the actual bytes of this field across defaults + all overlays,
    // rather than assuming the most frequent (possibly very short) value wins.
    const cost=value=>bytes({[k]:value})+events.reduce((n,e)=>n+(canonical(e[k])===canonical(value)?0:bytes({[k]:e[k]})),0);
    const ranked=[...counts.values()].sort((a,b)=>(minimumBytes?cost(a.value)-cost(b.value):b.count-a.count)||compare(canonical(a.value),canonical(b.value)));
    defaults[k]=copy(ranked[0].value);
  }
  const result=copy(worked);result.event_defaults=defaults;
  for(const x of result.extraction)for(const b of x.batches??[x])b.expected=b.expected.map(e=>Object.fromEntries(Object.entries(e).filter(([k,v])=>canonical(v)!==canonical(defaults[k]))));
  return result;
}
const notation='Objects containing only @ denote the exact zero-based definitions entry, expanded recursively; other objects/arrays/strings are literal. In extraction teaching examples, each expected event is a shallow overlay on event_defaults: supplied null explicitly replaces, not deletes. Definitions and defaults are part of these examples, not runtime memory or case evidence.';
function repeatedDefinitions(document) {
  let current=copy(document);const definitions=[];
  for(;;) {
    const nodes=new Map();
    function visit(v){const s=canonical(v);if(bytes(s)>20){const row=nodes.get(s);nodes.set(s,{value:v,count:(row?.count??0)+1});}if(Array.isArray(v))v.forEach(visit);else if(v&&typeof v==='object')Object.values(v).forEach(visit);}
    visit(current);
    const ref={'@':definitions.length},cost=bytes(ref);
    const candidates=[...nodes.entries()].map(([key,r])=>({...r,key,saving:(r.count-1)*Buffer.byteLength(canonical(r.value))-r.count*cost-1})).filter(r=>r.count>1&&r.saving>0).sort((a,b)=>b.saving-a.saving||compare(a.key,b.key));
    if(!candidates.length)break;
    const best=candidates[0];definitions.push(copy(best.value));
    function replace(v){if(canonical(v)===best.key)return copy(ref);if(Array.isArray(v))return v.map(replace);if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,replace(x)]));return v;}
    current=replace(current);
  }
  return {notation,definitions,document:current};
}
export function expandWorkedExamplesA6(packed) {
  if(!packed?.notation)return copy(packed);
  function expand(v,active=new Set()) {
    if(v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===1&&Object.hasOwn(v,'@')) {
      const i=v['@'];if(!Number.isInteger(i)||i<0||i>=packed.definitions.length||active.has(i))throw Error('invalid_example_reference');
      return expand(packed.definitions[i],new Set([...active,i]));
    }
    if(Array.isArray(v))return v.map(x=>expand(x,active));
    if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,expand(x,active)]));
    return v;
  }
  const worked=expand(packed.document);
  if(worked.event_defaults){for(const x of worked.extraction)for(const b of x.batches??[x])b.expected=b.expected.map(e=>({...copy(worked.event_defaults),...e}));delete worked.event_defaults;}
  return worked;
}
const cache=new Map();
export function projectContractA6(operation,input) {
  const c=literalProjectionA6(operation,input),key=canonical(c);
  if(!cache.has(key)) {
    const original=c.worked_examples;
    const choices=[{encoding:'literal',value:original},
      {encoding:'exact-definitions',value:repeatedDefinitions(original)},
      {encoding:'modal-defaults-and-exact-definitions',value:repeatedDefinitions(eventDefaults(original,{minimumBytes:false}))},
      {encoding:'byte-minimal-defaults-and-exact-definitions',value:repeatedDefinitions(eventDefaults(original))}];
    for(const choice of choices)if(canonical(expandWorkedExamplesA6(choice.value))!==canonical(original))throw Error('projection_round_trip');
    choices.sort((a,b)=>bytes(a.value)-bytes(b.value)||compare(a.encoding,b.encoding));
    cache.set(key,{...c,worked_examples:choices[0].value});
  }
  return copy(cache.get(key));
}

export function isContractProjectionA6(value) {
  if(!value||!Array.isArray(value.aliases?.subjects)||!Array.isArray(value.aliases?.predicates))return false;
  const names=[...value.aliases.subjects,...value.aliases.predicates].map(r=>r.canonical);
  return ['extraction','reader'].some(operation=>canonical(projectContractA6(operation,{names}))===canonical(value));
}
