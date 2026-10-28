import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const output=line=>new Promise((resolve,reject)=>process.stdout.write(line+'\n',error=>error?reject(error):resolve()));
export async function summarize(path,write=output) {
  const tally={},adapterReadCutoffs=new Map();let cells=0,final=null,blockCount=0,diagnostic=null;
  await write('cell series source startedAt finishedAt gapMs overlappingGC major minor voluntary involuntary cpuUs runqueueNs swap');
  async function scan(source) {
    for await(const line of createInterface({input:createReadStream(source),crlfDelay:Infinity})) {
      let r;try{r=JSON.parse(line);}catch{continue;}
      const label=r.type==='registration'?r.header:r;
      if(label?.diagnostic===true)diagnostic={qualifying:false,diagnostic:true,diagnosticReason:label.diagnosticReason};
      if(r.type==='cell') {
        cells++;const d=r.decision.decision;tally[d]=(tally[d]??0)+1;
        if(r.summary?.reader)await write(JSON.stringify({type:'reader-statistics',cell:r.cell.id,populations:r.summary.reader}));
      }
      if(r.type==='record'&&Object.hasOwn(r.record??{},'readExceededAdapterDefault')){
        const populations=r.record.populationIdentities??[{cell:r.cell,method:r.record.method,intent:r.record.intent??null}];
        const seen=new Set();for(const p of populations){
          const key=JSON.stringify([p.cell,p.method,p.intent??null]);if(seen.has(key))continue;seen.add(key);
          const row=adapterReadCutoffs.get(key)??{cell:p.cell,method:p.method,intent:p.intent??null,reads:0,exceeded1000Ms:0,noRead:0,gate:false};
          if(r.record.readExceededAdapterDefault===null)row.noRead++;else{row.reads++;row.exceeded1000Ms+=Number(r.record.readExceededAdapterDefault);}adapterReadCutoffs.set(key,row);
        }
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
  const result={...(diagnostic??{}),cells,tally,blockCount,status:final??'interrupted',adapterReadCutoffs:[...adapterReadCutoffs.values()]};
  await write(JSON.stringify(result));return result;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await summarize(process.argv[2]);
