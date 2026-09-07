import { randomUUID } from "node:crypto";
import { transaction } from "./database.mjs";
import { fail } from "./validation.mjs";

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
export function createMocStorage({ db, epoch, advanceEpoch, memoryDto, invalidateConflicts, assertIndexAvailable }) {
  // Read authority is generation-owned; writes below continue targeting declarations.
  // Title validity deliberately consults every original source binding.
  function projectPrepare(sql) {
    return db.prepare(sql.replace(/\bmoc_memory_refs\b/g, 'index_read_memory_refs')
      .replace(/\bmoc_edges\b/g, 'index_read_edges').replace(/\bmocs\b/g, 'index_read_mocs')
      .replace(/\bmemories\b/g, 'index_read_memories'));
  }
  const mocById = (ns, id) => db.prepare(`SELECT * FROM mocs WHERE ${namespaceWhere} AND id = ?`)
    .get(...boundary(ns), id);

  function visibleTitle(moc) {
    const sources = db.prepare(`SELECT s.memory_revision, memory.* FROM moc_title_sources s
      LEFT JOIN memories memory ON memory.id = s.memory_id WHERE s.moc_id = ?`).all(moc.id);
    if (sources.length === 0 || sources.some((source) => !source.id || source.deleted ||
        source.owner_id !== moc.owner_id || source.scope !== moc.scope ||
        source.project_id !== moc.project_id || source.revision !== source.memory_revision)) return null;
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
      titleSources: titleSources(moc.id).map(({ memoryId, revision }) =>
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

  function applyPlacement(ns, proposal, guards, expectedIndex) {
    return transaction(db, () => {
      assertEpochValue(ns, expectedIndex);
      const items = proposal.items;
      const expected = guardsMap(guards);
      if (expected.size !== items.length || items.some((item) => !expected.has(item.memoryId))) {
        fail("invalid_input");
      }

      const memories = new Map();
      for (const item of items) {
        const memory = db.prepare(`SELECT * FROM memories WHERE ${namespaceWhere}
          AND id = ? AND deleted = 0`).get(...boundary(ns), item.memoryId);
        if (!memory) fail("memory_not_found");
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
        return { memories: resultMemories, createdMocs: [], refs, indexRevision: expectedIndex };
      }

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
        if (revision !== memory.revision) invalidateConflicts(item.memoryId);
        updateMemory.run(filed, revision, revision, now, item.memoryId);
        deleteRefs.run(item.memoryId);
        for (const mocId of desiredByMemory.get(item.memoryId))
          insertRef.run(item.memoryId, revision, mocId);
        memory.revision = revision;
        memory.filing_status = filed;
        if (revision !== expected.get(item.memoryId)) memory.updated_at = now;
      }

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
      return { memories: items.map(({ memoryId }) => memoryDto(memories.get(memoryId), true)),
        createdMocs: created, refs, indexRevision };
    });
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
          AND id = ? AND deleted = 0`).get(...boundary(ns), id);
        if (!memory) fail("memory_not_found");
        if (memory.revision !== expected.get(id)) fail("revision_conflict");
        return memoryDto(memory, true);
      });
      return { memories, indexRevision: expectedIndex };
    });
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
      (source.id IS NULL OR source.deleted = 1 OR source.owner_id != moc.owner_id OR
       source.scope != moc.scope OR source.project_id != moc.project_id OR
       source.revision != missing.memory_revision))
    AND EXISTS (SELECT 1 FROM moc_title_sources present WHERE present.moc_id = moc.id)
    THEN moc.title ELSE NULL END`;

  function mapRows(ns, { purpose, parentRef, limit, offset, expectedEpoch }) {
    return transaction(db, () => {
      assertIndexAvailable(ns);
      const currentEpoch = epoch(ns);
      if (expectedEpoch !== undefined && expectedEpoch !== currentEpoch) fail("cursor_stale");
      const count = limit + 1;
      let rows;
      if (!parentRef) {
        const recall = purpose === "recall" ? 1 : 0;
        const sql = `WITH candidates AS (
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
              ELSE NULL END, memory.content
          FROM moc_memory_refs ref LEFT JOIN mocs parent ON parent.id = ref.moc_id
            LEFT JOIN memories memory ON memory.id = ref.memory_id
          WHERE ${qualifiedNamespace("parent")}
          UNION ALL
          SELECT 'unfiled', 3, '', memory.id, '', NULL, NULL, NULL, memory.id,
            memory.revision, 'memory', NULL, memory.content
          FROM memories memory WHERE ${qualifiedNamespace("memory")} AND memory.deleted = 0
            AND (memory.filing_status = 'unfiled' OR NOT EXISTS (
              SELECT 1 FROM moc_memory_refs valid_ref JOIN mocs valid_parent ON valid_parent.id = valid_ref.moc_id
              WHERE valid_ref.memory_id = memory.id AND valid_parent.level = 1
                AND valid_parent.owner_id = memory.owner_id AND valid_parent.scope = memory.scope
                AND valid_parent.project_id = memory.project_id AND valid_ref.moc_revision = valid_parent.revision
                AND valid_ref.memory_revision = memory.revision))
        ) SELECT * FROM candidates ORDER BY sort_level, sort_title, sort_id, sort_ref
          LIMIT ? OFFSET ?`;
        rows = projectPrepare(sql).all(...boundary(ns), recall, ...boundary(ns), recall,
          ...boundary(ns), ...boundary(ns), count, offset);
      } else {
        const parent = projectPrepare(`SELECT * FROM mocs WHERE ${namespaceWhere} AND id = ?`)
          .get(...boundary(ns), parentRef.mocId);
        if (!parent) fail("moc_not_found");
        if (parent.revision !== parentRef.revision) fail("revision_conflict");
        if (parent.level === 1) {
          rows = projectPrepare(`SELECT
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
        if (row.row_kind === "invalid") return { invalidRef: {
          parentId: row.parent_id, childType: row.child_type, childId: row.child_id,
          reason: row.reason,
        } };
        if (row.row_kind === "unfiled") return { item: { type: "unfiled",
          ref: { memoryId: row.child_id, revision: row.child_revision }, label: label(row.content) } };
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
          label: row.child_type === "memory" ? label(row.content) : visibleTitle(
            db.prepare("SELECT * FROM mocs WHERE id = ?").get(row.child_id)) } };
      }), epoch: currentEpoch };
    });
  }

  return Object.freeze({ applyPlacement, linkMocs, classificationSnapshot, mapRows,
    placementRefs, mocDto, invalidateMemory,
    assertEpoch(ns, expected) { return transaction(db, () => assertEpochValue(ns, expected)); } });
}
