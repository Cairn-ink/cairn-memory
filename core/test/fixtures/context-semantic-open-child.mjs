// Public coordinator-only contention probe; this process never imports adapters.
import { readFileSync } from 'node:fs';
import { createContextReadSupervisor,openContextSemanticCoordinator } from '../../index.mjs';
const options=JSON.parse(readFileSync(0,'utf8'));
const supervisor=createContextReadSupervisor(),state=new SharedArrayBuffer(64);new Int32Array(state)[0]=1;
options.supervisor=supervisor;options.host.configuration.state=state;
let coordinator;
try {
  coordinator=await openContextSemanticCoordinator(options);
  console.log(JSON.stringify({code:'opened'}));
} catch(error) {console.log(JSON.stringify({code:error.code}));}
finally {await coordinator?.close();await supervisor.close();}
