import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { fixture } from '../../../../adapters/local/test/fixtures/workspace.mjs';
import { FORMAT } from '../../../codex/parser.mjs';
import { claude, codex, sessionId, pluginRoot } from './raw-fixtures.mjs';

export function workerFixture(t, { client = 'claude-code', rows } = {}) {
  const f = fixture(t,{ client }), stateRoot = join(f.workspace.path,'worker-state'), identityKeyPath = join(f.workspace.path,'installation-key');
  mkdirSync(stateRoot,{ mode:0o700 }); writeFileSync(identityKeyPath,'31'.repeat(32)+'\n',{ mode:0o600 });
  f.config.provider.apiKeyEnv = 'CAIRN_SYNTHETIC_API_KEY'; f.save();
  const sourcePath = join(f.workspace.path,'private-transcript.jsonl');
  const header = client === 'codex' ? JSON.stringify({ type:'session_meta',payload:{ id:sessionId,cli_version:'0.162.0',history_mode:'paginated',source:'cli',originator:'codex-tui' } })+'\n' : '';
  const writeSource = (records, { partial = false } = {}) => writeFileSync(sourcePath,header+records.map(row => typeof row === 'string' ? row : JSON.stringify(row)).join('\n')+(records.length && !partial ? '\n' : ''),{ mode:0o600 });
  writeSource(rows ?? [client === 'codex' ? codex('synthetic_source_secret Ａ🙂') : claude('synthetic_source_secret Ａ🙂')]);
  const context = { sessionId,sourcePath,pluginRoot:client === 'claude-code' ? pluginRoot : null,
    formatAuthority:client === 'codex' ? { format:FORMAT,sessionId,creatorVersion:'0.162.0',qualifiedCreatorVersion:null } : null };
  const options = { stateRoot,identityKeyPath,nodeExecutable:process.execPath,runtimeRoot:resolve(fileURLToPath(new URL('../../../../',import.meta.url))),
    configPath:f.configPath,expectedAuthority:f.config.authority,home:join(f.workspace.path,'home'),env:{} };
  const cursorPath = () => join(stateRoot,'sessions',readdirSync(join(stateRoot,'sessions')).find(name => name.endsWith('.json') && !name.endsWith('.claim.json')));
  const cursor = () => JSON.parse(readFileSync(cursorPath(),'utf8'));
  const root = options.runtimeRoot, modePath = join(f.workspace.path,'provider-mode');
  const ownedPath = join(f.workspace.path,'owned-child-pids.jsonl'), readyPath = join(f.workspace.path,'provider-ready'), releasePath = join(f.workspace.path,'provider-release');
  function processInfo(pid) {
    try { const text = readFileSync(`/proc/${pid}/stat`,'utf8'), fields = text.slice(text.lastIndexOf(')')+2).split(' ');
      return { pid,start:fields[19],live:!['Z','X'].includes(fields[0]) }; }
    catch (error) { if (['ENOENT','ESRCH'].includes(error.code)) return null; throw error; }
  }
  const drivers = [];
  const ownedChildren = () => [...drivers,...(existsSync(ownedPath) ? readFileSync(ownedPath,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [])];
  const isLive = owner => { const current = processInfo(owner.pid); return current?.start === owner.start && current.live; };
  const childrenStopped = () => ownedChildren().every(owner => !isLive(owner));
  const stopOwnedChildren = async () => {
    for (let attempt = 0; attempt < 300; attempt++) {
      const live = ownedChildren().filter(isLive); if (!live.length) return;
      for (const owner of live) try { process.kill(owner.pid,attempt < 100 ? 'SIGTERM' : 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
      await delay(10);
    }
    throw new Error('owned_worker_children_still_live_workspace_retained');
  };
  writeFileSync(modePath,'empty',{ mode:0o600 });
  const executable = join(f.workspace.path,'synthetic-worker-node.mjs');
  // A trusted test executable inserts fake HTTP; production never forwards these
  // scaffolding variables/preloads through its closed child environment.
  writeFileSync(executable,`#!${process.execPath}
import {spawn} from 'node:child_process';import {readFileSync,appendFileSync} from 'node:fs';
if(process.argv[2]==='--version')process.stdout.write(process.version+'\\n');
else {
 const note=pid=>{try{const text=readFileSync('/proc/'+pid+'/stat','utf8'),fields=text.slice(text.lastIndexOf(')')+2).split(' ');appendFileSync(${JSON.stringify(ownedPath)},JSON.stringify({pid,start:fields[19]})+'\\n',{mode:0o600})}catch(error){if(!['ENOENT','ESRCH'].includes(error.code))throw error}};
 note(process.pid);
 const mode=readFileSync(${JSON.stringify(modePath)},'utf8');
 const child=spawn(${JSON.stringify(process.execPath)},['--import',${JSON.stringify(join(root,'adapters/local/test/fixtures/http.mjs'))},...process.argv.slice(2)],
 {shell:false,stdio:mode==='drop-ack'?['inherit','pipe','inherit']:'inherit',env:{...process.env,
 SYNTHETIC_MODE:mode==='drop-ack'?'memory':mode,SYNTHETIC_TRACE:${JSON.stringify(f.trace)},
 SYNTHETIC_CONFIG:${JSON.stringify(f.configPath)},SYNTHETIC_CORE:${JSON.stringify(join(root,'core/index.mjs'))},
 SYNTHETIC_READY:${JSON.stringify(readyPath)},SYNTHETIC_RELEASE:${JSON.stringify(releasePath)}}});
 note(child.pid);
 if(mode==='drop-ack')child.stdout.on('data',()=>{});
 for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>child.kill(signal));
 child.once('error',()=>{process.exitCode=1});child.once('close',code=>{process.exitCode=mode==='drop-ack'?7:code??1});
}
`,{ mode:0o700 });
  const syntax = spawnSync(process.execPath,['--check',executable],{ timeout:2000,stdio:'ignore',env:{ HOME:options.home,PATH:'/usr/bin:/bin' } });
  assert.equal(syntax.status,0,'synthetic worker executable syntax check'); assert.equal(syntax.signal,null); assert.equal(syntax.error,undefined);
  const providerMode = mode => writeFileSync(modePath,mode);
  let invocation = 0;
  const runWorker = (action,{ clock,key = true,start,realNode = false,unavailable = false,rawDriver = false,crashAt,exhaustAt } = {}) => {
    const settings = join(f.workspace.path,`worker-call-${invocation++}.json`);
    writeFileSync(settings,JSON.stringify({ action,clock,crashAt,exhaustAt,options:{ ...options,nodeExecutable:unavailable ? join(f.workspace.path,'missing-node') : realNode ? process.execPath : executable,
      env:key ? { CAIRN_SYNTHETIC_API_KEY:'synthetic_key_secret' } : {} },context:{ ...context,...(start ? { start } : {}) } }),{ mode:0o600 });
    // The owned runner reaps the driver's entire descendant group before its
    // close event permits this fixture's workspace cleanup.
    const driverArguments = [fileURLToPath(new URL('./local-worker-driver.mjs',import.meta.url)),settings];
    const child = spawn(process.execPath,rawDriver ? driverArguments : [join(root,'tools/testing/run.mjs'),'--script',...driverArguments],{
      stdio:['ignore','pipe','pipe'],env:{ PATH:'/usr/bin:/bin',HOME:options.home,TMPDIR:f.workspace.path,TMP:f.workspace.path,TEMP:f.workspace.path,
        NODE_DISABLE_COMPILE_CACHE:'1',NODE_NO_WARNINGS:'1' } });
    let stdout = '', stderr = '';
    child.stdout.on('data',bytes => { stdout += bytes; if (Buffer.byteLength(stdout) > 262144) child.kill('SIGTERM'); });
    child.stderr.on('data',bytes => { stderr += bytes; if (Buffer.byteLength(stderr) > 65536) child.kill('SIGTERM'); });
    const done = new Promise((resolve,reject) => { child.once('error',reject); child.once('close',(code,signal) => resolve({ code,signal,stdout,stderr })); });
    const exited = new Promise((resolve,reject) => { child.once('error',reject); child.once('exit',(code,signal) => resolve({ code,signal })); });
    f.workspace.defer(async () => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM'); if (rawDriver) await stopOwnedChildren(); await done; });
    if (rawDriver) { const info = processInfo(child.pid); if (info) drivers.push(info); }
    return { child,done,exited };
  };
  return { ...f,stateRoot,identityKeyPath,context,options,header,sourcePath,writeSource,cursorPath,cursor,runWorker,providerMode,executable,
    readyPath,releasePath,childrenStopped,stopOwnedChildren };
}
