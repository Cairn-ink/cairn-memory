import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { hashCanonicalValue } from '../corpus.mjs';
import { prepareAlgorithmDevelopmentCase } from '../runner.mjs';
import { redactSecrets } from '../../../plugins/cairn-memory/lib/redact.mjs';

// Authored fixture checks, independent of the prospective profile validator.
// No retrieval compiler, old answer fixture, ledger or semantic judge is used.
const source = JSON.parse(await readFile(new URL('../large-pool-cases.json', import.meta.url), 'utf8'));
const rubric = JSON.parse(await readFile(new URL('../large-pool-rubric.json', import.meta.url), 'utf8'));
const knownIds = Object.freeze(['L01', 'L02', 'L03', 'L04']);
const unknownIds = Object.freeze(['L05', 'L06']);
const families = Object.freeze([
  'three-source-handoff', 'dated-location-update', 'decision-premise-reconfirmation',
  'cjk-paraphrase-retrieval', 'missing-entity-binding', 'lexical-scope-collision',
]);
const expectedSourceCharacters = Object.freeze([1886, 1786, 1993, 580, 1694, 1824]);

function exactKeys(value, expected) {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value));
  assert.deepEqual(Object.keys(value).sort(), [...expected].sort());
}

function nonempty(value) {
  assert.equal(typeof value, 'string');
  assert.ok(value.trim().length > 0);
}

function utcDate(value, event = false) {
  assert.match(value, event
    ? /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u
    : /^\d{4}-\d{2}-\d{2}$/u);
  const iso = new Date(event ? value : value + 'T00:00:00Z').toISOString();
  assert.equal(event ? iso.replace('.000Z', 'Z') : iso.slice(0, 10), value);
}

function assertSourceContract(rows) {
  assert.ok(Array.isArray(rows));
  assert.equal(rows.length, 6);
  rows.forEach((row, index) => {
    exactKeys(row, ['id', 'family', 'question', 'sessions']);
    assert.equal(row.id, [...knownIds, ...unknownIds][index]);
    assert.equal(row.family, families[index]);
    exactKeys(row.question, ['text', 'date']);
    nonempty(row.question.text);
    utcDate(row.question.date);
    assert.ok(Array.isArray(row.sessions));
    assert.equal(row.sessions.length, 6);
    assert.equal(new Set(row.sessions.map(session => session.id)).size, 6);
    let characters = 0;
    row.sessions.forEach((session, sessionIndex) => {
      exactKeys(session, ['id', 'eventTime', 'messages']);
      assert.equal(session.id, row.id + '-s' + (sessionIndex + 1));
      utcDate(session.eventTime, true);
      assert.ok(session.eventTime.slice(0, 10) <= row.question.date);
      assert.ok(Array.isArray(session.messages));
      assert.equal(session.messages.length, 3);
      assert.deepEqual(session.messages.map(message => message.role), ['user', 'assistant', 'user']);
      session.messages.forEach(message => {
        exactKeys(message, ['role', 'content']);
        nonempty(message.content);
        assert.doesNotMatch(message.content, /\b(?:memorize|admit|extract)\b.{0,40}\b(?:facts|memories|cards|count)\b/iu);
        characters += [...message.content].length;
      });
    });
    assert.ok(characters <= 4000, row.id + ' source character limit');
    assert.equal(characters, expectedSourceCharacters[index]);
  });
}

test('L1 source-only roster has six sessions, eighteen turns and explicit eligible event dates per case', () => {
  assertSourceContract(source);
  assert.equal(source.flatMap(row => row.sessions).length, 36);
  assert.equal(source.flatMap(row => row.sessions.flatMap(session => session.messages)).length, 108);
});

test('authored source whitelist rejects evaluator metadata at every input depth', () => {
  const targets = [
    row => row,
    row => row.question,
    row => row.sessions[0],
    row => row.sessions[0].messages[0],
  ];
  for (const target of targets) {
    for (const field of ['anchors', 'requiredPropositions', 'examples', 'expectedAnswer']) {
      const mutated = structuredClone(source);
      target(mutated[0])[field] = 'evaluator only';
      assert.throws(() => assertSourceContract(mutated), assert.AssertionError);
    }
  }
});

test('rubric anchors are unique exact UTF-16 slices of attributable user statements', () => {
  exactKeys(rubric, ['version', 'spanOffsetUnit', 'cases']);
  assert.equal(rubric.version, 'large-pool-six-v1');
  assert.equal(rubric.spanOffsetUnit, 'utf16-code-unit');
  exactKeys(rubric.cases, [...knownIds, ...unknownIds]);
  let anchorCount = 0;
  for (const row of source) {
    const rule = rubric.cases[row.id];
    exactKeys(rule, [
      'variant', 'requiredPropositions', 'acceptableQualifications', 'anchors',
      'requiredMultiSourceSets', 'unsupportedClaims', 'staleUseCriteria',
      'severeErrors', 'optionalBackground', 'examples',
    ]);
    assert.equal(rule.variant, row.family);
    for (const field of ['requiredPropositions', 'acceptableQualifications',
      'unsupportedClaims', 'staleUseCriteria', 'severeErrors', 'optionalBackground']) {
      assert.ok(Array.isArray(rule[field]) && rule[field].length > 0);
      rule[field].forEach(nonempty);
    }
    const coordinates = new Set();
    assert.ok(rule.anchors.length > 0);
    for (const anchor of rule.anchors) {
      exactKeys(anchor, ['sessionId', 'messageIndex', 'start', 'end', 'text']);
      const session = row.sessions.find(item => item.id === anchor.sessionId);
      assert.ok(session);
      assert.ok(Number.isSafeInteger(anchor.messageIndex));
      assert.ok(anchor.messageIndex >= 0 && anchor.messageIndex < 3);
      const message = session.messages[anchor.messageIndex];
      assert.equal(message.role, 'user');
      assert.ok(Number.isSafeInteger(anchor.start) && Number.isSafeInteger(anchor.end));
      assert.ok(anchor.start >= 0 && anchor.end > anchor.start && anchor.end <= message.content.length);
      assert.equal(message.content.slice(anchor.start, anchor.end), anchor.text);
      nonempty(anchor.text);
      for (const offset of [anchor.start, anchor.end]) {
        assert.ok(!(offset > 0 && offset < message.content.length
          && /[\uD800-\uDBFF]/u.test(message.content[offset - 1])
          && /[\uDC00-\uDFFF]/u.test(message.content[offset])), 'Unicode boundary');
      }
      const key = JSON.stringify([anchor.sessionId, anchor.messageIndex, anchor.start, anchor.end]);
      assert.ok(!coordinates.has(key), 'duplicate anchor');
      coordinates.add(key);
      anchorCount++;
    }
    assert.ok(rule.requiredMultiSourceSets.length > 0);
    for (const indices of rule.requiredMultiSourceSets) {
      assert.ok(indices.length >= 2);
      assert.equal(new Set(indices).size, indices.length);
      for (const index of indices) assert.ok(Number.isSafeInteger(index) && index >= 0 && index < rule.anchors.length);
      assert.ok(new Set(indices.map(index => rule.anchors[index].sessionId)).size >= 2);
    }
  }
  assert.equal(anchorCount, 36);
  assert.equal(new Set(rubric.cases.L01.requiredMultiSourceSets[0]
    .map(index => rubric.cases.L01.anchors[index].sessionId)).size, 3);
});

test('normal indexed-source preparation preserves all six session batches and role-bound anchor opportunities', () => {
  let batches = 0;
  let turns = 0;
  for (const row of source) {
    const { plan } = prepareAlgorithmDevelopmentCase(row);
    assert.equal(plan.cairnPlan.executable, true);
    assert.equal(plan.cairnPlan.captureSourcePolicy, 'indexed-evidence-v1');
    assert.deepEqual(plan.cairnPlan.blockers, []);
    assert.equal(plan.cairnPlan.batches.length, 6);
    assert.equal(plan.cairnPlan.sourceTurns.length, 18);
    plan.cairnPlan.batches.forEach((batch, sessionIndex) => {
      assert.equal(batch.source.sessionIndex, sessionIndex);
      assert.equal(batch.captureInput.messages.length, 3);
      assert.equal(batch.normalizedCapture.messages.length, 3);
      assert.equal(batch.sourceMap.length, 3);
      assert.equal(batch.sourceWindowCatalog.messageCount, 3);
      assert.equal(batch.sourceWindowCatalog.semanticCoverage, 'unassessed');
      assert.ok(batch.indexedWindows.length >= 3);
      assert.deepEqual(batch.captureInput.messages.map(message => message.role), ['user', 'assistant', 'user']);
      row.sessions[sessionIndex].messages.forEach((message, messageIndex) => {
        const normalized = message.content.normalize('NFKC').replace(/\s+/gu, ' ').trim();
        assert.equal(redactSecrets(normalized), normalized, 'no secret-redaction distortion');
        assert.ok(batch.normalizedCapture.messages[messageIndex].content.includes(normalized));
        assert.equal(batch.sourceMap[messageIndex].turnIndex, messageIndex);
        assert.equal(batch.sourceMap[messageIndex].role, message.role);
        assert.equal(batch.sourceMap[messageIndex].chunkIndex, 0);
      });
      batches++;
      turns += batch.captureInput.messages.length;
    });
    for (const anchor of rubric.cases[row.id].anchors) {
      assert.equal(anchor.text.normalize('NFKC'), anchor.text, 'literal anchor is normalization stable');
      const sessionIndex = row.sessions.findIndex(session => session.id === anchor.sessionId);
      const batch = plan.cairnPlan.batches[sessionIndex];
      const windows = batch.indexedWindows.filter(window => window.messageIndex === anchor.messageIndex && window.role === 'user');
      assert.ok(windows.some(window => window.content.includes(anchor.text)), row.id + ' missing prepared anchor opportunity');
    }
  }
  assert.equal(batches, 36);
  assert.equal(turns, 108);
});

test('late-listed old event retains its date and cannot become a fresh location update', () => {
  const row = source[1];
  assert.ok(row.sessions[4].eventTime < row.sessions[3].eventTime);
  const { plan } = prepareAlgorithmDevelopmentCase(row);
  assert.equal(plan.cairnPlan.batches[4].source.sourceDate, '2026-04-08 14:25');
  assert.equal(plan.cairnPlan.batches[3].source.sourceDate, '2026-05-10 09:00');
  assert.equal(plan.cairnPlan.batches[5].source.sourceDate, '2026-05-18 10:50');
  assert.match(rubric.cases.L02.examples.conciseCorrect, /Shelf C.*West annex.*May 12/u);
});

test('CJK question paraphrases the operative user passages and preserves their source characters', () => {
  const row = source[3];
  assert.match(row.question.text, /暫停錄音/u);
  assert.match(row.question.text, /繼續/u);
  const evidence = rubric.cases.L04.anchors.map(anchor => anchor.text).join(' ');
  assert.match(evidence, /先別把談話收進音檔/u);
  assert.match(evidence, /重新開機/u);
  assert.doesNotMatch(evidence, /暫停錄音/u);
  assert.ok([...row.question.text].some(point => /\p{Script=Han}/u.test(point)));
});

test('four known controls reject a generic abstention and two unknown controls give supported partial answers', () => {
  assert.deepEqual(source.slice(0, 4).map(row => row.id), knownIds);
  assert.deepEqual(source.slice(4).map(row => row.id), unknownIds);
  assert.equal(knownIds.length, 4);
  assert.equal(unknownIds.length, 2);
  for (const id of [...knownIds, ...unknownIds]) {
    exactKeys(rubric.cases[id].examples, ['conciseCorrect', 'explainedCorrect', 'incorrect']);
    Object.values(rubric.cases[id].examples).forEach(nonempty);
    assert.notEqual(rubric.cases[id].examples.conciseCorrect, rubric.cases[id].examples.incorrect);
    assert.notEqual(rubric.cases[id].examples.explainedCorrect, rubric.cases[id].examples.incorrect);
  }
  for (const id of knownIds) {
    assert.ok(rubric.cases[id].requiredPropositions.length >= 2);
    assert.equal(rubric.cases[id].examples.incorrect, 'I do not know.');
  }
  assert.match(rubric.cases.L05.examples.conciseCorrect, /not identified.*Studio D/u);
  assert.doesNotMatch(rubric.cases.L05.examples.conciseCorrect, /Nora|Owen|Leena/u);
  assert.match(rubric.cases.L06.examples.conciseCorrect, /no recorded.*adoption.*suggestion/u);
  assert.match(rubric.cases.L05.examples.incorrect, /Nora borrowed/u);
  assert.match(rubric.cases.L06.examples.incorrect, /Yes.*adopted/u);
});

test('concise correct examples omit optional narration while retaining the requested facts', () => {
  assert.doesNotMatch(rubric.cases.L01.examples.conciseCorrect, /Elias|Niko/u);
  assert.doesNotMatch(rubric.cases.L02.examples.conciseCorrect, /North gallery|South foyer|invoice/u);
  assert.doesNotMatch(rubric.cases.L03.examples.conciseCorrect, /June 1|Birch Studio/u);
  assert.match(rubric.cases.L03.acceptableQualifications.join(' '), /June 1.*optional/u);
  assert.doesNotMatch(rubric.cases.L04.examples.conciseCorrect, /收音志工|排程|下一位/u);
  assert.doesNotMatch(rubric.cases.L04.requiredPropositions.join(' '), /志工|排程/u);
  assert.match(rubric.cases.L04.optionalBackground.join(' '), /收音志工/u);
  assert.equal(rubric.cases.L06.requiredPropositions.length, 1);
  assert.doesNotMatch(rubric.cases.L06.requiredPropositions.join(' '), /cycling|reading circle/u);
  assert.doesNotMatch(rubric.cases.L06.examples.conciseCorrect, /cycling|reading circle|Ash courtyard|March/u);
  assert.match(rubric.cases.L06.optionalBackground.join(' '), /cycling.*reading/u);
});

test('prospective fixture identity is pinned before paid answers', () => {
  assert.equal(hashCanonicalValue(source), 'cb3834f6b4672e95fe5d79d51d93bcf3fe042a73f829aecc8b813b3e7ce8c118');
  assert.equal(hashCanonicalValue(rubric), '39bb513e254d489912540f9cdc762f7cac5c3dac70fc3f26f236ccf836b4c27e');
});
