import { eventTimeSafetyFixture } from '../testing/receipt-event-time-fixture.mjs';
import { familyGate } from '../testing/receipt-event-time-gates.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { openMemoryCore } from '../index.mjs';
import { openContextProductFacade } from '../context-read-facade.mjs';
import { openProductIndex } from '../context-product-index.mjs';
import { requestAuthority } from '../context-product-authority.mjs';
import { credentialDigest } from '../context-product-control.mjs';
import { accessDigest } from '../context-product-validation.mjs';
import { safetyFixture, ns, ok, receipt } from '../testing/content-safety-s2h-fixture.mjs';

for (const base of [18,33]) for (const semanticEnabled of [false,true]) for (const method of ['findCandidates','contextRead'])
  test(`delivery v${base===18?34:48} ${semanticEnabled?'semantic':'lexical'} ${method}: final isCurrent forget hides unavailable progress`, async t => {
    const f = safetyFixture(t,base); await f.migrate();
    const core = openMemoryCore({path:f.path}); t.after(()=>core.close());
    const memories = Array.from({length:3},(_,i)=>ok(core.admit({namespace:ns,
      memory:{content:'Synthetic unavailable delivery '+i,kind:'fact'},receipts:[receipt('delivery-'+i)]})).memory);
    const ownerCoverage = {policy:'recent-projects-v1',selectionRevision:'synthetic',requestedNamespaces:1,selectedNamespaces:1,omittedNamespaces:0};
    const facade = openContextProductFacade(f.path,{}); t.after(()=>facade.close());
    const access = {accessGenerations:accessDigest({ownerId:ns.ownerId,namespaces:{readSet:[ns]}}),check(){},envelope:work=>work()};
    const maintainer = openProductIndex({path:f.path,facade,ownerCoverage,maintenance:true,authorize:()=>access});
    t.after(()=>maintainer.close());
    const built = ok(maintainer.run('refreshContextIndex',{readSet:[ns],types:['memory'],intent:'current',mode:'lexical',budget:{maxItems:1,maxMs:5000}}));
    assert.equal(built.status,'rebuilding');
    const credential = {opaque:randomUUID()}, binding = {kind:'service',serviceId:randomUUID(),credentialBindingId:randomUUID(),
      credentialExpiresUtcMs:null,credentialDigest:credentialDigest(credential),ownerId:ns.ownerId,namespaces:{readSet:[ns],ownerCoverage},issuedAt:0};
    let samples = 0, forgets = 0;
    const authorize = requestAuthority({authorize:()=>binding,isCurrent(){
      if (++samples===2) { for (const memory of memories) {
        ok(core.forget({namespace:ns,memoryId:memory.id,expectedRevision:memory.revision})); forgets++;
      } }
      return true;
    }},binding,{});
    const semantic = semanticEnabled ? {async snapshot(){return {policy:{semantic:false},identity:null};},call(){assert.fail('unexpected provider dispatch');}} : undefined;
    const cutoff = (process.hrtime.bigint()+5000000000n).toString();
    const reader = openProductIndex({path:f.path,facade,ownerCoverage,authorize,semantic,
      operation:()=>({operationCutoffMonoNs:cutoff})}); t.after(()=>reader.close());
    const result = await reader.run(method,{readSet:[ns],types:['memory'],intent:'current',query:'unmatched',semantic:semanticEnabled,
      ...(method==='contextRead'?{budget:{maxItems:4,maxTokens:2000}}:{})},credential);
    assert.equal(samples,2,JSON.stringify(result)); assert.equal(forgets,3);
    assert.equal(result.ok,false); assert.equal(result.error.code,'index_unavailable');
    const details = method==='contextRead' ? result.error.details.candidates : result.error.details;
    assert.equal(details.coverage.maintenance.progress,null);
    assert.equal(details.coverage.byType.memory.eligible,null);
    assert.equal(details.coverage.byType.memory.indexed,null);
    assert.doesNotMatch(JSON.stringify(result),/Synthetic unavailable delivery/);
  });


const completeFamilyDelivery = familyGate('E/semanticEnabled', 2);
for (const method of ['findCandidates', 'contextRead']) for (const semanticEnabled of [false])
test(`family gate E: delivery v53 ${method} semanticEnabled=${semanticEnabled}`, async t => {
  const base = 33;
  const f = eventTimeSafetyFixture(t,base); await f.migrate();
  const core = openMemoryCore({path:f.path}); t.after(()=>core.close());
  const memories = Array.from({length:3},(_,i)=>ok(core.admit({namespace:ns,
    memory:{content:'Synthetic unavailable delivery '+i,kind:'fact'},receipts:[receipt('delivery-'+i)]})).memory);
  const ownerCoverage = {policy:'recent-projects-v1',selectionRevision:'synthetic',requestedNamespaces:1,selectedNamespaces:1,omittedNamespaces:0};
  const facade = openContextProductFacade(f.path,{}); t.after(()=>facade.close());
  const access = {accessGenerations:accessDigest({ownerId:ns.ownerId,namespaces:{readSet:[ns]}}),check(){},envelope:work=>work()};
  const maintainer = openProductIndex({path:f.path,facade,ownerCoverage,maintenance:true,authorize:()=>access});
  t.after(()=>maintainer.close());
  const built = ok(maintainer.run('refreshContextIndex',{readSet:[ns],types:['memory'],intent:'current',mode:'lexical',budget:{maxItems:1,maxMs:5000}}));
  assert.equal(built.status,'rebuilding');
  const credential = {opaque:randomUUID()}, binding = {kind:'service',serviceId:randomUUID(),credentialBindingId:randomUUID(),
    credentialExpiresUtcMs:null,credentialDigest:credentialDigest(credential),ownerId:ns.ownerId,namespaces:{readSet:[ns],ownerCoverage},issuedAt:0};
  let samples = 0, forgets = 0;
  const authorize = requestAuthority({authorize:()=>binding,isCurrent(){
    if (++samples===2) { for (const memory of memories) {
      ok(core.forget({namespace:ns,memoryId:memory.id,expectedRevision:memory.revision})); forgets++;
    } }
    return true;
  }},binding,{});
  const semantic = semanticEnabled ? {async snapshot(){return {policy:{semantic:false},identity:null};},call(){assert.fail('unexpected provider dispatch');}} : undefined;
  const cutoff = (process.hrtime.bigint()+5000000000n).toString();
  const reader = openProductIndex({path:f.path,facade,ownerCoverage,authorize,semantic,
    operation:()=>({operationCutoffMonoNs:cutoff})}); t.after(()=>reader.close());
  const result = await reader.run(method,{readSet:[ns],types:['memory'],intent:'current',query:'unmatched',semantic:semanticEnabled,
    ...(method==='contextRead'?{budget:{maxItems:4,maxTokens:2000}}:{})},credential);
  assert.equal(samples,2,JSON.stringify(result)); assert.equal(forgets,3);
  assert.equal(result.ok,false); assert.equal(result.error.code,'index_unavailable');
  const details = method==='contextRead' ? result.error.details.candidates : result.error.details;
  assert.equal(details.coverage.maintenance.progress,null);
  assert.equal(details.coverage.byType.memory.eligible,null);
  assert.equal(details.coverage.byType.memory.indexed,null);
  assert.doesNotMatch(JSON.stringify(result),/Synthetic unavailable delivery/);

  completeFamilyDelivery(`${method}/${semanticEnabled}`);
});
