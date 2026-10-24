import { createHash } from 'node:crypto';

export const VERSION = 'hr3-generator-v1';
export const DEFAULT_SEED = 'hr3-worlds-v1';
export const TYPES = ['correction', 'reversal', 'refinement', 'scope_change', 'expiry'];
export const CAUSES = ['direct', 'unstated', 'two_edge_serial', 'three_edge_serial', 'conjunctive_mediated', 'alternative_mediated'];
export const DOMAIN = { country: ['TW', 'JP', 'US'], plan: ['free', 'pro'], channel: ['web', 'app'] };
export const CELLS = DOMAIN.country.flatMap(country => DOMAIN.plan.flatMap(plan => DOMAIN.channel.map(channel => ({ country, plan, channel }))));
export const sha256 = data => createHash('sha256').update(data).digest('hex');
export const canonical = value => JSON.stringify(sort(value));
function sort(value) {
  if (Array.isArray(value)) return value.map(sort);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, sort(value[key])]));
  return value;
}
export const jsonl = rows => rows.map(canonical).join('\n') + (rows.length ? '\n' : '');
export function rng(seed) {
  let counter = 0;
  return () => Number.parseInt(sha256(`${seed}\0${counter++}`).slice(0, 13), 16) / 0x10000000000000;
}
export function shuffle(items, seed) {
  const result = [...items], random = rng(seed);
  for (let i = result.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [result[i], result[j]] = [result[j], result[i]]; }
  return result;
}
export const text = value => ({ type: 'Text', text: value });
export const bool = value => ({ type: 'Boolean', value });
export const quantity = value => ({ type: 'Quantity', decimal: String(value), unit: 'requests/day' });
export const scope = countries => ({ any: [{ all: countries ? [{ field: 'country', values: [...countries].sort() }] : [] }] });
export function cellsOf(s) {
  if (!s || !Array.isArray(s.any)) return [];
  return CELLS.filter(cell => s.any.some(term => Array.isArray(term.all) && term.all.every(atom => Object.hasOwn(DOMAIN, atom.field) && atom.values?.includes(cell[atom.field]))));
}
export const cellKey = cell => `${cell.country}/${cell.plan}/${cell.channel}`;
export function scopeFromCells(cells) {
  // Exact finite-domain cover, retaining compact scopes for the reader schema.
  const target=new Set(cells.map(cellKey)), remaining=new Set(target), any=[];
  const subsets=values=>Array.from({length:(1<<values.length)-1},(_,mask)=>values.filter((_,i)=>(mask+1)&(1<<i)).sort());
  const candidates=[];
  for (const country of subsets(DOMAIN.country)) for (const plan of subsets(DOMAIN.plan)) for (const channel of subsets(DOMAIN.channel)) {
    const selected=CELLS.filter(c=>country.includes(c.country) && plan.includes(c.plan) && channel.includes(c.channel)).map(cellKey);
    if (selected.every(key=>target.has(key))) candidates.push({selected,all:Object.entries({country,plan,channel}).filter(([field,values])=>values.length!==DOMAIN[field].length).map(([field,values])=>({field,values}))});
  }
  while (remaining.size) {
    candidates.sort((a,b)=>b.selected.filter(x=>remaining.has(x)).length-a.selected.filter(x=>remaining.has(x)).length || canonical(a.all).localeCompare(canonical(b.all),'en'));
    const best=candidates[0];
    any.push({all:best.all}); for (const key of best.selected) remaining.delete(key);
  }
  return {any:any.sort((a,b)=>canonical(a).localeCompare(canonical(b),'en'))};
}
export function claim(event, fields = event.claims, audience = event.scope) {
  return { subject: event.subject, predicate: event.predicate, value: fields.find(x => x.field === 'value').value,
    scope: audience, valid: event.effective_interval,
    qualifiers: fields.filter(x => x.field !== 'value').map(x => ({ key: x.field, value: x.value })).sort((a,b) => a.key.localeCompare(b.key, 'en')), citations: [] };
}
export function assert(condition, code, detail = '') {
  if (!condition) throw Object.assign(new Error(`${code}${detail ? `: ${detail}` : ''}`), { code });
}
