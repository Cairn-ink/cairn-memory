import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,readFileSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

test('full candidate gate resolves no dependency from the independent oracle',async t=>{
 const directory=mkdtempSync(join(tmpdir(),'candidate-resolve-'));
 t.after(()=>rmSync(directory,{recursive:true,force:true}));
 const log=join(directory,'resolves.jsonl');
 const environment={...process.env,S2H_ORACLE_RESOLVE_LOG:log};
 // A new --test runner must not inherit the parent runner's worker context.
 delete environment.NODE_TEST_CONTEXT;
 const child=spawn(process.execPath,['--import',fileURLToPath(new URL('../testing/content-safety-s2h-candidate-resolve.mjs',import.meta.url)),
  '--test','--test-reporter=tap','--test-concurrency=1',fileURLToPath(new URL('./content-safety-s2h-candidate-batch.test.mjs',import.meta.url))],
  {env:environment,stdio:['ignore','pipe','pipe']});
 let stdout='',stderr='';
 child.stdout.on('data',chunk=>{stdout+=chunk;});child.stderr.on('data',chunk=>{stderr+=chunk;});
 const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});
 assert.equal(code,0,stdout+'\n'+stderr);
 const records=readFileSync(log,'utf8').trim().split('\n').map(line=>JSON.parse(line));
 const oracle=new URL('../testing/content-safety-s2h-candidate-oracle.mjs',import.meta.url).href;
 assert.ok(records.some(record=>record.url===oracle),'recorder observes the actual oracle load');
 assert.deepEqual(records.filter(record=>record.parent===oracle),[],'oracle resolves no child dependency');
 assert.ok((stdout.match(/BATCH_DIFFERENTIAL /g)??[]).length>0,'full unfiltered generated gate ran');
 t.diagnostic('ORACLE_RUNTIME_RESOLVE_LOG '+JSON.stringify(records));
 t.diagnostic('ORACLE_RUNTIME_RESOLVES '+JSON.stringify({resolutions:records.length,oracleModules:1,oracleEdges:0}));
 for(const line of stdout.split('\n').filter(line=>/BATCH_DIFFERENTIAL|# (tests|pass|fail|skipped|todo) /.test(line)))t.diagnostic('CHILD '+line);
});
