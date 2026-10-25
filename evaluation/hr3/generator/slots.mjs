import { assert, canonical, cellsOf, cellKey } from './common.mjs';
import { valueKey, normalizeText } from './canonicalize.mjs';
import { PUBLIC_CONTRACT } from './contract.mjs';

export function slotRow(claim) {
  const fields={route:claim.value,...Object.fromEntries(claim.qualifiers.map(q=>[q.key,q.value]))};
  const slot=(name,type,extract)=> {
    const value=fields[name];
    if(value===undefined) return {state:'not_specified',value:null};
    assert(value.type===type,'slot_type',name);
    return {state:'value',value:extract(value)};
  };
  return {scope:claim.scope,valid:claim.valid,route:slot('route','Text',x=>normalizeText(x.text)),
    approval:slot('approval','Boolean',x=>x.value),cap:slot('cap','Quantity',x=>({decimal:x.decimal,unit:x.unit})),citations:[]};
}
export function slotGold(legacy,predecessors) {
  assert(legacy.old.records.length===predecessors.length,'slot_predecessors');
  return {current:{status:legacy.current.status,rows:legacy.current.claims.map(slotRow)},
    old:{status:legacy.old.status,records:legacy.old.records.map((r,i)=>({predecessor_turn:predecessors[i],status:r.status,rows:r.claims.map(slotRow)}))},
    reason:{status:legacy.reason.status,support:[]},acceptedGraphs:legacy.acceptedGraphs};
}
// Extensional rows: exact unit rationals, normalized identifiers, equivalent duplicates collapse.
export function slotRowsKey(rows) {
  return canonical([...new Set(rows.flatMap(row=>cellsOf(row.scope).map(cell=>canonical({cell:cellKey(cell),valid:row.valid,
    ...Object.fromEntries(['route','approval','cap'].map(name=> {
      const s=row[name]; let value=s.value;
      if(s.state==='value' && name==='cap') value=valueKey({type:'Quantity',...value});
      if(s.state==='value' && name==='route') value=normalizeText(value);
      return [name,{state:s.state,value}];
    }))}))))].sort());
}
export function canonicalPublicName(name,kind) {
  const text=normalizeText(name),table=PUBLIC_CONTRACT.aliases[kind];
  const found=table.find(row=>[row.canonical,...row['zh-Hant'],...row.en,...row.mixed].map(normalizeText).includes(text));
  return found?.canonical??text;
}

export function slotHistoryKey(old) {
  return canonical({status:old.status,records:old.records.map(r=>({predecessor_turn:r.predecessor_turn,status:r.status,rows:slotRowsKey(r.rows)})).sort((a,b)=>a.predecessor_turn.localeCompare(b.predecessor_turn,'en'))});
}
