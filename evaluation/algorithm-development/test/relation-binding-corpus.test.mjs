import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = JSON.parse(await readFile(new URL('../relation-binding-cases.json', import.meta.url), 'utf8'));
const rubric = JSON.parse(await readFile(new URL('../relation-binding-rubric.json', import.meta.url), 'utf8'));
const reviewNote = await readFile(new URL('../../../docs/plans/relation-binding-fixtures.md', import.meta.url), 'utf8');
const roster = Array.from({ length: 12 }, (_, index) => `R${String(index + 1).padStart(2, '0')}`);
const knownIds = ['R01', 'R04', 'R05', 'R08', 'R09', 'R12'];
const conciseNames = { R01: ['Keel Calibration Ltd.'], R04: ['Saira Haddad'], R05: ['Niko Chen'], R08: ['Asha Lim'], R09: ['Rhea Bell', 'Devon Price'], R12: ['周怡安'] };
const severeBindingIds = ['R01', 'R02', 'R03', 'R04', 'R05', 'R07', 'R08', 'R09', 'R11', 'R12'];
const rubricFields = ['answerability', 'requiredPropositions', 'acceptableQualifications', 'unsupportedClaims', 'staleUseCriteria', 'severeErrors'];

// These evaluator-only anchors preserve the source passages reviewed for the
// rubric. They are an authoring-change alarm, not an automated semantic judge.
const reviewedAnchors = {
  R01: [[0, 'Packing uses the scale whose asset tag is SC-482'], [1, 'SC-482 as a Vela Instruments V12'], [2, 'every Vela V12 scale in this workshop to Keel Calibration Ltd.']],
  R02: [[0, 'does not record a dispatch reference or carrier'], [1, 'Their contents were not included']],
  R03: [[0, 'have not named the person accountable'], [2, 'still have not appointed an accessibility budget approver']],
  R04: [[0, 'That is the trading name of Orchard Lane Foods Ltd.'], [1, 'Saira Haddad as account manager for Orchard Lane Foods Ltd.']],
  R05: [[0, 'Niko Chen has held custody'], [1, 'on August 15 at 09:00 UTC'], [1, 'Until that handover Niko retained custody']],
  R06: [[0, 'Helena Yu, effective September 1'], [1, 'Omar Ellis, effective September 1'], [2, 'equal assignment authority'], [3, 'have not reconciled']],
  R07: [[0, 'independent organizations with separate staff directories'], [2, 'leaves the release-contact field blank']],
  R08: [[0, 'Production AL-17 routes to service Q-RED'], [1, 'production escalation directory, Q-RED is assigned to Asha Lim'], [2, 'retains Asha on Q-RED']],
  R09: [[0, 'Rhea Bell accepted responsibility'], [0, 'Devon Price, will carry out the inspection'], [2, 'did not transfer that responsibility']],
  R10: [[0, 'September 1 through September 10 inclusive'], [1, 'September 20 through September 30 inclusive'], [2, 'missing LK-6 key log for September 11–19']],
  R11: [[0, 'expired term does not carry over automatically'], [2, 'has not voted'], [2, 'remains unassigned']],
  R12: [[0, '兩者是同一供貨方'], [1, '山霧合作社的冷藏車交貨走北門收貨點'], [2, '北門由周怡安協調'], [3, '收貨輪值沒有變更']]
};

function exactKeys(value, keys, label) {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value), `${label}: object required`);
  assert.deepEqual(Object.keys(value).sort(), [...keys].sort(), `${label}: exact schema keys`);
}

function nonemptyUnicode(value, label) {
  assert.equal(typeof value, 'string', `${label}: string required`);
  assert.ok(value.trim().length > 0, `${label}: nonempty text required`);
  assert.ok(value.isWellFormed(), `${label}: well-formed Unicode required`);
}

function dateOnly(value, label) {
  assert.match(value, /^\d{4}-\d{2}-\d{2}$/, `${label}: YYYY-MM-DD required`);
  const date = new Date(`${value}T00:00:00.000Z`);
  assert.ok(Number.isFinite(date.getTime()), `${label}: valid calendar date required`);
  assert.equal(date.toISOString().slice(0, 10), value, `${label}: no normalized invalid date`);
}

function timestamp(value, label) {
  assert.match(value, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/, `${label}: canonical UTC timestamp required`);
  const date = new Date(value);
  assert.ok(Number.isFinite(date.getTime()), `${label}: valid timestamp required`);
  assert.equal(date.toISOString(), value, `${label}: no normalized invalid timestamp`);
}

function validatePacket(casesDocument, rubricDocument, note) {
  exactKeys(casesDocument, ['schemaVersion', 'cases'], 'source document');
  assert.equal(casesDocument.schemaVersion, 'relation-binding-probe-v1');
  assert.ok(Array.isArray(casesDocument.cases));
  assert.deepEqual(casesDocument.cases.map(item => item.id), roster, 'exact ordered R01–R12 roster');
  exactKeys(rubricDocument, ['schemaVersion', 'cases'], 'rubric document');
  assert.equal(rubricDocument.schemaVersion, 'relation-binding-probe-v1-rubric');
  exactKeys(rubricDocument.cases, roster, 'rubric roster');
  let known = 0;
  let uncertain = 0;
  const totals = [];
  for (const item of casesDocument.cases) {
    exactKeys(item, ['id', 'family', 'question', 'sourceUnits'], item.id);
    nonemptyUnicode(item.family, `${item.id} family`);
    assert.match(item.family, /^[a-z]+(?:-[a-z]+)*$/);
    exactKeys(item.question, ['text', 'date'], `${item.id} question`);
    nonemptyUnicode(item.question.text, `${item.id} question text`);
    dateOnly(item.question.date, `${item.id} question date`);
    assert.ok(Array.isArray(item.sourceUnits));
    assert.ok(item.sourceUnits.length >= 2 && item.sourceUnits.length <= 6, `${item.id}: two to six submitted units`);
    let codePoints = 0;
    for (const [index, unit] of item.sourceUnits.entries()) {
      exactKeys(unit, ['recordedRole', 'eventAt', 'text'], `${item.id} unit ${index + 1}`);
      assert.ok(['user', 'assistant'].includes(unit.recordedRole));
      timestamp(unit.eventAt, `${item.id} unit ${index + 1}`);
      nonemptyUnicode(unit.text, `${item.id} unit ${index + 1} text`);
      assert.ok(unit.eventAt.slice(0, 10) <= item.question.date, `${item.id}: sources were recorded by question date`);
      assert.doesNotMatch(unit.text, /(?:expectedAnswers?|requiredPropositions|answerability|acceptableQualifications|unsupportedClaims|staleUseCriteria|severeErrors|supportIds?)\s*[=:]/i, `${item.id}: evaluator metadata must not enter source text`);
      codePoints += Array.from(unit.text).length;
    }
    assert.ok(codePoints <= 4000, `${item.id}: at most 4,000 source Unicode code points`);
    totals.push(codePoints);
    const gold = rubricDocument.cases[item.id];
    exactKeys(gold, rubricFields, `${item.id} rubric`);
    assert.ok(['known', 'uncertain'].includes(gold.answerability));
    assert.equal(gold.answerability, knownIds.includes(item.id) ? 'known' : 'uncertain', `${item.id}: reviewed answerability`);
    if (gold.answerability === 'known') known += 1;
    else uncertain += 1;
    for (const key of rubricFields.slice(1)) {
      assert.ok(Array.isArray(gold[key]), `${item.id} ${key}: array required`);
      if (key === 'requiredPropositions') assert.ok(gold[key].length > 0);
      for (const value of gold[key]) nonemptyUnicode(value, `${item.id} ${key}`);
    }
    if (severeBindingIds.includes(item.id)) {
      assert.ok(gold.severeErrors.length > 0, `${item.id}: prospective severe binding criterion required`);
    }
    assert.ok(note.includes(`| ${item.id} | ${gold.answerability} |`), `${item.id}: manual proposition-support review row required`);
    for (const [index, anchor] of reviewedAnchors[item.id]) {
      assert.ok(item.sourceUnits[index].text.includes(anchor), `${item.id}: manually reviewed support anchor missing`);
    }
  }
  assert.equal(known, 6);
  assert.equal(uncertain, 6);
  assert.equal((note.match(/^\| R\d{2} \|/gm) || []).length, 12, 'one manual review row per case');
  assert.ok(note.includes('Manual required-proposition review: complete for all twelve cases.'));
  assert.ok(note.includes('Fixture validation is not model QA'));
  return { known, uncertain, totals };
}

test('frozen source and evaluator-only rubric satisfy the standalone authoring contract', () => {
  const result = validatePacket(source, rubric, reviewNote);
  console.log(`Validated ${source.cases.length} cases: ${result.known} known, ${result.uncertain} uncertain; source code points ${result.totals.join(', ')}; maximum ${Math.max(...result.totals)}.`);
});

test('alternating first-arm positions each retain three known and three uncertain cases', () => {
  for (const parity of [0, 1]) {
    const ids = source.cases.filter((_, index) => index % 2 === parity).map(item => item.id);
    assert.equal(ids.filter(id => rubric.cases[id].answerability === 'known').length, 3);
    assert.equal(ids.filter(id => rubric.cases[id].answerability === 'uncertain').length, 3);
  }
});

test('the reviewed rubric permits concise names while known abstention omits required answers', () => {
  for (const [id, names] of Object.entries(conciseNames)) {
    const gold = rubric.cases[id];
    assert.equal(gold.answerability, 'known');
    for (const name of names) {
      assert.ok(gold.requiredPropositions.some(value => value.includes(name)), `${id}: the requested name is required`);
    }
    assert.ok(gold.acceptableQualifications.some(value => value.startsWith('A concise answer naming') && value.includes('is sufficient')), `${id}: concise answer explicitly acceptable`);
    assert.ok(gold.requiredPropositions.every(value => !/→|\bvia\b|explaining|before the|through the explicit/.test(value)), `${id}: explanatory chains are optional`);
    assert.ok(reviewNote.includes(`- ${id} accepted concise:`), `${id}: concise manual control recorded`);
  }
  assert.ok(reviewNote.includes('An always-abstain answer fails all six known cases'));
  assert.ok(reviewNote.includes('These are prospective manual verdict controls, not measured model outputs.'));
});

test('prospective severe-error criteria cannot omit equivalent unsupported bindings', () => {
  for (const id of severeBindingIds) {
    assert.ok(rubric.cases[id].severeErrors.length > 0, `${id}: prospective severe binding criterion required`);
  }
  assert.ok(reviewNote.includes('Severe error is a narrow affirmative failure class'));
  for (const id of ['R02', 'R03', 'R07', 'R11']) {
    const mutated = structuredClone(rubric);
    mutated.cases[id].severeErrors = [];
    assert.throws(() => validatePacket(source, mutated, reviewNote), /prospective severe binding criterion required/);
  }
});

test('negative controls reject gold leakage, invalid dates, excess units and Unicode overflow', () => {
  const controls = [
    [item => { item.cases[0].expectedAnswer = 'Keel Calibration Ltd.'; }, /exact schema keys/],
    [item => { item.cases[0].sourceUnits[0].supportIds = ['oracle']; }, /exact schema keys/],
    [item => { item.cases[0].question.date = '2026-02-30'; }, /invalid date/],
    [item => { item.cases[0].sourceUnits[0].eventAt = '2026-08-32T09:00:00.000Z'; }, /valid timestamp/],
    [item => { item.cases[0].sourceUnits = Array(7).fill(item.cases[0].sourceUnits[0]); }, /two to six/],
    [item => { item.cases[0].sourceUnits[0].text += '🧭'.repeat(4001); }, /4,000 source Unicode code points/],
    [item => { item.cases[0].sourceUnits[0].text += '\uD800'; }, /well-formed Unicode/],
    [item => { item.cases[0].sourceUnits[0].text += ' requiredPropositions: oracle'; }, /evaluator metadata/]
  ];
  for (const [mutate, expectedError] of controls) {
    const mutated = structuredClone(source);
    mutate(mutated);
    assert.throws(() => validatePacket(mutated, rubric, reviewNote), expectedError);
  }
});

test('removing an explicit identity bridge invalidates the reviewed packet', () => {
  const mutated = structuredClone(source);
  const alias = mutated.cases.find(item => item.id === 'R04');
  alias.sourceUnits[0].text = alias.sourceUnits[0].text.replace(
    'That is the trading name of Orchard Lane Foods Ltd.',
    'The relationship with Orchard Lane Foods Ltd. has not been established.'
  );
  assert.throws(() => validatePacket(mutated, rubric, reviewNote), /R04: manually reviewed support anchor missing/);
});

test('the required-proposition manual review and six/six balance cannot silently disappear', () => {
  const missingReview = reviewNote.replace('Manual required-proposition review: complete for all twelve cases.', 'Review pending.');
  assert.throws(() => validatePacket(source, rubric, missingReview));
  const mutatedRubric = structuredClone(rubric);
  mutatedRubric.cases.R02.answerability = 'known';
  assert.throws(() => validatePacket(source, mutatedRubric, reviewNote), /reviewed answerability/);
  mutatedRubric.cases.R02.answerability = 'uncertain';
  mutatedRubric.cases.R02.requiredPropositions = [];
  assert.throws(() => validatePacket(source, mutatedRubric, reviewNote));
});
