import { boundedText, fail, identifier, MemoryStoreError, object, revision } from './validation.mjs';

// Internal observers see only fixed categories at the original rejecting seam.
// Their failures must never replace the validator's original public error code.
function observe(callback, reason) {
  try { Promise.resolve(callback?.(reason)).catch(() => {}); } catch { /* Observation only. */ }
}

export function uniqueIds(input, max, min = 0, onDuplicate) {
  if (!Array.isArray(input) || input.length < min || input.length > max) fail('invalid_input');
  if (Object.keys(input).length !== input.length) fail('invalid_input');
  const result = input.map(identifier);
  if (new Set(result).size !== input.length) {
    observe(onDuplicate);
    fail('invalid_input');
  }
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

function title(input, onInvalid, reason) {
  try {
    const clean = boundedText(input, 240);
    if ([...clean].length > 120) fail('invalid_input');
    return clean;
  } catch (error) {
    if (error instanceof MemoryStoreError && ['invalid_input', 'invalid_text'].includes(error.code)) {
      observe(onInvalid, reason);
    }
    throw error;
  }
}

export function placementProposal(input, requestedIds, onInvalid) {
  object(input, ['items']);
  if (!Array.isArray(input.items)) fail('invalid_input');
  if (input.items.length < 1 || input.items.length > 5) {
    observe(onInvalid, 'classification_target_mismatch');
    fail('invalid_input');
  }
  if (Object.keys(input.items).length !== input.items.length) fail('invalid_input');
  const items = input.items.map((item) => {
    object(item, ['memoryId', 'parentIds', 'newL1']);
    const result = { memoryId: identifier(item.memoryId), parentIds: uniqueIds(item.parentIds, 3, 0,
      () => observe(onInvalid, 'classification_duplicate_l1_parents')) };
    if (item.newL1 !== undefined) {
      object(item.newL1, ['title', 'parentL2Ids', 'newL2Title']);
      result.newL1 = { title: title(item.newL1.title, onInvalid, 'classification_l1_title'),
        parentL2Ids: uniqueIds(item.newL1.parentL2Ids, 3, 0,
          () => observe(onInvalid, 'classification_duplicate_l2_parents')) };
      if (item.newL1.newL2Title !== undefined) {
        result.newL1.newL2Title = title(item.newL1.newL2Title, onInvalid, 'classification_l2_title');
      }
    }
    return result;
  });
  const ids = uniqueIds(items.map((item) => item.memoryId), 5, 1,
    () => observe(onInvalid, 'classification_duplicate_targets'));
  if (requestedIds && (ids.length !== requestedIds.length || ids.some((id) => !requestedIds.includes(id)))) {
    observe(onInvalid, 'classification_target_mismatch');
    fail('invalid_input');
  }
  return { items };
}
