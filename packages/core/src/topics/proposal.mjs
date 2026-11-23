import { fail, identifier, revision, validateObject } from '../capture/validate.mjs';
import { boundedText } from '../privacy/text.mjs';

/** @import { PlacementItem, PlacementProposal } from './proposal.mjs' */
/** @import { ClassificationCatalogItem } from './catalog.mjs' */

/** @param {unknown} input @param {number} max @param {number} [min] */
export function uniqueIds(input, max, min = 0) {
  if (!Array.isArray(input) || input.length < min || input.length > max) fail('invalid_input');
  if (Object.keys(input).length !== input.length) fail('invalid_input');
  const result = input.map(identifier);
  if (new Set(result).size !== input.length) fail('invalid_input');
  return result;
}

/** @param {unknown} input @param {readonly string[]} ids */
export function memoryGuards(input, ids) {
  if (!Array.isArray(input) || input.length !== ids.length) fail('invalid_input');
  if (Object.keys(input).length !== input.length) fail('invalid_input');
  const guards = input.map((guard) => {
    const fields = validateObject(guard, ['memoryId', 'revision']);
    return { memoryId: identifier(fields.memoryId), revision: revision(fields.revision) };
  });
  if (new Set(guards.map((guard) => guard.memoryId)).size !== ids.length ||
      guards.some((guard) => !ids.includes(guard.memoryId))) fail('invalid_input');
  return guards;
}

/** @param {unknown} input */
export function placementTitle(input) {
  const clean = boundedText(input, 240);
  if ([...clean].length > 120) fail('invalid_input');
  return clean;
}

/** @param {unknown} input @param {readonly string[]} [requestedIds] @param {number} [limit] */
export function placementProposal(input, requestedIds, limit = 5) {
  const proposal = validateObject(input, ['items']);
  if (!Array.isArray(proposal.items) || proposal.items.length < 1 || proposal.items.length > limit) fail('invalid_input');
  if (Object.keys(proposal.items).length !== proposal.items.length) fail('invalid_input');
  const items = proposal.items.map((item) => {
    const fields = validateObject(item, ['memoryId', 'parentIds', 'newL1']);
    /** @type {PlacementItem} */
    const result = { memoryId: identifier(fields.memoryId), parentIds: uniqueIds(fields.parentIds, 3) };
    if (fields.newL1 !== undefined) {
      const topic = validateObject(fields.newL1, ['title', 'parentL2Ids', 'newL2Title']);
      result.newL1 = { title: placementTitle(topic.title), parentL2Ids: uniqueIds(topic.parentL2Ids, 3) };
      if (topic.newL2Title !== undefined) result.newL1.newL2Title = placementTitle(topic.newL2Title);
    }
    return result;
  });
  const ids = uniqueIds(items.map((item) => item.memoryId), limit, 1);
  if (requestedIds && (ids.length !== requestedIds.length || ids.some((id) => !requestedIds.includes(id)))) {
    fail('invalid_input');
  }
  return { items };
}

/** @param {PlacementProposal} proposal @param {readonly ClassificationCatalogItem[]} shownMap @param {boolean} mapExhausted */
export function checkProposalAgainstCatalog(proposal, shownMap, mapExhausted) {
  const visibleGroups = new Map(shownMap.filter((item) => item.type === 'moc')
    .map((item) => [item.moc.id, item.moc.level]));
  for (const item of proposal.items) {
    if (item.parentIds.some((id) => visibleGroups.get(id) !== 'L1')) fail('invalid_model_output');
    if (item.newL1 && (!mapExhausted || item.newL1.parentL2Ids.some((id) => visibleGroups.get(id) !== 'L2'))) {
      fail('invalid_model_output');
    }
  }
}
