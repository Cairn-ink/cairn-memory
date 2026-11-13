import { receiptDeliverySnapshot, deliveryReceiptRows, deliveryReceiptHeaders } from './content-safety.mjs';
import { receiptDenialsInside, anchorsDeliverable, cardDeliverable } from './content-safety.mjs';
import { contentReadSafety, receiptReadSafety, createContentReadMemo } from './content-safety.mjs';
import { performance } from 'node:perf_hooks';
import { cachedContentLayout, checkInstalledContentSafety } from './content-safety-schema.mjs';

import { contentSuppressionRequestFenceInside, contentSuppressionReasonInside, cachedContentSuppressionRequestInside,
  contentSuppressionFenceInside, withContentSuppressionRequest,
  resetContentSuppressionRequestInside, contentSuppressionRequestInside } from './content-suppression-storage.mjs';
import { randomUUID } from "node:crypto";
import { transaction, readTransaction, isStorageBusy } from "./database.mjs";
import { fail } from "./validation.mjs";
import { QUERY_SCAN_BUDGET_MS, SOURCE_QUERY_RECEIPT_LIMIT, QUERY_CANDIDATES } from './query-candidates.mjs';
import { validateSourceReceipt } from './source-evidence.mjs';

const namespaceWhere = "owner_id = ? AND scope = ? AND project_id = ?";
const qualifiedNamespace = (alias) => `${alias}.owner_id = ? AND ${alias}.scope = ? AND ${alias}.project_id = ?`;
const boundary = (ns) => [ns.ownerId, ns.scope, ns.projectId];
const publicNamespace = (row) => ({
  ownerId: row.owner_id,
  scope: row.scope,
  projectId: row.project_id || null,
});
const titleKey = (title) => title.normalize("NFKC").toLocaleLowerCase("und");
const label = (content) => [...content].slice(0, 120).join("");

/** Persistence for revision-bound MOC placement in the shared SQLite store. */
export function createMocStorage({ db, epoch, advanceEpoch, memoryDto, invalidateConflicts,
  assertIndexAvailable, rationaleStorage, receiptKey, classificationJournal }) {
  // Read authority is generation-owned; writes below continue targeting declarations.
  // Title validity deliberately consults every original source binding.
  function projectSQL(sql) {
    return sql.replace(/\bmoc_memory_refs\b/g, 'index_read_memory_refs')
      .replace(/\bmoc_edges\b/g, 'index_read_edges').replace(/\bmocs\b/g, 'index_read_mocs')
      .replace(/\bmemories\b/g, 'index_read_memories');
  }
  const projectPrepare = sql => db.prepare(projectSQL(sql));
  const mocById = (ns, id) => db.prepare(`SELECT * FROM mocs WHERE ${namespaceWhere} AND id = ?`)
    .get(...boundary(ns), id);

  const safeMemory = (ns, row, selected = false) => Boolean(row && contentReadSafety(db, { namespace: ns,
    ...(selected ? { selectedMemory: row } : {}),
    ref: { type: 'memory', namespace: ns, memoryId: row.id, revision: row.revision } }).allowed);
  const readAncestry = alias => cachedContentLayout(db)?.suppressionRevision && cachedContentLayout(db)?.rawLineage ? `,EXISTS(
    SELECT 1 FROM receipts ar JOIN raw_receipt_lineage al ON al.receipt_id=ar.id
    LEFT JOIN raw_conversations ac ON ac.id=al.conversation_id WHERE ar.memory_id=${alias}.id
    AND (ac.owner_id IS NOT ${alias}.owner_id OR ac.scope IS NOT ${alias}.scope OR ac.project_id IS NOT ${alias}.project_id)) AS invalid_raw_ancestry` : '';
  function visibleTitle(moc) {
    const sources = db.prepare(`SELECT s.memory_revision, memory.*${readAncestry("memory")} FROM moc_title_sources s
      LEFT JOIN memories memory ON memory.id = s.memory_id WHERE s.moc_id = ?`).all(moc.id);
    if (sources.length === 0 || sources.some((source) => !source.id || source.deleted ||
        source.currentness !== 'current' || source.review_state === 'awaiting' ||
        source.owner_id !== moc.owner_id || source.scope !== moc.scope ||
        source.project_id !== moc.project_id || source.revision !== source.memory_revision ||
        cachedContentLayout(db)?.suppressionRevision && !safeMemory(publicNamespace(moc), source, true))) return null;
    return moc.title;
  }

  function titleSources(id) {
    return db.prepare(`SELECT memory_id AS memoryId, memory_revision AS revision
      FROM index_read_title_sources WHERE moc_id = ? ORDER BY memory_id`).all(id);
  }

  function mocDto(moc) {
    return {
      id: moc.id,
      namespace: publicNamespace(moc),
      level: `L${moc.level}`,
      title: visibleTitle(moc),
      titleSources: titleSources(moc.id).filter(({ memoryId }) => !cachedContentLayout(db)?.suppressionRevision || safeMemory(publicNamespace(moc),
        db.prepare("SELECT * FROM memories WHERE id=?").get(memoryId))).map(({ memoryId, revision }) =>
        ({ memoryId, memoryRevision: revision })),
      revision: moc.revision,
      state: "active",
      createdAt: moc.created_at,
      updatedAt: moc.updated_at,
    };
  }

  const memoryRef = (row) => ({
    parentId: row.moc_id,
    parentRevision: row.moc_revision,
    childType: "memory",
    childId: row.memory_id,
    childRevision: row.memory_revision,
    relation: "contains",
  });
  const edgeRef = (row) => ({
    parentId: row.parent_id,
    parentRevision: row.parent_revision,
    childType: "moc",
    childId: row.child_id,
    childRevision: row.child_revision,
    relation: "contains",
  });

  function checkedMoc(ns, id, level) {
    const moc = mocById(ns, id);
    if (!moc) fail("moc_not_found");
    if (moc.level !== level) fail("invalid_ref");
    return moc;
  }

  function suppressionEpochInside(ns) {
    return cachedContentLayout(db)?.suppressionRevision
      ? contentSuppressionRequestFenceInside(db, ns.ownerId) : null;
  }

  function assertEpochValue(ns, expected, cursor = false) {
    if (epoch(ns) !== expected) fail(cursor ? "cursor_stale" : "index_revision_conflict");
  }

  function bumpGroups(ids, now) {
    const affected = new Set(ids);
    if (!affected.size) return affected;
    const update = db.prepare("UPDATE mocs SET revision = revision + 1, updated_at = ? WHERE id = ?");
    for (const id of affected) update.run(now, id);
    const marks = [...affected].map(() => "?").join(",");
    db.prepare(`UPDATE moc_memory_refs SET moc_revision =
      (SELECT revision FROM mocs WHERE id = moc_memory_refs.moc_id)
      WHERE moc_id IN (${marks})`).run(...affected);
    db.prepare(`UPDATE moc_edges SET
      parent_revision = (SELECT revision FROM mocs WHERE id = moc_edges.parent_id),
      child_revision = (SELECT revision FROM mocs WHERE id = moc_edges.child_id)
      WHERE parent_id IN (${marks}) OR child_id IN (${marks})`).run(...affected, ...affected);
    return affected;
  }

  function invalidateMemory(ns, memoryId, now) {
    const affected = new Set();
    for (const row of db.prepare("SELECT moc_id FROM moc_memory_refs WHERE memory_id = ?")
      .all(memoryId)) affected.add(row.moc_id);
    for (const row of db.prepare("SELECT moc_id FROM moc_title_sources WHERE memory_id = ?")
      .all(memoryId)) affected.add(row.moc_id);
    db.prepare("DELETE FROM moc_memory_refs WHERE memory_id = ?").run(memoryId);
    db.prepare(`UPDATE memories SET filing_status = 'unfiled' WHERE ${namespaceWhere} AND id = ?`)
      .run(...boundary(ns), memoryId);
    bumpGroups(affected, now);
  }

  function currentMemoryRefs(ns, memoryId) {
    return db.prepare(`SELECT r.* FROM moc_memory_refs r JOIN mocs m ON m.id = r.moc_id
      WHERE ${qualifiedNamespace("m")} AND m.level = 1 AND r.memory_id = ?
      ORDER BY r.moc_id`).all(...boundary(ns), memoryId);
  }

  function guardsMap(guards) {
    if (!Array.isArray(guards)) fail("invalid_input");
    const result = new Map();
    for (const guard of guards) {
      if (!guard || typeof guard !== "object" || typeof guard.memoryId !== "string" ||
          !Number.isSafeInteger(guard.revision) || result.has(guard.memoryId)) fail("invalid_input");
      result.set(guard.memoryId, guard.revision);
    }
    return result;
  }

  function applyPlacement(ns, proposal, guards, expectedIndex, initialClassification) {
    return transaction(db, () => {
      assertEpochValue(ns, expectedIndex);
      if (initialClassification) classificationJournal.assertPlacement(ns, initialClassification,
        initialClassification.token, guards);
      const items = proposal.items;
      const expected = guardsMap(guards);
      if (expected.size !== items.length || items.some((item) => !expected.has(item.memoryId))) {
        fail("invalid_input");
      }

      const memories = new Map();
      for (const item of items) {
        const memory = db.prepare(`SELECT * FROM memories WHERE ${namespaceWhere}
          AND id = ? AND deleted = 0 AND review_state != 'awaiting' AND currentness = 'current'`).get(...boundary(ns), item.memoryId);
        if (!safeMemory(ns, memory)) fail("memory_not_found");
        if (memory.revision !== expected.get(item.memoryId)) fail("revision_conflict");
        memories.set(item.memoryId, memory);
        for (const id of item.parentIds) checkedMoc(ns, id, 1);
        if (item.newL1) for (const id of item.newL1.parentL2Ids) checkedMoc(ns, id, 2);
      }

      const newL1 = new Map();
      const newL2 = new Map();
      for (const item of items) {
        if (!item.newL1) continue;
        const l1Key = titleKey(item.newL1.title);
        if (db.prepare(`SELECT 1 FROM mocs WHERE ${namespaceWhere} AND level = 1
          AND canonical_title = ?`).get(...boundary(ns), l1Key)) fail("moc_title_conflict");
        let l1 = newL1.get(l1Key);
        if (!l1) {
          l1 = { title: item.newL1.title, id: randomUUID(), sourceIds: new Set(),
            parentIds: new Set(), newParentKeys: new Set() };
          newL1.set(l1Key, l1);
        }
        l1.sourceIds.add(item.memoryId);
        for (const id of item.newL1.parentL2Ids) l1.parentIds.add(id);
        if (item.newL1.newL2Title) {
          const l2Key = titleKey(item.newL1.newL2Title);
          if (db.prepare(`SELECT 1 FROM mocs WHERE ${namespaceWhere} AND level = 2
            AND canonical_title = ?`).get(...boundary(ns), l2Key)) fail("moc_title_conflict");
          let l2 = newL2.get(l2Key);
          if (!l2) {
            l2 = { title: item.newL1.newL2Title, id: randomUUID(), sourceIds: new Set() };
            newL2.set(l2Key, l2);
          }
          l2.sourceIds.add(item.memoryId);
          l1.newParentKeys.add(l2Key);
        }
      }

      // Per-item limits also apply to the union when a batch coalesces a topic.
      for (const l1 of newL1.values()) if (l1.parentIds.size > 3) fail("invalid_input");

      const nextRevision = new Map();
      const desiredByMemory = new Map();
      const affected = new Set();
      let changed = newL1.size > 0 || newL2.size > 0;
      for (const item of items) {
        const memory = memories.get(item.memoryId);
        const desired = new Set(item.parentIds);
        if (item.newL1) desired.add(newL1.get(titleKey(item.newL1.title)).id);
        desiredByMemory.set(item.memoryId, desired);
        const oldRefs = currentMemoryRefs(ns, item.memoryId);
        const old = new Set(oldRefs.map((ref) => ref.moc_id));
        const wasFiled = memory.filing_status === "filed";
        const willBeFiled = desired.size > 0;
        const revision = memory.revision + Number(wasFiled !== willBeFiled);
        nextRevision.set(item.memoryId, revision);
        const refChanged = old.size !== desired.size || [...old].some((id) => !desired.has(id)) ||
          revision !== memory.revision;
        if (refChanged) changed = true;
        if (refChanged) {
          const candidates = revision !== memory.revision ? new Set([...old, ...desired]) :
            new Set([...old].filter((id) => !desired.has(id)).concat(
              [...desired].filter((id) => !old.has(id))));
          for (const id of candidates) if (![...newL1.values()].some((entry) => entry.id === id))
            affected.add(id);
        }
        if (revision !== memory.revision) {
          for (const row of db.prepare("SELECT moc_id FROM moc_title_sources WHERE memory_id = ?")
            .all(item.memoryId)) affected.add(row.moc_id);
        }
      }
      for (const l1 of newL1.values()) for (const id of l1.parentIds) affected.add(id);

      if (!changed) {
        const resultMemories = items.map(({ memoryId }) => memoryDto(memories.get(memoryId), true));
        const refs = items.flatMap(({ memoryId }) => currentMemoryRefs(ns, memoryId).map(memoryRef));
        if (initialClassification) classificationJournal.completePlacement(ns, initialClassification,
          initialClassification.token);
        return { memories: resultMemories, createdMocs: [], refs, indexRevision: expectedIndex };
      }

      const filingRevisions = new Map([...nextRevision].filter(([id, revision]) =>
        revision !== memories.get(id).revision));
      const filingEdges = rationaleStorage.snapshotFilingEdges(ns, filingRevisions.keys());

      const now = new Date().toISOString();
      for (const l1 of newL1.values()) {
        db.prepare(`INSERT INTO mocs (id, owner_id, scope, project_id, level, title,
          canonical_title, revision, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?, 1, ?, ?)`)
          .run(l1.id, ...boundary(ns), l1.title, titleKey(l1.title), now, now);
      }
      for (const l2 of newL2.values()) {
        db.prepare(`INSERT INTO mocs (id, owner_id, scope, project_id, level, title,
          canonical_title, revision, created_at, updated_at) VALUES (?, ?, ?, ?, 2, ?, ?, 1, ?, ?)`)
          .run(l2.id, ...boundary(ns), l2.title, titleKey(l2.title), now, now);
      }

      bumpGroups(affected, now);
      const updateMemory = db.prepare(`UPDATE memories SET filing_status = ?, revision = ?,
        updated_at = CASE WHEN revision != ? THEN ? ELSE updated_at END WHERE id = ?`);
      const deleteRefs = db.prepare("DELETE FROM moc_memory_refs WHERE memory_id = ?");
      const insertRef = db.prepare(`INSERT INTO moc_memory_refs
        (moc_id, moc_revision, memory_id, memory_revision)
        SELECT id, revision, ?, ? FROM mocs WHERE id = ?`);
      for (const item of items) {
        const memory = memories.get(item.memoryId);
        const revision = nextRevision.get(item.memoryId);
        const filed = desiredByMemory.get(item.memoryId).size ? "filed" : "unfiled";
        if (revision !== memory.revision) invalidateConflicts(item.memoryId, { preserveHeld: true });
        updateMemory.run(filed, revision, revision, now, item.memoryId);
        deleteRefs.run(item.memoryId);
        for (const mocId of desiredByMemory.get(item.memoryId))
          insertRef.run(item.memoryId, revision, mocId);
        memory.revision = revision;
        memory.filing_status = filed;
        if (revision !== expected.get(item.memoryId)) memory.updated_at = now;
      }
      rationaleStorage.restoreFilingEdges(ns, filingEdges, filingRevisions);

      const insertSource = db.prepare(`INSERT INTO moc_title_sources
        (moc_id, memory_id, memory_revision) VALUES (?, ?, ?)`);
      for (const group of [...newL1.values(), ...newL2.values()]) {
        for (const memoryId of group.sourceIds) insertSource.run(group.id, memoryId,
          nextRevision.get(memoryId));
      }
      const insertEdge = db.prepare(`INSERT INTO moc_edges
        (parent_id, parent_revision, child_id, child_revision)
        SELECT parent.id, parent.revision, child.id, child.revision
        FROM mocs parent, mocs child WHERE parent.id = ? AND child.id = ?`);
      const writtenEdges = [];
      for (const l1 of newL1.values()) {
        for (const parentId of l1.parentIds) {
          insertEdge.run(parentId, l1.id);
          writtenEdges.push(db.prepare("SELECT * FROM moc_edges WHERE parent_id = ? AND child_id = ?")
            .get(parentId, l1.id));
        }
        for (const parentKey of l1.newParentKeys) {
          const parentId = newL2.get(parentKey).id;
          insertEdge.run(parentId, l1.id);
          writtenEdges.push(db.prepare("SELECT * FROM moc_edges WHERE parent_id = ? AND child_id = ?")
            .get(parentId, l1.id));
        }
      }

      const indexRevision = advanceEpoch(ns);
      const created = [...newL2.values(), ...newL1.values()]
        .map(({ id }) => mocDto(db.prepare("SELECT * FROM mocs WHERE id = ?").get(id)));
      const refs = items.flatMap(({ memoryId }) => currentMemoryRefs(ns, memoryId).map(memoryRef));
      refs.push(...writtenEdges.map(edgeRef));
      if (initialClassification) classificationJournal.completePlacement(ns, initialClassification,
        initialClassification.token);
      return { memories: items.map(({ memoryId }) => memoryDto(memories.get(memoryId), true)),
        createdMocs: created, refs, indexRevision };
    }, initialClassification?.deadline?.check);
  }

  function linkMocs(ns, input) {
    return transaction(db, () => {
      assertEpochValue(ns, input.expectedIndexRevision);
      const parent = checkedMoc(ns, input.parentId, 2);
      const child = checkedMoc(ns, input.childId, 1);
      if (parent.revision !== input.expectedParentRevision ||
          child.revision !== input.expectedChildRevision) fail("revision_conflict");
      const existing = db.prepare("SELECT * FROM moc_edges WHERE parent_id = ? AND child_id = ?")
        .get(parent.id, child.id);
      if (existing) return { ref: edgeRef(existing), indexRevision: epoch(ns), duplicate: true };
      const now = new Date().toISOString();
      bumpGroups(new Set([parent.id]), now);
      const currentParent = db.prepare("SELECT revision FROM mocs WHERE id = ?").get(parent.id);
      db.prepare(`INSERT INTO moc_edges
        (parent_id, parent_revision, child_id, child_revision) VALUES (?, ?, ?, ?)`)
        .run(parent.id, currentParent.revision, child.id, child.revision);
      const row = db.prepare("SELECT * FROM moc_edges WHERE parent_id = ? AND child_id = ?")
        .get(parent.id, child.id);
      return { ref: edgeRef(row), indexRevision: advanceEpoch(ns), duplicate: false };
    });
  }

  function classificationSnapshot(ns, ids, guards, expectedIndex) {
    return transaction(db, () => {
      assertIndexAvailable(ns);
      assertEpochValue(ns, expectedIndex);
      const expected = guardsMap(guards);
      if (expected.size !== ids.length || ids.some((id) => !expected.has(id))) fail("invalid_input");
      const memories = ids.map((id) => {
        const memory = db.prepare(`SELECT * FROM memories WHERE ${namespaceWhere}
          AND id = ? AND deleted = 0 AND review_state != 'awaiting' AND currentness = 'current'`).get(...boundary(ns), id);
        if (!safeMemory(ns, memory)) fail("memory_not_found");
        if (memory.revision !== expected.get(id)) fail("revision_conflict");
        return memoryDto(memory, true);
      });
      return { memories, indexRevision: expectedIndex, suppressionEpoch: suppressionEpochInside(ns) };
    }, undefined, { deferred: true });
  }

  function placementRefs(ns, memoryId) {
    return projectPrepare(`SELECT r.*, m.id, m.title, m.owner_id, m.scope, m.project_id FROM moc_memory_refs r
      JOIN mocs m ON m.id = r.moc_id JOIN memories memory ON memory.id = r.memory_id
      WHERE ${qualifiedNamespace("m")} AND m.level = 1 AND ${qualifiedNamespace("memory")}
        AND memory.deleted = 0 AND r.memory_id = ?
        AND r.moc_revision = m.revision AND r.memory_revision = memory.revision
      ORDER BY m.canonical_title, m.id`).all(...boundary(ns), ...boundary(ns), memoryId)
      .map((row) => ({ mocId: row.moc_id, mocRevision: row.moc_revision,
        title: visibleTitle(row) }));
  }

  const titleExpression = `CASE WHEN NOT EXISTS
    (SELECT 1 FROM moc_title_sources missing LEFT JOIN memories source
      ON source.id = missing.memory_id WHERE missing.moc_id = moc.id AND
      (source.id IS NULL OR source.deleted = 1 OR source.currentness != 'current' OR source.owner_id != moc.owner_id OR
       source.scope != moc.scope OR source.project_id != moc.project_id OR
       source.revision != missing.memory_revision))
    AND EXISTS (SELECT 1 FROM moc_title_sources present WHERE present.moc_id = moc.id)
    THEN moc.title ELSE NULL END`;

  function queryCandidateRows(ns, { score, memoryLabel, sourceReceiptLimit = 0,
    scanBoundary, expectedEpoch, expectedSuppressionEpoch, scanBudgetMs = QUERY_SCAN_BUDGET_MS }) {
    const { scan, page, top, floor, pageMs } = QUERY_CANDIDATES;
    if (![0, SOURCE_QUERY_RECEIPT_LIMIT].includes(sourceReceiptLimit)) fail('invalid_input');
    if (!Number.isSafeInteger(scanBudgetMs) || scanBudgetMs < 0 || scanBudgetMs > QUERY_SCAN_BUDGET_MS) fail('invalid_input');
    const replay = scanBoundary !== undefined;
    if (replay && (!scanBoundary || Object.keys(scanBoundary).sort().join(',') !== 'last,rows,stop' ||
        !Number.isSafeInteger(scanBoundary.rows) || scanBoundary.rows < 0 || scanBoundary.rows > scan ||
        !['end', 'budget', 'cap', 'changed'].includes(scanBoundary.stop) ||
        (scanBoundary.rows === 0 ? scanBoundary.last !== null :
          !scanBoundary.last || Object.keys(scanBoundary.last).sort().join(',') !== 'id,updatedAt' ||
          typeof scanBoundary.last.id !== 'string' || typeof scanBoundary.last.updatedAt !== 'string') ||
        !Number.isSafeInteger(expectedEpoch))) fail('invalid_cursor');
    // A scan owns these reset-on-get statements; no cursor or SHARED lock
    // survives a page's COMMIT. Floor and final placement share the cache.
    const discoveryStatements = new Map();
    const discoveryPrepare = sql => {
        sql = projectSQL(sql);
        if (!discoveryStatements.has(sql)) discoveryStatements.set(sql, db.prepare(sql));
        return discoveryStatements.get(sql);
      };
    let primaryError = false;
    const started = performance.now();
    let currentEpoch, currentSuppressionEpoch, readMemo;
    let last = null, visited = 0, more = true, pruned = false, stop;
    const eligible = [];
    const safety = Boolean(cachedContentLayout(db)?.suppressionRevision);
    const extra = safety ? ',owner_id,scope,project_id,review_state' + readAncestry('memories') : '';
    // Sample the actual owner epoch, not the outer request's provisional memo.
    const epochs = () => [epoch(ns), safety ? contentSuppressionFenceInside(db, ns.ownerId) : null];
    const sameEpochs = pair => pair[0] === currentEpoch && pair[1] === currentSuppressionEpoch;
    // Keep the ordinary request's suppression memo for the floor. Its epoch
    // read already checks the fresh owner fence in the same statement as base.
    // Only tail snapshots need independent request accounts below.
    const readPage = work => transaction(db, work, undefined, { deferred: true });
    try {
      let receiptRows = new Map();
      const collectReceipts = memories => {
        if(!sourceReceiptLimit){receiptRows=new Map();return;}
        receiptDeliverySnapshot(db,memories.map(memory=>({namespace:ns,memoryId:memory.id})),readMemo,[],{limit:sourceReceiptLimit,idOrder:true});
        receiptRows = new Map(memories.map(memory => [memory.id, sourceReceiptLimit ? deliveryReceiptRows(db,ns,memory.id,readMemo,{limit:sourceReceiptLimit,idOrder:true}) : []]));
      };
      const scoreMemory = (memory) => {
        const bodyScore = score(memory.content);
        let candidateScore = bodyScore;
        let winningExcerpt;
        if (sourceReceiptLimit) {
          const receipts = receiptRows.get(memory.id) ?? [];
          const deniedReceipts = receiptDenialsInside(db, ns, receipts, readMemo);
          const allowed = receipts.filter(receipt => !deniedReceipts.has(receipt.receipt_key));
          for (const receipt of allowed.slice(0, sourceReceiptLimit)) {
            if (safety && !receiptReadSafety(db, { namespace: ns, receipt, memo: readMemo,
              rawAncestryEmpty: receipt.empty_raw_ancestry === 1 }).allowed) continue;
            const source = validateSourceReceipt(memory.id, receipt, receiptKey);
            // Only admitted receipts compete for the bounded source label.
            const receiptScore = score(source.excerpt);
            // Stable receipt-ID order and strict improvement preserve the first
            // receipt on ties and retain the body label on a body/receipt tie.
            if (receiptScore > candidateScore) {
              candidateScore = receiptScore;
              winningExcerpt = source.excerpt;
            }
          }
        }
        return { memory, score: candidateScore, winningExcerpt };
      };
      const compare = (left, right) => right.score - left.score ||
        (left.memory.id < right.memory.id ? -1 : left.memory.id > right.memory.id ? 1 : 0);
      const physicalSQL = `SELECT id, revision, updated_at FROM memories
        INDEXED BY namespace_memories WHERE ${namespaceWhere} AND deleted = 0`;
      const afterSQL = ' AND updated_at <= ? AND (updated_at < ? OR (updated_at = ? AND id > ?))';
      const orderSQL = ' ORDER BY updated_at DESC, id ASC LIMIT ?';
      const positionOf = row => ({ updatedAt: row.updated_at, id: row.id });
      const firstPage = db.prepare(physicalSQL + orderSQL);
      const nextPage = db.prepare(physicalSQL + afterSQL + orderSQL);
      const physicalRows = (position, limit) => (position ? nextPage : firstPage).all(
        ...boundary(ns), ...(position ? [position.updatedAt, position.updatedAt, position.updatedAt, position.id] : []), limit);
      const projected = projectPrepare(`SELECT id, revision, content${safety ? ',deleted,currentness' + extra : ''}
        FROM memories WHERE ${namespaceWhere} AND id = ? AND revision = ?
          AND deleted = 0 AND review_state != 'awaiting' AND currentness = 'current'`);
      // Materialize the floor in the same single content read as ordinary
      // recall. The extra row proves whether a tail is needed without another
      // statement. Membership and canonical safety still gate every scorer.
      const floorPage = db.prepare(`SELECT id, revision, content, deleted, currentness${extra}, updated_at FROM memories
        INDEXED BY namespace_memories WHERE ${namespaceWhere}
          AND deleted = 0 AND review_state != 'awaiting' AND currentness = 'current'
        ORDER BY updated_at DESC, id ASC LIMIT ?`);
      const retain = candidate => {
        if (eligible.length === top && compare(candidate, eligible.at(-1)) >= 0) { pruned = true; return; }
        let low = 0, high = eligible.length;
        while (low < high) {
          const middle = (low + high) >>> 1;
          if (compare(candidate, eligible[middle]) < 0) high = middle;
          else low = middle + 1;
        }
        eligible.splice(low, 0, candidate);
        if (eligible.length > top) { eligible.pop(); pruned = true; }
      };
      const place = candidate => {
        const { memory, winningExcerpt } = candidate;
        const placement = discoveryPrepare(`SELECT r.* FROM moc_memory_refs r
          JOIN mocs parent ON parent.id = r.moc_id
          WHERE r.memory_id = ? AND r.memory_revision = ? AND ${qualifiedNamespace('parent')}
            AND parent.level = 1 AND parent.revision = r.moc_revision
          ORDER BY parent.canonical_title, parent.id LIMIT 1`)
          .get(memory.id, memory.revision, ...boundary(ns));
        const candidateLabel = memoryLabel(winningExcerpt ?? memory.content);
        return { item: placement
          ? { type: 'ref', ref: memoryRef(placement), label: candidateLabel }
          : { type: 'unfiled', ref: { memoryId: memory.id, revision: memory.revision }, label: candidateLabel } };
      };
      const result = rows => ({ rows, epoch: currentEpoch, suppressionEpoch: currentSuppressionEpoch,
        scanExhausted: stop !== 'changed' && !more && !pruned,
        scanBoundary: { rows: visited, last, stop } });
      const scanRows = (limit, tail) => {
        const pageStarted = performance.now();
        const batch = physicalRows(last, limit);
        collectReceipts(batch);
        let consumed = 0;
        for (const physical of batch) {
          // Residual filters and projection denials consume rows and time.
          const elapsed = performance.now() - started;
          if (tail && !replay && elapsed >= scanBudgetMs) {
            stop = 'budget'; break;
          }
          visited++; consumed++;
          last = positionOf(physical);
          // IDs-only physical reads, then active-generation membership, then
          // projected content and all canonical safety predicates.
          if (discoveryPrepare(`SELECT id FROM memories WHERE ${namespaceWhere} AND id = ?
            AND revision = ?`).get(...boundary(ns), physical.id, physical.revision)) {
            const memory = projected.get(...boundary(ns), physical.id, physical.revision);
            if (memory && (!safety || safeMemory(ns, memory, true))) retain(scoreMemory(memory));
          }
          if (tail && performance.now() - pageStarted >= pageMs) break;
        }
        more = !(consumed === batch.length && batch.length < limit);
        const bound = replay ? scanBoundary.rows : scan;
        if (visited === bound || !tail) more = physicalRows(last, 1).length !== 0;
        if (replay && visited === bound) {
          stop = scanBoundary.stop;
          more = stop !== 'end';
        } else if (!more) stop = 'end';
        else if (!replay && visited === scan) stop = 'cap';
      };
      let floorResult;
      const placements = new Map();
      // The floor, its safety reads and its placement all share ONE normal-
      // timeout snapshot. Small stores need no subsequent read transaction.
      readPage(() => {
        assertIndexAvailable(ns);
        currentEpoch = epoch(ns);
        if (replay && currentEpoch !== expectedEpoch) fail('cursor_stale');
        readMemo = createContentReadMemo(db);
        const limit = Math.min(floor, replay ? scanBoundary.rows : scan);
        const batch = floorPage.all(...boundary(ns), limit + 1);
        collectReceipts(batch.slice(0,limit));
        for (const memory of batch.slice(0, limit)) {
          visited++;
          last = positionOf(memory);
          if (memory.deleted || memory.currentness !== 'current' || safety && !safeMemory(ns, memory, true)) continue;
          if (!discoveryPrepare(`SELECT id FROM memories WHERE ${namespaceWhere} AND id = ?
            AND revision = ?`).get(...boundary(ns), memory.id, memory.revision)) continue;
          retain(scoreMemory(memory));
        }
        more = batch.length > limit;
        if (replay && visited === scanBoundary.rows) {
          stop = scanBoundary.stop;
          more = stop !== 'end';
        } else if (!more) stop = 'end';
        for (const candidate of eligible) placements.set(candidate, place(candidate));
        currentSuppressionEpoch = suppressionEpochInside(ns);
        if (replay && expectedSuppressionEpoch !== undefined &&
            currentSuppressionEpoch !== expectedSuppressionEpoch) fail('cursor_stale');
        floorResult = result(eligible.map(candidate => placements.get(candidate)));
      });
      // A multi-snapshot scan must not leave its E0 memo in the outer request.
      // Tail pages keep independent accounts; delivery still checks the saved
      // epochs. Exhausted floors retain ordinary memo reuse and statement cost.
      const floorReadSet = more && safety && cachedContentSuppressionRequestInside(db, ns.ownerId)?.readSet;
      if (floorReadSet) {
        resetContentSuppressionRequestInside(db);
        contentSuppressionRequestInside(db, floorReadSet, { defer: true });
      }
      // Dropping the tail also drops its signed boundary. Replay reconstructs
      // precisely this floor under E0, never a mixed-epoch candidate list.
      const floorOnly = cause => ({ ...floorResult, scanExhausted: false,
        scanBoundary: { ...floorResult.scanBoundary, stop: cause } });
      const busyStop = {};
      const tryReadPage = work => {
        const savedTimeout = db.prepare('PRAGMA busy_timeout').get().timeout;
        try {
          db.exec('PRAGMA busy_timeout=0');
          return withContentSuppressionRequest(() => readTransaction(db, () => {
            checkInstalledContentSafety(db);
            return work();
          }, { readReady() {
            // Acquire SHARED before any content/suppression/refusal machinery.
            // Only BUSY at this statement is converted to ordinary truncation.
            try {
              db.prepare(`SELECT epoch FROM namespace_epochs WHERE ${namespaceWhere}`).get(...boundary(ns));
            } catch (error) {
              if (isStorageBusy(error)) throw busyStop;
              throw error;
            }
          } }), { fresh: true });
        } catch (error) {
          if (error !== busyStop) throw error;
          return busyStop;
        } finally {
          db.exec('PRAGMA busy_timeout=' + savedTimeout);
        }
      };
      while (!stop) {
        if (!replay && performance.now() - started >= scanBudgetMs) { stop = 'budget'; break; }
        const accepted = tryReadPage(() => {
          if (!sameEpochs(epochs())) return false;
          assertIndexAvailable(ns);
          readMemo = createContentReadMemo(db);
          scanRows(Math.min(page, (replay ? scanBoundary.rows : scan) - visited), true);
          return true;
        });
        if (accepted !== true) {
          if (replay) fail('cursor_stale');
          // Movement and contention both remain ordinary incomplete results.
          return floorOnly(accepted === busyStop ? 'budget' : 'changed');
        }
      }
      if (replay && JSON.stringify({ rows: visited, last, stop }) !== JSON.stringify(scanBoundary)) fail('cursor_stale');
      if (eligible.some(candidate => !placements.has(candidate))) {
        const accepted = tryReadPage(() => {
          if (!sameEpochs(epochs())) return false;
          assertIndexAvailable(ns);
          for (const candidate of eligible) if (!placements.has(candidate)) placements.set(candidate, place(candidate));
          return true;
        });
        if (accepted !== true) {
          if (replay) fail('cursor_stale');
          return floorOnly(accepted === busyStop ? 'budget' : 'changed');
        }
      }
      return result(eligible.map(candidate => placements.get(candidate)));
    } catch (error) {
      primaryError = true;
      throw error;
    } finally {
      const closeErrors = [];
      for (const statement of discoveryStatements.values()) {
        try {
          if (typeof statement.close === 'function') statement.close();
          else if (typeof statement[Symbol.dispose] === 'function') statement[Symbol.dispose]();
        } catch (error) { closeErrors.push(error); }
      }
      discoveryStatements.clear();
      if (!primaryError && closeErrors.length) throw closeErrors[0];
    }
  }

  function mapRows(ns, { purpose, parentRef, limit, offset, expectedEpoch, expectedSuppressionEpoch, memoryLabel = label,
    catalogOnly = false }, inside = false) {
    const work = () => {
      if (expectedSuppressionEpoch !== undefined && expectedSuppressionEpoch !== suppressionEpochInside(ns)) fail('invalid_cursor');
      assertIndexAvailable(ns);
      const currentEpoch = epoch(ns);
      if (expectedEpoch !== undefined && expectedEpoch !== currentEpoch) fail("cursor_stale");
      const count = limit + 1;
      // Carry a canonical ancestry proof in the existing page statement. The
      // direct check below still binds stale placements to their stored version.
      const memoryPage = sql => {
        const layout = cachedContentLayout(db);
        return db.prepare(layout?.suppressionRevision && layout.rawLineage ? `SELECT page.*, EXISTS(
          SELECT 1 FROM receipts ar JOIN raw_receipt_lineage al ON al.receipt_id=ar.id
          JOIN memories am ON am.id=ar.memory_id
          LEFT JOIN raw_conversations ac ON ac.id=al.conversation_id
          WHERE page.child_type='memory' AND ar.memory_id=page.child_id AND
            (ac.owner_id IS NOT am.owner_id OR ac.scope IS NOT am.scope OR ac.project_id IS NOT am.project_id)
        ) AS invalid_raw_ancestry FROM (${projectSQL(sql)}) page` : projectSQL(sql));
      };
      let rows;
      if (catalogOnly) {
        // Classification needs the complete topic catalog, not every placement or
        // unfiled body. Filter before paging so memory growth cannot crowd it out.
        rows = projectPrepare(`SELECT 'moc' row_kind, moc.id moc_id
          FROM mocs moc WHERE ${qualifiedNamespace("moc")}
          ORDER BY moc.level, COALESCE(${titleExpression}, ''), moc.id
          LIMIT ? OFFSET ?`).all(...boundary(ns), count, offset);
      } else if (!parentRef) {
        const recall = purpose === "recall" ? 1 : 0;
        const candidates = `WITH candidates AS (
          SELECT 'moc' row_kind, moc.level sort_level, COALESCE(${titleExpression}, '') sort_title,
            moc.id sort_id, '' sort_ref, moc.id moc_id, NULL parent_id, NULL parent_revision,
            NULL child_id, NULL child_revision, NULL child_type, NULL reason, NULL content
          FROM mocs moc WHERE ${qualifiedNamespace("moc")} AND (? = 0 OR
            (moc.level = 1 AND EXISTS (SELECT 1 FROM moc_memory_refs mr JOIN memories memory
              ON memory.id = mr.memory_id WHERE mr.moc_id = moc.id AND memory.deleted = 0
              AND memory.owner_id = moc.owner_id AND memory.scope = moc.scope
              AND memory.project_id = moc.project_id AND mr.moc_revision = moc.revision
              AND mr.memory_revision = memory.revision)) OR
            (moc.level = 2 AND EXISTS (SELECT 1 FROM moc_edges edge JOIN mocs child
              ON child.id = edge.child_id WHERE edge.parent_id = moc.id AND child.level = 1
              AND child.owner_id = moc.owner_id AND child.scope = moc.scope
              AND child.project_id = moc.project_id AND edge.parent_revision = moc.revision
              AND edge.child_revision = child.revision AND EXISTS
                (SELECT 1 FROM moc_memory_refs mr JOIN memories memory ON memory.id = mr.memory_id
                 WHERE mr.moc_id = child.id AND memory.deleted = 0
                 AND memory.owner_id = child.owner_id AND memory.scope = child.scope
                 AND memory.project_id = child.project_id AND mr.moc_revision = child.revision
                 AND mr.memory_revision = memory.revision))))
          UNION ALL
          SELECT CASE WHEN parent.id IS NULL OR child.id IS NULL OR parent.level != 2 OR child.level != 1
                    OR parent.owner_id != child.owner_id OR parent.scope != child.scope
                    OR parent.project_id != child.project_id
                    OR parent_revision != parent.revision OR child_revision != child.revision
                  THEN 'invalid' ELSE 'edge' END,
            2, COALESCE(${titleExpression.replaceAll("moc.", "child.").replaceAll("moc ", "child ")}, ''),
            edge.child_id, edge.parent_id || ':' || edge.child_id, NULL, edge.parent_id,
            edge.parent_revision, edge.child_id, edge.child_revision, 'moc',
            CASE WHEN parent.id IS NULL OR child.id IS NULL THEN 'not_found'
              WHEN parent.owner_id != child.owner_id OR parent.scope != child.scope
                OR parent.project_id != child.project_id THEN 'not_found'
              WHEN parent.level != 2 OR child.level != 1 THEN 'invalid_level'
              WHEN edge.parent_revision != parent.revision OR edge.child_revision != child.revision THEN 'stale'
              ELSE NULL END, NULL
          FROM moc_edges edge LEFT JOIN mocs parent ON parent.id = edge.parent_id
            LEFT JOIN mocs child ON child.id = edge.child_id
          WHERE ${qualifiedNamespace("parent")}
            AND (? = 0 OR child.id IS NULL OR parent.level != 2 OR child.level != 1
              OR parent.owner_id != child.owner_id OR parent.scope != child.scope
              OR parent.project_id != child.project_id OR edge.parent_revision != parent.revision
              OR edge.child_revision != child.revision OR EXISTS
                (SELECT 1 FROM moc_memory_refs visible_ref JOIN memories visible_memory
                  ON visible_memory.id = visible_ref.memory_id
                 WHERE visible_ref.moc_id = child.id AND visible_memory.deleted = 0
                   AND visible_memory.owner_id = child.owner_id
                   AND visible_memory.scope = child.scope
                   AND visible_memory.project_id = child.project_id
                   AND visible_ref.moc_revision = child.revision
                   AND visible_ref.memory_revision = visible_memory.revision))
          UNION ALL
          SELECT CASE WHEN parent.id IS NULL OR memory.id IS NULL OR parent.level != 1
                    OR memory.owner_id != parent.owner_id OR memory.scope != parent.scope
                    OR memory.project_id != parent.project_id OR memory.deleted = 1
                    OR ref.moc_revision != parent.revision
                    OR ref.memory_revision != memory.revision
                  THEN 'invalid' ELSE 'memory' END,
            1, COALESCE(${titleExpression.replaceAll("moc.", "parent.").replaceAll("moc ", "parent ")}, ''),
            ref.moc_id, ref.memory_id, NULL, ref.moc_id, ref.moc_revision,
            ref.memory_id, ref.memory_revision, 'memory',
            CASE WHEN parent.id IS NULL OR memory.id IS NULL
                OR memory.owner_id != parent.owner_id OR memory.scope != parent.scope
                OR memory.project_id != parent.project_id THEN 'not_found'
              WHEN parent.level != 1 THEN 'invalid_level'
              WHEN memory.deleted = 1 OR ref.moc_revision != parent.revision
                OR ref.memory_revision != memory.revision THEN 'stale'
              ELSE NULL END, NULL
          FROM moc_memory_refs ref LEFT JOIN mocs parent ON parent.id = ref.moc_id
            LEFT JOIN memories memory ON memory.id = ref.memory_id
          WHERE ${qualifiedNamespace("parent")}
          UNION ALL
          SELECT 'unfiled', 3, '', memory.id, '', NULL, NULL, NULL, memory.id,
            memory.revision, 'memory', NULL, NULL
          FROM memories memory WHERE ${qualifiedNamespace("memory")} AND memory.deleted = 0
            AND (memory.filing_status = 'unfiled' OR NOT EXISTS (
              SELECT 1 FROM moc_memory_refs valid_ref JOIN mocs valid_parent ON valid_parent.id = valid_ref.moc_id
              WHERE valid_ref.memory_id = memory.id AND valid_parent.level = 1
                AND valid_parent.owner_id = memory.owner_id AND valid_parent.scope = memory.scope
                AND valid_parent.project_id = memory.project_id AND valid_ref.moc_revision = valid_parent.revision
                AND valid_ref.memory_revision = memory.revision))
        ) SELECT * FROM candidates ORDER BY sort_level, sort_title, sort_id, sort_ref
          LIMIT ? OFFSET ?`;
        // Share body-free, generation-aware metadata across the UNION arms and
        // correlated title/visibility checks. Keep foreign endpoints and title
        // sources: they distinguish missing, stale and cross-namespace refs.
        // These columns exist before the default layout and in every later
        // readable layout; no safety-layout-only column is needed here.
        const sharedCandidates = projectSQL(candidates)
          .replaceAll('index_read_memories', 'map_memories')
          .replaceAll('index_read_mocs', 'map_mocs')
          .replaceAll('index_read_memory_refs', 'map_refs')
          .replaceAll('index_read_edges', 'map_edges');
        const sql = `WITH map_namespace(owner_id, scope, project_id) AS (VALUES (?, ?, ?)),
          map_edges AS MATERIALIZED (
            SELECT * FROM index_read_edges WHERE parent_id IN (
              SELECT id FROM index_read_mocs
              WHERE (owner_id, scope, project_id) IN (SELECT * FROM map_namespace))),
          map_mocs AS MATERIALIZED (
            SELECT id, owner_id, scope, project_id, level, title, revision FROM index_read_mocs
            WHERE (owner_id, scope, project_id) IN (SELECT * FROM map_namespace)
              OR id IN (SELECT child_id FROM map_edges)),
          map_refs AS MATERIALIZED (
            SELECT * FROM index_read_memory_refs WHERE moc_id IN (SELECT id FROM map_mocs)),
          map_memories AS MATERIALIZED (
            SELECT id, owner_id, scope, project_id, deleted, currentness, revision, filing_status
            FROM index_read_memories
            WHERE (owner_id, scope, project_id) IN (SELECT * FROM map_namespace)
              OR id IN (SELECT memory_id FROM map_refs)
              OR id IN (SELECT memory_id FROM moc_title_sources
                WHERE moc_id IN (SELECT id FROM map_mocs)))
          SELECT page.row_kind, page.sort_level, page.sort_title, page.sort_id, page.sort_ref,
            page.moc_id, page.parent_id, page.parent_revision, page.child_id, page.child_revision,
            page.child_type, page.reason, CASE WHEN page.child_type = 'memory' THEN
            (SELECT memory.content FROM index_read_memories memory WHERE memory.id = page.child_id)
            ELSE NULL END AS content
          FROM (${sharedCandidates}) page
          ORDER BY page.sort_level, page.sort_title, page.sort_id, page.sort_ref`;
        rows = memoryPage(sql).all(...boundary(ns), ...boundary(ns), recall, ...boundary(ns), recall,
          ...boundary(ns), ...boundary(ns), count, offset);
      } else {
        const parent = projectPrepare(`SELECT * FROM mocs WHERE ${namespaceWhere} AND id = ?`)
          .get(...boundary(ns), parentRef.mocId);
        if (!parent) fail("moc_not_found");
        if (parent.revision !== parentRef.revision) fail("revision_conflict");
        if (parent.level === 1) {
          rows = memoryPage(`SELECT
            CASE WHEN memory.id IS NULL THEN 'invalid'
              WHEN memory.owner_id != moc.owner_id OR memory.scope != moc.scope
                OR memory.project_id != moc.project_id THEN 'invalid'
              WHEN memory.deleted = 1 OR ref.moc_revision != moc.revision
                OR ref.memory_revision != memory.revision THEN 'invalid' ELSE 'memory' END row_kind,
            1 sort_level, '' sort_title, ref.memory_id sort_id, ref.moc_id sort_ref,
            ref.moc_id parent_id, ref.moc_revision parent_revision, ref.memory_id child_id,
            ref.memory_revision child_revision, 'memory' child_type,
            CASE WHEN memory.id IS NULL THEN 'not_found'
              WHEN memory.owner_id != moc.owner_id OR memory.scope != moc.scope
                OR memory.project_id != moc.project_id THEN 'not_found'
              WHEN memory.deleted = 1 OR ref.moc_revision != moc.revision
                OR ref.memory_revision != memory.revision THEN 'stale' ELSE NULL END reason,
            memory.content content, NULL moc_id
            FROM moc_memory_refs ref JOIN mocs moc ON moc.id = ref.moc_id
              LEFT JOIN memories memory ON memory.id = ref.memory_id
            WHERE ref.moc_id = ? ORDER BY sort_id, sort_ref LIMIT ? OFFSET ?`)
            .all(parent.id, count, offset);
        } else {
          rows = projectPrepare(`WITH edges AS (
            SELECT edge.*, child.level child_level, child.owner_id child_owner,
              child.scope child_scope, child.project_id child_project, child.revision current_child_revision,
              ${titleExpression.replaceAll("moc.", "child.").replaceAll("moc ", "child ")} visible_title,
              EXISTS (SELECT 1 FROM moc_memory_refs visible_ref JOIN memories visible_memory
                ON visible_memory.id = visible_ref.memory_id
                WHERE visible_ref.moc_id = child.id AND visible_memory.deleted = 0
                  AND visible_memory.owner_id = child.owner_id
                  AND visible_memory.scope = child.scope
                  AND visible_memory.project_id = child.project_id
                  AND visible_ref.moc_revision = child.revision
                  AND visible_ref.memory_revision = visible_memory.revision) child_visible,
              CASE WHEN child.id IS NULL THEN 'not_found'
                WHEN child.owner_id != parent.owner_id OR child.scope != parent.scope
                  OR child.project_id != parent.project_id THEN 'not_found'
                WHEN child.level != 1 THEN 'invalid_level'
                WHEN edge.parent_revision != parent.revision OR edge.child_revision != child.revision
                  THEN 'stale' ELSE NULL END reason
            FROM moc_edges edge JOIN mocs parent ON parent.id = edge.parent_id
              LEFT JOIN mocs child ON child.id = edge.child_id WHERE edge.parent_id = ?
          ), candidates AS (
            SELECT 'moc' row_kind, 1 sort_level, COALESCE(visible_title, '') sort_title,
              child_id sort_id, '0' sort_ref, child_id moc_id, parent_id, parent_revision,
              child_id, child_revision, 'moc' child_type, NULL reason, NULL content
              FROM edges WHERE reason IS NULL AND (? = 0 OR child_visible)
            UNION ALL
            SELECT CASE WHEN reason IS NULL THEN 'edge' ELSE 'invalid' END, 1,
              COALESCE(visible_title, ''), child_id, '1', NULL, parent_id, parent_revision,
              child_id, child_revision, 'moc', reason, NULL FROM edges
              WHERE reason IS NOT NULL OR ? = 0 OR child_visible
          ) SELECT * FROM candidates ORDER BY sort_level, sort_title, sort_id, sort_ref
            LIMIT ? OFFSET ?`).all(parent.id, Number(purpose === "recall"),
              Number(purpose === "recall"), count, offset);
        }
      }
      return { rows: rows.map((row) => {
        if (row.child_type === "memory") {
          if (row.invalid_raw_ancestry) fail('evidence_unavailable');
          // A stale placement still refers to its recorded version. Never
          // replace that binding with the current Memory revision.
          const revision = row.child_revision;
          if (contentSuppressionReasonInside(db, ns, { kind: 'memory', key: row.child_id, revision, ancestryChecked: Object.hasOwn(row, 'invalid_raw_ancestry'),
            version: Number.isSafeInteger(revision) ? JSON.stringify(['memory-revision-v1', revision]) : undefined })) fail('evidence_unavailable');
          // Output validation consumes this same versioned metadata decision.
          const proof = cachedContentSuppressionRequestInside(db, ns.ownerId);
          if (proof) (proof.completed ??= new Set()).add(JSON.stringify([ns.ownerId,ns.scope,ns.projectId ?? '', 'memory',row.child_id,revision]));
        }
        if (row.row_kind === "invalid") return { invalidRef: {
          parentId: row.parent_id, childType: row.child_type, childId: row.child_id,
          reason: row.reason,
        } };
        if (row.row_kind === "unfiled") return { item: { type: "unfiled",
          ref: { memoryId: row.child_id, revision: row.child_revision }, label: memoryLabel(row.content) } };
        if (row.row_kind === "moc") {
          const moc = db.prepare("SELECT * FROM mocs WHERE id = ?").get(row.moc_id);
          return { item: { type: "moc", moc: { id: moc.id, level: `L${moc.level}`,
            title: visibleTitle(moc), revision: moc.revision } } };
        }
        const ref = row.child_type === "memory" ? memoryRef({ moc_id: row.parent_id,
          moc_revision: row.parent_revision, memory_id: row.child_id,
          memory_revision: row.child_revision }) : edgeRef({ parent_id: row.parent_id,
          parent_revision: row.parent_revision, child_id: row.child_id,
          child_revision: row.child_revision });
        return { item: { type: "ref", ref,
          label: row.child_type === "memory" ? memoryLabel(row.content) : visibleTitle(
            db.prepare("SELECT * FROM mocs WHERE id = ?").get(row.child_id)) } };
      }), epoch: currentEpoch, suppressionEpoch: suppressionEpochInside(ns) };
    };
    return inside ? work() : transaction(db, work);
  }

  return Object.freeze({ applyPlacement, linkMocs, classificationSnapshot, mapRows, queryCandidateRows,
    placementRefs, mocDto, invalidateMemory,
    // Internal callers already hold the shared transaction and read authority.
    mapRowsInside: (ns, input) => mapRows(ns, input, true),
    topicInside(ns, ref) {
      assertIndexAvailable(ns);
      const row = projectPrepare(`SELECT * FROM mocs WHERE ${namespaceWhere} AND id=?`).get(...boundary(ns), ref.mocId);
      if (!row) fail('moc_not_found');
      if (row.revision !== ref.revision) fail('revision_conflict');
      return { id: row.id, revision: row.revision, level: `L${row.level}`, title: visibleTitle(row) };
    },
    suppressionFence(ns) { return cachedContentLayout(db)?.suppressionRevision
      ? transaction(db, () => suppressionEpochInside(ns), undefined, { deferred: true }) : null; },
    assertEpoch(ns, expected, suppressionEpoch) { return transaction(db, () => {
      assertEpochValue(ns, expected);
      if (suppressionEpoch !== undefined && suppressionEpoch !== suppressionEpochInside(ns)) fail('cursor_stale');
    }, undefined, { deferred: true }); } });
}
