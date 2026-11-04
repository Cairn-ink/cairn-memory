import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const fixture=JSON.parse(readFileSync(new URL('../test/fixtures/content-safety-s2h-deferred-counts.json',import.meta.url),'utf8'));
const decision='deferred → S2h-3, e9 11-01 17:15';
export function assertDeferredContentCost(row,{testName,base,n,semantic=null,facts},observed) {
 const key=JSON.stringify([testName,base,n,semantic,row.method,row.variant,facts]);
 const cap=fixture.caps[key],message=decision+': '+key;
 assert.ok(cap,message+' has a round 3 cap');
 assert.ok(row.statements<=cap[0],message+' statements '+row.statements+' <= '+cap[0]);
 assert.ok(row.begin<=cap[1],message+' BEGIN '+row.begin+' <= '+cap[1]);
 assert.ok(row.ports<=cap[2],message+' E1 invocations '+row.ports+' <= '+cap[2]);
 assert.ok(!observed.has(key),message+' is measured once');observed.add(key);
}
export function assertDeferredContentCostInventory(observed,testName) {
 const expected=Object.keys(fixture.caps).filter(key=>JSON.parse(key)[0]===testName).sort();
 assert.deepEqual([...observed].sort(),expected,decision+': exact current method/variant/cell/n ratchets for '+testName);
}
