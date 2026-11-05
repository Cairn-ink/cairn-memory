import { costFamilyPhysical } from './content-safety-cost-families.mjs';
import assert from 'node:assert/strict';
import { contentWriteMethodClass } from '../content-write-context.mjs';
import { readFileSync } from 'node:fs';
const inventory=JSON.parse(readFileSync(new URL('../test/fixtures/content-safety-s2h-cost-inventory.json',import.meta.url),'utf8'));

// Discovery distinguishes native gates and explicit exemptions; coverage deferrals are empty.
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
 assert.equal(cell,safety?costFamilyPhysical(base,dimensions.family):base,'actual native cell, not the requested label');
 if(safety)assert.equal(db.prepare('SELECT count(*) n FROM content_suppressions WHERE owner_id=?').get(ownerId).n,facts,'actual owner fact population');
 measuredCell={family:dimensions.family??'safety',...dimensions,base,cell,safety,facts,ownerId};
 return cell;
}
export function assertCostGateCells(cells) {
 if(unmigratedCostOnly){assert.deepEqual(cells.map(c=>[c.safety,c.facts]),[[false,0]]);return true;}
 assert.deepEqual(cells.map(c=>[c.safety,c.facts]),[[false,0],[true,0],[true,5]],'exact legacy/zero/five cell records; no omitted or duplicate cell');
}

// Measurement mode changes fixture populations only, never production code.
export const unmigratedCostOnly = process.env.CAIRN_S2H_UNMIGRATED_ONLY === '1';
export const costGatePopulations = () => unmigratedCostOnly ? [[false,0]] : [[false,0],[true,0],[true,5]];

// Coverage deferrals are empty after the native hosted gate. Even a future
// deferred declaration must identify an executed native smoke case first;
// merely attaching a category/reason can never stand in for native coverage.
export function assertContentCostDeferrals(candidate=inventory) {
 const methods=['refreshContextIndex','findCandidates','contextRead'],gate='product-semantic-cost';
 const cases=['refreshContextIndex:enabled-cold','refreshContextIndex:enabled-repeat','findCandidates:hit','contextRead:hit','findCandidates:semantic-only','contextRead:semantic-only'];
 for(const [method,entry]of Object.entries(candidate.reads)){
  assert.deepEqual(entry.missing,[],'unmapped retained-read variant: '+method);
  for(const item of entry.deferred??[]){
   assert.ok(item.nativeSmoke?.gate&&item.nativeSmoke?.case,'deferred variant requires an executed minimal native count smoke case');
   assert.fail('non-empty coverage deferral requires a new decision and an executed native smoke case');
  }
 }
 assert.deepEqual(candidate.caseSets['product-semantic-native']?.toSorted(),cases.toSorted(),'exact native product semantic case set');
 assert.deepEqual(candidate.caseSets['product-semantic-cursor'],['findCandidates:hit-cursor'],'exact native product semantic cursor case set');
 for(const method of methods){
  const entries=candidate.reads[method].gates.filter(e=>e.gate===gate||e.variants.includes('product enabled semantic'));
  assert.equal(entries.length,1,'native product semantic gate required: '+method);
  assert.equal(entries[0].gate,gate,'native product semantic gate name: '+method);
  assert.equal(entries[0].caseGroup,'product-semantic-native','native product semantic case group: '+method);
  assert.deepEqual(entries[0].variants,['product enabled semantic'],'unknown native product semantic variant: '+method);
 }
 readFileSync(new URL('../test/content-safety-s2h-'+gate+'.test.mjs',import.meta.url));
 return [];
}

// Additive Raw population discovery: these are native cells of the existing
// product gate, with the same public capture setup on each comparator side.
export function assertRawProductCostPopulations(candidate=inventory) {
 assert.deepEqual(candidate.rawProductPopulations,{bases:[33],lineage:['foreign','in-scope','both'],facts:[0,5],sizes:[12,24],intents:['current','history'],caseGroup:'product-semantic-raw',cursorCaseGroup:'product-semantic-cursor'});
 assert.deepEqual(candidate.caseSets['product-semantic-raw'],candidate.caseSets['product-semantic-native']);
}
assertRawProductCostPopulations();
