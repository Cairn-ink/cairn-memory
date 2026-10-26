import { contextSources } from '../../core/context-read-input.mjs';

// U5c-2: SQLite-free startup validation; no provider/counter/key/store access.
export const CONTEXT_SOURCE_FLAG = '--context-read-sources';
export function contextReadSources(value) {
  try { return contextSources(value); }
  catch { throw Error('invalid_mcp_configuration'); }
}
export function contextSourcesConfiguration(values) {
  if (!values.has(CONTEXT_SOURCE_FLAG)) return {};
  if (values.get('--context-read') !== 'context-read-v1') throw Error('invalid_mcp_configuration');
  const raw = values.get(CONTEXT_SOURCE_FLAG);
  if (typeof raw !== 'string') throw Error('invalid_mcp_configuration');
  return { contextReadSources: contextReadSources(raw.split(',')) };
}
export const contextSourcesPreset = (sources, hosted) => sources?.includes('moc-v1') ? 'rrf-k60-d12-moc-v1' : hosted ? 'rrf-k10' : 'rrf-k60-d12';
