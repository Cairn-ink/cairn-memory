import { createHash, timingSafeEqual } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { createQualificationStorage } from './claim-qualification-storage.mjs';
import { evidenceInput, evidenceRefs } from './private-evidence-input.mjs';
import { keyed } from './private-card-input.mjs';
import { fail } from './validation.mjs';

const where = 'owner_id=? AND scope=? AND project_id=?';
const boundary = ns => [ns.ownerId, ns.scope, ns.projectId ?? ''];
const size = value => Buffer.byteLength(JSON.stringify({ ok: true, value }), 'utf8');
const words = text => new Set(text.toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? []);
const attribution = { status: 'unassessed', commitment: 'unknown' };

/** All methods run synchronously inside the caller's shared SQLite transaction.
 * The only callbacks are internal canonical readers, never host/model ports. */
export function createPrivateEvidenceStorage({ db, identity, cardDetailInside, receiptRefInside }) {
  const bind = (purpose, value) => keyed(identity.cursorSecret, purpose, [identity.storeId, value]);
  const qualification = createQualificationStorage({ db, receiptKey: receipt =>
    createHash('sha256').update(JSON.stringify(receipt)).digest('hex') });
  const generations = ns => ({ memory: db.prepare(`SELECT epoch FROM namespace_epochs WHERE ${where}`)
    .get(...boundary(ns))?.epoch ?? 1,
  card: db.prepare(`SELECT generation FROM card_epochs WHERE ${where}`).get(...boundary(ns))?.generation ?? 1 });
  function encode(purpose, value, maximum) {
    const body = Buffer.from(JSON.stringify(value)).toString('base64url');
    const token = `${body}.${bind(purpose, body)}`;
    if (token.length > maximum) fail('context_item_too_large');
    return token;
  }
  function decode(purpose, token, code) {
    const [body, signature, extra] = token.split('.');
    if (extra !== undefined || !body || !signature || !/^[A-Za-z0-9_-]+$/.test(body)) fail(code);
    const expected = Buffer.from(bind(purpose, body));
    const supplied = Buffer.from(signature);
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) fail(code);
    try {
      const bytes = Buffer.from(body, 'base64url');
      if (bytes.toString('base64url') !== body) fail(code);
      return JSON.parse(bytes.toString('utf8'));
    } catch { fail(code); }
  }
  function memoryRow(ns, id) {
    return db.prepare(`SELECT * FROM memories WHERE ${where} AND id=? AND deleted=0`).get(...boundary(ns), id);
  }
  function memoryMetadata(ns, row) {
    return { type: 'memory', ref: { type: 'memory', namespace: ns, memoryId: row.id, revision: row.revision },
      state: row.currentness === 'current' ? 'active' : 'historical', reviewState: row.review_state,
      filing: { status: row.filing_status }, kind: row.kind, origin: row.origin, confidence: row.confidence };
  }
  function cardMetadata(card) {
    return { type: 'card', ref: { type: 'card', namespace: card.namespace, cardId: card.id,
      revision: card.revision, bodyRevision: card.bodyRevision }, state: card.state,
    support: card.support, origin: card.origin };
  }
  const cardEligible = (card, intent) => card?.state === 'confirmed' && (intent === 'history' ||
    card.support.status === 'eligible' && card.support.applicability === 'current');
  const memoryEligible = (row, intent) => row && !row.deleted &&
    (intent === 'history' || row.currentness === 'current' && row.review_state !== 'awaiting');
  function item(ns, ref, intent) {
    if (ref.type === 'card') {
      const card = cardDetailInside(ns, ref.cardId);
      if (!cardEligible(card, intent)) fail('evidence_unavailable');
      if (card.revision !== ref.revision || card.bodyRevision !== ref.bodyRevision) fail('revision_conflict');
      const sources = card.bindings.map(binding => binding.source);
      return { ...cardMetadata(card), title: card.title, body: card.body,
        qualification: { applicability: card.support.applicability, attribution: 'unassessed', commitment: 'unknown' },
        provenance: { sources, completeness: sources.some(source => source.type === 'raw') ?
          sources.every(source => source.type === 'raw') ? 'selected-raw-span' : 'mixed-sources' : sources.every(source => source.type === 'submitted-note') ?
          'provided-note' : 'excerpt-only', conversationCoverage: 'unknown', meaning: 'unassessed',
        support: card.support.status, corroboration: 'not-assessed',
        coverage: { status: 'complete', included: sources.length, omitted: 0 } },
        bindings: card.bindings, triggerMemoryRefs: card.triggerMemoryRefs };
    }
    const row = memoryRow(ns, ref.memoryId);
    if (!memoryEligible(row, intent)) fail('evidence_unavailable');
    if (row.revision !== ref.revision) fail('revision_conflict');
    const receiptRows = db.prepare('SELECT * FROM receipts WHERE memory_id=? ORDER BY created_at,id LIMIT 17').all(row.id);
    const sourceAccess = row.currentness === 'current' && row.review_state !== 'awaiting' ? 'available' : 'unavailable-for-noncurrent-memory';
    const sources = sourceAccess === 'available' ? receiptRows.slice(0, 16).map(receipt => receiptRefInside(ns, row, receipt)) : [];
    const assessed = qualification.inspect(row);
    const qualified = assessed ? { ...assessed, sourceText: 'read-separately',
      anchors: assessed.anchors.map(({ text, ...anchor }) => anchor) } : null;
    return { ...memoryMetadata(ns, row), content: row.content, qualification: qualified,
      provenance: { sources, sourceAccess,
        receiptMetadata: receiptRows.slice(0, 16).map(receipt => ({ memoryId: row.id,
          memoryRevision: row.revision, receiptId: receipt.id })),
        completeness: 'excerpt-only', conversationCoverage: 'unknown',
        meaning: 'unassessed', attribution, corroboration: 'not-assessed',
        coverage: { status: receiptRows.length > 16 ? 'budget_exhausted' : 'complete', included: Math.min(receiptRows.length, 16),
          omitted: receiptRows.length > 16 ? null : 0 } } };
  }
  function makeSnapshot(ns, intent, refs, items, accessGeneration) {
    return encode('evidence-snapshot-v1', { version: 1,
      binding: bind('evidence-scope-v1', ns), intent, refs,
      generations: generations(ns), accessGeneration,
      fences: items.map(value => bind('evidence-item-v1', value)) }, 16384);
  }
  function fetched(ns, input, accessGeneration) {
    const items = input.refs.map(ref => item(ns, ref, input.intent));
    const result = { items, snapshot: makeSnapshot(ns, input.intent, input.refs, items, accessGeneration) };
    if (size(result) > input.responseByteLimit) fail('context_item_too_large');
    return result;
  }
  function revalidate(ns, input, accessGeneration) {
    const previous = decode('evidence-snapshot-v1', input.snapshot, 'invalid_snapshot');
    if (previous.binding !== bind('evidence-scope-v1', ns) || previous.version !== 1 ||
        !['current', 'history'].includes(previous.intent)) fail('invalid_snapshot');
    if (JSON.stringify(previous.generations) !== JSON.stringify(generations(ns)) ||
        previous.accessGeneration !== accessGeneration) fail('snapshot_stale');
    // Empty selections also have a meaningful generation fence.
    const refs = previous.refs.length ? evidenceRefs(previous.refs, ns) : [];
    const items = refs.map(ref => item(ns, ref, previous.intent));
    if (JSON.stringify(previous.fences) !== JSON.stringify(items.map(value => bind('evidence-item-v1', value)))) fail('snapshot_stale');
    const result = { items, snapshot: makeSnapshot(ns, previous.intent, refs, items, accessGeneration) };
    if (size(result) > input.responseByteLimit) fail('context_item_too_large');
    return result;
  }
  function select(ns, input, original, accessGeneration) {
    const started = performance.now(), captured = generations(ns);
    const binding = bind('evidence-query-v1', [ns, input]);
    let previous;
    if (original.cursor !== undefined) {
      previous = decode('evidence-cursor-v1', original.cursor, 'invalid_cursor');
      if (previous.binding !== binding) fail('invalid_cursor');
      if (JSON.stringify(previous.generations) !== JSON.stringify(captured) ||
          previous.accessGeneration !== accessGeneration) fail('cursor_stale');
    }
    const after = previous?.after ?? Object.fromEntries(input.types.map(type => [type, '']));
    let turn = previous?.turn ?? 0, scannedRows = 0, scannedBodyUnits = 0, stopped = null;
    const byType = Object.fromEntries(input.types.map(type => [type, { scanned: 0, included: 0, partial: true }]));
    const exhausted = new Set(), blocked = new Set(), matches = [], queryWords = words(input.query);
    function next(type, metadataOnly = false) {
      const columns = metadataOnly ? 'id' : '*';
      const row = type === 'memory' ? db.prepare(`SELECT ${columns} FROM memories WHERE ${where}
        AND deleted=0 AND id>? ORDER BY id LIMIT 1`).get(...boundary(ns), after[type]) :
        db.prepare(`SELECT ${columns} FROM private_cards WHERE ${where} AND state='confirmed' AND id>? ORDER BY id LIMIT 1`)
          .get(...boundary(ns), after[type]);
      return row;
    }
    while (matches.length < input.limit && exhausted.size + blocked.size < input.types.length) {
      if (scannedRows >= input.scanRows) { stopped = 'row_budget'; break; }
      if (performance.now() - started >= input.deadlineMs) { stopped = 'deadline'; break; }
      const type = input.types[turn];
      turn = (turn + 1) % input.types.length;
      if (exhausted.has(type) || blocked.has(type)) continue;
      const row = next(type);
      if (!row) { exhausted.add(type); continue; }
      const text = type === 'memory' ? row.content : `${row.title}\n${row.body}`;
      if (scannedBodyUnits + text.length > input.scanBodyUnits) { blocked.add(type); stopped = 'body_budget'; continue; }
      after[type] = row.id; scannedRows++; scannedBodyUnits += text.length; byType[type].scanned++;
      const card = type === 'card' ? cardDetailInside(ns, row.id) : null;
      if (type === 'memory' ? !memoryEligible(row, input.intent) : !cardEligible(card, input.intent)) continue;
      const recordWords = words(text);
      const score = [...queryWords].reduce((total, word) => total + Number(recordWords.has(word)), 0);
      if (!score) continue;
      matches.push({ ...(type === 'memory' ? memoryMetadata(ns, row) : cardMetadata(card)), score });
      byType[type].included++;
    }
    // A metadata-only bounded peek tells callers which streams actually ended.
    for (const type of input.types) if (!blocked.has(type) && !next(type, true)) exhausted.add(type);
    const complete = exhausted.size === input.types.length;
    for (const type of input.types) byType[type].partial = !exhausted.has(type);
    matches.sort((left, right) => right.score - left.score || input.types.indexOf(left.type) - input.types.indexOf(right.type) ||
      ((left.ref.memoryId ?? left.ref.cardId) < (right.ref.memoryId ?? right.ref.cardId) ? -1 : 1));
    const refs = matches.map(value => value.ref), items = refs.map(ref => item(ns, ref, input.intent));
    return { items: matches,
      coverage: { status: complete ? 'complete' : 'budget_exhausted', byType, scannedRows, scannedBodyUnits,
        reason: complete ? null : matches.length === input.limit ? 'item_limit' : stopped,
        ranking: 'literal-unicode-word-overlap', relevance: 'not-assessed' },
      nextCursor: complete ? null : encode('evidence-cursor-v1', { binding, generations: captured,
        accessGeneration, after, turn }, 8192),
      snapshot: makeSnapshot(ns, input.intent, refs, items, accessGeneration) };
  }
  return Object.freeze({ call(method, ns, original, accessGeneration) {
    const input = evidenceInput(method, original, ns);
    if (method === 'selectEvidence') return select(ns, input, original, accessGeneration);
    if (method === 'fetchEvidence') return fetched(ns, input, accessGeneration);
    return revalidate(ns, input, accessGeneration);
  } });
}
