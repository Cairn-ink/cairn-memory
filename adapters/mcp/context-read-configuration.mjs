import { isAbsolute, resolve } from 'node:path';
import { identifier } from '../../core/validation.mjs';

export const CONTEXT_PROVIDER_FLAGS = Object.freeze(['--context-embedder', '--context-embed-model',
  '--context-embed-dimensions', '--context-embed-max-requests', '--context-embed-max-usd']);
export const CONTEXT_FLAGS = Object.freeze(['--context-read', '--context-read-personal', ...CONTEXT_PROVIDER_FLAGS]);
const invalid = () => { throw Error('invalid_mcp_configuration'); };
export function contextProviderConfiguration(values, required = false) {
  const selected = CONTEXT_PROVIDER_FLAGS.filter(flag => values.has(flag));
  if (!selected.length && !required) return undefined;
  if (selected.length !== CONTEXT_PROVIDER_FLAGS.length || values.get('--context-embedder') !== 'openai') invalid();
  const integer = (flag, maximum) => {
    const raw = values.get(flag);
    if (!/^[1-9][0-9]*$/.test(raw)) invalid();
    const value = Number(raw); if (!Number.isSafeInteger(value) || value > maximum) invalid(); return value;
  };
  const model = values.get('--context-embed-model');
  if (typeof model !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/.test(model)) invalid();
  const rawUsd = values.get('--context-embed-max-usd');
  if (!/^(?:[0-9]+(?:\.[0-9]+)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?$/.test(rawUsd)) invalid();
  const maxUsd = Number(rawUsd); if (!Number.isFinite(maxUsd) || maxUsd <= 0) invalid();
  return Object.freeze({ provider: 'openai', model, dimensions: integer('--context-embed-dimensions', 32768),
    maxRequests: integer('--context-embed-max-requests', Number.MAX_SAFE_INTEGER), maxUsd });
}
export function contextHostConfiguration(values) {
  const enabled = values.has('--context-read'), personal = values.has('--context-read-personal');
  if (enabled && values.get('--context-read') !== 'context-read-v1' || personal && (!enabled || !values.has('--project'))) invalid();
  const provider = contextProviderConfiguration(values);
  if (provider && !enabled) invalid();
  if (!enabled) return {};
  const path = values.get('--db');
  if (typeof path !== 'string' || !isAbsolute(path) || resolve(path) !== path || path.includes('\0')) invalid();
  return { contextRead: 'context-read-v1', ...(personal ? { contextReadPersonal: true } : {}),
    ...(provider ? { contextProvider: provider } : {}) };
}
export function parseContextRefresh(args) {
  if (args[0] !== 'refresh') invalid();
  const allowed = new Set(['--db', '--owner', '--project', '--types', '--intent', '--max-items', '--max-ms', ...CONTEXT_PROVIDER_FLAGS]);
  const values = new Map(); let check = false;
  for (let i = 1; i < args.length; i++) {
    const flag = args[i];
    if (flag === '--check-config') { if (check) invalid(); check = true; continue; }
    const value = args[++i];
    if (!allowed.has(flag) || values.has(flag) || !value || value.startsWith('--')) invalid();
    values.set(flag, value);
  }
  const path = values.get('--db');
  if (typeof path !== 'string' || !isAbsolute(path) || resolve(path) !== path || path.includes('\0')) invalid();
  const namespace = { ownerId: identifier(values.get('--owner')), scope: values.has('--project') ? 'project' : 'personal',
    projectId: values.has('--project') ? identifier(values.get('--project')) : null };
  const types = values.get('--types')?.split(',');
  if (!types?.length || new Set(types).size !== types.length || types.some(type => !['memory', 'card'].includes(type)) ||
      !['current', 'history'].includes(values.get('--intent'))) invalid();
  const number = (flag, max) => { const raw = values.get(flag); if (!/^[1-9][0-9]*$/.test(raw ?? '')) invalid();
    const value = Number(raw); if (!Number.isSafeInteger(value) || value > max) invalid(); return value; };
  return { path, namespace, types, intent: values.get('--intent'), budget: { maxItems: number('--max-items', 1024), maxMs: number('--max-ms', 5000) },
    provider: contextProviderConfiguration(values, true), check };
}
