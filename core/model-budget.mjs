import { fail } from './validation.mjs';

// The host supplies the exact tokenizer for its model. No heuristic fallback.
export function countTokens(model, text) {
  if (typeof model?.countTokens !== 'function') fail('token_count_unavailable');
  let count;
  try { count = model.countTokens(text); } catch { fail('token_count_unavailable'); }
  if (!Number.isSafeInteger(count) || count < 0) fail('token_count_unavailable');
  return count;
}
