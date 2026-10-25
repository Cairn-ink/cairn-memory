// Restored one-to-one from the 22 pre-P1 trivia tests. The literal failure
// inputs are retained. Unauthenticated custom separator declarations no longer
// grant scoring credit; their coverage arithmetic is tested separately from
// authentication. Invalid proof inputs must first be rejected; a separate,
// explicit no-trivia copy preserves the protected-content scoring assertions.
import test from 'node:test';
import assert from 'node:assert/strict';
import { score, validateGold, correctnessGold, KEY_VERSION } from '../scorer.mjs';
import { SUPPORT_VERSION, TRIVIA_VERSION, compileTrivia, adaptGeneratorTrivia, GENERATOR_TRIVIA_VERSION } from '../support.mjs';
import { validateTriviaRules, TRIVIA_RULES_SHA256 } from '../../generator/trivia.mjs';
import { covers, coveredSpans, deliveredIndex, resolveCitation, materializeUnit } from '../citations.mjs';
import { fixture, claim, text, citation, copy } from './fixtures.mjs';
import { authored, adapt, edge, select, omit, rulesBytes, sha, rejectedThenProtected } from './trivia-fixtures.mjs';
const run = f => score(f.gold, f.submission, f.scoringOptions);
const single = (from = 'Ice', to = 'the cobalt handoff', language = 'en') => authored([edge(from, to, language)]);
const optional = f => compileTrivia(f.gold.supportTrivia, new Map(f.gold.supportSpans.map(s => [s.id, s])), f.scoringOptions?.triviaCase, f.gold.question);
const assertProtected = registry => {
  const predicate = compileTrivia(registry, new Map());
  assert.equal(predicate.authentication.status, 'protected');
  assert.equal(predicate('bridge-source', 7, '.'), false);
};

// Exact old independent productions, with their old source offset and literals.
// This deliberately has no generator authority and must never grant R licenses.
const literals = {
  stop: { literal: '.', optional_offsets: [0] },
  comma: { literal: ', ', optional_offsets: [0, 1] },
  zhStop: { literal: '。', optional_offsets: [0] },
  zhComma: { literal: '，', optional_offsets: [0] },
  spaces: { literal: ' \n ', optional_offsets: [0, 1, 2] },
};
const separator = name => ({ separator: name });
function declared(parts) {
  const f = fixture(), origin = 'engineering-source-0', start = 19;
  let content = '';
  const positions = [];
  for (const part of parts) {
    if (typeof part === 'string') { content += part; continue; }
    const rule = literals[part.separator];
    for (const offset of rule.optional_offsets) positions.push({ origin, position: start + content.length + offset, char: rule.literal[offset], rule: part.separator, literal_offset: offset });
    content += rule.literal;
  }
  f.gold.supportTrivia = { version: TRIVIA_VERSION, producer: null,
    rules: Object.entries(literals).map(([id, spec]) => ({ id, production: `engineering.${id}`, language: id.startsWith('zh') ? 'zh-Hant' : 'en', ...spec })), positions };
  f.gold.supportSpans = [{ id: 'clause-0', origin, start, end: start + content.length, text: content }];
  f.gold.reason.nodes = ['v0', 'v1'].map(id => ({ id, claim: claim(text(id)) }));
  f.gold.reason.acceptedGraphs = [{ edges: [{ from: 'v0', to: 'v1', support: [['clause-0']] }] }];
  f.submission.delivered = [{ intent: 'current', item: 0, unit: 'receipt', source: 0, aliases: [], segments: [{ origin, start, text: content }], normalize: false, truncate: null }];
  f.submission.answer.reason.support = [citation(0, content)];
  // Test-only arithmetic oracle for explicitly authored offsets. This predicate
  // is never passed to score() or treated as an authentication proof.
  f.arithmeticTrivia = (o, p, c) => positions.some(x => x.origin === o && x.position === p && x.char === c);
  return f;
}
function selectedRanges(f) {
  const delivery = deliveredIndex(f.submission.delivered);
  return coveredSpans(f.submission.answer.reason.support.map(c => resolveCitation(c, delivery)));
}
function serial() {
  return authored([
    { ...edge('Ice', 'queueing'), turn: 'serial-first' },
    { ...edge('Queueing', 'the cobalt handoff'), turn: 'serial-second' },
  ]);
}
function bridge(language) {
  return authored([{ ...edge(language === 'en' ? 'Frost 6.25' : '潮汐6.25', language === 'en' ? 'gx.delta handoff' : 'gx.delta轉運', language), turn: 'bridge-source' }]);
}

test('A-6 schema/key versions are explicit; missing/stale private licenses fail closed', () => {
  const f = single(), out = run(f);
  assert.equal(out.supportVersion, SUPPORT_VERSION);
  assert.equal(out.keyVersion, KEY_VERSION);
  assert(KEY_VERSION.includes('a6'));
  delete f.gold.supportVersion;
  assert.throws(() => validateGold(f.gold), /Invalid gold/);
  f.gold.supportVersion = SUPPORT_VERSION;
  f.gold.supportTrivia = { ...f.gold.supportTrivia, version: 'old-trivia' };
  assert.throws(() => validateGold(f.gold), /Invalid gold/);
});
test('positive/negative pair: punctuation omission passes, missing causal words fails', () => {
  const f = single();
  assert.equal(f.gold.supportSpans[0].text, 'Ice caused the cobalt handoff.');
  omit(f, 0, '.'); assert.deepEqual(run(f).scores, { C: 1, O: 1, R: 1, J: 1 });
  omit(f, 0, 'caused'); assert.deepEqual(run(f).scores, { C: 1, O: 1, R: 0, J: 0 });
  assert.equal(run(f).reason.error, 'incomplete_required_support');
});
test('interior literal comma/whitespace omission uses source-position unions, not string deletion', () => {
  const f = declared(['Ice', separator('comma'), 'together with berth closure caused queueing', separator('stop')]);
  assert.equal(f.gold.supportSpans[0].text, 'Ice, together with berth closure caused queueing.');
  omit(f, 0, ', ');
  assert(covers(f.gold.supportSpans[0], selectedRanges(f), f.arithmeticTrivia));
  assert.equal(rejectedThenProtected(f).scores.R, 0); // the old declaration-only R=1 is now forbidden
  f.submission.answer.reason.support = [citation(0, 'Icetogether with berth closure caused queueing.')];
  assert.equal(rejectedThenProtected(f).scores.R, 0);
  assert.equal(rejectedThenProtected(f).reason.error, 'missing_or_invalid_submitted_citation');
});
test('conjunction language stays protected while separators can be omitted', () => {
  for (const protectedText of ['and', 'together', 'only when both']) {
    const f = single('Ice and berth closure together', 'queueing only when both conditions held');
    assert.equal(f.gold.supportSpans[0].text, 'Ice and berth closure together caused queueing only when both conditions held.');
    omit(f, 0, '.'); assert.equal(run(f).scores.R, 1);
    omit(f, 0, protectedText); assert.equal(run(f).scores.R, 0);
  }
});
test('every serial intermediate and required edge survives punctuation coverage', () => {
  const f = serial();
  assert.deepEqual(f.gold.supportSpans.map(s => s.text), ['Ice caused queueing.', 'Queueing caused the cobalt handoff.']);
  omit(f, 0, '.'); omit(f, 1, '.'); assert.equal(run(f).scores.R, 1);
  select(f, 1, []); assert.equal(run(f).scores.R, 0);
  omit(f, 1, '.'); omit(f, 0, 'queueing'); assert.equal(run(f).scores.R, 0);
});
test('OR-of-AND graph/support alternatives retain complete requirements', () => {
  const f = serial(), [a, b] = f.gold.supportSpans;
  f.gold.reason.acceptedGraphs[0].edges = [{ from: 'v0', to: 'v2', support: [[a.id, b.id]] }];
  omit(f, 0, '.'); omit(f, 1, '.'); assert.equal(run(f).scores.R, 1);
  select(f, 1, []); assert.equal(run(f).scores.R, 0);
  f.gold.reason.acceptedGraphs[0].edges[0].support.push([a.id]);
  assert.equal(run(f).scores.R, 1);
});
test('focal-change association cannot be omitted, and a different change never auto-passes', () => {
  const f = single();
  omit(f, 0, '.'); assert.equal(run(f).scores.R, 1);
  omit(f, 0, 'cobalt'); assert.equal(run(f).scores.R, 0);
  const wrong = single();
  wrong.submission.delivered[0].segments[0].text = 'Ice caused the amber handoff.';
  select(wrong, 0, [[0, 'Ice caused the amber handoff'.length]]);
  assert.equal(run(wrong).scores.R, null);
  assert(run(wrong).referrals.some(r => r.pass === 'support'));
});
test('extra clauses and even punctuation outside licensed support remain referrals', () => {
  for (const suffix of [' Dust caused a separate handoff.', '.', '，', ' ']) {
    const f = single();
    f.submission.delivered[0].segments.push({ origin: 'unlicensed-context', start: 0, text: suffix });
    select(f, 0, [[0, materializeUnit(f.submission.delivered[0]).text.length]]);
    assert.equal(run(f).scores.R, null);
    assert(run(f).referrals.some(r => r.pass === 'support'));
  }
});
test('an extra punctuation-only citation cannot be discarded even with a provenance rule elsewhere', () => {
  const f = single(); omit(f, 0, '.');
  f.submission.delivered.push({ intent: 'current', item: 1, unit: 'receipt', source: 0, aliases: [], segments: [{ origin: 'other-source', start: 0, text: '.' }], normalize: false, truncate: null });
  f.submission.answer.reason.support.push(citation(1, '.'));
  assert.equal(run(f).scores.R, null);
  const untrusted = copy(f.gold.supportTrivia);
  untrusted.positions.push({ origin: 'other-source', position: 0, char: '.', rule: untrusted.rules[0].id, literal_offset: 0 });
  f.gold.supportTrivia = untrusted;
  select(f, 0, [[0, f.gold.supportSpans[0].text.length]]);
  assert.equal(rejectedThenProtected(f).scores.R, null); // never discard the extra citation
});
test('positive/negative pairs protect decimal points, dotted identifiers and operators', () => {
  for (const [from, protectedText] of [
    ['A load of 7.25', '.'], ['Record gx.delta', '.'], ['The bound x <= -4', '<'],
    ['The bound x <= -4', '='], ['The bound x <= -4', '-'], ['The link p → q', '→'], ['A 7/8 ratio', '/'],
  ]) {
    const f = single(from);
    assert.equal(f.gold.supportSpans[0].text, `${from} caused the cobalt handoff.`);
    select(f, 0, [[0, f.gold.supportSpans[0].text.length - 1]]); assert.equal(run(f).scores.R, 1);
    omit(f, 0, protectedText); assert.equal(run(f).scores.R, 0, from);
  }
});
test('question/exclamation/quotation/apostrophe/hyphen/parenthesis punctuation is protected', () => {
  for (const protectedText of ['?', '!', '“', '”', "'", '-', '(', ')', '+', ':']) {
    const f = single(`The token zx${protectedText}v`);
    assert.equal(f.gold.supportSpans[0].text, `The token zx${protectedText}v caused the cobalt handoff.`);
    select(f, 0, [[0, f.gold.supportSpans[0].text.length - 1]]); assert.equal(run(f).scores.R, 1);
    omit(f, 0, protectedText); assert.equal(run(f).scores.R, 0);
  }
});
test('whitespace is optional only when predeclared as a template separator', () => {
  const f = declared([separator('spaces'), 'Ice caused the cobalt handoff', separator('stop'), separator('spaces')]);
  assert.equal(f.gold.supportSpans[0].text, ' \n Ice caused the cobalt handoff. \n ');
  f.submission.delivered[0].normalize = true;
  f.submission.answer.reason.support = [citation(0, 'Ice caused the cobalt handoff')];
  assert(covers(f.gold.supportSpans[0], selectedRanges(f), f.arithmeticTrivia));
  assert.equal(rejectedThenProtected(f).scores.R, 0); // declaration alone is no longer sufficient
  f.gold.supportTrivia.positions = [];
  assert.equal(rejectedThenProtected(f).scores.R, 0); // exact old negative input, no implicit edge trim
});
test('Unicode source maps preserve protected words, values, and indivisible normalization groups', () => {
  const zh = declared(['潮汐延誤', separator('zhComma'), '造成青銅轉運', separator('zhStop')]);
  assert.equal(zh.gold.supportSpans[0].text, '潮汐延誤，造成青銅轉運。');
  omit(zh, 0, '，'); assert(covers(zh.gold.supportSpans[0], selectedRanges(zh), zh.arithmeticTrivia));
  assert.equal(rejectedThenProtected(zh).scores.R, 0); // no unverified custom Chinese separator license
  omit(zh, 0, '造成'); assert.equal(rejectedThenProtected(zh).scores.R, 0);
  const nfkc = single('The ﬃ ligature and e\u0301 marker');
  assert.equal(nfkc.gold.supportSpans[0].text, 'The ﬃ ligature and e\u0301 marker caused the cobalt handoff.');
  nfkc.submission.delivered[0].normalize = true;
  const rendered = materializeUnit(nfkc.submission.delivered[0]).text;
  nfkc.submission.answer.reason.support = [citation(0, rendered.slice(0, -1))]; assert.equal(run(nfkc).scores.R, 1);
  const offset = rendered.indexOf('ffi');
  nfkc.submission.answer.reason.support = [citation(0, rendered.slice(0, offset + 1)), citation(0, rendered.slice(offset + 3, -1))];
  assert.equal(run(nfkc).scores.R, 0);
  const fullwidth = single('Record zx．v'); fullwidth.submission.delivered[0].normalize = true;
  fullwidth.submission.answer.reason.support = [citation(0, 'Record zx'), citation(0, 'v caused the cobalt handoff.')];
  assert.equal(run(fullwidth).scores.R, 0);
});
test('truncation may omit a licensed final separator, never a protected character or half a surrogate', () => {
  const f = single(), length = f.gold.supportSpans[0].text.length;
  f.submission.delivered[0].truncate = length - 1;
  select(f, 0, [[0, length - 1]]); assert.equal(run(f).scores.R, 1);
  f.submission.delivered[0].truncate = length - 2;
  select(f, 0, [[0, length - 2]]); assert.equal(run(f).scores.R, 0);
  const emoji = single('Ice', 'the cobalt handoff 😀'), eLength = emoji.gold.supportSpans[0].text.length;
  assert.equal(emoji.gold.supportSpans[0].text, 'Ice caused the cobalt handoff 😀.');
  emoji.submission.delivered[0].truncate = eLength - 2;
  select(emoji, 0, [[0, eLength - 2]]); assert.equal(run(emoji).scores.R, 0);
});
test('complete protected-word coverage never bypasses unknown delivered context', () => {
  const f = single();
  f.submission.delivered[0].segments.push({ origin: 'unfamiliar-source', start: 0, text: ' This was merely a guess.' });
  select(f, 0, [[0, f.gold.supportSpans[0].text.length - 1]]);
  const out = run(f);
  assert.equal(out.reason.correctness, 1); assert.equal(out.scores.R, null);
  assert.equal(out.reason.error, 'unrecognized_evidence_context');
  assert.deepEqual(out.referrals.map(r => r.pass), ['support']);
});
test('invalid addresses/altered quotes/absent occurrences cannot enter trivia coverage', () => {
  for (const edit of [c => c.item = 99, c => c.unit = 'body', c => c.source = 1, c => c.occurrence = 2,
    c => c.quote = 'Ice caused the cobalt handoff,']) {
    const f = single(); omit(f, 0, '.'); edit(f.submission.answer.reason.support[0]);
    assert.deepEqual(run(f).scores, { C: 1, O: 1, R: 0, J: 0 });
  }
});
test('trivia is private: absent from both adjudication bundles; support keys distinguish licensing', () => {
  const f = declared(['Ice caused the cobalt handoff', separator('stop')]);
  f.submission.delivered[0].segments.push({ origin: 'unknown', start: 0, text: ' Unfamiliar context.' });
  // Cite the final punctuation so both untrusted metadata contexts refer. The
  // original declaration-only positive allowance is intentionally unavailable.
  select(f, 0, [[0, f.gold.supportSpans[0].text.length]]);
  const support = rejectedThenProtected(f).referrals.find(r => r.pass === 'support');
  assert(support); assert(!('supportTrivia' in support));
  assert(!JSON.stringify(support).includes('engineering.stop'));
  assert(!JSON.stringify(correctnessGold(f.gold)).includes('optional_offsets'));
  f.gold.supportTrivia.rules[0].production += '.reviewed-v2';
  const second = rejectedThenProtected(f).referrals.find(r => r.pass === 'support');
  // Rejected metadata never produces public dependence keys. The explicit
  // no-trivia copies have equal licensing and therefore share a key.
  assert.equal(support.key, second.key);
  assert.deepEqual(support.answer, second.answer); assert.deepEqual(support.delivered, second.delivered);
  f.submission.answer.reason.support = [citation(0, 'Ice caused the cobalt handoff')];
  assert.equal(rejectedThenProtected(f).scores.R, 0); // mutated declarations grant no license
});
test('bad licenses fail closed, including protected letters, forbidden punctuation, and source substitution', () => {
  for (const edit of [r => r.positions[0].rule = 'missing', r => r.positions[0].position--,
    r => r.positions[0].char = ',', r => r.positions.push(copy(r.positions[0])),
    r => r.rules[0].optional_offsets = [7], r => r.rules[0].literal = '!', r => r.rules[0].literal = 'A']) {
    const f = declared(['Ice caused the cobalt handoff', separator('stop')]); edit(f.gold.supportTrivia);
    // P1 changed rejection from a trusted-declaration exception to zero grants.
    assertProtected(f.gold.supportTrivia);
    omit(f, 0, '.'); assert.equal(rejectedThenProtected(f).scores.R, 0);
  }
});
test('coverage retains exact source content and origin, even at optional positions; empty trivia cannot prove a cause', () => {
  const f = single(), span = f.gold.supportSpans[0], isOptional = optional(f);
  const full = [{ origin: span.origin, start: span.start, end: span.end, text: span.text }];
  assert(covers(span, full, isOptional));
  assert(!covers(span, [{ ...full[0], origin: 'wrong-origin' }], isOptional));
  assert(!covers(span, [{ ...full[0], text: span.text.slice(0, -1) + ',' }], isOptional));
  assert(!covers({ origin: 'empty', start: 0, end: 2, text: ' .' }, [], () => true));
  const r = resolveCitation(citation(0, span.text.slice(0, -1)), deliveredIndex(f.submission.delivered));
  assert(r.ok); assert(covers(span, coveredSpans([r]), isOptional));
});
test('generator private wire adapter checks digest, literals/interpolations and paired coverage', () => {
  for (const language of ['en', 'zh']) {
    const f = bridge(language);
    assert.equal(f.gold.supportSpans[0].text, language === 'en' ? 'Frost 6.25 caused gx.delta handoff.' : '因為潮汐6.25，所以造成gx.delta轉運。');
    select(f, 0, [[0, f.gold.supportSpans[0].text.length - 1]]); assert.equal(run(f).scores.R, 1);
    omit(f, 0, '.'); assert.equal(run(f).scores.R, 0);
    assert.equal(f.gold.supportTrivia.producer.rules_sha256, f.input.registry.rules_sha256);
  }
});
test('generator consumer rejects drift and attempts to mark interpolated dots or add unsupported positions', () => {
  for (const edit of [r => r.rules_sha256 = '0'.repeat(64), r => r.version = 'unknown-version',
    r => r.origins[0].positions[0] = 7, r => r.origins[0].positions.push(2),
    r => r.origins[0].segments[0].parts[3].kind = 'literal',
    r => r.origins[0].segments[0].parts[2].start++, r => r.origins.push(copy(r.origins[0]))]) {
    const f = bridge('en'), candidate = copy(f.input.registry); edit(candidate);
    f.gold.supportTrivia = adapt(f.input, candidate); assertProtected(f.gold.supportTrivia);
    select(f, 0, [[0, f.gold.supportSpans[0].text.length - 1]]); assert.equal(rejectedThenProtected(f).scores.R, 0);
  }
  const f = bridge('en');
  assertProtected(adapt(f.input, f.input.registry, undefined, Buffer.concat([rulesBytes, Buffer.from(' ')])));
  assertProtected(adapt(f.input, f.input.registry, undefined, rulesBytes, []));
  assertProtected(adaptGeneratorTrivia(f.input.registry, rulesBytes, f.input.turns));
});
test('published generator rule declaration is compatible with the independent bilingual wire fixture', () => {
  assert.equal(sha(rulesBytes), TRIVIA_RULES_SHA256);
  assert.equal(validateTriviaRules(), true);
  for (const language of ['en', 'zh']) {
    const f = bridge(language);
    assert.equal(f.input.registry.version, GENERATOR_TRIVIA_VERSION);
    select(f, 0, [[0, f.gold.supportSpans[0].text.length - 1]]); assert.equal(run(f).scores.R, 1);
    omit(f, 0, '6.25'); assert.equal(run(f).scores.R, 0);
  }
});
