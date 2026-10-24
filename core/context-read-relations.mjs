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

// Deterministic conservative accounting, not a claim about V8 RSS: 64 bytes per
// scalar/container, 2 bytes per UTF-16 unit, 64 bytes per property/map/set/array
// slot, plus recursively accounted values. Buffers cost their byteLength+64.
// Charge BEFORE growing collections. SQL uses indexed seeks/keyset batches;
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
    releaseWork(units) { reservedWork -= units; },
    hold(bytes, { required = false } = {}) {
      if (!required) check();
      if (stateBytes + bytes > SOURCE_LIMITS.stateBytes) throw new SourceStop('state_limit');
      stateBytes += bytes; peakBytes = Math.max(peakBytes, stateBytes); return bytes;
    },
    release(bytes) { stateBytes -= bytes; },
    stats() { return { work, reservedWork, records, lookups, checks, stateBytes, peakBytes }; },
  };
}
// Scope filtering has its own fixed 50,000-unit ledger (one per physical
// lookup/visited record), never returned in source diagnostics and never
// deducted from the authorized 50,000-unit allowance. It shares the deadline.
// Its 1-MiB scratch cap is reserved ONCE in the public 8-MiB state allowance,
// so foreign rows cannot change reported occupancy or bypass the state cap.
// Physical batches are <=128; a 256-KiB frame reservation covers bounded ID
// arrays/maps while iterator row accounting and pending IDs are also checked.
// Exhaustion uses the existing generic work_limit/state_limit fallback; no
// foreign count, private occupancy, ID or new reason is disclosed.
export function sourcePrivateBudget(check) {
  let work = 0, stateBytes = 262144;
  return { check,
    ensure(units) { check(); if (work + units > 50000) throw new SourceStop('work_limit'); },
    charge(_kind, { required = false } = {}) { if (!required) check(); if (work >= 50000) throw new SourceStop('work_limit'); work++; },
    hold(bytes) { check(); if (stateBytes + bytes > 1024 * 1024) throw new SourceStop('state_limit'); stateBytes += bytes; return bytes; },
    release(bytes) { stateBytes -= bytes; },
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

/** Support/endpoint/projection lookups use PK/equality-prefix indexes with no
 * residual eligibility/revision predicates. Validate returned metadata in JS so
 * rejected/stale rows and every repeated lookup are still fully charged. */
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
// Multiple final-witness readers can share one source budget; reserve scratch
// and enforce its private work ceiling once for that whole read phase.
const privateContexts = new WeakMap();
export function sourceReader(db, identity, features, input, budget) {
  const charged = chargedSourceDatabase(db, budget);
  if (!privateContexts.has(budget)) { budget.hold(1024 * 1024, { required: true }); privateContexts.set(budget, sourcePrivateBudget(budget.check)); }
  const privateBudget = privateContexts.get(budget);
  const privateDb = chargedSourceDatabase({ prepare: sql => db.prepare('/* source-private */ ' + sql) }, privateBudget);
  const allowed = ns => input.readSet.some(value => namespaceKey(value) === namespaceKey(ns));
  function scopeIds(ns, type, ids, { topic = false } = {}) {
    if (!allowed(ns) || !ids.length) return new Set();
    if (ids.length > 128) throw new RangeError('source_batch_limit');
    const table = topic ? type === 'memory' ? 'mocs' : 'card_mocs' : type === 'memory' ? 'memories' : 'private_cards';
    return new Set(privateDb.prepare(`SELECT id FROM ${table} WHERE ${where} AND id IN (${ids.map(() => '?').join(',')})`)
      .all(...boundary(ns), ...ids).map(row => row.id));
  }
  // Refill logical batches with AUTHORIZED identities only. Physical keyset
  // boundaries and foreign-only streams affect only the private ledger. Public
  // reads re-fetch these exact keys, yielding identical seeks/rows/checks/state
  // with or without foreign links, including at a 128-row boundary.
  function* authorizedBatches(raw, ns, type, idOf, { size = 128, topic = false } = {}) {
    let physical = [], physicalBytes = 0, pending = [], pendingBytes = 0;
    function* filter() {
      const scoped = scopeIds(ns, type, physical.map(idOf), { topic });
      for (const row of physical) if (scoped.has(idOf(row))) {
        pendingBytes += privateBudget.hold(sourceStateBytes(row) + 64); pending.push(row);
        if (pending.length === size) {
          yield pending; pending = []; privateBudget.release(pendingBytes); pendingBytes = 0;
        }
      }
      physical = []; privateBudget.release(physicalBytes); physicalBytes = 0;
    }
    try {
      for (const row of raw) { physicalBytes += privateBudget.hold(sourceStateBytes(row) + 64); physical.push(row); if (physical.length === 128) yield* filter(); }
      if (physical.length) yield* filter();
      yield pending; // includes the same empty terminal seek as a logical keyset
    } finally { privateBudget.release(pendingBytes + physicalBytes); }
  }
  const projections = new Map();
  function projectionState(ns) {
    const key = namespaceKey(ns);
    if (!projections.has(key)) {
      const state = charged.prepare(`SELECT active_generation FROM namespace_index_state WHERE ${where}`).get(...boundary(ns));
      budget.hold(sourceStateBytes([key, state ?? null])); projections.set(key, state ?? null);
    }
    return projections.get(key);
  }
  // Batch metadata/projection lookups amortize seeks while still charging every
  // returned authorized record and each endpoint/projection check. Caller owns
  // at most 128 refs; no eligibility cache grows with the corpus.
  function endpoints(refs, { projection = false, titleSource = false } = {}) {
    if (refs.length > 128) throw new RangeError('source_batch_limit');
    if (!refs.length) return [];
    if (refs[0].type !== 'memory') return refs.map(ref => endpoint(ref, { projection, titleSource }));
    const ns = refs[0].namespace;
    if (refs.some(ref => ref.type !== 'memory' || namespaceKey(ref.namespace) !== namespaceKey(ns))) throw new RangeError('source_batch_partition');
    if (!allowed(ns)) return refs.map(() => ({ reason: 'unavailable' }));
    const scoped = scopeIds(ns, 'memory', refs.map(ref => ref.memoryId));
    const selected = refs.filter(ref => scoped.has(ref.memoryId));
    if (!selected.length) return refs.map(() => ({ reason: 'unavailable' }));
    const placeholders = selected.map(() => '?').join(','), ids = selected.map(ref => ref.memoryId);
    const rows = charged.prepare(`SELECT id,revision,deleted,currentness,review_state FROM memories WHERE ${where} AND id IN (${placeholders})`)
      .all(...boundary(ns), ...ids);
    const byId = new Map(rows.map(row => [row.id, row]));
    let state, projected;
    if (projection) {
      state = projectionState(ns);
      if (state?.active_generation) projected = new Map(charged.prepare(`SELECT id,revision FROM index_memories WHERE generation=? AND id IN (${placeholders})`)
        .all(state.active_generation, ...ids).map(row => [row.id, row.revision]));
    }
    return refs.map(ref => {
      if (!scoped.has(ref.memoryId)) return { reason: 'unavailable' };
      budget.charge('checks'); const row = byId.get(ref.memoryId);
      if (!input.types.includes('memory')) return { reason: 'type_excluded' };
      if (!row || row.deleted) return { reason: 'unavailable' };
      if (row.revision !== ref.revision) return { reason: 'revision' };
      if (row.currentness !== 'current' || row.review_state === 'awaiting') return { reason: 'ineligible' };
      if (projection && state) {
        budget.charge('checks');
        if (state?.active_generation === null || projected && projected.get(ref.memoryId) !== ref.revision) return { reason: 'unavailable' };
      }
      return { row };
    });
  }
  function endpoint(ref, { projection = false, titleSource = false } = {}) {
    if (!scopeIds(ref.namespace, ref.type, [ref.memoryId ?? ref.cardId]).size) return { reason: 'unavailable' };
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
        const state = projectionState(ns);
        budget.charge('checks');
        if (state?.active_generation === null) return { reason: 'unavailable' };
        if (state && charged.prepare('SELECT revision FROM index_memories WHERE generation=? AND id=?')
          .get(state.active_generation, id)?.revision !== ref.revision) return { reason: 'unavailable' };
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
  return { charged, privateDb, privateBudget, scopeIds, authorizedBatches, endpoint, endpoints, projectionState, receipt };
}

function candidateRef(ns, type, id, revision, bodyRevision) {
  return { type, namespace: ns, [type === 'memory' ? 'memoryId' : 'cardId']: id, revision,
    ...(type === 'card' ? { bodyRevision } : {}) };
}

// All incident statements have an equality prefix and a strict keyset on an
// existing index. In particular the incoming indexes include rowid as their
// final key. No endpoint join, residual family filter, OFFSET or SQL sort can
// conceal visits. Outgoing rationales read both families in PK order: filtering
// relation in SQL would hide skipped index entries from the work ledger.
export function relationIncidentQuery(seed, family, direction, after, group) {
  const id = seed.memoryId ?? seed.cardId;
  let table, index, prefix, values, columns;
  if (family === 'card-memory') {
    table = 'card_memory_bindings';
    if (seed.type === 'card') { index = 'sqlite_autoindex_card_memory_bindings_1'; prefix = 'card_id=?'; values = [id]; columns = ['receipt_id']; }
    else {
      index = 'card_memory_dependents';
      if (group !== undefined) { prefix = 'memory_id=? AND card_id=?'; values = [id, group]; columns = ['rowid']; }
      else { prefix = 'memory_id=?'; values = [id]; columns = ['card_id']; }
    }
  } else if (family === 'contradicts') {
    table = 'memory_conflicts';
    if (direction === 'outgoing') {
      index = 'sqlite_autoindex_memory_conflicts_1'; prefix = 'left_memory_id=?'; values = [id];
      columns = ['left_revision', 'right_memory_id', 'right_revision', 'relation', 'source'];
    } else { index = 'right_memory_conflicts'; prefix = 'right_memory_id=?'; values = [id]; columns = ['rowid']; }
  } else {
    table = 'rationale_edges';
    if (direction === 'outgoing') {
      index = 'sqlite_autoindex_rationale_edges_1'; prefix = 'from_id=?'; values = [id];
      columns = ['to_id', 'relation', 'from_receipt', 'to_receipt'];
    } else { index = 'rationale_incoming'; prefix = 'to_id=? AND relation=?'; values = [id, family]; columns = ['rowid']; }
  }
  const key = columns.map(c => 'e.' + c), continuation = after ? ` AND (${key.join(',')})>(${key.map(() => '?').join(',')})` : '';
  const discoverCard = family === 'card-memory' && seed.type === 'memory' && group === undefined;
  const endpoints = family === 'card-memory' ? ['card_id', 'memory_id'] : family === 'contradicts' ? ['left_memory_id', 'right_memory_id'] : ['from_id', 'to_id'];
  return { privateColumns: ['e.rowid AS incident_rowid', ...new Set([...columns.filter(c => c !== 'rowid'), ...endpoints].map(c => 'e.' + c))].join(','),
    sql: `SELECT e.rowid AS incident_rowid,e.* FROM ${table} e INDEXED BY ${index} WHERE ${prefix}${continuation} ORDER BY ${key.join(',')}${discoverCard ? ',e.rowid' : ''} LIMIT ${discoverCard ? 1 : 128}`,
    args: [...values, ...(after ?? [])], key: row => columns.map(c => c === 'rowid' ? row.incident_rowid : row[c]) };
}
const storedEdge = row => Object.fromEntries(Object.entries(row).filter(([k]) => k !== 'incident_rowid'));
const comparePath = (a, b) => compareCanonical(a.ref, b.ref) || binary(a.via.direction, b.via.direction) || binary(a.key, b.key);

// No walker or recursion. Each family keeps at most two eligible paths, plus
// the current incident row. Stream order need not equal candidate order: bounded
// selection in JS preserves family/canonical/direction/stored-key priority.
export function expandRelations(db, identity, features, input, direct, deadlineAt) {
  const budget = sourceBudget(deadlineAt), diagnostic = relationDiagnostic(), witnesses = [], bySeed = new Map();
  if (input.intent !== 'current') return { items: direct, witnesses, diagnostic: relationDiagnostic('unsupported_intent') };
  const reader = sourceReader(db, identity, features, input, budget);
  let seen;
  if (direct.length > SOURCE_LIMITS.seeds) { diagnostic.capped = true; diagnostic.remaining = null; }
  function* batches(seed, family, direction, group, start) {
    let after = start;
    while (true) {
      reader.privateBudget.check(); const plan = relationIncidentQuery(seed, family, direction, after, group);
      reader.privateBudget.ensure(2); reader.privateBudget.charge('lookups'); let count = 0;
      const iterator = db.prepare('/* source-private */ ' + plan.sql.replace('e.rowid AS incident_rowid,e.*', plan.privateColumns)).iterate(...plan.args);
      try {
        while (true) {
          reader.privateBudget.ensure(4); const next = iterator.next(); if (next.done) break;
          reader.privateBudget.charge('records', { required: true }); after = plan.key(next.value); count++; yield next.value;
        }
      } finally { iterator.return?.(); }
      if (count < 128) return;
    }
  }
  function* incident(seed, family, direction) {
    if (family !== 'card-memory' || seed.type !== 'memory') { yield* batches(seed, family, direction); return; }
    // The reverse binding index is (memory_id,card_id,rowid). SQLite cannot
    // seek its implicit rowid suffix with a mixed (card_id,rowid) tuple. Use
    // strict card-id discovery, then equality-prefix rowid seeks in that group;
    // otherwise each continuation can revisit the group's earlier receipts.
    let after;
    while (true) {
      const plan = relationIncidentQuery(seed, family, direction, after);
      reader.privateBudget.ensure(4); reader.privateBudget.charge('lookups');
      const first = db.prepare('/* source-private */ ' + plan.sql.replace('e.rowid AS incident_rowid,e.*', plan.privateColumns)).get(...plan.args); if (!first) return;
      reader.privateBudget.charge('records', { required: true }); after = plan.key(first); yield first;
      yield* batches(seed, family, direction, first.card_id, [first.incident_rowid]);
    }
  }
  function scan(seed, family, direction, best) {
    if (family === 'card-memory' ? !features.cards : seed.type !== 'memory') return;
    const outgoing = family === 'card-memory' ? seed.type === 'card' : direction === 'outgoing';
    const type = family === 'card-memory' && !outgoing ? 'card' : 'memory';
    const idOf = row => family === 'card-memory' ? row[outgoing ? 'memory_id' : 'card_id'] :
      family === 'contradicts' ? row[outgoing ? 'right_memory_id' : 'left_memory_id'] : row[outgoing ? 'to_id' : 'from_id'];
    const table = family === 'card-memory' ? 'card_memory_bindings' : family === 'contradicts' ? 'memory_conflicts' : 'rationale_edges';
    const batches = reader.authorizedBatches(incident(seed, family, direction), seed.namespace, type, idOf);
    for (const keys of batches) {
      const rows = reader.charged.prepare(`SELECT rowid AS incident_rowid,* FROM ${table} WHERE rowid IN (${keys.map(() => '?').join(',') || 'NULL'})`)
        .all(...keys.map(row => row.incident_rowid));
      const byId = new Map(rows.map(row => [row.incident_rowid, row]));
      for (const key of keys) {
        const row = byId.get(key.incident_rowid), other = idOf(row);
        const endpoint = reader.charged.prepare(type === 'memory' ? `SELECT revision FROM memories WHERE ${where} AND id=?` :
          `SELECT revision,body_revision FROM private_cards WHERE ${where} AND id=?`).get(...boundary(seed.namespace), other);
        diagnostic.examined++;
        if (family !== 'card-memory' && family !== 'contradicts' && row.relation !== family) continue;
        const ref = candidateRef(seed.namespace, type, other, family === 'card-memory' ? outgoing ? row.memory_revision : endpoint.revision :
          row[family === 'contradicts' ? outgoing ? 'right_revision' : 'left_revision' : outgoing ? 'to_revision' : 'from_revision'], endpoint.body_revision);
        const edge = storedEdge(row), via = { seed, family, direction: family === 'contradicts' ? 'undirected' : direction };
        const path = { ref, via, edge, key: JSON.stringify(family === 'card-memory' ? [row.card_id, row.receipt_id] : family === 'contradicts' ?
          [row.left_memory_id, row.left_revision, row.right_memory_id, row.right_revision, row.relation, row.source] :
          [row.from_id, row.to_id, row.relation, row.from_receipt, row.to_receipt]) };
        const bytes = budget.hold(sourceStateBytes(path));
        let retained = false;
        try {
          const before = budget.stats().work, invalid = validateRelationWitness(reader, path);
          const validationWork = budget.stats().work - before;
          if (invalid) { diagnostic.rejected[invalid]++; continue; }
          const key = canonicalKey(ref);
          if (seen.has(key)) { diagnostic.rejected.duplicate++; continue; }
          const previous = best.findIndex(p => canonicalKey(p.ref) === key);
          budget.charge('checks');
          if (previous >= 0) {
            diagnostic.rejected.duplicate++;
            if (comparePath(path, best[previous]) >= 0) continue;
            budget.releaseWork(2 * best[previous].validationWork); budget.release(sourceStateBytes(best[previous])); best.splice(previous, 1);
          }
          if (best.length === SOURCE_LIMITS.perSeed && comparePath(path, best.at(-1)) >= 0) continue;
          budget.reserveWork(2 * validationWork);
          if (best.length === SOURCE_LIMITS.perSeed) { const removed = best.pop(); budget.releaseWork(2 * removed.validationWork); budget.release(sourceStateBytes(removed)); }
          budget.hold(sourceStateBytes(validationWork) + sourceStateBytes('validationWork') + 64);
          path.validationWork = validationWork;
          best.push(path); best.sort(comparePath); retained = true;
        } finally { if (!retained) budget.release(bytes); }
      }
      if (keys.length < 128) break;
    }
  }
  try {
    budget.hold(sourceStateBytes(direct) * 2); seen = new Set();
    for (const item of direct) { budget.charge('checks'); seen.add(canonicalKey(item)); }
    for (const candidate of direct.slice(0, SOURCE_LIMITS.seeds)) {
      budget.charge('checks'); const seed = candidate.ref, additions = []; bySeed.set(canonicalKey(seed), additions);
      for (const family of ['supports-decision', 'challenges-premise', 'contradicts', 'card-memory']) {
        const best = []; let stop;
        try {
          if (family === 'card-memory') scan(seed, family, seed.type === 'card' ? 'outgoing' : 'incoming', best);
          else { scan(seed, family, 'incoming', best); scan(seed, family, 'outgoing', best); }
        } catch (error) { if (!(error instanceof SourceStop)) throw error; stop = error; }
        // Even an interrupted family can retain its validated, bounded prefix.
        for (const path of best.slice(0, SOURCE_LIMITS.perSeed - additions.length)) {
          const kept = { ref: path.ref, via: path.via }, key = canonicalKey(path.ref);
          budget.hold(sourceStateBytes(kept) + sourceStateBytes(key) + 256, { required: true });
          seen.add(key); witnesses.push(path); diagnostic.additions.push(kept); diagnostic.added++;
          additions.push({ ref: path.ref, fusionScore: null, channels: { lexical: null, semantic: null,
            ...(input.mocPreset ? { moc: null } : {}) }, via: path.via });
        }
        for (const path of best) if (!witnesses.includes(path)) { budget.releaseWork(2 * path.validationWork); budget.release(sourceStateBytes(path)); }
        bySeed.set(canonicalKey(seed), additions);
        if (stop) throw stop;
        if (additions.length === SOURCE_LIMITS.perSeed || witnesses.length === SOURCE_LIMITS.additions) {
          diagnostic.capped = true; diagnostic.remaining = null; break;
        }
      }
      if (witnesses.length === SOURCE_LIMITS.additions) break;
    }
    if (diagnostic.capped) { diagnostic.status = 'degraded'; diagnostic.reasons.push('capped'); }
  } catch (error) {
    if (!(error instanceof SourceStop)) throw error;
    diagnostic.status = 'degraded'; diagnostic.reasons.push(error.reason); diagnostic.remaining = null;
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
