import test from 'node:test';
import assert from 'node:assert/strict';
import { score } from '../scorer.mjs';
import { stable } from '../canonical.mjs';
import { compileTrivia, createTriviaAuthority, createTriviaCase, adaptGeneratorTrivia, GENERATOR_TRIVIA_VERSION } from '../support.mjs';
import { TRIVIA_AUTH_VERSION, TRIVIA_RULES_SHA256 } from '../../generator/trivia.mjs';
import { copy, citation } from './fixtures.mjs';
import { authored, edge, select, sha, rulesBytes, rejectedThenProtected } from './trivia-fixtures.mjs';
const run = f => score(f.gold, f.submission, f.scoringOptions);
function bind(f, authority, caseId = f.input.caseId, question = f.gold.question, family = f.input.family) {
  const binding = { family, authority, caseId, question };
  f.gold.supportTrivia = adaptGeneratorTrivia(f.input.registry, rulesBytes, f.input.turns, binding);
  f.scoringOptions = { triviaCase: createTriviaCase(binding) };
  return f;
}
function sharedAuthority(...worlds) {
  const handles = Object.fromEntries(worlds.map(f => [f.input.family.family_id, f.input.handle]));
  const bytes = Buffer.from(JSON.stringify({ optional_trivia: { version: GENERATOR_TRIVIA_VERSION, authentication_version: TRIVIA_AUTH_VERSION,
    rules_sha256: TRIVIA_RULES_SHA256, family_handles: handles, family_handles_sha256: sha(stable(handles)) } }));
  return createTriviaAuthority(bytes, sha(bytes));
}
function equivalentEmissions(language, familyA = 'engineering-family-A', familyB = 'engineering-family-B') {
  const en = language === 'en';
  const a = authored([edge(en ? 'A' : '甲', en ? 'B. C caused D.' : '乙。 因為丙，所以造成丁。', language)], undefined, { familyId: familyA });
  const b = authored([edge(en ? 'A' : '甲', en ? 'B' : '乙', language), { production: 'source_join', language },
    edge(en ? 'C' : '丙', en ? 'D.' : '丁。', language)], undefined, { familyId: familyB });
  assert.deepEqual(a.input.turns, b.input.turns); // identical local origin IDs/text
  const boundary = b.input.registry.origins[0].segments[0].end;
  for (const f of [a, b]) select(f, 0, [[0, boundary - 1], [boundary + 1, f.gold.supportSpans[0].text.length]]);
  return [a, b, boundary];
}
function assertCrossFamily(language) {
  const [a, b, boundary] = equivalentEmissions(language);
  // Same freeze pin, same question/case ID, same origin IDs and source bytes.
  // Only the independently expected family/handle distinguishes these cases.
  const authority = sharedAuthority(a, b);
  bind(a, authority); bind(b, authority);
  assert.deepEqual(run(a).scores, { C: 1, O: 1, R: 0, J: 0 });
  assert.equal(run(b).scores.R, 1);
  a.gold.supportTrivia = b.gold.supportTrivia;
  const result = rejectedThenProtected(a);
  assert.deepEqual(result.scores, { C: 1, O: 1, R: 0, J: 0 });
  assert.throws(() => run(a), /trivia_target_binding_mismatch/);
  const spans = new Map(a.gold.supportSpans.map(s => [s.id, s]));
  const denied = compileTrivia(b.gold.supportTrivia, spans, a.scoringOptions.triviaCase, a.gold.question);
  assert.equal(denied('engineering-source', boundary - 1, language === 'en' ? '.' : '。'), false);
  assert.equal(denied('engineering-source', boundary, ' '), false);
  assert.equal(run(b).scores.R, 1); // denial does not revoke B's legitimate proof
}
test('English reviewer replay: family B proof cannot license family A under one frozen authority', () => assertCrossFamily('en'));
test('Chinese reviewer replay: family B proof cannot license family A under one frozen authority', () => assertCrossFamily('zh'));

function assertDifferentCase(language) {
  const f = authored([edge('Ice', 'alarm', language)]), authority = f.input.authority;
  select(f, 0, [[0, f.gold.supportSpans[0].text.length - 1]]);
  bind(f, authority, 'checkpoint-one');
  const one = { proof: f.gold.supportTrivia, target: f.scoringOptions.triviaCase };
  assert.equal(run(f).scores.R, 1);
  bind(f, authority, 'checkpoint-two');
  const two = { proof: f.gold.supportTrivia, target: f.scoringOptions.triviaCase };
  assert.equal(run(f).scores.R, 1);
  // Same family, handle, pin, source and question. Case identity alone differs.
  f.gold.supportTrivia = one.proof;
  assert.equal(rejectedThenProtected(f).scores.R, 0);
  assert.throws(() => run(f), /trivia_target_binding_mismatch/);
  f.gold.supportTrivia = two.proof; f.scoringOptions = { triviaCase: one.target };
  assert.equal(rejectedThenProtected(f).scores.R, 0);
}
test('English same-family different-case proof is rejected even with the same handle and question', () => assertDifferentCase('en'));
test('Chinese same-family different-case proof is rejected even with the same handle and question', () => assertDifferentCase('zh'));

test('same-family different-handle proof is rejected for identical text and case ID in both languages', () => {
  for (const language of ['en', 'zh']) {
    const [a, b] = equivalentEmissions(language, 'same-family', 'same-family');
    assert.deepEqual(a.input.family, b.input.family);
    assert.notDeepEqual(a.input.handle, b.input.handle);
    assert.equal(run(a).scores.R, 0); assert.equal(run(b).scores.R, 1);
    a.gold.supportTrivia = b.gold.supportTrivia;
    assert.equal(rejectedThenProtected(a).scores.R, 0);
    assert.throws(() => run(a), /trivia_target_binding_mismatch/);
  }
});
test('expected case question must match both the registered proof and the actual gold question', () => {
  const f = authored([edge()]);
  select(f, 0, [[0, f.gold.supportSpans[0].text.length - 1]]);
  const proof = f.gold.supportTrivia, target = f.scoringOptions.triviaCase;
  assert.equal(run(f).scores.R, 1);
  f.gold.question += ' A different requested checkpoint.';
  assert.equal(rejectedThenProtected(f).scores.R, 0);
  assert.throws(() => run(f), /missing_or_mismatched_expected_trivia_case/);
  f.scoringOptions = { triviaCase: createTriviaCase({ family: f.input.family, authority: f.input.authority,
    caseId: f.input.caseId, question: f.gold.question }) };
  assert.equal(rejectedThenProtected(f).scores.R, 0); // same ID, newly expected question cannot borrow old proof
  f.gold.question = f.input.question; f.scoringOptions = { triviaCase: target }; f.gold.supportTrivia = proof;
  assert.equal(run(f).scores.R, 1);
});
test('missing, forged or cloned expected-case tokens cannot infer authority from a genuine proof', () => {
  const f = authored([edge()]);
  select(f, 0, [[0, f.gold.supportSpans[0].text.length - 1]]);
  assert.equal(run(f).scores.R, 1);
  for (const token of [undefined, {}, copy(f.scoringOptions.triviaCase), { ...f.scoringOptions.triviaCase }]) {
    const out = rejectedThenProtected(f, { triviaCase: token });
    assert.deepEqual(out.scores, { C: 1, O: 1, R: 0, J: 0 });
    // The original call is rejected and its compiler grants zero licenses;
    // the helper's separate protected-content witness now has its own authority.
    assert.equal(out.supportAuthentication.status, 'authenticated_unlicensed');
  }
  assert.throws(() => score(f.gold, f.submission), { code: 'ERR_HR3_TRIVIA_BINDING' }); // no implicit proof-owned target
  assert.equal(compileTrivia(f.gold.supportTrivia, new Map()).authentication.status, 'protected');
});
test('exact expected family and freeze binding is required; caller mutation cannot retarget an issued token', () => {
  const f = authored([edge()]);
  select(f, 0, [[0, f.gold.supportSpans[0].text.length - 1]]);
  const altered = copy(f.input.family); altered.dispatch_annotation = 'another authoring case';
  const foreignTarget = createTriviaCase({ family: altered, authority: f.input.authority, caseId: f.input.caseId, question: f.gold.question });
  assert.equal(rejectedThenProtected(f, { triviaCase: foreignTarget }).scores.R, 0);
  const family = copy(f.input.family);
  const target = createTriviaCase({ family, authority: f.input.authority, caseId: f.input.caseId, question: f.gold.question });
  family.family_id = 'retargeted';
  assert.equal(score(f.gold, f.submission, { triviaCase: target }).scores.R, 1);
  assert(Object.isFrozen(target));
  assert.throws(() => { target.case_id = 'retargeted'; }, TypeError);
  assert.throws(() => createTriviaCase({ family, authority: f.input.authority, caseId: f.input.caseId, question: f.gold.question }), /family\/handle mismatch/);
});
test('support dependence keys bind the expected case without exposing family handles or case IDs to judges', () => {
  const f = authored([edge()]);
  f.submission.delivered[0].segments.push({ origin: 'unknown', start: 0, text: ' Maybe.' });
  select(f, 0, [[0, f.gold.supportSpans[0].text.length - 1]]);
  const first = run(f).referrals.find(r => r.pass === 'support');
  const firstScope = run(f).supportAuthentication.expected_case_sha256;
  bind(f, f.input.authority, 'another-private-checkpoint');
  const second = run(f).referrals.find(r => r.pass === 'support');
  assert(first && second); assert.notEqual(first.key, second.key);
  assert.notEqual(firstScope, run(f).supportAuthentication.expected_case_sha256);
  assert.deepEqual(first.answer, second.answer); assert.deepEqual(first.delivered, second.delivered);
  assert(!JSON.stringify(second).includes('another-private-checkpoint'));
  assert(!JSON.stringify(second).includes('family_handles'));
});
