import { boundedText, fail, identifier, object, revision } from './validation.mjs';

export function uniqueIds(input, max, min = 0) {
  if (!Array.isArray(input) || input.length < min || input.length > max) fail('invalid_input');
  if (Object.keys(input).length !== input.length) fail('invalid_input');
  const result = input.map(identifier);
  if (new Set(result).size !== input.length) fail('invalid_input');
  return result;
}

export function memoryGuards(input, ids) {
  if (!Array.isArray(input) || input.length !== ids.length) fail('invalid_input');
  if (Object.keys(input).length !== input.length) fail('invalid_input');
  const guards = input.map((guard) => {
    object(guard, ['memoryId', 'revision']);
    return { memoryId: identifier(guard.memoryId), revision: revision(guard.revision) };
  });
  if (new Set(guards.map((guard) => guard.memoryId)).size !== ids.length ||
      guards.some((guard) => !ids.includes(guard.memoryId))) fail('invalid_input');
  return guards;
}

function title(input) {
  const clean = boundedText(input, 240);
  if ([...clean].length > 120) fail('invalid_input');
  return clean;
}

export function placementProposal(input, requestedIds) {
  object(input, ['items']);
  if (!Array.isArray(input.items) || input.items.length < 1 || input.items.length > 5) fail('invalid_input');
  if (Object.keys(input.items).length !== input.items.length) fail('invalid_input');
  const items = input.items.map((item) => {
    object(item, ['memoryId', 'parentIds', 'newL1']);
    const result = { memoryId: identifier(item.memoryId), parentIds: uniqueIds(item.parentIds, 3) };
    if (item.newL1 !== undefined) {
      object(item.newL1, ['title', 'parentL2Ids', 'newL2Title']);
      result.newL1 = { title: title(item.newL1.title), parentL2Ids: uniqueIds(item.newL1.parentL2Ids, 3) };
      if (item.newL1.newL2Title !== undefined) result.newL1.newL2Title = title(item.newL1.newL2Title);
    }
    return result;
  });
  const ids = uniqueIds(items.map((item) => item.memoryId), 5, 1);
  if (requestedIds && (ids.length !== requestedIds.length || ids.some((id) => !requestedIds.includes(id)))) {
    fail('invalid_input');
  }
  return { items };
}
