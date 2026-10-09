// Test-only real hook and worker processes. Fixed owner-only synthetic config.
import { spawn } from 'node:child_process';
import { writeSync, readFileSync } from 'node:fs';
import { PassThrough } from 'node:stream';
import { writeFile } from 'node:fs/promises';
import { mock } from 'node:test';
import { withLockClock } from '../../client/testing/lock-contention.mjs';
import { childEnvironment, installChildWire, requestJSON } from './http-harness.mjs';
import { privateRead } from '../../client/private-state.mjs';
import { readHookInput, handleHook, workerFromHandoff } from '../hook.mjs';
import { createRuntimeGuard } from '../../client/runtime-usage.mjs';
const [kind,configPath]=process.argv.slice(2);
const config=JSON.parse(await privateRead(configPath));
try {
  // The test supervisor owns a complete, closed-pipe input. Feed those bytes
  // through the real decoder without async AF_UNIX socket stdio, which an outer
  // sandbox can prohibit. Hook behavior and deadline remain unchanged.
  const stream=new PassThrough();stream.end(readFileSync(0));
  const input=await readHookInput(stream);
  if(kind==='hook') {
    const handle=()=>handleHook(input,{...config,launch:(stdin)=>new Promise((resolve,reject)=>{
      const child=spawn(process.execPath,[new URL(import.meta.url).pathname,'worker',configPath],{
        detached:false,stdio:['pipe','ignore','ignore',...(config.wire?['ipc']:[])],env:childEnvironment(),shell:false});
      if(config.wire) {
        const forward=message=>{if(child.connected)child.send(message,()=>{});};
        process.on('message',forward);
        child.on('message',message=>{if(process.connected)process.send(message,()=>{});});
        child.once('close',()=>{process.off('message',forward);process.disconnect();});
      }
      child.once('error',reject);
      child.stdin.once('error',reject);
      child.stdin.end(stdin,resolve);
      // Test supervisor keeps the hook process alive until its worker exits.
      // The launch itself resolves at the closed-pipe handoff, not on capture.
    })});
    const result = config.virtualLockClock
      ? await withLockClock({ mock }, async (clock) => {
          const value = await handle();
          const observed = { elapsed: clock.elapsed(), status: value.status };
          await writeFile(config.lockClockResult, JSON.stringify(observed), { mode: 0o600 });
          return value;
        })
      : await handle();
    if(config.exitAfterHook) {writeSync(1,result.output);process.exit(0);}
    writeSync(1,result.output);
  } else {
    const endpoint=new URL(config.endpoint);
    if(endpoint.protocol!=='http:' || endpoint.hostname!=='127.0.0.1') throw new Error('stub_only');
    const disconnect=config.wire?installChildWire():undefined;
    let active=false;
    const transport={terminated:()=>!active,capture:async(body,{signal})=>{
      active=true;
      try {
        if(config.wire)return (await requestJSON(endpoint,{body,signal})).value;
        const result=await fetch(endpoint,{method:'POST',redirect:'error',signal,
          headers:{'content-type':'application/json'},body:JSON.stringify(body)});
        return await result.json();
      } finally {active=false;}
    }};
    const guard=createRuntimeGuard({root:config.clientOptions.root,targetId:config.targetId,mode:'hosted',dailyCap:100});
    await workerFromHandoff(input,{...config,transport,guard});
    disconnect?.();
  }
} catch { if(kind==='hook') writeSync(1,'{}'); if(process.connected)process.disconnect(); }
