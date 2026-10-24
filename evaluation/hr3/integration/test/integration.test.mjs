import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from '../../challenge/generate.mjs';
import { generateSplit } from '../../generator/deliver.mjs';
import { adaptGenerator, adaptChallenge, goldWitness, restore, hash, stable } from '../adapters.mjs';
import { score } from '../../scorer/scorer.mjs';
import { validate, goldSchema, submissionSchema } from '../../scorer/schema.mjs';
import { qualification, confusion } from '../mechanical.mjs';
import { calibrationGate } from '../gate.mjs';
import { fieldMapping } from '../field-map.mjs';
const challenge = build(), worlds = new Map(challenge.worlds.map(w => [w.id, w]));
const rows = Object.values(challenge.sets).flat();
const adapt = row => adaptChallenge(row, worlds.get(row.world_id));
const pilot = generateSplit('pilot').bundles;
const clone = structuredClone;

test('every pilot checkpoint validates and its witnessed gold earns all four ones', () => {
  let n = 0;
  for (const { family, gold, support } of pilot) for (const cp of family.checkpoints) {
    const a = adaptGenerator(family, gold, support, cp.batch);
    assert.deepEqual(validate(goldSchema, a.gold), []);
    assert.deepEqual(restore(a), { family, goldRow: gold, supportRow: support, batch: cp.batch });
    const submission = goldWitness(a.gold);
    assert.deepEqual(validate(submissionSchema, submission), []);
    assert.deepEqual(score(a.gold, submission).scores, { C: 1, O: 1, R: 1, J: 1 }); n++;
  }
  assert.equal(n, 120);
});
test('all challenge source shapes, five Value variants, graph and intent maps are preserved', () => {
  const variants = new Set(); let n = 0;
  for (const row of rows) {
    const a = adapt(row);
    assert.deepEqual(a.submission.answer, row.candidate);
    assert.deepEqual(restore(a), { row, world: worlds.get(row.world_id) });
    assert.deepEqual(validate(goldSchema, a.gold), []);
    for (const c of a.gold.current.claims) variants.add(c.value.type);
    for (const record of row.candidate.old.records) for (const c of record.claims) for (const citation of c.citations) {
      if (!row.delivered.some(u => u.item === citation.item)) continue;
      const d = a.submission.delivered.find(u => u.item === citation.item && u.unit === citation.unit);
      if (d) assert.equal(d.intent, citation.intent);
    }
    n++;
  }
  assert.equal(n, 1984); assert.equal(variants.size, 5);
});
test('OR graphs and AND support retain source identity and conjunctions', () => {
  const b = pilot.find(b => b.family.causal_class === 'alternative_mediated') ?? pilot.find(b => b.support.checkpoints[0].acceptedGraphs.length === 2);
  const a = adaptGenerator(b.family, b.gold, b.support, b.family.checkpoints[0].batch);
  assert.equal(a.gold.reason.acceptedGraphs.length, 2);
  const e = a.gold.reason.acceptedGraphs[0].edges[0];
  assert.equal(e.support.length, 1); assert.equal(e.support[0].length, 1);
  const s = a.gold.supportSpans.find(s => s.id === e.support[0][0]); assert.equal(s.text.length, s.end - s.start);
});
test('gold citations, incompatible topology, source corruption and non-UTF16 offsets fail explicitly', () => {
  const b = clone(pilot.find(b => b.support.checkpoints[0].acceptedGraphs.length)); const batch = b.family.checkpoints[0].batch;
  const a = () => adaptGenerator(b.family, b.gold, b.support, batch);
  const edge = b.support.checkpoints[0].acceptedGraphs[0].edges[0], span = edge.support[0][0];
  span.offset_unit = 'utf8'; assert.throws(a, /offset unit/); span.offset_unit = 'utf16';
  span.quote += 'corrupt'; assert.throws(a, /span mismatch/); span.quote = span.quote.slice(0, -7);
  edge.to = 'bogus'; assert.throws(a, /graph mismatch/);
  const row = clone(rows.find(r => r.gold.answer.reason.edges.length)); row.gold.answer.current.claims[0].citations.push(row.candidate.current.claims[0].citations[0]);
  const world = clone(worlds.get(row.world_id)); world.gold = clone(row.gold);
  assert.throws(() => adaptChallenge(row, world), /Gold citations/);
});
test('challenge gold redundant edge topology cannot silently disappear', () => {
  const row = clone(rows.find(r => r.gold.answer.reason.edges.length)); const world = clone(worlds.get(row.world_id));
  row.gold.answer.reason.edges[0].to = 'wrong'; world.gold = clone(row.gold);
  assert.throws(() => adaptChallenge(row, world), /not an accepted graph/);
});
test('audit extension fields survive and checksum tampering is detected', () => {
  const row = clone(rows[0]); row.newUnknownMetadata = { exact: ['字', '1.000'] };
  const a = adapt(row); assert.deepEqual(restore(a).row.newUnknownMetadata, row.newUnknownMetadata);
  assert.equal(fieldMapping('challenge', '$/row/newUnknownMetadata/exact/*').disposition, 'defect:no-scorer-metadata-slot');
  a.audit.source.row.newUnknownMetadata.exact[1] = 'changed'; assert.throws(() => restore(a), /hash mismatch/);
});
test('five evidence variants follow submitted citations; negation is referred, never auto-accepted', () => {
  const group = challenge.sets['evidence-contrasts.jsonl'].filter(r => r.world_id === challenge.sets['evidence-contrasts.jsonl'][0].world_id);
  assert.equal(group.length, 5);
  for (const row of group) {
    const a = adapt(row), result = score(a.gold, a.submission);
    if (row.evidence_variant === 'adequate') assert.ok([1, null].includes(result.scores.R));
    else if (row.evidence_variant === 'negated') { assert.equal(result.reason.support, null); assert.ok(result.referrals.some(f => f.pass === 'support')); }
    else assert.equal(result.reason.support, 0);
    assert.deepEqual(a.submission.answer, row.candidate);
  }
});
test('referrals have pass-isolated allowlists and retain original citations', () => {
  const row = challenge.sets['referral-candidates.jsonl'][0], a = adapt(row), result = score(a.gold, a.submission);
  assert.ok(result.referrals.length);
  for (const f of result.referrals) {
    assert.equal(f.question, row.question); assert.ok(f.answer);
    assert.ok(!Object.hasOwn(f, 'true_label')); assert.ok(!Object.hasOwn(f, 'language')); assert.ok(!Object.hasOwn(f, 'world_id'));
    if (f.pass === 'correctness') { assert.ok(f.G_correct); assert.ok(!Object.hasOwn(f, 'delivered')); assert.ok(!stable(f.G_correct).includes('supportSpans')); }
    else { assert.ok(f.delivered); assert.ok(!Object.hasOwn(f, 'G_correct')); for (const d of f.delivered) assert.deepEqual(Object.keys(d).sort(), ['aliases', 'intent', 'item', 'source', 'text', 'unit']); }
  }
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


test('revised E-1: trigger-only answers earn R=1; deadline mentions, uncited edges and not_stated do not',()=>{
  let n=0;
  for (const b of pilot.filter(b=>b.family.change_type==='expiry')) for (const cp of b.family.checkpoints) {
    const {gold}=adaptGenerator(b.family,b.gold,b.support,cp.batch);
    const trigger=clone(gold);trigger.reason.acceptedGraphs=[gold.reason.acceptedGraphs.at(-1)];
    const submission=goldWitness(trigger);
    submission.answer.reason.nodes=submission.answer.reason.nodes.filter(n=>['deadline','decision'].includes(n.id));
    assert.deepEqual(score(gold,submission).scores,{C:1,O:1,R:1,J:1});
    const bare=clone(submission);bare.answer.reason.edges=[];
    assert.equal(score(gold,bare).scores.R,0);
    const uncited=clone(submission);uncited.answer.reason.edges[0].citations=[];
    assert.equal(score(gold,uncited).scores.R,0);
    const unstated=clone(submission);unstated.answer.reason={status:'not_stated',nodes:[],edges:[]};
    assert.equal(score(gold,unstated).scores.R,0);
    // A deadline fragment cannot support the submitted causal edge.
    const fragment=clone(submission);
    fragment.answer.reason.edges[0].citations[0].quote=submission.answer.reason.nodes.find(n=>n.id==='deadline').claim.value.iso;
    assert.equal(score(gold,fragment).scores.R,0);n++;
  }
  assert.equal(n,24);
});
