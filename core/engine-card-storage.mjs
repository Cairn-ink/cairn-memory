import { contextEmbeddingGuard } from './context-read-sidecar.mjs';
import { randomUUID, createHmac, createHash } from 'node:crypto';
import { readTransaction, transaction } from './database.mjs';
import { withContentSuppressionRequest, inContentSuppressionRequestInside } from './content-suppression-storage.mjs';
import { contentReadSafety, sourceReadSafety, receiptReadSafety, createContentReadMemo } from './content-safety.mjs';
import { createPrivateCardStorage } from './private-card-storage.mjs';
import { createCardRawSources } from './card-raw-sources.mjs';
import { reviewCardApplicabilityInside } from './private-evidence-schema.mjs';
import { keyed } from './private-card-input.mjs';
import { engineCardMetadataInside, engineCardRevisionsInside } from './content-safety.mjs';
import { ENGINE_CARD_LIMITS, cardMemoryRevisions } from './engine-card-clusters.mjs';
import { tokenizeT1 } from './context-read-tokenize.mjs';
import { createPrivateEvidenceStorage } from './private-evidence-storage.mjs';
import { createCardReceiptSources } from './card-receipt-sources.mjs';
import { receiptEventDate } from './context-read-assembly.mjs';
import { validateSourceReceipt } from './source-evidence.mjs';
import { fail } from './validation.mjs';
import { installPrivateCards, installCardMemorySources } from './private-card-schema.mjs';
import { installPrivateEvidence } from './private-evidence-schema.mjs';
import { installPrivateOrganization } from './private-organization-schema.mjs';

const boundary = ns => [ns.ownerId, ns.scope, ns.projectId ?? ''];
const where = 'owner_id=? AND scope=? AND project_id=?';

/** Shares the runtime's canonical handle, Card bindings, epochs, operation
 * ledger and (when installed) sealed body lineage. No parallel fact store. */
export function createEngineCardStorage({ db, identity, ready, rawReader, upgrade = false }) {
  const read = (ns, work) => { ready(); return readTransaction(db, () => inContentSuppressionRequestInside(db, work, [ns])); };
  const bind = (purpose, value) => keyed(identity.cursorSecret, purpose, [identity.storeId, value]);
  const has = table => Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table));
  const installed = () => has('card_applicability_reviews');
  // Schema22 has evidence reviews but lacks the organization layout required
  // by Card readers. Leave it untouched until its owner upgrades the store.
  const available = () => installed() && has('card_mocs') || upgrade && [18,20,21].includes(db.prepare('PRAGMA user_version').get().user_version);
  // Use the existing Card layout, only after an explicit engine maintenance
  // call. Managed stores never migrate; ordinary opening stays unchanged.
  function ensureLayout() { if (upgrade && !installed()) transaction(db, () => {
    const version = db.prepare('PRAGMA user_version').get().user_version;
    if (![18,20,21,22].includes(version)) return;
    if (version < 20) installPrivateCards(db);
    if (version < 21) installCardMemorySources(db);
    if (version < 22) installPrivateEvidence(db);
    installPrivateOrganization(db);
    db.exec('PRAGMA user_version=23');
  }); }
  const raw = createCardRawSources(db, identity);
  const writers = createPrivateCardStorage({ db, identity, ready }).engineCardWriters();
  const receiptRef = createCardReceiptSources(db, bind).retainedRefInside;
  const memoryReference = (ns, memory) => ({ type: 'memory', namespace: ns, memoryId: memory.id, revision: memory.revision });
  const cardReference = (ns, row) => ({ type: 'card', namespace: ns, cardId: row.id, revision: row.revision, bodyRevision: row.body_revision });
  function sourcesCurrent(ns, refs, check = () => {}) {
    const memo = createContentReadMemo(db);
    return refs.every(ref => { check(); return db.prepare(`SELECT revision FROM memories WHERE ${where} AND id=? AND deleted=0`)
      .get(...boundary(ns), ref.memoryId)?.revision === ref.memoryRevision &&
      sourceReadSafety(db, { identity, namespace: ns, ref, memo }).allowed; });
  }
  function relations({ namespace: ns, memoryIds }) {
    if (!has('memory_relations')) return undefined;
    return read(ns, () => db.prepare(`SELECT r.from_memory_id AS "from",r.to_memory_id AS "to",r.relation AS kind,
      json_array(q.subject,q.property,q.scope,q.applies) AS slot
      FROM memory_relations r JOIN memories a ON a.id=r.from_memory_id JOIN memories b ON b.id=r.to_memory_id
      JOIN memory_qualifications q ON q.memory_id=a.id JOIN memory_qualifications p ON p.memory_id=b.id
      WHERE a.owner_id=? AND a.scope=? AND a.project_id=? AND b.owner_id=a.owner_id AND b.scope=a.scope AND b.project_id=a.project_id
      AND a.deleted=0 AND b.deleted=0 AND a.revision=r.from_revision AND b.revision=r.to_revision
      AND q.bound_revision=a.revision AND p.bound_revision=b.revision AND q.subject IS NOT NULL AND q.property IS NOT NULL
      AND q.subject=p.subject AND q.property=p.property AND q.scope IS p.scope AND q.applies IS p.applies
      AND r.relation IN ('supersedes','contradicts') AND a.id IN (SELECT value FROM json_each(?))
      AND b.id IN (SELECT value FROM json_each(?)) LIMIT 2049`).all(...boundary(ns), JSON.stringify(memoryIds), JSON.stringify(memoryIds)));
  }
  function pressureItems(ns, memories, { rawSpans = false } = {}) {
    return read(ns, () => {
      const receipts = createCardReceiptSources(db, bind), evidence = createPrivateEvidenceStorage({ db, identity,
        receiptRefInside: receipts.refInside });
      // Canonical evidence validation below still binds receipts locally. The
      // pressure projection itself needs no excerpt without explicit consent.
      const columns = rawSpans === true ? '*' : db.prepare('PRAGMA table_info(receipts)').all()
        .filter(column => column.name !== 'excerpt').map(column => '"' + column.name.replaceAll('"', '""') + '"').join(',');
      const refs = memories.map(memory => memoryReference(ns, memory));
      return evidence.itemsInside(ns, refs, 'history', [ns], { legacyEvidence: true }).map((item, index) => {
        const rows = item.provenance.sourceAccess === 'available' ? db.prepare(`SELECT ${columns} FROM receipts WHERE memory_id=? ORDER BY created_at,id LIMIT 16`)
          .all(item.ref.memoryId).filter(row => item.provenance.receiptMetadata.some(receipt => receipt.receiptId === row.id)) : [];
        return { type: 'memory', ref: item.ref, ns: 0, rank: index + 1, text: item.content,
          metadata: { state: item.state, reviewState: item.reviewState, filing: item.filing, kind: item.kind, origin: item.origin, confidence: item.confidence },
          date: receiptEventDate(rows), sources: rawSpans === true ? rows.map((row, index) => {
            const { role, excerpt } = validateSourceReceipt(item.ref.memoryId, row, source => createHash('sha256').update(JSON.stringify(source)).digest('hex'));
            return { index, role, excerpt };
          }) : [], sourceAccess: item.provenance.sourceAccess, sourcesComplete: item.provenance.coverage.status === 'complete',
          fence: createHmac('sha256', identity.cursorSecret).update(JSON.stringify(['context-read-v1', 'snapshot-item', identity.storeId, item])).digest('base64url') };
      });
    });
  }
  function snapshot(ns, maximum, check, after = '') {
    return read(ns, () => {
      const epoch = db.prepare(`SELECT epoch FROM namespace_epochs WHERE ${where}`).get(...boundary(ns))?.epoch ?? 1;
      const rows = db.prepare(`SELECT * FROM memories WHERE ${where} AND deleted=0 AND review_state!='awaiting'
        AND id>? ORDER BY id LIMIT ?`).all(...boundary(ns), after, maximum + 1);
      const complete = rows.length <= maximum, memories = [], memo = createContentReadMemo(db);
      let units = 0;
      for (const memory of rows.slice(0, maximum)) {
        check(); units += memory.content.length;
        if (units > 2000000) fail('source_budget_exceeded');
        const ref = memoryReference(ns, memory);
        if (!contentReadSafety(db, { identity, namespace: ns, ref, intent: 'history', memo }).allowed) continue;
        const receipts = db.prepare('SELECT * FROM receipts WHERE memory_id=? ORDER BY created_at,id LIMIT 16').all(memory.id)
          .filter(receipt => receiptReadSafety(db, { namespace: ns, receipt, memo }).allowed);
        if (!receipts.length) continue;
        const source = receiptRef(ns, memory, receipts[0]);
        const links = has('raw_receipt_lineage') ? db.prepare(`SELECT l.*,rm.occurred_at FROM raw_receipt_lineage l
          JOIN raw_conversations c ON c.id=l.conversation_id JOIN raw_messages rm
          ON rm.conversation_id=l.conversation_id AND rm.message_id=l.message_id WHERE l.receipt_id=?
          AND c.owner_id=? AND c.scope=? AND c.project_id=? LIMIT 16`).all(receipts[0].id, ...boundary(ns)) : [];
        const topics = memory.filing_status === 'filed' ? db.prepare(`SELECT r.moc_id FROM moc_memory_refs r
          JOIN mocs m ON m.id=r.moc_id WHERE r.memory_id=? AND r.memory_revision=? AND m.owner_id=?
          AND m.scope=? AND m.project_id=? AND m.level=1 ORDER BY r.moc_id LIMIT 3`)
          .all(memory.id, memory.revision, ...boundary(ns)).map(row => row.moc_id) : [];
        const dates = [...receipts.map(row => row.occurred_at), ...links.map(row => row.occurred_at)].filter(Boolean).sort();
        memories.push({ id: memory.id, revision: memory.revision, content: memory.content,
          date: dates[0] ?? memory.created_at, currentness: memory.currentness,
          conversations: [...new Set(links.length ? links.map(l => l.conversation_id) :
            receipts.map(r => JSON.stringify([r.client, r.session_id])))], topics, source, links });
      }
      return { memories, complete, epoch, after: rows.slice(0, maximum).at(-1)?.id ?? after };
    });
  }
  async function rawSpans(ns, memories, check) {
    const result = []; let used = 0;
    if (!rawReader) return result;
    const perSource = Math.min(ENGINE_CARD_LIMITS.rawUnits, Math.floor(ENGINE_CARD_LIMITS.rawTotalUnits / Math.max(1, memories.length)));
    for (const memory of memories) {
      check();
      if (used >= ENGINE_CARD_LIMITS.rawTotalUnits) break;
      const link = memory.links[0]; if (!link) continue;
      try {
        const remaining = Math.min(perSource, ENGINE_CARD_LIMITS.rawTotalUnits - used);
        const anchor = { conversationId: link.conversation_id, messageId: link.message_id,
          span: { start: link.start, end: Math.min(link.end, link.start + remaining), precision: 'exact' } };
        const source = read(ns, () => raw.refFor(ns, anchor, raw.inspect(ns, anchor, raw.budget())));
        const prepared = await rawReader.prepare('getSource', ns, { source, limit: 1 }, 1);
        check();
        const value = prepared.finish(), text = value.parts.map(part => part.text).join('').slice(0, remaining).replace(/[\uD800-\uDBFF]$/u, '');
        if (!text) continue;
        used += text.length;
        result.push({ memoryId: memory.id, date: memory.date, text });
      } catch (error) { check(); /* Unreadable optional Raw contributes no text. */ }
    }
    return result;
  }
  function cards(ns, check = () => {}) {
    if (!installed()) return [];
    return read(ns, () => { const memo = createContentReadMemo(db); return db.prepare(`SELECT c.* FROM private_cards c JOIN card_operations o ON o.target_id=c.id
      AND o.owner_id=c.owner_id AND o.scope=c.scope AND o.project_id=c.project_id AND o.action_id=c.id
      WHERE c.owner_id=? AND c.scope=? AND c.project_id=? AND o.method='consolidate'
      AND c.state='confirmed' ORDER BY c.created_at,c.id LIMIT 129`).all(...boundary(ns)).map(row => {
      check();
      const metadata = engineCardMetadataInside(db, ns, row);
      const current = engineCardRevisionsInside(db, ns, row) && contentReadSafety(db, { identity, namespace: ns, memo,
        ref: cardReference(ns, row),
        intent: 'history', method: 'getCard' }).allowed;
      return { ...metadata, row, status: current ? 'current' : 'stale' };
    }); });
  }
  // Delivery owns a fresh suppression scope and one canonical read snapshot;
  // the commit snapshot cannot authorize references returned after a host hook.
  function deliver(ns, built) {
    return withContentSuppressionRequest(() => read(ns, () => {
      const memo = createContentReadMemo(db);
      return built.flatMap(card => {
        const sourceRevisions = card.sourceRevisions.filter(ref => contentReadSafety(db, {
          identity, namespace: ns, intent: 'history', memo,
          ref: memoryReference(ns, { id: ref.memoryId, revision: ref.revision }) }).allowed);
        const row = db.prepare(`SELECT * FROM private_cards WHERE ${where} AND id=?`).get(...boundary(ns), card.id);
        if (!row || !contentReadSafety(db, { identity, namespace: ns, intent: 'history', method: 'getCard', memo,
          ref: { ...cardReference(ns, row), revision: card.revision } }).allowed) return [];
        return [{ ...card, sourceRevisions }];
      });
    }), { fresh: true });
  }
  function advance(ns) {
    db.prepare(`INSERT INTO card_epochs VALUES(?,?,?,2) ON CONFLICT(owner_id,scope,project_id)
      DO UPDATE SET generation=generation+1`).run(...boundary(ns));
  }
  function carry(ns, card, cluster, check) {
    ready(); check();
    return transaction(db, () => inContentSuppressionRequestInside(db, () => {
      check();
      const row = db.prepare(`SELECT * FROM private_cards WHERE ${where} AND id=?`).get(...boundary(ns), card.id);
      if (!row || !engineCardRevisionsInside(db, ns, row)) return false;
      const metadata = engineCardMetadataInside(db, ns, row);
      if (metadata.sourceRevisions.length !== cluster.memories.length || !cluster.memories.every(memory =>
        metadata.sourceRevisions.some(ref => ref.memoryId === memory.id && ref.revision === memory.revision)) ||
        !sourcesCurrent(ns, cluster.memories.map(memory => memory.source), check) ||
        !contentReadSafety(db, { identity, namespace: ns, intent: 'history', method: 'getCard',
          ref: cardReference(ns, row) }).allowed) return false;
      // A concurrent carry to this destination is idempotent. A different
      // destination means this worker's routing snapshot is no longer current.
      if (metadata.clusterKey !== card.clusterKey && metadata.clusterKey !== cluster.key) fail('scope_changed');
      const existing = db.prepare(`SELECT c.* FROM private_cards c JOIN card_operations o ON o.target_id=c.id
        AND o.owner_id=c.owner_id AND o.scope=c.scope AND o.project_id=c.project_id AND o.action_id=c.id
        WHERE c.owner_id=? AND c.scope=? AND c.project_id=? AND c.state='confirmed' AND c.revision=1 AND c.id!=?
        AND o.method='consolidate' AND json_extract(o.result,'$.clusterKey')=?
        ORDER BY c.created_at DESC,c.id DESC LIMIT 1`).get(...boundary(ns), card.id, cluster.key);
      if (existing && contentReadSafety(db, { identity, namespace: ns, intent: 'history', method: 'getCard',
        ref: cardReference(ns, existing) }).allowed) return false;
      // Keep the body, bindings, seal, revisions and original build time intact;
      // only the canonical routing metadata and its binding change atomically.
      db.prepare(`UPDATE card_operations SET payload_binding=?,result=? WHERE ${where}
        AND action_id=? AND method='consolidate' AND target_id=?`)
        .run(bind('engine-card-cluster-v1', cluster.key), JSON.stringify({ ...metadata, clusterKey: cluster.key }),
          ...boundary(ns), card.id, card.id);
      advance(ns); check(); return true;
    }, [ns]));
  }
  function claim(ns, cluster, timestamp, check) {
    ensureLayout();
    ready(); check();
    return transaction(db, () => {
      check(); if (!sourcesCurrent(ns, cluster.memories.map(memory => memory.source), check)) fail('source_unavailable');
      // The namespace's bounded history page may omit this cluster's newest
      // body. Recheck it atomically before reserving any generation spend.
      const latest = db.prepare(`SELECT c.* FROM private_cards c JOIN card_operations o ON o.target_id=c.id
        AND o.owner_id=c.owner_id AND o.scope=c.scope AND o.project_id=c.project_id AND o.action_id=c.id
        WHERE c.owner_id=? AND c.scope=? AND c.project_id=? AND c.state='confirmed'
        AND o.method='consolidate' AND json_extract(o.result,'$.clusterKey')=?
        ORDER BY c.created_at DESC,c.id DESC LIMIT 1`).get(...boundary(ns), cluster.key);
      if (latest?.revision === 1) {
        const metadata = engineCardMetadataInside(db, ns, latest);
        const same = JSON.stringify(metadata?.sourceRevisions) === JSON.stringify(cardMemoryRevisions(cluster.memories));
        if (same && contentReadSafety(db, { identity, namespace: ns, intent: 'history', method: 'getCard',
          ref: cardReference(ns, latest) }).allowed) return false;
        db.prepare('UPDATE private_cards SET revision=revision+1,updated_at=? WHERE id=?').run(timestamp, latest.id);
        advance(ns); return false;
      }
      if (latest && Date.parse(timestamp) - Date.parse(latest.updated_at) < ENGINE_CARD_LIMITS.debounceMs) return false;
      const fingerprint = bind('engine-card-attempt-v1', cluster.memories.map(memory => [memory.id, memory.revision])
        .sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
      const prefix = 'engine-claim.sources.' + fingerprint + '.';
      const previous = db.prepare(`SELECT * FROM card_operations WHERE ${where}
        AND method='consolidateAttempt'
        AND action_id>=? AND action_id<? ORDER BY created_at DESC,rowid DESC LIMIT 1`)
        .get(...boundary(ns), prefix, prefix + '\uffff');
      const attemptNumber = previous ? JSON.parse(previous.result).attemptNumber + 1 : 1;
      if (previous) {
        const outcome = db.prepare(`SELECT result FROM card_operations WHERE ${where} AND action_id=?`)
          .get(...boundary(ns), previous.action_id + '.outcome');
        const completed = outcome && JSON.parse(outcome.result).outcome;
        if (completed === 'succeeded') {
          // Success reserves the sources only while their current Card exists,
          // including a Card carried to another key or omitted by the scan.
          const current = db.prepare(`SELECT c.* FROM private_cards c JOIN card_operations o ON o.target_id=c.id
            AND o.owner_id=c.owner_id AND o.scope=c.scope AND o.project_id=c.project_id AND o.action_id=c.id
            WHERE c.owner_id=? AND c.scope=? AND c.project_id=? AND c.state='confirmed' AND c.revision=1
            AND o.method='consolidate' AND json_array_length(o.result,'$.sourceRevisions')=?`);
          for (const row of current.iterate(...boundary(ns), cluster.memories.length)) {
            check();
            const metadata = engineCardMetadataInside(db, ns, row);
            if (metadata && cluster.memories.every(memory => metadata.sourceRevisions.some(ref =>
                ref.memoryId === memory.id && ref.revision === memory.revision)) &&
                engineCardRevisionsInside(db, ns, row) && contentReadSafety(db, { identity, namespace: ns,
                  intent: 'history', method: 'getCard', ref: cardReference(ns, row) }).allowed) return false;
          }
        } else {
          // A crash after reservation counts as a transient attempt too. At
          // most three dispatches, with ten then twenty minutes of backoff.
          // Refusal remains terminal; immutable outcomes survive restarts.
          if ((completed && completed !== 'transient') || attemptNumber > 3 ||
              Date.parse(timestamp) - Date.parse(previous.created_at) < ENGINE_CARD_LIMITS.debounceMs * 2 ** (attemptNumber - 2)) return false;
        }
      }
      // Sealed stores protect operation receipts against replacement. Reserve
      // each new attempt with a fresh immutable row, indexed by source fingerprint.
      const action = prefix + randomUUID(), target = cluster.memories[0].id;
      db.prepare('INSERT INTO card_operations VALUES(?,?,?,?,?,?,?,?,?)')
        .run(...boundary(ns), action, 'consolidateAttempt', fingerprint, target, JSON.stringify({ claimedAt: timestamp, attemptNumber }), timestamp);
      return { action, fingerprint, target };
    });
  }
  function release(ns, attempt) {
    ready();
    return transaction(db, () => {
      // A durable dispatch guard refused before any model call. Release only
      // this unfinished reservation; other attempts and outcomes stay intact.
      db.prepare(`DELETE FROM card_operations WHERE ${where} AND action_id=?
        AND method='consolidateAttempt' AND payload_binding=?
        AND NOT EXISTS(SELECT 1 FROM card_operations WHERE ${where} AND action_id=?)`)
        .run(...boundary(ns), attempt.action, attempt.fingerprint, ...boundary(ns), attempt.action + '.outcome');
    });
  }
  function finish(ns, attempt, outcome, timestamp) {
    ready();
    return transaction(db, () => {
      db.prepare('INSERT INTO card_operations VALUES(?,?,?,?,?,?,?,?,?)')
        .run(...boundary(ns), attempt.action + '.outcome', 'consolidateOutcome', attempt.fingerprint,
          attempt.target, JSON.stringify({ outcome }), timestamp);
    });
  }
  function retire(ns, id, timestamp, deleted = false) {
    return transaction(db, () => {
      const row = db.prepare(`SELECT * FROM private_cards WHERE ${where} AND id=?`).get(...boundary(ns), id);
      if (!row || !engineCardMetadataInside(db, ns, row)) fail('source_unavailable');
      if (row.state === 'deleted' || !deleted && row.revision !== 1) return;
      if (deleted) writers.purge(ns, row, 'engine-retire.' + randomUUID());
      else db.prepare('UPDATE private_cards SET revision=revision+1,updated_at=? WHERE id=?').run(timestamp, id);
      advance(ns);
    });
  }
  function commit(ns, cluster, value, timestamp, check) {
    ready(); check();
    return transaction(db, () => inContentSuppressionRequestInside(db, () => {
      check();
      const refs = cluster.memories.map(m => m.source);
      if (!sourcesCurrent(ns, refs, check)) fail('source_unavailable');
      for (const ref of refs) if (db.prepare(`SELECT count(*) AS n FROM (SELECT DISTINCT c.id
        FROM card_memory_bindings b JOIN private_cards c ON c.id=b.card_id WHERE b.memory_id=?
        AND c.state IN ('draft','confirmed') LIMIT 128)`).get(ref.memoryId).n >= 128) fail('dependency_limit_reached');
      // Re-entrant or concurrent maintenance must not publish a second Card.
      const existing = db.prepare(`SELECT c.* FROM private_cards c JOIN card_operations o ON o.target_id=c.id
        WHERE c.owner_id=? AND c.scope=? AND c.project_id=? AND c.state='confirmed' AND c.revision=1
        AND o.method='consolidate' AND json_extract(o.result,'$.clusterKey')=? LIMIT 1`)
        .get(...boundary(ns), cluster.key);
      if (existing && engineCardRevisionsInside(db, ns, existing)) return null;
      const shared = tokenizeT1(cluster.memories[0].content).find(term =>
        cluster.memories.filter(memory => tokenizeT1(memory.content).includes(term)).length >= cluster.memories.length / 2);
      const id = 'engine-card.' + randomUUID(), title = 'Topic: ' + (shared ?? 'current state and history');
      const metadata = { id, revision: 1, origin: 'engine', builtAt: timestamp, clusterKey: cluster.key,
        sourceRevisions: cardMemoryRevisions(cluster.memories) };
      db.prepare(`INSERT INTO private_cards VALUES(?,?,?,?,1,'confirmed',?,?,1,?,?,?)`)
        .run(id, ...boundary(ns), title, value.body, timestamp, timestamp, timestamp);
      const insert = db.prepare('INSERT INTO card_memory_bindings VALUES(?,?,?,?,?,?)');
      // Position is display metadata, not a source-set bound. The existing
      // receipt binding format has sixteen positions and no position uniqueness.
      refs.forEach((ref, i) => insert.run(id, ref.memoryId, ref.memoryRevision, ref.receiptId, JSON.stringify(ref), i % 16));
      writers.seal(ns, id, refs);
      reviewCardApplicabilityInside(db, id, 1, 'current');
      db.prepare('INSERT INTO card_operations VALUES(?,?,?,?,?,?,?,?,?)').run(...boundary(ns), id,
        'consolidate', bind('engine-card-cluster-v1', cluster.key), id, JSON.stringify(metadata), timestamp);
      advance(ns); check();
      return metadata;
    }, [ns]));
  }
  // Each pass owns a versioned canonical decision. Probes must run outside
  // validation snapshots, including the final synchronous transport fence.
  const pauseGuard = (ns, deadlineAt) => contextEmbeddingGuard(db,
    work => { ready(); return readTransaction(db, work); }, [ns], deadlineAt);
  return { pauseGuard, available, snapshot, rawSpans, cards, carry, retire, commit, claim, release, finish, relations, pressureItems, deliver,
    validate(ns, memories, check) { return read(ns, () => { if (!sourcesCurrent(ns, memories.map(m => m.source), check)) fail('source_unavailable'); }); } };
}
