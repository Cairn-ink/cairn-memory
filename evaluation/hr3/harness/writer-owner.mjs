import {readFileSync,readlinkSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import process from 'node:process';

const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const digits=/^(?:0|[1-9]\d*)$/;
const system={platform:process.platform,pid:process.pid,readFile:readFileSync,readlink:readlinkSync,kill:pid=>process.kill(pid,0)};
let ownIdentity;
function scope(probe){
  if(probe.platform!=='linux')return {bootId:null,namespace:null};
  let bootId=null,namespace=null;
  try{const value=probe.readFile('/proc/sys/kernel/random/boot_id','utf8').trim();if(uuid.test(value))bootId=value;}catch{}
  try{namespace=/^pid:\[(\d+)\]$/.exec(probe.readlink('/proc/self/ns/pid'))?.[1]??null;}catch{}
  return {bootId,namespace};
}
export function processStartIdentity(pid,probe=system){
  const raw=probe.readFile('/proc/'+pid+'/stat','utf8'),end=raw.lastIndexOf(')');
  if(!raw.startsWith(pid+' (')||end<0)throw Error('invalid_process_stat');
  // comm may contain spaces and parentheses. Field 22 is index 19 after comm.
  const starttime=raw.slice(end+1).trim().split(/\s+/)[19];
  if(!starttime||!digits.test(starttime))throw Error('invalid_process_starttime');
  return starttime;
}
export function writerOwnerIdentity(){
  if(!ownIdentity||!ownIdentity.starttime||!ownIdentity.bootId||!ownIdentity.namespace){
    const base={pid:process.pid,...scope(system),starttime:null};
    if(system.platform==='linux')try{base.starttime=processStartIdentity(process.pid);}catch{}
    ownIdentity=base;
  }
  // No wall-clock lease: unavailable identity remains explicitly unverifiable.
  return {...ownIdentity,nonce:randomUUID()};
}
export function parseWriterMarker(name){
  const [version,pid,starttime,bootId,namespace,nonce,...extra]=name.split('.');
  if(version!=='v2'||extra.length||!digits.test(pid??'')||!Number.isSafeInteger(Number(pid))||Number(pid)<1||Number(pid)>2147483647||!uuid.test(nonce??'')||!(starttime==='u'||digits.test(starttime??''))||!(bootId==='u'||uuid.test(bootId??''))||!(namespace==='u'||digits.test(namespace??'')))return null;
  return {pid:Number(pid),starttime:starttime==='u'?null:starttime,bootId:bootId==='u'?null:bootId,namespace:namespace==='u'?null:namespace,nonce};
}
export function writerMarkerName(owner){
  const name=['v2',owner.pid,owner.starttime??'u',owner.bootId??'u',owner.namespace??'u',owner.nonce].join('.');
  if(!parseWriterMarker(name))throw Error('invalid_writer_owner');
  return name;
}
export function writerOwnerLiveness(owner,probe=system){
  if(!owner)return {state:'unknown',reason:'unverifiable_marker'};
  const here=probe===system&&ownIdentity?.bootId&&ownIdentity?.namespace?ownIdentity:scope(probe);
  if(!owner.bootId||!owner.namespace||here.bootId!==owner.bootId||here.namespace!==owner.namespace)return {state:'unknown',reason:'owner_scope_unverifiable'};
  try{
    const starttime=probe===system&&owner.pid===process.pid&&ownIdentity?.starttime?ownIdentity.starttime:processStartIdentity(owner.pid,probe);
    if(!owner.starttime)return {state:'unknown',reason:'owner_start_unverifiable'};
    return starttime===owner.starttime?{state:'live',reason:'identity_matches'}:{state:'dead',reason:'pid_reused'};
  }catch(error){
    // Missing proc data alone is insufficient: permissions/mounts may hide it.
    if(error.code==='ENOENT')try{probe.kill(owner.pid);}catch(missing){if(missing.code==='ESRCH')return {state:'dead',reason:'process_missing'};}
    return {state:'unknown',reason:'process_liveness_unverifiable'};
  }
}
