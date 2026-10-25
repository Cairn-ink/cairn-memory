import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {verifiedInputs,scorerCase} from '../inputs.mjs';
import {authenticatedGeneratorTrivia,trustedScoringOptions,GENERATOR_TRIVIA_FREEZE_PIN} from '../trivia-authority-a6.mjs';
import {compileTrivia,compileUnlicensedTrivia,createUnlicensedTriviaAuthority,SUPPORT_VERSION} from '../../scorer/support.mjs';
import {score,unlicensedScoringOptions} from '../scoring-a6.mjs';
import {adaptGenerator,adaptChallenge,goldWitness} from '../../integration/adapters.mjs';
import {a4Fixture} from '../../integration/test/fixtures-a4.mjs';
import {hash,canonical} from '../common.mjs';
import {UNLICENSED_AUTHORITY_A6,UNLICENSED_AUTHORITY_A6_SHA256} from '../unlicensed-authority-a6.mjs';
import {score as scorerScore} from '../../scorer/scorer.mjs';
import {findPrivateLabels,PrivacyGuard} from '../privacy.mjs';
import {createEmbedder} from '../transport.mjs';
const data=verifiedInputs('evaluation/hr3/generator/artifacts/pilot');
const spans=gold=>new Map(gold.supportSpans.map(s=>[s.id,s]));
const coverage=c=>compileTrivia(c.gold.supportTrivia,spans(c.gold),c.scoringOptions.triviaCase,c.gold.question);
function bundle(family){return {family,gold:data.gold.find(x=>x.family_id===family.family_id),support:data.support.find(x=>x.family_id===family.family_id)};}
function make(family,checkpoint=family.checkpoints[0]){const b=bundle(family);return scorerCase(family,checkpoint,b.gold,b.support);}
function statedFamily(language){return data.families.find(f=>f.language===language&&bundle(f).gold.checkpoints[0].G_correct.reason.status==='stated');}
test('A6 authenticated consumers: harness and integration retain opaque freeze-bound proofs in every language',()=>{
 for(const language of ['en','zh-Hant','mixed']){const b=bundle(data.families.find(f=>f.language===language));for(const cp of b.family.checkpoints){
  const h=make(b.family,cp),i=adaptGenerator(b.family,b.gold,b.support,cp.batch);
  for(const c of [h,i]){assert.equal(c.gold.supportVersion,SUPPORT_VERSION);assert.equal(c.gold.supportTrivia.producer.freeze_sha256,GENERATOR_TRIVIA_FREEZE_PIN);assert.equal(coverage(c).authentication.status,'authenticated');assert.ok(!Object.hasOwn(c.gold,'triviaCase'));}
  assert.equal(coverage(h).authentication.expected_case_sha256,coverage(i).authentication.expected_case_sha256);
 }}
});
test('A6 authenticated consumers: candidate offsets and changed source tapes never grant a license',()=>{
 const b=bundle(data.families[0]),registry=structuredClone(b.support.optional_trivia);registry.origins[0].positions.push(0);
 assert.throws(()=>authenticatedGeneratorTrivia(b.family,registry,b.family.checkpoints[0]),/trivia_authentication_required/);
 const changed=structuredClone(b.family);changed.batches[0].turns[0].text+=' forged';assert.throws(()=>authenticatedGeneratorTrivia(changed,b.support.optional_trivia,b.family.checkpoints[0]),/mismatch/);
});
test('A6 authenticated consumers: JSON replay reauthenticates source data; cloned normalized proofs remain protected',()=>{
 const b=bundle(data.families[0]),c=make(b.family),cloned={...c.gold,supportTrivia:structuredClone(c.gold.supportTrivia)};
 assert.equal(compileTrivia(cloned.supportTrivia,spans(cloned),c.scoringOptions.triviaCase,c.gold.question).authentication.status,'protected');assert.throws(()=>score(cloned,goldWitness(cloned),c.scoringOptions),/trivia_case_binding_required/);
 const restored=JSON.parse(JSON.stringify(b)),again=scorerCase(restored.family,restored.family.checkpoints[0],restored.gold,restored.support);assert.equal(coverage(again).authentication.status,'authenticated');
});
test('A6 authenticated challenge consumer: opaque identity survives; declared offsets cannot license punctuation omission',()=>{
 const {row,world}=a4Fixture(),plain=adaptChallenge(row,world);assert.strictEqual(plain.gold.supportTrivia,world.gold.supportTrivia);assert.equal(score(plain.gold,plain.submission,plain.scoringOptions).supportAuthentication.status,'authenticated_unlicensed');
 row.gold.supportTrivia.positions.push({origin:'source:[0,"body",null]',position:10,char:'.',rule:'forged',literal_offset:10});world.gold=structuredClone(row.gold);row.candidate.reason.support[0].quote='A causes B';assert.throws(()=>adaptChallenge(row,world),/Trusted challenge trivia target required/);
});
test('A6 authenticated consumer boundary: fixed trusted pin and sole four-argument adapter; no declaration fallback',()=>{
 assert.equal(hash(readFileSync('evaluation/hr3/generator/freeze.json')),GENERATOR_TRIVIA_FREEZE_PIN);
 for(const p of ['evaluation/hr3/harness/inputs.mjs','evaluation/hr3/integration/adapters.mjs']){const source=readFileSync(p,'utf8');assert.doesNotMatch(source,/adaptGeneratorTrivia\(/);assert.match(source,/authenticatedGeneratorTrivia\(family,supportRow.optional_trivia,checkpoint\)/);}
 const source=readFileSync('evaluation/hr3/harness/trivia-authority-a6.mjs','utf8');assert.match(source,/createTriviaAuthority\(bytes,GENERATOR_TRIVIA_FREEZE_PIN\)/);assert.match(source,/turns,binding\)/);assert.match(source,/createTriviaCase\(binding\)/);
});
test('A6 private authentication and identity registries are rejected from model-visible inputs',()=>{
 for(const key of ['private_identity_registry','emission_inputs','family_handles','handle_sha256','freeze_sha256','triviaCase','expected_case_sha256'])assert.ok(findPrivateLabels({[key]:'independent-injection'}).length,key);
});
test('A6 runtime embedding inputs reject private identity metadata before dispatch',async()=>{
 let calls=0;const embedder=createEmbedder({async send(){calls++;}},{privacy:new PrivacyGuard()});await assert.rejects(embedder.embed([JSON.stringify({private_identity_registry:{secret:'value'}})]),/private_label_leak:research-embedding/);assert.equal(calls,0);
});
test('A6 real harness scoring path tolerates authenticated final period omission in English and Chinese',()=>{
 for(const language of ['en','zh-Hant']){const c=make(statedFamily(language)),w=goldWitness(c.gold),optional=coverage(c);assert.equal(score(c.gold,w,c.scoringOptions).scores.R,1);
  const citation=w.answer.reason.support.find(q=>{const unit=w.delivered[q.item],s=unit.segments[0],at=s.start+q.quote.length-1;return '.。'.includes(q.quote.at(-1))&&optional(s.origin,at,q.quote.at(-1));});assert.ok(citation,language);citation.quote=citation.quote.slice(0,-1);
  const result=score(c.gold,w,c.scoringOptions);assert.equal(result.supportAuthentication.status,'authenticated');assert.equal(result.scores.R,1,language);assert.equal(result.scores.J,1);
 }
});
test('A6 harness guard rejects cross-family proof replay with one pin and the same trusted question/query',()=>{
 for(const language of ['en','zh-Hant']){const fs=data.families.filter(f=>f.language===language&&bundle(f).gold.checkpoints[0].G_correct.reason.status==='stated'),checkpoint={...fs[0].checkpoints[0],question:'Independent source-only binding regression: recover the complete requested explanation.',query:'independent shared query'};
  const a=make(fs[0],checkpoint),b=make(fs[1],checkpoint),replayed={...a.gold,supportTrivia:b.gold.supportTrivia};assert.equal(coverage(a).authentication.status,'authenticated');assert.equal(coverage(b).authentication.status,'authenticated');
  const denied=compileTrivia(replayed.supportTrivia,spans(replayed),a.scoringOptions.triviaCase,replayed.question);assert.equal(denied.authentication.reason,'trivia_target_binding_mismatch');for(const s of replayed.supportSpans)assert.equal(denied(s.origin,s.end-1,s.text.at(-1)),false);
  assert.throws(()=>score(replayed,goldWitness(replayed),a.scoringOptions),/trivia_case_binding_required:trivia_target_binding_mismatch/);assert.equal(coverage(b).authentication.status,'authenticated');
 }
});
test('A6 harness guard distinguishes checkpoints and queries while sharing the same observation binding across arms',()=>{
 const f=statedFamily('en'),cp=f.checkpoints[0],c=make(f),w=goldWitness(c.gold);for(const altered of [{...cp,batch:4},{...cp,query:cp.query+' alternate'},{...cp,query_id:'second-query'}]){
  const options=trustedScoringOptions(f,altered);assert.throws(()=>score(c.gold,w,options),/trivia_case_binding_required:trivia_target_binding_mismatch/);
 }
 for(const arm of ['T','U','O','P'])assert.equal(score(c.gold,w,trustedScoringOptions(f,cp)).supportAuthentication.expected_case_sha256,coverage(c).authentication.expected_case_sha256,arm);
});
test('A6 harness scoring errors on missing forged or cloned bindings instead of silently dropping trivia',()=>{
 const c=make(statedFamily('en')),w=goldWitness(c.gold);for(const options of [{},{triviaCase:{}},{triviaCase:structuredClone(c.scoringOptions.triviaCase)},{triviaPolicy:'fully_protected'}])assert.throws(()=>score(c.gold,w,options),/trivia_case_binding_required/);
 const f=a4Fixture(),a=adaptChallenge(f.row,f.world);assert.throws(()=>score(a.gold,a.submission),/trivia_case_binding_required/);
});
test('A6 harness scoring rejects a changed actual question even when the proof and expected token are genuine',()=>{
 const c=make(statedFamily('en')),gold={...c.gold,question:c.gold.question+' A changed question.'};assert.throws(()=>score(gold,goldWitness(gold),c.scoringOptions),/trivia_case_binding_required:missing_or_mismatched_expected_trivia_case/);
});


for(const language of ['en','zh-Hant'])test('P2-2 '+language+': unrelated no-trivia token cannot downgrade a licensed same-question target',()=>{
 const b=a4Fixture();
 if(language==='zh-Hant'){b.row.world_id=b.world.id='independent-a4-zh';b.row.question=b.world.question='請回答路線、核准與上限、前身 prior-turn，以及完整說明。';}
 const noTrivia=adaptChallenge(b.row,b.world),family=statedFamily(language);
 const checkpoint={...family.checkpoints[0],question:b.world.question};
 const licensed=make(family,checkpoint),witness=goldWitness(licensed.gold),optional=coverage(licensed);
 const citation=witness.answer.reason.support.find(q=>{
  const segment=witness.delivered[q.item].segments[0],position=segment.start+q.quote.length-1;
  return '.。'.includes(q.quote.at(-1))&&optional(segment.origin,position,q.quote.at(-1));
 });assert.ok(citation,language);citation.quote=citation.quote.slice(0,-1);
 assert.equal(score(licensed.gold,witness,licensed.scoringOptions).scores.R,1);
 const stripped={...licensed.gold,supportTrivia:{version:licensed.gold.supportTrivia.version,producer:null,rules:[],positions:[]}};
 assert.equal(stripped.question,noTrivia.gold.question);
 assert.throws(()=>score(stripped,witness,noTrivia.scoringOptions),/trivia_case_binding_required/);
 assert.throws(()=>score(stripped,witness,licensed.scoringOptions),/trivia_case_binding_required/);
});

test('P2-2 no-trivia authority: unknown family case question and source cannot self-declare absence',()=>{
 const base=a4Fixture();
 for(const change of [w=>w.id+='-unknown',w=>w.question+=' Different target.',w=>w.delivered[0].text+=' Changed source.',w=>w.edge_support[0].from='different-origin']){
  const f=structuredClone(base);change(f.world);assert.throws(()=>unlicensedScoringOptions(f.world,adaptChallenge(base.row,base.world).gold),/frozen_unlicensed_target_required/);
 }
 const licensed=make(statedFamily('en')),empty={...licensed.gold,supportTrivia:{version:licensed.gold.supportTrivia.version,producer:null,rules:[],positions:[]}};
 assert.throws(()=>unlicensedScoringOptions(base.world,empty),/unlicensed_gold_target_mismatch/);
});
test('P2-2 no-trivia binding: same-question cases cannot exchange tokens or cloned gold',()=>{
 const one=a4Fixture(),two=a4Fixture();two.row.gold.acceptedGraphs.push({edges:[{from:'B',to:'C'}]});two.world.gold=structuredClone(two.row.gold);
 const a=adaptChallenge(one.row,one.world),b=adaptChallenge(two.row,two.world);assert.equal(a.gold.question,b.gold.question);
 assert.doesNotThrow(()=>score(a.gold,a.submission,a.scoringOptions));assert.doesNotThrow(()=>score(b.gold,b.submission,b.scoringOptions));
 assert.throws(()=>score(a.gold,a.submission,b.scoringOptions),/trivia_case_binding_required/);
 assert.throws(()=>score(b.gold,b.submission,a.scoringOptions),/trivia_case_binding_required/);
 assert.throws(()=>score(structuredClone(a.gold),a.submission,a.scoringOptions),/trivia_case_binding_required/);
 assert.throws(()=>score(a.gold,a.submission,{unlicensedCase:structuredClone(a.scoringOptions.unlicensedCase)}),/trivia_case_binding_required/);
 a.gold.supportSpans[0].text='Z'+a.gold.supportSpans[0].text.slice(1);assert.throws(()=>score(a.gold,a.submission,a.scoringOptions),/trivia_case_binding_required/);
});


test('Scorer v7 migration: the independently pinned no-trivia authority issues the same token to both guards',()=>{
 const bytes=Buffer.from(canonical(UNLICENSED_AUTHORITY_A6)+'\n');assert.equal(hash(bytes),UNLICENSED_AUTHORITY_A6_SHA256);
 assert.throws(()=>createUnlicensedTriviaAuthority(bytes,'0'.repeat(64)),/pin mismatch/);
 const {row,world}=a4Fixture(),c=adaptChallenge(row,world);
 const authentication=compileUnlicensedTrivia(c.gold,c.scoringOptions.unlicensedCase).authentication;
 assert.equal(authentication.status,'authenticated_unlicensed');assert.equal(authentication.authority_sha256,UNLICENSED_AUTHORITY_A6_SHA256);
 const direct=scorerScore(c.gold,c.submission,c.scoringOptions),guarded=score(c.gold,c.submission,c.scoringOptions);
 assert.deepEqual(guarded,direct);assert.equal(guarded.supportAuthentication.status,'authenticated_unlicensed');
 assert.deepEqual(Object.keys(c.scoringOptions),['unlicensedCase']);assert.deepEqual(c.scoringOptions.unlicensedCase,{});
});
test('Scorer v7 migration: every guarded score requires exactly one authenticated mode',()=>{
 const {row,world}=a4Fixture(),c=adaptChallenge(row,world),licensed=make(statedFamily('en'));
 for(const target of [c,licensed]){
  const submission=target.submission??goldWitness(target.gold);
  assert.throws(()=>score(target.gold,submission),/trivia_case_binding_required:missing_binding/);
  assert.throws(()=>score(target.gold,submission,{...c.scoringOptions,...licensed.scoringOptions}),/trivia_case_binding_required:conflicting_bindings/);
 }
 for(const p of ['evaluation/hr3/harness/runner.mjs','evaluation/hr3/integration/mechanical.mjs']){
  const source=readFileSync(p,'utf8');assert.match(source,/scoring-a6\.mjs/);assert.doesNotMatch(source,/import\s*\{[^}]*\bscore\b[^}]*\}\s*from\s*['"][^'"]*scorer\/scorer\.mjs/);
 }
 assert.match(readFileSync('evaluation/hr3/harness/scoring-a6.mjs','utf8'),/return scorerScore\(gold,submission,options\)/);
});
