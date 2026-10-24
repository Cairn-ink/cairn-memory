#!/usr/bin/env node
// Attended offline sequence. Persist each actual child exit code and stop at
// the first failure. The caller must supervise this process until it exits.
import {spawn} from 'node:child_process';
import {mkdirSync,mkdtempSync,openSync,closeSync,readFileSync,writeFileSync,copyFileSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {atomicJSON,hash} from './common.mjs';
const h='evaluation/hr3/harness';
mkdirSync(h+'/artifacts',{recursive:true});
const artifacts=mkdtempSync(h+'/artifacts/a3-verification-');
mkdirSync(artifacts+'/tmp');
// Retain the first failed verification record as engineering history.
const firstFailure=h+'/reports/a3-verification-first-failure.json';
if(!existsSync(firstFailure)&&existsSync(h+'/reports/a3-verification.json')) {
  const previous=JSON.parse(readFileSync(h+'/reports/a3-verification.json','utf8'));
  if(previous.status==='FAIL')copyFileSync(h+'/reports/a3-verification.json',firstFailure);
}
const node=(name,...args)=>({name,args});
const dependencies=['--mcp-dependencies','adapters/mcp/node_modules','--tokenizer-dependencies','adapters/openai/node_modules'];
const steps=[
  node('strict-schema',h+'/strict-schema.mjs'),
  node('offline-replay',h+'/replay-a3.mjs'),
  node('inspected-references',h+'/inspected-references.mjs'),
  node('projection-schema',h+'/projection-schema.mjs'),
  node('cap-certificate',h+'/cap-certification.mjs'),
  node('request-certificate',h+'/request-certification.mjs'),
  node('budget',h+'/budget-a2.mjs'),
  node('generator-tests','--import','./'+h+'/test/redirect-generator-temp.mjs','--test','--experimental-test-isolation=none','evaluation/hr3/generator/test/generator.test.mjs'),
  node('integration-tests','--test','--experimental-test-isolation=none','evaluation/hr3/integration/test/integration.test.mjs'),
  node('harness-tests',h+'/test.mjs',...dependencies),
  node('pilot-inputs','evaluation/hr3/generator/cli.mjs','--split','pilot','--out',artifacts+'/inputs'),
  node('fake-pilot',h+'/cli.mjs','--stage','pilot','--inputs',artifacts+'/inputs','--out',artifacts+'/pilot','--carry-forward',h+'/reports/a3-carry-forward.json',...dependencies),
  node('bound-report',h+'/cli.mjs','--bound-report',artifacts+'/pilot','--inputs',artifacts+'/inputs','--out',artifacts+'/bounds.json'),
];
const verification={version:'hr3-a3-audited-offline-verification-v3',status:'RUNNING',networkCalls:0,paidCalls:0,commands:[]};
const save=()=>atomicJSON(h+'/reports/a3-verification.json',verification);
save();
async function execute({name,args}) {
  const stdoutPath=artifacts+'/'+name+'.stdout',stderrPath=artifacts+'/'+name+'.stderr';
  const stdout=openSync(stdoutPath,'wx'),stderr=openSync(stderrPath,'wx');
  process.stdout.write('START '+name+'\n');
  const child=spawn(process.execPath,args,{env:{...process.env,TMPDIR:resolve(artifacts+'/tmp')},stdio:['ignore',stdout,stderr]});
  let result;
  try {result=await new Promise((accept,reject)=>{child.once('error',reject);child.once('close',(exitCode,signal)=>accept({exitCode,signal}));});}
  finally {closeSync(stdout);closeSync(stderr);}
  writeFileSync(artifacts+'/'+name+'.exit',String(result.exitCode)+'\n');
  process.stdout.write('EXIT '+name+' '+result.exitCode+'\n');
  const record={name,command:'node '+args.join(' '),...result,
    logs:{[stdoutPath]:hash(readFileSync(stdoutPath)),[stderrPath]:hash(readFileSync(stderrPath))}};
  return record;
}
for(const step of steps) {
  const record=await execute(step);verification.commands.push(record);
  if(record.exitCode!==0){verification.status='FAIL';save();process.exitCode=1;break;}
  save();
}
if(verification.status!=='FAIL') {
  verification.status='PASS';save();
  // The enclosing freeze hashes this completed verification record. Its own
  // actual exit status is separate to avoid a circular hash dependency.
  const freeze=await execute(node('freeze',h+'/freeze-a3.mjs'));
  if(freeze.exitCode!==0){verification.status='FAIL';verification.commands.push(freeze);save();process.exitCode=1;}
}
