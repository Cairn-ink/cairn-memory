import { countTokens } from './model-budget.mjs';
import { fail, object, identifier, revision, denseArray } from './validation.mjs';

export function memoryRefs(input) {
  denseArray(input, 1, 12);
  const refs = input.map((ref) => {
    object(ref, ['memoryId', 'revision']);
    return { memoryId: identifier(ref.memoryId), revision: revision(ref.revision) };
  });
  if (new Set(refs.map((ref) => ref.memoryId)).size !== refs.length) fail('invalid_input');
  return refs;
}

export function fetchMemories({ runtime, model, ns, refs, budget, cursor, binding, encodeCursor }) {
  countTokens(model, '');
  if (cursor && (Object.keys(cursor.a).length !== 2 ||
      !Number.isSafeInteger(cursor.a.index) || cursor.a.index < 0 || cursor.a.index >= refs.length ||
      !Number.isSafeInteger(cursor.a.offset) || cursor.a.offset < 0)) fail('invalid_cursor');
  const index = cursor?.a.index ?? 0;
  const offset = cursor?.a.offset ?? 0;
  const page = runtime.fetchPage(ns, refs[index], offset, cursor?.e);
  const available = page.receipts?.length ?? 0;
  const capacity = Math.min(100, available);
  for (let take = capacity; take >= 0; take--) {
    if (available && !take) fail('context_item_too_large');
    const finishedRef = !page.memory || offset + take >= page.memory.receiptCount;
    const exhausted = finishedRef && index === refs.length - 1;
    const next = finishedRef ? { index: index + 1, offset: 0 } : { index, offset: offset + take };
    const value = {
      items: page.memory ? [{ memory: page.memory, receipts: page.receipts.slice(0, take),
        receiptCount: page.memory.receiptCount }] : [],
      nextCursor: exhausted ? null : encodeCursor({ ...binding, e: page.epoch, a: next }),
      exhausted, truncatedBy: exhausted ? null : take < capacity ? 'token_budget' : 'page_limit',
      indexRevision: page.epoch, invalidRefs: page.invalidRef ? [page.invalidRef] : [],
    };
    if (countTokens(model, JSON.stringify({ ok: true, value })) <= budget) {
      runtime.assertEpoch(ns, page.epoch);
      return value;
    }
  }
  fail('context_item_too_large');
}
