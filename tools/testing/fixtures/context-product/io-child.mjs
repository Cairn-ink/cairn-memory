// SQLite-free process: every raw database copy/hash descriptor lives here.
import { copyFileSync, readFileSync, statSync, readdirSync, chmodSync, constants } from 'node:fs';
import { createHash } from 'node:crypto';
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
  let timer,configuration;
  const capture=()=>{for(const pid of configuration.pids)try{process.send({type:'sample',sample:{...sample(pid),sizes:configuration.directory?sizes(configuration.directory):[]}});}catch{process.send({type:'sample_missing',pid});}};
  process.on('message',m=>{
    if(m.type==='start'){configuration=m;capture();timer=setInterval(capture,10);}
    if(m.type==='stop'){clearInterval(timer);capture();process.send({type:'stopped'},()=>process.disconnect());}
  });process.send({type:'ready'});
}
