// Fresh-process cold gate: exactly this owned minimal tree and finite builtins.
import { fileURLToPath } from 'node:url';
import { dirname, resolve as resolvePath } from 'node:path';
const root = dirname(fileURLToPath(import.meta.url));
const builtins = new Set(['node:assert/strict', 'node:crypto', 'node:fs', 'node:path', 'node:url', 'node:util']);
const files = new Set(['supplied-journal-cold.mjs', 'mixed-result-journal.mjs',
  'mixed-source-policy.mjs', 'mixed-protocol-data.mjs', 'mixed-validation.mjs',
  'mixed-native-failure-shape.mjs']);
export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('node:')) {
    if (!builtins.has(specifier)) throw new Error('cold_import_forbidden');
    return nextResolve(specifier, context);
  }
  const result = await nextResolve(specifier, context);
  const file = fileURLToPath(result.url);
  if (![...files].some(name => file === resolvePath(root, name))) throw new Error('cold_import_forbidden');
  return result;
}
