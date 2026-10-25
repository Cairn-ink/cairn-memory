import test from 'node:test';
import assert from 'node:assert/strict';
import { score, correctnessGold, KEY_VERSION } from '../scorer.mjs';
import { SUPPORT_VERSION, TRIVIA_VERSION, compileTrivia, createTriviaAuthority, adaptGeneratorTrivia } from '../support.mjs';
import { stable } from '../canonical.mjs';
import { covers, materializeUnit } from '../citations.mjs';
import { copy, citation } from './fixtures.mjs';
import { authored, adapt, edge, select, omit, sha, rulesBytes, rejectedThenProtected } from './trivia-fixtures.mjs';
const run = f => score(f.gold, f.submission, f.scoringOptions);
const noLicense = (registry, spans = new Map(), expectedCase, question) => {
  const coverage = compileTrivia(registry, spans, expectedCase, question);
  assert.equal(coverage.authentication.status, 'protected');
  for (const origin of ['engineering-source', 'other']) for (let i = 0; i < 80; i++) for (const char of ['.', '。', ' ']) assert.equal(coverage(origin, i, char), false);
};

test('support schema/keys announce authenticated versions', () => {
  const f = authored([edge()]), out = run(f);
  assert.equal(out.supportVersion, SUPPORT_VERSION);
  assert.equal(out.supportVersion, 'hr3-support-a6-v3');
  assert.equal(out.keyVersion, KEY_VERSION);
  assert.equal(out.supportAuthentication.status, 'authenticated');
});
test('genuine final periods and source-production joining spaces may be omitted, English and Chinese', () => {
  for (const language of ['en', 'zh']) {
    const f = authored([edge('Ice', 'queues', language), { production: 'source_join', language }, edge('Queues', 'the cobalt handoff', language)]);
    const s = f.input.registry.origins[0];
    const optional = new Set(s.positions), intervals = [];
    let start = 0;
    for (const position of [...optional].sort((a, b) => a - b)) { intervals.push([start, position]); start = position + 1; }
    intervals.push([start, f.gold.supportSpans[0].text.length]);
    select(f, 0, intervals);
    assert.deepEqual(run(f).scores, { C: 1, O: 1, R: 1, J: 1 });
  }
});
test('missing causal words, conjunctions and intermediate clauses stay protected', () => {
  for (const language of ['en', 'zh']) {
    const f = authored([edge('Ice', 'queues', language), { production: 'source_join', language }, edge('Queues', 'the cobalt handoff', language)]);
    omit(f, 0, language === 'en' ? 'caused' : '造成'); assert.equal(run(f).scores.R, 0);
    const firstEnd = f.input.registry.origins[0].segments[0].end;
    select(f, 0, [[0, firstEnd]]); assert.equal(run(f).scores.R, 0);
    const conjunction = authored([{ production: 'joint', language, variables: { a: 'Ice', b: 'berth closure', c: 'queues' } }]);
    omit(conjunction, 0, language === 'en' ? 'and' : '和'); assert.equal(run(conjunction).scores.R, 0);
    omit(conjunction, 0, language === 'en' ? 'neither alone suffices' : '任一個單獨成立都不夠'); assert.equal(run(conjunction).scores.R, 0);
  }
});
test('punctuation-only support spans and selections cannot establish a cause', () => {
  const base = authored([edge()]);
  const length = base.input.turns[0].text.length;
  for (const language of ['en', 'zh']) {
    const f = authored([edge('Ice', 'the cobalt handoff', language)]);
    const end = f.input.turns[0].text.length;
    f.gold.supportSpans = [{ id: 'only-trivia', origin: 'engineering-source', start: end - 1, end, text: language === 'en' ? '.' : '。' }];
    f.gold.reason.acceptedGraphs = [{ edges: [{ from: 'v0', to: 'v1', support: [['only-trivia']] }] }];
    select(f, 0, [[end - 1, end]]); assert.equal(run(f).scores.R, 0);
  }
  select(base, 0, [[length - 1, length]]); assert.equal(run(base).scores.R, 0);
});
test('unknown delivered context and extra punctuation citations remain referrals', () => {
  for (const extra of [' This was speculative.', '.']) {
    const f = authored([edge()]);
    f.submission.delivered[0].segments.push({ origin: 'unknown-context', start: 0, text: extra });
    select(f, 0, [[0, f.gold.supportSpans[0].text.length - 1]]);
    assert.equal(run(f).reason.correctness, 1);
    assert.equal(run(f).scores.R, null);
    assert.equal(run(f).reason.error, 'unrecognized_evidence_context');
  }
  const f = authored([edge()]);
  f.submission.delivered.push({ intent: 'current', item: 1, unit: 'receipt', source: 0, aliases: [], segments: [{ origin: 'outside-support', start: 0, text: '.' }], normalize: false, truncate: null });
  f.submission.answer.reason.support.push(citation(1, '.'));
  assert.equal(run(f).scores.R, null);
  assert(run(f).referrals.some(r => r.pass === 'support'));
});
test('decimals, dotted IDs, signs, operators and punctuation within interpolations remain protected', () => {
  for (const [from, character] of [['Gauge 1.5', '.'], ['gx.delta', '.'], ['x <= -4', '<'], ['x <= -4', '='], ['x <= -4', '-'], ['p → q', '→'], ['x(y)', '('], ['zx?v', '?'], ['zx!v', '!'], ['zx“v', '“'], ["zx'v", "'"]]) {
    const f = authored([edge(from, 'alarm')]);
    select(f, 0, [[0, f.gold.supportSpans[0].text.length - 1]]); assert.equal(run(f).scores.R, 1);
    omit(f, 0, character); assert.equal(run(f).scores.R, 0);
  }
});
test('Unicode normalization and truncation keep protected character groups intact', () => {
  const f = authored([edge('The ﬃ and e\u0301 markers', 'alarm')]);
  f.submission.delivered[0].normalize = true;
  const rendered = materializeUnit(f.submission.delivered[0]).text;
  // Explicit delivered-byte quotations, with source-group provenance preserved.
  f.submission.answer.reason.support = [citation(0, rendered.slice(0, -1))];
  assert.equal(run(f).scores.R, 1);
  const at = rendered.indexOf('ffi');
  f.submission.answer.reason.support = [citation(0, rendered.slice(0, at + 1)), citation(0, rendered.slice(at + 3, -1))];
  assert.equal(run(f).scores.R, 0);
  const t = authored([edge()]), size = t.gold.supportSpans[0].text.length;
  t.submission.delivered[0].truncate = size - 1;
  select(t, 0, [[0, size - 1]]); assert.equal(run(t).scores.R, 1);
  t.submission.delivered[0].truncate = size - 2;
  select(t, 0, [[0, size - 2]]); assert.equal(run(t).scores.R, 0);
});
test('invalid addresses, altered quotes, and absent occurrences cannot enter authenticated coverage', () => {
  for (const edit of [c => c.item = 99, c => c.unit = 'body', c => c.source = 1, c => c.occurrence = 2, c => c.quote += ',']) {
    const f = authored([edge()]); select(f, 0, [[0, f.gold.supportSpans[0].text.length - 1]]);
    edit(f.submission.answer.reason.support[0]);
    assert.deepEqual(run(f).scores, { C: 1, O: 1, R: 0, J: 0 });
  }
});
test('missing authority or handle protects the whole span; no fallback to declarations', () => {
  const f = authored([edge()]);
  for (const authentication of [{}, { family: f.input.family, authority: {} }, { family: { ...f.input.family, family_id: 'absent' }, authority: f.input.authority }]) {
    f.gold.supportTrivia = adapt(f.input, f.input.registry, authentication);
    noLicense(f.gold.supportTrivia);
    select(f, 0, [[0, f.gold.supportSpans[0].text.length - 1]]); assert.equal(rejectedThenProtected(f).scores.R, 0);
  }
  f.gold.supportTrivia = adaptGeneratorTrivia(f.input.registry, rulesBytes, f.input.turns); // obsolete three-argument API
  noLicense(f.gold.supportTrivia); assert.equal(rejectedThenProtected(f).scores.R, 0);
});
test('forged handles/digests and mutable candidate changes cannot replace the independent freeze pin', () => {
  const f = authored([edge()]);
  const changedFreeze = copy(f.input.freeze);
  changedFreeze.optional_trivia.family_handles[f.input.family.family_id].registry_sha256 = '0'.repeat(64);
  const bytes = Buffer.from(JSON.stringify(changedFreeze));
  assert.throws(() => createTriviaAuthority(bytes, f.input.pin), /pin mismatch/);
  assert.throws(() => createTriviaAuthority(f.input.freezeBytes, '0'.repeat(64)), /pin mismatch/);
  assert.throws(() => createTriviaAuthority(f.input.freezeBytes), /pin mismatch/);
  const handles = changedFreeze.optional_trivia.family_handles;
  changedFreeze.optional_trivia.family_handles_sha256 = sha(stable(handles));
  const poisoned = Buffer.from(JSON.stringify(changedFreeze));
  assert.throws(() => createTriviaAuthority(poisoned, f.input.pin), /pin mismatch/);
  // Even a trusted configuration containing a wrong family handle cannot
  // authenticate the candidate; the generator compares every bound digest.
  const wrongHandleAuthority = createTriviaAuthority(poisoned, sha(poisoned));
  const failed = adapt(f.input, f.input.registry, { family: f.input.family, authority: wrongHandleAuthority, caseId: f.input.caseId, question: f.input.question });
  noLicense(failed);
  f.gold.supportTrivia = failed;
  select(f, 0, [[0, f.gold.supportSpans[0].text.length - 1]]);
  assert.equal(rejectedThenProtected(f).scores.R, 0);
  const bad = copy(f.input.registry); bad.rules_sha256 = '0'.repeat(64);
  noLicense(adapt(f.input, bad));
  noLicense(adapt(f.input, f.input.registry, undefined, Buffer.concat([rulesBytes, Buffer.from(' ')])));
  for (const edit of [family => family.seed += '-other', family => family.namespace.owner = 'other', family => family.batches[0].turns[0].text += ' ']) {
    const family = copy(f.input.family); edit(family);
    noLicense(adapt(f.input, f.input.registry, { family, authority: f.input.authority, caseId: f.input.caseId, question: f.input.question }));
  }
});
test('serialized/cloned/manual normalized licenses and producer hashes are never proof', () => {
  const f = authored([edge()]);
  const original = f.gold.supportTrivia;
  assert(Object.isFrozen(original)); assert(Object.isFrozen(original.positions));
  assert.throws(() => { original.positions[0].position = 1; }, TypeError);
  for (const untrusted of [copy(original), JSON.parse(JSON.stringify(original)), {
    version: TRIVIA_VERSION, producer: original.producer,
    rules: [{ id: 'fake', production: 'edge', language: 'en', literal: '.', optional_offsets: [0] }],
    positions: [{ origin: 'engineering-source', position: 7, char: '.', rule: 'fake', literal_offset: 0 }],
  }]) noLicense(untrusted);
  // The verifier's detached result survives mutation of the original candidate.
  f.input.registry.origins[0].positions = [0];
  f.input.family.batches[0].turns[0].text = 'changed';
  select(f, 0, [[0, f.gold.supportSpans[0].text.length - 1]]); assert.equal(run(f).scores.R, 1);
});

function forgedBoundaries(input, language) {
  const candidate = copy(input.registry), origin = candidate.origins[0], content = input.turns[0].text;
  const decimal = content.indexOf('.'), end = content.length;
  // False edge ending at an interpolated decimal, followed by false fact. These
  // declarations formerly passed the scorer's offset/separator-role checks.
  origin.positions = [decimal, end - 1];
  origin.segments = [
    { production: 'edge', language: 'en', start: 0, end: decimal + 1, parts: [
      { kind: 'literal', literal_index: 0, start: 0, end: 0 },
      { kind: 'interpolated', name: 'fromFact', start: 0, end: decimal },
      { kind: 'literal', literal_index: 1, start: decimal, end: decimal },
      { kind: 'interpolated', name: 'toFact', start: decimal, end: decimal },
      { kind: 'literal', literal_index: 2, start: decimal, end: decimal + 1 }] },
    { production: 'fact', language, start: decimal + 1, end, parts: [
      { kind: 'literal', literal_index: 0, start: decimal + 1, end: decimal + 1 },
      { kind: 'interpolated', name: 'fact', start: decimal + 1, end: end - 1 },
      { kind: 'literal', literal_index: 1, start: end - 1, end }] },
  ];
  return candidate;
}
test('review P1-1: forged English/Chinese edge/fact boundaries grant no decimal license', () => {
  for (const language of ['en', 'zh']) {
    const f = authored([edge(language === 'en' ? 'Gauge 1.5' : '儀表1.5', language === 'en' ? 'alarm' : '警報', language)]);
    const decimal = f.input.turns[0].text.indexOf('.');
    select(f, 0, [[0, decimal], [decimal + 1, f.gold.supportSpans[0].text.length - 1]]);
    assert.equal(run(f).scores.R, 0); // genuine provenance
    const forged = forgedBoundaries(f.input, language);
    f.gold.supportTrivia = adapt(f.input, forged);
    noLicense(f.gold.supportTrivia);
    const denied = rejectedThenProtected(f);
    assert.deepEqual(denied.scores, { C: 1, O: 1, R: 0, J: 0 });
    assert.equal(denied.referrals.length, 0);
  }
});
test('review P1-2: a valid alternative parse of identical English/Chinese text is not its original emission', () => {
  for (const language of ['en', 'zh']) {
    const en = language === 'en';
    const f = authored([edge(en ? 'A' : '甲', en ? 'B. C caused D.' : '乙。 因為丙，所以造成丁。', language)]);
    const alternative = authored([edge(en ? 'A' : '甲', en ? 'B' : '乙', language), { production: 'source_join', language }, edge(en ? 'C' : '丙', en ? 'D.' : '丁。', language)]);
    assert.equal(f.input.turns[0].text, alternative.input.turns[0].text);
    const first = alternative.input.registry.origins[0].segments[0].end;
    select(f, 0, [[0, first - 1], [first + 1, f.gold.supportSpans[0].text.length]]);
    assert.equal(run(f).scores.R, 0);
    f.gold.supportTrivia = adapt(f.input, alternative.input.registry);
    noLicense(f.gold.supportTrivia); assert.equal(rejectedThenProtected(f).scores.R, 0);
  }
});
test('literal/template/variable substitution and recomputed candidate hashes grant no license', () => {
  const f = authored([edge()]);
  for (const edit of [
    r => r.emission_inputs[0].template = r.emission_inputs[0].template.replace(' caused ', ' changed '),
    r => r.emission_inputs[0].variables.fromFact = 'Different cause',
    r => r.origins[0].segments[0].parts[0].end = 1,
    r => r.origins[0].positions = [],
  ]) {
    const candidate = copy(f.input.registry); edit(candidate);
    noLicense(adapt(f.input, candidate));
    // A self-declared digest is not the handle looked up in the pinned freeze.
    candidate.registry_sha256 = sha(JSON.stringify(candidate));
    noLicense(adapt(f.input, candidate));
  }
});
test('source mismatch cannot apply a verified family license to another span', () => {
  const f = authored([edge()]), s = f.gold.supportSpans[0];
  for (const altered of [{ ...s, origin: 'other-family' }, { ...s, text: s.text.replace('Ice', 'Fog') }]) {
    noLicense(f.gold.supportTrivia, new Map([[altered.id, altered]]), f.scoringOptions.triviaCase, f.gold.question);
  }
});
test('proofs stay out of judge bundles and affect support dependence keys', () => {
  const f = authored([edge()]);
  f.submission.delivered[0].segments.push({ origin: 'unknown', start: 0, text: ' Maybe.' });
  select(f, 0, [[0, f.gold.supportSpans[0].text.length]]);
  const authenticated = run(f).referrals.find(r => r.pass === 'support');
  assert(authenticated); assert(!JSON.stringify(authenticated).includes('family_handles'));
  assert(!JSON.stringify(correctnessGold(f.gold)).includes('producer'));
  f.gold.supportTrivia = copy(f.gold.supportTrivia);
  // The original answer and delivery are identical in both proof contexts.
  const untrusted = rejectedThenProtected(f).referrals.find(r => r.pass === 'support');
  assert(untrusted); assert.notEqual(authenticated.key, untrusted.key);
  assert.deepEqual(authenticated.answer, untrusted.answer);
  assert.deepEqual(authenticated.delivered, untrusted.delivered);
});
test('optional punctuation cannot license changed content; wholly optional spans still score zero', () => {
  const f = authored([edge()]), s = f.gold.supportSpans[0];
  const optional = compileTrivia(f.gold.supportTrivia, new Map([[s.id, s]]), f.scoringOptions.triviaCase, f.gold.question);
  assert(covers(s, [{ origin: s.origin, start: s.start, end: s.end - 1, text: s.text.slice(0, -1) }], optional));
  assert(!covers(s, [{ origin: s.origin, start: s.start, end: s.end, text: s.text.slice(0, -1) + ',' }], optional));
  assert(!covers({ origin: s.origin, start: s.end - 1, end: s.end, text: '.' }, [], optional));
});
