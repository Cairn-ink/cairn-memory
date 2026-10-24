import { dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { writeFileSync, renameSync, openSync, fsyncSync, closeSync } from 'node:fs';
export const canonical = value => JSON.stringify(value, (_, v) => v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map(k => [k,v[k]])) : v);
export const hash = value => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : canonical(value)).digest('hex');
export const bytes = value => Buffer.byteLength(typeof value === 'string' ? value : canonical(value));
export const normalize = s => s.normalize('NFKC').replace(/\s+/gu,' ').trim();
export const compare = (a,b) => Buffer.compare(Buffer.from(a),Buffer.from(b));
export const fail = code => { throw Object.assign(new Error(code),{code}); };
export function atomicJSON(path, value) {
  const temp = path + '.tmp';
  writeFileSync(temp, canonical(value)+'\n', {mode:0o600,flag:'wx'});
  const fd=openSync(temp,'r'); try { fsyncSync(fd); } finally { closeSync(fd); }
  renameSync(temp,path);
  const dir=openSync(dirname(path),'r');try { fsyncSync(dir); } finally {closeSync(dir);}
}
export const DIMENSIONS = {country:['TW','JP','US'],plan:['free','pro'],channel:['web','app']};
export const CELLS = DIMENSIONS.country.flatMap(country=>DIMENSIONS.plan.flatMap(plan=>DIMENSIONS.channel.map(channel=>({country,plan,channel})))).sort((a,b)=>compare(canonical(a),canonical(b)));
export const cells = scope => CELLS.filter(cell=>scope.any.some(clause=>clause.all.every(a=>a.values.includes(cell[a.field]))));
export function scopeOf(list) {
  const groups=new Map();
  for(const country of DIMENSIONS.country) {
    const selected=list.filter(c=>c.country===country);if(!selected.length)continue;
    const plans=[...new Set(selected.map(c=>c.plan))].sort(),channels=[...new Set(selected.map(c=>c.channel))].sort();
    if(selected.length===plans.length*channels.length) {
      const k=canonical([plans,channels]);if(!groups.has(k))groups.set(k,{countries:[],plans,channels});groups.get(k).countries.push(country);
    } else for(const c of selected){const k=canonical([[c.plan],[c.channel]]);if(!groups.has(k))groups.set(k,{countries:[],plans:[c.plan],channels:[c.channel]});groups.get(k).countries.push(country);}
  }
  return {any:[...groups.values()].map(g=>({all:[['country',g.countries],['plan',g.plans],['channel',g.channels]].filter(([f,v])=>v.length!==DIMENSIONS[f].length).map(([field,values])=>({field,values:values.sort()}))}))};
}
export const intervalStart = e => e.effective_interval.from === null ? -Infinity : Date.parse(e.effective_interval.from);
export const intervalEnd = e => e.effective_interval.to === null ? Infinity : Date.parse(e.effective_interval.to);
export const orderEvents = (a,b) => compare(a.observed_at,b.observed_at) || a.batch-b.batch || a.ordinal-b.ordinal;
export const effectiveOrder = (a,b) => intervalStart(a)-intervalStart(b) || orderEvents(a,b);
