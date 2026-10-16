import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { boundedText } from '../../../core/validation.mjs';

const sourceUrl = new URL('../fixtures/role-stratified-qa-v1.json', import.meta.url);
const rubricUrl = new URL('../fixtures/role-stratified-qa-rubric-v1.json', import.meta.url);
const source = JSON.parse(await readFile(sourceUrl, 'utf8'));
const rubric = JSON.parse(await readFile(rubricUrl, 'utf8'));
const groups = [
  'dated-personal-events',
  'changed-observations',
  'intentions-adoption',
  'conditions-uncertainty',
  'assistant-information',
  'mixed-attribution',
];

function exactKeys(value, expected, context) {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value), context);
  assert.deepEqual(Object.keys(value).sort(), [...expected].sort(), context);
}

function stableText(value, maxUnits, context) {
  assert.equal(typeof value, 'string', context);
  assert.ok(value.length > 0 && value.length <= maxUnits, context);
  assert.ok(value.isWellFormed(), `${context}: well-formed UTF-16`);
  assert.equal(value, value.normalize('NFKC'), `${context}: NFKC stability`);
  assert.equal(value, value.replace(/\s+/gu, ' ').trim(), `${context}: whitespace stability`);
  // boundedText is pure source normalization/redaction; no extraction, model,
  // runtime memory schema, corpus, database, candidate, or gold imports occur.
  // Equality checks prove the fixture is unchanged, rather than clipping it to fit.
  assert.equal(boundedText(value, maxUnits), value, `${context}: sanitizer stability`);
}

function validateSource(value) {
  exactKeys(value, ['version', 'cases'], 'source envelope');
  assert.equal(value.version, 'role-stratified-qa-v1');
  assert.ok(Array.isArray(value.cases));
  assert.equal(value.cases.length, 24);
  const ids = new Set();
  const questions = new Set();
  const conversations = new Set();
  const controls = { user: 0, assistant: 0 };
  let longSources = 0;
  let assistantLongCases = 0;
  let alternating = 0;
  for (const row of value.cases) {
    exactKeys(row, ['id', 'messages', 'question'], 'source case');
    assert.match(row.id, /^[a-f0-9]{12}$/u);
    assert.ok(!ids.has(row.id), `${row.id}: duplicate id`);
    ids.add(row.id);
    stableText(row.question, 300, `${row.id}: question`);
    assert.ok(!questions.has(row.question), `${row.id}: duplicate question`);
    questions.add(row.question);
    assert.ok(Array.isArray(row.messages) && row.messages.length > 0);
    const roles = new Set();
    let rawUnits = 0;
    let canonicalUnits = 0;
    let assistantLong = false;
    for (const [index, message] of row.messages.entries()) {
      exactKeys(message, ['role', 'content'], `${row.id}: message ${index}`);
      assert.ok(['user', 'assistant'].includes(message.role));
      stableText(message.content, 4000, `${row.id}: message ${index}`);
      roles.add(message.role);
      rawUnits += message.content.length;
      canonicalUnits += boundedText(message.content, 4000).length;
      assistantLong ||= message.role === 'assistant' && message.content.length > 800;
    }
    assert.equal(canonicalUnits, rawUnits, `${row.id}: aggregate canonical stability`);
    assert.ok(rawUnits <= 16000, `${row.id}: source size`);
    // Both the message-content batch and its serialized transport fit the cap.
    assert.ok(rawUnits + row.question.length <= 20000, `${row.id}: content batch size`);
    assert.ok(JSON.stringify(row.messages).length + row.question.length <= 20000,
      `${row.id}: serialized batch size`);
    if (rawUnits >= 6000 && rawUnits <= 16000) longSources += 1;
    if (assistantLong) assistantLongCases += 1;
    const conversation = JSON.stringify(row.messages);
    assert.ok(!conversations.has(conversation), `${row.id}: duplicate source`);
    conversations.add(conversation);
    if (roles.size === 1) {
      assert.ok(row.messages.length >= 1 && row.messages.length <= 6);
      controls[row.messages[0].role] += 1;
    } else {
      alternating += 1;
      assert.ok(row.messages.length >= 6 && row.messages.length <= 12);
      row.messages.forEach((message, index) => {
        assert.equal(message.role, index % 2 === 0 ? 'user' : 'assistant',
          `${row.id}: alternating user-first roles`);
      });
    }
  }
  assert.deepEqual(controls, { user: 2, assistant: 2 });
  assert.equal(alternating, 20);
  assert.ok(longSources >= 12, 'at least twelve substantial sources');
  assert.ok(assistantLongCases >= 16, 'at least sixteen long-assistant cases');
  return { longSources, assistantLongCases, controls, alternating };
}

test('role-stratified source-only fixture contract and canonical stability', () => {
  validateSource(source);
});

test('source validator rejects unstable, mislabeled, or oversized content without clipping', () => {
  for (const [label, edit] of [
    ['extra evaluator field', (value) => { value.cases[0].group = 'not-source'; }],
    ['compatibility character', (value) => { value.cases[0].messages[0].content += ' \uFF21'; }],
    ['duplicate whitespace', (value) => { value.cases[0].messages[0].content += '  gap'; }],
    ['unpaired surrogate', (value) => { value.cases[0].messages[0].content += '\uD800'; }],
    ['oversized message', (value) => { value.cases[0].messages[0].content = 'x'.repeat(4001); }],
    ['wrong role order', (value) => { value.cases[0].messages[1].role = 'user'; }],
  ]) {
    const mutated = structuredClone(source);
    edit(mutated);
    const before = JSON.stringify(mutated);
    assert.throws(() => validateSource(mutated), undefined, label);
    assert.equal(JSON.stringify(mutated), before, `${label}: validator is read-only`);
  }
});

test('rubric is aligned, minimal-claim shaped, and verbatim source-bound', () => {
  exactKeys(rubric, ['version', 'fixtureVersion', 'cases'], 'rubric envelope');
  assert.equal(rubric.version, 'role-stratified-qa-rubric-v1');
  assert.equal(rubric.fixtureVersion, source.version);
  assert.ok(Array.isArray(rubric.cases));
  assert.equal(rubric.cases.length, source.cases.length);
  const groupCounts = new Map(groups.map((group) => [group, 0]));
  const unknownGroups = new Set();
  const rubricIds = new Set();
  let unknowns = 0;
  let assistantInformationCases = 0;
  let multiClaimCases = 0;
  let severeControlCases = 0;
  const lateEvidenceCases = new Set();
  const lateAssistantEvidenceCases = new Set();
  for (const [index, row] of rubric.cases.entries()) {
    const conversation = source.cases[index];
    exactKeys(row, ['id', 'group', 'unknown', 'assistantInformation',
      'expectedAnswer', 'claims', 'forbiddenAssertions'], 'rubric case');
    assert.equal(row.id, conversation.id, 'source/rubric ordinal alignment');
    assert.ok(!rubricIds.has(row.id));
    rubricIds.add(row.id);
    assert.ok(groupCounts.has(row.group));
    groupCounts.set(row.group, groupCounts.get(row.group) + 1);
    assert.equal(typeof row.unknown, 'boolean');
    assert.equal(typeof row.assistantInformation, 'boolean');
    stableText(row.expectedAnswer, 1000, `${row.id}: expected answer`);
    assert.ok(Array.isArray(row.claims) && row.claims.length >= 1 && row.claims.length <= 3);
    const claimTexts = new Set();
    let assistantEvidence = false;
    for (const [claimIndex, claim] of row.claims.entries()) {
      exactKeys(claim, ['id', 'text', 'decision', 'evidence'], `${row.id}: claim`);
      assert.equal(claim.id, `c${claimIndex + 1}`);
      stableText(claim.text, 1000, `${row.id}: claim text`);
      assert.ok(!claimTexts.has(claim.text), `${row.id}: duplicate claim`);
      claimTexts.add(claim.text);
      // decision marks requested choice/action or commitment/applicability
      // claims, including conditional rules. It does not mean every such
      // proposition reports adoption. Dates, observations and general
      // assistant-provided information are false; unknown claims are false.
      assert.equal(typeof claim.decision, 'boolean');
      assert.ok(Array.isArray(claim.evidence) && claim.evidence.length > 0);
      const evidencePairs = new Set();
      for (const evidence of claim.evidence) {
        exactKeys(evidence, ['messageIndex', 'quote'], `${row.id}: evidence`);
        assert.ok(Number.isInteger(evidence.messageIndex));
        assert.ok(evidence.messageIndex >= 0 && evidence.messageIndex < conversation.messages.length);
        stableText(evidence.quote, 4000, `${row.id}: evidence quote`);
        const message = conversation.messages[evidence.messageIndex];
        const offset = message.content.indexOf(evidence.quote);
        assert.ok(offset >= 0, `${row.id}/${claim.id}: quote must be verbatim`);
        const pair = JSON.stringify([evidence.messageIndex, evidence.quote]);
        assert.ok(!evidencePairs.has(pair), `${row.id}/${claim.id}: repeated evidence`);
        evidencePairs.add(pair);
        if (!row.unknown) {
          // Unknown quotes are contextual audit only. They never count as
          // positive source coverage or proof of an absence.
          assistantEvidence ||= message.role === 'assistant';
          if (offset >= 800 && message.content.length > 800) {
            lateEvidenceCases.add(row.id);
            if (message.role === 'assistant') lateAssistantEvidenceCases.add(row.id);
          }
        }
      }
      if (row.unknown) assert.equal(claim.decision, false);
    }
    assert.ok(Array.isArray(row.forbiddenAssertions) && row.forbiddenAssertions.length > 0);
    const forbiddenTexts = new Set();
    for (const forbidden of row.forbiddenAssertions) {
      exactKeys(forbidden, ['text', 'severe'], `${row.id}: forbidden assertion`);
      stableText(forbidden.text, 1000, `${row.id}: forbidden text`);
      assert.ok(!forbiddenTexts.has(forbidden.text));
      forbiddenTexts.add(forbidden.text);
      assert.equal(typeof forbidden.severe, 'boolean');
    }
    if (row.unknown) {
      unknowns += 1;
      unknownGroups.add(row.group);
      assert.equal(row.assistantInformation, false);
    } else if (row.claims.length >= 2 && row.claims.length <= 3) multiClaimCases += 1;
    if (row.assistantInformation) {
      assistantInformationCases += 1;
      assert.ok(assistantEvidence, `${row.id}: assistant information requires assistant source`);
      assert.ok(row.claims.every((claim) => claim.evidence.some((evidence) =>
        conversation.messages[evidence.messageIndex].role === 'assistant')));
    }
    if (!row.unknown && ['changed-observations', 'intentions-adoption', 'mixed-attribution'].includes(row.group)
      && row.forbiddenAssertions.some((forbidden) => forbidden.severe)) severeControlCases += 1;
  }
  assert.deepEqual([...groupCounts.values()], [4, 4, 4, 4, 4, 4]);
  assert.equal(unknowns, 4);
  assert.ok(unknownGroups.size >= 3, 'unknowns distributed across families');
  assert.ok(assistantInformationCases >= 4);
  assert.ok(multiClaimCases >= 6);
  assert.ok(severeControlCases >= 4);
  assert.ok(lateEvidenceCases.size >= 4, 'necessary evidence after message offset 800');
  assert.ok(lateAssistantEvidenceCases.size >= 4, 'late evidence in four distinct assistant messages');
});
