import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { collectUnmigratedCosts } from '../testing/content-safety-s2h-unmigrated-probe.mjs';
import { contentHostInvocations, trackContentHostOptions } from '../testing/content-safety-cost-hosts.mjs';
const fixture=JSON.parse(readFileSync(new URL('./fixtures/content-safety-s2h-unmigrated-counts.json',import.meta.url),'utf8'));

test('unmigrated cost probe counts authority, policy, counter, embedder and Raw host callbacks',()=>{
 const value={},pending=Promise.resolve(value),marker=Symbol('host-fixture');let calls=0,receivers;
 function callback(){assert.ok(receivers.has(this),'caller receiver is preserved');calls++;return value;}
 const config={authority:{authorize:callback,isCurrent:callback},counter:{countTokens:callback},policy:{estimateUsd:callback},
  embedder:{embed(){assert.ok(receivers.has(this));calls++;return pending;}},raw:{openRaw:callback},readPolicy:callback,localStatus:callback,[marker]:17};
 receivers=new Set([config,...Object.values(config).filter(v=>v&&typeof v==='object')]);
 const tracked=trackContentHostOptions(config),before=contentHostInvocations();
 for(const [port,method]of [[tracked.authority,'authorize'],[tracked.authority,'isCurrent'],[tracked.counter,'countTokens'],[tracked.policy,'estimateUsd'],[tracked.raw,'openRaw'],[tracked,'readPolicy'],[tracked,'localStatus']])assert.equal(port[method](),value,'port return identity is preserved');
 assert.equal(tracked.embedder.embed(),pending,'tracking preserves the returned promise');assert.equal(tracked[marker],17);
 assert.equal(calls,8);assert.equal(contentHostInvocations()-before,8,'every configured caller function is counted once');
});

test('unmigrated v18/v23/v33: every gated method/variant stays within main a546ee43',()=>{
 assert.match(fixture.mainSha,/^a546ee43[0-9a-f]{32}$/);assert.equal(fixture.measuredDate,'2026-11-01');
 assert.deepEqual(fixture.notApplicable,['isSuppressed','listSuppressionsSince']);
 const expected=fixture.byNode?.[process.version.slice(1)]??(fixture.enginesAgree?fixture.records:undefined);
 assert.ok(expected,'a measured main-engine fixture is required');
 const records=collectUnmigratedCosts(fixture.jobs,fixture.outcomes),expectedByKey=new Map(expected.map(r=>[r.key,r.counts]));
 assert.equal(expectedByKey.size,expected.length,'unique main cells');
 assert.deepEqual(records.map(r=>r.key).sort(),[...expectedByKey.keys()].sort(),'exact complete main method/variant/cell/n set; no stale or missing cells');
 assert.equal(records.filter(r=>JSON.parse(r.key)[0]==='native').length,499,'493 native plus six Raw legacy cells');
 for(const row of records)for(const [i,metric]of ['executed statements','BEGIN','host-port invocations'].entries())
  assert.ok(row.counts[i]<=expectedByKey.get(row.key)[i],'unmigrated '+metric+' exceeds main a546ee43: '+JSON.stringify({key:row.key,main:expectedByKey.get(row.key),branch:row.counts}));
 tReport(records);
});
function tReport(records){console.log('S2H_UNMIGRATED_COUNTS '+JSON.stringify({node:process.version,mainSha:fixture.mainSha,cells:records.length,records}));}
