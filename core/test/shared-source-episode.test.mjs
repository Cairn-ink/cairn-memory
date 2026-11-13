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
      const field=value=>({value,anchors:[{sourceIndex:0,start:0,end:request.input.sources[0].text.length}]});
      return {type:field('work'),language:'mixed',gist:field('Synthetic complete gist'),outcome:field('Synthetic outcome'),
        nextStep:field('Synthetic open next step'),disposition:null};
    }});
  const f=await lineageFixture(t,{base:33,options:{...options,decisionReview:'required-v1',model:port}});
  const captured=ok(await f.core.capture(episodeInput(1,'synthetic-projection-episode',{namespace:ns,
    messages:[{id:'synthetic-projection-message',role:'user',content:text}]})));
  const episodeId=captured.episode.id,b=captured.admission.memories[0];
  const request={namespace:ns,episodeId,sourceLimit:16,memoryLimit:50};
  const before=ok(f.core.getEpisode(request));assert.equal(before.episode.processing.state,'ready');assert.equal(before.episode.nextStep.status,'open');
  const saved=ok(f.core.get({namespace:ns,memoryId:b.id})).receipts[0];
  // Independent ordinary capture shares the message address without creating
  // the Episode link that would trigger native storage invalidation.
  const ordinary=openMemoryCore({path:f.path,decisionReview:'required-v1',model:model({extract:()=>({items:[target]})})});t.after(()=>ordinary.close());
  const a=ok(await ordinary.capture({namespace:ns,client:saved.client,sessionId:saved.sessionId,eventId:'synthetic-independent-target',
    messages:[{id:saved.eventId,role:saved.role,content:saved.excerpt}]})).admission.memories[0];
  const second=ok(await f.core.capture(episodeInput(1,'synthetic-unaffected-episode',{namespace:ns,
    messages:[{id:'synthetic-unaffected-message',role:'user',content:'Synthetic separate source'}]}))).episode.id;
  const unaffected=ok(f.core.getEpisode({...request,episodeId:second}));
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
      observed:before.episode.processing.observed,attempted:before.episode.processing.attempted,covered:before.episode.processing.covered}};
  for(const [field,value]of Object.entries(expected))assert.deepEqual(projected.episode[field],value,field);
  assert.equal(projected.sources.items.length,0);assert.ok(projected.memoryLinks.items.some(link=>link.memoryId===b.id));
  assert.deepEqual(projected.memoryLinks.items.find(link=>link.memoryId===b.id).receiptIds,[]);
  const next=ok(f.core.sessionStartContext({namespace:ns,groups:{nextSteps:true,procedural:false},maxTokens:2000,maxChars:8000}));
  assert.equal(next.groups.nextSteps.items.some(item=>item.episodeId===episodeId),false);
  assert.deepEqual(ok(f.core.getEpisode({...request,episodeId:second})),unaffected);
  // Compare each interpretation field with the native base invalidation seam.
  const {createEpisodeStorage}=await import('../episode-storage.mjs');
  createEpisodeStorage({db:f.db,advanceEpoch:()=>{}}).invalidateSources(ns,episodeId);
  const invalidated=ok(f.core.getEpisode(request));
  for(const field of Object.keys(expected))assert.deepEqual(projected.episode[field],invalidated.episode[field],field);
});
