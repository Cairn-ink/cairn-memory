import { contentReadSafety, sourceReadSafety, cardContributorsInside } from './content-safety.mjs';
import { createCardCurrentStorage, cardDependencyFence } from './card-current-storage.mjs';
import { CARD_CURRENT_METHODS } from './card-current-input.mjs';
import { randomUUID } from 'node:crypto';
import { createOperationLedger, createPrivateEffectWriter, createPrivateCursor } from './private-operation-helpers.mjs';
import { transaction } from './database.mjs';
import { fail } from './validation.mjs';
import { EVIDENCE_METHODS } from './private-evidence-input.mjs';
import { createPrivateEvidenceStorage } from './private-evidence-storage.mjs';
import { cardApplicabilityInside, reviewCardApplicabilityInside } from './private-evidence-schema.mjs';
import { ORGANIZATION_METHODS, ORGANIZATION_READS } from './private-organization-input.mjs';
import { createPrivateOrganizationStorage } from './private-organization-storage.mjs';
import { createCardReceiptSources } from './card-receipt-sources.mjs';
import { createCardRawSources } from './card-raw-sources.mjs';
import { cardText, keyed, noteInput, OWNER_NOTE_CAP, pageLimit, refs, sourceRef } from './private-card-input.mjs';

const boundary = ns => [ns.ownerId, ns.scope, ns.projectId ?? ''];
const where = 'owner_id=? AND scope=? AND project_id=?';
const now = () => new Date().toISOString();
const size = value => Buffer.byteLength(JSON.stringify({ ok: true, value }), 'utf8');
const attribution = () => ({ sourceAuthor: null, claimant: null, subject: null,
  eventTime: null, commitment: 'unknown', status: 'unassessed' });

/** Uses the same canonical SQLite handle as all existing Memory operations. */
export function createPrivateCardStorage({ db, identity, ready, memoryMapInside, memoryTopicInside, rawSources = false }) {
  const dependencies = createCardCurrentStorage({ db, identity });
  const secret = identity.cursorSecret;
  const binding = (purpose, value) => keyed(secret, purpose, [identity.storeId, value]);
  const receiptSources = createCardReceiptSources(db, binding);
  const raw = createCardRawSources(db, identity);
  const epoch = ns => db.prepare(`SELECT generation FROM card_epochs WHERE ${where}`)
    .get(...boundary(ns))?.generation ?? 1;
  function advance(ns) {
    db.prepare(`INSERT INTO card_epochs VALUES(?,?,?,2) ON CONFLICT(owner_id,scope,project_id)
      DO UPDATE SET generation=generation+1`).run(...boundary(ns));
  }
  const note = (ns, id) => db.prepare(`SELECT * FROM card_notes WHERE ${where} AND id=?`).get(...boundary(ns), id);
  const card = (ns, id) => db.prepare(`SELECT * FROM private_cards WHERE ${where} AND id=?`).get(...boundary(ns), id);
  function refFor(ns, row) {
    return { type: 'submitted-note', namespace: ns, sourceId: row.id, revision: row.revision,
      contentIdentity: binding('submitted-note-content-v1', [ns, row.id, row.revision, row.text]),
      completeness: 'provided-note' };
  }
  function resolve(ns, ref) {
    sourceRef(ref, ns, rawSources);
    if (!sourceReadSafety(db, { identity, namespace: ns, ref, strict: true }).allowed) fail('source_unavailable');
    if (ref.type === 'raw') return raw.resolve(ns, ref);
    if (ref.type === 'receipt') return receiptSources.resolve(ns, ref);
    const row = note(ns, ref.sourceId);
    if (!row || row.state !== 'available' || row.revision !== ref.revision ||
        refFor(ns, row).contentIdentity !== ref.contentIdentity) fail('source_unavailable');
    return row;
  }
  function validateRefs(ns, values, existing = [], currentCardId = '') {
    const selected = refs(values, ns, rawSources), rawBudget = raw.budget();
    let bytes = 0;
    for (const ref of selected) {
      if (ref.type === 'raw') {
        try { raw.resolve(ns,ref,rawBudget); }
        catch (error) {
          if (error.code === 'source_budget_exceeded') fail('invalid_input');
          if (!['source_unavailable','source_excluded'].includes(error.code) ||
              !existing.some(old => JSON.stringify(old) === JSON.stringify(ref))) throw error;
        }
        continue;
      }
      const table = ref.type === 'receipt' ? 'card_memory_bindings' : 'card_bindings';
      const key = ref.type === 'receipt' ? 'memory_id' : 'source_id';
      const dependents = db.prepare(`SELECT count(*) AS n FROM (SELECT DISTINCT c.id FROM ${table} b
        JOIN private_cards c ON c.id=b.card_id WHERE b.${key}=?
        AND c.state IN ('draft','confirmed') AND c.id!=? LIMIT 128)`)
        .get(ref.memoryId ?? ref.sourceId, currentCardId).n;
      if (dependents >= 128) fail('dependency_limit_reached');
      try { bytes += resolve(ns, ref).byte_count; }
      catch (error) {
        if (error.code !== 'source_unavailable' || !existing.some(old => JSON.stringify(old) === JSON.stringify(ref))) throw error;
      }
    }
    raw.checkFanout(selected, currentCardId);
    if (bytes+rawBudget.used > 64_000) fail('invalid_input');
    return selected;
  }
  function insertNote(ns, input) {
    const value = noteInput(input), bytes = Buffer.byteLength(value.text, 'utf8');
    const used = db.prepare('SELECT byte_count FROM card_note_usage WHERE owner_id=?').get(ns.ownerId)?.byte_count ?? 0;
    if (used + bytes > OWNER_NOTE_CAP) fail('quota_reached');
    const id = randomUUID(), timestamp = now();
    db.prepare('INSERT INTO card_notes VALUES(?,?,?,?,1,\'available\',?,?,?,?)')
      .run(id, ...boundary(ns), value.text, bytes, value.occurredAt, timestamp);
    db.prepare(`INSERT INTO card_note_usage VALUES(?,?) ON CONFLICT(owner_id)
      DO UPDATE SET byte_count=byte_count+excluded.byte_count`).run(ns.ownerId, bytes);
    return refFor(ns, note(ns, id));
  }
  function getRefs(id) {
    const values = cardContributorsInside(db, id);
    if (!rawSources && values.some(ref => ref.type === 'raw')) fail('source_unavailable');
    return values;
  }
  function putRefs(id, values) {
    raw.put(id,values);
    db.prepare('DELETE FROM card_bindings WHERE card_id=?').run(id);
    db.prepare('DELETE FROM card_memory_bindings WHERE card_id=?').run(id);
    const insert = db.prepare('INSERT INTO card_bindings VALUES(?,?,?,?)');
    const memoryInsert = db.prepare('INSERT INTO card_memory_bindings VALUES(?,?,?,?,?,?)');
    values.forEach((ref, position) => ref.type === 'raw' ? undefined : ref.type === 'receipt'
      ? memoryInsert.run(id, ref.memoryId, ref.memoryRevision, ref.receiptId, JSON.stringify(ref), position)
      : insert.run(id, ref.sourceId, JSON.stringify(ref), position));
  }
  function support(ns, values) {
    const available = values.length > 0 && values.every(ref => {
      try { resolve(ns, ref); return true; }
      catch (error) { if (error.code === 'source_unavailable' || ref.type === 'raw' &&
        ['source_excluded','raw_crypto_unavailable'].includes(error.code)) return false; throw error; }
    });
    return { status: available ? 'eligible' : 'unavailable', applicability: 'unknown',
      reasons: [available ? 'unassessed' : values.some(ref => ref.type === 'receipt') ? 'memory_changed' : 'source_deleted'] };
  }
  function metadata(ns, row, readSet = [ns], { historicalReason = false, deadlineAt = Infinity } = {}) {
    const review = cardApplicabilityInside(db, row), currentDependency = historicalReason ? null : dependencies.compare(ns, row, readSet, { deadlineAt });
    return { id: row.id, namespace: ns, revision: row.revision, state: row.state,
      bodyRevision: row.body_revision, origin: 'authored', support: { ...support(ns, getRefs(row.id)),
        applicability: review.applicability,
        applicabilityReviewedRevision: review.reviewedRevision, checkedAt: row.updated_at,
        ...(currentDependency ? { currentDependency } : {}) },
      createdAt: row.created_at, updatedAt: row.updated_at, confirmedAt: row.confirmed_at };
  }
  function cardSafe(ns, row, method = 'getCard') {
    return contentReadSafety(db, { identity, namespace: ns, method, ref: { type: 'card', namespace: ns,
      cardId: row.id, revision: row.revision, bodyRevision: row.body_revision } }).allowed;
  }
  function detail(ns, row, readSet, intent) {
    if (!row || !cardSafe(ns, row)) return null;
    return { ...metadata(ns, row, readSet, intent), title: row.title, body: row.body,
      bindings: getRefs(row.id).map(ref => ({ id: ref.type === 'raw' ? raw.bindingId(ref) : ref.sourceId ?? ref.receiptId, source: ref,
        dependency: ref.type === 'receipt' ? 'memory-interpretation' : 'source-only',
        memoryRef: ref.type === 'receipt' ? { type: 'memory', namespace: ns,
          memoryId: ref.memoryId, revision: ref.memoryRevision } : null,
        receiptId: ref.receiptId ?? null,
        role: 'required', attribution: attribution() })), triggerMemoryRefs: [] };
  }
  function existing(ns, input, state) {
    const row = card(ns, input.cardId);
    if (!row) fail('card_not_found');
    if (row.revision !== input.expectedRevision) fail('revision_conflict');
    if (row.state !== state) fail('card_state_conflict');
    return row;
  }
  const effect = createPrivateEffectWriter(db, 'card_effects');
  const ledger = createOperationLedger(db, 'card_operations');
  const receipt = (row, effectCount = 0) => ({ id: row.id, revision: row.revision,
    state: row.state, bodyRevision: row.body_revision ?? null, effectCount });
  function purgeCard(ns, row, state, actionId) {
    db.prepare(`UPDATE private_cards SET state=?,revision=revision+1,title=NULL,body=NULL,
      updated_at=? WHERE id=?`).run(state, now(), row.id);
    db.prepare('DELETE FROM card_bindings WHERE card_id=?').run(row.id);
    db.prepare('DELETE FROM card_memory_bindings WHERE card_id=?').run(row.id);
    raw.put(row.id,[]);
    effect(ns, state === 'deleted' ? 'card_deleted' : 'evidence_invalidated', 'card', row.id, row.revision + 1, actionId);
    return card(ns, row.id);
  }
  function mutate(method, ns, input, currentAccess) {
    if (CARD_CURRENT_METHODS.includes(method)) {
      const row = existing(ns, input, 'confirmed');
      validateRefs(ns, getRefs(row.id), [], row.id);
      return dependencies.write(ns, row, { ...input, method }, currentAccess);
    }
    if (method === 'submitSourceNote') return { source: insertNote(ns, { text: input.text, occurredAt: input.occurredAt }) };
    if (method === 'createCardDraft') {
      const value = input.input;
      const selected = value.authoredInput !== undefined ? [insertNote(ns, value.authoredInput)]
        : value.memoryRefs !== undefined ? receiptSources.fromMemories(ns, value.memoryRefs) : value.sources;
      const sources = validateRefs(ns, selected);
      const id = randomUUID(), timestamp = now();
      db.prepare(`INSERT INTO private_cards VALUES(?,?,?,?,1,'draft',?,?,NULL,?,?,NULL)`)
        .run(id, ...boundary(ns), cardText(value.title, 200), cardText(value.body, 20_000), timestamp, timestamp);
      putRefs(id, sources);
      return receipt(card(ns, id));
    }
    if (method === 'deleteSourceNote') {
      const row = note(ns, input.sourceId);
      if (!row) fail('source_not_found');
      if (row.revision !== input.expectedRevision) fail('revision_conflict');
      if (row.state !== 'available') fail('source_unavailable');
      db.prepare(`UPDATE card_notes SET text=NULL,byte_count=0,state='deleted',revision=revision+1 WHERE id=?`).run(row.id);
      db.prepare('UPDATE card_note_usage SET byte_count=byte_count-? WHERE owner_id=?').run(row.byte_count, ns.ownerId);
      // Admission caps each note at 128 live dependents. Verify the invariant
      // before invalidation; the whole deletion rolls back if a store is corrupt.
      let count = 0;
      const dependents = db.prepare(`SELECT c.id FROM private_cards c JOIN card_bindings b ON b.card_id=c.id
        WHERE b.source_id=? AND c.state IN ('draft','confirmed') ORDER BY c.id LIMIT 129`).all(row.id);
      if (dependents.length > 128) fail('dependency_limit_reached');
      for (const { id } of dependents) {
        const dependent = card(ns, id);
        if (dependent.state === 'draft') purgeCard(ns, dependent, 'cancelled', input.actionId);
        else {
          db.prepare('UPDATE private_cards SET revision=revision+1,updated_at=? WHERE id=?').run(now(), id);
          effect(ns, 'evidence_invalidated', 'card', id, dependent.revision + 1, input.actionId);
        }
        count++;
      }
      effect(ns, 'evidence_invalidated', 'submitted-note', row.id, row.revision + 1, input.actionId);
      return { id: row.id, revision: row.revision + 1, state: 'deleted', bodyRevision: null, effectCount: count + 1 };
    }
    const confirmed = ['editKnowledgeCard', 'deleteKnowledgeCard'].includes(method);
    const row = existing(ns, input, confirmed ? 'confirmed' : 'draft');
    if (method === 'cancelCardDraft' || method === 'deleteKnowledgeCard') {
      return receipt(purgeCard(ns, row, method === 'cancelCardDraft' ? 'cancelled' : 'deleted', input.actionId), 1);
    }
    getRefs(row.id); // Ordinary facades cannot consume unsupported Raw bindings.
    if (method === 'confirmCardDraft') {
      if (!cardSafe(ns, row, method)) fail('source_unavailable');
      validateRefs(ns, getRefs(row.id), [], row.id);
      db.prepare(`UPDATE private_cards SET state='confirmed',revision=revision+1,body_revision=1,
        confirmed_at=?,updated_at=? WHERE id=?`).run(now(), now(), row.id);
      if (input.applicability !== undefined) reviewCardApplicabilityInside(db, row.id, row.revision + 1, input.applicability);
      if (input.currentDependencies) dependencies.write(ns, card(ns, row.id), { ...input, expectedRevision: row.revision + 1, expectedDependencyRevision: null }, currentAccess);
      return receipt(card(ns, row.id));
    }
    const selected = validateRefs(ns, input.bindings, confirmed ? getRefs(row.id) : [], row.id);
    const title = cardText(input.title, 200), body = cardText(input.body, 20_000);
    const bodyRevision = confirmed ? row.body_revision + Number(row.title !== title || row.body !== body) : null;
    db.prepare('UPDATE private_cards SET revision=revision+1,title=?,body=?,body_revision=?,updated_at=? WHERE id=?')
      .run(title, body, bodyRevision, now(), row.id);
    putRefs(row.id, selected);
    if (confirmed) reviewCardApplicabilityInside(db, row.id, row.revision + 1, input.applicability);
    effect(ns, 'evidence_invalidated', 'card', row.id, row.revision + 1, input.actionId);
    return receipt(card(ns, row.id), 1);
  }
  const cardEpoch = ns => { const fence = cardDependencyFence(db, ns); return Object.keys(fence).length ? binding('card-dependency-cursor-v1', [epoch(ns), fence]) : epoch(ns); };
  const cardCursor = createPrivateCursor({ binding, purpose: 'card-cursor-v1', epoch: cardEpoch });
  const legacyCursor = createPrivateCursor({ binding, purpose: 'card-cursor-v1', epoch });
  function read(method, ns, input) {
    if (method === 'getCard') {
      const result = { card: detail(ns, card(ns, input.cardId)) };
      if (size(result) > (input.responseByteLimit ?? 65536)) fail('context_item_too_large');
      return result;
    }
    if (method === 'getPrivateCardUsage') return { version: 'submitted-note-usage-v1',
      ownerId: ns.ownerId, submittedNoteBytes: db.prepare('SELECT byte_count FROM card_note_usage WHERE owner_id=?').get(ns.ownerId)?.byte_count ?? 0,
      retainedSourceBytes: db.prepare('SELECT byte_count FROM card_note_usage WHERE owner_id=?').get(ns.ownerId)?.byte_count ?? 0,
      limitBytes: OWNER_NOTE_CAP, raw: 'not-implemented' };
    if (method === 'inspectCardOperation') {
      const row = db.prepare(`SELECT * FROM card_operations WHERE ${where} AND action_id=?`).get(...boundary(ns), input.operationActionId);
      return { operation: row ? { namespace: ns, actionId: row.action_id, revision: 1,
        method: row.method, targetId: row.target_id, state: 'completed', leaseId: null,
        leaseUntil: null, providerOutcome: 'not-started', result: JSON.parse(row.result),
        errorCode: null, createdAt: row.created_at, updatedAt: row.created_at } : null };
    }
    const count = pageLimit(input.limit);
    const expected = { store: identity.storeId, namespace: ns, method, limit: count,
      ...(method === 'listCards' ? { states: [...input.states].sort() } : {}),
      ...(method === 'getSource' ? { source: sourceRef(input.source, ns) } : {}) };
    const { encode: cursorEncode, decode: cursorDecode } = method === 'listCards' ? cardCursor : legacyCursor;
    const cursor = cursorDecode(input.cursor, expected, ns);
    if (method === 'getSource') {
      const row = resolve(ns, input.source), parts = [];
      let start = cursor?.after ?? 0;
      if (!Number.isSafeInteger(start) || start < 0 || start >= row.text.length ||
          (start > 0 && /[\uDC00-\uDFFF]/.test(row.text[start]))) fail('invalid_cursor');
      while (start < row.text.length && parts.length < count) {
        let end = Math.min(start + 4000, row.text.length);
        if (end < row.text.length && /[\uDC00-\uDFFF]/.test(row.text[end])) end--;
        parts.push({ start, end, text: row.text.slice(start, end) }); start = end;
      }
      let result;
      do {
        const end = parts.at(-1)?.end ?? (cursor?.after ?? 0), complete = end === row.text.length;
        result = { source: sourceRef(input.source, ns), parts: [...parts], coverage: {
          status: complete ? 'complete' : 'budget_exhausted', completeness: input.source.completeness,
          conversationCoverage: 'unknown', included: parts.length, omitted: complete ? 0 : null },
        nextCursor: complete ? null : cursorEncode({ binding: expected, epoch: epoch(ns), after: end }) };
        if (size(result) <= 65536) return result;
        parts.pop();
      } while (parts.length);
      fail('context_item_too_large');
    }
    const isCards = method === 'listCards';
    let cardAfter, cardComplete;
    const cardRows = [];
    if (isCards) {
      const after = typeof cursor?.after === 'number' ? db.prepare(`SELECT id FROM private_cards WHERE ${where} AND rowid=?`)
        .get(...boundary(ns), cursor.after)?.id : cursor?.after ?? '';
      if (after === undefined) fail('cursor_stale');
      const rows = db.prepare(`SELECT rowid AS cursor_row,id,revision,state,body_revision,created_at,updated_at,confirmed_at
        FROM private_cards WHERE ${where} AND state IN (${input.states.map(() => '?').join(',')}) AND id>? ORDER BY id LIMIT ?`)
        .all(...boundary(ns), ...input.states, after, count + 1);
      cardComplete = rows.length <= count;
      cardAfter = rows.slice(0, count).at(-1)?.cursor_row;
      cardRows.push(...rows.slice(0, count).filter(row => cardSafe(ns, row, 'listCards')));
    }
    let items = isCards ? cardRows.map(row => metadata(ns, row)) :
      db.prepare(`SELECT * FROM card_effects WHERE ${where} AND ordinal>? ORDER BY ordinal LIMIT ?`)
        .all(...boundary(ns), cursor?.after ?? 0, count + 1).map(row => ({ effectId: row.effect_id,
          namespace: ns, kind: row.kind, entity: { type: row.entity_type, id: row.entity_id },
          revision: row.revision, actionId: row.action_id, affectedIds: [], cursor: null, ordinal: row.ordinal }));
    let complete = isCards ? cardComplete : items.length <= count;
    items = items.slice(0, count);
    while (true) {
      const result = { [isCards ? 'cards' : 'effects']: items,
        coverage: { status: complete ? 'complete' : 'budget_exhausted', included: items.length, omitted: complete ? 0 : null },
        nextCursor: complete ? null : cursorEncode({ binding: expected, epoch: isCards ? cardEpoch(ns) : epoch(ns),
          after: isCards ? cardAfter : items.at(-1)?.ordinal }) };
      if (size(result) <= 65536) return result;
      complete = false; items.pop();
      if (isCards) cardAfter = cardRows[items.length - 1]?.cursor_row;
      if (!items.length) fail('context_item_too_large');
    }
  }
  const evidence = createPrivateEvidenceStorage({ db, identity,
    cardDetailInside: (ns, id) => detail(ns, card(ns, id)),
    receiptRefInside: (ns, memory, receipt) => receiptSources.refInside(ns, memory, receipt) });
  const organization = createPrivateOrganizationStorage({ db, identity, memoryMapInside, memoryTopicInside,
    cardDetailInside: (ns, id) => detail(ns, card(ns, id)) });
  return Object.freeze({
    // Internal shared-read seams: caller owns scope authorization and transaction.
    cardDetailInside(ns, id, readSet, intent) { ready(); return detail(ns, card(ns, id), readSet, intent); },
    cardMetadataInside(ns, row) { ready(); return row && cardSafe(ns, row, 'listCards') ? metadata(ns, row) : null; },
    receiptRefInside(ns, memoryRow, receiptRow) { ready(); return receiptSources.refInside(ns, memoryRow, receiptRow); },
    payloadBinding: value => binding('card-action-v1', value),
    call(method, ns, input, payloadBinding, isRead, context) {
      ready();
      return transaction(db, () => {
        if (EVIDENCE_METHODS.includes(method)) return evidence.call(method, ns, input, context.accessGeneration);
        if (ORGANIZATION_READS.includes(method)) return organization.call(method, ns, input, context.accessGeneration);
        if (isRead) return read(method, ns, input);
        const replay = ledger.replay(ns, input.actionId, method, payloadBinding);
        if (replay !== undefined) return replay;
        const result = ORGANIZATION_METHODS.includes(method) ? organization.call(method, ns, input, context.accessGeneration) : mutate(method, ns, input, context.access);
        if (size(result) > 65536) fail('context_item_too_large');
        const target = result.source?.sourceId ?? result.id;
        ledger.record(ns, input.actionId, method, payloadBinding, target, result, now());
        advance(ns);
        return result;
      });
    },
  });
}
