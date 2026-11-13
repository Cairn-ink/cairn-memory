import test from 'node:test';
import assert from 'node:assert/strict';
import { openMemoryCore } from '../index.mjs';
import { lineageFixture, lineageHost, ns, ok, receipt } from '../testing/card-lineage-fixture.mjs';
import { safetyFixture } from '../testing/content-safety-s2h-fixture.mjs';
import { model, input as episodeInput, setup } from '../testing/episode-capture-helpers.mjs';
import { options } from '../testing/episode-helpers.mjs';

const survivor = 'Synthetic retained Episode signal';
const forgotten = 'Synthetic forgotten Episode wording';
const text = survivor + '. ' + forgotten + '.';

for (const kind of ['fresh', 'base33', 'package48', 'lineage53'])
for (const operation of ['forget', 'correct', 'reject'])
for (const linked of [false, true])
test(`Episode source and receipt withholding ${kind} ${operation}, linked=${linked}`, async t => {
  const items = [{ content: survivor, kind: 'fact', confidence: .8, sourceIndices: [0] }];
  const target = { content: forgotten, kind: operation === 'reject' ? 'decision' : 'fact', confidence: .8, sourceIndices: [0] };
  if (linked) items.push(target);
  const config = { ...options, decisionReview: 'required-v1', model: model({ extract: () => ({ items }) }) };
  let f;
  if (kind === 'lineage53') f = await lineageFixture(t, { base: 33, options: config });
  else if (kind === 'fresh') f = setup(t, { extract: () => ({ items }) }, { decisionReview: 'required-v1' });
  else {
    f = safetyFixture(t, 33);
    if (kind === 'package48') await f.migrate();
    const host = lineageHost();
    f.core = openMemoryCore({ path: f.path, privateCards: host.options, ...config });
    f.db = f.connect();
    t.after(() => { f.core.close(); f.db.close(); });
  }
  const input = episodeInput(1, 'synthetic-shared-episode', { namespace: ns,
    messages: [{ id: 'synthetic-shared-message', role: 'user', content: text }] });
  const captured = ok(await f.core.capture(input)), episodeId = captured.episode.id;
  const b = captured.admission.memories[0];
  const saved = ok(f.core.get({ namespace: ns, memoryId: b.id })).receipts[0];
  let a = captured.admission.memories[1];
  if (!linked) {
    // Use the Episode receipt's origin coordinates through ordinary capture,
    // so this Memory has the same message address but no Episode link.
    const ordinary = openMemoryCore({ path: f.path, decisionReview: 'required-v1',
      model: model({ extract: () => ({ items: [target] }) }) });
    t.after(() => ordinary.close());
    a = ok(await ordinary.capture({ namespace: ns, client: saved.client, sessionId: saved.sessionId,
      eventId: 'synthetic-unlinked-batch', messages: [{ id: saved.eventId, role: saved.role, content: saved.excerpt }] })).admission.memories[0];
  }
  const withheldIds = [b, a].flatMap(memory => f.db.prepare('SELECT id FROM receipts WHERE memory_id=?').all(memory.id).map(row => row.id));
  const request = { namespace: ns, episodeId, sourceLimit: 16, memoryLimit: 50 };
  if (linked && operation === 'reject') {
    // As before: an awaiting linked decision hides the whole Episode.
    assert.equal(f.core.getEpisode(request).error.code, 'episode_not_found');
  } else assert.ok(ok(f.core.getEpisode(request)).sources.items.some(source => source.text === text));
  const action = { namespace: ns, memoryId: a.id, expectedRevision: a.revision };
  ok(operation === 'correct' ? f.core.correct({ ...action, content: 'Synthetic corrected Episode claim', kind: 'fact',
    receipt: receipt('synthetic-episode-correction') }) : f.core[operation]({ ...action,
    ...(operation === 'reject' ? { actionId: 'synthetic-episode-rejection' } : {}) }));
  // This line exposes getEpisode on lineage-enabled stores; it has no separate
  // getEpisodeWithLineage method. Exercise that actual public composition.
  const result = f.core.getEpisode(request);
  if (linked && operation === 'correct' && ['package48', 'lineage53'].includes(kind)) {
    // The base already refuses the retained old admission reference against
    // the correction revision-through fact; markers do not cause this refusal.
    assert.equal(result.error.code, 'evidence_unavailable');
    assert.equal(f.db.prepare('SELECT deleted FROM session_episodes WHERE id=?').get(episodeId).deleted, 0);
    assert.equal(f.db.prepare('SELECT count(*) n FROM episode_sources WHERE episode_id=?').get(episodeId).n, 0);
    return;
  }
  const value = ok(result), serialized = JSON.stringify(result);
  if (linked) assert.equal(value.episode.processing.state, 'invalidated');
  assert.equal(serialized.includes(forgotten), false);
  assert.equal(serialized.includes(text), false);
  for (const id of withheldIds) assert.equal(serialized.includes(id), false, 'withheld receipt id anywhere in the response');
  assert.equal(value.episode.id, episodeId);
  assert.equal(value.sources.items.length, 0);
  const link = value.memoryLinks.items.find(link => link.memoryId === b.id);
  assert.ok(link, 'the surviving Memory link remains');
  assert.deepEqual(link.receiptIds, []);
  const memory = ok(f.core.get({ namespace: ns, memoryId: b.id }));
  assert.equal(memory.memory.content, survivor);
  assert.equal(memory.memory.revision, b.revision);
});

for(const operation of ['forget','correct','correct-reused-address','reject'])
test(`withheld Episode projects complete base invalidation ${operation}`,async t=>{
  const target={content:forgotten,kind:operation==='reject'?'decision':'fact',confidence:.8,sourceIndices:[0]};
  const port=model({extract:()=>({items:[{content:survivor,kind:'fact',confidence:.8,sourceIndices:[0]}]}),
    interpretEpisode:request=>{
      const field=(value,index=1)=>{index=Math.min(index,request.input.sources.length-1);return {value,anchors:[{sourceIndex:index,start:0,end:request.input.sources[index].text.length}]};};
      return {type:field('work',0),language:'mixed',gist:field('Synthetic complete gist'),outcome:field('Synthetic outcome'),
        nextStep:field('Synthetic open next step'),disposition:null};
    }});
  const f=await lineageFixture(t,{base:33,options:{...options,decisionReview:'required-v1',model:port}});
  const captured=ok(await f.core.capture(episodeInput(1,'synthetic-projection-episode',{namespace:ns,
    messages:[{id:'synthetic-projection-message',role:'user',content:text},
      {id:'synthetic-independent-episode-message',role:'user',content:'Synthetic independent Episode source'}]})));
  const episodeId=captured.episode.id,b=captured.admission.memories[0];
  const request={namespace:ns,episodeId,sourceLimit:16,memoryLimit:50};
  const before=ok(f.core.getEpisode(request));assert.equal(before.episode.processing.state,'ready');assert.equal(before.episode.nextStep.status,'open');
  const saved=ok(f.core.get({namespace:ns,memoryId:b.id})).receipts[0];
  // Independent ordinary capture shares the message address without creating
  // the Episode link that would trigger native storage invalidation.
  const ordinary=openMemoryCore({path:f.path,decisionReview:'required-v1',model:model({extract:()=>({items:[target]})})});t.after(()=>ordinary.close());
  const a=ok(await ordinary.capture({namespace:ns,client:saved.client,sessionId:saved.sessionId,eventId:'synthetic-independent-target',
    messages:[{id:saved.eventId,role:saved.role,content:saved.excerpt}]})).admission.memories[0];
  port.extract=()=>({items:[]});
  const second=ok(await f.core.capture(episodeInput(1,'synthetic-unaffected-episode',{namespace:ns,
    messages:[{id:'synthetic-unaffected-message',role:'user',content:'Synthetic separate source'}]}))).episode.id;
  const unaffected=ok(f.core.getEpisode({...request,episodeId:second}));
  const current=ok(f.core.getEpisode(request));
  const stored=f.db.prepare('SELECT record FROM session_episodes WHERE id=?').get(episodeId).record;
  const action={namespace:ns,memoryId:a.id,expectedRevision:a.revision};
  ok(operation.startsWith('correct')?ordinary.correct({...action,content:'Synthetic correction',kind:'fact',
    receipt:operation==='correct-reused-address'?{client:saved.client,sessionId:saved.sessionId,eventId:saved.eventId,role:saved.role,excerpt:'Synthetic replacement excerpt'}:receipt('synthetic-projection-correction')}):
    ordinary[operation]({...action,...(operation==='reject'?{actionId:'synthetic-projection-rejection'}:{})}));
  const projected=ok(f.core.getEpisode(request));
  assert.equal(f.db.prepare('SELECT record FROM session_episodes WHERE id=?').get(episodeId).record,stored,'projection never writes');
  const expected={clientLabel:null,eventStart:null,eventEnd:null,eventTimeCoverage:'unknown',interpretedAt:null,type:null,language:null,
    gist:null,outcome:null,nextStep:null,anchors:{},modelMetadata:null,semanticSupport:'unassessed',editor:{},
    processing:{state:'invalidated',missing:0,expired:0,omitted:0,errorCode:null,
      observed:current.episode.processing.observed,attempted:current.episode.processing.attempted,covered:current.episode.processing.covered}};
  for(const [field,value]of Object.entries(expected))assert.deepEqual(projected.episode[field],value,field);
  assert.deepEqual(projected.sources.items.map(source=>source.text),['Synthetic independent Episode source']);assert.ok(projected.memoryLinks.items.some(link=>link.memoryId===b.id));
  assert.deepEqual(projected.memoryLinks.items.find(link=>link.memoryId===b.id).receiptIds,[]);
  const next=ok(f.core.sessionStartContext({namespace:ns,groups:{nextSteps:true,procedural:false},maxTokens:2000,maxChars:8000}));
  assert.equal(next.groups.nextSteps.items.some(item=>item.episodeId===episodeId),false);
  const unchanged=ok(f.core.getEpisode({...request,episodeId:second}));
  assert.deepEqual(unchanged.episode,unaffected.episode);
  assert.deepEqual(unchanged.sources.items,unaffected.sources.items);
  // Compare each interpretation field with the native base invalidation seam.
  const {createEpisodeStorage}=await import('../episode-storage.mjs');
  createEpisodeStorage({db:f.db,advanceEpoch:()=>{}}).invalidateSources(ns,episodeId);
  const invalidated=ok(f.core.getEpisode(request));
  for(const field of Object.keys(expected))assert.deepEqual(projected.episode[field],invalidated.episode[field],field);
});

for(const operation of ['forget','correct','reject'])
test(`Episode listing and next steps scan past withheld candidates ${operation}`,async t=>{
  const port=model({extract:({input})=>({items:[{content:'Synthetic retained '+input.messages[0].content,kind:'fact',confidence:.8,sourceIndices:[0]}]}),
    interpretEpisode:request=>{
      const field=value=>({value,anchors:[{sourceIndex:0,start:0,end:request.input.sources[0].text.length}]});
      return {type:field('work'),language:'mixed',gist:field('Synthetic derived wording'),outcome:null,nextStep:field('Synthetic next action'),disposition:null};
    }});
  const f=await lineageFixture(t,{base:33,options:{...options,decisionReview:'required-v1',model:port}}),episodes=[];
  for(let i=0;i<15;i++) {
    const result=ok(await f.core.capture(episodeInput(1,'synthetic-scan-'+i,{namespace:ns,
      messages:[{id:'synthetic-scan-source-'+i,role:'user',content:'Synthetic scan evidence '+i,occurredAt:'1901-02-03T04:05:06.789Z'}]})));
    const memory=result.admission.memories[0],saved=ok(f.core.get({namespace:ns,memoryId:memory.id})).receipts[0];
    episodes.push({id:result.episode.id,saved});
  }
  const sorted=f.db.prepare("SELECT id FROM session_episodes ORDER BY json_extract(record,'$.eventEnd') DESC,id").all().map(row=>episodes.find(e=>e.id===row.id));
  const ordinary=openMemoryCore({path:f.path,decisionReview:'required-v1',model:model({extract:({input})=>({items:[{
    content:'Synthetic terminal '+input.messages[0].content,kind:operation==='reject'?'decision':'fact',confidence:.8,sourceIndices:[0]}]})})});
  t.after(()=>ordinary.close());
  const receiptIds=[];
  for(const {saved,id}of sorted.slice(0,13)) {
    receiptIds.push(saved.id);
    const target=ok(await ordinary.capture({namespace:ns,client:saved.client,sessionId:saved.sessionId,eventId:'synthetic-terminal-'+id,
      messages:[{id:saved.eventId,role:saved.role,content:saved.excerpt}]})).admission.memories[0];
    const action={namespace:ns,memoryId:target.id,expectedRevision:target.revision};
    ok(operation==='correct'?ordinary.correct({...action,content:'Synthetic replacement '+id,kind:'fact',receipt:receipt('synthetic-scan-correction-'+id)}):
      ordinary[operation]({...action,...(operation==='reject'?{actionId:'synthetic-scan-rejection-'+id}:{})}));
  }
  const input={namespace:ns,since:'1901-02-01T00:00:00.000Z',until:'1901-03-01T00:00:00.000Z',timeBasis:'event',limit:1};
  const first=ok(f.core.listEpisodes(input));
  assert.deepEqual(first.items.map(item=>item.id),[sorted[13].id]);assert.equal(first.exhausted,false);assert.ok(first.nextCursor);
  const second=ok(f.core.listEpisodes({...input,cursor:first.nextCursor}));
  assert.deepEqual(second.items.map(item=>item.id),[sorted[14].id]);assert.equal(second.exhausted,true);assert.equal(second.nextCursor,null);
  const received=ok(f.core.listEpisodes({...input,timeBasis:'receipt',limit:50}));
  assert.equal(received.items.length,15);
  for(const item of received.items.filter(item=>sorted.slice(0,13).some(e=>e.id===item.id))) {
    assert.equal(item.gist,null);assert.equal(item.nextStep,null);assert.equal(item.eventEnd,null);assert.equal(item.processing.state,'invalidated');
  }
  const context=ok(f.core.sessionStartContext({namespace:ns,groups:{nextSteps:true,procedural:false},maxTokens:2000,maxChars:8000}));
  assert.deepEqual(context.groups.nextSteps.items.map(item=>item.episodeId),[sorted[13].id]);
  const encoded=JSON.stringify({first,second,received,context});
  for(const item of sorted.slice(0,13)){assert.equal(encoded.includes(item.saved.excerpt),false);assert.equal(encoded.includes(item.saved.id),false);}
});

test('Episode link and source continuation filter each physical page',async t=>{
  let batch=0;
  const port=model({extract:()=>({items:Array.from({length:9},(_,i)=>({content:`Synthetic linked claim ${batch}-${i}`,kind:'fact',confidence:.8,sourceIndices:[0]}))})});
  const f=await lineageFixture(t,{base:33,options:{...options,model:port}}),saved=[];
  let episodeId;
  for(batch=1;batch<=6;batch++) {
    const result=ok(await f.core.capture(episodeInput(batch,'synthetic-link-continuation',{namespace:ns})));
    episodeId=result.episode.id;
    saved.push(ok(f.core.get({namespace:ns,memoryId:result.admission.memories[0].id})).receipts[0]);
  }
  const request={namespace:ns,episodeId,sourceLimit:1,memoryLimit:50};
  const before=ok(f.core.getEpisode(request));
  assert.ok(before.sources.nextCursor,'six sources require source continuation');
  assert.ok(before.memoryLinks.nextCursor,'fifty-four links require link continuation');
  const ordinary=openMemoryCore({path:f.path,model:model({extract:({input})=>({items:[{content:'Synthetic withheld '+input.messages[0].content,kind:'fact',confidence:.8,sourceIndices:[0]}]})})});
  t.after(()=>ordinary.close());
  const withheld=[];
  for(const source of saved.slice(0,3)) {
    const target=ok(await ordinary.capture({namespace:ns,client:source.client,sessionId:source.sessionId,eventId:'synthetic-links-'+source.eventId,
      messages:[{id:source.eventId,role:source.role,content:source.excerpt}]})).admission.memories[0];
    withheld.push(...f.db.prepare('SELECT id FROM receipts WHERE receipt_key=(SELECT receipt_key FROM receipts WHERE id=?)').all(source.id).map(row=>row.id));
    ok(ordinary.forget({namespace:ns,memoryId:target.id,expectedRevision:target.revision}));
  }
  const links=[],sources=[];
  for(const kind of ['sources','memoryLinks']) {
    let cursor;
    do {
      const page=ok(f.core.getEpisode({...request,...(cursor?{[kind==='sources'?'sourceCursor':'memoryCursor']:cursor}:{})}));
      (kind==='sources'?sources:links).push(...page[kind].items);
      cursor=page[kind].nextCursor;
      for(const id of withheld)assert.equal(JSON.stringify(page).includes(id),false);
      for(const source of saved.slice(0,3))assert.equal(JSON.stringify(page).includes(source.excerpt),false);
    } while(cursor);
  }
  assert.equal(new Set(links.map(link=>link.memoryId)).size,54);
  assert.equal(new Set(sources.map(source=>source.id)).size,3);
  assert.ok(links.some(link=>link.receiptIds.length===0));
});
