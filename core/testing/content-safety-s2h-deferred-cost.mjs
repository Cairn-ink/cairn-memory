import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const fixture=JSON.parse(readFileSync(new URL('../test/fixtures/content-safety-s2h-deferred-counts.json',import.meta.url),'utf8'));
const roleEmbeddedCountPins=JSON.parse(readFileSync(new URL('../test/fixtures/content-safety-s2h-path-counts.json',import.meta.url),'utf8'));
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

// Episode cells have graduated from the deferred set. Keep the compatibility
// helper above unchanged for Role/context until their separate package lands.
export function assertEpisodeContentCost(row, legacy, dimensions, observed) {
 const key=JSON.stringify([dimensions.testName,dimensions.base,dimensions.n,null,row.method,row.variant,dimensions.facts]);
 const cap=fixture.caps[key];
 assert.ok(!observed.has(key));observed.add(key);
 assert.ok(row.statements<=legacy.statements+6+row.ports,'Episode R2-A1 ceiling: '+key);
 assert.ok(row.begin<=legacy.begin,'Episode R2-A1 BEGIN: '+key);
 assert.ok(cap,'Episode exact pin: '+key);
 assert.equal(row.statements,cap[0],'Episode exact statements: '+key);
 assert.equal(row.begin,cap[1],'Episode exact BEGIN: '+key);
 assert.equal(row.ports,cap[2],'Episode exact E1: '+key);
}

// Role and embedded cells are resolved by S2h-3. Episode's original executable
// ratchets above stay independent until its projection package is integrated.
const roleEmbeddedPairs=new Map();
export function assertRoleEmbeddedContentCost(row,dimensions,legacy,observed) {
 const {testName,base,n,semantic=null,facts}=dimensions;
 const key=JSON.stringify([testName,base,n,semantic,row.method,row.variant,facts]);
 const cap=fixture.caps[key]??roleEmbeddedCountPins.evidence?.[key];
 if(observed){assert.ok(!observed.has(key),'resolved cell measured once: '+key);observed.add(key);}
 assert.ok(cap,'resolved R2-A1 exact pin: '+key);
 assert.ok(row.statements<=legacy.statements+6+row.ports,'R2-A1 ceiling: '+key);
 assert.ok(row.begin<=legacy.begin,'R2-A1 BEGIN: '+key);
 assert.ok(row.ports<=legacy.ports,'no added caller dispatch: '+key);
 assert.deepEqual([row.statements,row.begin,row.ports],cap,'resolved downward exact pin: '+key);
 if(![12,24].includes(n))return;
 const pairKey=JSON.stringify([testName.replace(/\b(?:12|24)\b/g,'paired'),base,semantic,row.method,row.variant,facts]);
 let pair=roleEmbeddedPairs.get(pairKey);if(!pair){pair=new Map();roleEmbeddedPairs.set(pairKey,pair);}
 pair.set(n,{row,legacy});
 if(pair.size===2){
  const small=pair.get(12),large=pair.get(24);
  assert.ok((large.row.statements-large.row.ports)-(small.row.statements-small.row.ports)<=
    large.legacy.statements-small.legacy.statements,'R2-A1 paired slope net of E1 (D1): '+pairKey);
 }
}

export function assertRoleEmbeddedContentCostInventory(observed,testName) {
 const keys=[...Object.keys(fixture.caps),...Object.keys(roleEmbeddedCountPins.evidence??{})].filter(key=>JSON.parse(key)[0]===testName).sort();
 assert.deepEqual([...observed].sort(),keys,'resolved R2-A1 exact cell inventory: '+testName);
}
