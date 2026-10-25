import { readFileSync } from 'node:fs';
import { assert, canonical } from './common.mjs';

export const PUBLIC_CONTRACT = JSON.parse(readFileSync(new URL('./public-contract.json',import.meta.url),'utf8'));
export const HISTORICAL_LABELS = PUBLIC_CONTRACT.historical_labels.map(x=>x.canonical);
// Complete public bytes, independent of the allocation inventory and private gold.
export const publicContract = () => structuredClone(PUBLIC_CONTRACT);

export function validatePublicContract(value=PUBLIC_CONTRACT) {
  const schema=JSON.parse(readFileSync(new URL('./public-contract.schema.json',import.meta.url),'utf8'));
  function check(x,s) {
    if(s.const!==undefined) assert(canonical(x)===canonical(s.const),'contract_schema');
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
