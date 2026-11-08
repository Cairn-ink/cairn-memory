import { ownData } from './local-authority-input.mjs';
import { fail, identifier } from './validation.mjs';
import { validateEmbedder,validateEmbedderMetadata,validateVector } from './context-read-embedder.mjs';

export const RAW_SEARCH_VERSION = 'raw-search-v1';
export const RAW_SEARCH_LIMITS = Object.freeze({ turns: 256, work: 50000, depth: 24,
  preparations: 72,
  snapshotBytes: 8 * 1024 * 1024,
  quotaBytes: 512 * 1024 * 1024, statements: 32, modifiedRows: 4096,
  anchors: 16, sourceBytes: 64000, sourceRows: 1024 });
export const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export const binary = (a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b));
export const immutable = (value,check=()=>{}) => {
  check();
  if (value && typeof value === 'object') { for(const child of Object.values(value))immutable(child,check); Object.freeze(value); }
  return value;
};
export function searchNamespace(value, ownerId) {
  const ns = ownData(value, ['ownerId','scope','projectId']);
  identifier(ns.ownerId);
  if (ns.ownerId !== ownerId || !['personal','project'].includes(ns.scope) ||
      ns.scope === 'personal' && ns.projectId !== null ||
      ns.scope === 'project' && !identifier(ns.projectId)) fail('invalid_read_set');
  return {ownerId:ns.ownerId,scope:ns.scope,projectId:ns.projectId};
}
export function rawSearchOptions(value) {
  const options = ownData(value, ['version','enabled','backend','path','directory','ownerId','readSet',
    'authority','crypto','maintenanceTurn','embedder','policy','quotaBytes']);
  if (options.version !== RAW_SEARCH_VERSION || options.enabled !== undefined && options.enabled !== true) fail('invalid_input');
  if (options.backend !== 'local') fail('raw_search_backend_unavailable');
  identifier(options.ownerId);
  for (const key of ['path','directory']) if (typeof options[key] !== 'string' ||
    !options[key].startsWith('/') || options[key].includes('\0')) fail('invalid_path');
  if (!Array.isArray(options.readSet) || options.readSet.length < 1 || options.readSet.length > 32) fail('invalid_read_set');
  const readSet = options.readSet.map(ns => searchNamespace(ns, options.ownerId));
  if (new Set(readSet.map(ns => JSON.stringify(ns))).size !== readSet.length) fail('invalid_read_set');
  readSet.sort((a,b) => binary(JSON.stringify(a),JSON.stringify(b)));
  if (typeof options.authority?.authorize !== 'function' || typeof options.authority?.isCurrent !== 'function') fail('authority_required');
  if (options.crypto?.version !== 'raw-seal-v1' || typeof options.crypto.openRaw !== 'function') fail('raw_crypto_unavailable');
  const quotaBytes = options.quotaBytes ?? RAW_SEARCH_LIMITS.quotaBytes;
  if (!Number.isSafeInteger(quotaBytes) || quotaBytes < 65536 || quotaBytes > RAW_SEARCH_LIMITS.quotaBytes) fail('invalid_input');
  const embedder = options.embedder ? validateEmbedder(options.embedder) : null;
  // The process-local budget is shared with Memory by exact provider identity.
  // Hosted durable accounting is deliberately unavailable on this local seam.
  const policy = options.policy && ownData(options.policy,
    ['family','maxBatchDocuments','maxRequests','maxConcurrent','maxUsd','estimateUsd']);
  if (embedder && (!policy || !['local','hosted'].includes(policy.family) ||
      !Number.isSafeInteger(policy.maxRequests) || policy.maxRequests < 0 ||
      !Number.isSafeInteger(policy.maxConcurrent) || policy.maxConcurrent < 1 ||
      !Number.isFinite(policy.maxUsd) || policy.maxUsd < 0 ||
      policy.family === 'hosted' && typeof policy.estimateUsd !== 'function' ||
      policy.family === 'local' && policy.maxBatchDocuments !== 1)) fail('invalid_input');
  return { ...options, readSet: immutable(readSet), quotaBytes, embedder, policy:policy && Object.freeze(policy) };
}
export function searchInput(value) {
  const input = ownData(value, ['query','intent','queryVector']);
  if (typeof input.query !== 'string' || !input.query.isWellFormed() || input.query.includes('\0') ||
      input.query.length < 1 || input.query.length > 4000) fail('invalid_query');
  const intent = input.intent ?? 'current';
  if (!['current','history'].includes(intent)) fail('invalid_input');
  if(input.queryVector!==undefined){
    const query=ownData(input.queryVector,['input','embedder','vector']);
    const embedder=validateEmbedderMetadata(query.embedder);
    if(typeof query.input!=='string'||query.input.length>4000)fail('invalid_input');
    input.queryVector={input:query.input,embedder,vector:Array.from(validateVector(query.vector,embedder))};
  }
  return { ...input, intent };
}

// Source hints retain a binding to the complete canonical manifest, without
// duplicating that manifest in every postings/vector record.
export function rawSourceHint(source, bind) {
  if (source.canonical) return source;
  const {ref,role,ordinal,occurredAt,currentness,classification}=source;
  return {ref,ordinal,role,occurredAt,currentness,classification,
    totalUnits:source.manifest.message.total_units,
    bytes:source.manifest.parts.reduce((n,part)=>n+part.byte_count,0),
    canonical:bind('raw-search-manifest-v1',source)};
}
