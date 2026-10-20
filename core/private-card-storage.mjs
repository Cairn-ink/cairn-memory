import { randomUUID } from 'node:crypto';
import { transaction } from './database.mjs';
import { fail } from './validation.mjs';
import { cardText, keyed, noteInput, OWNER_NOTE_CAP, pageLimit, refs, sourceRef } from './private-card-input.mjs';

const boundary = ns => [ns.ownerId, ns.scope, ns.projectId ?? ''];
const where = 'owner_id=? AND scope=? AND project_id=?';
const now = () => new Date().toISOString();
const size = value => Buffer.byteLength(JSON.stringify({ ok: true, value }), 'utf8');
const attribution = () => ({ sourceAuthor: null, claimant: null, subject: null,
  eventTime: null, commitment: 'unknown', status: 'unassessed' });

/** Uses the same canonical SQLite handle as all existing Memory operations. */
export function createPrivateCardStorage({ db, identity, ready }) {
  const secret = identity.cursorSecret;
  const binding = (purpose, value) => keyed(secret, purpose, [identity.storeId, value]);
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
    sourceRef(ref, ns);
    const row = note(ns, ref.sourceId);
    if (!row || row.state !== 'available' || row.revision !== ref.revision ||
        refFor(ns, row).contentIdentity !== ref.contentIdentity) fail('source_unavailable');
    return row;
  }
  function validateRefs(ns, values, existing = [], currentCardId = '') {
    const selected = refs(values, ns);
    let bytes = 0;
    for (const ref of selected) {
      const dependents = db.prepare(`SELECT count(*) AS n FROM (SELECT 1 FROM card_bindings b
        JOIN private_cards c ON c.id=b.card_id WHERE b.source_id=?
        AND c.state IN ('draft','confirmed') AND c.id!=? LIMIT 128)`).get(ref.sourceId, currentCardId).n;
      if (dependents >= 128) fail('dependency_limit_reached');
      const row = note(ns, ref.sourceId);
      if (row?.state === 'deleted' && existing.some(old => JSON.stringify(old) === JSON.stringify(ref))) continue;
      bytes += resolve(ns, ref).byte_count;
    }
    if (bytes > 64_000) fail('invalid_input');
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
    return db.prepare('SELECT source_ref FROM card_bindings WHERE card_id=? ORDER BY position')
      .all(id).map(row => JSON.parse(row.source_ref));
  }
  function putRefs(id, values) {
    db.prepare('DELETE FROM card_bindings WHERE card_id=?').run(id);
    const insert = db.prepare('INSERT INTO card_bindings VALUES(?,?,?,?)');
    values.forEach((ref, position) => insert.run(id, ref.sourceId, JSON.stringify(ref), position));
  }
  function support(ns, values) {
    const available = values.length > 0 && values.every(ref => {
      const row = note(ns, ref.sourceId);
      return row?.state === 'available' && row.revision === ref.revision &&
        refFor(ns, row).contentIdentity === ref.contentIdentity;
    });
    return { status: available ? 'eligible' : 'unavailable', applicability: 'unknown',
      reasons: [available ? 'unassessed' : 'source_deleted'] };
  }
  function metadata(ns, row) {
    return { id: row.id, namespace: ns, revision: row.revision, state: row.state,
      bodyRevision: row.body_revision, origin: 'authored', support: { ...support(ns, getRefs(row.id)), checkedAt: row.updated_at },
      createdAt: row.created_at, updatedAt: row.updated_at, confirmedAt: row.confirmed_at };
  }
  function detail(ns, row) {
    if (!row || ['cancelled', 'deleted'].includes(row.state)) return null;
    return { ...metadata(ns, row), title: row.title, body: row.body,
      bindings: getRefs(row.id).map(ref => ({ id: ref.sourceId, source: ref,
        dependency: 'source-only', memoryRef: null, receiptId: null,
        role: 'required', attribution: attribution() })), triggerMemoryRefs: [] };
  }
  function existing(ns, input, state) {
    const row = card(ns, input.cardId);
    if (!row) fail('card_not_found');
    if (row.revision !== input.expectedRevision) fail('revision_conflict');
    if (row.state !== state) fail('card_state_conflict');
    return row;
  }
  function effect(ns, kind, type, id, revision, actionId) {
    const ordinal = db.prepare('SELECT coalesce(max(ordinal),0)+1 AS n FROM card_effects').get().n;
    db.prepare('INSERT INTO card_effects VALUES(?,?,?,?,?,?,?,?,?,?)')
      .run(randomUUID(), ...boundary(ns), kind, type, id, revision, actionId, ordinal);
  }
  const receipt = (row, effectCount = 0) => ({ id: row.id, revision: row.revision,
    state: row.state, bodyRevision: row.body_revision ?? null, effectCount });
  function purgeCard(ns, row, state, actionId) {
    db.prepare(`UPDATE private_cards SET state=?,revision=revision+1,title=NULL,body=NULL,
      updated_at=? WHERE id=?`).run(state, now(), row.id);
    db.prepare('DELETE FROM card_bindings WHERE card_id=?').run(row.id);
    effect(ns, state === 'deleted' ? 'card_deleted' : 'evidence_invalidated', 'card', row.id, row.revision + 1, actionId);
    return card(ns, row.id);
  }
  function mutate(method, ns, input) {
    if (method === 'submitSourceNote') return { source: insertNote(ns, { text: input.text, occurredAt: input.occurredAt }) };
    if (method === 'createCardDraft') {
      const value = input.input;
      const selected = value.authoredInput !== undefined ? [insertNote(ns, value.authoredInput)] : value.sources;
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
    if (method === 'confirmCardDraft') {
      validateRefs(ns, getRefs(row.id), [], row.id);
      db.prepare(`UPDATE private_cards SET state='confirmed',revision=revision+1,body_revision=1,
        confirmed_at=?,updated_at=? WHERE id=?`).run(now(), now(), row.id);
      return receipt(card(ns, row.id));
    }
    const selected = validateRefs(ns, input.bindings, confirmed ? getRefs(row.id) : [], row.id);
    const title = cardText(input.title, 200), body = cardText(input.body, 20_000);
    const bodyRevision = confirmed ? row.body_revision + Number(row.title !== title || row.body !== body) : null;
    db.prepare('UPDATE private_cards SET revision=revision+1,title=?,body=?,body_revision=?,updated_at=? WHERE id=?')
      .run(title, body, bodyRevision, now(), row.id);
    putRefs(row.id, selected);
    effect(ns, 'evidence_invalidated', 'card', row.id, row.revision + 1, input.actionId);
    return receipt(card(ns, row.id), 1);
  }
  function cursorEncode(value) {
    const body = Buffer.from(JSON.stringify(value)).toString('base64url');
    return `${body}.${binding('card-cursor-v1', body)}`;
  }
  function cursorDecode(cursor, expected, ns) {
    if (cursor === undefined) return null;
    const [body, signature, extra] = cursor.split('.');
    if (extra !== undefined || !body || signature !== binding('card-cursor-v1', body)) fail('invalid_cursor');
    let value;
    try { value = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); } catch { fail('invalid_cursor'); }
    if (JSON.stringify(value.binding) !== JSON.stringify(expected)) fail('invalid_cursor');
    if (value.epoch !== epoch(ns)) fail('cursor_stale');
    if (!(typeof value.after === 'string' || Number.isSafeInteger(value.after))) fail('invalid_cursor');
    return value;
  }
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
        result = { source: refFor(ns, row), parts: [...parts], coverage: {
          status: complete ? 'complete' : 'budget_exhausted', completeness: 'provided-note',
          conversationCoverage: 'unknown', included: parts.length, omitted: complete ? 0 : null },
        nextCursor: complete ? null : cursorEncode({ binding: expected, epoch: epoch(ns), after: end }) };
        if (size(result) <= 65536) return result;
        parts.pop();
      } while (parts.length);
      fail('context_item_too_large');
    }
    const isCards = method === 'listCards';
    let items = isCards ? db.prepare(`SELECT id,revision,state,body_revision,created_at,updated_at,confirmed_at FROM private_cards WHERE ${where}
      AND state IN (${input.states.map(() => '?').join(',')}) AND id>? ORDER BY id LIMIT ?`)
      .all(...boundary(ns), ...input.states, cursor?.after ?? '', count + 1).map(row => metadata(ns, row)) :
      db.prepare(`SELECT * FROM card_effects WHERE ${where} AND ordinal>? ORDER BY ordinal LIMIT ?`)
        .all(...boundary(ns), cursor?.after ?? 0, count + 1).map(row => ({ effectId: row.effect_id,
          namespace: ns, kind: row.kind, entity: { type: row.entity_type, id: row.entity_id },
          revision: row.revision, actionId: row.action_id, affectedIds: [], cursor: null, ordinal: row.ordinal }));
    let complete = items.length <= count;
    items = items.slice(0, count);
    while (true) {
      const result = { [isCards ? 'cards' : 'effects']: items,
        coverage: { status: complete ? 'complete' : 'budget_exhausted', included: items.length, omitted: complete ? 0 : null },
        nextCursor: complete ? null : cursorEncode({ binding: expected, epoch: epoch(ns),
          after: isCards ? items.at(-1)?.id : items.at(-1)?.ordinal }) };
      if (size(result) <= 65536) return result;
      complete = false; items.pop();
      if (!items.length) fail('context_item_too_large');
    }
  }
  return Object.freeze({
    payloadBinding: value => binding('card-action-v1', value),
    call(method, ns, input, payloadBinding, isRead) {
      ready();
      return transaction(db, () => {
        if (isRead) return read(method, ns, input);
        const old = db.prepare(`SELECT * FROM card_operations WHERE ${where} AND action_id=?`).get(...boundary(ns), input.actionId);
        if (old) {
          if (old.payload_binding !== payloadBinding || old.method !== method) fail('action_conflict');
          return JSON.parse(old.result);
        }
        const result = mutate(method, ns, input);
        if (size(result) > 65536) fail('context_item_too_large');
        const target = result.source?.sourceId ?? result.id;
        db.prepare('INSERT INTO card_operations VALUES(?,?,?,?,?,?,?,?,?)')
          .run(...boundary(ns), input.actionId, method, payloadBinding, target, JSON.stringify(result), now());
        advance(ns);
        return result;
      });
    },
  });
}
