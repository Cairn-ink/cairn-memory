// Offline orchestration example. Scripted labels are not semantic-fidelity evidence.
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openMemoryCore } from '../core/index.mjs';
const dir=mkdtempSync(join(tmpdir(),'cairn-episodes-demo-'));
const namespace={ownerId:'synthetic-demo',scope:'project',projectId:'demo'};
let calls=0;
const core=openMemoryCore({path:join(dir,'store.sqlite'),captureQualification:'source-bound-v2',captureEvidence:'staged-v1',
  sessionEpisodes:{mode:'episode-v1'},model:{contextWindow:8192,countTokens:()=>1,
    interpretEpisode:({input})=>{calls++;const sourceIndex=input.classificationTarget[0];
      const field=value=>({value,anchors:[{sourceIndex,start:0,end:input.sources[sourceIndex].text.length}]});
      return {type:field('quick-one-off-question'),language:'en',gist:field('Asked a one-off synthetic question.'),outcome:null,nextStep:null,disposition:null};},
    extract:()=>({items:[]})}});
const ok=result=>{assert.equal(result.ok,true,JSON.stringify(result));return result.value;};
try {
  const input={namespace,client:'demo',sessionId:'local-session',eventId:'first',
    episodeContext:{clientLabel:'Synthetic demo',generation:'initial',origin:'ordinary'},
    messages:[{id:'question',role:'user',content:'What is the synthetic demo about?',occurredAt:null}]};
  const captured=ok(await core.capture(input));
  const inspected=ok(core.getEpisode({namespace,episodeId:captured.episode.id}));
  assert.equal(inspected.episode.semanticSupport,'unassessed');assert.equal(inspected.sources.items.length,1);
  assert.equal(inspected.policies.items[0].policy,'skip-quick');
  ok(await core.keepEpisode({namespace,episodeId:captured.episode.id,expectedRevision:inspected.episode.revision,actionId:'keep'}));
  assert.equal(ok(await core.capture(input)).duplicate,true);assert.equal(calls,1);
  assert.equal(ok(core.inspectCaptureEvidence({namespace,client:'demo',eventId:'first'})).evidence.state,'released');
  console.log('Synthetic episode: retained passage, quick policy, explicit keep, release and replay verified.');
} finally {core.close();rmSync(dir,{recursive:true,force:true});}
