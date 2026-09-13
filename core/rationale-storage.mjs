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
  function source(ns, ref) {
    const row = currentRow(ns, ref.memoryId);
    if (!row) fail('memory_not_found');
    if (row.revision !== ref.revision) fail('revision_conflict');
    return readSourceEvidence(row);
  }

  function snapshot(ns, refs) {
    return transaction(db, () => bounded({ sources: refs.map(ref => source(ns, ref)), indexRevision: epoch(ns) }));
  }

  function assertSnapshot(ns, refs, expected) {
    const actual = bounded({ sources: refs.map(ref => source(ns, ref)), indexRevision: epoch(ns) });
    if (JSON.stringify(actual) !== JSON.stringify(expected)) fail('revision_conflict');
  }

  function commit(ns, refs, expected, proposals) {
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
    });
  }

  function inspect(ns, ref) {
    return transaction(db, () => {
      const sources = new Map([[ref.memoryId, source(ns, ref)]]);
      const edges = [];
      const incoming = (id, relation) => db.prepare(`SELECT * FROM rationale_edges
        WHERE to_id = ? AND relation = ? ORDER BY from_id, from_receipt, to_receipt LIMIT 11`).all(id, relation);
      const supports = incoming(ref.memoryId, 'supports-decision');
      const rows = [...supports];
      for (const id of new Set(supports.map(row => row.from_id))) rows.push(...incoming(id, 'challenges-premise'));
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
        status: edges.some(edge => edge.relation === 'challenges-premise') ? 'reconfirmation-suggested' : 'unassessed',
        sources: [...sources.values()], edges, coverage: 'linked-evidence-only', indexRevision: epoch(ns) });
    });
  }

  return { snapshot, commit, inspect };
}
