// Test-author configuration for independent, deliberately unlicensed worlds.
// Only tests mint these tiny frozen catalogs. Production must use the primary's
// already reviewed bytes and independent pin, never sign candidate gold.
import { createHash } from 'node:crypto';
import { stable } from '../canonical.mjs';
import { UNLICENSED_AUTHORITY_VERSION, createUnlicensedTriviaAuthority, createUnlicensedTriviaCase } from '../support.mjs';
import { score } from '../scorer.mjs';
export const digest = value => createHash('sha256').update(value).digest('hex');
export function unlicensedFixture(gold, target = { id: 'scorer-independent-source', question: gold.question, gold: structuredClone(gold) }) {
  const sourceSHA256 = digest(stable(target));
  const record = { family: target.id, caseId: target.id + '/source/' + sourceSHA256, question: target.question,
    sourceSHA256, goldSHA256: digest(stable(gold)), trivia: 'none' };
  const catalog = { version: UNLICENSED_AUTHORITY_VERSION, cases: [record] };
  const bytes = Buffer.from(JSON.stringify(catalog)), pin = digest(bytes);
  const authority = createUnlicensedTriviaAuthority(bytes, pin);
  const scoringOptions = { unlicensedCase: createUnlicensedTriviaCase({ authority, target, gold }) };
  return { target, record, catalog, bytes, pin, authority, scoringOptions, binding: { mode: 'unlicensed', target } };
}
export function scoreUnlicensed(gold, submission, options = {}) {
  // Each test-author gold revision is a fresh expected target, rather than
  // retargeting a previously issued capability for the same object.
  const snapshot = structuredClone(gold);
  return score(snapshot, submission, { ...unlicensedFixture(snapshot).scoringOptions, ...options });
}
