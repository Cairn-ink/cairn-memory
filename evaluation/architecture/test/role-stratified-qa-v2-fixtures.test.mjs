import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { boundedText } from '../../../core/validation.mjs';

const fixtures = new URL('../fixtures/', import.meta.url);
const load = async (name) => JSON.parse(await readFile(new URL(name, fixtures), 'utf8'));
const [source, rubric, earlierSource, earlierRubric] = await Promise.all([
  load('role-stratified-qa-v2.json'),
  load('role-stratified-qa-rubric-v2.json'),
  load('role-stratified-qa-v1.json'),
  load('role-stratified-qa-rubric-v1.json'),
]);
const groups = [
  'dated-personal-events', 'changed-observations', 'intentions-adoption',
  'conditions-uncertainty', 'assistant-information', 'mixed-attribution',
];

function keys(value, expected, label) {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value), label);
  assert.deepEqual(Object.keys(value).sort(), [...expected].sort(), label);
}

function unchangedText(value, limit, label) {
  assert.equal(typeof value, 'string', label);
  assert.ok(value.length > 0 && value.length <= limit, `${label}: UTF-16 limit`);
  assert.ok(value.isWellFormed(), `${label}: well-formed UTF-16`);
  assert.equal(value.normalize('NFKC'), value, `${label}: NFKC`);
  assert.equal(value.replace(/\s+/gu, ' ').trim(), value, `${label}: whitespace`);
  // Pure normalization/redaction only. No model, memory runtime, SQLite,
  // candidate implementation, private report, output, ledger, or env import.
  // Equality rejects transformed or clipped text instead of silently fixing it.
  assert.equal(boundedText(value, limit), value, `${label}: canonical/redaction stability`);
}

function validateSource(value) {
  keys(value, ['version', 'cases'], 'source');
  // v2 identifies a fresh cohort on disk; its unchanged wire schema stays v1.
  assert.equal(value.version, 'role-stratified-qa-v1');
  assert.ok(Array.isArray(value.cases));
  assert.equal(value.cases.length, 24);
  const ids = new Set();
  const questions = new Set();
  const conversations = new Set();
  const controls = { user: 0, assistant: 0 };
  let alternating = 0;
  let substantial = 0;
  let longAssistantCases = 0;
  for (const row of value.cases) {
    keys(row, ['id', 'messages', 'question'], 'source case');
    assert.match(row.id, /^[0-9a-f]{12}$/u);
    assert.ok(!ids.has(row.id), 'unique source id');
    ids.add(row.id);
    unchangedText(row.question, 300, `${row.id}: question`);
    assert.ok(!questions.has(row.question), 'unique question');
    questions.add(row.question);
    assert.ok(Array.isArray(row.messages) && row.messages.length > 0);
    let raw = 0;
    let canonical = 0;
    let longAssistant = false;
    const roles = new Set();
    for (const [index, message] of row.messages.entries()) {
      keys(message, ['role', 'content'], `${row.id}: message ${index}`);
      assert.ok(['user', 'assistant'].includes(message.role));
      unchangedText(message.content, 4000, `${row.id}: message ${index}`);
      raw += message.content.length;
      canonical += boundedText(message.content, 4000).length;
      roles.add(message.role);
      longAssistant ||= message.role === 'assistant' && message.content.length > 800;
    }
    assert.equal(raw, canonical, `${row.id}: canonical source total`);
    assert.ok(raw <= 16000, `${row.id}: total source units`);
    assert.ok(raw + row.question.length <= 20000, `${row.id}: raw batch units`);
    assert.ok(JSON.stringify(row.messages).length + row.question.length <= 20000,
      `${row.id}: serialized batch units`);
    substantial += Number(raw >= 6000);
    longAssistantCases += Number(longAssistant);
    const serialized = JSON.stringify(row.messages);
    assert.ok(!conversations.has(serialized), 'unique full source');
    conversations.add(serialized);
    if (roles.size === 1) {
      assert.ok(row.messages.length >= 1 && row.messages.length <= 6);
      controls[row.messages[0].role] += 1;
    } else {
      alternating += 1;
      assert.ok(row.messages.length >= 6 && row.messages.length <= 12);
      row.messages.forEach((message, index) => {
        assert.equal(message.role, index % 2 === 0 ? 'user' : 'assistant');
      });
    }
  }
  assert.deepEqual(controls, { user: 2, assistant: 2 });
  assert.equal(alternating, 20);
  assert.ok(substantial >= 12);
  assert.ok(longAssistantCases >= 16);
}

test('fresh role-stratified cohort has the source contract and unchanged canonical text', () => {
  validateSource(source);
});

test('cohort identities, sources, questions, and reference answers are fresh against v1', () => {
  const oldIds = new Set(earlierSource.cases.map((row) => row.id));
  const oldSources = new Set(earlierSource.cases.map((row) => JSON.stringify(row.messages)));
  const oldMessages = new Set(earlierSource.cases.flatMap((row) =>
    row.messages.map((message) => message.content)));
  const oldQuestions = new Set(earlierSource.cases.map((row) => row.question));
  const oldAnswers = new Set(earlierRubric.cases.map((row) => row.expectedAnswer));
  for (const row of source.cases) {
    assert.ok(!oldIds.has(row.id));
    assert.ok(!oldSources.has(JSON.stringify(row.messages)));
    assert.ok(!oldQuestions.has(row.question));
    for (const message of row.messages) assert.ok(!oldMessages.has(message.content));
  }
  for (const row of rubric.cases) assert.ok(!oldAnswers.has(row.expectedAnswer));
});

test('fresh rubric has exact source quotes, minimum claim shape, and required strata', () => {
  keys(rubric, ['version', 'fixtureVersion', 'cases'], 'rubric');
  assert.equal(rubric.version, 'role-stratified-qa-rubric-v1');
  assert.equal(rubric.fixtureVersion, source.version);
  assert.equal(rubric.cases.length, 24);
  const counts = new Map(groups.map((group) => [group, 0]));
  const ids = new Set();
  const unknownFamilies = new Set();
  const lateCases = new Set();
  let unknowns = 0;
  let multiClaimCases = 0;
  let assistantInformationCases = 0;
  let severeControlCases = 0;
  for (const [index, row] of rubric.cases.entries()) {
    const conversation = source.cases[index];
    keys(row, ['id', 'group', 'unknown', 'assistantInformation', 'expectedAnswer',
      'claims', 'forbiddenAssertions'], 'rubric case');
    assert.equal(row.id, conversation.id);
    assert.ok(!ids.has(row.id));
    ids.add(row.id);
    assert.ok(counts.has(row.group));
    counts.set(row.group, counts.get(row.group) + 1);
    assert.equal(typeof row.unknown, 'boolean');
    assert.equal(typeof row.assistantInformation, 'boolean');
    unchangedText(row.expectedAnswer, 1000, `${row.id}: reference answer`);
    assert.ok(Array.isArray(row.claims) && row.claims.length >= 1 && row.claims.length <= 3);
    const texts = new Set();
    for (const [claimIndex, claim] of row.claims.entries()) {
      keys(claim, ['id', 'text', 'decision', 'evidence'], `${row.id}: claim`);
      assert.equal(claim.id, `c${claimIndex + 1}`);
      unchangedText(claim.text, 1000, `${row.id}: claim text`);
      assert.ok(!texts.has(claim.text));
      texts.add(claim.text);
      // decision marks a requested choice/action or its commitment or
      // applicability, including conditional action rules. It is not a
      // synonym for adoption. Dates, observations, general assistant
      // information and unknown claims use false.
      assert.equal(typeof claim.decision, 'boolean');
      assert.ok(Array.isArray(claim.evidence) && claim.evidence.length > 0);
      const evidencePairs = new Set();
      for (const evidence of claim.evidence) {
        keys(evidence, ['messageIndex', 'quote'], `${row.id}: evidence`);
        assert.ok(Number.isInteger(evidence.messageIndex));
        assert.ok(evidence.messageIndex >= 0 && evidence.messageIndex < conversation.messages.length);
        unchangedText(evidence.quote, 4000, `${row.id}: quote`);
        const message = conversation.messages[evidence.messageIndex];
        const offset = message.content.indexOf(evidence.quote);
        assert.ok(offset >= 0, `${row.id}/${claim.id}: exact source quote`);
        const pair = JSON.stringify([evidence.messageIndex, evidence.quote]);
        assert.ok(!evidencePairs.has(pair));
        evidencePairs.add(pair);
        // Unknown quotes are contextual audit material only. They are not
        // positive evidence or a proof of absence and never count below.
        if (!row.unknown && offset >= 800 && message.content.length > 800) lateCases.add(row.id);
      }
      if (row.unknown) assert.equal(claim.decision, false);
      if (row.assistantInformation) {
        assert.ok(claim.evidence.some((evidence) =>
          conversation.messages[evidence.messageIndex].role === 'assistant'));
      }
    }
    assert.ok(Array.isArray(row.forbiddenAssertions) && row.forbiddenAssertions.length > 0);
    const forbiddenTexts = new Set();
    for (const forbidden of row.forbiddenAssertions) {
      keys(forbidden, ['text', 'severe'], `${row.id}: forbidden`);
      unchangedText(forbidden.text, 1000, `${row.id}: forbidden text`);
      assert.ok(!forbiddenTexts.has(forbidden.text));
      forbiddenTexts.add(forbidden.text);
      assert.equal(typeof forbidden.severe, 'boolean');
    }
    if (row.unknown) {
      unknowns += 1;
      unknownFamilies.add(row.group);
      assert.equal(row.assistantInformation, false);
    } else if (row.claims.length >= 2) multiClaimCases += 1;
    assistantInformationCases += Number(row.assistantInformation);
    if (!row.unknown && ['changed-observations', 'intentions-adoption', 'mixed-attribution'].includes(row.group)
      && row.forbiddenAssertions.some((forbidden) => forbidden.severe)) severeControlCases += 1;
  }
  assert.deepEqual([...counts.values()], [4, 4, 4, 4, 4, 4]);
  assert.equal(unknowns, 4);
  assert.ok(unknownFamilies.size >= 3);
  assert.ok(multiClaimCases >= 6);
  assert.ok(assistantInformationCases >= 4);
  assert.ok(severeControlCases >= 4);
  assert.ok(lateCases.size >= 4, 'needed quotes after offset 800 in four sources');
});

test('four manually reviewed unknown targets are missing values rather than known negative decisions', () => {
  // This pins the audit targets and their context after source-side semantic
  // inspection. It does not pretend syntax proves an answer is unknowable.
  // Independent fairness review must inspect the whole conversations too.
  const audits = [
    ['b72c84000103', /broadcast date/u,
      'The station archive has acknowledged my inquiry and has not sent a result.'],
    ['b72c84000203', /How many carved stones/u,
      "I have not counted the new stones, and my cousin's card does not give a number."],
    ['b72c84000303', /How much deposit/u,
      'I booked it and paid the required deposit through their invoice.'],
    ['b72c84000403', /specific pickup time/u,
      'Lea and I spoke by phone and settled on Friday, including a specific pickup time.'],
  ];
  assert.deepEqual(rubric.cases.filter((row) => row.unknown).map((row) => row.id),
    audits.map(([id]) => id));
  for (const [id, questionPattern, context] of audits) {
    const row = source.cases.find((item) => item.id === id);
    const gold = rubric.cases.find((item) => item.id === id);
    assert.match(row.question, questionPattern);
    assert.ok(row.messages.some((message) => message.content.includes(context)));
    assert.match(gold.expectedAnswer, /not established|unknown|not stated|not given/u);
  }
});

test('source validation rejects changed canonical content and schema without mutation', () => {
  for (const mutate of [
    (value) => { value.cases[0].unknown = true; },
    (value) => { value.cases[0].messages[0].content += ' \uFF22'; },
    (value) => { value.cases[0].messages[0].content += '  repeated space'; },
    (value) => { value.cases[0].messages[0].content += '\uD800'; },
    (value) => { value.cases[0].messages[0].content = 'a'.repeat(4001); },
    (value) => { value.cases[0].messages[1].role = 'user'; },
  ]) {
    const changed = structuredClone(source);
    mutate(changed);
    const before = JSON.stringify(changed);
    assert.throws(() => validateSource(changed));
    assert.equal(JSON.stringify(changed), before);
  }
});
