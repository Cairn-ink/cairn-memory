// Synthetic owner operator. The actual installed host derives Node/runtime;
// only this external fixture instruments the exact B4a child spawn for fake HTTP.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import promises from 'node:fs/promises';
import cp from 'node:child_process';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { register,syncBuiltinESMExports } from 'node:module';
import { dirname,join } from 'node:path';
import { fileURLToPath,pathToFileURL } from 'node:url';

const settings=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const {installed,trace,profilePath,args,scaffold,mode,preload}=settings;
if(settings.clock!==undefined)Date.now=()=>settings.clock;
for(const name of ['OPENAI_API_KEY','ANTHROPIC_API_KEY','NODE_OPTIONS'])assert.equal(process.env[name],undefined);
const deny=()=>{throw Error('synthetic_host_network_forbidden')};
globalThis.fetch=deny;http.request=http.get=https.request=https.get=net.connect=net.createConnection=net.Socket.prototype.connect=deny;
fs.writeFileSync(trace,'',{flag:'wx',mode:0o600});
const note=value=>fs.appendFileSync(trace,JSON.stringify(value)+'\n');
for(const api of [fs,promises])for(const method of ['readFileSync','readFile']) {
  if(typeof api[method]!=='function')continue;const original=api[method];
  api[method]=function(value,...args){const path=value instanceof URL?fileURLToPath(value):String(value);
    if(path.startsWith(installed+'/'))note({kind:'asset',path});return original.call(this,value,...args)};
}
const children=new Set(),spawn=cp.spawn;let count=0;
cp.spawn=function(executable,childArgs,options) {
  assert.equal(executable,process.execPath);assert.equal(options.shell,false);assert.equal(options.detached,false);
  if(childArgs.length===1&&childArgs[0]==='--version')return spawn(executable,childArgs,options);
  assert.equal(childArgs.length,5);assert.equal(childArgs[0],join(installed,'adapters/local/cli.mjs'));
  assert.equal(childArgs[1],'--config');assert.equal(childArgs[2],scaffold.SYNTHETIC_CONFIG);assert.equal(childArgs[3],'--config-digest');
  assert.match(childArgs[4],/^[a-f0-9]{64}$/);
  const childTrace=join(dirname(trace),'child-'+process.pid+'-'+count+++'.jsonl');
  const child=spawn(executable,['--import',preload,...childArgs],{...options,env:{...options.env,...scaffold,
    SYNTHETIC_IMPORT_TRACE:childTrace,SYNTHETIC_MODE:mode==='drop-ack'?'memory':mode,SYNTHETIC_DROP_ACK:mode==='drop-ack'?'1':'0'}});
  note({kind:'spawn',pid:child.pid});children.add(child);
  child.once('close',(code,signal)=>{children.delete(child);note({kind:'close',pid:child.pid,code,signal})});
  return child;
};
syncBuiltinESMExports();
register('data:text/javascript,'+encodeURIComponent(`
import {appendFileSync} from 'node:fs';import {fileURLToPath} from 'node:url';
let data;export function initialize(value){data=value}
export async function resolve(specifier,context,next){const result=await next(specifier,context);
if(result.url.startsWith('file:')){const path=fileURLToPath(result.url);
if(!path.startsWith(data.allowed+'/'))throw Error('installed_host_source_fallback');
appendFileSync(data.trace,JSON.stringify({kind:'module',path})+'\\n');}return result}
`),{parentURL:import.meta.url,data:{allowed:dirname(installed),trace}});
const {withLocalHostDependencies}=await import(pathToFileURL(join(installed,'integrations/client/raw/local-host.mjs')));
const {runLocalHostCli}=await import(pathToFileURL(join(installed,'integrations/client/raw/local-host-cli.mjs')));
const qualification=await import(pathToFileURL(join(installed,'integrations/codex/qualification.mjs')));
const detectHost=async()=>{
  const host=await qualification.detectRunningHost({pid:42,proc:'/synthetic/proc',link:async()=>settings.syntheticBinary,
    identity:()=>qualification.binaryIdentity(settings.syntheticBinary),read:async path=>Buffer.from(path.endsWith('cmdline')?'codex\0':'42 (codex) S 1 0 0')});
  const {processPath,...bound}=host;return bound;
};
const {result,exitCode}=await withLocalHostDependencies({detectHost,...(settings.deadlineMs?{deadlineMs:settings.deadlineMs}:{}),
  checkpoint:stage=>{if(stage==='after_dispatch'&&settings.abortAfterDispatch)process.emit('SIGTERM')}},
  ()=>runLocalHostCli(['--profile',profilePath,...args]));
assert.equal(children.size,0,'actual capture child close precedes host result');
process.stdout.write(JSON.stringify(result)+'\n');process.exitCode=exitCode;
