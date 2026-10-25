#!/usr/bin/env node
// Full attended offline A-6/A-6.1 verification; first failure stops execution.
// Run directly here by explicit primary instruction. The primary reruns locked.
import {spawn} from 'node:child_process';
import {mkdirSync,mkdtempSync,openSync,closeSync,readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {hash,atomicJSON} from './common.mjs';
const h='evaluation/hr3/harness';mkdirSync(h+'/artifacts',{recursive:true});
const artifacts=mkdtempSync(h+'/artifacts/a61-scorer-v7-verification-');mkdirSync(artifacts+'/tmp');
const inputs=artifacts+'/inputs',deps=['--mcp-dependencies','adapters/mcp/node_modules','--tokenizer-dependencies','adapters/openai/node_modules'];
const node=(name,...args)=>({name,args});
const protectedRoots=['evaluation/hr3/generator','evaluation/hr3/scorer','evaluation/hr3/protocol','evaluation/hr3/runner'];
function protectedSources(){const walk=dir=>readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(dir+'/'+e.name):e.isFile()?[dir+'/'+e.name]:[]);return Object.fromEntries(protectedRoots.flatMap(walk).sort().map(p=>[p,hash(readFileSync(p))]));}
const protectedEntry=protectedSources();
const scorerTests=readdirSync('evaluation/hr3/scorer/test').filter(n=>n.endsWith('.test.mjs')).sort().map(n=>'evaluation/hr3/scorer/test/'+n);
const steps=[
 node('strict-schema',h+'/strict-schema.mjs'),node('published-schemas',h+'/schemas-a4.mjs'),
 node('private-field-inventory',h+'/private-field-inventory.mjs'),node('inspected-references',h+'/inspected-references.mjs'),
 node('runtime-closure',h+'/runtime-closure.mjs'),
 node('placeholder-inventory-tests','--test','--experimental-test-isolation=none',h+'/test/placeholder-inventory-a6.test.mjs'),
 node('authenticated-consumers','--test','--experimental-test-isolation=none',h+'/test/trivia-consumers-a6.test.mjs'),
 node('context-certificate',h+'/context-certification.mjs'),node('output-certificate',h+'/cap-certification.mjs'),
 node('input-feasibility',h+'/preflight-a6.mjs'),node('request-embedding-certificate',h+'/request-certification.mjs'),
 node('accounting',h+'/accounting-a6.mjs'),node('projection-schema',h+'/projection-schema.mjs'),node('budget',h+'/budget-a6.mjs'),node('continuation-projection',h+'/continuation-a6.mjs'),
 node('generator-tests','--import','./'+h+'/test/redirect-generator-temp.mjs','--test','--experimental-test-isolation=none','evaluation/hr3/generator/test/generator.test.mjs'),
 node('scorer-tests','--import','./'+h+'/test/redirect-generator-temp.mjs','--test','--experimental-test-isolation=none',...scorerTests),
 node('integration-tests','--test','--experimental-test-isolation=none','evaluation/hr3/integration/test/integration.test.mjs'),
 node('harness-tests',h+'/test.mjs',...deps),
 node('pilot-inputs','evaluation/hr3/generator/cli.mjs','--split','pilot','--out',inputs),
 node('fake-pilot',h+'/cli.mjs','--stage','pilot','--inputs',inputs,'--out',artifacts+'/pilot','--carry-forward',h+'/reports/a6-carry-forward.json',...deps),
 node('leak-scan',h+'/leak-scan.mjs',artifacts+'/pilot',inputs),
 node('bound-report',h+'/cli.mjs','--bound-report',artifacts+'/pilot','--inputs',inputs,'--out',artifacts+'/bounds.json'),
 node('integration-reconciliation','evaluation/hr3/integration/reconcile-a6.mjs'),node('certification-bundle',h+'/certification-bundle-a6.mjs'),
];
const verification={version:'hr3-a6.1-scorer-v7-offline-verification-v1',status:'RUNNING',inputs,artifacts,heavyLock:'UNLOCKED_DIRECT_RUN_AUTHORIZED_BY_PRIMARY',discardedRuns:['evaluation/hr3/harness/artifacts/a61-auth-verification-K87qtx','evaluation/hr3/harness/artifacts/a61-placeholder-verification-Siy8BY'],protectedInputSources:protectedEntry,paidReadiness:false,networkCalls:0,paidCalls:0,providerDispatches:0,newPaidReservations:0,fullFakePilotComplete:false,commands:[],
 freeze:{status:'PENDING_PRIMARY',command:'node '+h+'/freeze-a6.mjs',reason:'Primary reruns locked and freezes after a passing non-author audit.'}};
const save=()=>{atomicJSON(h+'/reports/a6-verification.json',verification);writeFileSync(artifacts+'/verification.json',JSON.stringify(verification,null,2)+'\n');};save();
for(const {name,args} of steps){
 const stdoutPath=artifacts+'/'+name+'.stdout',stderrPath=artifacts+'/'+name+'.stderr',stdout=openSync(stdoutPath,'wx'),stderr=openSync(stderrPath,'wx');
 process.stdout.write('START '+name+'\n');
 const child=spawn(process.execPath,args,{env:{...process.env,TMPDIR:resolve(artifacts+'/tmp')},stdio:['ignore',stdout,stderr]});
 let result;try{result=await new Promise((accept,reject)=>{child.once('error',reject);child.once('close',(exitCode,signal)=>accept({exitCode,signal}));});}finally{closeSync(stdout);closeSync(stderr);}
 // Portability applies only to diagnostic logs, never bodies/P blocks/journals.
 for(const p of [stdoutPath,stderrPath]){const text=readFileSync(p,'utf8').replaceAll('file://'+process.cwd()+'/','').replaceAll(process.cwd()+'/','');writeFileSync(p,text);}
 writeFileSync(artifacts+'/'+name+'.exit',String(result.exitCode)+'\n');verification.commands.push({name,command:'node '+args.join(' '),...result,logs:{[stdoutPath]:hash(readFileSync(stdoutPath)),[stderrPath]:hash(readFileSync(stderrPath))}});
 if(name==='fake-pilot'&&result.exitCode===0){const s=JSON.parse(readFileSync(artifacts+'/pilot/summary.json'));verification.fullFakePilotComplete=s.complete&&s.attempted===480;}
 process.stdout.write('EXIT '+name+' '+result.exitCode+'\n');save();
 const current=protectedSources(),changed=[...new Set([...Object.keys(protectedEntry),...Object.keys(current)])].filter(p=>protectedEntry[p]!==current[p]);
 if(changed.length){verification.status='FAIL_PROTECTED_INPUT_CHANGED';verification.blockingStep=name;verification.protectedChanges=changed;save();process.exitCode=1;break;}
 if(result.exitCode!==0){verification.status='FAIL_STOPPED_AT_FIRST_FAILURE';verification.blockingStep=name;save();process.exitCode=1;break;}
}
if(verification.status==='RUNNING'){verification.status='PASS_OFFLINE_PENDING_PRIMARY_FREEZE';save();}
