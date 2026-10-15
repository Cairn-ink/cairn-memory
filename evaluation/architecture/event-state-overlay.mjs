// Closed evaluation contrast. No rubric, credentials, accounting or top-level run.
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

export const OVERLAY_SOURCE_SHA256 = '2b2e55445e2b9bf6bccfbcbfaee35f61875236e4ba578d3191c5cf60db170a72';
export const OVERLAY_IDS = Object.freeze(['eo-41ba', 'eo-9d20', 'eo-e573', 'eo-263f', 'eo-b8c4', 'eo-70ad']);
export const overlayArmOrder = id => {
  const index = OVERLAY_IDS.indexOf(id);
  if (index < 0) throw new Error('overlay_case');
  return index % 2 ? ['B', 'A'] : ['A', 'B'];
};
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
const text = (value, cap) => typeof value === 'string' && value.length > 0 && value.length <= cap && value.isWellFormed();
export function validateOverlayFixture(value) {
  if (!exact(value, ['version', 'cases']) || value.version !== 'event-state-overlay-v1'
    || !Array.isArray(value.cases) || value.cases.length !== 6
    || Buffer.byteLength(JSON.stringify(value)) > 16000) throw new Error('fixture_shape');
  for (const [index, item] of value.cases.entries()) {
    if (!exact(item, ['id', 'question', 'sessions']) || item.id !== OVERLAY_IDS[index]
      || !text(item.question, 500) || !Array.isArray(item.sessions) || !item.sessions.length || item.sessions.length > 3) {
      throw new Error('fixture_shape');
    }
    for (const session of item.sessions) if (!exact(session, ['phase', 'eventTime', 'messages'])
      || !['target', 'foreign-setup'].includes(session.phase) || !/^2026-\d{2}-\d{2}$/.test(session.eventTime)
      || !Array.isArray(session.messages) || !session.messages.length || session.messages.length > 2
      || session.messages.some(message => !text(message, 600) || !message.includes(session.eventTime))) {
      throw new Error('fixture_shape');
    }
    const expected = index === 4 ? ['foreign-setup', 'target'] : ['target', 'target'];
    if (!isDeepStrictEqual(item.sessions.map(session => session.phase), expected)) throw new Error('fixture_shape');
  }
  return value;
}
export async function loadOverlayFixture() {
  const raw = await readFile(new URL('./fixtures/event-state-overlay-v1.json', import.meta.url));
  if (raw.length > 16000 || createHash('sha256').update(raw).digest('hex') !== OVERLAY_SOURCE_SHA256) {
    throw new Error('fixture_digest');
  }
  return validateOverlayFixture(JSON.parse(raw));
}

// Delete exactly these two fields at their known paths. Linked sources, including
// repetition across roots, remain in place; absence is never an empty edge set.
export function omitRelationshipOverlay(request) {
  const projected = structuredClone(request);
  const input = JSON.parse(projected.messages[1].content);
  if (!Array.isArray(input.evidence) || !input.evidence.length) throw new Error('overlay_projection');
  for (const record of input.evidence) {
    if (!record.rationale || !Object.hasOwn(record.rationale, 'edges') || !Object.hasOwn(record.rationale, 'status')) {
      throw new Error('overlay_projection');
    }
    delete record.rationale.edges;
    delete record.rationale.status;
  }
  projected.messages[1].content = JSON.stringify(input);
  return projected;
}
export function assertOverlayProjection(ordinary, projected) {
  // Independently restore only the treatment fields, then compare every field.
  // Deep equality keeps array ordering/duplication and does not trust inventories.
  try {
    const left = structuredClone(ordinary), right = structuredClone(projected);
    const source = JSON.parse(left.messages[1].content), target = JSON.parse(right.messages[1].content);
    if (!source.evidence.length || source.evidence.length !== target.evidence.length) throw new Error();
    for (const [index, record] of source.evidence.entries()) {
      const rationale = target.evidence[index].rationale;
      if (!Object.hasOwn(record.rationale, 'edges') || !Object.hasOwn(record.rationale, 'status')
        || Object.hasOwn(rationale, 'edges') || Object.hasOwn(rationale, 'status')) throw new Error();
      rationale.edges = structuredClone(record.rationale.edges);
      rationale.status = record.rationale.status;
    }
    if (!isDeepStrictEqual(source, target)) throw new Error();
    left.messages[1].content = ''; right.messages[1].content = '';
    if (!isDeepStrictEqual(left, right)) throw new Error();
  } catch { throw new Error('overlay_projection'); }
}
