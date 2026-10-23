import { MemoryStoreError } from '../../core/validation.mjs';

// Keep the local module eagerly linked, but load the package/WASM only after
// explicit context startup. Counting remains synchronous once the factory resolves.
let encoder, loading;
function countOpenAITokens(text) {
  if (typeof text !== 'string') throw new MemoryStoreError('token_count_unavailable');
  try { return encoder.encode(text, [], []).length; }
  catch { throw new MemoryStoreError('token_count_unavailable'); }
}
export async function createContextCounter() {
  try {
    loading ??= import('tiktoken').then(({ get_encoding }) => get_encoding('o200k_base'));
    encoder = await loading;
  } catch {
    loading = undefined;
    throw new MemoryStoreError('context_tokenizer_unavailable');
  }
  return Object.freeze({ id: 'tiktoken-o200k_base', countTokens: countOpenAITokens });
}
