import { readFileSync } from 'node:fs';
import { assert, canonical } from './common.mjs';

export const PUBLIC_CONTRACT = JSON.parse(readFileSync(new URL('./public-contract.json',import.meta.url),'utf8'));
const NAME_TOKEN_PATTERN=new RegExp(`^(?:${PUBLIC_CONTRACT.name_tokens.pattern})$`);
export const HISTORICAL_LABELS = PUBLIC_CONTRACT.historical_labels.map(x=>x.canonical);
// Complete public bytes, independent of the allocation inventory and private gold.
export const publicContract = () => structuredClone(PUBLIC_CONTRACT);

export function validatePublicContract(value=PUBLIC_CONTRACT) {
  const schema=JSON.parse(readFileSync(new URL('./public-contract.schema.json',import.meta.url),'utf8'));
  function check(x,s) {
    if(s.const!==undefined) assert(canonical(x)===canonical(s.const),'contract_schema');
    if(s.anyOf) {assert(s.anyOf.some(branch=>{try{check(x,branch);return true;}catch{return false;}}),'contract_schema');return;}
    if(s.type==='null'){assert(x===null,'contract_schema');return;}
    if(s.type==='integer'){assert(Number.isSafeInteger(x),'contract_schema');return;}
    if(s.enum) assert(s.enum.includes(x),'contract_schema');
    if(s.type==='object') {
      assert(x && typeof x==='object' && !Array.isArray(x),'contract_schema');
      assert(canonical(Object.keys(x).sort())===canonical(s.required.slice().sort()),'contract_schema');
      for(const [k,v] of Object.entries(s.properties)) check(x[k],v);
    } else if(s.type==='array') {
      assert(Array.isArray(x) && x.length>=(s.minItems??0),'contract_schema');
      for(const entry of x) check(entry,s.items);
    } else if(s.type) assert(typeof x===s.type,'contract_schema');
  }
  check(value,schema);
  assert(canonical(value.slots.map(s=>s.name))==='["route","approval","cap"]','contract_slots');
  assert(canonical(value.historical_labels.map(s=>s.canonical))==='["previously_adopted","erroneous","expired","unavailable","unresolved"]','contract_labels');
  return true;
}

// Exact A-3 occurrence lookup plus A-6 ASCII complete-token boundaries. This
// checks syntax/anchoring only; own versus referenced role is never inferred.
export function validNameAnchor(name,anchor,turns) {
  if(typeof name!=='string'||!NAME_TOKEN_PATTERN.test(name)||anchor?.quote!==name||!Number.isSafeInteger(anchor.occurrence)||anchor.occurrence<1)return false;
  const source=turns.get(anchor.turn_id);const text=typeof source==='string'?source:source?.text;
  if(typeof text!=='string')return false;
  let start=-1;for(let n=0;n<anchor.occurrence;n++){start=text.indexOf(name,start+1);if(start<0)return false;}
  const token=c=>c!==undefined&&NAME_TOKEN_PATTERN.test(c);
  return !token(text[start-1])&&!token(text[start+name.length]);
}
export function assertExampleFree(world) {
  const tokens=JSON.stringify(world).match(/[A-Za-z0-9_-]+/g)??[];
  assert(!tokens.some(token=>token.startsWith(PUBLIC_CONTRACT.example_exclusions.reserved_name_prefix)),'public_example_world_exclusion');
}
