import { stateLock } from '../state-lock.mjs';
import { spawn } from 'node:child_process';
import { realpathSync, stat as statCallback, lutimes as lutimesCallback } from 'node:fs';
import { promisify } from 'node:util';
import { dirname,join,relative,isAbsolute } from 'node:path';
import { fileURLToPath,pathToFileURL } from 'node:url';
import { privateRead,privateWrite,checkedPath } from '../private-state.mjs';
import { cachedQualification,observeHost,observedHosts,boundBinary,validHost,
  scheduleQualification,finishQualification,qualifyBinary,detectRunningHost } from '../../codex/qualification.mjs';

// Synthetic suites must never discover the runner's real native ancestry. The
// test context is propagated explicitly to cold commands and owned probe children.
// There is no production opt-in, DTO field, or alternate qualification policy.
const stat=promisify(statCallback), lutimes=promisify(lutimesCallback);
const testRoots = new Set(), ownedTestChildren = new Set();
const synthetic = () => Boolean(process.env.NODE_TEST_CONTEXT || process.env.CAIRN_SYNTHETIC_FIXTURE_ROOT);
const below = (root,path) => { const tail=relative(root,path); return tail !== '' && tail !== '..' && !tail.startsWith('../') && !isAbsolute(tail); };
export function registerLocalQualificationTestRoot(root) {
  if (!synthetic()) throw Error('synthetic_test_context_required');
  const resolved=realpathSync(root); testRoots.add(resolved); return () => testRoots.delete(resolved);
}
function probeTestRoot(configPath,host) {
  if (!synthetic()) return null;
  const config=realpathSync(configPath), binary=realpathSync(host.binaryPath);
  const roots=[...testRoots,...(process.env.CAIRN_SYNTHETIC_FIXTURE_ROOT ? [realpathSync(process.env.CAIRN_SYNTHETIC_FIXTURE_ROOT)]:[])];
  const root=roots.find(value=>below(value,config) && below(value,binary));
  if (!root) throw Error('synthetic_probe_outside_fixture');
  if (host.processPath) throw Error('synthetic_real_ancestry_forbidden');
  return root;
}
export async function detectLocalCodexHost(detect) {
  if (!synthetic()) return (detect ?? detectRunningHost)();
  if (detect) return detect();
  // Environment markers only restrict discovery. Cold tests inject hosts
  // through a harness-owned preload; environment paths never select a host.
  throw Error('synthetic_real_ancestry_forbidden');
}
export async function awaitLocalQualificationTestChildren() {
  await Promise.all([...ownedTestChildren]);
}

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
  const root=probeTestRoot(configPath,host);
  const child=spawn(process.execPath,[fileURLToPath(import.meta.url),configPath],{detached:!root,
    env:{HOME:'/tmp',PATH:'/usr/bin:/bin',LANG:'C.UTF-8',...(root?{NODE_TEST_CONTEXT:'child-v8',CAIRN_SYNTHETIC_FIXTURE_ROOT:root}:{})},stdio:['pipe','ignore','ignore']});
  const done=new Promise((resolve,reject)=>{
    let failure;
    const failed=error=>{if(root)failure=error;else reject(error);};
    child.once('error',failed);child.stdin.once('error',failed);
    if(root) child.once('close',(code,signal)=>{
      if(failure || code!==0 || signal!==null)reject(failure ?? Error('synthetic_qualification_child_failed'));
      else resolve();
    });
    child.once('spawn',()=>child.stdin.end(JSON.stringify(host),()=>{if(!root){child.unref();resolve();}}));
  });
  if(root){ownedTestChildren.add(done);done.then(()=>ownedTestChildren.delete(done),()=>ownedTestChildren.delete(done));}
  return done;
}
// No probe on the hook path. Capture still uses the complete identity-bound
// verdict read before scheduling; a racing success is used by the next hook.
export async function localCodexQualification(configPath,host,{launch=launchLocalQualification}={}) {
  if(!validHost(host))return {status:'pending'};
  probeTestRoot(configPath,host);
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
  probeTestRoot(configPath,host);
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
