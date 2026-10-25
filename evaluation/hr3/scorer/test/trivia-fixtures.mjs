// Independently authored, freeze-pinned engineering emissions, never pilot data.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { stable } from '../canonical.mjs';
import { createTriviaAuthority, createTriviaCase, adaptGeneratorTrivia, compileTrivia, TRIVIA_VERSION as SCORER_TRIVIA_VERSION } from '../support.mjs';
import { score } from '../scorer.mjs';
import { captureEmission, appendSource, triviaRegistry, createFamilyTriviaHandle, TRIVIA_VERSION, TRIVIA_AUTH_VERSION, TRIVIA_RULES_SHA256 } from '../../generator/trivia.mjs';
import { fixture, claim, text, citation } from './fixtures.mjs';
import { scoreUnlicensed } from './unlicensed-fixtures.mjs';

export const sha = value => createHash('sha256').update(value).digest('hex');
export const rulesBytes = readFileSync(new URL('../../generator/trivia-rules.json', import.meta.url));
export function authored(emissions, spans, identity = {}) {
  const origins = new Map(), turns = new Map(), tape = [];
  for (const emission of emissions) {
    const { turn = 'engineering-source', production = 'edge', language = 'en', variables = {} } = emission;
    if (!turns.has(turn)) { turns.set(turn, { turn_id: turn, text: '' }); origins.set(turn, { turn_id: turn, positions: [], segments: [] }); }
    const lang = language === 'zh' ? 'zh-Hant' : 'en';
    // Capture original inputs before emission. Never infer them from a parse.
    tape.push(captureEmission(turn, production, lang, variables));
    appendSource(turns.get(turn), origins.get(turn), production, lang, variables);
  }
  const registry = triviaRegistry(origins, tape);
  const family = { family_id: identity.familyId ?? 'engineering-auth-family', lineage_id: 'engineering-auth-lineage', seed: 'engineering-auth-seed',
    namespace: { owner: 'engineering', scope: 'private' }, batches: [{ turns: [...turns.values()] }] };
  const handle = createFamilyTriviaHandle(family, registry, tape);
  const handles = { [family.family_id]: handle };
  const freeze = { optional_trivia: { version: TRIVIA_VERSION, authentication_version: TRIVIA_AUTH_VERSION, rules_sha256: TRIVIA_RULES_SHA256,
    family_handles: handles, family_handles_sha256: sha(stable(handles)) } };
  const freezeBytes = Buffer.from(JSON.stringify(freeze));
  const pin = sha(freezeBytes), authority = createTriviaAuthority(freezeBytes, pin);
  const f = fixture();
  if (identity.question !== undefined) f.gold.question = identity.question;
  const caseId = identity.caseId ?? 'engineering-checkpoint';
  const question = f.gold.question;
  const input = { registry, family, turns: [...turns.values()], handle, freeze, freezeBytes, pin, authority, caseId, question };
  const scoringOptions = { triviaCase: createTriviaCase({ family, authority, caseId, question }) };
  f.gold.supportTrivia = adapt(input);
  f.gold.supportSpans = (spans ?? [...turns.values()].map(t => ({ origin: t.turn_id, start: 0, end: t.text.length }))).map((s, i) => ({
    id: `engineering-clause-${i}`, ...s, text: turns.get(s.origin).text.slice(s.start, s.end),
  }));
  f.gold.reason.nodes = Array.from({ length: f.gold.supportSpans.length + 1 }, (_, i) => ({ id: `v${i}`, claim: claim(text(`engineering proposition ${i}`)) }));
  f.gold.reason.acceptedGraphs = [{ edges: f.gold.supportSpans.map((s, i) => ({ from: `v${i}`, to: `v${i + 1}`, support: [[s.id]] })) }];
  f.submission.delivered = f.gold.supportSpans.map((s, item) => ({ intent: 'current', item, unit: 'receipt', source: 0, aliases: [],
    segments: [{ origin: s.origin, start: s.start, text: s.text }], normalize: false, truncate: null }));
  f.submission.answer.reason.support = f.gold.supportSpans.map((s, item) => citation(item, s.text));
  return { ...f, input, scoringOptions };
}
export function adapt(input, registry = input.registry, authentication = { family: input.family, authority: input.authority, caseId: input.caseId, question: input.question }, bytes = rulesBytes, turns = input.turns) {
  return adaptGeneratorTrivia(registry, bytes, turns, authentication);
}
export const edge = (fromFact = 'Ice', toFact = 'the cobalt handoff', language = 'en') => ({ language, production: 'edge', variables: { fromFact, toFact } });
export function select(f, item, intervals) {
  const unit = f.submission.delivered[item];
  // Tests call this after materialization/truncation decisions, exactly as a
  // reader selecting the rendered bytes. No punctuation repair is performed.
  const content = unit.segments.map(s => s.text).join('');
  f.submission.answer.reason.support = f.submission.answer.reason.support.filter(c => c.item !== item);
  for (const [start, end] of intervals) {
    if (end <= start) continue;
    const quote = content.slice(start, end);
    let at = -1, occurrence = 0;
    do { at = content.indexOf(quote, at + 1); occurrence++; } while (at >= 0 && at < start);
    if (at !== start) throw new Error('Invalid test selection');
    f.submission.answer.reason.support.push(citation(item, quote, { occurrence }));
  }
}
export function omit(f, item, omitted) {
  const content = f.submission.delivered[item].segments.map(s => s.text).join('');
  const start = content.indexOf(omitted);
  if (start < 0) throw new Error(`Missing test omission: ${omitted}`);
  select(f, item, [[0, start], [start + omitted.length, content.length]]);
}

// Retain the exact historical bad-proof/answer cases and protected-content
// assertions. The public API must first reject the ORIGINAL gold. Only this
// test's explicit, separate no-trivia copy exercises the old protected scoring
// arithmetic; there is no production fallback or error-to-zero conversion.
export function rejectedThenProtected(f, options = f.scoringOptions) {
  assert.throws(() => score(f.gold, f.submission, options), { code: 'ERR_HR3_TRIVIA_BINDING' });
  const coverage = compileTrivia(f.gold.supportTrivia, new Map(f.gold.supportSpans.map(s => [s.id, s])), options?.triviaCase, f.gold.question);
  assert.equal(coverage.authentication.status, 'protected');
  for (const span of f.gold.supportSpans) for (let i = 0; i < span.text.length; i++) assert.equal(coverage(span.origin, span.start + i, span.text[i]), false);
  const gold = { ...f.gold, supportTrivia: { version: SCORER_TRIVIA_VERSION, producer: null, rules: [], positions: [] } };
  const { triviaCase, ...unlicensedOptions } = options ?? {};
  return scoreUnlicensed(gold, f.submission, unlicensedOptions);
}
