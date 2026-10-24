import { compareCanonical, canonicalKey, scoreBM25 } from './context-read-bm25.mjs';
import { tokenizeT1 } from './context-read-tokenize.mjs';
import { sourceBudget, sourceStateBytes, sourceReader, SourceStop, sourceDiagnostic } from './context-read-relations.mjs';

export const MOC_SOURCE = 'moc-v1';
const boundary = ns => [ns.ownerId, ns.scope, ns.projectId ?? ''];
const where = 'owner_id=? AND scope=? AND project_id=?';
export function mocDiagnostic(reason) {
  return sourceDiagnostic(reason, { topicsMatched: reason ? null : 0, membersRanked: reason ? null : 0,
    complete: !reason, summaryFreshness: 'unavailable', summaryFreshnessReason: 'e1_seam_unavailable' });
}

/** Read-only adapter: indexed single-row keysets, no organization pagination,
 * cross-map mappings, summaries, persisted cache or canonical DDL. The full
 * authorized valid-title corpus determines N, totalLength and query-term df.
 * Non-query df/term maps cannot influence this query and are never retained.
 * Temporary tokenization reserves a conservative bound before allocation;
 * documents, df entries and member maps are charged before each insertion. */
export function rankMoc(db, identity, features, input, deadlineAt) {
  const budget = sourceBudget(deadlineAt), reader = sourceReader(db, identity, features, input, budget), sourceDb = reader.charged;
  const documents = [], df = new Map(), members = new Map();
  let totalLength = 0, topicsMatched = 0;
  const projection = new Map();
  function projectionState(ns) {
    const key = JSON.stringify(boundary(ns));
    if (!projection.has(key)) {
      const state = sourceDb.prepare(`SELECT active_generation FROM namespace_index_state WHERE ${where}`).get(...boundary(ns));
      if (state?.active_generation === null) throw new SourceStop('index_unavailable');
      budget.hold(sourceStateBytes([key, state ?? null])); projection.set(key, state ?? null);
    }
    return projection.get(key);
  }
  function projected(ns, table, columns, values) {
    const state = projectionState(ns);
    return !state || Boolean(sourceDb.prepare(`SELECT 1 FROM ${table} WHERE generation=? AND ${columns.map(k => k + '=?').join(' AND ')}`)
      .get(state.active_generation, ...values));
  }
  function topic(ns, type, id, revision) {
    budget.charge('checks');
    const row = sourceDb.prepare(`SELECT id,revision,level FROM ${type === 'memory' ? 'mocs' : 'card_mocs'} WHERE ${where} AND id=?`)
      .get(...boundary(ns), id);
    return row && row.revision === revision && [1, 2].includes(row.level) &&
      (type !== 'memory' || projected(ns, 'index_mocs', ['id', 'revision'], [id, revision])) ? row : null;
  }
  function validTitle(ns, type, row) {
    if (![1, 2].includes(row.level) || type === 'memory' && !projected(ns, 'index_mocs', ['id', 'revision'], [row.id, row.revision])) return false;
    let after = '', count = 0, valid = true;
    while (true) {
      const binding = sourceDb.prepare(`SELECT * FROM ${type === 'memory' ? 'moc_title_sources' : 'card_moc_title_sources'}
        WHERE moc_id=? AND ${type === 'memory' ? 'memory_id' : 'card_id'}>? ORDER BY ${type === 'memory' ? 'memory_id' : 'card_id'} LIMIT 1`).get(row.id, after);
      if (!binding) break;
      count++; after = binding.memory_id ?? binding.card_id;
      const ref = { type, namespace: ns, [type === 'memory' ? 'memoryId' : 'cardId']: after,
        revision: binding.memory_revision ?? binding.card_revision, ...(type === 'card' ? { bodyRevision: binding.body_revision } : {}) };
      // Consult every original binding, not a filtered view of the survivors.
      if (reader.endpoint(ref, { projection: type === 'memory', titleSource: type === 'card' }).reason) valid = false;
      if (type === 'memory' && !projected(ns, 'index_title_sources', ['moc_id', 'memory_id', 'memory_revision'],
        [row.id, after, binding.memory_revision])) valid = false;
    }
    return count > 0 && valid && (type !== 'card' || count <= 5);
  }
  function fileMembers(document, parent) {
    const { ns, type, score } = document; let after = '';
    while (true) {
      budget.check();
      const memory = type === 'memory';
      const row = sourceDb.prepare(`SELECT r.* FROM ${memory ? 'moc_memory_refs' : 'card_moc_refs'} r
        JOIN ${memory ? 'memories' : 'private_cards'} e ON e.id=r.${memory ? 'memory_id' : 'card_id'}
        WHERE r.moc_id=? AND e.owner_id=? AND e.scope=? AND e.project_id=? AND r.${memory ? 'memory_id' : 'card_id'}>?
        ORDER BY r.${memory ? 'memory_id' : 'card_id'} LIMIT 1`).get(parent.id, ...boundary(ns), after);
      if (!row) break;
      after = memory ? row.memory_id : row.card_id;
      if (row.moc_revision !== parent.revision || memory && !projected(ns, 'index_memory_refs',
        ['moc_id', 'memory_id', 'moc_revision', 'memory_revision'], [parent.id, after, row.moc_revision, row.memory_revision])) continue;
      const ref = { type, namespace: ns, [memory ? 'memoryId' : 'cardId']: after,
        revision: memory ? row.memory_revision : row.card_revision, ...(memory ? {} : { bodyRevision: row.body_revision }) };
      if (reader.endpoint(ref, { projection: memory }).reason) continue;
      const key = canonicalKey(ref), previous = members.get(key);
      if (!previous) { budget.hold(sourceStateBytes([key, { ref, score }])); members.set(key, { ref, score }); }
      else previous.score = Math.max(previous.score, score);
    }
  }
  try {
    if (input.types.includes('card') && !features.organization) throw new SourceStop('unsupported_schema');
    // NFKC has bounded expansion; 1024 bytes/input unit conservatively covers
    // tokenizer strings, run/tokens arrays, sets and transient maps together.
    let scratch = budget.hold(16384 + input.query.length * 1024), terms;
    try { terms = [...new Set(tokenizeT1(input.query))]; }
    finally { budget.release(scratch); }
    budget.hold(sourceStateBytes(terms) * 2);
    const queryTerms = new Set(terms);
    for (const term of terms) { budget.hold(sourceStateBytes(term) + 128); df.set(term, 0); }
    for (const ns of input.readSet) for (const type of input.types) {
      if (type === 'memory') projectionState(ns);
      // Card namespace+level+canonical_title is its existing UNIQUE index;
      // level partitions avoid a scope-wide sort (there is no namespace,id index).
      for (const level of type === 'card' ? [1, 2] : [null]) {
        let after = '';
        while (true) {
          budget.check();
          const row = sourceDb.prepare(type === 'memory' ? `SELECT id,revision,level,title FROM mocs INDEXED BY index_moc_keyset
            WHERE ${where} AND id>? ORDER BY id LIMIT 1` : `SELECT id,revision,level,title,canonical_title FROM card_mocs
            WHERE ${where} AND level=? AND canonical_title>? ORDER BY canonical_title LIMIT 1`)
            .get(...boundary(ns), ...(level === null ? [] : [level]), after);
          if (!row) break;
          after = type === 'memory' ? row.id : row.canonical_title;
          if (!validTitle(ns, type, row)) continue;
          scratch = budget.hold(16384 + row.title.length * 1024);
          try {
            const tokens = tokenizeT1(row.title), length = tokens.length, frequencies = new Map();
            for (const term of tokens) if (queryTerms.has(term)) frequencies.set(term, (frequencies.get(term) ?? 0) + 1);
            const doc = { ns, type, id: row.id, revision: row.revision, level: row.level, length, frequencies };
            // Transfer into retained document accounting while tokenization's
            // scratch reservation still covers the live temporary arrays.
            budget.hold(sourceStateBytes(doc) + 64); documents.push(doc); totalLength += length;
            for (const [term, count] of frequencies) if (count) df.set(term, df.get(term) + 1);
          } finally { budget.release(scratch); }
        }
      }
    }
    const statistics = { N: documents.length, totalLength, df };
    for (const doc of documents) {
      budget.charge(); // Repeated scoring pass is work too.
      const score = scoreBM25(terms, doc, statistics);
      if (score === null) continue;
      topicsMatched++; const document = { ...doc, score };
      if (doc.level === 1) fileMembers(document, doc);
      else {
        let after = '';
        while (true) {
          const edge = sourceDb.prepare(`SELECT e.* FROM ${doc.type === 'memory' ? 'moc_edges' : 'card_moc_edges'} e
            JOIN ${doc.type === 'memory' ? 'mocs' : 'card_mocs'} c ON c.id=e.child_id
            WHERE e.parent_id=? AND c.owner_id=? AND c.scope=? AND c.project_id=? AND e.child_id>? ORDER BY e.child_id LIMIT 1`)
            .get(doc.id, ...boundary(doc.ns), after);
          if (!edge) break;
          after = edge.child_id;
          if (edge.parent_revision !== doc.revision) continue;
          const child = topic(doc.ns, doc.type, edge.child_id, edge.child_revision);
          if (!child || child.level !== 1 || doc.type === 'memory' && !projected(doc.ns, 'index_edges',
            ['parent_id', 'child_id', 'parent_revision', 'child_revision'], [doc.id, child.id, doc.revision, child.revision])) continue;
          fileMembers(document, child);
        }
      }
    }
    // Account sorting's auxiliary array before allocating it. All corpus/maps
    // become unreachable on return; only twelve identities/scores survive.
    budget.hold(64 + members.size * 64); budget.check();
    const ranked = [];
    for (const member of members.values()) { budget.charge(); ranked.push(member); }
    ranked.sort((a, b) => { budget.charge(); budget.charge(); return b.score - a.score || compareCanonical(a.ref, b.ref); });
    const rows = [];
    for (let i = 0; i < Math.min(12, ranked.length); i++) { budget.charge(); rows.push(ranked[i]); }
    budget.check();
    return { rows, diagnostic: { ...mocDiagnostic(), topicsMatched, membersRanked: members.size, ...budget.stats() } };
  } catch (error) {
    if (!(error instanceof SourceStop)) throw error;
    return { rows: [], diagnostic: { ...mocDiagnostic(error.reason), status: error.reason === 'unsupported_schema' || error.reason === 'index_unavailable' ? 'unavailable' : 'degraded',
      ...budget.stats() } };
  }
}
