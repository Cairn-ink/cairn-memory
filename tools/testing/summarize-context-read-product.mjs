import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
export async function summarize(path,write=line=>console.log(line)) {
  const tally={},blocks=[];let cells=0,final=null;
  async function scan(source) {
    for await(const line of createInterface({input:createReadStream(source),crlfDelay:Infinity})) {
      let r;try{r=JSON.parse(line);}catch{continue;}
      if(r.type==='cell'){cells++;const d=r.decision.decision;tally[d]=(tally[d]??0)+1;}
      if(r.type==='record')for(const name of ['hostLoop','launcherLoop','startupLoop'])for(const b of r.record[name]?.blocks??[])
        blocks.push({cell:r.cell,series:r.series,source:name,gapMs:b.gapMs,gc:b.gc?.length??0,
          major:b.resources?.majorPageFault??null,minor:b.resources?.minorPageFault??null,
          voluntary:b.resources?.voluntaryContextSwitches??null,involuntary:b.resources?.involuntaryContextSwitches??null,
          cpuUs:b.resources?(b.resources.userCPUTime+b.resources.systemCPUTime):null,
          runqueueNs:b.scheduling?.threads?.reduce((n,t)=>n+t.runqueueNs,0)??null,swap:b.scheduling?.vm??null});
      if(r.type==='final')final=r.status;
    }
  }
  await scan(path);
  if(!path.endsWith('.records.jsonl')) {
    const base=path.endsWith('.partial')?path.slice(0,-8):path;
    if(await stat(base+'.records.jsonl').then(()=>true,e=>{if(e.code==='ENOENT')return false;throw e;}))await scan(base+'.records.jsonl');
  }
  write(JSON.stringify({cells,tally,status:final??'interrupted'}));
  write('cell series source gapMs overlappingGC major minor voluntary involuntary cpuUs runqueueNs swap');
  for(const b of blocks)write([b.cell,b.series,b.source,b.gapMs,b.gc,b.major,b.minor,b.voluntary,b.involuntary,b.cpuUs,b.runqueueNs,JSON.stringify(b.swap)].join(' '));
  return {cells,tally,blocks,status:final??'interrupted'};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await summarize(process.argv[2]);
