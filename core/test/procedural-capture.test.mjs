import test from 'node:test';
import assert from 'node:assert/strict';
import { setup,input,ok,ns,assertError } from '../testing/episode-capture-helpers.mjs';
import { rationaleModel } from '../testing/rationale-model.mjs';
const qualifier=rationaleModel().qualifyCandidates;
const extraction={items:[{content:'Always review changes.',kind:'instruction',confidence:0.9,sourceIndices:[0],procedural:true}]};

test('E10 automatic anchored tag in episode mode; omission preserves, correction clears, receipt lineage binds',async t=>{
  const f=setup(t,{extract:()=>extraction,qualifyCandidates:r=>{
    const result=qualifier(r);result.qualifications[0].procedural={evidenceIndices:[r.input.items[0].candidates[0].candidateIndex]};return result;
  }});
  const capture=ok(await f.core.capture(input()));const id=capture.admission.memories[0].id;
  const memory=ok(f.core.get({namespace:ns,memoryId:id}));
  assert.equal(memory.procedural.procedural,true);assert.equal(memory.procedural.origin,'model');
  assert.equal(memory.procedural.anchors[0].receiptId,memory.receipts[0].id);
  const episode=ok(f.core.getEpisode({namespace:ns,episodeId:capture.episode.id}));
  assert.equal(episode.memoryLinks.items[0].receiptIds.length,1);
  assert.ok(memory.receipts[0].sessionId.startsWith('s1:'));
  assert.ok(f.model.calls.find(c=>c.method==='extract').request.system.includes('Episode-v1'));
  assert.ok(f.model.calls.find(c=>c.method==='qualifyCandidates').request.system.includes('Episode-v1'));
  f.model.extract=()=>({...extraction,items:extraction.items.map(({procedural,...item})=>({...item,content:'Another instruction'}))});
  f.model.qualifyCandidates=qualifier;ok(await f.core.capture(input(2)));
  assert.equal(ok(f.core.get({namespace:ns,memoryId:id})).procedural.procedural,true);
  const current=ok(f.core.get({namespace:ns,memoryId:id}));
  ok(f.core.correct({namespace:ns,memoryId:id,expectedRevision:current.memory.revision,content:'Corrected instruction',kind:'instruction',receipt:{client:'synthetic',sessionId:'explicit',eventId:'correction',role:'user',excerpt:'Corrected instruction'}}));
  assert.equal(ok(f.core.get({namespace:ns,memoryId:id})).procedural.procedural,false);
});

for(const malformed of ['foreign','fact','empty'])test(`E10 automatic tag rejects ${malformed} without partial admission`,async t=>{
  const f=setup(t,{extract:()=>({...extraction,items:extraction.items.map(item=>({...item,kind:malformed==='fact'?'fact':item.kind}))}),qualifyCandidates:r=>{
    const output=qualifier(r);output.qualifications[0].procedural={evidenceIndices:malformed==='foreign'?[999]:[]};return output;
  }});
  assertError(await f.core.capture(input()),'invalid_model_output');
  assert.equal(f.db.prepare('SELECT count(*) n FROM memories').get().n,0);
});
