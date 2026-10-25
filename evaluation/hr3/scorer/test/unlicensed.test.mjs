import test from 'node:test';
import assert from 'node:assert/strict';
import { score } from '../scorer.mjs';
import { stable } from '../canonical.mjs';
import { TRIVIA_VERSION, createUnlicensedTriviaAuthority, createUnlicensedTriviaCase, compileUnlicensedTrivia } from '../support.mjs';
import { fixture, copy } from './fixtures.mjs';
import { authored, edge, select } from './trivia-fixtures.mjs';
import { unlicensedFixture, digest } from './unlicensed-fixtures.mjs';
const empty = () => ({ version: TRIVIA_VERSION, producer: null, rules: [], positions: [] });

function stripping(language) {
  const f = authored([edge('Ice', 'the cobalt handoff', language)]);
  select(f, 0, [[0, f.gold.supportSpans[0].text.length - 1]]);
  assert.equal(score(f.gold, f.submission, f.scoringOptions).scores.R, 1);
  const proof = f.gold.supportTrivia;
  f.gold.supportTrivia = empty();
  for (const answer of [f.submission, null, {}]) assert.throws(() => score(f.gold, answer), { code: 'ERR_HR3_TRIVIA_BINDING' });
  assert.throws(() => score(f.gold, f.submission, f.scoringOptions), { code: 'ERR_HR3_TRIVIA_BINDING' });
  delete f.gold.supportTrivia;
  assert.throws(() => score(f.gold, f.submission), /Invalid gold/);
  assert.throws(() => score(f.gold, f.submission, f.scoringOptions), /Invalid gold/);
  f.gold.supportTrivia = proof;
  assert.equal(score(f.gold, f.submission, f.scoringOptions).scores.R, 1);
}
test('English API stripping: A-6 empty or absent metadata cannot authorize unlicensed scoring', () => stripping('en'));
test('Chinese API stripping: A-6 empty or absent metadata cannot authorize unlicensed scoring', () => stripping('zh'));

test('frozen exact-target no-trivia authority permits protected coverage and factual-negative R', () => {
  for (const language of ['en', 'zh']) {
    const f = fixture();
    if (language === 'zh') f.gold.question = '請回答檢查點的設定、前身與完整原因。';
    const bound = unlicensedFixture(f.gold), options = bound.scoringOptions;
    const full = score(f.gold, f.submission, options);
    assert.deepEqual(full.scores, { C: 1, O: 1, R: 1, J: 1 });
    assert.equal(full.supportAuthentication.status, 'authenticated_unlicensed');
    assert.equal(full.supportAuthentication.authority_sha256, bound.pin);
    f.submission.answer.reason.support[0].quote = 'A caused B';
    assert.equal(score(f.gold, f.submission, options).scores.R, 0); // no final-stop license
    f.gold.reason = { status: 'not_stated', nodes: [], acceptedGraphs: [] };
    f.submission.answer.reason = { status: 'not_stated', support: [] }; f.submission.delivered = [];
    assert.throws(() => score(f.gold, f.submission, options), { code: 'ERR_HR3_TRIVIA_BINDING' });
    const freshGold = copy(f.gold);
    const negative = score(freshGold, f.submission, unlicensedFixture(freshGold).scoringOptions);
    assert.equal(negative.scores.R, 1); assert.equal(negative.reason.support, 'not_applicable');
  }
});
test('unlicensed authority rejects another family and another source case with the same question', () => {
  for (const sameFamily of [false, true]) {
    const a = fixture(), b = fixture();
    const targetA = { id: 'independent-family-A', question: a.gold.question, checkpoint: 1, gold: copy(a.gold) };
    const targetB = { ...copy(targetA), id: sameFamily ? targetA.id : 'independent-family-B', checkpoint: 2 };
    const boundA = unlicensedFixture(a.gold, targetA), boundB = unlicensedFixture(b.gold, targetB);
    assert.equal(score(a.gold, a.submission, boundA.scoringOptions).scores.R, 1);
    assert.equal(score(b.gold, b.submission, boundB.scoringOptions).scores.R, 1);
    assert.throws(() => score(a.gold, a.submission, boundB.scoringOptions), { code: 'ERR_HR3_TRIVIA_BINDING' });
    assert.throws(() => score(b.gold, b.submission, boundA.scoringOptions), { code: 'ERR_HR3_TRIVIA_BINDING' });
    assert.throws(() => createUnlicensedTriviaCase({ authority: boundA.authority, target: targetB, gold: b.gold }), /absent from frozen/);
    assert.notEqual(boundA.record.sourceSHA256, boundB.record.sourceSHA256);
    assert.notEqual(compileUnlicensedTrivia(a.gold, boundA.scoringOptions.unlicensedCase).authentication.expected_case_sha256,
      compileUnlicensedTrivia(b.gold, boundB.scoringOptions.unlicensedCase).authentication.expected_case_sha256);
  }
});
test('unlicensed tokens bind exact gold identity and hash; cloning, mutation and forged tokens fail', () => {
  const f = fixture(), bound = unlicensedFixture(f.gold), token = bound.scoringOptions.unlicensedCase;
  for (const unlicensedCase of [undefined, {}, copy(token), { authority_sha256: bound.pin }]) {
    assert.throws(() => score(f.gold, f.submission, { unlicensedCase }), { code: 'ERR_HR3_TRIVIA_BINDING' });
  }
  const cloned = copy(f.gold);
  assert.throws(() => score(cloned, f.submission, bound.scoringOptions), { code: 'ERR_HR3_TRIVIA_BINDING' });
  const fresh = createUnlicensedTriviaCase({ authority: bound.authority, target: bound.target, gold: cloned });
  assert.equal(score(cloned, f.submission, { unlicensedCase: fresh }).scores.R, 1);
  f.gold.current.rows[0].route.value = 'different';
  assert.throws(() => score(f.gold, f.submission, bound.scoringOptions), { code: 'ERR_HR3_TRIVIA_BINDING' });
  assert.throws(() => createUnlicensedTriviaCase({ authority: bound.authority, target: bound.target, gold: f.gold }), /gold\/target mismatch/);
  bound.target.checkpoint = 'changed after registration';
  assert.throws(() => createUnlicensedTriviaCase({ authority: bound.authority, target: bound.target, gold: cloned }), /absent from frozen/);
});
test('licensed generator authority and unrelated no-trivia tokens cannot authorize stripped licensed gold', () => {
  for (const language of ['en', 'zh']) {
    const f = authored([edge('Ice', 'queues', language)]), unrelated = fixture();
    unrelated.gold.question = f.gold.question;
    const noTrivia = unlicensedFixture(unrelated.gold);
    f.gold.supportTrivia = empty();
    assert.throws(() => score(f.gold, f.submission, noTrivia.scoringOptions), { code: 'ERR_HR3_TRIVIA_BINDING' });
    assert.throws(() => createUnlicensedTriviaAuthority(f.input.freezeBytes, f.input.pin), /Invalid frozen/);
    assert.throws(() => createUnlicensedTriviaCase({ authority: f.input.authority,
      target: { id: f.input.family.family_id, question: f.gold.question, gold: copy(f.gold) }, gold: f.gold }), /Missing trusted/);
  }
});
test('no-trivia catalog pins, exact records, source hash, gold hash and unique identities are checked', () => {
  const f = fixture(), bound = unlicensedFixture(f.gold);
  assert.throws(() => createUnlicensedTriviaAuthority(bound.bytes), /pin mismatch/);
  assert.throws(() => createUnlicensedTriviaAuthority(bound.bytes, '0'.repeat(64)), /pin mismatch/);
  for (const edit of [catalog => catalog.version = 'invented', catalog => catalog.cases[0].trivia = 'maybe',
    catalog => catalog.cases[0].extra = true, catalog => catalog.cases.push(copy(catalog.cases[0])),
    catalog => catalog.cases[0].sourceSHA256 = 'invalid', catalog => delete catalog.cases[0].goldSHA256]) {
    const bad = copy(bound.catalog); edit(bad);
    const bytes = JSON.stringify(bad);
    assert.throws(() => createUnlicensedTriviaAuthority(bytes, digest(bytes)), /Invalid frozen/);
  }
  for (const edit of [catalog => catalog.cases[0].sourceSHA256 = '0'.repeat(64), catalog => catalog.cases[0].goldSHA256 = '0'.repeat(64),
    catalog => catalog.cases[0].question += ' Other.', catalog => catalog.cases[0].caseId += '/other']) {
    const bad = copy(bound.catalog); edit(bad); const bytes = JSON.stringify(bad);
    const authority = createUnlicensedTriviaAuthority(bytes, digest(bytes));
    assert.throws(() => createUnlicensedTriviaCase({ authority, target: bound.target, gold: copy(f.gold) }), /absent from frozen|gold\/target mismatch/);
  }
  assert.equal(digest(stable(bound.target)), bound.record.sourceSHA256);
});
test('A-6 versions are closed: downgraded, missing, unknown and mixed legacy envelopes never bypass binding', () => {
  const f = fixture(), bound = unlicensedFixture(f.gold);
  for (const version of [undefined, null, '', 'hr3-support-a4-v2', 'hr3-scorer-a4-v2', 'hr3-support-a6-v1', 'hr3-support-a6-v999']) {
    for (const removeTrivia of [false, true]) {
      const gold = copy(f.gold);
      if (version === undefined) delete gold.supportVersion; else gold.supportVersion = version;
      if (removeTrivia) delete gold.supportTrivia;
      assert.throws(() => score(gold, f.submission), /Invalid gold/);
      assert.throws(() => score(gold, f.submission, bound.scoringOptions), /Invalid gold/);
    }
  }
});
test('unlicensed mode cannot coexist with a second binding or authorize nonempty metadata', () => {
  const f = fixture(), bound = unlicensedFixture(f.gold);
  assert.throws(() => score(f.gold, f.submission, { ...bound.scoringOptions, triviaCase: {} }), /conflicting_trusted_bindings/);
  f.gold.supportTrivia.positions.push({ origin: 'turn-1', position: 10, char: '.', rule: 'fake', literal_offset: 0 });
  assert.throws(() => score(f.gold, f.submission, bound.scoringOptions), { code: 'ERR_HR3_TRIVIA_BINDING' });
  assert.throws(() => createUnlicensedTriviaCase({ authority: bound.authority, target: bound.target, gold: f.gold }), /Missing trusted/);
});
