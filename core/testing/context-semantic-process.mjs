import './context-product-test-clock.mjs';
// An owned throwaway process: deterministic kills cannot affect the test runner.
import { readFileSync } from 'node:fs';
import { createContextReadSupervisor,openContextSemanticCoordinator,openContextIndexMaintainer } from '../index.mjs';
const {options,token,maintainer,crash,purge}=JSON.parse(readFileSync(0,'utf8'));
const supervisor=createContextReadSupervisor(),state=new SharedArrayBuffer(64);new Int32Array(state)[0]=1;
options.supervisor=supervisor;options.host.configuration={...options.host.configuration,state,...crash};
const c=await openContextSemanticCoordinator(options);
const check=result=>{if(!result.ok)throw Error(result.error.code);return result.value;};
try {
  const ownerId=options.host.configuration.semanticServiceBinding.ownerId;
  check(await c.setOwnerSemantic({ownerId,semantic:!purge,expectedRevision:purge?1:0},token));
  if(purge)check(await c.purgeOwnerVectors({ownerId,budget:{maxItems:1,maxMs:5000}},token));
  if(maintainer) {
    maintainer.options.supervisor=supervisor;maintainer.options.semanticConfig={version:'context-read-product-p2e-v1',coordinator:c};maintainer.options.host.configuration.state=state;
    const h=await openContextIndexMaintainer(maintainer.options);
    try {
      const input={readSet:maintainer.options.readSet,types:['memory'],intent:'current'};
      check(await h.refreshContextIndex({...input,mode:'lexical',budget:{maxItems:1024,maxMs:5000}},maintainer.credential));
      check(await h.refreshContextIndex({...input,mode:'embeddings',budget:{maxItems:1024,maxMs:5000,maxUsd:'0.50'}},maintainer.credential));
    }finally{await h.close();}
  }
}finally{await c.close();await supervisor.close();}
