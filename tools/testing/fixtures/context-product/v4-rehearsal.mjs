// Explicit tiny, non-qualifying orchestration. No gates, quantiles or timing outputs.
import { join } from 'node:path';
import { createTestWorkspace } from '../../workspace.mjs';
import { storage,prepareCell,prepareInput,backupSeries } from '../../measure-context-read-product.mjs';
import { generateSnapshot } from '../../../../evaluation/context-read-qualification/generate.mjs';
import { inventory,overflowInventory,otherOwnerNamespace } from '../../../../evaluation/context-read-qualification/corpus.mjs';
import { createCounter } from '../../../../evaluation/context-read-qualification/counter.mjs';
import { build,requestSeries } from './series.mjs';
import { exposureCell } from './v4-windows.mjs';
import { sharedSession } from './v4-session.mjs';
import { stateCell } from './v4-state.mjs';
import { methodProfile,V4 } from './v4-plan.mjs';
import { createReportSink } from './report.mjs';
import { rehearsalDecision,readWorks,functionalEvidence } from './rehearsal-checks.mjs';
export async function rehearseV4(input,{reportPath}) {
  if(process.version!=='v24.22.1')throw Error('rehearsal_requires_production_node_v24.22.1');
  await createCounter(input.counterConfiguration);
  const w=createTestWorkspace(null,{parent:input.volumeRoot,prefix:'product-rehearsal-'}),raw=await createReportSink(reportPath,{protocol:'P2-product-v4',mode:'rehearse',qualifying:false,timingGates:false,timingClaims:false,rehearsalSettings:{windowMs:5000,sessionMs:6000,pump:{pollMs:250,budgets:{maxItems:100000,maxMs:60000},sessionQuantum:{maxItems:1024,maxMs:1000},source:'test tooling; enlarged tiny-window allowance; production quotas remain registered separately'},sessionWorld:{memories:4,cards:1},samplesPerSeries:1,targetsPerType:1,probeLanes:2,availabilityLanes:1},node:process.version,inventory:[]});
  // Delegation carries the mode into the session child, which applies the same filter.
  const sink={record:(c,s,r)=>raw.record(c,s,functionalEvidence(r)),delegate:async()=>({...await raw.delegate(),rehearsal:true}),reclaim:n=>raw.reclaim(n)};
  const decisions=[];let cleanup=true;
  try {
    const path=join(w.path,'tiny.sqlite');generateSnapshot({schema:23,count:32,cards:4},path);
    const sessionPath=join(w.path,'tiny-session.sqlite');generateSnapshot({schema:23,count:4,cards:1},sessionPath);
    const registration={...input,pump:{...input.pump,pollMs:250,budgets:{maxItems:100000,maxMs:60000}},fixtures:[{id:'tiny',schema:23,count:32,cards:4,path,inventory,overflowInventory,selectionRevision:'qualification-selection-r1',otherOwnerNamespace},{id:'tiny-session',schema:23,count:4,cards:1,path:sessionPath,inventory,overflowInventory,selectionRevision:'qualification-selection-r1',otherOwnerNamespace}],rehearsal:true};
    const adapter=await import(input.adapterModule),prepare=async(cell,suffix)=>{
      const c=await prepareCell(registration,cell,w,null,suffix);
      return {...c,rehearsal:true,protocol:'P2-product-v4',supervision:input.supervision,sameNamespace:c.readSet[0],otherOwnerNamespace,inspectLedger:async()=>(await storage('inspect',{path:c.path})).value};
    };
    const request=async(c,slot=c.cell)=>({...await prepareInput({...c,cell:slot,method:slot.method??c.method},adapter),oracle:adapter.validate});
    const built=async c=>{const b=await build(c,(s,r)=>sink.record(c.cell.id,s,r));return {...c,maintainerCoverage:b.coverage,maintainerDiagnostics:b.diagnostics.map(r=>r.diagnostics)};};
    const base={protocol:'P2-product-v4',scope:'launch',count:32,schema:23,canonical:'WAL',sidecar:'WAL',intent:'current',language:'mixed',load:'idle',...methodProfile('c12')};
    const run=async(name,fn)=>{console.error(JSON.stringify({rehearsal:name}));let d;try{d=await fn();}catch(e){if(e.cleanup?.descendantsUnconfirmed){cleanup=false;throw e;}d=rehearsalDecision([e.code??e.message]);}decisions.push({kind:name,...d});await raw.cell({id:decisions.length-1,kind:name},functionalEvidence(d));};
    for(const kind of ['requests','overflow'])await run(kind,async()=>{
      const cell={...base,id:decisions.length,key:kind,kind,scope:kind==='overflow'?'overflow':'launch',series:['warmups','main','cold','warm-reference'],sampleRules:Object.fromEntries(['warmups','main','cold','warm-reference'].map(s=>[s,{minimum:1,ceiling:1}]))};
      return (await requestSeries(await request(await built(await prepare(cell,kind))),{cell,sink,oracle:adapter.validate},{prepareAttempt:request})).decision;
    });
    await run('exposure/W+WM',async()=>{
      const cell={...base,id:2,key:'W',kind:'exposure',windows:1,load:'fresh-other',references:V4.series.windowReference.seriesOrder.map(([label,intent])=>({...methodProfile(label),intent,language:'language-rotation-v4'}))};
      return exposureCell(cell,{sink,prepareInput:request,prepareClone:async suffix=>built(await prepare(cell,'W-'+suffix))});
    });
    await run('F/A session',async()=>{
      const cell={...base,id:3,key:'F',kind:'freshness',type:'memory',count:4},config=await built({...await prepare(cell,'FA'),pump:{...registration.pump,id:'rehearsal-FA',quantum:{maxItems:1024,maxMs:1000}}});
      const targets=['memory','card'].map((type,n)=>({id:'tiny-'+type,type,probe:'rehearsaluniquetarget'+n,batch:0,createMs:0,reviewMs:2000}));
      const session={key:'tiny-FA',durationMs:6000,probeLanes:2,availabilityLanes:1,probeEveryMs:250,writer:{lifecycle:'fresh',target:'same-projection',cadenceMs:20,backlog:false,keeper:false,operations:['capture','review'],startMs:0,endMs:6000},targets,batches:[{ordinal:0,query:targets.map(t=>t.probe).join(' ')}],availability:['current','history'].flatMap((intent,i)=>['c12','a1500'].map((methodLabel,k)=>({id:intent+k,releaseMs:i*1200+k*2400,intent,methodLabel,language:['zh','ja'][k]})))};
      const cells=[cell,{...cell,key:'A',kind:'availability'}];
      const result=await sharedSession(cells,session,{config,sink});return result.get('F');
    });
    await run('backup/B',async()=>{
      const cell={...base,id:4,key:'B',kind:'backup'},config=await request(await built(await prepare(cell,'B')));
      let works=false;const observed={...sink,record:async(c,s,r)=>{if(s==='restored-reader')works=readWorks(r);await sink.record(c,s,r);}};
      const d=await backupSeries(config,cell,w,observed,adapter.validate);
      return rehearsalDecision(works&&d.outputs?.verifiedIntents?.length===2?[]:['backup_functional']);
    });
    for(const injection of ['post-catch-up'])await run('state/T/'+injection,async()=>{
      const cell={...base,id:decisions.length,key:'T-'+injection,kind:'injection',injection,canonical:'DELETE',sidecar:'DELETE'},stateProbes=Object.fromEntries(V4.stateSubprobes[injection].map(p=>[cell.key+':'+p.id,'rehearsalcatchup'+p.id]));
      return stateCell(cell,{prepare,prepareInput:request,build:built,sink,input:{...input,rehearsal:true,stateProbes,stateDeadlines:injection==='abort'?{opening:500,candidates:500,fetch:500,assembly:500}:input.stateDeadlines}});
    });
  }finally {
    if(cleanup)await w.cleanup();
    else await raw.interrupt();
    if(cleanup)await raw.finish(decisions.length===6&&decisions.every(d=>d.functionalPassed)?'inconclusive':'failed',{functionalPassed:decisions.length===6&&decisions.every(d=>d.functionalPassed),cleanup:true,qualifying:false,timingClaims:false});
  }
  const functionalPassed=decisions.length===6&&decisions.every(d=>d.functionalPassed),status=functionalPassed?'inconclusive':'failed';
  console.log(status);return {status,functionalPassed,decisions};
}
