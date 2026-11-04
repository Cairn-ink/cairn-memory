// Earliest JS preload in a cold host. Observe entry/engine module startup;
// pause for harness configuration/oracle loading and stop before read observation.
import { performance, PerformanceObserver } from 'node:perf_hooks';
let active=true,last=performance.now(),usage=process.resourceUsage(),maxMs=0,over100=0;
const blocks=[],gc=[];
const fields=['userCPUTime','systemCPUTime','minorPageFault','majorPageFault','voluntaryContextSwitches','involuntaryContextSwitches'];
const observer=new PerformanceObserver(list=>{for(const e of list.getEntries())gc.push({threadId:0,startAt:performance.timeOrigin+e.startTime,durationMs:e.duration,kind:e.detail.kind});});
observer.observe({entryTypes:['gc']});
function sample(){if(!active)return;const now=performance.now(),next=process.resourceUsage(),gap=now-last;maxMs=Math.max(maxMs,gap);
  if(gap>100){over100++;blocks.push({startedAt:performance.timeOrigin+last,finishedAt:performance.timeOrigin+now,gapMs:gap,resources:Object.fromEntries(fields.map(k=>[k,next[k]-usage[k]]))});}last=now;usage=next;
}
const timer=setInterval(sample,1);let stopped;
globalThis[Symbol.for('product-cold-startup-loop')]={
  pause(){sample();active=false;},resume(){last=performance.now();usage=process.resourceUsage();active=true;},
  finish(){return stopped??=(async()=>{await new Promise(r=>setImmediate(r));await new Promise(r=>setTimeout(r,2));sample();clearInterval(timer);observer.disconnect();
    for(const block of blocks)block.gc=gc.filter(g=>g.startAt<block.finishedAt&&g.startAt+g.durationMs>block.startedAt);
    return {maxMs,over100,blocks};})();},
};
