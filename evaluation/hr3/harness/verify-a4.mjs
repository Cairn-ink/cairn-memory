#!/usr/bin/env node
// Attended offline verification. Safe independent checks continue after a gate
// fails so the primary receives the complete ordered result, never a paid run.
import {spawn} from 'node:child_process';
import {mkdirSync,mkdtempSync,openSync,closeSync,readFileSync,readdirSync,writeFileSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {hash,atomicJSON} from './common.mjs';
const h='evaluation/hr3/harness';mkdirSync(h+'/artifacts',{recursive:true});
const artifacts=mkdtempSync(h+'/artifacts/a4-verification-');mkdirSync(artifacts+'/tmp');
const deps=['--mcp-dependencies','adapters/mcp/node_modules','--tokenizer-dependencies','adapters/openai/node_modules'];
const node=(name,...args)=>({name,args});
const scorerTests=readdirSync('evaluation/hr3/scorer/test').filter(n=>n.endsWith('.test.mjs')).sort().map(n=>'evaluation/hr3/scorer/test/'+n);
const steps=[
 node('strict-schema',h+'/strict-schema.mjs'),node('published-schemas',h+'/schemas-a4.mjs'),
 node('private-field-inventory',h+'/private-field-inventory.mjs'),node('inspected-references',h+'/inspected-references.mjs'),
 node('runtime-closure',h+'/runtime-closure.mjs'),node('context-certificate',h+'/context-certification.mjs'),
 node('cap-certificate',h+'/cap-certification.mjs'),node('request-certificate',h+'/request-certification.mjs'),
 node('accounting',h+'/accounting-a4.mjs'),node('projection-schema',h+'/projection-schema.mjs'),node('budget',h+'/budget-a4.mjs'),node('continuation-projection',h+'/continuation-a4.mjs'),
 node('generator-tests','--import','./'+h+'/test/redirect-generator-temp.mjs','--test','--experimental-test-isolation=none','evaluation/hr3/generator/test/generator.test.mjs'),
 node('scorer-tests','--import','./'+h+'/test/redirect-generator-temp.mjs','--test','--experimental-test-isolation=none',...scorerTests),
 node('integration-tests','--test','--experimental-test-isolation=none','evaluation/hr3/integration/test/integration.test.mjs'),
 node('harness-tests',h+'/test.mjs',...deps),
 node('pilot-inputs','evaluation/hr3/generator/cli.mjs','--split','pilot','--out',artifacts+'/inputs'),
 node('fake-pilot',h+'/cli.mjs','--stage','pilot','--inputs',artifacts+'/inputs','--out',artifacts+'/pilot','--carry-forward',h+'/reports/a4-carry-forward.json',...deps),
 node('leak-scan',h+'/leak-scan.mjs',artifacts+'/pilot',artifacts+'/inputs'),
 node('bound-report',h+'/cli.mjs','--bound-report',artifacts+'/pilot','--inputs',artifacts+'/inputs','--out',artifacts+'/bounds.json'),
 node('certification-bundle',h+'/certification-bundle-a4.mjs'),
];
const verification={version:'hr3-a4-offline-verification-v1',status:'RUNNING',artifacts,networkCalls:0,paidCalls:0,commands:[],
 freeze:{status:'PENDING_PRIMARY',command:'node '+h+'/freeze-a4.mjs',reason:'Primary runs freeze with git outside this sandbox.'}};
const save=()=>atomicJSON(h+'/reports/a4-verification.json',verification);save();
for(const {name,args} of steps){
 if(name==='leak-scan'&&existsSync(artifacts+'/pilot/summary.json')&&!JSON.parse(readFileSync(artifacts+'/pilot/summary.json')).complete)args.push('--partial');
 const stdoutPath=artifacts+'/'+name+'.stdout',stderrPath=artifacts+'/'+name+'.stderr';
 const stdout=openSync(stdoutPath,'wx'),stderr=openSync(stderrPath,'wx');
 process.stdout.write('START '+name+'\n');
 const child=spawn(process.execPath,args,{env:{...process.env,TMPDIR:resolve(artifacts+'/tmp')},stdio:['ignore',stdout,stderr]});
 let result;try{result=await new Promise((accept,reject)=>{child.once('error',reject);child.once('close',(exitCode,signal)=>accept({exitCode,signal}));});}
 finally{closeSync(stdout);closeSync(stderr);}
 writeFileSync(artifacts+'/'+name+'.exit',String(result.exitCode)+'\n');
 verification.commands.push({name,command:'node '+args.join(' '),...result,logs:{[stdoutPath]:hash(readFileSync(stdoutPath)),[stderrPath]:hash(readFileSync(stderrPath))}});
 process.stdout.write('EXIT '+name+' '+result.exitCode+'\n');save();
}
verification.status=verification.commands.every(c=>c.exitCode===0)?'PASS_OFFLINE_PENDING_PRIMARY_FREEZE':'FAIL';save();
process.exitCode=verification.status==='FAIL'?1:0;
