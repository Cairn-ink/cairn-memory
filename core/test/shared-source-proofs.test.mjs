import { createOpenAIModel } from "../../adapters/openai/index.mjs";
import { sourceDigest } from "../procedural-storage.mjs";
import nodeTest from "node:test";
import assert from "node:assert/strict";
import { openMemoryStore } from "../index.mjs";
import { ns, ok, receipt } from "../testing/card-lineage-fixture.mjs";
import { survivor, forgotten, message, ordinaryKinds, operations, source, key, noLeak, hasId, fixture, capture, act, markers, memoryRef, reads } from "../testing/shared-source-fixture.mjs";
// A pending adapter/worker call must fail the case within the file budget.
const test=(name,run)=>nodeTest(name,{timeout:15000},run);

for (const kind of ordinaryKinds) for (const operation of operations)
test(`denied qualification is omitted before reconstruction ${kind} ${operation}`, async t => {
  const f = await fixture(t, kind, operation);
  const qualification = { version: 1, slot: { subject: 'User', property: 'signal', scope: 'personal', applies: 'today' },
    value: forgotten, attribution: 'direct', commitment: 'considered', anchors: [{ receiptIndex: 0, start: 0, end: message.length,
      text: message, fields: ['subject', 'property', 'scope', 'applies', 'value', 'attribution', 'commitment'] }] };
  ok(f.core.admit({ namespace: ns, memory: { content: survivor, kind: 'fact' }, receipts: [source()], qualification }));
  const [b, a] = await capture(f);
  assert.equal(ok(f.core.get({ namespace: ns, memoryId: b.id, includeQualification: true })).qualification.value, forgotten);
  ok(await act(f, operation, a));
  assert.equal(ok(f.core.get({ namespace: ns, memoryId: b.id, includeQualification: true })).qualification, null);
  const values = await reads(f, b, []);
  if (f.call) assert.equal(values.fetchEvidence.items[0].qualification, null);
  f.model.items = [{ content: survivor, kind: 'fact', confidence: .8, sourceIndices: [0] }];
  const [recaptured] = await capture(f, 'synthetic-qualified-recapture', forgotten + '. Another excerpt window.');
  assert.equal(recaptured.id, b.id, 'retained denied anchors do not make attachment fail');
  const reread = ok(f.core.get({ namespace: ns, memoryId: b.id, includeQualification: true }));
  assert.equal(reread.qualification, null);
  assert.deepEqual(reread.receipts, []);
});

for (const operation of operations) test(`rationale links omit withheld receipts ${operation}`, async t => {
  const f = await fixture(t, 'ordinary-53', operation), [b, a] = await capture(f);
  const from = ok(f.core.fetch({ namespace: ns, refs: [{ memoryId: b.id, revision: b.revision }],
    contextMode: 'source-evidence', tokenBudget: 4000 })).items[0].receipts[0];
  f.db.prepare('INSERT INTO rationale_edges VALUES(?,?,?,?,?,?,?,?,?)')
    .run(b.id, b.revision, b.id, b.revision, 'supports-decision', from.id, from.id, key(from), key(from));
  assert.equal(ok(f.core.getRationale({ namespace: ns, memoryId: b.id, revision: b.revision })).edges.length, 1);
  ok(await act(f, operation, a));
  const rationale = ok(f.core.getRationale({ namespace: ns, memoryId: b.id, revision: b.revision }));
  assert.deepEqual(rationale.edges, []); noLeak(rationale, 'rationale links');
  const fetched = f.core.fetch({ namespace: ns, refs: [{ memoryId: b.id, revision: b.revision }],
    contextMode: 'rationale-evidence', tokenBudget: 4000 });
  noLeak(fetched, 'rationale source projection');
  assert.deepEqual(fetched, { ok: false, error: { code: 'source_unavailable', retryable: false } });
});

for (const kind of ['fresh-default','ordinary-48','ordinary-53']) test(`review A1 unchanged qualification retention ${kind}`, async t => {
  const f=await fixture(t,kind),qualification={version:1,slot:{subject:'User',property:'signal',scope:null,applies:null},value:forgotten,
    attribution:'direct',commitment:'considered',anchors:[{receiptIndex:0,start:0,end:message.length,text:message,
      fields:['subject','property','value','attribution','commitment']}]};
  const input={namespace:ns,memory:{content:survivor,kind:'fact'},receipts:[source()],qualification};
  const b=ok(f.core.admit(input)).memory;
  const a=ok(f.core.admit({namespace:ns,memory:{content:forgotten,kind:'fact'},receipts:[source()]})).memory;
  ok(act(f,'forget',a));
  assert.equal(ok(f.core.admit(input)).memory.id,b.id,'immutable qualification comparison is independent of delivery');
  const delivered=ok(f.core.get({namespace:ns,memoryId:b.id,includeQualification:true}));
  assert.equal(delivered.qualification,null);assert.deepEqual(delivered.receipts,[]);
});

for (const kind of ['ordinary-48','ordinary-53']) test(`review A1 rationale filing retains independent endpoints ${kind}`, async t => {
  const f=await fixture(t,kind),add=(content,id)=>ok(f.core.admit({namespace:ns,memory:{content,kind:'fact'},receipts:[source(),receipt(id)]})).memory;
  const b=add(survivor,'synthetic-filing-independent'),d=add('Synthetic rationale endpoint','synthetic-endpoint-independent');
  const a=ok(f.core.admit({namespace:ns,memory:{content:forgotten,kind:'fact'},receipts:[source()]})).memory;
  f.model.relate=({input})=>({edges:[{from:0,to:1,relation:'supports-decision',
    fromReceipt:input.memories[0].receipts.findIndex(receipt=>receipt.excerpt===message),
    toReceipt:input.memories[1].receipts.findIndex(receipt=>receipt.excerpt===message)}]});
  ok(await f.core.reviewRationale({namespace:ns,refs:[b,d].map(memory=>({memoryId:memory.id,revision:memory.revision}))}));
  ok(act(f,'forget',a));
  const map=ok(f.core.map({namespace:ns}));
  ok(f.core.applyPlacement({namespace:ns,expectedIndexRevision:map.indexRevision,
    expectedMemoryRevisions:[{memoryId:b.id,revision:b.revision}],
    proposal:{items:[{memoryId:b.id,parentIds:[],newL1:{title:'Synthetic filing topic',parentL2Ids:[]}}]}}));
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM rationale_edges').get().n,1,'filing preserves the canonical edge as at the base');
  const current=ok(f.core.get({namespace:ns,memoryId:b.id})).memory;
  const delivered=ok(f.core.getRationale({namespace:ns,memoryId:b.id,revision:current.revision}));
  assert.deepEqual(delivered.edges,[]);noLeak(delivered,'filed rationale');
  assert.equal(ok(f.core.get({namespace:ns,memoryId:d.id})).memory.content,'Synthetic rationale endpoint');
});

for(const kind of ['fresh-default','ordinary-48','ordinary-53']) for(const method of ['transitionQualified','transitionQualifiedSet']) test(`withheld qualification preserves binding and base transitions ${kind} ${method}`,async t=>{
  const f=await fixture(t,kind);
  const qualification=value=>({version:1,slot:{subject:'Synthetic subject',property:'Synthetic property',scope:'Synthetic scope',applies:'Synthetic applies'},
    value,attribution:'direct',commitment:'adopted',anchors:[{receiptIndex:0,start:0,end:message.length,text:message,
      fields:['subject','property','scope','applies','value','attribution','commitment']}]});
  const add=(content,value,evidence)=>ok(f.core.admit({namespace:ns,memory:{content,kind:'fact'},receipts:[evidence],qualification:qualification(value)})).memory;
  const b=add(survivor,'before',source()),c=add('Synthetic replacement claim','after',{...receipt('synthetic-qualified-replacement'),excerpt:message});
  const bind=(m,slotId=null)=>f.core.bindQualifiedClaim({namespace:ns,memoryId:m.id,expectedRevision:m.revision,slotId,singleClaim:true});
  const slot=ok(bind(b)).slotId;ok(bind(c,slot));
  const a=ok(f.core.admit({namespace:ns,memory:{content:forgotten,kind:'fact'},receipts:[source()]})).memory;
  ok(act(f,'forget',a));
  assert.equal(ok(bind(b)).slotId,slot);assert.equal(ok(bind(b,slot)).slotId,slot);
  assert.equal(bind(b,'synthetic-other-slot').error.code,'qualification_conflict');
  const predecessor={memoryId:b.id,expectedRevision:b.revision},replacement={memoryId:c.id,expectedRevision:c.revision};
  assert.equal(ok(f.core.get({namespace:ns,memoryId:b.id,includeQualification:true})).qualification,null);
  const value=ok(method==='transitionQualified' ? f.core.transitionQualified({namespace:ns,predecessor,replacement}) :
    f.core.transitionQualifiedSet({namespace:ns,predecessors:[predecessor],replacement}));
  assert.equal(value.status,'applied');

});

for(const operation of operations) for(const existing of [false,true]) test(`delivery-only first qualified binding ${operation}, existing=${existing}`,async t=>{
  const f=await fixture(t,'ordinary-53',operation);
  const qualification={version:1,slot:{subject:'Synthetic subject',property:'Synthetic property',scope:'Synthetic scope',applies:'Synthetic applies'},
    value:'Synthetic value',attribution:'direct',commitment:'adopted',anchors:[{receiptIndex:0,start:0,end:message.length,text:message,
      fields:['subject','property','scope','applies','value','attribution','commitment']}]};
  const b=ok(f.core.admit({namespace:ns,memory:{content:survivor,kind:'fact'},receipts:[source()],qualification})).memory;
  // Qualification is immutable on deduplication. Seed it before the ordinary
  // capture instead of attempting to add it to an already unqualified Memory.
  const [initialB,a]=await capture(f);
  assert.equal(b.id,initialB.id);
  let slotId=null;
  if(existing){
    const c=ok(f.core.admit({namespace:ns,memory:{content:'Synthetic other qualified claim',kind:'fact'},
      receipts:[{...receipt('synthetic-other-qualified'),excerpt:message}],qualification})).memory;
    slotId=ok(f.core.bindQualifiedClaim({namespace:ns,memoryId:c.id,expectedRevision:c.revision,slotId:null,singleClaim:true})).slotId;
  }
  ok(act(f,operation,a));
  const bound=ok(f.core.bindQualifiedClaim({namespace:ns,memoryId:b.id,expectedRevision:b.revision,slotId,singleClaim:true}));
  if(slotId)assert.equal(bound.slotId,slotId);else assert.equal(typeof bound.slotId,'string');
  assert.equal(ok(f.core.get({namespace:ns,memoryId:b.id,includeQualification:true})).qualification,null);
});

for(const operation of operations) test(`delivery-only procedural writes commit with their saved retained anchor ${operation}`,async t=>{
  const f=await fixture(t,'ordinary-53',operation);f.model.items[0].kind='instruction';
  const [b,a]=await capture(f),saved=ok(f.core.get({namespace:ns,memoryId:b.id}));
  const anchor={receiptId:saved.receipts[0].id,digest:sourceDigest(saved.receipts[0].excerpt),start:0,end:8};
  const write=expectedTagRevision=>f.core.setProceduralMemory({namespace:ns,memoryId:b.id,expectedRevision:b.revision,expectedTagRevision,
    procedural:{anchors:[anchor]}});
  const first=ok(write(0));ok(act(f,operation,a));
  const second=ok(write(first.tag.tagRevision));
  assert.deepEqual(Object.keys(second).sort(),['indexRevision','tag']);
  assert.equal(second.tag.tagRevision,first.tag.tagRevision+1);assert.deepEqual(second.tag.anchors,first.tag.anchors);
  assert.equal(ok(f.core.get({namespace:ns,memoryId:b.id})).procedural,undefined);
});

test('delivery-only marker-free rationale validates the root before eleven-edge overflow',async t=>{
  const f=await fixture(t,'ordinary-53'),memories=[];
  for(let i=0;i<6;i++){
    f.model.items=[{content:`Synthetic rationale claim ${i}`,kind:'fact',confidence:.8,sourceIndices:[0]}];
    memories.push((await capture(f,`synthetic-rationale-batch-${i}`,`Synthetic rationale support ${i}`))[0]);
  }
  const refs=memories.map(memoryRef).map(({memoryId,revision})=>({memoryId,revision}));
  const propose=async (chosen,edges)=>{f.model.relate=()=>({edges:edges.map(([from,to,relation])=>({from,to,relation,fromReceipt:0,toReceipt:0}))});
    ok(await f.core.reviewRationale({namespace:ns,refs:chosen}));};
  for(const neighbor of refs.slice(1))await propose([refs[0],neighbor],[[1,0,'supports-decision'],[1,0,'challenges-premise']]);
  await propose(refs.slice(1,3),[[1,0,'challenges-premise']]);
  assert.deepEqual(markers(f),[]);
  assert.equal(f.core.getRationale({namespace:ns,...refs[0],revision:refs[0].revision+1}).error.code,'revision_conflict');
  assert.equal(f.core.getRationale({namespace:ns,...refs[0]}).error.code,'rationale_limit');
});

for(const operation of operations) test(`source snapshots, rationale recall and legacy delivery ${operation}`,async t=>{
  const f=await fixture(t,'ordinary-53',operation),[b,a]=await capture(f);
  const denied=ok(f.core.get({namespace:ns,memoryId:b.id})).receipts[0].id;
  ok(act(f,operation,a));f.model.countTokens=()=>1;
  const snapshot=f.core.sourceSnapshot({readSet:[ns],limit:12});
  assert.equal(snapshot.ok,false);
  assert.equal(JSON.stringify(snapshot).includes('complete-current-admitted'),false);
  const recall=await f.core.recall({readSet:[ns],query:survivor,limit:8,contextMode:'rationale-evidence'});
  assert.deepEqual(recall,{ok:false,error:{code:'source_unavailable',retryable:false}});
  const store=openMemoryStore({path:f.path});t.after(()=>store.close());
  const legacy=store.scope({ownerId:ns.ownerId,projectId:ns.projectId});
  const values=[snapshot,recall,legacy.get(b.id),legacy.list({limit:20}),legacy.search('Synthetic',{limit:20})];
  for(const result of values){if(result!==snapshot&&result!==recall)assert.ok(hasId(result,b.id));noLeak(result,'source and legacy delivery');assert.equal(hasId(result,denied),false);}
  assert.deepEqual(legacy.get(b.id).receipts,[]);
});

for(const operation of operations) for(const mixed of [false,true])
test(`core review inputs reach the real adapter after withholding ${operation}, mixed=${mixed}`,async t=>{
  const f=await fixture(t,'ordinary-53',operation),[b,a]=await capture(f);
  const denied=ok(f.core.get({namespace:ns,memoryId:b.id})).receipts[0].id,memories=[b];
  if(mixed)memories.push(ok(f.core.admit({namespace:ns,memory:{content:'Synthetic independent review claim',kind:'fact'},receipts:[receipt('synthetic-review-independent')]})).memory);
  ok(act(f,operation,a));
  const requests=[];
  const adapter=createOpenAIModel({apiKey:'synthetic',fetchImpl:async(url,options)=>{
    const body=JSON.parse(options.body);requests.push(body);
    noLeak(body,'actual adapter request');assert.equal(hasId(body,denied),false);
    const wire=JSON.parse(body.input[0].content[0].text);
    assert.deepEqual(wire.memories[0].receipts,[]);
    if(url.endsWith('/input_tokens'))return Response.json({object:'response.input_tokens',input_tokens:100});
    return Response.json({object:'response',model:body.model,status:'completed',error:null,incomplete_details:null,
      output:[{type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:JSON.stringify(body.text.format.name==='cairn_reviewBasis'?{units:[],links:[]}:{edges:[]})}]}],
      usage:{input_tokens:100,output_tokens:10,total_tokens:110}});
  }});
  f.model.reviewBasis=adapter.reviewBasis;f.model.relate=adapter.relate;f.model.countTokens=()=>1;
  const refs=memories.map(({id:memoryId,revision})=>({memoryId,revision}));
  const basis=ok(await f.core.reviewDecisionBasis({namespace:ns,refs}));
  const rationale=ok(await f.core.reviewRationale({namespace:ns,refs}));
  for(const result of [basis,rationale]){noLeak(result,'core review result');assert.equal(hasId(result,denied),false);}
  assert.equal(requests.length,mixed?4:0,'all-empty reviews return locally; mixed reviews use count and generation');
});
