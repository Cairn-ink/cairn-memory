import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const output=line=>new Promise((resolve,reject)=>process.stdout.write(line+'\n',error=>error?reject(error):resolve()));
export async function summarize(path,write=output) {
  const tally={};let cells=0,final=null,blockCount=0;
  await write('cell series source startedAt finishedAt gapMs overlappingGC major minor voluntary involuntary cpuUs runqueueNs swap');
  async function scan(source) {
    for await(const line of createInterface({input:createReadStream(source),crlfDelay:Infinity})) {
      let r;try{r=JSON.parse(line);}catch{continue;}
      if(r.type==='cell') {
        cells++;const d=r.decision.decision;tally[d]=(tally[d]??0)+1;
        if(r.summary?.reader)await write(JSON.stringify({type:'reader-statistics',cell:r.cell.id,populations:r.summary.reader}));
      }
      if(r.type==='record')for(const name of ['hostLoop','launcherLoop','startupLoop']) {
        const loop=r.record?.[name];
        const blocks=loop?.blocks?.length?loop.blocks:loop?.maxMs>100?[{gapMs:loop.maxMs}]:[];
        for(const b of blocks) {
          blockCount++;
          const row=[r.cell,r.series,name,b.startedAt??'unavailable',b.finishedAt??'unavailable',b.gapMs,b.gc?.length??0,
            b.resources?.majorPageFault??'unavailable',b.resources?.minorPageFault??'unavailable',
            b.resources?.voluntaryContextSwitches??'unavailable',b.resources?.involuntaryContextSwitches??'unavailable',
            b.resources?b.resources.userCPUTime+b.resources.systemCPUTime:'unavailable',
            b.scheduling?.threads?.reduce((n,t)=>n+t.runqueueNs,0)??'unavailable',JSON.stringify(b.scheduling?.vm??null)];
          // Await the sink: neither diagnostics nor stdout backpressure retain
          // a report-wide row array. Memory is one JSONL row plus aggregates.
          await write(row.join(' '));
        }
      }
      if(r.type==='final')final=r.status;
    }
  }
  await scan(path);
  if(!path.endsWith('.records.jsonl')) {
    const base=path.endsWith('.partial')?path.slice(0,-8):path;
    if(await stat(base+'.records.jsonl').then(()=>true,e=>{if(e.code==='ENOENT')return false;throw e;}))await scan(base+'.records.jsonl');
  }
  const result={cells,tally,blockCount,status:final??'interrupted'};
  await write(JSON.stringify(result));return result;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await summarize(process.argv[2]);
