// Independent SQLite writer. Coordination is file-based, with no stdio pipes.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { openMemoryCore } from '../contract.mjs';
import { host } from './method-package-fixtures.mjs';

const [configuration]=process.argv.slice(2);
const {path,method,input,ready,start,entered,result,fenceChecks}=JSON.parse(readFileSync(configuration,'utf8'));
const trusted=host(),core=openMemoryCore({path,methodPackages:trusted.options});
try {
  writeFileSync(ready,String(process.pid),{flag:'wx',mode:0o600});
  const deadline=Date.now()+15000;
  while(!existsSync(start)) {
    if(Date.now()>deadline)throw Error('race_start_barrier_timeout');
    await delay(5);
  }
  trusted.state.hook=checks=>{if(checks===fenceChecks)writeFileSync(entered,String(process.pid),{flag:'wx',mode:0o600});};
  const outcome=trusted.call(core,method,input);
  writeFileSync(result,JSON.stringify({pid:process.pid,outcome,checks:trusted.state.checks}),{flag:'wx',mode:0o600});
} finally {core.close();}
