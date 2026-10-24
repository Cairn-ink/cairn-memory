import { canonical, cellsOf, scopeFromCells, assert } from './common.mjs';

export const normalizeText = value => value.normalize('NFKC').replace(/\s+/gu,' ').trim();
export function rational(decimal) {
  assert(typeof decimal==='string' && /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(decimal),'decimal');
  const [whole,fraction='']=decimal.split('.');
  let numerator=BigInt(`${whole}${fraction}`),denominator=10n**BigInt(fraction.length);
  const gcd=(a,b)=>b===0n?a:gcd(b,a%b), divisor=gcd(numerator<0n?-numerator:numerator,denominator);
  numerator/=divisor; denominator/=divisor;
  return {numerator:numerator.toString(),denominator:denominator.toString()};
}
export const UNIT_DICTIONARY = {'requests/day':{canonical:'requests/day',numerator:'1',denominator:'1'},'requests/hour':{canonical:'requests/day',numerator:'24',denominator:'1'},'requests/minute':{canonical:'requests/day',numerator:'1440',denominator:'1'}};
const UNITS = Object.fromEntries(Object.entries(UNIT_DICTIONARY).map(([name,unit])=>[name,{base:unit.canonical,multiplier:BigInt(unit.numerator)}]));
export function valueKey(value, lineage) {
  if (value.type==='Text') {
    let text=normalizeText(value.text);
    const reason=lineage?.bank.reasons.find(r=>[r.en,r.zh].map(normalizeText).includes(text));
    if (reason) text=reason.en;
    return {type:'Text',text};
  }
  if (value.type==='Quantity') {
    const unit=UNITS[normalizeText(value.unit)];
    assert(unit,'unknown_equivalence',value.unit);
    const r=rational(value.decimal), converted=rational((BigInt(r.numerator)*unit.multiplier).toString());
    const n=BigInt(converted.numerator),d=BigInt(r.denominator);
    const gcd=(a,b)=>b===0n?a:gcd(b,a%b),g=gcd(n<0n?-n:n,d);
    return {type:'Quantity',numerator:(n/g).toString(),denominator:(d/g).toString(),unit:unit.base};
  }
  if (value.type==='Range') {
    const unit=UNITS[normalizeText(value.unit)]; assert(unit,'unknown_equivalence',value.unit);
    const endpoint=decimal=>{ if (decimal===null) return null; const {numerator,denominator}=valueKey({type:'Quantity',decimal,unit:value.unit}); return {numerator,denominator}; };
    return {...value,lower:endpoint(value.lower),upper:endpoint(value.upper),unit:unit.base};
  }
  return value;
}
export function canonicalClaim(c,lineage) {
  const name=normalizeText(c.subject), predicate=normalizeText(c.predicate);
  return {...c,subject:lineage && [lineage.bank.subjectZh,lineage.bank.subjectEn].map(normalizeText).includes(name)?lineage.bank.subjectEn:name,
    predicate:lineage && [lineage.bank.predicateZh,lineage.bank.predicateEn].map(normalizeText).includes(predicate)?lineage.bank.predicateEn:predicate,
    value:c.value.type==='Text'?valueKey(c.value,lineage):c.value,
    scope:scopeFromCells(cellsOf(c.scope)),
    qualifiers:c.qualifiers.map(q=>({...q,key:normalizeText(q.key)})).sort((a,b)=>a.key.localeCompare(b.key,'en'))};
}
export function canonicalGold(g,lineage) {
  return {...g,current:{...g.current,claims:g.current.claims.map(c=>canonicalClaim(c,lineage))},
    old:{...g.old,records:g.old.records.map(r=>({...r,claims:r.claims.map(c=>canonicalClaim(c,lineage))}))},
    reason:{...g.reason,nodes:g.reason.nodes.map(n=>({...n,claim:canonicalClaim(n.claim,lineage)}))}};
}
// Set normalization collapses equivalent duplicates but preserves contradictory extras.
export function claimSetKey(claims,lineage) {
  return canonical([...new Set(claims.map(c=>{
    const normalized=canonicalClaim(c,lineage);
    return canonical({...normalized,value:valueKey(normalized.value,lineage),qualifiers:normalized.qualifiers.map(q=>({...q,value:valueKey(q.value,lineage)})),citations:[]});
  }))].sort());
}
export function taipeiBoundary(date,{through=false}={}) {
  assert(/^\d{4}-\d\d-\d\d$/.test(date),'bare_date');
  const midnight=Date.parse(`${date}T00:00:00.000Z`);
  assert(Number.isFinite(midnight) && new Date(midnight).toISOString().slice(0,10)===date,'bare_date');
  return new Date(midnight-8*3600000+(through?24*3600000:0)).toISOString();
}
