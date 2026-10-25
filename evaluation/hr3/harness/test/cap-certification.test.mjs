import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
import {certify,readerReference,extractionReference,referenceDelivery,pilotReferenceBundles,meetsMargin} from '../cap-certification.mjs';
import {extractionInput} from '../extraction.mjs';
import {validateExtraction,answerSchema} from '../schema.mjs';
import {validate} from '../../scorer/schema.mjs';
import {scorerGold} from '../inputs.mjs';
import {score} from '../../scorer/scorer.mjs';
import {engineeringStressFixtures} from '../cap-stress-fixtures.mjs';
import {hash} from '../common.mjs';
const read=()=>JSON.parse(readFileSync(new URL('../reports/cap-certification-a4.json',import.meta.url)));
test('A-4 certificate reproduces all 240 pilot/engineering families without held-out rendering',()=>{
 const actual=certify();assert.deepEqual(actual,read());assert.equal(actual.status,'PASS');
 assert.deepEqual(actual.counts.map(c=>[c.families,c.checkpoints,c.extractionBatches]),[[60,120,240],[180,360,720]]);
 assert.ok(actual.structures.every(s=>s.failures===0&&s.worst.marginPercent>=10));
 assert.equal(meetsMargin(1958,2176),true);assert.equal(meetsMargin(1959,2176),false);
 assert.equal(meetsMargin(3916,4352),true);assert.equal(meetsMargin(3917,4352),false);
});
test('every maximal serialized output recounts under the actual tokenizer and closed schemas',()=>{
 const encoder=createRequire(new URL('../../../../adapters/openai/package.json',import.meta.url))('tiktoken').get_encoding('o200k_base');
 try {for(const {worst:r} of read().structures){assert.equal(encoder.encode(r.serialization,[],[]).length,r.tokens);assert.equal(hash(r.serialization),r.sha256);assert.equal(r.pass,true);}}
 finally{encoder.free();}
});
test('slot references preserve complete C/O and causal selection with no known false R claim',()=>{
 for(const b of pilotReferenceBundles())for(const cp of b.family.checkpoints){const answer=readerReference(b,cp.batch),gold=scorerGold(b.family,cp,b.gold,b.support);
  assert.deepEqual(validate(answerSchema,answer),[]);const s=score(gold,{answer,delivered:referenceDelivery(b.family,cp.batch)});
  assert.equal(s.valid,true);assert.equal(s.scores.C,1);assert.equal(s.scores.O,1);assert.notEqual(s.scores.R,0);
  if(answer.reason.status==='not_stated')assert.equal(s.scores.R,1);
  assert.deepEqual(answer.old.records.map(r=>r.predecessor_turn).sort(),cp.requested_predecessor_turns.slice().sort());
 }
});
test('maximal slot/context branches admit; a bad quote cannot discard an independently supported assignment',()=>{
 for(const {family:f} of engineeringStressFixtures())for(const b of f.batches){const raw=extractionReference(f,b.ordinal),input=extractionInput(f,b.ordinal),result=validateExtraction(raw,input);
  assert.equal(result.events.length,raw.events.length);assert.ok(result.events.some(e=>e.context));
  const event=raw.events.find(e=>e.payload.type==='slots'&&e.payload.route);if(!event)continue;
  event.reason_quotes.push({turn_id:event.source_turns[0],quote:'invented unsupported clause',occurrence:1});
  const bad=validateExtraction(raw,input);assert.equal(bad.events.length,result.events.length);assert.equal(bad.diagnostics.excludedQuotations,1);
 }
});
test('certifier import graph forbids held-out generation and retains negative-control blocking',()=>{
 const p=spawnSync(process.execPath,['evaluation/hr3/harness/test/guard-certification.mjs'],{encoding:'utf8',maxBuffer:1024*1024});
 assert.equal(p.status,0,p.stderr); // NODE_TEST_CONTEXT can suppress child stdout; exit status retains the guard's assertions.
});
