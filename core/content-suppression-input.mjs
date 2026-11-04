import { boundedData, mono, PRODUCT_PROFILE } from './context-product-control.mjs';
import { contextReadSet, namespaceKey } from './context-read-input.mjs';
import { ownData } from './local-authority-input.mjs';
import { cardNamespace } from './private-card-input.mjs';
import { fail, identifier } from './validation.mjs';

export const SUPPRESSION_VERSION = 'content-suppression-read-v1';
export const SUPPRESSION_REASONS = Object.freeze(['user_forget','correction_supersession','purge','privacy_erase','account_erasure']);
export const SUPPRESSION_LIMITS = Object.freeze({ bytes: 65536, cursor: 2048, lifetime: 900000,
  inputs: 256, nodes: 1024, rows: 8192, batches: 64, cacheBytes: 4194304 });
export const exact = (value, fields) => {
  const result = ownData(value, fields);
  if (Object.keys(result).length !== fields.length) fail('invalid_input');
  return result;
};
export function uuid(value) {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value)) fail('invalid_input');
  return value;
}
export function bootstrap(value) {
  const b = exact(value, ['storeId','suppressionDomain']);
  return { storeId: uuid(b.storeId), suppressionDomain: uuid(b.suppressionDomain) };
}
export function suppressionGrant(value, service) {
  const q = exact(boundedData(value, SUPPRESSION_LIMITS.bytes), ['version','expected','scope','permissions','accessGeneration']);
  if (q.version !== 'content-suppression-grant-v1' || !Number.isSafeInteger(q.accessGeneration) || q.accessGeneration < 1) fail('invalid_input');
  const scope = ownData(q.scope, ['kind','readSet']);
  if (scope.kind === 'owner') exact(scope, ['kind']);
  else if (scope.kind === 'namespaces') {
    exact(scope, ['kind','readSet']);
    scope.readSet = contextReadSet(scope.readSet, PRODUCT_PROFILE);
    const allowed = new Set(service.namespaces.readSet.map(namespaceKey));
    if (scope.readSet.some(ns => ns.ownerId !== service.ownerId || !allowed.has(namespaceKey(ns)))) fail('authority_required');
  } else fail('invalid_input');
  const permissions = exact(q.permissions, ['reconcile','erasureReconciliation']);
  if (permissions.reconcile !== true || typeof permissions.erasureReconciliation !== 'boolean' ||
      permissions.erasureReconciliation && scope.kind !== 'owner') fail('invalid_input');
  return boundedData({ ...q, expected: bootstrap(q.expected), scope, permissions });
}
export function checkpoint(value, owner, expected) {
  const c = exact(value, ['owner','storeId','suppressionDomain','epoch']);
  if (c.owner !== owner || c.storeId !== expected.storeId || c.suppressionDomain !== expected.suppressionDomain) fail('scope_changed');
  mono(c.epoch);
  return c;
}
export function pullOptions(value, owner, expected) {
  const o = ownData(value, ['expected','cursor','limit']);
  const limit = o.limit === undefined ? 100 : o.limit;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100 || o.cursor !== undefined &&
      (typeof o.cursor !== 'string' || !o.cursor.length || Buffer.byteLength(o.cursor) > SUPPRESSION_LIMITS.cursor)) fail('invalid_input');
  return { expected: checkpoint(o.expected, owner, expected), limit, ...(o.cursor === undefined ? {} : { cursor: o.cursor }) };
}
export const identityKey = c => JSON.stringify([c.storeId,c.suppressionDomain,c.namespace,c.kind,c.key,c.incarnation,c.boundRevision,
  c.kind === 'raw' ? [c.messageId,c.span] : c.kind === 'card' ? c.bodyRevision : null]);
export function sourceIdentities(value, owner, expected, grant) {
  const data = boundedData(value, SUPPRESSION_LIMITS.bytes);
  if (!Array.isArray(data) || data.length < 1 || data.length > SUPPRESSION_LIMITS.inputs) fail('invalid_input');
  let nodes = SUPPRESSION_LIMITS.nodes;
  const known = new Map(), active = new Set();
  const allowed = grant.scope.kind === 'namespaces' && new Set(grant.scope.readSet.map(namespaceKey));
  function visit(value, depth = 0) {
    if (--nodes < 0 || depth > 16) fail('source_budget_exceeded');
    const c = ownData(value, ['kind','storeId','suppressionDomain','namespace','key','incarnation','boundRevision','ancestors',
      'memoryId','contentIdentity','messageId','span','bodyRevision']);
    const extra = { memory: [], receipt: ['memoryId'], 'submitted-note': ['contentIdentity'], raw: ['messageId','span','contentIdentity'], card: ['bodyRevision'] }[c.kind];
    if (!extra) fail('invalid_input');
    exact(c, ['kind','storeId','suppressionDomain','namespace','key','incarnation','boundRevision','ancestors',...extra]);
    if (uuid(c.storeId) !== expected.storeId || uuid(c.suppressionDomain) !== expected.suppressionDomain) fail('scope_changed');
    c.namespace = cardNamespace(exact(c.namespace, ['ownerId','scope','projectId']));
    if (c.namespace.ownerId !== owner || allowed && !allowed.has(namespaceKey(c.namespace))) fail('authority_required');
    if (uuid(c.key) !== uuid(c.incarnation) || !Number.isSafeInteger(c.boundRevision) || c.boundRevision < 1 || !Array.isArray(c.ancestors)) fail('invalid_input');
    if (c.memoryId !== undefined) uuid(c.memoryId);
    if (c.bodyRevision !== undefined && (!Number.isSafeInteger(c.bodyRevision) || c.bodyRevision < 1)) fail('invalid_input');
    if (c.contentIdentity !== undefined && (typeof c.contentIdentity !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(c.contentIdentity))) fail('invalid_input');
    if (c.kind === 'raw') {
      identifier(c.messageId); c.span = exact(c.span, ['start','end','precision']);
      if (![c.span.start,c.span.end].every(Number.isSafeInteger) || c.span.start < 0 || c.span.end <= c.span.start ||
          !['exact','whole-message'].includes(c.span.precision)) fail('invalid_input');
    }
    const key = identityKey(c);
    if (active.has(key)) fail('invalid_input');
    active.add(key);
    c.ancestors = c.ancestors.map(a => visit(a, depth + 1));
    active.delete(key);
    const children = new Map(c.ancestors.map(a => [identityKey(a),a]));
    c.ancestors = [...children].sort(([a],[b]) => Buffer.compare(Buffer.from(a),Buffer.from(b))).map(([,a]) => a);
    if (['raw','submitted-note'].includes(c.kind) && c.ancestors.length) fail('invalid_input');
    if (c.kind === 'memory' && c.ancestors.some(a => a.kind !== 'raw') ||
        c.kind === 'receipt' && c.ancestors.some(a => !['memory','raw'].includes(a.kind))) fail('invalid_input');
    if (c.kind === 'receipt') {
      const parents = c.ancestors.filter(a => a.kind === 'memory');
      if (parents.length !== 1 || parents[0].key !== c.memoryId || parents[0].boundRevision !== c.boundRevision ||
          namespaceKey(parents[0].namespace) !== namespaceKey(c.namespace)) fail('invalid_input');
    }
    const normalized = boundedData(c, SUPPRESSION_LIMITS.bytes), previous = known.get(key);
    if (previous && JSON.stringify(previous) !== JSON.stringify(normalized)) fail('invalid_input');
    known.set(key, normalized);
    return normalized;
  }
  return data.map(c => visit(c));
}

/** Closed DenialKey wire target. No fact/action ids, payloads or cleanup state. */
export function denialKeyFromFact(row) {
  const mode = row.match_mode, version = row.source_version === '*' ? null : JSON.parse(row.source_version);
  if (version && JSON.stringify(version) !== row.source_version) fail('unsupported_database');
  const key = { namespace: mode === 'owner' ? null : { ownerId: row.owner_id, scope: row.scope, projectId: row.project_id || null },
    kind: row.kind, incarnation: ['owner','namespace'].includes(mode) ? null : row.incarnation, matchMode: mode,
    version: mode === 'version' ? version : null, through: mode === 'revision-through' ? version?.[1] : null,
    span: mode === 'span' ? { messageKey: row.message_key, start: row.span_start, end: row.span_end } : null };
  const target = denialKeyTarget(key, row.owner_id);
  for (const field of Object.keys(target)) if (target[field] !== row[field]) fail('unsupported_database');
  return key;
}
export function denialKeyTarget(value, owner) {
  const k = exact(value, ['namespace','kind','incarnation','matchMode','version','through','span']);
  const modes = ['owner','namespace','incarnation','version','revision-through','span'];
  if (!modes.includes(k.matchMode)) fail('invalid_input');
  let ns = null;
  if (k.matchMode === 'owner') {
    if (k.namespace !== null || k.kind !== 'owner') fail('invalid_input');
  } else {
    ns = cardNamespace(exact(k.namespace, ['ownerId','scope','projectId']));
    if (ns.ownerId !== owner) fail('invalid_input');
  }
  const wide = ['owner','namespace'].includes(k.matchMode);
  if (wide ? k.incarnation !== null : !uuid(k.incarnation)) fail('invalid_input');
  if (k.matchMode === 'namespace' ? k.kind !== 'namespace' : k.matchMode !== 'owner' &&
      !['memory','receipt','submitted-note','raw','card'].includes(k.kind)) fail('invalid_input');
  if (k.matchMode === 'version') {
    if (!Array.isArray(k.version) || Buffer.byteLength(JSON.stringify(k.version)) > 2048) fail('invalid_input');
    const v = k.version, positive = n => Number.isSafeInteger(n) && n > 0;
    const valid = k.kind === 'memory' ? v.length === 2 && v[0] === 'memory-revision-v1' && positive(v[1]) :
      k.kind === 'submitted-note' ? v.length === 2 && v[0] === 'note-v1' && positive(v[1]) :
      k.kind === 'receipt' ? v.length === 4 && v[0] === 'receipt-v1' && uuid(v[1]) && positive(v[2]) && /^[0-9a-f]{64}$/.test(v[3]) :
      k.kind === 'raw' ? v.length === 6 && v[0] === 'raw-span-v1' && identifier(v[1]) &&
        [v[2],v[3]].every(Number.isSafeInteger) && v[2] >= 0 && v[3] > v[2] && ['exact','whole-message'].includes(v[4]) &&
        Array.isArray(v[5]) && v[5].length > 0 && v[5].every((n,i) => Number.isSafeInteger(n) && n >= 0 && (!i || n > v[5][i-1])) : false;
    // Unspecified/future version encodings must not serialize arbitrary arrays
    // as a supposedly content-free DenialKey.
    if (!valid) fail('invalid_input');
  } else if (k.version !== null) fail('invalid_input');
  if (k.matchMode === 'revision-through') {
    if (k.kind !== 'memory' || !Number.isSafeInteger(k.through) || k.through < 1) fail('invalid_input');
  } else if (k.through !== null) fail('invalid_input');
  if (k.matchMode === 'span') {
    if (k.kind !== 'raw') fail('invalid_input');
    const s = exact(k.span, ['messageKey','start','end']); identifier(s.messageKey);
    if (![s.start,s.end].every(Number.isSafeInteger) || s.start < 0 || s.end <= s.start) fail('invalid_input');
  } else if (k.span !== null) fail('invalid_input');
  return { owner_id: owner, scope: ns?.scope ?? 'owner', project_id: ns?.projectId ?? '', kind: k.kind,
    stable_key: wide ? '' : k.incarnation, incarnation: wide ? '' : k.incarnation, match_mode: k.matchMode,
    source_version: k.matchMode === 'revision-through' ? JSON.stringify(['memory-revision-through-v1',k.through]) :
      k.matchMode === 'version' ? JSON.stringify(k.version) : '*', message_key: k.span?.messageKey ?? '',
    span_start: k.span?.start ?? 0, span_end: k.span?.end ?? 0 };
}
export function denialKeyMatches(key, c, version, owner) {
  if (typeof owner !== 'string') fail('invalid_input');
  if (c.namespace.ownerId !== owner) return false;
  if (key.matchMode === 'owner') return true;
  if (namespaceKey(key.namespace) !== namespaceKey(c.namespace)) return false;
  if (key.matchMode === 'namespace') return true;
  if (key.kind !== c.kind || key.incarnation !== c.incarnation) return false;
  if (key.matchMode === 'incarnation') return true;
  if (key.matchMode === 'revision-through') return c.boundRevision <= key.through;
  if (key.matchMode === 'span') return c.messageId === key.span.messageKey && c.span.start < key.span.end && c.span.end > key.span.start;
  const bound = version ?? (c.kind === 'memory' ? ['memory-revision-v1',c.boundRevision] :
    c.kind === 'submitted-note' ? ['note-v1',c.boundRevision] : null);
  if (!bound) fail('source_unavailable');
  return JSON.stringify(key.version) === JSON.stringify(bound);
}
