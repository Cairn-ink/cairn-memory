import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const sourceUrl = new URL('../fixtures/source-proposition-v1.json', import.meta.url);
const rubricUrl = new URL('../fixtures/source-proposition-rubric-v1.json', import.meta.url);
const groups = {
  'pure-observation': 6,
  'mixed-observation-choice': 6,
  adopted: 4,
  considered: 4,
  rejected: 4,
};
const fields = ['subject', 'property', 'scope', 'applies', 'value', 'attribution', 'commitment'];
const attributionValues = ['direct', 'reported', 'quoted', 'proposed', 'unknown'];
const commitmentValues = ['adopted', 'considered', 'rejected', 'unknown'];
const projection = [
  'content', 'kind', 'confidence', 'receipts',
  'qualification.slot.subject', 'qualification.slot.property',
  'qualification.slot.scope', 'qualification.slot.applies', 'qualification.value',
  'qualification.attribution', 'qualification.commitment',
];
// This explicit evaluator-only inventory independently pins source-to-claim mapping.
const expectedClaims = {
  a91f03b7c482: ['q01'], '7dc480a1f6b3': ['q02'], '0b62eaf931d8': ['q03'],
  f4e981c0a237: ['q04'], '36a7d8c109ef': ['q05'], d2096f84b1a5: ['q06'],
  '8f1c420d6ab9': ['q07', 'q08'], c703fa5128de: ['q09', 'q10'],
  '21e5b8a6d047': ['q11', 'q12'], b8d306f1e94a: ['q13', 'q14'],
  '5a0e729c4fd1': ['q15', 'q16'], e19a64c7b203: ['q17', 'q18'],
  '4c8f1d963a70': ['q19', 'q20'], a6d024b9e158: ['q21'], '93b57e0a2fc6': ['q22'],
  dc17a9e435b0: ['q23', 'q24'], '6e4092c81afd': ['q25'], '18bf6a30d5e2': ['q26', 'q27'],
  f0237c9a16bd: ['q28'], '70da815e3bc4': ['q29'], '2ea748d0c615': ['q30'],
  bb6049f2a18e: ['q31', 'q32'], '3f92d6a081ce': ['q33'], e5c17b409a62: ['q34'],
};

function keys(value, expected, label) {
  assert.ok(value !== null && typeof value === 'object' && !Array.isArray(value), `${label}: object`);
  assert.equal(Object.getPrototypeOf(value), Object.prototype, `${label}: plain object`);
  assert.deepEqual(Object.keys(value).sort(), [...expected].sort(), `${label}: exact keys`);
}

function canonicalText(value, label, maximum = 2000) {
  assert.equal(typeof value, 'string', `${label}: string`);
  assert.ok(value.length >= 1 && value.length <= maximum, `${label}: UTF-16 bounds`);
  assert.ok(value.isWellFormed(), `${label}: well-formed UTF-16`);
  assert.equal(value.normalize('NFC'), value, `${label}: NFC`);
  assert.equal(value.trim(), value, `${label}: no outside whitespace`);
  assert.ok(!/[\u0000-\u001f\u007f]/u.test(value), `${label}: no control characters`);
}

function texts(values, label, minimum = 1, maximum = 8) {
  assert.ok(Array.isArray(values), `${label}: array`);
  assert.ok(values.length >= minimum && values.length <= maximum, `${label}: count`);
  values.forEach((value, index) => canonicalText(value, `${label}[${index}]`));
  assert.equal(new Set(values).size, values.length, `${label}: unique`);
}

export function validateMessage(message) {
  keys(message, ['role', 'content'], 'message');
  assert.ok(['user', 'assistant'].includes(message.role), 'message: user/assistant only');
  canonicalText(message.content, 'message content', 800);
}

export function validateSourceFixtures(source) {
  keys(source, ['version', 'cases'], 'source');
  assert.equal(source.version, 'source-proposition-v1', 'source version');
  assert.ok(Array.isArray(source.cases), 'source cases array');
  assert.equal(source.cases.length, 24, 'source denominator');
  const ids = new Set();
  let longCases = 0;
  let multiMessageCases = 0;
  let messageCount = 0;
  for (const sourceCase of source.cases) {
    keys(sourceCase, ['id', 'messages'], 'source case');
    assert.match(sourceCase.id, /^[a-f0-9]{12}$/, 'opaque source ID');
    assert.ok(!ids.has(sourceCase.id), 'unique source ID');
    ids.add(sourceCase.id);
    assert.ok(Array.isArray(sourceCase.messages), 'messages array');
    assert.ok(sourceCase.messages.length >= 1 && sourceCase.messages.length <= 3, '1–3 messages');
    sourceCase.messages.forEach(validateMessage);
    messageCount += sourceCase.messages.length;
    if (sourceCase.messages.some(({ content }) => content.length > 200)) longCases += 1;
    if (sourceCase.messages.length > 1) multiMessageCases += 1;
  }
  assert.ok(longCases >= 4, 'at least four cases with message >200 UTF-16 units');
  assert.ok(multiMessageCases >= 4, 'at least four multi-message cases');
  assert.deepEqual([...ids].sort(), Object.keys(expectedClaims).sort(), 'frozen source inventory');
  return { caseCount: ids.size, messageCount, longCases, multiMessageCases };
}

export function validateRubric(rubric, source) {
  validateSourceFixtures(source);
  keys(rubric, ['version', 'sourceVersion', 'expectedCaseCount', 'expectedClaimCount', 'groupCounts', 'grading', 'cases'], 'rubric');
  assert.equal(rubric.version, 'source-proposition-rubric-v1');
  assert.equal(rubric.sourceVersion, source.version);
  assert.equal(rubric.expectedCaseCount, 24);
  assert.equal(rubric.expectedClaimCount, 34);
  assert.deepEqual(rubric.groupCounts, groups);
  keys(rubric.grading, ['unit', 'denominator', 'tupleMatching', 'sourcePass', 'lossGate', 'failures', 'acceptance', 'severeClaims', 'commonProjection', 'sidecars'], 'grading');
  assert.equal(rubric.grading.unit, 'source');
  assert.equal(rubric.grading.denominator, 24);
  for (const field of ['tupleMatching', 'sourcePass', 'lossGate', 'failures', 'sidecars']) {
    canonicalText(rubric.grading[field], `grading.${field}`);
  }
  assert.deepEqual(rubric.grading.acceptance, {
    minimumNetSourceGains: 3, maximumLostCorrectDecisions: 0, maximumNewSevereClaims: 0,
  });
  assert.deepEqual(rubric.grading.severeClaims, [
    'unsupported material assertion', 'superseded or stale choice asserted as current',
    'unsupported authorization or completed action',
  ]);
  assert.deepEqual(rubric.grading.commonProjection, projection);
  assert.ok(Array.isArray(rubric.cases), 'rubric cases array');
  assert.equal(rubric.cases.length, 24);
  const caseIds = new Set();
  const claimIds = new Set();
  const counts = Object.fromEntries(Object.keys(groups).map((group) => [group, 0]));
  let decisions = 0;
  for (const rubricCase of rubric.cases) {
    keys(rubricCase, ['id', 'group', 'requiredClaims', 'forbiddenInferences'], 'rubric case');
    assert.ok(Object.hasOwn(expectedClaims, rubricCase.id), 'rubric ID exists in source');
    assert.ok(!caseIds.has(rubricCase.id), 'unique rubric ID');
    caseIds.add(rubricCase.id);
    assert.ok(Object.hasOwn(groups, rubricCase.group), 'known group');
    counts[rubricCase.group] += 1;
    texts(rubricCase.forbiddenInferences, 'forbidden inferences');
    assert.ok(Array.isArray(rubricCase.requiredClaims), 'required claims array');
    assert.deepEqual(rubricCase.requiredClaims.map(({ id }) => id), expectedClaims[rubricCase.id], 'frozen required-claim map');
    const commitments = [];
    for (const claim of rubricCase.requiredClaims) {
      keys(claim, ['id', 'meaning', 'materialConditions', 'tupleInterpretations'], 'claim');
      assert.match(claim.id, /^q[0-9]{2}$/);
      assert.ok(!claimIds.has(claim.id), 'globally unique claim ID');
      claimIds.add(claim.id);
      canonicalText(claim.meaning, 'claim meaning');
      texts(claim.materialConditions, 'material conditions');
      assert.ok(Array.isArray(claim.tupleInterpretations), 'tuple interpretations array');
      assert.ok(claim.tupleInterpretations.length >= 1 && claim.tupleInterpretations.length <= 3, 'tuple interpretation count');
      const alternatives = new Set();
      for (const tuple of claim.tupleInterpretations) {
        keys(tuple, fields, 'seven-field tuple');
        for (const field of ['subject', 'property', 'scope', 'applies', 'value']) {
          if (tuple[field] !== null) canonicalText(tuple[field], `tuple.${field}`, ['scope', 'applies'].includes(field) ? 120 : 160);
        }
        assert.ok(attributionValues.includes(tuple.attribution), 'attribution enum');
        assert.ok(commitmentValues.includes(tuple.commitment), 'commitment enum');
        commitments.push(tuple.commitment);
        const key = JSON.stringify(fields.map((field) => tuple[field]));
        assert.ok(!alternatives.has(key), 'unique interpretation');
        alternatives.add(key);
      }
      const decisionStates = claim.tupleInterpretations.map(({ commitment }) => commitment !== 'unknown');
      assert.ok(decisionStates.every((value) => value === decisionStates[0]), 'alternatives agree whether claim is a decision');
      if (decisionStates[0]) decisions += 1;
    }
    if (rubricCase.group === 'pure-observation') assert.ok(commitments.every((value) => value === 'unknown'));
    if (rubricCase.group === 'mixed-observation-choice') {
      assert.ok(commitments.includes('unknown'));
      assert.ok(commitments.some((value) => value !== 'unknown'));
    }
    if (rubricCase.group === 'adopted') assert.ok(commitments.every((value) => value === 'adopted'));
    if (rubricCase.group === 'considered') assert.ok(commitments.includes('considered'));
    if (rubricCase.group === 'rejected') assert.ok(commitments.includes('rejected'));
  }
  assert.deepEqual([...caseIds].sort(), source.cases.map(({ id }) => id).sort(), 'exact source/rubric bijection');
  assert.deepEqual(counts, groups, 'actual group counts');
  assert.equal(claimIds.size, 34, 'required claim count');
  assert.equal(decisions, 21, 'required decisions include loss-gate denominator');
  return { caseCount: caseIds.size, claimCount: claimIds.size, decisionCount: decisions, groupCounts: counts };
}

const sourceBytes = await readFile(sourceUrl);
const rubricBytes = await readFile(rubricUrl);
const source = JSON.parse(sourceBytes.toString('utf8'));
const rubric = JSON.parse(rubricBytes.toString('utf8'));
const copy = (value) => structuredClone(value);

test('exact source and rubric bytes match the pre-output freeze', () => {
  assert.equal(createHash('sha256').update(sourceBytes).digest('hex'),
    '2018e0502c9e4533114855c2e336cc9414a0006f53b5aa2afec1f0ca577970eb');
  assert.equal(createHash('sha256').update(rubricBytes).digest('hex'),
    '39f2e1eef57d59d5a93c000dbceaae9b0a2077bc024c337ddf6cc7a5e9532f26');
});

test('frozen independent cohort has exact source, group and claim inventories', () => {
  const sources = validateSourceFixtures(source);
  const gold = validateRubric(rubric, source);
  assert.equal(sources.caseCount, gold.caseCount);
  assert.equal(sources.messageCount, 31);
});

test('source schema excludes evaluator or model metadata at every level', () => {
  const mutants = [
    (value) => { value.expected = rubric; },
    (value) => { value.model = 'hidden'; },
    (value) => { value.cases[0].group = 'pure-observation'; },
    (value) => { value.cases[0].gold = '27 degrees'; },
    (value) => { value.cases[0].messages[0].expected = 'q01'; },
    (value) => { value.cases[0].messages[0].role = 'system'; },
    (value) => { value.cases[0].id = 'observation-01'; },
  ];
  for (const mutate of mutants) {
    const changed = copy(source);
    mutate(changed);
    assert.throws(() => validateSourceFixtures(changed));
  }
});

test('source mutants cannot shrink denominator, duplicate IDs or exceed message counts', () => {
  const mutants = [
    (value) => { value.cases.pop(); },
    (value) => { value.cases.push(copy(value.cases[0])); },
    (value) => { value.cases[1].id = value.cases[0].id; },
    (value) => { value.cases[0].messages = []; },
    (value) => { value.cases[0].messages = Array.from({ length: 4 }, () => copy(value.cases[0].messages[0])); },
    (value) => { value.cases.forEach((item) => { item.messages = [item.messages[0]]; }); },
    (value) => { value.cases.forEach((item) => { item.messages.forEach((message) => { message.content = 'Short note.'; }); }); },
  ];
  for (const mutate of mutants) {
    const changed = copy(source);
    mutate(changed);
    assert.throws(() => validateSourceFixtures(changed));
  }
});

test('message validation counts UTF-16 units, preserves non-BMP and rejects malformed Unicode', () => {
  validateMessage({ role: 'user', content: 'x' });
  validateMessage({ role: 'assistant', content: '🌙'.repeat(400) });
  assert.equal('🌙'.repeat(400).length, 800);
  for (const content of ['', 'x'.repeat(801), '🌙'.repeat(401), '\ud800', '\udc00', 'Cafe\u0301', ' note', 'note ', 'note\rnext', 'note\u0000next']) {
    assert.throws(() => validateMessage({ role: 'user', content }));
  }
  assert.ok(source.cases.some(({ messages }) => messages.some(({ content }) => /\p{Extended_Pictographic}/u.test(content))));
});

test('rubric rejects missing claims, group drift, oracle fields and incorrect seven-field tuples', () => {
  const mutants = [
    (value) => { value.cases.pop(); },
    (value) => { value.cases[1].id = value.cases[0].id; },
    (value) => { value.cases[0].group = 'adopted'; },
    (value) => { value.cases[0].requiredClaims = []; },
    (value) => { value.cases[0].requiredClaims[0].id = 'q02'; },
    (value) => { value.cases[0].requiredClaims[0].materialConditions = []; },
    (value) => { value.cases[0].requiredClaims[0].tupleInterpretations = []; },
    (value) => { value.cases[0].requiredClaims[0].tupleInterpretations[0].commitment = 'adopted'; },
    (value) => { value.cases[0].requiredClaims[0].tupleInterpretations[0].attribution = 'user'; },
    (value) => { value.cases[0].requiredClaims[0].tupleInterpretations[0].claimant = 'user'; },
    (value) => { delete value.cases[0].requiredClaims[0].tupleInterpretations[0].value; },
    (value) => { value.cases[0].requiredClaims[0].tupleInterpretations[0].scope = 'x'.repeat(121); },
    (value) => { value.cases[0].requiredClaims[0].tupleInterpretations[0].subject = 'x'.repeat(161); },
    (value) => { value.cases[0].requiredClaims[0].tupleInterpretations.push(copy(value.cases[0].requiredClaims[0].tupleInterpretations[0])); },
    (value) => { value.cases[0].forbiddenInferences = []; },
    (value) => { value.grading.denominator = 23; },
    (value) => { value.grading.acceptance.maximumLostCorrectDecisions = 1; },
    (value) => { value.grading.commonProjection.push('claimant'); },
  ];
  for (const mutate of mutants) {
    const changed = copy(rubric);
    mutate(changed);
    assert.throws(() => validateRubric(changed, source));
  }
});

test('tuple polarity alternatives preserve explicit negation and reported chooser attribution', () => {
  validateRubric(rubric, source);
  const claims = rubric.cases.flatMap(({ requiredClaims }) => requiredClaims);
  for (const id of ['q16', 'q30', 'q31', 'q33', 'q34']) {
    const alternatives = claims.find((claim) => claim.id === id).tupleInterpretations;
    assert.ok(alternatives.some(({ commitment }) => commitment === 'rejected'));
    assert.ok(alternatives.some(({ value, commitment }) => commitment === 'adopted' && /not |omit /u.test(value)));
  }
  for (const id of ['q18', 'q22', 'q28', 'q33']) {
    assert.ok(claims.find((claim) => claim.id === id).tupleInterpretations.every(({ subject, attribution }) => subject !== 'user' && ['reported', 'quoted'].includes(attribution)));
  }
});
