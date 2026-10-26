import { pathToFileURL } from 'node:url';
const [root,path,encoded]=process.argv.slice(2),job=JSON.parse(encoded);
const {openMemoryCore,openContextReader}=await import(pathToFileURL(root+'/core/index.mjs'));
const {createContextReadAccess}=await import(pathToFileURL(root+'/adapters/mcp/context-read-access.mjs'));
const namespace={ownerId:'synthetic-context-owner',scope:'personal',projectId:null};
const access=createContextReadAccess(namespace);let core,calls=0;
const ok=result=>{if(!result.ok)throw Error(JSON.stringify(result));return result.value;};
try {
  if(job.mode==='capture') {
    core=openMemoryCore({path,model:{contextWindow:8192,countTokens:()=>1,extract:({input})=>{
      calls++;return {items:[{content:input.messages[0].content,kind:'fact',confidence:.8,sourceIndices:[0]}]};
    }}});
    for(const [i,text] of job.texts.entries())ok(await core.capture({namespace,client:'synthetic',sessionId:'installed-context',eventId:'capture-'+i,
      messages:[{id:'source-'+i,role:'user',content:text}]}));
    console.log(JSON.stringify({ok:true,value:{pid:process.pid,modelCalls:calls,memories:ok(core.list({namespace,limit:50})).memories.map(row=>ok(core.get({namespace,memoryId:row.id})).memory)}}));
  } else if(job.mode==='fused') {
    const {createFakeEmbedder}=await import(pathToFileURL(root+'/core/context-read-embedder.mjs'));
    const embedder=createFakeEmbedder({dimensions:256,aliases:{automobile:'car'}}),token=Object.freeze({}),grants=new WeakMap();
    const authority={authorize(request,supplied){if(supplied!==token)return null;const grant={}, {input,...binding}=request;
      grants.set(grant,{...binding,accessGeneration:1});return grant;},isCurrent(grant){return grants.get(grant)??null;}};
    core=openMemoryCore({path,contextRead:{version:'context-read-v1',authority,embedder,
      policy:{family:job.family,maxRequests:100,maxUsd:1,estimateUsd:()=>0}}});
    ok(await core.refreshContextIndex({readSet:[namespace],types:['memory'],intent:'current',budget:{maxItems:128,maxMs:5000}},token));
    const results=[];
    for(const query of job.queries)results.push(ok(await core.findCandidates({readSet:[namespace],types:['memory'],intent:'current',
      query,semantic:true,limit:24,deadlineMs:5000},token)));
    console.log(JSON.stringify({ok:true,value:results}));
  } else {
    core=job.mode==='read-only'?openContextReader({path,contextRead:access.configuration}):openMemoryCore({path,
      ...(job.mode==='managed'?{existingStore:{version:'schema30-existing-v1',storeId:job.storeId}}:{}),contextRead:access.configuration});
    const input={readSet:access.readSet,query:'SQLite',types:['memory'],intent:'current',deadlineMs:5000};
    const result=await access.call(core,'findCandidates',input);
    if(job.refresh)console.log(JSON.stringify(await core.refreshContextIndex({readSet:access.readSet,types:['memory'],intent:'current',budget:{maxItems:1,maxMs:1}},{})));
    else console.log(JSON.stringify(result));
  }
} catch(error) { console.log(JSON.stringify({ok:false,error:{code:error.code??'storage_error',retryable:false}})); }
finally {access.revoke();core?.close();}
