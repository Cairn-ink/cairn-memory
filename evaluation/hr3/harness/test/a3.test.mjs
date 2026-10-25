import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {providerSchema,extractionSchema,answerSchema} from '../schema.mjs';
import {checkStrictSchema} from '../strict-schema.mjs';
import {replayA3} from '../replay-a3.mjs';
import {extractionDiagnostics} from '../extraction-diagnostics.mjs';
import {EXTRACTION_PROMPT,READER_PROMPT} from '../requests.mjs';

test('both provider schemas type plain nodes, isolate refs, allow untyped unions and close objects',()=>{
  for(const schema of [extractionSchema,answerSchema]) {
    const before=structuredClone(schema),encoded=providerSchema(schema);
    assert.ok(checkStrictSchema(encoded).nodes>30);assert.deepEqual(schema,before);
    const bad=structuredClone(encoded);delete bad.type;assert.throws(()=>checkStrictSchema(bad),/type required/);
    const open=structuredClone(encoded);open.additionalProperties=true;assert.throws(()=>checkStrictSchema(open),/closed object/);
    const optional=structuredClone(encoded);optional.required=[];assert.throws(()=>checkStrictSchema(optional),/all properties required/);
  }
  assert.deepEqual(Object.keys(extractionSchema.$defs.Anchor.properties),['turn_id','quote','occurrence']);
});
test('strict checker rejects the observed const-without-type and type-beside-ref failures',()=>{
  assert.throws(()=>checkStrictSchema({const:'decision'}),/type required/);
  assert.deepEqual(checkStrictSchema({type:'string',const:'decision'}),{nodes:1,objects:0});
  const schema={type:'object',additionalProperties:false,required:['value'],properties:{value:{$ref:'#/$defs/value'}},$defs:{value:{type:'string'}}};
  assert.doesNotThrow(()=>checkStrictSchema(schema));
  for(const sibling of [{type:'string'},{description:'extra'},{anyOf:[{type:'string'}]}]) {
    const bad=structuredClone(schema);Object.assign(bad.properties.value,sibling);
    assert.throws(()=>checkStrictSchema(bad),/\$ref must have no sibling keywords/);
  }
  assert.doesNotThrow(()=>checkStrictSchema({anyOf:[{type:'string'},{type:'null'}]}));
  assert.throws(()=>checkStrictSchema({anyOf:[{const:null}]}),/type required/);
  assert.throws(()=>checkStrictSchema({anyOf:[{type:'object',properties:{},required:[]}]}),/closed object/);
});
test('A-4 prompts announce supplied slots, anchored context and complete quoted explanations',()=>{
 assert.match(EXTRACTION_PROMPT,/independent assignment\/reason admission/);assert.match(EXTRACTION_PROMPT,/current-batch/);
 assert.match(READER_PROMPT,/old records match requested turns/);assert.match(READER_PROMPT,/complete serial\/conjunctive explanation/);
 assert.ok(!EXTRACTION_PROMPT.includes('field_mask'));assert.ok(!READER_PROMPT.includes('Reason edges'));
});
test('all 240 first-pilot bodies/replies replay reproducibly as a separate engineering diagnostic',()=>{
  const actual=replayA3(),saved=JSON.parse(readFileSync(new URL('../reports/a3-offline-replay.json',import.meta.url)));
  assert.deepEqual(actual,saved);
  assert.deepEqual(actual.quoteEvidence,{quotes:973,wrongOffsets:968,verbatimWrongOffsets:965,ambiguousQuotes:43});
  assert.deepEqual(actual.eventQuoteEvidence,{quotes:730,wrongOffsets:725,verbatimWrongOffsets:723,ambiguousQuotes:27});
  const d=actual.pipelineStageDiagnostics;
  assert.equal(d.table.length,240);assert.equal(d.totals.batchFailures,0);
  assert.equal(d.totals.totalEvents,d.totals.validEvents+d.totals.rejectedEvents);
  for(const b of actual.batches){assert.equal(b.diagnostics.totalEvents,b.diagnostics.validEvents+b.diagnostics.rejectedEvents);assert.equal(b.diagnostics.rejected.length,b.diagnostics.rejectedEvents);}
});
test('pipeline diagnostics count shared batches once and separate empty extractions from batch failures',()=>{
  const make=(batch,diagnostics,error=null)=>({family:'synthetic',batch,key:String(batch),diagnostics,error});
  const rows=[make(1,{totalEvents:2,validEvents:1,rejectedEvents:1,reasons:{invalid_field_mask:1}}),
    make(2,{totalEvents:1,validEvents:0,rejectedEvents:1,reasons:{invalid_field_mask:1,invalid_extraction_quote:1}}),
    make(3,{totalEvents:null,validEvents:0,rejectedEvents:0,reasons:{}},'malformed_extraction')];
  assert.deepEqual(extractionDiagnostics(rows).totals,{batches:3,batchFailures:1,emptyExtractions:1,rawAssignments:0,admittedAssignments:0,excludedAssignments:0,rawQuotations:0,admittedQuotations:0,excludedQuotations:0,totalEvents:3,validEvents:1,rejectedEvents:2,reasons:{invalid_field_mask:2,invalid_extraction_quote:1}});
  assert.equal(extractionDiagnostics([{family:'old'}]).available,false);
});
