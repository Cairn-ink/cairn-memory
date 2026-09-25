import { createHash } from 'node:crypto';

export const FRESH_SMOKE_VERSION = 'cairn-fresh-reliability-smoke-v1';
export const FRESH_SMOKE_PREFIX = 'cairn-s1-fresh-smoke-2026-09-25:';
export const FRESH_SMOKE_TYPES = Object.freeze([
  'single-session-user', 'single-session-assistant', 'single-session-preference',
  'temporal-reasoning', 'knowledge-update', 'multi-session',
]);

export class ReliabilitySmokeError extends Error {
  constructor(code) { super(code); this.name = 'ReliabilitySmokeError'; this.code = code; }
}
export const failSmoke = (code) => { throw new ReliabilitySmokeError(code); };
export const smokeSha256 = (value) => createHash('sha256').update(value).digest('hex');

const byteCompare = (left, right) => Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'));

// Only question ID and type affect admission or ranking. Source array order is
// used solely to put the selected membership back in prepared dataset order.
export function selectFreshSmoke(source, exclusions) {
  if (!Array.isArray(source) || source.length !== 500 || !Array.isArray(exclusions)
    || exclusions.length !== 82 || new Set(exclusions).size !== 82
    || exclusions.some((id) => typeof id !== 'string' || id.length === 0)) failSmoke('invalid_roster');
  const types = new Set(FRESH_SMOKE_TYPES);
  const seen = new Set();
  const identities = source.map((entry) => {
    const id = entry?.question_id;
    const type = entry?.question_type;
    if (typeof id !== 'string' || id.length === 0 || !types.has(type) || seen.has(id)) {
      failSmoke('invalid_source');
    }
    seen.add(id);
    return { id, type };
  });
  if (exclusions.some((id) => !seen.has(id))) failSmoke('invalid_roster');
  const excluded = new Set(exclusions);
  const selectedByType = FRESH_SMOKE_TYPES.map((type) => {
    const ranked = identities.filter((item) => item.type === type && !excluded.has(item.id))
      .map((item) => ({ id: item.id, rank: smokeSha256(`${FRESH_SMOKE_PREFIX}${item.id}`) }))
      .sort((a, b) => byteCompare(a.rank, b.rank) || byteCompare(a.id, b.id));
    if (ranked.length === 0) failSmoke('insufficient_type');
    return { type, sourceQuestionId: ranked[0].id };
  });
  const membership = new Set(selectedByType.map((item) => item.sourceQuestionId));
  if (membership.size !== 6) failSmoke('invalid_selection');
  const sourceQuestionIdsPreparedOrder = identities.filter((item) => membership.has(item.id))
    .map((item) => item.id);
  return Object.freeze({ version: FRESH_SMOKE_VERSION, selectedByType,
    sourceQuestionIdsPreparedOrder,
    membershipSha256: smokeSha256(JSON.stringify([...membership].sort(byteCompare))),
    preparedOrderSha256: smokeSha256(JSON.stringify(sourceQuestionIdsPreparedOrder)) });
}
