import { openMemoryCore } from '../../../core/contract.mjs';
import { createQueryScore } from '../../../core/query-candidates.mjs';
import { createHash } from 'node:crypto';
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { isDeepStrictEqual } from 'node:util';
import { collapseMemories, compareIds, channelPayload } from './bm25.mjs';

export const A0_NAMESPACE = Object.freeze({ ownerId: 'hr1-synthetic', scope: 'personal', projectId: null });
const unwrap = result => { if (!result.ok) throw new Error(`a0_core_${result.error.code}`); return result.value; };
const hash = value => createHash('sha256').update(value).digest('hex');

// Synthetic host only. Tokens bind the entire exact call; no tool/model may
// manufacture authorization. Reopened frozen stores reuse generation 1.
export function syntheticAuthority() {
  const approved = new WeakMap(), grants = new WeakMap();
  return { approve(method, input) { const token = Object.freeze({}); approved.set(token, { method, input: structuredClone(input) }); return token; },
    authority: { authorize(request, token) {
      const intent = approved.get(token);
      if (!intent || intent.method !== request.method || request.actionClass !== 'read' || !isDeepStrictEqual(intent.input, request.input)) return null;
      const grant = Object.freeze({}), { input, ...binding } = request;
      grants.set(grant, { ...binding, accessGeneration: 1 }); return grant;
    }, isCurrent(grant) { return grants.get(grant) ?? null; } } };
}
function open(path) {
  const host = syntheticAuthority();
  const core = openMemoryCore({ path, privateCards: { version: 'private-cards-local-v1', source: 'submitted-note-v1',
    storage: 'local-plain-v1', disclosure: 'explicit-submitted-note-v1', authority: host.authority } });
  return { core, host };
}

/** Projection-only A0 seeding. No evaluator metadata is accepted.
 * All bodies use context kind (not exposed by the shared projection). Historical
 * membership is history minus current. Public supersede links each old body to
 * a distinct current body already present; this reconstructs eligibility, not
 * original lineage. selectEvidence does not score kind, lineage or receipts.
 * Receipts use projected spans with synthetic user roles, event IDs and times.
 * Five stores use actual random core UUIDs, frozen to disk, never SQL mutation.
 */
export function createA0Store({ history, current, spans = [], path = ':memory:' }) {
  const { core, host } = open(path);
  try {
    const mapping = {}, seen = new Set(), currentIds = new Set(current.map(doc => doc.memoryId));
    const bodies = history.filter(doc => doc.kind === 'body').sort((a, b) => compareIds(a.memoryId, b.memoryId));
    const spanById = new Map();
    for (const doc of spans) { if (!spanById.has(doc.memoryId)) spanById.set(doc.memoryId, []); spanById.get(doc.memoryId).push(doc); }
    const receipts = doc => {
      const sources = spanById.get(doc.memoryId) ?? [];
      if (!sources.length || sources.length > 4) throw new Error('a0_bounded_spans_required');
      return sources.map((source, i) => {
        if (source.text.length > 800) throw new Error('a0_receipt_too_long');
        return { client: 'hr1-synthetic', sessionId: 'hr1-toy-or-frozen', eventId: `span-${hash(source.docId).slice(0, 32)}-${i}`,
          role: 'user', excerpt: source.text };
      });
    };
    for (const doc of bodies) {
      const memory = unwrap(core.admit({ namespace: A0_NAMESPACE, memory: { content: doc.text, kind: 'context' }, receipts: receipts(doc) })).memory;
      if (seen.has(memory.id)) throw new Error('a0_duplicate_body_projection');
      seen.add(memory.id); mapping[doc.memoryId] = memory.id;
    }
    for (const doc of bodies.filter(doc => !currentIds.has(doc.memoryId))) {
      const replacement = current.find(row => row.text !== doc.text);
      if (!replacement) throw new Error('a0_current_replacement_required');
      const old = unwrap(core.get({ namespace: A0_NAMESPACE, memoryId: mapping[doc.memoryId] })).memory;
      const updated = unwrap(core.supersede({ namespace: A0_NAMESPACE, memoryId: old.id, expectedRevision: old.revision,
        replacement: { content: replacement.text, kind: 'context' }, receipts: receipts(replacement) }));
      if (updated.memory.id !== mapping[replacement.memoryId]) throw new Error('a0_supersession_projection_changed');
    }
    return wrap(core, host, mapping, bodies);
  } catch (error) { core.close(); throw error; }
}
function wrap(core, host, mapping, bodies) {
  const reverse = new Map(Object.entries(mapping).map(([id, uuid]) => [uuid, id]));
  const bodyIds = new Map(bodies.map(doc => [doc.memoryId, doc.docId]));
  return { mapping, capabilities: unwrap(core.getPrivateCardCapabilities()), close() { core.close(); },
    search(query, { paged = false } = {}) {
      const base = { namespace: A0_NAMESPACE, query: query.text, intent: query.intent, types: ['memory'], ...(paged ? { limit: 24 } : {}) };
      const rows = [], coverage = [], errors = [], cursors = new Set();
      let cursor, scannedRows = 0, pages = 0;
      do {
        const input = { ...base, ...(cursor ? { cursor } : {}) };
        const result = core.selectEvidence(input, host.approve('selectEvidence', input)); pages++;
        if (!result.ok) { errors.push(result.error); break; }
        const value = result.value; coverage.push(value.coverage); scannedRows += value.coverage.scannedRows;
        for (const item of value.items) {
          const id = reverse.get(item.ref.memoryId);
          if (!id) throw new Error('a0_unmapped_uuid');
          rows.push({ memoryId: id, docId: bodyIds.get(id), score: item.score });
        }
        cursor = value.nextCursor;
        if (cursor && cursors.has(cursor)) { errors.push({ code: 'repeated_cursor' }); break; }
        cursors.add(cursor);
      } while (paged && cursor); // follow to completion even after collecting 24
      const seen = new Set();
      const retained = rows.filter(row => !seen.has(row.memoryId) && seen.add(row.memoryId)).slice(0, paged ? 24 : 12);
      return { ranked: retained.map(row => row.memoryId), ...channelPayload({ lex: retained }), pages, scannedRows, coverage, errors,
        recall24Available: paged };
    } };
}

export function frozenA0Stores({ directory, scale, history, current, spans }) {
  const fingerprint = hash(JSON.stringify({ scale, history, current, spans, seeding: 'hr1-projection-v1' }));
  const root = join(directory, `${scale}-${fingerprint}`); mkdirSync(root, { recursive: true });
  const stores = [];
  try {
    for (let index = 0; index < 5; index++) {
      const path = join(root, `store-${index}.sqlite`), manifest = `${path}.json`;
      if (!existsSync(manifest)) {
        if (existsSync(path)) throw new Error('a0_incomplete_snapshot');
        const started = performance.now();
        const store = createA0Store({ path, history, current, spans });
        const mapping = store.mapping; store.close();
        writeFileSync(manifest, JSON.stringify({ fingerprint, mapping, sha256: hash(readFileSync(path)), index, seedBuildMs: performance.now() - started }), { flag: 'wx' });
      }
      const frozen = JSON.parse(readFileSync(manifest, 'utf8'));
      if (frozen.fingerprint !== fingerprint || frozen.index !== index || frozen.sha256 !== hash(readFileSync(path))) throw new Error('a0_snapshot_mismatch');
      const { core, host } = open(path);
      stores.push({ ...wrap(core, host, frozen.mapping, history), snapshot: { path, manifest, sha256: frozen.sha256, mapping: frozen.mapping, seedBuildMs: frozen.seedBuildMs } });
    }
    return stores;
  } catch (error) { for (const store of stores) store.close(); throw error; }
}
export function a0b(documents, text) {
  const score = createQueryScore(text);
  return collapseMemories(documents.map(doc => ({ memoryId: doc.memoryId, docId: doc.docId, score: score(doc.text) })), 24);
}
