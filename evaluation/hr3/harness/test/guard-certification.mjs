// A fresh process: no generator module can already be cached.
import {registerHooks} from 'node:module';
import assert from 'node:assert/strict';
let blocked=0;
registerHooks({resolve(specifier,context,next){
  const result=next(specifier,context);
  if(/\/generator\/(generate|deliver|inventory|cli|controls)\.mjs$/.test(result.url)){
    blocked++;throw Error('certifier_generation_import_forbidden');
  }
  return result;
}});
const {certify}=await import('../cap-certification.mjs');
const report=certify();
assert.equal(blocked,0);
assert.deepEqual(report.counts.map(c=>c.split),['pilot','engineering-stress']);
await assert.rejects(import('../../generator/generate.mjs'),/certifier_generation_import_forbidden/);
assert.equal(blocked,1);
process.stdout.write(JSON.stringify({heldOutImports:0,negativeControlBlocked:true,status:report.status})+'\n');
