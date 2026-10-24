import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ROOT, DATASETS, build, stable, SEED } from './generate.mjs';
import { validate, validateAnswer, validateQuotas, validateRow, validateUniqueness, scopeCells } from './validate.mjs';
import { validateShape } from './schema.mjs';
import { correctnessBundle, supportBundle } from './bundles.mjs';

const result = await validate();
const rows = Object.values(result.sets).flat();
const sample = rows.find(r => r.true_label.equivalent && r.candidate.current.claims.length);

test('all 1,984 bundles, 736 worlds, hashes, closed schema, and quotas validate', () => {
  assert.equal(result.bundles, 1984);
  assert.equal(result.independent_worlds, 736);
  assert.equal(result.referral_qualification, 'PENDING');
});
test('every serialized case and world is byte-reproducible from the seed', async () => {
  assert.equal(result.manifest.seed, SEED);
  const rebuilt = build();
  for (const [file, expected] of Object.entries({ ...rebuilt.sets, 'worlds.jsonl': rebuilt.worlds })) {
    assert.equal(await readFile(join(ROOT, file), 'utf8'), expected.map(stable).join('\n') + '\n', file);
  }
});
test('quota checks reject a missing row and an imbalanced component label', () => {
  const fewer = structuredClone(result.sets);
  fewer[DATASETS[0]].pop();
  assert.throws(() => validateQuotas(fewer));
  const imbalance = structuredClone(result.sets);
  const negative = imbalance[DATASETS[0]].find(r => !r.true_label.components.C && r.true_label.components.O);
  negative.true_label.components.C = true;
  assert.throws(() => validateQuotas(imbalance));
});
test('uniqueness rejects duplicate identities and duplicate bundles with fresh identities', () => {
  const sameId = structuredClone(rows[1]); sameId.id = rows[0].id;
  assert.throws(() => validateUniqueness([rows[0], sameId]), /duplicate case id/);
  const sameBundle = structuredClone(rows[0]); sameBundle.id = 'new-id';
  assert.throws(() => validateUniqueness([rows[0], sameBundle]), /duplicate challenge bundle/);
});
test('schema rejects absent fields, unknown fields, invalid tags and malformed scalar types', () => {
  for (const mutate of [
    a => { delete a.current; },
    a => { a.current.hidden = 'label'; },
    a => { a.current.claims[0].value = { type: 'Boolean', value: 'true' }; },
    a => { a.current.claims[0].value = { type: 'Quantity', decimal: 2, unit: 'hour' }; },
    a => { a.current.claims[0].valid.to = '2028-03-31'; },
    a => { a.current.claims[0].citations[0].occurrence = 0; },
    a => { a.reason.status = 'guessed'; },
  ]) {
    const answer = structuredClone(sample.candidate); mutate(answer);
    assert.ok(validateShape(answer).length > 0);
  }
});
test('scope is the fixed 12-cell domain and an empty/foreign scope fails', () => {
  assert.equal(scopeCells({ any: [{ all: [] }] }).length, 12);
  const answer = structuredClone(sample.candidate);
  answer.current.claims[0].scope = { any: [{ all: [{ field: 'country', values: ['CN'] }] }] };
  assert.throws(() => validateAnswer(answer, 'bad country'));
  answer.current.claims[0].scope = { any: [{ all: [{ field: 'country', values: ['TW'] }, { field: 'country', values: ['US'] }] }] };
  assert.throws(() => validateAnswer(answer, 'empty conjunction'));
});
test('case shape and gold boundary reject hidden metadata and gold quotations', () => {
  const extra = structuredClone(sample); extra.arm = 'hidden';
  assert.throws(() => validateRow(extra));
  const leak = structuredClone(sample);
  leak.gold.answer.current.claims[0].citations = structuredClone(leak.candidate.current.claims[0].citations);
  assert.throws(() => validateRow(leak));
});
test('pass allowlists isolate labels, gold, evidence and representation metadata', () => {
  for (const row of rows) {
    const correctness = correctnessBundle(row), support = supportBundle(row);
    assert.deepEqual(Object.keys(correctness).sort(), ['G_correct', 'answer', 'question']);
    assert.deepEqual(Object.keys(support).sort(), ['answer', 'delivered', 'question']);
    assert.equal(stable(correctness.G_correct), stable(row.gold));
    assert.ok(!Object.hasOwn(correctness, 'delivered'));
    assert.ok(!Object.hasOwn(support, 'G_correct'));
    assert.ok(!Object.hasOwn(support, 'true_label'));
    for (const bundle of [correctness, support]) assert.doesNotMatch(stable(bundle), /hr3-calibration-independent|representation_pairs|shared_matched_positive|locally_supported_false_body|faithful|distorted/);
  }
  const bundle = correctnessBundle(sample);
  bundle.answer.current.claims.length = 0;
  assert.ok(sample.candidate.current.claims.length, 'bundle copy must not mutate artifact');
});
test('component negatives mutate only designated components and carry reviewable snapshots', () => {
  for (const row of rows) for (const mutation of row.provenance.mutations) {
    assert.equal(stable(mutation.after), stable(row.candidate[mutation.path]));
    assert.notEqual(stable(mutation.before), stable(mutation.after));
    assert.equal(row.true_label.components[mutation.component], false);
    assert.ok(mutation.rationale.includes('§'));
  }
  for (const row of result.sets[DATASETS[1]].filter(r => !r.true_label.equivalent)) {
    assert.equal(row.provenance.mutations.length, 1);
    assert.equal(Object.values(row.true_label.components).filter(v => !v).length, 1);
    const positive = result.sets[DATASETS[1]].find(r => r.world_id === row.world_id && r.true_label.equivalent);
    const mutatedSection = row.provenance.mutations[0].path;
    for (const section of ['current', 'old', 'reason'].filter(s => s !== mutatedSection)) {
      assert.equal(stable(row.candidate[section]), stable(positive.candidate[section]), `${row.id}: unintended ${section} mutation`);
    }
  }
});

// These are transformation-specific authoring checks, not a production scorer.
const rational = decimal => {
  const [integer, fraction = ''] = decimal.split('.');
  return [BigInt(integer + fraction), 10n ** BigInt(fraction.length)];
};
function equalUnits(a, unitA, b, unitB) {
  const scale = { second: 1n, minute: 60n, hour: 3600n };
  const [an, ad] = rational(a), [bn, bd] = rational(b);
  assert.equal(an * scale[unitA] * bd, bn * scale[unitB] * ad);
}
const normalizedSubject = claim => claim.subject.normalize('NFKC').trim();
function matchingGold(candidate, goldClaims) {
  return goldClaims.find(g => normalizedSubject(g) === normalizedSubject(candidate) && g.predicate === candidate.predicate
    && stable(scopeCells(g.scope)) === stable(scopeCells(candidate.scope)));
}
test('positive numerical/unit and instant transformations are exact, including prior quantities', () => {
  const seen = new Set();
  for (const row of rows.filter(r => r.true_label.equivalent)) {
    const sections = [
      [row.candidate.current.claims, row.gold.answer.current.claims],
      [row.candidate.old.records.flatMap(r => r.claims), row.gold.answer.old.records.flatMap(r => r.claims)],
    ];
    for (const [candidateClaims, goldClaims] of sections) for (const candidate of candidateClaims) {
      const epoch = iso => iso === null ? null : Date.parse(iso);
      const gold = goldClaims.find(g => g.predicate === candidate.predicate && normalizedSubject(g) === normalizedSubject(candidate)
        && stable(scopeCells(g.scope)) === stable(scopeCells(candidate.scope))
        && epoch(g.valid.from) === epoch(candidate.valid.from) && epoch(g.valid.to) === epoch(candidate.valid.to));
      assert.ok(gold);
      if (candidate.value.type === 'Boolean') { assert.equal(candidate.value.value, gold.value.value); seen.add('Boolean'); }
      if (candidate.value.type === 'Quantity') { equalUnits(candidate.value.decimal, candidate.value.unit, gold.value.decimal, gold.value.unit); seen.add('Quantity'); }
      if (candidate.value.type === 'Range') {
        equalUnits(candidate.value.lower, candidate.value.unit, gold.value.lower, gold.value.unit);
        equalUnits(candidate.value.upper, candidate.value.unit, gold.value.upper, gold.value.unit);
        assert.equal(candidate.value.lowerClosed, gold.value.lowerClosed);
        assert.equal(candidate.value.upperClosed, gold.value.upperClosed);
        seen.add('Range');
      }
      if (candidate.value.type === 'Instant') { assert.equal(Date.parse(candidate.value.iso), Date.parse(gold.value.iso)); seen.add('Instant'); }
    }
  }
  assert.deepEqual([...seen].sort(), ['Boolean', 'Instant', 'Quantity', 'Range']);
});
test('positive scope DNF, NFKC and dates retain audience cells and exclusive boundaries', () => {
  let distributed = 0, offsets = 0, unicode = 0;
  for (const row of rows.filter(r => r.true_label.equivalent)) for (const candidate of row.candidate.current.claims) {
    const gold = matchingGold(candidate, row.gold.answer.current.claims);
    assert.ok(gold, row.id);
    for (const endpoint of ['from', 'to']) assert.equal(candidate.valid[endpoint] === null ? null : Date.parse(candidate.valid[endpoint]), gold.valid[endpoint] === null ? null : Date.parse(gold.valid[endpoint]));
    if (candidate.scope.any.length > gold.scope.any.length) distributed++;
    if (candidate.valid.to?.endsWith('+08:00')) offsets++;
    if (candidate.subject !== normalizedSubject(candidate)) unicode++;
  }
  assert.ok(distributed > 0 && offsets > 0 && unicode > 0);
  assert.equal(new Date('2028-03-31T16:00:00Z').toISOString(), '2028-03-31T16:00:00.000Z', 'through March 31 ends at April 1 local midnight');
});
test('history fixtures distinguish erroneous, expired, complete predecessors and initial none', () => {
  for (const world of result.worlds) {
    if (world.scenario.includes('correction')) assert.equal(world.gold.answer.old.records[0].status, 'erroneous');
    if (world.scenario === 'expiry') {
      assert.equal(world.gold.answer.current.status, 'no_active_decision');
      assert.deepEqual(world.gold.answer.current.claims, []);
      assert.equal(world.gold.answer.old.records[0].status, 'expired');
    }
    if (world.scenario === 'multiple_predecessors') assert.equal(world.gold.answer.old.records.length, 2);
    if (world.scenario === 'initial') assert.equal(world.gold.answer.old.status, 'none');
  }
});
test('negated evidence keeps quoted text findable while explicitly denying it', () => {
  for (const row of result.sets[DATASETS[2]].filter(r => r.evidence_variant === 'negated')) {
    for (const citation of row.candidate.reason.edges.flatMap(e => e.citations)) {
      const unit = row.delivered.find(u => u.item === citation.item);
      assert.ok(unit.text.includes(citation.quote));
      assert.match(unit.text, /否定|denies/);
    }
    assert.equal(row.true_label.causal_supported, false);
  }
});
test('uncited-support traps leave legitimate support delivered but cite a rejected proposal', () => {
  const traps = rows.filter(r => r.provenance.mutations.some(m => m.kind === 'uncited_support'));
  assert.ok(traps.length > 0);
  for (const row of traps) {
    const world = result.worlds.find(w => w.id === row.world_id);
    assert.ok(world.edge_support.length > 0);
    assert.equal(row.true_label.causal_correct, true);
    assert.equal(row.true_label.causal_supported, false);
    assert.ok(row.candidate.reason.edges.some(e => e.citations.some(c => /rejected|否決/.test(c.quote))));
  }
});
test('locally supported false extractions stay false in all four distortion classes', () => {
  const distorted = result.sets[DATASETS[3]].filter(r => r.representation.variant === 'distorted');
  assert.equal(distorted.length, 192);
  assert.equal(new Set(distorted.map(r => r.representation.distortion_class)).size, 4);
  for (const row of distorted) {
    assert.equal(row.true_label.equivalent, false);
    const wrongReason = row.representation.distortion_class === 'wrong_reasons';
    const submitted = wrongReason ? row.candidate.reason.edges.flatMap(e => e.citations) : row.candidate.current.claims.flatMap(c => c.citations);
    assert.ok(submitted.some(c => row.delivered.some(u => u.item === c.item && u.text.includes(c.quote))));
    if (wrongReason) assert.equal(row.true_label.causal_supported, true);
  }
});
test('no candidate is falsely claimed to be a mechanically certified genuine referral', () => {
  assert.equal(result.manifest.qualification.certified_genuine_referrals, null);
  for (const row of result.sets[DATASETS[1]]) assert.equal(row.referral.qualification, 'pending_frozen_mechanical_pipeline');
});
