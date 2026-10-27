import { open, rename } from 'node:fs/promises';
import { createHash } from 'node:crypto';
export const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function immutable(value) {
  for(const child of Object.values(value))if(child&&typeof child==='object')immutable(child);
  return Object.freeze(value);
}
export async function createReportSink(path,header) {
  const headerText=JSON.stringify(header),headerHash=digest(header);
  const registration=await open(path+'.header.json','wx',0o400);
  try{await registration.writeFile(headerText+'\n');await registration.sync();}finally{await registration.close();}
  const journal=await open(path+'.records.jsonl','ax',0o600),partial=await open(path+'.partial','wx',0o600);
  await journal.writeFile(JSON.stringify({type:'header',headerHash})+'\n');await journal.sync();
  await partial.writeFile(JSON.stringify({type:'registration',headerHash,header})+'\n');await partial.sync();
  let sequence=0,finished=false,delegated=false;
  return {
    async delegate(){if(delegated)throw Error('journal_delegated');delegated=true;return {path,sequence};},
    async reclaim(next){if(Number.isSafeInteger(next)&&next>=sequence)sequence=next;delegated=false;},
    async record(cell,series,record){if(delegated)throw Error('journal_delegated');await journal.writeFile(JSON.stringify({type:'record',sequence:++sequence,cell,series,record})+'\n');await journal.sync();},
    async cell(cell,decision,summary={}){await partial.writeFile(JSON.stringify({type:'cell',cell,decision,summary})+'\n');await partial.sync();},
    async finish(status,extra={}){if(finished)return;finished=true;
      try{await partial.writeFile(JSON.stringify({type:'final',status,records:sequence,headerHash,...extra})+'\n');await partial.sync();}
      finally{await journal.close();await partial.close();}await rename(path+'.partial',path);},
    async interrupt(){if(finished)return;finished=true;await journal.close();await partial.close();},
  };
}

// Only the session child opens this harness-owned numeric journal. Parent and
// child never write concurrently; the lease carries its next sequence number.
export async function appendSessionRecords({path,sequence}) {
  const journal=await open(path+'.records.jsonl','a',0o600);
  let writing=Promise.resolve();
  return {get sequence(){return sequence;},record(cell,series,record){
    const line=JSON.stringify({type:'record',sequence:++sequence,cell,series,record})+'\n';
    return writing=writing.then(async()=>{await journal.writeFile(line);await journal.sync();});
  },async close(){try{await writing;}finally{await journal.close();}}};
}
