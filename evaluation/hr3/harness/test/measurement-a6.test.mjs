import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {createRequire} from 'node:module';
import {hash,canonical,bytes} from '../common.mjs';import {validateRequest} from '../requests.mjs';import {providerSchema,answerSchema,extractionSchema} from '../schema.mjs';
import {validate} from '../../scorer/schema.mjs';
test('A6 measurement: complete bodies and maximal output hashes recount exactly; historical measurements remain non-certifying after A-6.1; approved ceilings admit their exact bodies',()=>{
 const r=JSON.parse(readFileSync('evaluation/hr3/harness/reports/measurement-a6.json'));assert.equal(r.status,'MEASUREMENT_ONLY_NOT_CERTIFIED');assert.equal(r.dispatches,0);assert.equal(r.journalsCreated,0);assert.equal(r.paidAuthorization,false);assert.equal(r.privacyHits,0);assert.equal(r.inheritance.length,4);assert.equal(r.context.cases.length,9);
 assert.equal(r.coverage.length,240);assert.deepEqual(new Set(r.coverage.map(x=>x.language)),new Set(['en','zh-Hant','mixed']));assert.equal(r.actualPOperations>0,true);
 const encoding=createRequire(new URL('../../../../adapters/openai/package.json',import.meta.url))('tiktoken').get_encoding('o200k_base');try{
 for(const [kind,w]of Object.entries(r.worst)){
  if(kind.startsWith('input/')){assert.equal(bytes(w.body)+4096,w.units);assert.equal(hash(w.body),w.bodySHA256);assert.equal(w.minimumCeiling,Math.ceil(w.units*100/95));const operation=kind.includes('extractor')?'extraction':'reader',arm=kind.split('/').at(-1);assert.equal(validateRequest({operation,body:w.body,id:'measurement/reader/'+arm+'/2'}).input,w.units);}
  else{assert.equal(hash(w.serialization),w.bodySHA256);assert.equal(encoding.encode(w.serialization,[],[]).length,w.units);assert.equal(w.minimumCeiling,Math.ceil(w.units*100/90));assert.deepEqual(validate(providerSchema(kind==='output/extraction'?extractionSchema:answerSchema),JSON.parse(w.serialization)),[]);}
 }
 }finally{encoding.free();}
 assert.ok(Object.entries(r.sources).some(([p,d])=>hash(readFileSync(p))!==d),'Historical measurement bindings cannot substitute for a current certificate');
});
