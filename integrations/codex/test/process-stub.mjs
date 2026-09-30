// Test-only real hook and worker processes. Fixed owner-only synthetic config.
import { spawn } from 'node:child_process';
import { writeSync } from 'node:fs';
import { privateRead } from '../../client/private-state.mjs';
import { readHookInput, handleHook, workerFromHandoff } from '../hook.mjs';
import { createRuntimeGuard } from '../../client/runtime-usage.mjs';
const [kind,configPath]=process.argv.slice(2);
const config=JSON.parse(await privateRead(configPath));
try {
  const input=await readHookInput(process.stdin);
  if(kind==='hook') {
    const result=await handleHook(input,{...config,launch:(stdin)=>new Promise((resolve,reject)=>{
      const child=spawn(process.execPath,[new URL(import.meta.url).pathname,'worker',configPath],{
        detached:false,stdio:['pipe','ignore','ignore'],env:process.env,shell:false});
      child.once('error',reject);
      child.stdin.once('error',reject);
      child.stdin.end(stdin,resolve);
      // Test supervisor keeps the hook process alive until its worker exits.
      // The launch itself resolves at the closed-pipe handoff, not on capture.
    })});
    if(config.exitAfterHook) {writeSync(1,result.output);process.exit(0);}
    process.stdout.write(result.output);
  } else {
    const endpoint=new URL(config.endpoint);
    if(endpoint.protocol!=='http:' || endpoint.hostname!=='127.0.0.1') throw new Error('stub_only');
    let active=false;
    const transport={terminated:()=>!active,capture:async(body,{signal})=>{
      active=true;
      try {
        const result=await fetch(endpoint,{method:'POST',redirect:'error',signal,
          headers:{'content-type':'application/json'},body:JSON.stringify(body)});
        return await result.json();
      } finally {active=false;}
    }};
    const guard=createRuntimeGuard({root:config.clientOptions.root,targetId:config.targetId,mode:'hosted',dailyCap:100});
    await workerFromHandoff(input,{...config,transport,guard});
  }
} catch { if(kind==='hook') process.stdout.write('{}'); }
