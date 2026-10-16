import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const fixtureUrl = new URL('../fixtures/claim-local-extracted-v1.json', import.meta.url);
const rubricUrl = new URL('../fixtures/claim-local-extracted-rubric-v1.json', import.meta.url);
const sourceBytes = readFileSync(fixtureUrl);
const rubricBytes = readFileSync(rubricUrl);
const source = JSON.parse(sourceBytes);
const rubric = JSON.parse(rubricBytes);
const groups = { 'pure-observation': 6, 'mixed-observation-adoption': 6, adopted: 4, considered: 4, rejected: 4 };
const features = new Set(['mixed', 'negative', 'uncertain', 'numeric', 'represented-claimant', 'conditional']);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const keys = (value, expected) => {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value));
  assert.deepEqual(Object.keys(value).sort(), [...expected].sort());
};
const nonempty = value => { assert.equal(typeof value, 'string'); assert.ok(value.length > 0); assert.equal(value, value.trim()); };
function wellFormed(text) {
  for (let index = 0; index < text.length; index++) {
    const unit = text.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = text.charCodeAt(++index);
      assert.ok(next >= 0xdc00 && next <= 0xdfff, 'unpaired high surrogate');
    } else assert.ok(unit < 0xdc00 || unit > 0xdfff, 'unpaired low surrogate');
  }
}

function checkSource(value) {
  keys(value, ['version', 'cases']);
  assert.equal(value.version, 'claim-local-extracted-v1');
  assert.ok(Array.isArray(value.cases)); assert.equal(value.cases.length, 24);
  assert.equal(new Set(value.cases.map(row => row.id)).size, 24);
  for (const row of value.cases) {
    keys(row, ['id', 'messages']); assert.match(row.id, /^ce-[0-9a-f]{4}$/);
    assert.ok(Array.isArray(row.messages)); assert.ok(row.messages.length >= 1 && row.messages.length <= 3);
    for (const message of row.messages) {
      keys(message, ['role', 'text']); assert.ok(['user', 'assistant'].includes(message.role));
      nonempty(message.text); assert.ok(message.text.length <= 800); wellFormed(message.text);
    }
  }
}

function checkRubric(value, fixture) {
  keys(value, ['version', 'sourceVersion', 'audience', 'protocol', 'cases']);
  assert.equal(value.version, 'claim-local-extracted-rubric-v1');
  assert.equal(value.sourceVersion, fixture.version); nonempty(value.audience);
  keys(value.protocol, ['denominator', 'groupCounts', 'sourceBoundary', 'tupleRule', 'observations', 'coverage', 'strictSourceSuccess', 'failures', 'itemReporting', 'severeErrors', 'gate', 'judging', 'freeze']);
  assert.equal(value.protocol.denominator, 24); assert.deepEqual(value.protocol.groupCounts, groups);
  for (const field of ['sourceBoundary', 'tupleRule', 'observations', 'coverage', 'strictSourceSuccess', 'failures', 'itemReporting', 'judging', 'freeze']) nonempty(value.protocol[field]);
  assert.equal(value.protocol.severeErrors.length, 5); value.protocol.severeErrors.forEach(nonempty);
  assert.deepEqual(value.protocol.gate, { minimumNetSourceGains: 3, fixedDenominator: 24, maximumLostActualDecisions: 0,
    maximumNewSevereErrors: 0, unknownsBlockPromotion: true, meaning: 'Diagnostic continuation only; no automatic production promotion or full-core/installed integration claim.' });
  assert.equal(value.cases.length, 24);
  assert.deepEqual(value.cases.map(row => row.id), fixture.cases.map(row => row.id));
  const counts = Object.fromEntries(Object.keys(groups).map(group => [group, 0]));
  let challengeCases = 0;
  for (const row of value.cases) {
    keys(row, ['id', 'group', 'features', 'requiredClaims']);
    assert.ok(Object.hasOwn(groups, row.group)); counts[row.group]++;
    assert.ok(Array.isArray(row.features)); assert.equal(new Set(row.features).size, row.features.length);
    row.features.forEach(feature => assert.ok(features.has(feature)));
    if (row.features.some(feature => ['mixed', 'negative', 'uncertain'].includes(feature))) challengeCases++;
    assert.ok(Array.isArray(row.requiredClaims));
    assert.equal(row.requiredClaims.length, row.group === 'mixed-observation-adoption' ? 2 : 1);
    assert.equal(new Set(row.requiredClaims.map(claim => claim.key)).size, row.requiredClaims.length);
    if (row.group === 'mixed-observation-adoption') assert.ok(row.features.includes('mixed'));
    const stances = new Set();
    for (const claim of row.requiredClaims) {
      const expectedKeys = ['key', 'meaning', 'claimant', 'conditions', 'uncertainty', 'admissibleCommitments'];
      if (Object.hasOwn(claim, 'polarityCaution')) { expectedKeys.push('polarityCaution'); nonempty(claim.polarityCaution); }
      keys(claim, expectedKeys);
      for (const field of ['key', 'meaning', 'claimant', 'conditions', 'uncertainty']) nonempty(claim[field]);
      assert.ok(Array.isArray(claim.admissibleCommitments)); assert.ok(claim.admissibleCommitments.length >= 1 && claim.admissibleCommitments.length <= 2);
      for (const option of claim.admissibleCommitments) {
        keys(option, ['tupleMeaning', 'value']); nonempty(option.tupleMeaning);
        assert.ok(['unknown', 'adopted', 'considered', 'rejected'].includes(option.value)); stances.add(option.value);
      }
    }
    // These are rubric-structure checks, not a scripted judgment of model semantics.
    if (row.group === 'pure-observation') assert.deepEqual([...stances], ['unknown']);
    if (row.group === 'mixed-observation-adoption') assert.ok(stances.has('unknown') && stances.has('adopted'));
    if (row.group === 'adopted') assert.ok(stances.has('adopted'));
    if (row.group === 'considered') assert.deepEqual([...stances], ['considered']);
    if (row.group === 'rejected') assert.ok(stances.has('rejected'));
  }
  assert.deepEqual(counts, groups); assert.ok(challengeCases >= 12);
  return { sources: value.cases.length, requiredClaims: value.cases.reduce((sum, row) => sum + row.requiredClaims.length, 0), challengeCases };
}

test('actual-extraction fixture contains only 24 bounded source conversations', () => checkSource(source));

test('evaluator-only rubric covers every source and all 30 required claims', () => {
  const inventory = checkRubric(rubric, source);
  assert.equal(inventory.sources, 24); assert.equal(inventory.requiredClaims, 30);
});

test('new sources share neither IDs nor exact source text with the previous cohort', () => {
  const previous = JSON.parse(readFileSync(new URL('../fixtures/claim-local-commitment-v1.json', import.meta.url)));
  const oldIds = new Set(previous.cases.map(row => row.id));
  const oldText = new Set(previous.cases.map(row => row.source.text));
  for (const row of source.cases) {
    assert.ok(!oldIds.has(row.id));
    row.messages.forEach(message => assert.ok(!oldText.has(message.text)));
  }
  // Mechanical disjointness does not establish semantic novelty or absence of leakage.
});

test('malformed or oracle-bearing copies fail source separation and UTF-16 bounds', () => {
  for (const mutate of [
    copy => { copy.cases[0].kind = 'fact'; },
    copy => { copy.cases[0].expectedCommitment = 'unknown'; },
    copy => { copy.cases[0].messages[0].sourceReceipt = 'unexpected'; },
    copy => { copy.cases[0].messages[0].role = 'system'; },
    copy => { copy.cases[0].messages[0].text = 'x'.repeat(801); },
    copy => { copy.cases[0].messages[0].text = '\ud800'; },
    copy => { copy.cases[0].messages[0].text = '\udc00'; },
    copy => { copy.cases[0].messages[0].text = ' untrimmed'; },
    copy => { copy.cases[0].messages = []; },
    copy => { copy.cases[1].id = copy.cases[0].id; },
    copy => { copy.cases.pop(); },
  ]) {
    const copy = structuredClone(source); mutate(copy); assert.throws(() => checkSource(copy));
  }
});

test('corrupted evaluator copies cannot drop coverage, groups or the fixed source gate', () => {
  for (const mutate of [
    copy => { copy.cases[6].requiredClaims.pop(); },
    copy => { copy.cases[0].group = 'adopted'; },
    copy => { copy.cases[0].requiredClaims[0].admissibleCommitments[0].value = 'adopted'; },
    copy => { copy.cases.reverse(); },
    copy => { copy.protocol.gate.minimumNetSourceGains = 2; },
    copy => { copy.protocol.gate.unknownsBlockPromotion = false; },
    copy => { copy.cases[0].requiredClaims[0].meaning = ''; },
    copy => { copy.protocol.denominator = 23; },
  ]) {
    const copy = structuredClone(rubric); mutate(copy); assert.throws(() => checkRubric(copy, source));
  }
});

test('previous frozen fixture and rubric bytes remain unchanged', () => {
  for (const [name, expected] of [
    ['claim-local-commitment-v1.json', 'fc36e37f12b298a55ef2810e6e669ca01a727d411949be59ecca4919d2afa5a2'],
    ['claim-local-commitment-rubric-v1.json', '3be9fa39ea44de06ce617afc71b9cc3155e8752e629463f7baa1232d18d01814'],
  ]) assert.equal(hash(readFileSync(new URL(`../fixtures/${name}`, import.meta.url))), expected);
});

test('primary-approved new source and evaluator rubric bytes match their pre-execution pins', () => {
  assert.equal(hash(sourceBytes), '36d3655dae7e3f8edd78c038ab63a7b32cab1b0f5d23e00f3751ab6938506983');
  assert.equal(hash(rubricBytes), '7217bd39c59cae0243e16e52ca2255fdf8fee2bbb493b83e3b47cc3ffd910da0');
});

// Byte integrity is not paid authorization or evidence of model semantics.
