import { createHash } from 'node:crypto';
import { transaction } from './database.mjs';
import { fail } from './validation.mjs';

const digest = receipt => createHash('sha256').update(JSON.stringify(receipt)).digest('hex');
const bounded = value => {
  if (JSON.stringify(value).length > 24000) fail('context_item_too_large');
  return value;
};

/** Only current, exact-namespace sources. No model call occurs in a transaction. */
export function createRationaleStorage({ db, currentRow, readSourceEvidence, epoch, advanceEpoch }) {
  function source(ns, ref, includeFocus = false) {
    const row = currentRow(ns, ref.memoryId);
    if (!row) fail('memory_not_found');
    if (row.revision !== ref.revision) fail('revision_conflict');
    return { ...readSourceEvidence(row),
      ...(includeFocus ? { focus: { content: row.content, interpretationStatus: 'unverified' } } : {}) };
  }

  function snapshotInside(ns, refs, inputMode) {
    return bounded({ sources: refs.map(ref => source(ns, ref, inputMode === 'claim-focus-v1')), indexRevision: epoch(ns),
      ...(inputMode ? { inputMode } : {}) });
  }

  function snapshot(ns, refs, inputMode) {
    return transaction(db, () => snapshotInside(ns, refs, inputMode));
  }

  function assertSnapshot(ns, refs, expected) {
    const actual = snapshotInside(ns, refs, expected.inputMode);
    if (JSON.stringify(actual) !== JSON.stringify(expected)) fail('revision_conflict');
  }

  // Placement alone may revise a memory without changing its source. Keep this
  // strictly inside the placement transaction; the global revision trigger
  // still invalidates every other kind of memory update.
  function snapshotFilingEdges(ns, changedIds) {
    const edges = new Map();
    const endpoints = new Map();
    const select = db.prepare('SELECT * FROM rationale_edges WHERE from_id = ? OR to_id = ?');
    for (const id of changedIds) for (const edge of select.all(id, id)) {
      edges.set(JSON.stringify([edge.from_id, edge.to_id, edge.relation,
        edge.from_receipt, edge.to_receipt]), edge);
    }
    for (const edge of edges.values()) for (const side of ['from', 'to']) {
      const id = edge[`${side}_id`];
      let endpoint = endpoints.get(id);
      if (!endpoint) {
        const row = currentRow(ns, id);
        if (!row) fail('revision_conflict');
        endpoint = { row: { ...row }, receipts: readSourceEvidence(row).receipts,
          rawReceipts: db.prepare('SELECT * FROM receipts WHERE memory_id = ? ORDER BY created_at, id').all(id) };
        endpoints.set(id, endpoint);
      }
      if (endpoint.row.revision !== edge[`${side}_revision`]) fail('revision_conflict');
      const cited = endpoint.receipts.find(receipt => receipt.id === edge[`${side}_receipt`]);
      if (!cited || digest(cited) !== edge[`${side}_digest`]) fail('revision_conflict');
    }
    return { edges: [...edges.values()], endpoints };
  }

  function restoreFilingEdges(ns, snapshot, nextRevisions) {
    for (const [id, before] of snapshot.endpoints) {
      const after = currentRow(ns, id);
      if (!after || after.revision !== (nextRevisions.get(id) ?? before.row.revision)) fail('revision_conflict');
      for (const key of Object.keys(before.row)) {
        if (['revision', 'filing_status', 'updated_at'].includes(key)) continue;
        if (after[key] !== before.row[key]) fail('revision_conflict');
      }
      if (nextRevisions.has(id)) {
        if (after.revision !== before.row.revision + 1 || after.filing_status === before.row.filing_status) {
          fail('revision_conflict');
        }
      } else if (after.filing_status !== before.row.filing_status || after.updated_at !== before.row.updated_at) {
        fail('revision_conflict');
      }
      const rawReceipts = db.prepare('SELECT * FROM receipts WHERE memory_id = ? ORDER BY created_at, id').all(id);
      if (JSON.stringify(rawReceipts) !== JSON.stringify(before.rawReceipts)) fail('revision_conflict');
      if (JSON.stringify(readSourceEvidence(after).receipts) !== JSON.stringify(before.receipts)) {
        fail('revision_conflict');
      }
    }
    const insert = db.prepare(`INSERT INTO rationale_edges
      (from_id, from_revision, to_id, to_revision, relation, from_receipt, to_receipt, from_digest, to_digest)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const edge of snapshot.edges) insert.run(edge.from_id,
      nextRevisions.get(edge.from_id) ?? edge.from_revision, edge.to_id,
      nextRevisions.get(edge.to_id) ?? edge.to_revision, edge.relation,
      edge.from_receipt, edge.to_receipt, edge.from_digest, edge.to_digest);
  }

  function commit(ns, refs, expected, proposals, deadline) {
    return transaction(db, () => {
      assertSnapshot(ns, refs, expected);
      let inserted = 0;
      for (const proposal of proposals) {
        const from = expected.sources[proposal.from]; const to = expected.sources[proposal.to];
        const fromReceipt = from.receipts[proposal.fromReceipt]; const toReceipt = to.receipts[proposal.toReceipt];
        inserted += db.prepare(`INSERT INTO rationale_edges
          (from_id, from_revision, to_id, to_revision, relation, from_receipt, to_receipt, from_digest, to_digest)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`).run(
          from.memory.id, from.memory.revision, to.memory.id, to.memory.revision, proposal.relation,
          fromReceipt.id, toReceipt.id, digest(fromReceipt), digest(toReceipt)).changes;
        for (const id of [from.memory.id, to.memory.id]) {
          if (db.prepare('SELECT count(*) n FROM rationale_edges WHERE from_id = ? OR to_id = ?').get(id, id).n > 10) {
            fail('rationale_limit');
          }
        }
      }
      if (inserted) advanceEpoch(ns);
      return { proposed: proposals.length, inserted, interpretationStatus: 'model-proposed', indexRevision: epoch(ns) };
    }, deadline?.check);
  }

  function inspectInside(ns, ref, view = 'decision-context') {
      if (!['decision-context', 'incident-proposals'].includes(view)) fail('invalid_input');
      const incident = view === 'incident-proposals';
      const sources = new Map([[ref.memoryId, source(ns, ref)]]);
      const edges = [];
      const incoming = (id, relation) => db.prepare(`SELECT * FROM rationale_edges
        WHERE to_id = ? AND relation = ? ORDER BY from_id, from_receipt, to_receipt LIMIT 11`).all(id, relation);
      const supports = incident ? [] : incoming(ref.memoryId, 'supports-decision');
      const rows = incident ? db.prepare(`SELECT * FROM rationale_edges WHERE from_id = ? OR to_id = ?
        ORDER BY from_id, to_id, relation, from_receipt, to_receipt LIMIT 11`).all(ref.memoryId, ref.memoryId)
        : [...supports, ...incoming(ref.memoryId, 'challenges-premise')];
      if (!incident) for (const id of new Set(supports.map(row => row.from_id))) rows.push(...incoming(id, 'challenges-premise'));
      // A self-support makes the root both a direct challenge target and a
      // support source. Count and return that same stored proposal only once.
      const uniqueRows = new Map(rows.map(row => [JSON.stringify([row.from_id, row.to_id,
        row.relation, row.from_receipt, row.to_receipt]), row]));
      if (uniqueRows.size > 10) fail('rationale_limit');
      for (const row of uniqueRows.values()) {
        for (const side of ['from', 'to']) {
          const id = row[`${side}_id`];
          if (!sources.has(id)) {
            if (sources.size === 6) fail('rationale_limit');
            sources.set(id, source(ns, { memoryId: id, revision: row[`${side}_revision`] }));
          }
          const evidence = sources.get(id);
          const receipt = evidence.receipts.find(receipt => receipt.id === row[`${side}_receipt`]);
          if (evidence.memory.revision !== row[`${side}_revision`] || !receipt ||
              digest(receipt) !== row[`${side}_digest`]) fail('revision_conflict');
        }
        edges.push({ from: row.from_id, to: row.to_id, relation: row.relation,
          fromReceipt: row.from_receipt, toReceipt: row.to_receipt, interpretationStatus: 'model-proposed' });
      }
      return bounded({ root: { memoryId: ref.memoryId, revision: ref.revision },
        status: !incident && edges.some(edge => edge.relation === 'challenges-premise') ? 'reconfirmation-suggested' : 'unassessed',
        sources: [...sources.values()], edges, coverage: incident ? 'root-incident-only' : 'linked-evidence-only',
        ...(incident ? { view: 'incident-proposals' } : {}), indexRevision: epoch(ns) });
  }

  return { snapshot, commit, snapshotFilingEdges, restoreFilingEdges,
    inspectInside, inspect: (ns, ref, view) => transaction(db, () => inspectInside(ns, ref, view)) };
}
