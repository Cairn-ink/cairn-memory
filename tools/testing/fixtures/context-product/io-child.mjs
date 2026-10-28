// SQLite-free process: every raw database copy/hash descriptor lives here.
import { copyFileSync, readFileSync, statSync, readdirSync, chmodSync, constants, createReadStream, openSync, writeSync, fsyncSync, closeSync, fstatSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { PROTOCOL } from './protocol.mjs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { setTimeout as delay } from 'node:timers/promises';
export function sizes(directory) {
  return readdirSync(directory).map(name=>{const path=join(directory,name),s=statSync(path);return {name,bytes:s.isFile()?s.size:0};});
}
const hash = path => createHash('sha256').update(readFileSync(path)).digest('hex');
export function sample(pid) {
  const threads=[];
  for(const tid of readdirSync(`/proc/${pid}/task`))try {
    const [runtimeNs,runqueueNs,slices]=readFileSync(`/proc/${pid}/task/${tid}/schedstat`,'utf8').trim().split(/\s+/).map(Number);
    threads.push({tid:Number(tid),runtimeNs,runqueueNs,slices});
  }catch{ /* A terminated thread is reported by absence, never used to alter gates. */ }
  const vm=Object.fromEntries(readFileSync('/proc/vmstat','utf8').split('\n').map(l=>l.split(/\s+/)).filter(([k])=>['pswpin','pswpout','pgmajfault'].includes(k)).map(([k,v])=>[k,Number(v)]));
  return {at:Date.now(),pid,threads,vm};
}
function groupAlive(group) {
  if(process.platform!=='linux'){
    try{process.kill(-group,0);return true;}catch(e){if(e.code!=='ESRCH')throw e;return false;}
  }
  for(const pid of readdirSync('/proc')){
    if(!/^\d+$/.test(pid))continue;
    let text;try{text=readFileSync(`/proc/${pid}/stat`,'utf8');}catch(e){if(['ENOENT','ESRCH'].includes(e.code))continue;throw e;}
    const fields=text.slice(text.lastIndexOf(')')+2).split(' ');
    // Zombies have confirmed kernel exit; a shared host's reaper owns removal.
    if(Number(fields[2])===group&&!['Z','X'].includes(fields[0]))return true;
  }
  return false;
}
if(process.argv[2]==='group-stop') {
  const group=Number(process.argv[3]);
  const signal=s=>{try{process.kill(-group,s);}catch(e){if(e.code!=='ESRCH')throw e;}};
  if(groupAlive(group)){
    signal('SIGTERM');
    for(let n=0;n<100&&groupAlive(group);n++){if(n===20)signal('SIGKILL');await delay(50);}
    if(groupAlive(group))throw Error('session_descendants_alive_workspace_retained');
  }
} else if(['failure-journal-init','failure-journal-append'].includes(process.argv[2])) {
  // Independent owner: the main journal may still be leased to live children.
  // This process never imports SQLite or opens engine connections.
  const path=process.argv[3]+'.failures.jsonl',initial=process.argv[2]==='failure-journal-init';
  const fd=openSync(path,initial?'wx':constants.O_WRONLY|constants.O_APPEND|constants.O_NOFOLLOW,0o600);
  try {
    if(!fstatSync(fd).isFile())throw Error('failure_journal_regular_file_required');
    const data=Buffer.from(process.argv[4]+'\n');let offset=0;
    while(offset<data.length)offset+=writeSync(fd,data,offset,data.length-offset);
    fsyncSync(fd);
  }finally{closeSync(fd);}
  console.log(JSON.stringify({durable:true}));
} else if(process.argv[2]==='journal-sequence') {
  const input=createReadStream(process.argv[3]+'.records.jsonl');
  let sequence=0,lastByte;input.on('data',chunk=>{lastByte=chunk.at(-1);});
  for await(const line of createInterface({input,crlfDelay:Infinity})){const row=JSON.parse(line);if(row.type==='record'&&row.sequence!==++sequence)throw Error('journal_sequence');}
  if(lastByte!==10)throw Error('journal_incomplete_frame');
  console.log(JSON.stringify({sequence}));
} else if(process.argv[2]==='copy') {
  copyFileSync(process.argv[3],process.argv[4],constants.COPYFILE_EXCL);chmodSync(process.argv[4],0o600);
  console.log(JSON.stringify({hash:hash(process.argv[4]),bytes:statSync(process.argv[4]).size}));
} else if(process.argv[2]==='hash') {
  console.log(JSON.stringify(process.argv.slice(3).map(path=>({hash:hash(path),bytes:statSync(path).size}))));
} else if(process.argv[2]==='sample') {
  const send=message=>new Promise((resolve,reject)=>process.send(message,error=>error?reject(error):resolve()));
  const session=createSamplerSession({send,captureSample:(pid,directory)=>({...sample(pid),sizes:directory?sizes(directory):[]})});
  process.once('disconnect',()=>session.close());
  process.on('message',m=>{void session.message(m).then(()=>{if(m.type==='stop')process.disconnect();})
    .catch(()=>{session.close();process.exitCode=1;if(process.connected)process.disconnect();});});
  process.send({type:'ready'});
}
// The timer only captures into bounded child memory. A caller rendezvous after
// loop.finish() is the sole route to sampler data transfer.
export function createSamplerSession({send,captureSample,schedule=setInterval,cancel=clearInterval,buffer=createSampleBuffer()}) {
  let timer,configuration,transfer=Promise.resolve();
  const capture=()=>{for(const pid of configuration.pids)try{buffer.push(captureSample(pid,configuration.directory));}catch{buffer.missing();}};
  return {close(){cancel(timer);},async message(m) {
    if(m.type==='start'){configuration=m;capture();timer=schedule(capture,PROTOCOL.sampler.intervalMs);await send({type:'started'});}
    if(m.type==='collect'||m.type==='stop') {
      if(m.type==='stop')cancel(timer);capture();
      transfer=transfer.then(async()=>{await buffer.flush(send);await send({type:m.type==='stop'?'stopped':'collected'});});
      await transfer;
    }
  }};
}
export function createSampleBuffer({capacity=PROTOCOL.sampler.capacity,batchSize=PROTOCOL.sampler.batchSize}={}) {
  let samples=[],missing=0,dropped=0;
  return {push(sample){if(samples.length<capacity)samples.push(sample);else dropped++;},missing(){missing++;},
    async flush(send){const pending=samples; samples=[];const counts={missing,dropped};missing=0;dropped=0;
      for(let i=0;i<pending.length;i+=batchSize)await send({type:'samples',samples:pending.slice(i,i+batchSize)});
      await send({type:'sample_coverage',...counts});
    }};
}
