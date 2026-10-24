import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { compareCanonical, canonicalKey } from './context-read-bm25.mjs';
import { SOURCE_LIMITS, namespaceKey } from './context-read-input.mjs';
import { contextCardEligible } from './context-read-sidecar.mjs';
import { validateSourceReceipt } from './source-evidence.mjs';

const boundary = ns => [ns.ownerId, ns.scope, ns.projectId ?? ''];
const where = 'owner_id=? AND scope=? AND project_id=?';
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const binary = (a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b));
export const RELATIONS_SOURCE = 'relations-one-hop-v1';

// Deterministic conservative accounting, not a claim about V8 RSS: 64 bytes per
// scalar/container, 2 bytes per UTF-16 unit, 64 bytes per property/map/set/array
// slot, plus recursively accounted values. Buffers cost their byteLength+64.
// Charge BEFORE growing collections. SQL rows are single-row indexed seeks;
// support iterators check each step, never materializing an unbounded .all().
// A 64-KiB reservation covers bounded loop/SQL-row frames; Card verification
// additionally reserves 4 MiB for its canonical support caches.
// SQLite's individual step remains synchronous and cannot be preempted.
export function sourceStateBytes(value) {
  if (typeof value === 'string') return 64 + value.length * 2;
  if (value instanceof Uint8Array) return 64 + value.byteLength;
  if (value === null || typeof value !== 'object') return 64;
  if (value instanceof Map) return 64 + [...value].reduce((n, [k, v]) => n + 64 + sourceStateBytes(k) + sourceStateBytes(v), 0);
  if (value instanceof Set) return 64 + [...value].reduce((n, v) => n + 64 + sourceStateBytes(v), 0);
  return 64 + Object.entries(value).reduce((n, [k, v]) => n + 64 + sourceStateBytes(k) + sourceStateBytes(v), 0);
}
export class SourceStop extends Error {
  constructor(reason) { super(reason); this.reason = reason; }
}
export function sourceBudget(deadlineAt) {
  let work = 0, reservedWork = 512, stateBytes = 65536, peakBytes = 65536, lookups = 0, records = 0, checks = 0;
  const check = () => { if (performance.now() >= deadlineAt) throw new SourceStop('deadline'); };
  return { check,
    ensure(units) { check(); if (work + reservedWork + units > SOURCE_LIMITS.work) throw new SourceStop('work_limit'); },
    charge(kind = 'records', { required = false } = {}) {
      if (!required) check();
      if (work + reservedWork >= SOURCE_LIMITS.work) throw new SourceStop('work_limit');
      work++; if (kind === 'lookups') lookups++; else if (kind === 'checks') checks++; else records++;
    },
    reserveWork(units) {
      if (work + reservedWork + units > SOURCE_LIMITS.work) throw new SourceStop('work_limit');
      reservedWork += units;
    },
    hold(bytes) {
      check();
      if (stateBytes + bytes > SOURCE_LIMITS.stateBytes) throw new SourceStop('state_limit');
      stateBytes += bytes; peakBytes = Math.max(peakBytes, stateBytes); return bytes;
    },
    release(bytes) { stateBytes -= bytes; },
    stats() { return { work, reservedWork, records, lookups, checks, stateBytes, peakBytes }; },
  };
}
export function sourceDiagnostic(reason, extra = {}) {
  return { status: reason ? 'unavailable' : 'ok', reasons: reason ? [reason] : [], ...extra };
}
export function relationDiagnostic(reason) {
  return sourceDiagnostic(reason, { examined: 0,
    rejected: { revision: 0, ineligible: 0, unavailable: 0, invalid_binding: 0, type_excluded: 0, duplicate: 0 },
    capped: false, added: 0, additions: [], remaining: reason ? null : 0 });
}

/** Every query here is a support/endpoint/projection lookup. The outer source
 * scans charge their returned authorized records separately. Foreign endpoints
 * are filtered in SQL before this wrapper, so they enter no public counters. */
export function chargedSourceDatabase(db, budget) {
  return { prepare(sql) {
    const statement = db.prepare(sql);
    return { get(...args) {
      budget.ensure(2); budget.charge('lookups');
      const row = statement.get(...args);
      if (row) { budget.charge('records', { required: true }); const bytes = budget.hold(sourceStateBytes(row)); budget.release(bytes); }
      return row;
    }, all(...args) {
      budget.charge('lookups');
      const rows = [], iterator = statement.iterate(...args); let bytes = 0, batchRows = 0, batchUnits = 0;
      try {
        while (true) {
          budget.ensure(1); const next = iterator.next(); if (next.done) break;
          const row = next.value; budget.charge('records', { required: true });
          const units = Object.values(row).reduce((n, v) => n + (typeof v === 'string' ? v.length : 0), 0);
          if (units > 2_000_000) throw new SourceStop('state_limit');
          if (++batchRows > 128 || batchUnits + units > 2_000_000) { budget.check(); batchRows = 1; batchUnits = 0; }
          batchUnits += units;
          bytes += budget.hold(sourceStateBytes(row) + 64); rows.push(row);
        }
        return rows;
      } finally { iterator.return?.(); budget.release(bytes); }
    } };
  } };
}
export function sourceReader(db, identity, features, input, budget) {
  const charged = chargedSourceDatabase(db, budget);
  const allowed = ns => input.readSet.some(value => namespaceKey(value) === namespaceKey(ns));
  function endpoint(ref, { projection = false, titleSource = false } = {}) {
    if (!allowed(ref.namespace)) return { reason: 'unavailable' };
    budget.charge('checks');
    if (!input.types.includes(ref.type)) return { reason: 'type_excluded' };
    const ns = ref.namespace, id = ref.memoryId ?? ref.cardId;
    const row = charged.prepare(ref.type === 'memory' ? `SELECT id,revision,deleted,currentness,review_state FROM memories WHERE ${where} AND id=?` :
      `SELECT id,revision,body_revision,state FROM private_cards WHERE ${where} AND id=?`).get(...boundary(ns), id);
    if (!row || row.deleted || ['cancelled', 'deleted'].includes(row.state)) return { reason: 'unavailable' };
    if (row.revision !== ref.revision || ref.type === 'card' && row.body_revision !== ref.bodyRevision) return { reason: 'revision' };
    if (ref.type === 'memory') {
      if (row.currentness !== 'current' || row.review_state === 'awaiting') return { reason: 'ineligible' };
      if (projection) {
        const state = charged.prepare(`SELECT active_generation FROM namespace_index_state WHERE ${where}`).get(...boundary(ns));
        if (state?.active_generation === null) return { reason: 'unavailable' };
        if (state && !charged.prepare('SELECT 1 FROM index_memories WHERE generation=? AND id=? AND revision=?')
          .get(state.active_generation, id, ref.revision)) return { reason: 'unavailable' };
      }
    } else {
      // Fixed scratch reservation covers the canonical bounded source verifier's
      // <=16 refs, <=64KB Raw payload and <=128 part metadata/cache entries.
      const scratch = budget.hold(4 * 1024 * 1024);
      try { if (!contextCardEligible(charged, identity, features, ns, row, 'current', { requireApplicability: !titleSource, rawRows: 128 })) return { reason: 'ineligible' }; }
      catch (error) { if (error.code === 'source_budget_exceeded') throw new SourceStop('state_limit'); throw error; }
      finally { budget.release(scratch); }
    }
    return { row };
  }
  function receipt(memoryId, receiptId, expected) {
    const row = charged.prepare('SELECT * FROM receipts WHERE memory_id=? AND id=?').get(memoryId, receiptId);
    if (!row) return false;
    try { return digest(validateSourceReceipt(memoryId, row, digest)) === expected; }
    catch { return false; }
  }
  return { charged, endpoint, receipt };
}

function candidateRef(ns, type, id, revision, bodyRevision) {
  return { type, namespace: ns, [type === 'memory' ? 'memoryId' : 'cardId']: id, revision,
    ...(type === 'card' ? { bodyRevision } : {}) };
}

// No walker or recursion: each stream is incident on one of the first four
// DIRECT refs. Family-sized buffers are bounded by the source budget. Edges
// are keyset-read via existing PK/incoming/reverse-binding indexes.
export function expandRelations(db, identity, features, input, direct, deadlineAt) {
  const budget = sourceBudget(deadlineAt), diagnostic = relationDiagnostic(), witnesses = [], bySeed = new Map();
  if (input.intent !== 'current') return { items: direct, witnesses, diagnostic: relationDiagnostic('unsupported_intent') };
  const reader = sourceReader(db, identity, features, input, budget);
  // Reserve the bounded direct-identity set before allocating it.
  let seen;
  if (direct.length > SOURCE_LIMITS.seeds) { diagnostic.capped = true; diagnostic.remaining = null; }
  function scan(seed, family, direction) {
    const ns = seed.namespace, id = seed.memoryId ?? seed.cardId, rows = [];
    let after = family === 'contradicts' ? ['', 0, 0, '', ''] : ['', '', ''];
    while (true) {
      budget.ensure(2); budget.charge('lookups'); let row, ref, key;
      // Join authorization before charging, counting or validating support.
      if (family === 'card-memory') {
        if (!features.cards) return rows;
        const outgoing = seed.type === 'card';
        row = db.prepare(outgoing ? `SELECT b.*,m.revision AS endpoint_revision FROM card_memory_bindings b
          JOIN memories m ON m.id=b.memory_id WHERE b.card_id=? AND m.owner_id=? AND m.scope=? AND m.project_id=?
          AND (b.memory_id,b.receipt_id)>(?,?) ORDER BY b.memory_id,b.receipt_id LIMIT 1` :
          `SELECT b.*,c.revision AS endpoint_revision,c.body_revision AS endpoint_body_revision FROM card_memory_bindings b
          JOIN private_cards c ON c.id=b.card_id WHERE b.memory_id=? AND c.owner_id=? AND c.scope=? AND c.project_id=?
          AND (b.card_id,b.receipt_id)>(?,?) ORDER BY b.card_id,b.receipt_id LIMIT 1`)
          .get(id, ...boundary(ns), after[0], after[1]);
        if (!row) break;
        ref = outgoing ? candidateRef(ns, 'memory', row.memory_id, row.memory_revision) :
          candidateRef(ns, 'card', row.card_id, row.endpoint_revision, row.endpoint_body_revision);
        key = [outgoing ? row.memory_id : row.card_id, row.receipt_id, ''];
      } else if (seed.type !== 'memory') break;
      else if (family === 'contradicts') {
        const outgoing = direction === 'outgoing', from = outgoing ? 'left_memory_id' : 'right_memory_id', to = outgoing ? 'right_memory_id' : 'left_memory_id';
        row = db.prepare(`SELECT e.* FROM memory_conflicts e JOIN memories m ON m.id=e.${to}
          WHERE e.${from}=? AND m.owner_id=? AND m.scope=? AND m.project_id=? AND (e.${to},e.left_revision,e.right_revision,e.relation,e.source)>(?,?,?,?,?)
          ORDER BY e.${to},e.left_revision,e.right_revision,e.relation,e.source LIMIT 1`)
          .get(id, ...boundary(ns), ...after);
        if (!row) break;
        ref = candidateRef(ns, 'memory', row[to], row[outgoing ? 'right_revision' : 'left_revision']); key = [row[to], row.left_revision, row.right_revision, row.relation, row.source];
      } else {
        const outgoing = direction === 'outgoing', from = outgoing ? 'from' : 'to', to = outgoing ? 'to' : 'from';
        row = db.prepare(`SELECT e.* FROM rationale_edges e JOIN memories m ON m.id=e.${to}_id
          WHERE e.${from}_id=? AND e.relation=? AND m.owner_id=? AND m.scope=? AND m.project_id=?
          AND (e.${to}_id,e.from_receipt,e.to_receipt)>(?,?,?) ORDER BY e.${to}_id,e.from_receipt,e.to_receipt LIMIT 1`)
          .get(id, family, ...boundary(ns), ...after);
        if (!row) break;
        ref = candidateRef(ns, 'memory', row[`${to}_id`], row[`${to}_revision`]); key = [row[`${to}_id`], row.from_receipt, row.to_receipt];
      }
      after = key; budget.charge('records', { required: true }); diagnostic.examined++;
      const via = { seed, family, direction: family === 'contradicts' ? 'undirected' : family === 'card-memory' ? seed.type === 'card' ? 'outgoing' : 'incoming' : direction };
      const path = { ref, via, edge: row, key: JSON.stringify(key) };
      budget.hold(sourceStateBytes(path)); rows.push(path);
    }
    return rows;
  }
  try {
    budget.hold(sourceStateBytes(direct) * 2); seen = new Set();
    for (const item of direct) { budget.charge(); seen.add(canonicalKey(item)); }
    for (const candidate of direct.slice(0, SOURCE_LIMITS.seeds)) {
      budget.charge();
      const seed = candidate.ref, additions = [];
      for (const family of ['supports-decision', 'challenges-premise', 'contradicts', 'card-memory']) {
        let paths = [];
        try {
          if (family === 'card-memory') paths = scan(seed, family, seed.type === 'card' ? 'outgoing' : 'incoming');
          else paths = [...scan(seed, family, 'incoming'), ...scan(seed, family, 'outgoing')];
          paths.sort((a, b) => { budget.charge(); budget.charge(); return compareCanonical(a.ref, b.ref) || binary(a.via.direction, b.via.direction) || binary(a.key, b.key); });
          for (const path of paths) {
            const before = budget.stats().work;
            const invalid = validateRelationWitness(reader, path);
            const validationWork = budget.stats().work - before;
            if (invalid) { diagnostic.rejected[invalid]++; continue; }
            const key = canonicalKey(path.ref);
            if (seen.has(key)) { diagnostic.rejected.duplicate++; continue; }
            // Validate before identity dedup; never replace stale revisions.
            // Reserve both preparation and final delivery checks before accepting
            // a witness. Fences have a fixed 512-unit reserve. Continuation is a
            // fresh bounded read; it never repeats the expansion/scoring pass.
            budget.reserveWork(2 * validationWork);
            const kept = { ref: path.ref, via: path.via };
            budget.hold(sourceStateBytes(kept) + sourceStateBytes(path) + sourceStateBytes(key) + 256);
            seen.add(key); witnesses.push(path); diagnostic.additions.push(kept); diagnostic.added++;
            additions.push({ ref: path.ref, fusionScore: null, channels: { lexical: null, semantic: null,
              ...(input.mocPreset ? { moc: null } : {}) }, via: path.via });
            if (additions.length === SOURCE_LIMITS.perSeed || witnesses.length === SOURCE_LIMITS.additions) {
              diagnostic.capped = true; diagnostic.remaining = null; break;
            }
          }
        } finally { for (const path of paths) budget.release(sourceStateBytes(path)); }
        if (additions.length === SOURCE_LIMITS.perSeed || witnesses.length === SOURCE_LIMITS.additions) break;
      }
      bySeed.set(canonicalKey(seed), additions);
      if (witnesses.length === SOURCE_LIMITS.additions) break;
    }
    if (diagnostic.capped) { diagnostic.status = 'degraded'; diagnostic.reasons.push('capped'); }
  } catch (error) {
    if (!(error instanceof SourceStop)) throw error;
    diagnostic.status = 'degraded'; diagnostic.reasons.push(error.reason); diagnostic.remaining = null;
    // A stop during a later family must retain the already-validated prefix.
    for (const witness of witnesses) {
      const key = canonicalKey(witness.via.seed);
      if (!bySeed.has(key)) bySeed.set(key, witnesses.filter(w => canonicalKey(w.via.seed) === key).map(w => ({
        ref: w.ref, fusionScore: null, channels: { lexical: null, semantic: null, ...(input.mocPreset ? { moc: null } : {}) }, via: w.via })));
    }
  }
  if (diagnostic.capped && !diagnostic.reasons.includes('capped')) diagnostic.reasons.push('capped');
  return { items: direct.flatMap(item => [item, ...(bySeed.get(canonicalKey(item)) ?? [])]), witnesses,
    diagnostic: { ...diagnostic, ...budget.stats() } };
}

export function validateRelationWitness(reader, path) {
  for (const ref of [path.via.seed, path.ref]) {
    const result = reader.endpoint(ref);
    if (result.reason) return result.reason;
  }
  const { family, seed, direction } = path.via, row = path.edge, db = reader.charged;
  if (family === 'card-memory') {
    const card = direction === 'outgoing' ? seed : path.ref, memory = direction === 'outgoing' ? path.ref : seed;
    const current = db.prepare('SELECT * FROM card_memory_bindings WHERE card_id=? AND receipt_id=?').get(card.cardId, row.receipt_id);
    if (!current || JSON.stringify(current) !== JSON.stringify(Object.fromEntries(Object.entries(row).filter(([k]) => !k.startsWith('endpoint_')))) ||
        current.memory_id !== memory.memoryId || current.memory_revision !== memory.revision) return 'invalid_binding';
    // endpoint(Card) validated every canonical receipt contentIdentity and its
    // exact current Memory/receipt binding through the shared predicate.
    let source;
    try { source = JSON.parse(current.source_ref); } catch { return 'invalid_binding'; }
    if (source.type !== 'receipt' || source.memoryId !== memory.memoryId || source.memoryRevision !== memory.revision ||
        source.receiptId !== current.receipt_id) return 'invalid_binding';
    return null;
  }
  if (family === 'contradicts') {
    const current = db.prepare('SELECT * FROM memory_conflicts WHERE left_memory_id=? AND left_revision=? AND right_memory_id=? AND right_revision=? AND relation=? AND source=?')
      .get(row.left_memory_id, row.left_revision, row.right_memory_id, row.right_revision, row.relation, row.source);
    if (!current || JSON.stringify(current) !== JSON.stringify(row)) return 'invalid_binding';
    const refs = [seed, path.ref];
    return refs.some(ref => ref.revision !== row[ref.memoryId === row.left_memory_id ? 'left_revision' : 'right_revision']) ? 'revision' : null;
  }
  const current = db.prepare('SELECT * FROM rationale_edges WHERE from_id=? AND to_id=? AND relation=? AND from_receipt=? AND to_receipt=?')
    .get(row.from_id, row.to_id, row.relation, row.from_receipt, row.to_receipt);
  if (!current || JSON.stringify(current) !== JSON.stringify(row)) return 'invalid_binding';
  const refs = [seed, path.ref];
  if (refs.some(ref => ref.revision !== row[ref.memoryId === row.from_id ? 'from_revision' : 'to_revision'])) return 'revision';
  return reader.receipt(row.from_id, row.from_receipt, row.from_digest) && reader.receipt(row.to_id, row.to_receipt, row.to_digest) ? null : 'invalid_binding';
}
