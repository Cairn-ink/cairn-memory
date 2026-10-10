// Qualification is format-based. Hooks only stat the running binary and read a
// private verdict; schema generation belongs to setup/status/background work.
import { readFile, readlink, stat, realpath, mkdtemp, rm, open, unlink, lstat, mkdir, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { basename, dirname, join, delimiter, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { privateRead, privateWrite, checkedPath, privateDirectory } from '../client/private-state.mjs';
import { collectEvidence } from './schema-evidence.mjs';

const sha = value => createHash('sha256').update(value).digest('hex');
export const canonical = value => JSON.stringify(sort(value));
function sort(value) {
  if (Array.isArray(value)) return value.map(sort);
  return value && typeof value==='object' ? Object.fromEntries(Object.keys(value).sort().map(key=>[key,sort(value[key])])) : value;
}
export const fingerprint = evidence => sha(canonical(evidence));
// Frozen from the native 0.160.1/0.161.0 evidence, including transitive $refs.
// 0.162.0 adds stable partial_answer messages; binary searchOccurrences SQL and
// canonical item_completed capture are frozen separately from the A7 evidence.
export const KNOWN_FORMATS = Object.freeze(['a64741d8899f84513232c3145595ed279325abfdf190b7705b94dcb81b14ab1a',
  '66fc10979c1594fdb2ba648983d36f10f2c4c1b33c01afe853ba92925b707b87']);
const policy = sha(canonical(KNOWN_FORMATS));
export const validVersion = value => typeof value==='string' && /^\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.-]+)?$/u.test(value) && value.length<=100;
export async function binaryIdentity(binaryPath) {
  if (typeof binaryPath!=='string' || !binaryPath.startsWith('/') || binaryPath.includes('\0')) throw new Error('invalid_binary');
  const info = await stat(binaryPath,{bigint:true});
  if (!info.isFile() || info.size<=0n || info.size>1073741824n || (info.mode&0o022n)) throw new Error('unsafe_binary');
  return sha(canonical([process.platform,info.dev.toString(),info.ino.toString(),info.size.toString(),
    info.mtimeNs.toString(),info.ctimeNs.toString()]));
}

// The shell/env trampoline is below the actual host. Walk upward, never fall
// back to the install-time CLI. The closest native Codex process wins.
export function execInvocation(args) {
  const values = new Set(['-c','--config','--enable','--disable','-m','--model','-p','--profile',
    '-C','--cd','-a','--ask-for-approval','-s','--sandbox','--local-provider','--add-dir']);
  for(let index=1;index<args.length;index++) {
    const arg=args[index];
    if(arg==='--')return false;
    if(values.has(arg)){index++;continue;}
    if(arg.startsWith('-'))continue;
    return ['exec','e'].includes(arg);
  }
  return false;
}
export async function detectRunningHost({pid=process.ppid,proc='/proc',read=readFile,link=readlink,identity=binaryIdentity}={}) {
  if (process.platform!=='linux') return undefined;
  const visited=new Set();
  let host, execSession=false;
  for(let depth=0;depth<24 && pid>1 && !visited.has(pid);depth++) {
    visited.add(pid);
    try {
      const executable=await link(join(proc,String(pid),'exe'));
      const args=(await read(join(proc,String(pid),'cmdline'))).toString().split('\0').filter(Boolean);
      if (basename(executable.replace(/ \(deleted\)$/u,''))==='codex') {
        const binaryPath=executable.replace(/ \(deleted\)$/u,''),processPath=join(proc,String(pid),'exe');
        host ??= {identity:await identity(processPath),binaryPath,processPath,kind:args.includes('app-server')?'app-server':'cli',pid};
        execSession ||= execInvocation(args);
      }
      const status=(await read(join(proc,String(pid),'stat'))).toString();
      pid=Number(status.slice(status.lastIndexOf(')')+2).split(' ')[1]);
    } catch {break;}
  }
  // Keep the closest host's identity; an outer exec launcher only narrows its
  // eligible sessions, including an app-server child resuming an old cli file.
  return host && {...host,...(execSession?{execSession:true}:{})};
}

export async function resolveCLI(env=process.env) {
  for(const directory of (env.PATH??'').split(delimiter)) {
    try {
      const launcher=await realpath(resolve(directory||'.','codex'));
      // Official npm launcher: resolve the same platform package as codex.js.
      if(basename(launcher)==='codex.js') {
        const triple=process.arch==='arm64'?'aarch64-unknown-linux-musl':'x86_64-unknown-linux-musl';
        const packageName=process.arch==='arm64'?'@openai/codex-linux-arm64':'@openai/codex-linux-x64';
        let vendor;
        try {vendor=join(dirname(createRequire(launcher).resolve(packageName+'/package.json')),'vendor');}
        catch {vendor=join(dirname(launcher),'..','vendor');}
        const binaryPath=await realpath(join(vendor,triple,'bin','codex'));
        return {binaryPath,identity:await binaryIdentity(binaryPath),kind:'cli'};
      }
      return {binaryPath:launcher,identity:await binaryIdentity(launcher),kind:'cli'};
    } catch {/* next PATH candidate */}
  }
  return undefined;
}
const directory = configPath => join(dirname(configPath),'qualification');
async function safeCache(configPath,{create=false}={}) {
  const parent=dirname(configPath),home=dirname(parent);
  let info;
  try {info=await lstat(home);} catch(error) {
    if(!create || error.code!=='ENOENT')throw error;
    await mkdir(home,{recursive:true,mode:0o700});info=await lstat(home);
  }
  if(!info.isDirectory() || info.isSymbolicLink() || info.uid!==process.getuid() || (info.mode&0o022))throw new Error('unsafe_home');
  await checkedPath(parent,{directory:true,missing:true});
  if(create)await privateDirectory(parent);
  await checkedPath(parent,{directory:true});
  if(create)await privateDirectory(directory(configPath));
  await checkedPath(directory(configPath),{directory:true});
}
const verdictPath = (configPath,host) => join(directory(configPath),host.identity+'.json');
export function validHost(host) {
  return host && /^[a-f0-9]{64}$/u.test(host.identity) && ['cli','app-server'].includes(host.kind) &&
    (host.execSession===undefined || typeof host.execSession==='boolean') &&
    typeof host.binaryPath==='string' && host.binaryPath.startsWith('/') && !host.binaryPath.includes('\0') &&
    (host.processPath===undefined || /^\/proc\/\d+\/exe$/u.test(host.processPath));
}
// /proc pins the executable that is actually running even if its on-disk path
// was replaced. After that process exits, a detached worker may use the stable
// native path only if it still has the exact same identity.
export async function boundBinary(host) {
  if(!validHost(host))return undefined;
  if(host.processPath) {
    try {return await binaryIdentity(host.processPath)===host.identity?host.processPath:undefined;}
    catch(error) {if(!['ENOENT','ESRCH'].includes(error.code))return undefined;}
  }
  try {return await binaryIdentity(host.binaryPath)===host.identity?host.binaryPath:undefined;}
  catch {return undefined;}
}
export async function refreshObservedHost(host) {
  if(host.processPath) {
    try {
      const executable=await readlink(host.processPath);
      if(basename(executable.replace(/ \(deleted\)$/u,''))!=='codex')throw new Error('pid_reused');
      return {...host,binaryPath:executable.replace(/ \(deleted\)$/u,''),identity:await binaryIdentity(host.processPath)};
    } catch {/* report the last stable native path when the process is gone */}
  }
  return {binaryPath:host.binaryPath,kind:host.kind,identity:await binaryIdentity(host.binaryPath)};
}
export async function cachedQualification(configPath,host) {
  if(!validHost(host)) return {status:'pending'};
  try {
    await safeCache(configPath);
    const value=JSON.parse(await privateRead(verdictPath(configPath,host),{missing:true})??'null');
    if(value?.policy!==policy || value.identity!==host.identity || !validVersion(value.version) ||
      !['qualified','changed','unavailable'].includes(value.status)) return {status:'pending'};
    if(value.status==='qualified' && !KNOWN_FORMATS.includes(value.fingerprint)) return {status:'pending'};
    return value;
  } catch {return {status:'pending'};}
}
// Creator evidence survives host updates and binary removal. Only current-policy
// qualified verdicts count; current host qualification remains identity-bound.
// This is read-only, runs only for unseeded creators, and never generates schemas.
export async function hasQualifiedCreator(configPath,version,{signal}={}) {
  if(!validVersion(version) || signal?.aborted)return false;
  try {
    await safeCache(configPath);
    for(const name of await readdir(directory(configPath))) {
      if(signal?.aborted)return false;
      if(!/^[a-f0-9]{64}\.json$/u.test(name))continue;
      try {
        const value=JSON.parse(await privateRead(join(directory(configPath),name)));
        if(value?.identity===name.slice(0,-5) && value.policy===policy &&
          value.status==='qualified' && value.version===version && KNOWN_FORMATS.includes(value.fingerprint))return true;
      } catch {/* unsafe/corrupt verdicts never grant creator qualification */}
    }
  } catch {/* missing/unsafe cache is retryable uncertainty */}
  return false;
}
export async function observeHost(configPath,host) {
  if(!validHost(host))return;
  await safeCache(configPath,{create:true});
  await privateWrite(join(directory(configPath),'observed-'+host.kind+'.json'),JSON.stringify(host));
}
export async function observedHosts(configPath) {
  const hosts=[];
  for(const kind of ['cli','app-server']) {
    try {
      await safeCache(configPath);
      const host=JSON.parse(await privateRead(join(directory(configPath),'observed-'+kind+'.json'),{missing:true})??'null');
      if(validHost(host)) hosts.push(host);
    } catch {/* uncertainty stays closed at hook */}
  }
  return hosts;
}
export async function qualifyBinary(configPath,host,{collect=collectEvidence,cache=true}={}) {
  const binary=await boundBinary(host);
  if(!binary)return {status:'pending'};
  const cached=cache?await cachedQualification(configPath,host):{status:'pending'};
  if(['qualified','changed'].includes(cached.status))return cached;
  const temporary=await mkdtemp(join(tmpdir(),'cairn-codex-format-'));
  let verdict;
  try {
    const result=await collect(binary,join(temporary,'probe'));
    if(!await boundBinary(host)) return {status:'pending'};
    const digest=fingerprint(result.evidence);
    verdict={identity:host.identity,policy,version:result.version,
      status:KNOWN_FORMATS.includes(digest)?'qualified':'changed',fingerprint:digest,
      binarySha256:result.binarySha256};
  } catch(error) {
    // Missing exposed types/markers are changed evidence. A failed command or
    // unreadable binary is uncertainty and remains retryable via status.
    if(validVersion(error.version) && ['schema_missing','schema_ref_missing','serde_marker_missing','embedded_schema_missing','embedded_schema_conflict'].includes(error.message))
      verdict={identity:host.identity,policy,version:error.version,status:'changed',reason:error.message};
    else return {status:'unavailable',reason:'probe_failed',...(validVersion(error.version)?{version:error.version}:{})};
  } finally {await rm(temporary,{recursive:true,force:true});}
  if(cache) {
    try {await safeCache(configPath,{create:true});await privateWrite(verdictPath(configPath,host),JSON.stringify(verdict));}
    catch {return {status:'pending'};}
  }
  return verdict;
}
export function qualificationStatus(version,status,lines={}) {
  if(status==='qualified')return `Codex ${version}: format qualified.`;
  const name=version??'unknown';
  if(status==='changed')return lines.changed??`Codex ${name} 的格式已變更，擷取與回憶暫停，等待 plugin 更新`;
  if(status==='unavailable')return lines.unavailable??`Codex ${name} 格式驗證失敗，先暫停；執行 status --client codex 重試`;
  return lines.pending??`Codex ${name} 的格式還沒驗證，先暫停；執行 status --client codex 重試`;
}

const pendingPath = (configPath,host) => join(directory(configPath),host.identity+'.pending');
export async function scheduleQualification(configPath,host,launch) {
  const path=pendingPath(configPath,host);
  try {
    const before=await checkedPath(path,{missing:true});
    if(before && Date.now()-before.mtimeMs<120000)return;
    if(before)await unlink(path);
    const lock=await open(path,'wx',0o600);await lock.close();
    try {await launch(configPath,host);}
    catch {await unlink(path).catch(()=>{});}
  } catch {/* unsafe state or concurrent launcher: fail closed */}
}
export const finishQualification = (configPath,host) => unlink(pendingPath(configPath,host)).catch(()=>{});
