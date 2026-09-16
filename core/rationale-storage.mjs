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

  function commit(ns, refs, expected, proposals, writeMode) {
    return transaction(db, () => {
      assertSnapshot(ns, refs, expected);
      if (writeMode === 'replace-reviewed') {
        const ids = expected.sources.map(source => source.memory.id);
        const placeholders = ids.map(() => '?').join(', ');
        const existing = db.prepare(`SELECT * FROM rationale_edges
          WHERE from_id IN (${placeholders}) AND to_id IN (${placeholders}) LIMIT 61`).all(...ids, ...ids);
        if (existing.length > 60) fail('rationale_limit');
        const sourcesById = new Map(expected.sources.map(source => [source.memory.id, source]));
        for (const row of existing) {
          for (const side of ['from', 'to']) {
            const source = sourcesById.get(row[`${side}_id`]);
            const receipt = source.receipts.find(item => item.id === row[`${side}_receipt`]);
            if (source.memory.revision !== row[`${side}_revision`] || !receipt ||
                digest(receipt) !== row[`${side}_digest`]) fail('revision_conflict');
          }
        }
        const key = row => JSON.stringify([row.from_id, row.to_id, row.relation, row.from_receipt, row.to_receipt]);
        const proposed = proposals.map(proposal => {
          const from = expected.sources[proposal.from]; const to = expected.sources[proposal.to];
          const fromReceipt = from.receipts[proposal.fromReceipt]; const toReceipt = to.receipts[proposal.toReceipt];
          return { from, to, fromReceipt, toReceipt, relation: proposal.relation,
            from_id: from.memory.id, to_id: to.memory.id,
            from_receipt: fromReceipt.id, to_receipt: toReceipt.id };
        });
        const existingKeys = new Set(existing.map(key));
        const proposedKeys = new Set(proposed.map(key));
        let removed = 0;
        const remove = db.prepare(`DELETE FROM rationale_edges WHERE from_id = ? AND to_id = ?
          AND relation = ? AND from_receipt = ? AND to_receipt = ?`);
        for (const row of existing) {
          if (!proposedKeys.has(key(row))) {
            removed += remove.run(row.from_id, row.to_id, row.relation, row.from_receipt, row.to_receipt).changes;
          }
        }
        let inserted = 0;
        const insert = db.prepare(`INSERT INTO rationale_edges
          (from_id, from_revision, to_id, to_revision, relation, from_receipt, to_receipt, from_digest, to_digest)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
        for (const row of proposed) {
          if (existingKeys.has(key(row))) continue;
          inserted += insert.run(row.from_id, row.from.memory.revision, row.to_id, row.to.memory.revision,
            row.relation, row.from_receipt, row.to_receipt, digest(row.fromReceipt), digest(row.toReceipt)).changes;
          for (const id of [row.from_id, row.to_id]) {
            if (db.prepare('SELECT count(*) n FROM rationale_edges WHERE from_id = ? OR to_id = ?').get(id, id).n > 10) {
              fail('rationale_limit');
            }
          }
        }
        if (removed || inserted) advanceEpoch(ns);
        return { writeMode, proposed: proposals.length, inserted, removed,
          interpretationStatus: 'model-proposed', indexRevision: epoch(ns) };
      }
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
    });
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
        ORDER BY from_id, to_id, relation, from_receipt, to_receipt LIMIT 11`).all(ref.memoryId, ref.memoryId) : [...supports];
      if (!incident) for (const id of new Set(supports.map(row => row.from_id))) rows.push(...incoming(id, 'challenges-premise'));
      if (rows.length > 10) fail('rationale_limit');
      for (const row of rows) {
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

  return { snapshot, commit, inspectInside, inspect: (ns, ref, view) => transaction(db, () => inspectInside(ns, ref, view)) };
}
