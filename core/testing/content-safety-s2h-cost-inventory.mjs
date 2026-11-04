import assert from 'node:assert/strict';
import { contentWriteMethodClass } from '../content-write-context.mjs';
import { readFileSync } from 'node:fs';
const inventory=JSON.parse(readFileSync(new URL('../test/fixtures/content-safety-s2h-cost-inventory.json',import.meta.url),'utf8'));

// Discovery distinguishes gated, exempt and explicitly deferred variants.
// Unmapped and stale names or variants remain errors.
export function assertContentCostDiscovery(actual) {
 for(const [surface,names]of Object.entries(inventory.surfaces))assert.deepEqual(actual[surface],names,'cost inventory: new or stale '+surface+' method');
 const live=new Set(Object.values(actual).flat());
 assert.deepEqual([...live].sort(),Object.keys(inventory.surfaceClassifications).sort(),'every actual surface name has one current classification');
 const classified={};
 for(const [name,entry]of Object.entries(inventory.surfaceClassifications)){
  classified[entry.kind]=(classified[entry.kind]??0)+1;
  if(entry.kind==='read')assert.ok(inventory.reads[entry.entry],'unmapped retained read: '+name);
  else if(entry.kind==='write')assert.equal(contentWriteMethodClass(name),'write','write classification: '+name);
  else if(entry.kind==='parent-gate'){assert.ok(entry.parents.length);for(const parent of entry.parents)assert.ok(inventory.reads[parent]?.gates.length,'ungated parent route: '+name+' -> '+parent);}
  else if(entry.kind==='direct-runtime-gate'){readFileSync(new URL('../test/content-safety-s2h-'+entry.gate+'.test.mjs',import.meta.url));assert.ok(inventory.caseSets[entry.caseGroup??'metadata-1'].includes(name+':runtime'));}
  else assert.ok(['exempt','capture-protocol'].includes(entry.kind),'unknown surface classification: '+name);
  if(entry.kind!=='read')assert.ok(entry.reason?.length>20,'surface reason: '+name);
 }
 for(const [name,entry]of Object.entries(inventory.reads)) {
  assert.ok(live.has(name),'stale cost inventory name: '+name);
  assert.ok(entry.gates.length||entry.missing.length||entry.exemption?.length>20,'unmapped read name: '+name);
  for(const {gate,variants}of entry.gates){assert.ok(variants.length);readFileSync(new URL('../test/content-safety-s2h-'+gate+'.test.mjs',import.meta.url));}
 }
 const deferred=assertContentCostDeferrals(inventory);
 const entries=Object.entries(inventory.reads);
 return {surfaceNames:live.size,surfaceClasses:classified,total:entries.length,deferred,unmapped:0,gated:entries.filter(([,e])=>e.gates.length).length,
  exempt:entries.filter(([,e])=>e.exemption).map(([name,e])=>({name,reason:e.exemption})),
  missingNames:entries.filter(([,e])=>!e.gates.length&&!e.exemption).map(([name])=>name),
  missingVariants:entries.filter(([,e])=>e.missing.length).map(([name,e])=>({name,variants:e.missing}))};
}

export function assertCostGateCases(group, records) {
 assert.ok(Object.hasOwn(inventory.caseSets,group),'unmapped gate case group: '+group);
 assert.deepEqual(records.map(row=>`${row.method}:${row.variant??row.case}`).sort(),inventory.caseSets[group].toSorted(),'exact expected method/case/cell records: '+group);
 for(const row of records)assert.equal(row.node,process.version,'probe used the requested Node');
}

let measuredCell;
export const contentCostGateCell = () => measuredCell;
export function assertCostGateCell(db,base,safety,facts,ownerId,dimensions={}) {
 assert.equal(typeof dimensions.testName,'string','measurement has an explicit gate identity');
 assert.ok(dimensions.testName.length);
 const cell=db.prepare('PRAGMA user_version').get().user_version;
 assert.equal(cell,safety?({18:34,23:38,33:48}[base]):base,'actual native cell, not the requested label');
 if(safety)assert.equal(db.prepare('SELECT count(*) n FROM content_suppressions WHERE owner_id=?').get(ownerId).n,facts,'actual owner fact population');
 measuredCell={...dimensions,base,cell,safety,facts,ownerId};
 return cell;
}
export function assertCostGateCells(cells) {
 if(unmigratedCostOnly){assert.deepEqual(cells.map(c=>[c.safety,c.facts]),[[false,0]]);return true;}
 assert.deepEqual(cells.map(c=>[c.safety,c.facts]),[[false,0],[true,0],[true,5]],'exact legacy/zero/five cell records; no omitted or duplicate cell');
}

// Measurement mode changes fixture populations only, never production code.
export const unmigratedCostOnly = process.env.CAIRN_S2H_UNMIGRATED_ONLY === '1';
export const costGatePopulations = () => unmigratedCostOnly ? [[false,0]] : [[false,0],[true,0],[true,5]];

// This decision authorizes exactly three coverage deferrals. They are never
// exemptions, and do not turn an unmeasured hosted execution into a zero.
export function assertContentCostDeferrals(candidate=inventory) {
 const reference='e9, 2026-11-01 17:15',message='deferred → S2h-3, e9 11-01 17:15';
 const scopes={
  refreshContextIndex:'S2h-3: hosted semantic worker E1/inert returns and enabled product refresh cost gate',
  findCandidates:'S2h-3: product query suppressionEpoch projection and enabled semantic candidate cost gate',
  contextRead:'S2h-3: product query suppressionEpoch projection and enabled semantic assembly cost gate',
 };
 const deferred=[];
 for(const [method,entry]of Object.entries(candidate.reads)){
  assert.deepEqual(entry.missing,[],'unmapped retained-read variant: '+method);
  for(const item of entry.deferred??[]){
   assert.equal(item.category,'deferred',message+': distinct category');
   assert.equal(item.decisionReference,reference,message+': decision reference for '+method);
   assert.equal(item.scopeItem,scopes[method],message+': S2h-3 scope item for '+method);
   assert.ok(Object.hasOwn(scopes,method),message+': undeclared method '+method);
   assert.equal(item.variant,'product enabled semantic',message+': undeclared variant '+method);
   assert.equal(entry.exemption,undefined,message+': a deferral is not an exemption');
   deferred.push({method,...item});
  }
 }
 assert.deepEqual(deferred.map(r=>r.method+':'+r.variant).sort(),Object.keys(scopes).map(name=>name+':product enabled semantic').sort(),message+': exact non-stale deferral set');
 return deferred;
}
