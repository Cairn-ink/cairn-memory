import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// This validator reads only the authored source conversations and their rubric.
// It neither imports a memory implementation nor executes a candidate or model.
// Rubric claims express the minimum required meaning, not exact wording.
// expectedAnswer is illustrative and can contain optional supporting context.
// Unknown-case evidence is contextual audit material, not positive proof of
// an absence; exclude all four unknown cases from positive quote-coverage metrics.
const fixtureBytes = readFileSync(new URL('../fixtures/dialogue-context-qa-v1.json', import.meta.url));
const fixture = JSON.parse(fixtureBytes.toString('utf8'));
const rubric = JSON.parse(readFileSync(new URL('../fixtures/dialogue-context-qa-rubric-v1.json', import.meta.url), 'utf8'));
const groups = ['consideration', 'explicit-adoption', 'rejection', 'factual-correction', 'observation', 'insufficient-information'];

function exactKeys(value, keys) {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value));
  assert.deepEqual(Object.keys(value).sort(), [...keys].sort());
}

function prose(value, limit = Infinity) {
  assert.equal(typeof value, 'string');
  assert.ok(value.length > 0 && value.length <= limit);
  assert.equal(value, value.trim());
  assert.ok(!/[\u0000-\u001f\u007f]/u.test(value), 'single-line prose without control characters');
  assert.ok(!/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/u.test(value), 'well-formed UTF-16');
}

function normalized(value) {
  return value.toLowerCase().replace(/\s+/gu, ' ').trim();
}

test('pre-execution rubric cleanup preserves the original source fixture bytes', () => {
  assert.equal(createHash('sha256').update(fixtureBytes).digest('hex'), '2de0cf0f1821ac0f008ba221130d217872db640deee1fcaf228d98271223048a');
});

test('source fixture has exactly 24 opaque, bounded, ordinary dialogue/question records', () => {
  exactKeys(fixture, ['version', 'cases']);
  assert.equal(fixture.version, 'dialogue-context-qa-v1');
  assert.ok(Array.isArray(fixture.cases));
  assert.equal(fixture.cases.length, 24);
  const ids = new Set();
  const dialogues = new Set();
  const questions = new Set();
  for (const entry of fixture.cases) {
    exactKeys(entry, ['id', 'messages', 'question']);
    assert.match(entry.id, /^[0-9a-f]{12}$/u);
    assert.ok(!ids.has(entry.id), `duplicate ID ${entry.id}`);
    ids.add(entry.id);
    assert.ok(Array.isArray(entry.messages));
    assert.ok(entry.messages.length >= 1 && entry.messages.length <= 6);
    let units = 0;
    entry.messages.forEach((message, index) => {
      exactKeys(message, ['role', 'content']);
      assert.equal(message.role, index % 2 === 0 ? 'user' : 'assistant');
      prose(message.content, 600);
      units += message.content.length;
    });
    prose(entry.question, 300);
    assert.equal((entry.question.match(/\?/gu) ?? []).length, 1);
    assert.ok(entry.question.endsWith('?'));
    assert.ok(units + entry.question.length <= 2200, `case ${entry.id} exceeds its UTF-16 budget`);
    const dialogue = JSON.stringify(entry.messages.map(({ role, content }) => [role, normalized(content)]));
    const question = normalized(entry.question);
    assert.ok(!dialogues.has(dialogue), `duplicate dialogue ${entry.id}`);
    assert.ok(!questions.has(question), `duplicate question ${entry.id}`);
    dialogues.add(dialogue);
    questions.add(question);
  }
});

test('rubric is separate, aligned, exactly shaped, and grounded in verbatim source spans', () => {
  exactKeys(rubric, ['version', 'fixtureVersion', 'cases']);
  assert.equal(rubric.version, 'dialogue-context-qa-rubric-v1');
  assert.equal(rubric.fixtureVersion, fixture.version);
  assert.ok(Array.isArray(rubric.cases));
  assert.equal(rubric.cases.length, 24);
  assert.deepEqual(rubric.cases.map(({ id }) => id), fixture.cases.map(({ id }) => id));
  const counts = Object.fromEntries(groups.map((group) => [group, 0]));
  for (const [index, entry] of rubric.cases.entries()) {
    exactKeys(entry, ['id', 'group', 'expectedAnswer', 'claims', 'forbiddenAssertions']);
    assert.ok(groups.includes(entry.group));
    counts[entry.group] += 1;
    prose(entry.expectedAnswer);
    assert.ok(Array.isArray(entry.claims) && entry.claims.length >= 1);
    const claimIds = new Set();
    const claimTexts = new Set();
    for (const claim of entry.claims) {
      exactKeys(claim, ['id', 'text', 'decision', 'evidence']);
      assert.match(claim.id, /^c[1-9][0-9]*$/u);
      assert.ok(!claimIds.has(claim.id));
      claimIds.add(claim.id);
      prose(claim.text);
      assert.ok(!claimTexts.has(normalized(claim.text)));
      claimTexts.add(normalized(claim.text));
      assert.equal(typeof claim.decision, 'boolean');
      assert.ok(Array.isArray(claim.evidence) && claim.evidence.length >= 1);
      for (const span of claim.evidence) {
        exactKeys(span, ['messageIndex', 'quote']);
        assert.ok(Number.isInteger(span.messageIndex));
        assert.ok(span.messageIndex >= 0 && span.messageIndex < fixture.cases[index].messages.length);
        prose(span.quote);
        assert.ok(fixture.cases[index].messages[span.messageIndex].content.includes(span.quote), `unbound quote in ${entry.id}/${claim.id}`);
      }
    }
    assert.ok(Array.isArray(entry.forbiddenAssertions) && entry.forbiddenAssertions.length >= 1);
    const forbiddenTexts = new Set();
    for (const forbidden of entry.forbiddenAssertions) {
      exactKeys(forbidden, ['text', 'severe']);
      prose(forbidden.text);
      assert.equal(typeof forbidden.severe, 'boolean');
      assert.ok(!forbiddenTexts.has(normalized(forbidden.text)));
      forbiddenTexts.add(normalized(forbidden.text));
    }
  }
  assert.deepEqual(counts, Object.fromEntries(groups.map((group) => [group, 4])));
});

test('single-message controls are exactly four and distributed among groups', () => {
  const singles = fixture.cases.filter(({ messages }) => messages.length === 1);
  assert.equal(singles.length, 4);
  const singleGroups = singles.map(({ id }) => rubric.cases.find((entry) => entry.id === id).group);
  assert.equal(new Set(singleGroups).size, 4);
  assert.equal(fixture.cases.filter(({ messages }) => messages.length >= 2 && messages.length <= 6).length, 20);
});

// Human-authored content anchors make the cross-cutting controls reviewable
// without exposing labels or expected answers in the model-facing fixture.
const distractions = [
  ['a2d97308fb61', 2, 'My kitchen clock stopped this morning.'],
  ['4d9b20af8673', 2, "The neighbor's cat finally came home."],
  ['b9037e14a5cf', 2, 'My sister is learning the trumpet, by the way.'],
  ['a6e3107fd258', 2, 'Also, my kettle needs descaling.'],
  ['63dc1a70be95', 2, 'I found my missing umbrella.'],
  ['3c1f75a9d082', 2, 'The mail carrier brought a postcard from my aunt.'],
  ['6a08de4b137f', 2, 'I also finished a crossword today.'],
  ['c0b7a3149ed2', 2, 'My basil plant has new leaves.'],
];

test('at least six multi-message dialogues have an unrelated conversational utterance', () => {
  assert.ok(distractions.length >= 6);
  assert.equal(new Set(distractions.map(([id]) => id)).size, distractions.length);
  for (const [id, index, quote] of distractions) {
    const entry = fixture.cases.find((item) => item.id === id);
    assert.ok(entry);
    assert.ok(entry.messages.length >= 2);
    assert.ok(entry.messages[index].content.includes(quote));
  }
});

test('at least six questions require two distinct grounded claims', () => {
  // These questions explicitly ask for paired details, or both a possibility
  // and its commitment status. Each listed answer requires both rubric claims.
  const pairedIds = [
    'e04b7c926d15', 'c85a1603e7bd', '4d9b20af8673', '86ce35b149a0',
    'd71a6fb2308c', '2ea5419cd670', 'a6e3107fd258', '08b5d92e46ac',
    '63dc1a70be95', 'eb7294f108da', '94ac820e7f36', '3c1f75a9d082',
    '6a08de4b137f',
  ];
  assert.ok(pairedIds.length >= 6);
  assert.equal(new Set(pairedIds).size, pairedIds.length);
  for (const id of pairedIds) {
    const entry = rubric.cases.find((item) => item.id === id);
    assert.ok(entry && entry.claims.length >= 2, `missing paired claims for ${id}`);
    const supports = entry.claims.map(({ evidence }) => JSON.stringify(evidence));
    assert.equal(new Set(supports).size, supports.length, `identical supports for ${id}`);
  }
});

test('unknown answers express missing evidence rather than inventing a negative fact', () => {
  const unknowns = rubric.cases.filter(({ group }) => group === 'insufficient-information');
  assert.equal(unknowns.length, 4);
  for (const entry of unknowns) {
    assert.match(entry.expectedAnswer, /not given|not established|does not say/u);
    assert.doesNotMatch(entry.expectedAnswer, /definitely (?:not|no)|has no name/u);
    assert.ok(entry.forbiddenAssertions.some(({ severe }) => severe));
  }
});

test('minimum required claims do not reintroduce audited optional context', () => {
  // These are regressions for the pre-execution audit, not a semantic scorer.
  // The source still contains these details and expectedAnswer may illustrate
  // them, but answers must not lose credit for omitting them.
  const optionalContext = [
    ['c85a1603e7bd', 'c2', /two|skeins|payday/iu],
    ['86ce35b149a0', 'c2', /arriv|tomorrow/iu],
    ['d71a6fb2308c', 'c2', /morning/iu],
    ['b9037e14a5cf', 'c1', /phone|visitor/iu],
    ['f24c0b8e916d', 'c1', /plastic|\bmat\b|assistant/iu],
    ['94ac820e7f36', 'c1', /morning/iu],
    ['3c1f75a9d082', 'c2', /assistant|longer/iu],
    ['6a08de4b137f', 'c1', /hallway|rain|twice|night/iu],
    ['6a08de4b137f', 'c2', /hallway|rain/iu],
    ['fd2649a08c71', 'c1', /\bfine\b/iu],
    ['15d8f02bc6a9', 'c1', /shy|chair|meeting/iu],
    ['c0b7a3149ed2', 'c1', /viewing|again/iu],
    ['7ed65a209bf4', 'c1', /intention|dinner|Monday|early|lookup/iu],
    ['ba418f630d97', 'c1', /weather|menu|lentil|tomato/iu],
  ];
  for (const [id, claimId, incidental] of optionalContext) {
    const entry = rubric.cases.find((item) => item.id === id);
    const claim = entry?.claims.find((item) => item.id === claimId);
    assert.ok(claim, `${id}/${claimId} exists`);
    assert.doesNotMatch(claim.text, incidental, `optional detail required by ${id}/${claimId}`);
    if (entry.group !== 'insufficient-information') {
      for (const { quote } of claim.evidence) {
        assert.doesNotMatch(quote, incidental, `optional positive support in ${id}/${claimId}`);
      }
    }
  }
  for (const id of ['a2d97308fb61', 'b9037e14a5cf', 'f24c0b8e916d']) {
    assert.equal(rubric.cases.find((entry) => entry.id === id).claims.length, 1);
  }
  // The refusal itself supports the answer; course identity excerpts add no
  // necessary evidence for whether either course is being taken this month.
  const courseRefusal = rubric.cases.find(({ id }) => id === '5f8d69a207bc').claims[0];
  assert.deepEqual(courseRefusal.evidence, [{ messageIndex: 2, quote: "I'm passing on both courses this month." }]);
});
