import { compareCanonical, scoreBM25 } from './context-read-bm25.mjs';
import { tokenizeT1 } from './context-read-tokenize.mjs';
import { sourceBudget, sourceStateBytes, SourceStop, sourceReader, sourceDiagnostic } from './context-read-relations.mjs';

const boundary = ns => [ns.ownerId, ns.scope, ns.projectId ?? ''];
const where = 'owner_id=? AND scope=? AND project_id=?';
export function mocDiagnostic(reason) {
  return sourceDiagnostic(reason, { topicsMatched: reason ? null : 0, membersRanked: reason ? null : 0,
    complete: !reason, summaryFreshness: 'unavailable', summaryFreshnessReason: 'e1_seam_unavailable' });
}

/** Read-only adapter, no organization pagination or cross-map traversal.
 * Full-corpus statistics (N, totalLength, query df) include nonmatching titles;
 * only matching document metadata/frequencies survive tokenization. Partition
 * namespace/type once. Distinct members retain just IDs (64-byte Set slot plus
 * sourceStateBytes(id)), never serialized namespaces or full refs. A monotone
 * top-12 accumulator implements max-over-topics without storing every score:
 * an evicted member's old maximum cannot exceed the current worst top score.
 * All structures use sourceStateBytes before growth. The fixed 1-MiB scratch
 * covers <=128 transient member refs, metadata maps and endpoint results; SQL
 * row arrays and tokenization scratch are additionally accounted while live.
 * Full revision-bound refs are constructed only for the final twelve rows.
 */
export function rankMoc(db, identity, features, input, deadlineAt, sharedContext) {
  const budget = sourceBudget(deadlineAt), reader = sourceReader(db, identity, features, input, budget, sharedContext), sourceDb = reader.charged;
  const partitions = [], df = new Map(), top = [];
  let N = 0, totalLength = 0, topicsMatched = 0, membersRanked = 0;
  function projectionState(ns) {
    const state = reader.projectionState(ns);
    if (state?.active_generation === null) throw new SourceStop('index_unavailable');
    return state;
  }
  function projected(ns, table, columns, values) {
    const state = projectionState(ns);
    if (!state) return true;
    budget.charge('checks');
    // Seek by the projection PK, then compare revisions in JS. A revision
    // predicate in SQL can visit a stale row while returning none, hiding work.
    const keys = columns.filter(column => !column.endsWith('revision'));
    const row = sourceDb.prepare(`SELECT ${columns.join(',')} FROM ${table} WHERE generation=? AND ${keys.map(k => k + '=?').join(' AND ')}`)
      .get(state.active_generation, ...keys.map(key => values[columns.indexOf(key)]));
    return Boolean(row && columns.every((column, i) => row[column] === values[i]));
  }
  function topic(ns, type, id, revision) {
    const resolved = reader.metadata(ns, type, id, { topic: true });
    if (!resolved.scoped) return null;
    budget.charge('checks'); const row = resolved.row;
    return row.revision === revision && [1, 2].includes(row.level) &&
      (type !== 'memory' || projected(ns, 'index_mocs', ['id', 'revision'], [id, revision])) ? row : null;
  }
  function ref(partition, id, revision, bodyRevision) {
    return { type: partition.type, namespace: partition.ns, [partition.type === 'memory' ? 'memoryId' : 'cardId']: id, revision,
      ...(partition.type === 'card' ? { bodyRevision } : {}) };
  }

  function validTitle(partition, row) {
    const { ns, type } = partition, memory = type === 'memory';
    if (![1, 2].includes(row.level) || memory && !projected(ns, 'index_mocs', ['id', 'revision'], [row.id, row.revision])) return false;
    let after = '', count = 0, valid = true;
    while (true) {
      const entry = reader.classifiedGet(`SELECT * FROM ${memory ? 'moc_title_sources' : 'card_moc_title_sources'}
        WHERE moc_id=? AND ${memory ? 'memory_id' : 'card_id'}>? ORDER BY ${memory ? 'memory_id' : 'card_id'} LIMIT 1`,
        [row.id, after], ns, type, binding => binding.memory_id ?? binding.card_id);
      if (!entry) break;
      const binding = entry.row; count++; after = binding.memory_id ?? binding.card_id;
      const original = ref(partition, after, binding.memory_revision ?? binding.card_revision, binding.body_revision);
      if (!entry.scoped || reader.endpoint(original, { projection: memory, titleSource: !memory }).reason) valid = false;
      if (entry.scoped && memory && !projected(ns, 'index_title_sources', ['moc_id', 'memory_id', 'memory_revision'],
        [row.id, after, binding.memory_revision])) valid = false;
    }
    return count > 0 && valid && (memory || count <= 5);
  }
  const compareMember = (a, b) => b.score - a.score || compareCanonical(
    { type: a.partition.type, namespace: a.partition.ns, id: a.id }, { type: b.partition.type, namespace: b.partition.ns, id: b.id });
  function select(partition, id, revision, bodyRevision, score) {
    if (!partition.members.has(id)) {
      budget.hold(64 + sourceStateBytes(id)); partition.members.add(id); membersRanked++;
    }
    budget.charge('checks');
    const previous = partition.selected.get(id);
    if (previous && previous.score >= score) return;
    const candidate = { partition, id, revision, bodyRevision, score };
    if (previous) top.splice(top.indexOf(previous), 1);
    if (top.length === 12 && compareMember(candidate, top.at(-1)) >= 0) return;
    // Partition references are shared; compact fields plus a bounded lookup
    // map slot are accounted once per selected member.
    const bytes = sourceStateBytes([id, revision, bodyRevision, score]) + 256;
    if (top.length === 12) {
      const removed = top.pop(); budget.release(removed.bytes); removed.partition.selected.delete(removed.id);
    }
    if (!previous) budget.hold(bytes);
    candidate.bytes = bytes; partition.selected.set(id, candidate);
    let low = 0, high = top.length;
    while (low < high) {
      budget.charge('checks'); const mid = (low + high) >>> 1;
      if (compareMember(candidate, top[mid]) < 0) high = mid; else low = mid + 1;
    }
    top.splice(low, 0, candidate);
  }
  function fileMembers(partition, score, parent) {
    const { ns, type } = partition, memory = type === 'memory'; let after = '';
    while (true) {
      const entry = reader.classifiedGet(`SELECT * FROM ${memory ? 'moc_memory_refs' : 'card_moc_refs'}
        WHERE moc_id=? AND ${memory ? 'memory_id' : 'card_id'}>? ORDER BY ${memory ? 'memory_id' : 'card_id'} LIMIT 1`,
        [parent.id, after], ns, type, row => row.memory_id ?? row.card_id);
      if (!entry) break;
      const row = entry.row; after = row.memory_id ?? row.card_id;
      if (!entry.scoped) continue;
      const original = ref(partition, after, row.memory_revision ?? row.card_revision, row.body_revision);
      if (reader.endpoint(original, { projection: memory }).reason || row.moc_revision !== parent.revision || memory && !projected(ns, 'index_memory_refs',
        ['moc_id', 'memory_id', 'moc_revision', 'memory_revision'], [parent.id, after, row.moc_revision, row.memory_revision])) continue;
      select(partition, after, row.memory_revision ?? row.card_revision, row.body_revision, score);
    }
  }
  try {
    if (input.types.includes('card') && !features.organization) throw new SourceStop('unsupported_schema');
    budget.hold(1024 * 1024);
    let scratch = budget.hold(16384 + input.query.length * 1024), terms;
    try { terms = [...new Set(tokenizeT1(input.query))]; }
    finally { budget.release(scratch); }
    budget.hold(sourceStateBytes(terms) * 2);
    const queryTerms = new Set(terms);
    for (const term of terms) { budget.hold(sourceStateBytes(term) + 128); df.set(term, 0); }
    for (const ns of input.readSet) for (const type of input.types) {
      if (type === 'memory') projectionState(ns);
      const partition = { ns, type, documents: [], members: new Set(), selected: new Map() };
      budget.hold(sourceStateBytes(partition)); partitions.push(partition);
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
          reader.remember(ns, type, row, { topic: true });
          if (!validTitle(partition, row)) continue;
          scratch = budget.hold(16384 + row.title.length * 1024);
          try {
            const tokens = tokenizeT1(row.title), length = tokens.length, frequencies = new Map();
            for (const term of tokens) if (queryTerms.has(term)) frequencies.set(term, (frequencies.get(term) ?? 0) + 1);
            N++; totalLength += length;
            for (const term of frequencies.keys()) df.set(term, df.get(term) + 1);
            if (frequencies.size) {
              const doc = { id: row.id, revision: row.revision, level: row.level, length, frequencies };
              budget.hold(sourceStateBytes(doc) + 64); partition.documents.push(doc);
            }
          } finally { budget.release(scratch); }
        }
      }
    }
    const statistics = { N, totalLength, df };
    for (const partition of partitions) for (const doc of partition.documents) {
      budget.charge('checks'); const score = scoreBM25(terms, doc, statistics); topicsMatched++;
      if (doc.level === 1) fileMembers(partition, score, doc);
      else {
        let after = '';
        const memory = partition.type === 'memory', table = memory ? 'moc_edges' : 'card_moc_edges';
        while (true) {
          const entry = reader.classifiedGet(`SELECT * FROM ${table} WHERE parent_id=? AND child_id>? ORDER BY child_id LIMIT 1`,
            [doc.id, after], partition.ns, partition.type, row => row.child_id, { topic: true });
          if (!entry) break;
          const edge = entry.row; after = edge.child_id;
          if (!entry.scoped) continue;
          if (edge.parent_revision !== doc.revision) continue;
          const child = topic(partition.ns, partition.type, edge.child_id, edge.child_revision);
          if (!child || child.level !== 1 || partition.type === 'memory' && !projected(partition.ns, 'index_edges',
            ['parent_id', 'child_id', 'parent_revision', 'child_revision'], [doc.id, child.id, doc.revision, child.revision])) continue;
          fileMembers(partition, score, child);
        }
      }
    }
    const rows = top.map(member => ({ ref: ref(member.partition, member.id, member.revision, member.bodyRevision), score: member.score }));
    budget.hold(sourceStateBytes(rows)); budget.check();
    return { rows, diagnostic: { ...mocDiagnostic(), topicsMatched, membersRanked, ...budget.stats() } };
  } catch (error) {
    if (!(error instanceof SourceStop)) throw error;
    return { rows: [], diagnostic: { ...mocDiagnostic(error.reason), status: error.reason === 'unsupported_schema' || error.reason === 'index_unavailable' ? 'unavailable' : 'degraded',
      ...budget.stats() } };
  }
}
