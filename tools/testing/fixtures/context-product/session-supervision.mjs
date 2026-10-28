import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
// The detached coordinator's group is inherited by all its descendants. The
// SQLite-free helper owns polling and validation; the observed parent receives
// only its terminal exit, never variable-size process inventories.
export async function stopSessionGroup(child,{spawnChild=spawn,schedule=setTimeout,cancel=clearTimeout}={}) {
  if(!child.pid)return;
  const helper=spawnChild(process.execPath,[fileURLToPath(new URL('./io-child.mjs',import.meta.url)),'group-stop',String(child.pid)],{env:{},stdio:'ignore'});
  const watchdog=schedule(()=>helper.kill('SIGKILL'),30000);
  try{await new Promise((resolve,reject)=>{
    helper.once('error',reject);
    helper.once('exit',(code,signal)=>code===0&&!signal?resolve():reject(Error('session_descendants_alive_workspace_retained')));
  });}finally{cancel(watchdog);}
}
// Selective escalation leaves healthy in-flight work alone until its allowance.
export async function escalateActor(child,{graceMs=1000,schedule=setTimeout,cancel=clearTimeout}={}) {
  if(child.exitCode!==null||child.signalCode!==null)return child.exited;
  child.kill('SIGTERM');
  const timer=schedule(()=>child.kill('SIGKILL'),graceMs);
  try{return await child.exited;}finally{cancel(timer);}
}
