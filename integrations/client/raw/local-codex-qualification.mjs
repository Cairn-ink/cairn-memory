import { stateLock } from '../state-lock.mjs';
import { spawn } from 'node:child_process';
import { stat,lutimes } from 'node:fs/promises';
import { dirname,join } from 'node:path';
import { fileURLToPath,pathToFileURL } from 'node:url';
import { privateRead,privateWrite,checkedPath } from '../private-state.mjs';
import { cachedQualification,observeHost,observedHosts,boundBinary,validHost,
  scheduleQualification,finishQualification,qualifyBinary } from '../../codex/qualification.mjs';

export const QUALIFICATION_BACKOFF_MS = 300000;
const attemptPath=(configPath,host)=>join(dirname(configPath),'qualification',host.identity+'.local-attempt.json');
async function attempt(configPath,host) {
  try {
    const value=JSON.parse(await privateRead(attemptPath(configPath,host),{missing:true})??'null');
    return value?.identity===host.identity && ['pending','failed','qualified'].includes(value.status) &&
      Number.isSafeInteger(value.retryAfter) && Number.isSafeInteger(value.at) && typeof value.reason==='string' ? value:null;
  } catch { return null; }
}
async function record(configPath,host,status,reason,retryAfter) {
  await privateWrite(attemptPath(configPath,host),JSON.stringify({identity:host.identity,status,reason,at:Date.now(),retryAfter}));
}
export async function safeLocalBoundBinary(host) {
  const path=await boundBinary(host);if(!path)return false;
  try {const info=await stat(path);return info.isFile() && info.uid===process.getuid() && !(info.mode&0o022);}
  catch{return false;}
}
export function launchLocalQualification(configPath,host) {
  const child=spawn(process.execPath,[fileURLToPath(import.meta.url),configPath],{detached:true,
    env:{HOME:'/tmp',PATH:'/usr/bin:/bin',LANG:'C.UTF-8'},stdio:['pipe','ignore','ignore']});
  return new Promise((resolve,reject)=>{
    child.once('error',reject);child.stdin.once('error',reject);
    child.once('spawn',()=>child.stdin.end(JSON.stringify(host),()=>{child.unref();resolve();}));
  });
}
// No probe on the hook path. Capture still uses the complete identity-bound
// verdict read before scheduling; a racing success is used by the next hook.
export async function localCodexQualification(configPath,host,{launch=launchLocalQualification}={}) {
  if(!validHost(host))return {status:'pending'};
  const observed=await observedHosts(configPath);
  if(!observed.some(value=>JSON.stringify(value)===JSON.stringify(host))) await observeHost(configPath,host);
  else {
    const path=join(dirname(configPath),'qualification','observed-'+host.kind+'.json');
    await checkedPath(path);const now=new Date();await lutimes(path,now,now);
  }
  if(!await safeLocalBoundBinary(host)) {
    await record(configPath,host,'failed','unsafe_binary',Date.now()+QUALIFICATION_BACKOFF_MS);
    return {status:'unavailable',reason:'unsafe_binary'};
  }
  const verdict=await cachedQualification(configPath,host);
  if(verdict.status==='qualified')return verdict;
  const previous=await attempt(configPath,host);
  if(['pending','unavailable'].includes(verdict.status) && (!previous || previous.retryAfter<=Date.now())) {
    await scheduleQualification(configPath,host,async (path,bound)=>{
      // Existing exclusive pending lock serializes attempt publication/spawn.
      await record(path,bound,'pending','qualification_pending',Date.now()+120000);
      try {await launch(path,bound);}
      catch(error){await record(path,bound,'failed','launch_failed',Date.now()+QUALIFICATION_BACKOFF_MS);throw error;}
    });
  }
  return verdict;
}
export async function runLocalQualification(configPath,host,options={}) {
  if(!validHost(host))return;
  return stateLock(join(dirname(configPath),'qualification',host.identity+'.local-probe.lock'),async()=>{
  try {
    await checkedPath(configPath);
    if(!await safeLocalBoundBinary(host)) {
      await record(configPath,host,'failed','unsafe_binary',Date.now()+QUALIFICATION_BACKOFF_MS);return;
    }
    const verdict=await qualifyBinary(configPath,host,options);
    await record(configPath,host,verdict.status==='qualified'?'qualified':'failed',
      verdict.reason??(verdict.status==='changed'?'format_changed':verdict.status==='qualified'?'qualified':'probe_failed'),
      verdict.status==='qualified'?0:Date.now()+QUALIFICATION_BACKOFF_MS);
  } finally { await finishQualification(configPath,host); }
  },{timeoutMs:250});
}
// Cache-only status. No ancestry discovery, binary stat, source read or spawn.
export async function localCodexQualificationStatus(configPath) {
  const hosts=await observedHosts(configPath),observations=[];
  for(const host of hosts) {
    const verdict=await cachedQualification(configPath,host),last=await attempt(configPath,host);
    const unsafe=last?.status==='failed' && last.reason==='unsafe_binary';
    const observed=await stat(join(dirname(configPath),'qualification','observed-'+host.kind+'.json'));
    observations.push({at:observed.mtimeMs,status:unsafe?'failed':verdict.status==='qualified'?'qualified':
      ['changed','unavailable'].includes(verdict.status)||last?.status==='failed'?'failed':'pending',
      reason:unsafe?'unsafe_binary':verdict.status==='qualified'?'qualified':verdict.reason??(verdict.status==='changed'?'format_changed':last?.reason??'qualification_pending')});
  }
  const selected=observations.sort((a,b)=>b.at-a.at)[0]??{status:'pending',reason:'qualification_required'};
  return {status:selected.status,reason:selected.reason,message:selected.status==='qualified'?'Last observed Codex format qualified. If capture stops after a Codex update, rerun setup.':
    'Codex capture is waiting for qualification. After a Codex update, rerun setup if qualification is pending or failed.'};
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  let text='';const timer=setTimeout(()=>process.stdin.destroy(),750);
  try {for await(const chunk of process.stdin){text+=chunk;if(Buffer.byteLength(text)>16384)throw Error('invalid_host');}
    clearTimeout(timer);await runLocalQualification(process.argv[2],JSON.parse(text));
  } catch {process.exitCode=1;} finally {clearTimeout(timer);}
}
