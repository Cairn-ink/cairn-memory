import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fixture, ok } from '../testing/context-read-fixture.mjs';
import { four, configured, prebuild, card, canonicalSet } from '../testing/context-product-owner-fixture.mjs';
import { PRODUCT_SIDECAR_SUFFIX } from '../context-product-sidecar.mjs';

const processFixture = new URL('./fixtures/context-product-wal-process.mjs',import.meta.url);
function independent(role,path,mode) {
  const result=spawnSync(process.execPath,[processFixture.pathname,role,path,...(mode?[mode]:[])],{env:{},encoding:'utf8',timeout:30000});
  assert.equal(result.error,undefined);assert.equal(result.status,0,result.stderr);
  return result.stdout.trim()?JSON.parse(result.stdout):null;
}
for(const mode of ['DELETE','WAL'])
test(`P2c/P2d owner-wide four-namespace ${mode}/${mode} read, evidence and assembly`,async t=>{
  const f=fixture(t,{cards:true});
  for(const namespace of four){
    const memory=f.admit('integration orchard '+(namespace.projectId??'personal'),namespace);
    card(f,namespace,'integration Card','orchard canonical body',memory);
  }
  // Only the independent fixture process sets canonical mode. Product opening
  // and maintenance must preserve it, as well as all canonical logical data.
  independent('mode',f.path,mode);
  const before=independent('logical',f.path);
  assert.equal(before.journal,mode.toLowerCase());
  const service=configured(t,f.path,[...four].reverse(),{service:true});
  if(mode==='WAL')Object.assign(service.options,{wal:true,sidecarJournalMode:'WAL'});
  await prebuild(service);
  const request=configured(t,f.path,four);
  if(mode==='WAL')request.options.wal=true;
  const reader=await request.open(),readSet=canonicalSet(four),types=['memory','card'];
  const capabilities=ok(await reader.getContextReadCapabilities());
  assert.deepEqual(capabilities.journals,mode==='WAL'?['DELETE','WAL']:['DELETE']);
  assert.deepEqual(capabilities.sidecarJournals,mode==='WAL'?['DELETE','WAL']:['DELETE']);
  assert.deepEqual(capabilities.wal,mode==='WAL'?{available:true}:{available:false,reason:'deferred_to_p2d'});
  for(const intent of ['current','history']){
    const input={readSet:[...readSet].reverse(),types,intent,deadlineMs:5000};
    const status=ok(await reader.getContextIndexStatus(input,request.token));
    assert.equal(status.lexical.state,'ready');assert.equal(status.coverage.status,'complete');
    assert.deepEqual(status.coverage.namespaces,request.options.ownerCoverage);
    const candidates=ok(await reader.findCandidates({...input,query:'integration orchard'},request.token));
    assert.equal(candidates.items.length,8);assert.equal(candidates.coverage.status,'complete');
    assert.equal(new Set(candidates.items.map(i=>JSON.stringify(i.ref.namespace))).size,4);
    assert.deepEqual([...new Set(candidates.items.map(i=>i.ref.type))].sort(),['card','memory']);
    const assembly=ok(await reader.contextRead({...input,query:'integration orchard',budget:{maxTokens:4000,maxItems:12}},request.token));
    assert.equal(assembly.metered.items.length,8);
    const evidence=ok(await reader.fetchCandidateEvidence({readSet,snapshot:assembly.snapshot},request.token));
    assert.deepEqual(evidence.items.map(i=>i.ref),assembly.diagnostics.items.map(i=>i.ref));
  }
  await reader.close();
  assert.equal(service.view[5],0);assert.equal(request.view[5],0);
  assert.ok((await service.supervisor.drain()).every(r=>r.telemetry==='complete'));
  assert.ok((await request.supervisor.drain()).every(r=>r.telemetry==='complete'));
  assert.deepEqual(independent('logical',f.path),before);
  assert.equal(independent('logical',f.path+PRODUCT_SIDECAR_SUFFIX).journal,mode.toLowerCase());
});
