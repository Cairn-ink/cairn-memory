// SQLite-free process: every raw database copy/hash descriptor lives here.
import { copyFileSync, readFileSync, statSync, readdirSync, chmodSync, constants } from 'node:fs';
import { createHash } from 'node:crypto';
import { PROTOCOL } from './protocol.mjs';
import { join } from 'node:path';
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
if(process.argv[2]==='copy') {
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
