import { PerformanceObserver, performance } from 'node:perf_hooks';
import { workerData, threadId } from 'node:worker_threads';
const port=workerData?.productGcPort;
if(port) {
  const observer=new PerformanceObserver(list=>{
    for(const e of list.getEntries())port.postMessage({threadId,startAt:performance.timeOrigin+e.startTime,durationMs:e.duration,kind:e.detail.kind});
  });observer.observe({entryTypes:['gc']});
}
