import '../testing/context-product-test-clock.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { openMemoryCore,openContextIndexMaintainer,openContextProductReader } from '../index.mjs';
import { setupProductSemantic,ns,ok } from '../testing/content-safety-s2h-product-semantic-probe.mjs';
import { fixture } from '../testing/context-read-fixture.mjs';
import { configured,prebuild } from '../testing/context-product-owner-fixture.mjs';

const personal={...ns,scope:'personal',projectId:null},a={...ns,projectId:'a'},b={...ns,projectId:'b'};
for(const safety of [false,true])test(`native semantic Worker scope survives issuance, query embedding and assembly; safety=${safety}`,async t=>{
  const readSet=[personal,a,b],s=await setupProductSemantic(t,{readSet,corpus:0,safety});
  const writer=openMemoryCore({path:s.f.path});
  try{for(const [i,namespace] of readSet.entries())ok(writer.admit({namespace,memory:{content:'semantic orchard '+i,kind:'fact'},receipts:[{client:'synthetic',sessionId:'subset',eventId:String(i),role:'user',excerpt:'synthetic support'}]}));}finally{writer.close();}
  ok(await s.coordinator.setOwnerSemantic({ownerId:ns.ownerId,semantic:true,expectedRevision:0},s.token));
  const m=s.configure(true),maintainer=await openContextIndexMaintainer(m.options);s.f.workspace.defer(()=>maintainer.close());
  const input={readSet,types:['memory'],intent:'current'};
  ok(await maintainer.refreshContextIndex({...input,mode:'lexical',budget:{maxItems:1024,maxMs:5000}},m.credential));
  ok(await maintainer.refreshContextIndex({...input,mode:'embeddings',budget:{maxItems:1024,maxMs:5000,maxUsd:'0.50'}},m.credential));
  const r=s.configure(false),reader=await openContextProductReader(r.options);s.f.workspace.defer(()=>reader.close());
  for(const method of ['findCandidates','contextRead'])for(const namespaces of [[personal],[personal,a]]){
    const value=ok(await reader[method]({...input,namespaces,query:'semantic orchard',semantic:true,deadlineMs:5000,...(method==='contextRead'?{budget:{maxTokens:6000,maxItems:24}}:{limit:24})},r.credential));
    const details=value.diagnostics?.candidates??value;
    assert.equal(details.channels.semantic.state,'ready');
    assert.equal(details.coverage.byType.memory.eligible,null);assert.equal(details.coverage.byType.memory.embedded,null);
    const items=value.items??value.metered.items;assert.equal(items.length,namespaces.length);
    assert.ok(items.every(item=>namespaces.some(selected=>JSON.stringify(selected)===JSON.stringify(item.ref.namespace??readSet[item.ref.ns]))));
  }
});

test('Worker strict issuance binds scope addition, substitution and removal',async t=>{
  const readSet=[personal,a,b],f=fixture(t);
  for(const namespace of readSet)f.admit('orchard issued',namespace);
  await prebuild(configured(t,f.path,readSet,{service:true}),['memory']);
  const denied={ok:false,error:{code:'authority_required',retryable:false}};
  for(const method of ['findCandidates','contextRead']){
    const full={readSet,types:['memory'],intent:'current',query:'orchard',deadlineMs:5000,
      ...(method==='contextRead'?{raw:false,budget:{maxTokens:6000,maxItems:24}}:{limit:24})};
    const scoped={...full,namespaces:[personal]};
    for(const [input,altered] of [[full,[scoped]],[scoped,[{...full,namespaces:[personal,a]},full]]]){
      const r=configured(t,f.path,readSet),attempts=new SharedArrayBuffer(8);
      const host={moduleUrl:new URL('../testing/context-product-strict-issuance-host.mjs',import.meta.url).href,
        configuration:{...r.options.host.configuration,issued:{method,input},attempts}};
      const reader=await openContextProductReader({...r.options,host});
      try{
        const value=ok(await reader[method](input,r.token));
        assert.equal((value.items??value.metered.items).length,input===full?3:1);
        for(const mutation of altered)assert.deepEqual(await reader[method](mutation,r.token),denied);
        assert.deepEqual(Array.from(new Int32Array(attempts)),[1,altered.length]);
      }finally{await reader.close();}
    }
  }
});
