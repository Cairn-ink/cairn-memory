import { assertContentPort } from './content-safety-boundary.mjs';
import { fail } from './validation.mjs';

// The host supplies the exact tokenizer for its model. No heuristic fallback.
export function countTokens(model, text) {
  const counter = model?.countTokens;
  if (typeof counter !== 'function') fail('token_count_unavailable');
  assertContentPort({before:true});
  let count;
  try { count = assertContentPort({invoke:()=>Reflect.apply(counter,model,[text])}); }
  catch { fail('token_count_unavailable'); }
  finally { assertContentPort(); }
  if (!Number.isSafeInteger(count) || count < 0) fail('token_count_unavailable');
  return count;
}
