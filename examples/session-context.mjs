// Synthetic local read/closure demo. It measures orchestration, not semantic fidelity.
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openMemoryCore } from '../core/index.mjs';
const directory=mkdtempSync(join(tmpdir(),'cairn-session-context-'));
const namespace={ownerId:'synthetic-demo',scope:'project',projectId:'demo'};
const path=join(directory,'memory.sqlite');
const ok=result=>{assert.equal(result.ok,true,JSON.stringify(result));return result.value;};
const writer=openMemoryCore({path,sessionEpisodes:{mode:'episode-v1'},captureQualification:'source-bound-v2',captureEvidence:'staged-v1',
  model:{contextWindow:8192,countTokens:()=>1,extract:()=>({items:[]}),interpretEpisode({input}){
    const field=value=>({value,anchors:[{sourceIndex:0,start:0,end:input.sources[0].text.length}]});
    return {type:field('work'),language:'en',gist:field('Reviewed demo.'),outcome:null,nextStep:field('Review next change.'),disposition:null};
  }}});
let reader;
try {
  const capture=ok(await writer.capture({namespace,client:'demo',sessionId:'synthetic-session',eventId:'first',
    episodeContext:{clientLabel:'Demo',generation:'initial',origin:'ordinary'},
    messages:[{id:'message',role:'user',content:'Review next change.',occurredAt:'2026-09-28T00:00:00.000Z'}]}));
  ok(writer.admit({namespace,memory:{content:'Keep reviews concise.',kind:'instruction'},receipts:[
    {client:'demo',sessionId:'explicit',eventId:'instruction',role:'user',excerpt:'Keep reviews concise.'}]}));
  writer.close();
  const forbidden=()=>{throw Error('Read paths must not generate');};
  reader=openMemoryCore({path,model:{countTokens:text=>Array.from(text).length,
    extract:forbidden,interpretEpisode:forbidden,classify:forbidden,select:forbidden}});
  const context=ok(reader.sessionStartContext({namespace,maxTokens:2000}));
  assert.equal(context.groups.nextSteps.returned,1);assert.equal(context.groups.procedural.returned,1);
  assert.match(context.framing,/not execution permission/);
  const range=ok(reader.listEpisodes({namespace,since:'2026-09-28T00:00:00.000Z',until:'2026-09-29T00:00:00.000Z'}));
  assert.equal(range.items[0].id,capture.episode.id);
  const item=context.groups.nextSteps.items[0];
  const close={namespace,episodeId:item.episodeId,expectedRevision:item.revision,stepId:item.nextStep.id,actionId:'demo-close',action:'completed'};
  assert.deepEqual(ok(reader.closeEpisodeNextStep(close)),ok(reader.closeEpisodeNextStep(close)));
  assert.equal(ok(reader.sessionStartContext({namespace})).groups.nextSteps.returned,0);
  console.log('Synthetic session context: scoped sources, framing, range read and inert closure replay verified.');
} finally {reader?.close();writer.close();rmSync(directory,{recursive:true,force:true});}
