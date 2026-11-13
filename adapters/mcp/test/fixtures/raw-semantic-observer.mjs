import { registerHooks } from 'node:module';

// Trusted test instrumentation observes the real constructor and return value.
// It does not replace the manager, provider, authority or storage behavior.
export const RAW_MANAGER_OBSERVER = Symbol.for('cairn.test.raw-semantic-manager');
registerHooks({ load(url, context, next) {
  const result = next(url, context);
  if (!url.endsWith('/core/local-raw-search.mjs')) return result;
  const source = typeof result.source === 'string' ? result.source : Buffer.from(result.source).toString('utf8');
  const declaration = 'export function createLocalRawSearch(';
  if (source.split(declaration).length !== 2) throw Error('raw_manager_observer_target_changed');
  return { ...result, source: source.replace(declaration, 'function observedCreateLocalRawSearch(') + `
export function createLocalRawSearch(...args) {
  const manager = observedCreateLocalRawSearch(...args);
  globalThis[Symbol.for('cairn.test.raw-semantic-manager')]?.(manager, args[2]);
  return manager;
}
` };
} });
