import { get_encoding } from 'tiktoken';
import { MemoryStoreError } from '../../core/validation.mjs';

// Match the existing OpenAI counter without its import-time construction or
// model/prompt initialization. Importing this module never creates an encoder.
let encoder;
function countOpenAITokens(text) {
  if (typeof text !== 'string') throw new MemoryStoreError('token_count_unavailable');
  try { return encoder.encode(text, [], []).length; }
  catch { throw new MemoryStoreError('token_count_unavailable'); }
}
export function createContextCounter() {
  encoder ??= get_encoding('o200k_base');
  return Object.freeze({ id: 'tiktoken-o200k_base', countTokens: countOpenAITokens });
}
