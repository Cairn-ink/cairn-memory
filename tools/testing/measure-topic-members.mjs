// E1M-11: opt-in only. No elapsed/overlap assertions in ordinary tests.
import { Worker } from 'node:worker_threads';
import { performance } from 'node:perf_hooks';
import { buildMemberWorld } from '../../core/testing/topic-members-world.mjs';
import { overview, expected } from '../../core/testing/topic-members-fixture.mjs';
const smoke=process.argv.includes('--smoke');
if(process.argv.slice(2).some(x=>x!=='--smoke'))throw Error('unexpected_measure_argument');
for(const count of smoke?[112]:[1112,3336]) for(const mode of ['DELETE','WAL']) {
  const {f,spaces}=buildMemberWorld(null,count,{mode});let worker;
  try {
    const reader=f.reader(),nodes=(await overview(reader,spaces[0])).items;
    const selection=expected(nodes.find(n=>n.level==='L2'));
    const reports=[],writerCalls=[];let hostMaximum=0,last=performance.now(),sequence=0;
    const clock=setInterval(()=>{const time=performance.now();hostMaximum=Math.max(hostMaximum,time-last);last=time;},1);
    try {
      worker=new Worker(new URL('./fixtures/topic-members-measure-worker.mjs',import.meta.url),{workerData:{path:f.path,ownerId:spaces[0].ownerId},env:{},execArgv:[]});
      const call=input=>new Promise((resolve,reject)=>{
        const done=value=>{worker.off('error',error);resolve(value);},error=e=>{worker.off('message',done);reject(e);};
        worker.once('message',done);worker.once('error',error);worker.postMessage(input);
      });
      for(const phase of ['cold','warm','revision-change']) {
        if(phase==='revision-change') {
          const start=performance.now();f.admit('revision-change-'+sequence++,'fact',spaces[0]);writerCalls.push({phase,start,end:performance.now(),committed:true});
        }
        let cursor;const started=performance.now(),calls=[];let emitted=0;
        do {
          const input={namespace:spaces[0],selection,accessRevision:'measure',limit:100,workLimit:5000,maxBytes:65536,deadlineMs:5000,...(cursor?{cursor}:{})};
          const pending=call(input);
          // Measure the writer CALL, excluding sleeps and fixture setup.
          // A write to another namespace preserves this traversal's fences.
          const start=performance.now();f.admit('overlap-'+sequence++,'context',spaces[1]);writerCalls.push({phase,start,end:performance.now(),committed:true});
          const reply=await pending;calls.push({work:reply.work,bytes:reply.bytes,start:reply.start,end:reply.end,error:reply.result.error?.code??null});
          if(!reply.result.ok)break;
          emitted+=reply.result.value.items.length;cursor=reply.result.value.nextCursor;
        }while(cursor);
        reports.push({phase,totalLatencyMs:performance.now()-started,emitted,calls});
      }
    } finally {clearInterval(clock);await worker?.terminate();worker=undefined;}
    const reads=reports.flatMap(r=>r.calls),overlapping=reads.filter(read=>writerCalls.some(write=>write.start<read.end&&read.start<write.end));
    console.log(JSON.stringify({acceptance:'E1M-11',runtime:process.version,count,mode,hostMainLoopMaximumMs:hostMaximum,
      reports,writerCalls,actualOverlappingReads:overlapping.length,actualOverlappingCommits:writerCalls.filter(write=>reads.some(read=>write.start<read.end&&read.start<write.end)).length,
      lockPolicy:'inherited openReadDatabase policy; E1-C selection pending primary',thresholds:null,performanceAcceptance:false}));
  }finally{await worker?.terminate();await f.workspace.cleanup();}
}
