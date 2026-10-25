import './pipeline-a6.test.mjs';
import './pipeline-a4.test.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from '../../challenge/generate.mjs';
import { generateSplit } from '../../generator/deliver.mjs';
import { adaptGenerator, adaptChallenge, goldWitness, restore, hash, stable } from '../adapters.mjs';
import { score } from '../../harness/scoring-a6.mjs';
import { validate, goldSchema, submissionSchema } from '../../scorer/schema.mjs';
import { qualification, confusion } from '../mechanical.mjs';
import { calibrationGate } from '../gate.mjs';
import { fieldMapping } from '../field-map.mjs';
import { a4Fixture } from './fixtures-a4.mjs';
// Historical labels exercise gate arithmetic only; old candidates never enter
// an A-4 adapter or count as calibration-v2 qualification evidence.
const challenge=build(),rows=Object.values(challenge.sets).flat();
const pilot=generateSplit('pilot').bundles,clone=structuredClone;

test('all 120 pilot slot checkpoints validate, restore exactly and earn witnessed full credit',()=>{
 for(const {family,gold,support} of pilot)for(const cp of family.checkpoints){
  const a=adaptGenerator(family,gold,support,cp.batch);assert.deepEqual(validate(goldSchema,a.gold),[]);
  assert.deepEqual(restore(a),{family,goldRow:gold,supportRow:support,batch:cp.batch});
  const submission=goldWitness(a.gold);assert.deepEqual(validate(submissionSchema,submission),[]);
  assert.deepEqual(score(a.gold,submission,a.scoringOptions).scores,{C:1,O:1,R:1,J:1});
  assert.ok(!Object.hasOwn(submission.answer.reason,'nodes'));assert.ok(!Object.hasOwn(submission.answer.current,'claims'));
 }
});
test('independent A-4 challenge slots, predecessor identities and selected quotations pass unchanged',()=>{
 const {row,world}=a4Fixture(),a=adaptChallenge(row,world);assert.deepEqual(a.submission.answer,row.candidate);
 assert.deepEqual(restore(a),{row,world});assert.equal(a.submission.delivered[2].intent,'history');
 const r=score(a.gold,a.submission,a.scoringOptions);assert.deepEqual(r.scores,{C:1,O:1,R:null,J:null});assert.equal(r.reason.correctness,1);assert.ok(r.referrals.some(f=>f.pass==='support'));
 assert.equal(fieldMapping('challenge','$/row/candidate/reason/support/*/quote').destination,'submission.answer/reason/support/*/quote');
});
test('complete quotation unions preserve serial, conjunctive and alternative private plans',()=>{
 for(const style of ['serial','conjunctive','alternative']){
  const {row,world}=a4Fixture();row.delivered.pop();
  if(style==='conjunctive'){row.gold.acceptedGraphs[0].edges[1]={from:'B',to:'C'};row.gold.acceptedGraphs[0].edges[0]={from:'A',to:'C'};world.edge_support[0].to='C';}
  if(style==='alternative')row.gold.acceptedGraphs.push({edges:[{from:'B',to:'C'}]});
  world.gold=clone(row.gold);const a=adaptChallenge(row,world);assert.equal(score(a.gold,a.submission,a.scoringOptions).scores.R,1);
  if(style!=='alternative'){a.submission.answer.reason.support.pop();assert.notEqual(score(a.gold,a.submission,a.scoringOptions).scores.R,1);}
 }
});
test('source corruption, offset drift, topology mismatches and nonempty gold citations are rejected',()=>{
 const b=clone(pilot.find(b=>b.support.checkpoints[0].acceptedGraphs.length)),batch=b.family.checkpoints[0].batch;
 const a=()=>adaptGenerator(b.family,b.gold,b.support,batch),edge=b.support.checkpoints[0].acceptedGraphs[0].edges[0],span=edge.support[0][0];
 span.offset_unit='utf8';assert.throws(a,/offset unit/);span.offset_unit='utf16';span.quote+='corrupt';assert.throws(a,/span mismatch/);span.quote=span.quote.slice(0,-7);
 edge.to='bogus';assert.throws(a,/graph mismatch/);
 const {row,world}=a4Fixture();row.gold.answer.current.rows[0].citations.push(row.candidate.reason.support[0]);world.gold=clone(row.gold);assert.throws(()=>adaptChallenge(row,world),/Gold citations/);
});
test('superseded graph answers are rejected with no conversion fallback',()=>{
 const row=Object.values(challenge.sets)[0][0],world=challenge.worlds.find(w=>w.id===row.world_id);assert.throws(()=>adaptChallenge(row,world),/A-4 slot answer/);
 const f=a4Fixture();delete f.row.gold.private_causal;f.world.gold=clone(f.row.gold);assert.throws(()=>adaptChallenge(f.row,f.world),/Private causal/);
});
test('audit extension fields survive; checksum tampering is detected',()=>{
 const {row,world}=a4Fixture();row.newUnknownMetadata={exact:['字','1.000']};const a=adaptChallenge(row,world);
 assert.deepEqual(restore(a).row.newUnknownMetadata,row.newUnknownMetadata);assert.equal(fieldMapping('challenge','$/row/newUnknownMetadata/exact/*').disposition,'defect:no-scorer-metadata-slot');
 a.audit.source.row.newUnknownMetadata.exact[1]='changed';assert.throws(()=>restore(a),/hash mismatch/);
});
test('removed, changed and endpoint-only delivery cannot establish a complete explanation',()=>{
 for(const variant of ['adequate','removed','modified','endpoint']){
  const {row,world}=a4Fixture();row.delivered.pop();
  if(variant==='removed')row.delivered=[];
  if(variant==='modified'){row.delivered[0].text='A does not cause B.';row.candidate.reason.support[0].quote=row.delivered[0].text;}
  if(variant==='endpoint')row.candidate.reason.support.pop();
  const a=adaptChallenge(row,world),r=score(a.gold,a.submission,a.scoringOptions);assert.deepEqual(a.submission.answer,row.candidate);
  if(variant==='adequate')assert.equal(r.scores.R,1);else assert.notEqual(r.scores.R,1);
 }
});
test('unknown unit referrals keep correctness gold and support delivery isolated',()=>{
 const {row,world}=a4Fixture();row.candidate.current.rows[0].cap.value.unit='unregistered-unit';const a=adaptChallenge(row,world),r=score(a.gold,a.submission,a.scoringOptions);assert.ok(r.referrals.length);
 for(const f of r.referrals){assert.equal(f.question,row.question);assert.ok(!Object.hasOwn(f,'true_label'));if(f.pass==='correctness'){assert.ok(f.G_correct);assert.ok(!Object.hasOwn(f,'delivered'));assert.ok(!stable(f.G_correct).includes('supportSpans'));}else {assert.ok(f.delivered);assert.ok(!Object.hasOwn(f,'G_correct'));}}
});
test('qualification counts only actual designated referrals, preserving frozen order', () => {
  const make = (id, yes) => ({ id, set: 'referral_candidates', language: 'en', style: 'terse', designated: ['C'], truth: { components: { C: false } }, scores: { C: yes ? null : 0 }, referrals: yes ? [{ components: ['C'] }] : [{ components: ['R'] }] });
  const q = qualification([make('a', false), make('b', true), make('c', true)]);
  assert.deepEqual(q.strata['C/en/terse/negative'].selected, ['b', 'c']); assert.equal(q.allQuotasMet, false);
});
test('confusion keeps pending distinct from reject and splits truth', () => {
  const make = n => ({ set: 'pooled', language: 'en', style: 'terse', truth: { equivalent: true, components: { C: true, O: true, R: true } }, scores: { C: n, O: 1, R: 1, J: n } });
  const c = confusion([make(0), make(null), make(1)]);
  assert.deepEqual(c['pooled/C/en/terse/positive'], { mechanical_accept: 1, mechanical_reject: 1, referred: 1 });
});
function gateFixture() {
  const row = { id: 'one', world: 'world', set: 'pooled', valid: true, language: 'en', style: 'terse', designated: [], truth: { equivalent: true, components: { C: true, O: true, R: true }, causal_correct: true, causal_supported: true }, scores: { C: null, O: 1, R: 1, J: null }, causal: { correctness: 1, support: 1 }, referrals: [{ key: 'key', pass: 'correctness', components: ['C'] }] };
  const index = { version: 'hr3-integration-v1', bundles: [{ key: 'key', pass: 'correctness', payloadHash: 'hash' }], observations: [row] };
  const judgment = (judge, C = true) => ({ key: 'key', payloadHash: 'hash', pass: 'correctness', judge, verdict: { C, O: true, R: true }, findings: [], citations: [], rationale: 'Synthetic test finding.', execution: { requestedModel: 'gpt-6.1-sol', observedModel: 'gpt-6.1-sol', effort: 'xhigh', command: 'codex exec -m gpt-6.1-sol -c model_reasoning_effort="xhigh" --ignore-user-config --disable hooks', session: `session-${judge}`, nonAuthor: true, isolated: true, noPriorJudgments: true } });
  return { index, judgment };
}
test('gate remains incomplete with absent judgments and never uses truth as a verdict', () => {
  const { index } = gateFixture(), g = calibrationGate(index, []);
  assert.equal(g.gates.completion, 'pending'); assert.equal(g.pooled.pending, 1); assert.equal(g.status, 'fail');
  assert.equal(g.gates.inputCompleteness, 'fail'); assert.equal(g.gates.genuineReferralQuotas, 'fail');
});
test('two isolated matching judgments resolve; missing quotas still block pass', () => {
  const { index, judgment } = gateFixture(), g = calibrationGate(index, [judgment(1), judgment(2)]);
  assert.equal(g.gates.completion, 'pass'); assert.equal(g.pooled.pending, 0); assert.equal(g.status, 'fail');
  assert.equal(g.agreements.pooled.componentVectors.exactAgreement, 1);
});
test('disagreement and nulls require a third independent session; agreement computed before resolution', () => {
  const { index, judgment } = gateFixture();
  const a = calibrationGate(index, [judgment(1), judgment(2, false)]); assert.equal(a.gates.completion, 'pending');
  const b = calibrationGate(index, [judgment(1), judgment(2, false), judgment(3)]);
  assert.equal(b.gates.completion, 'pass'); assert.equal(b.agreements.pooled.componentVectors.exactAgreement, 0); assert.deepEqual(b.thirdReviews, ['key']);
  assert.equal(calibrationGate(index, [judgment(1, null), judgment(2, null)]).gates.completion, 'pending');
});
test('gate rejects stale payloads, reused sessions, duplicates and malformed findings', () => {
  const { index, judgment } = gateFixture(); const a = judgment(1), b = judgment(2);
  b.execution.session = a.execution.session; assert.throws(() => calibrationGate(index, [a, b]), /provenance/);
  a.payloadHash = 'stale'; assert.throws(() => calibrationGate(index, [a]), /stale/);
  const c = judgment(1); c.rationale = ''; assert.throws(() => calibrationGate(index, [c]), /rationale/);
  const d = judgment(1); d.verdict.R = 1; assert.throws(() => calibrationGate(index, [d]), /vector/);
});
test('mechanically forced zero does not excuse unresolved support pass', () => {
  const { index } = gateFixture(); const r = index.observations[0];
  r.scores.C = 0; r.scores.R = null; r.scores.J = 0; r.causal.support = null;
  r.referrals = [{ key: 'key', pass: 'support', components: ['R'] }]; index.bundles[0].pass = 'support';
  const g = calibrationGate(index, []); assert.equal(g.pooled.pending, 0); assert.equal(g.gates.completion, 'pending');
});
function fullGateFixture() {
  const index = { version: 'hr3-integration-v1', bundles: [], observations: [] }, judgments = [];
  for (const row of rows) {
    const ref = row.set === 'referral_candidates' || (row.set === 'pooled' && row.true_label.equivalent && !index.observations.some(r => r.set === 'pooled' && r.referrals.length));
    const observation = { id: row.id, world: row.world_id, set: row.set, valid: true, language: row.language, style: row.style,
      designated: row.referral?.designated_components ?? [], truth: row.true_label, evidenceVariant: row.evidence_variant, representation: row.representation,
      scores: { ...Object.fromEntries(['C', 'O', 'R'].map(c => [c, ref ? null : Number(row.true_label.components[c])])), J: ref ? null : Number(row.true_label.equivalent) },
      causal: { correctness: ref ? null : Number(row.true_label.causal_correct), support: Number(row.true_label.causal_supported) }, referrals: [] };
    if (ref) {
      const key = hash(row.id); observation.referrals = [{ key, pass: 'correctness', components: ['C', 'O', 'R'] }];
      index.bundles.push({ key, pass: 'correctness', payloadHash: 'fixture-only' });
      for (const judge of [1, 2]) {
        const { judgment } = gateFixture(), j = judgment(judge);
        j.key = key; j.payloadHash = 'fixture-only'; j.execution.session = `${key}/${judge}`;
        j.verdict = { C: row.true_label.components.C, O: row.true_label.components.O, R: row.true_label.causal_correct }; judgments.push(j);
      }
    }
    index.observations.push(observation);
  }
  return { index, judgments };
}
test('complete synthetic gate fixture passes all thresholds without treating reused worlds as independent', () => {
  const { index, judgments } = fullGateFixture(), g = calibrationGate(index, judgments);
  assert.equal(g.status, 'pass', stable(g.gates));
  assert.equal(g.independentWorlds.representation_pairs.worlds, 48);
  assert.equal(g.qualification.strataMet, 72);
  assert.equal(g.genuineStrata['C/en/all'].positive, 80); assert.equal(g.genuineStrata['C/en/all'].negative, 80);
});
test('gate thresholds detect false acceptance, support failures and style error concentration', () => {
  const { index, judgments } = fullGateFixture();
  const pooledNeg = index.observations.find(r => r.set === 'pooled' && !r.truth.equivalent);
  pooledNeg.scores = { C: 1, O: 1, R: 1, J: 1 }; pooledNeg.causal = { correctness: 1, support: 1 };
  const badEvidence = index.observations.find(r => r.set === 'evidence_contrasts' && !r.truth.equivalent);
  badEvidence.causal = { correctness: 1, support: 1 };
  for (const r of index.observations.filter(r => r.set === 'representation_pairs' && r.style === 'terse')) {
    r.scores = { C: Number(!r.truth.equivalent), O: 1, R: 1, J: Number(!r.truth.equivalent) }; r.causal = { correctness: 1, support: 1 };
  }
  const g = calibrationGate(index, judgments);
  assert.equal(g.gates.pooledMechanics, 'fail'); assert.equal(g.gates.evidenceFinalR, 'fail'); assert.equal(g.gates.evidenceSupportPanel, 'fail'); assert.equal(g.gates.matchedStyles, 'fail');
});



test('deadline and effective expiry witnesses use selected quotations; incomplete selections fail',()=>{
 let n=0;
 for(const b of pilot.filter(b=>b.family.change_type==='expiry'))for(const cp of b.family.checkpoints){
  const {gold,scoringOptions}=adaptGenerator(b.family,b.gold,b.support,cp.batch),w=goldWitness(gold);assert.equal(score(gold,w,scoringOptions).scores.R,1);
  if(gold.reason.status==='stated'){w.answer.reason.support=[];assert.notEqual(score(gold,w,scoringOptions).scores.R,1);}else assert.equal(gold.reason.acceptedGraphs.length,0);n++;
 }
 assert.equal(n,24);
});
