import { createHash, randomUUID } from "node:crypto";
import { openDatabase, transaction } from "./database.mjs";
import { createMocStorage } from "./moc-storage.mjs";
import { createAdmissionStorage } from "./admission-storage.mjs";
import { createStagedEvidenceStorage } from './staged-evidence-storage.mjs';
import { createConflictStorage } from "./conflict-storage.mjs";
import { createIndexStorage } from "./index-storage.mjs";
import { createSupersessionStorage } from "./supersession-storage.mjs";
import { createOrderedCaptureStorage } from './ordered-capture-storage.mjs';
import { createQualificationStorage } from './claim-qualification-storage.mjs';
import { sourceEvidence, isSourceContext } from './source-evidence.mjs';
import { createQualifiedTransitionStorage } from './qualified-transition-storage.mjs';
import { createRationaleStorage } from './rationale-storage.mjs';
import { fail, object } from "./validation.mjs";

const where = "owner_id = ? AND scope = ? AND project_id = ?";
const boundary = (ns) => [ns.ownerId, ns.scope, ns.projectId];

/** Shared persistence runtime used by both the legacy and envelope facades. */
export function createMemoryRuntime(input) {
  object(input, ["path"]);
  const db = openDatabase(input.path);
  let identity;
  try {
    identity = db.prepare(`SELECT store_id AS storeId, cursor_secret AS cursorSecret
      FROM store_metadata WHERE singleton = 1`).get();
    if (!identity) fail("unsupported_database");
  } catch (error) {
    db.close();
    throw error;
  }
  let closed = false;
  let mocStorage;
  const ready = () => { if (closed) fail("store_closed"); };

  function activeRow(ns, id) {
    return db.prepare(`SELECT * FROM memories WHERE ${where} AND id = ? AND deleted = 0`)
      .get(...boundary(ns), id);
  }

  function currentRow(ns, id) {
    const row = activeRow(ns, id);
    return row?.currentness === 'current' ? row : undefined;
  }

  function epoch(ns) {
    return db.prepare(`SELECT epoch FROM namespace_epochs WHERE
      owner_id = ? AND scope = ? AND project_id = ?`).get(...boundary(ns))?.epoch ?? 1;
  }

  function advanceEpoch(ns) {
    db.prepare(`INSERT INTO namespace_epochs(owner_id, scope, project_id, epoch)
      VALUES (?, ?, ?, 2) ON CONFLICT(owner_id, scope, project_id)
      DO UPDATE SET epoch = epoch + 1`).run(...boundary(ns));
    return epoch(ns);
  }

  function isSuppressed(ns, value) {
    return Boolean(db.prepare(`SELECT 1 FROM suppressed WHERE ${where} AND fingerprint = ?`)
      .get(...boundary(ns), value));
  }

  function assertNotSuppressed(ns, value) {
    if (isSuppressed(ns, value)) fail("memory_suppressed");
  }

  function suppress(ns, value) {
    db.prepare(`INSERT OR IGNORE INTO suppressed
      (owner_id, scope, project_id, fingerprint) VALUES (?, ?, ?, ?)`)
      .run(...boundary(ns), value);
  }

  const receiptKey = receipt => createHash("sha256").update(JSON.stringify(receipt)).digest("hex");

  function attach(id, receipt, now, inserted = []) {
    const key = receiptKey(receipt);
    const receiptId = randomUUID();
    const changes = db.prepare(`INSERT OR IGNORE INTO receipts
      (id, memory_id, receipt_key, client, session_id, event_id, role, excerpt, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(receiptId, id, key, receipt.client,
      receipt.sessionId, receipt.eventId, receipt.role, receipt.excerpt, now).changes;
    if (changes) inserted.push(receiptId);
    return changes;
  }

  function legacyDto(memory) {
    if (!memory) return null;
    const receipts = db.prepare(`SELECT client, session_id AS sessionId,
      event_id AS eventId, role, excerpt, created_at AS createdAt
      FROM receipts WHERE memory_id = ? ORDER BY created_at, receipt_key`).all(memory.id);
    return {
      id: memory.id, content: memory.content, kind: memory.kind,
      scope: memory.scope, projectId: memory.project_id || null,
      origin: memory.origin, confidence: memory.confidence, revision: memory.revision,
      createdAt: memory.created_at, updatedAt: memory.updated_at,
      receipts: receipts.map((receipt) => ({ ...receipt })),
    };
  }

  function metadataDto(memory) {
    return {
      id: memory.id,
      namespace: {
        ownerId: memory.owner_id,
        scope: memory.scope,
        projectId: memory.project_id || null,
      },
      kind: memory.kind,
      origin: memory.origin,
      confidence: memory.confidence,
      revision: memory.revision,
      state: memory.currentness === 'historical' ? 'historical' : 'active',
      filing: { status: memory.filing_status },
      receiptCount: memory.receipt_count,
      createdAt: memory.created_at,
      updatedAt: memory.updated_at,
    };
  }

  function detailDto(memory) {
    const withCount = { ...memory, receipt_count: db.prepare(
      "SELECT count(*) AS n FROM receipts WHERE memory_id = ?").get(memory.id).n };
    return { ...metadataDto(withCount), content: memory.content };
  }

  function memoryDto(memory, includeContent = false) {
    const result = detailDto(memory);
    return includeContent ? result : metadataDto({ ...memory, receipt_count: result.receiptCount });
  }

  function admit(ns, value, projection = {}) {
    ready();
    return transaction(db, () => {
      assertNotSuppressed(ns, value.fingerprint);
      conflictStorage.validateTargets(ns, value.conflictHints);
      const result = admitMutation(ns, value, projection);
      const changed = conflictStorage.insertBatch(ns,
        [{ memoryId: result.memory.id, hints: value.conflictHints }], "explicit-hint");
      return { ...result, changed: result.changed || changed, indexRevision: epoch(ns) };
    });
  }

  // Caller owns the transaction, including admission-claim completion when used
  // in a batch. Explicit and inferred writes share all mutation/invalidation rules.
  function admitMutation(ns, value, projection = {}) {
    assertNotSuppressed(ns, value.fingerprint);
    const insertedReceiptIds = [];
    const existing = db.prepare(`SELECT * FROM memories WHERE ${where}
      AND fingerprint = ? AND deleted = 0`).get(...boundary(ns), value.fingerprint);
    const now = new Date().toISOString();
    if (existing) {
      if (value.qualification !== undefined && value.content !== existing.content) fail('qualification_conflict');
      let changed = false;
      for (const receipt of value.receipts) changed = Boolean(attach(existing.id, receipt, now, insertedReceiptIds)) || changed;
      qualificationStorage.bind(existing, value.qualification, value.receipts, true, value.content);
      const explicit = value.origin === "explicit";
      const kind = explicit ? value.kind : existing.kind;
      const origin = explicit ? "explicit" : existing.origin;
      const confidence = !explicit && existing.origin === "explicit"
        ? existing.confidence : Math.max(existing.confidence, value.confidence);
      if (kind !== existing.kind || origin !== existing.origin || confidence !== existing.confidence) {
        changed = true;
      }
      if (changed) {
        conflictStorage.invalidateMemory(existing.id);
        mocStorage.invalidateMemory(ns, existing.id, now);
        db.prepare(`UPDATE memories SET kind = ?, origin = ?, confidence = ?,
          revision = revision + 1, updated_at = ? WHERE id = ?`)
          .run(kind, origin, confidence, now, existing.id);
      }
      const memory = activeRow(ns, existing.id);
      return {
        memory, ...(projection.legacy ? { legacyMemory: legacyDto(memory) } : {}), deduplicated: true,
        indexRevision: changed ? advanceEpoch(ns) : epoch(ns), changed, insertedReceiptIds,
      };
    }
    const id = randomUUID();
    db.prepare(`INSERT INTO memories
      (id, owner_id, scope, project_id, fingerprint, content, kind, origin,
       confidence, revision, deleted, created_at, updated_at) VALUES
      (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?)`).run(id, ...boundary(ns),
      value.fingerprint, value.content, value.kind, value.origin, value.confidence, now, now);
    for (const receipt of value.receipts) attach(id, receipt, now, insertedReceiptIds);
    const memory = activeRow(ns, id);
    qualificationStorage.bind(memory, value.qualification, value.receipts, false, value.content);
    return { memory, ...(projection.legacy ? { legacyMemory: legacyDto(memory) } : {}), deduplicated: false,
      indexRevision: advanceEpoch(ns), changed: true, insertedReceiptIds };
  }

  function correct(ns, id, value, expectedRevision, projection = {}) {
    ready();
    return transaction(db, () => {
      const current = activeRow(ns, id);
      if (!current) fail("memory_not_found");
      if (current.revision !== expectedRevision) fail("revision_conflict");
      if (current.currentness === 'historical') fail('memory_historical');
      assertNotSuppressed(ns, value.fingerprint);
      const other = db.prepare(`SELECT id FROM memories WHERE ${where}
        AND fingerprint = ? AND deleted = 0 AND id != ?`)
        .get(...boundary(ns), value.fingerprint, id);
      if (other) fail("memory_conflict");
      stagedEvidence.purgeNamespace(ns);
      if (current.fingerprint !== value.fingerprint) suppress(ns, current.fingerprint);
      const now = new Date().toISOString();
      conflictStorage.invalidateMemory(id);
      mocStorage.invalidateMemory(ns, id, now);
      qualificationStorage.clear(id);
      db.prepare(`UPDATE memories SET content = ?, fingerprint = ?, kind = ?,
        origin = 'explicit', confidence = 1, revision = revision + 1, updated_at = ?
        WHERE id = ?`).run(value.content, value.fingerprint, value.kind, now, id);
      db.prepare("DELETE FROM receipts WHERE memory_id = ?").run(id);
      for (const receipt of value.receipts) attach(id, receipt, now);
      const memory = activeRow(ns, id);
      return { memory,
        ...(projection.legacy ? { legacyMemory: legacyDto(memory) } : {}),
        ...(projection.detail ? { detail: detailDto(memory) } : {}),
        indexRevision: advanceEpoch(ns) };
    });
  }

  function forget(ns, id, expectedRevision) {
    ready();
    return transaction(db, () => {
      const current = activeRow(ns, id);
      if (!current) return { forgotten: false, indexRevision: epoch(ns) };
      if (current.revision !== expectedRevision) fail("revision_conflict");
      suppress(ns, current.fingerprint);
      stagedEvidence.purgeNamespace(ns);
      const now = new Date().toISOString();
      conflictStorage.invalidateMemory(id);
      mocStorage.invalidateMemory(ns, id, now);
      qualificationStorage.clear(id);
      db.prepare(`UPDATE memories SET content = NULL, deleted = 1,
        revision = revision + 1, updated_at = ? WHERE id = ?`)
        .run(now, id);
      db.prepare("DELETE FROM receipts WHERE memory_id = ?").run(id);
      return { forgotten: true, indexRevision: advanceEpoch(ns) };
    });
  }

  function supersede(ns, id, value, expectedRevision) {
    ready();
    return transaction(db, () => {
      const previous = activeRow(ns, id);
      if (!previous) fail('memory_not_found');
      if (previous.revision !== expectedRevision) fail('revision_conflict');
      if (previous.currentness === 'historical') fail('memory_historical');
      if (previous.fingerprint === value.fingerprint) fail('invalid_ref');
      const result = admitMutation(ns, value);
      const receiptIds = [...new Set(value.receipts.map(receipt => db.prepare(
        'SELECT id FROM receipts WHERE memory_id = ? AND receipt_key = ?')
        .get(result.memory.id, receiptKey(receipt)).id))];
      const retired = supersessionStorage.retire(ns, previous, result.memory, receiptIds);
      return { ...retired, memory: { id: result.memory.id, revision: result.memory.revision },
        deduplicated: result.deduplicated };
    });
  }

  function qualifiedRow(ns, ref) {
    const memory = activeRow(ns, ref.memoryId);
    if (!memory) fail('memory_not_found');
    if (memory.revision !== ref.expectedRevision) fail('revision_conflict');
    if (memory.currentness !== 'current') fail('memory_historical');
    return memory;
  }

  function bindQualifiedClaim(ns, input) {
    ready();
    return transaction(db, () => qualifiedTransitionStorage.bind(ns, qualifiedRow(ns, input), input.slotId));
  }

  function transitionQualified(ns, input) {
    ready();
    return transaction(db, () => {
      if (input.predecessor.memoryId === input.replacement.memoryId) fail('invalid_ref');
      const previous = qualifiedRow(ns, input.predecessor);
      const replacement = qualifiedRow(ns, input.replacement);
      return supersessionStorage.retireQualified(ns, previous, replacement);
    });
  }

  function transitionQualifiedSet(ns, input) {
    ready();
    return transaction(db, () => {
      const ids = input.predecessors.map(ref => ref.memoryId);
      if (new Set(ids).size !== ids.length || ids.includes(input.replacement.memoryId)) fail('invalid_ref');
      const previous = input.predecessors.map(ref => qualifiedRow(ns, ref));
      const replacement = qualifiedRow(ns, input.replacement);
      return supersessionStorage.retireQualifiedSet(ns, previous, replacement);
    });
  }

  function legacyGet(ns, id) {
    ready();
    return transaction(db, () => legacyDto(currentRow(ns, id)));
  }

  function legacyList(ns, count) {
    ready();
    return transaction(db, () => db.prepare(`SELECT * FROM memories WHERE ${where}
      AND deleted = 0 AND currentness = 'current' ORDER BY updated_at DESC, id LIMIT ?`)
      .all(...boundary(ns), count).map(legacyDto));
  }

  function legacySearch(ns, terms, count) {
    ready();
    return transaction(db, () => db.prepare(`SELECT * FROM memories WHERE ${where}
      AND deleted = 0 AND currentness = 'current'`).all(...boundary(ns))
      .map((memory) => ({ memory, score: terms.reduce((n, term) =>
        n + Number(memory.content.toLowerCase().includes(term)), 0) }))
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score || b.memory.updated_at.localeCompare(a.memory.updated_at)
        || a.memory.id.localeCompare(b.memory.id))
      .slice(0, count).map(({ memory }) => legacyDto(memory)));
  }

  function listPage(ns, statuses, count, anchor, expectedEpoch, states = ['active', 'historical']) {
    ready();
    return transaction(db, () => {
      const currentEpoch = epoch(ns);
      if (expectedEpoch !== undefined && currentEpoch !== expectedEpoch) fail("cursor_stale");
      let sql = `SELECT memories.*, (SELECT count(*) FROM receipts
        WHERE receipts.memory_id = memories.id) AS receipt_count
        FROM memories WHERE ${where} AND deleted = 0
        AND filing_status IN (${statuses.map(() => "?").join(",")})`;
      const params = [...boundary(ns), ...statuses];
      if (states.length === 1) {
        sql += ' AND currentness = ?';
        params.push(states[0] === 'active' ? 'current' : 'historical');
      }
      if (anchor) {
        sql += " AND (updated_at < ? OR (updated_at = ? AND id > ?))";
        params.push(anchor.updatedAt, anchor.updatedAt, anchor.id);
      }
      sql += " ORDER BY updated_at DESC, id ASC LIMIT ?";
      params.push(count + 1);
      return { rows: db.prepare(sql).all(...params).map(metadataDto), epoch: currentEpoch };
    });
  }

  function getPage(ns, id, count, anchor, expectedEpoch, includeQualification = false) {
    ready();
    return transaction(db, () => {
      const currentEpoch = epoch(ns);
      if (expectedEpoch !== undefined && currentEpoch !== expectedEpoch) fail("cursor_stale");
      const memory = db.prepare(`SELECT memories.*, (SELECT count(*) FROM receipts
        WHERE receipts.memory_id = memories.id) AS receipt_count FROM memories
        WHERE ${where} AND id = ? AND deleted = 0`).get(...boundary(ns), id);
      if (!memory) fail("memory_not_found");
      let sql = `SELECT id, client, session_id AS sessionId, event_id AS eventId,
        role, excerpt, created_at AS createdAt FROM receipts WHERE memory_id = ?`;
      const params = [id];
      if (anchor) {
        sql += " AND (created_at > ? OR (created_at = ? AND id > ?))";
        params.push(anchor.createdAt, anchor.createdAt, anchor.id);
      }
      sql += " ORDER BY created_at ASC, id ASC LIMIT ?";
      params.push(count + 1);
      return { memory: { ...metadataDto(memory), content: memory.content },
        receipts: db.prepare(sql).all(...params).map((receipt) => ({ ...receipt })),
        placements: mocStorage.placementRefs(ns, id),
        conflicts: conflictStorage.inspect(ns, id),
        ...(includeQualification ? { qualification: qualificationStorage.inspect(memory) } : {}),
        ...(memory.currentness === 'historical'
          ? { supersession: supersessionStorage.inspect(ns, id) } : {}), epoch: currentEpoch };
    });
  }

  function receiptPrefix(id, offset, count) {
    return db.prepare(`SELECT id, client, session_id AS sessionId, event_id AS eventId,
      role, excerpt, created_at AS createdAt FROM receipts WHERE memory_id = ?
      ORDER BY created_at, id LIMIT ? OFFSET ?`).all(id, count, offset)
      .map((row) => ({ ...row }));
  }

  function readSourceEvidence(row) {
    const receipts = db.prepare('SELECT * FROM receipts WHERE memory_id = ? ORDER BY created_at, id LIMIT 101').all(row.id);
    const count = detailDto(row).receiptCount;
    qualificationStorage.inspect(row);
    return sourceEvidence(row, receipts, count, receiptKey);
  }

  function fetchPage(ns, ref, offset, expectedEpoch, view = 'current', includeQualification = false, contextMode) {
    ready();
    return transaction(db, () => {
      const currentEpoch = epoch(ns);
      if (expectedEpoch !== undefined && currentEpoch !== expectedEpoch) fail('cursor_stale');
      const candidate = view === 'historical' ? activeRow(ns, ref.memoryId) : currentRow(ns, ref.memoryId);
      const row = candidate?.currentness === view ? candidate : undefined;
      const reason = !row ? 'not_found' : row.revision !== ref.revision ? 'stale' : null;
      if (reason) return { invalidRef: { memoryId: ref.memoryId, reason }, epoch: currentEpoch };
      if (isSourceContext(contextMode)) return { source: readUsageEvidence(ns, row, contextMode), epoch: currentEpoch };
      const memory = detailDto(row);
      return { memory, receipts: receiptPrefix(row.id, offset, 101), epoch: currentEpoch,
        ...(includeQualification ? { qualification: qualificationStorage.inspect(row) } : {}),
        ...(view === 'historical' ? { supersession: supersessionStorage.inspect(ns, row.id) } : {}) };
    });
  }

  function readUsageEvidence(ns, row, mode) {
    return { ...readSourceEvidence(row), ...(mode === 'rationale-evidence'
      ? { rationale: rationaleStorage.inspectInside(ns, { memoryId: row.id, revision: row.revision }) } : {}) };
  }

  function sourceSnapshot(namespaces, count, expected) {
    ready();
    return transaction(db, () => {
      const boundaries = namespaces.map((namespace, index) => {
        indexStorage.assertAvailable(namespace);
        const indexRevision = epoch(namespace);
        if (expected && expected.namespaces[index].indexRevision !== indexRevision) fail('index_revision_conflict');
        return { namespace: { ownerId: namespace.ownerId, scope: namespace.scope,
          projectId: namespace.projectId || null }, indexRevision };
      });
      // Enumerate the physical current set independently of MOC navigation.
      // The limit+1 probe bounds work and detects overflow before source reads.
      const identities = namespaces.flatMap((namespace, namespaceIndex) => db.prepare(`
        SELECT id, revision FROM memories INDEXED BY capture_current_memories
        WHERE ${where} AND deleted = 0 AND currentness = 'current' ORDER BY id LIMIT ?`)
        .all(...boundary(namespace), count + 1).map(row => ({ ...row, namespaceIndex })));
      if (identities.length > count) fail(expected ? 'revision_conflict' : 'context_item_too_large');
      const memories = identities.map(({ id, revision, namespaceIndex }) => {
        const namespace = namespaces[namespaceIndex];
        // An incomplete active projection is an error, never a smaller claim
        // of completeness. Preserve the shared index generation's authority.
        if (!db.prepare(`SELECT id FROM index_read_memories WHERE ${where} AND id = ? AND revision = ?`)
          .get(...boundary(namespace), id, revision)) fail('index_revision_conflict');
        return { namespaceIndex, ...readSourceEvidence(currentRow(namespace, id)) };
      });
      const snapshot = { memories, namespaces: boundaries, coverage: 'complete-current-admitted',
        semanticCoverage: 'unassessed', evidenceTrust: 'untrusted-data-not-instructions' };
      if (expected && JSON.stringify(snapshot) !== JSON.stringify(expected)) fail('revision_conflict');
      return snapshot;
    });
  }

  function recallSnapshot(candidates, selected, namespaces = [], includeQualification = false, contextMode) {
    ready();
    return transaction(db, () => {
      // This transaction is the return linearization point across the read set.
      const rows = candidates.map(({ namespace, memoryId, revision }) => {
        const row = currentRow(namespace, memoryId);
        if (!row || row.revision !== revision) fail('revision_conflict');
        return row;
      });
      for (const { namespace, indexRevision } of namespaces) {
        indexStorage.assertAvailable(namespace);
        if (epoch(namespace) !== indexRevision) fail('index_revision_conflict');
      }
      if (isSourceContext(contextMode)) {
        const sources = rows.map((row, index) => {
          const source = readUsageEvidence(candidates[index].namespace, row, contextMode);
          if (JSON.stringify(source) !== JSON.stringify(candidates[index].sourceEvidence)) fail('revision_conflict');
          return source;
        });
        return selected.map(index => sources[index]);
      }
      const qualifications = includeQualification ? rows.map(row => qualificationStorage.inspect(row)) : null;
      return selected.map((index) => {
        const memory = detailDto(rows[index]);
        return { memory, receipts: receiptPrefix(memory.id, 0, candidates[index].receiptLimit),
          receiptCount: memory.receiptCount,
          ...(includeQualification ? { qualification: qualifications[index] } : {}) };
      });
    });
  }

  const conflictStorage = createConflictStorage({ db, activeRow: currentRow, advanceEpoch });
  const rationaleStorage = createRationaleStorage({ db, currentRow, readSourceEvidence, epoch, advanceEpoch });
  const qualificationStorage = createQualificationStorage({ db, receiptKey });
  const qualifiedTransitionStorage = createQualifiedTransitionStorage({ db, qualificationStorage, advanceEpoch, epoch });
  const indexStorage = createIndexStorage({ db, epoch, advanceEpoch });
  mocStorage = createMocStorage({ db, epoch, advanceEpoch, memoryDto,
    invalidateConflicts: conflictStorage.invalidateMemory, assertIndexAvailable: indexStorage.assertAvailable,
    rationaleStorage });
  const supersessionStorage = createSupersessionStorage({ db, activeRow, suppress, advanceEpoch,
    invalidateConflicts: conflictStorage.invalidateMemory, invalidateMemory: mocStorage.invalidateMemory,
    evaluateQualified: qualifiedTransitionStorage.evaluate,
    evaluateQualifiedSet: qualifiedTransitionStorage.evaluateSet, epoch });
  const stagedEvidence = createStagedEvidenceStorage({ db });
  const admissionStorage = createAdmissionStorage({
    db, admitMutation, isSuppressed, activeRow, epoch, conflictStorage, stagedEvidence,
  });
  const orderedStorage = createOrderedCaptureStorage({ db, admissionStorage, epoch, activeRow,
    supersessionStorage, receiptKey, isSuppressed });

  return Object.freeze({
    identity, ready, admit, correct, forget, supersede, bindQualifiedClaim, transitionQualified, transitionQualifiedSet,
    legacyGet, legacyList, legacySearch,
    listPage, getPage, fetchPage, recallSnapshot, sourceSnapshot,
    rationaleSnapshot(ns, refs, inputMode) { ready(); return rationaleStorage.snapshot(ns, refs, inputMode); },
    commitRationale(ns, refs, snapshot, proposals, writeMode) {
      ready(); return rationaleStorage.commit(ns, refs, snapshot, proposals, writeMode);
    },
    getRationale(ns, ref, view) { ready(); return rationaleStorage.inspect(ns, ref, view); },
    claimOrdered(ns, snapshot) { ready(); return orderedStorage.claim(ns, snapshot); },
    discoverOrdered(ns, snapshot, order, items) {
      ready(); return orderedStorage.discover(ns, snapshot, order, items);
    },
    finishOrdered(ns, snapshot, token, order, prepared, judged) {
      ready(); return orderedStorage.finish(ns, snapshot, token, order, prepared.discovery,
        prepared.items, judged.decisions, judged.reason);
    },
    rebuildIndex(ns, input) { ready(); return indexStorage.rebuildIndex(ns, input); },
    claimAdmission(ns, input) { ready(); return admissionStorage.claimAdmission(ns, input); },
    claimCaptureEvidence(ns, input) {
      ready();
      if (input.view === undefined) fail('invalid_input');
      return admissionStorage.claimAdmission(ns, input, undefined, input.view);
    },
    inspectCaptureEvidence(ns, input) { ready(); return stagedEvidence.inspect(ns, input); },
    discardCaptureEvidence(ns, input) { ready(); return stagedEvidence.discard(ns, input); },
    assertCaptureEvidence(ns, input) { ready(); return admissionStorage.assertCaptureEvidence(ns, input); },
    finishAdmission(ns, input) { ready(); return admissionStorage.finishAdmission(ns, input); },
    abandonAdmission(ns, input) { ready(); return admissionStorage.abandonAdmission(ns, input); },
    applyPlacement(ns, proposal, guards, index) {
      ready(); return mocStorage.applyPlacement(ns, proposal, guards, index);
    },
    linkMocs(ns, input) { ready(); return mocStorage.linkMocs(ns, input); },
    mapRows(ns, input) { ready(); return mocStorage.mapRows(ns, input); },
    queryCandidateRows(ns, input) { ready(); return mocStorage.queryCandidateRows(ns, input); },
    classificationSnapshot(ns, ids, guards, index) {
      ready(); return mocStorage.classificationSnapshot(ns, ids, guards, index);
    },
    assertEpoch(ns, index) { ready(); return mocStorage.assertEpoch(ns, index); },
    epoch(ns) { ready(); return epoch(ns); },
    close() { if (!closed) { db.close(); closed = true; } },
  });
}
