import { CoreError, ERROR_CODES, isErrorCode } from "@cairn-ink/core";
import { contextEpochs } from "./context-read-state.mjs";
import { cardWhere, decodeCard, readCardGeneration, readCardRow } from "./document-card-rows.mjs";
import { placementArray, placementBatchLimit, validateLimit } from "./placement-input.mjs";
import { exactScope, placementPort } from "./placement-visibility.mjs";
import { invalidInput, scopeKey, validateId, writeTime } from "./storage-values.mjs";

/** @import { Scope, Topic, TopicStore, Tx } from "@cairn-ink/core/ports" */
/** @import { Connection, Port } from "./storage-values.mjs" */
/** @import { CardWrite, Row } from "./document-card-rows.mjs" */
/** @import { TopicOptions } from "./topics.mjs" */
/** @typedef {ReturnType<typeof import("./document-card-visibility.mjs").createCardVisibility>} CardVisibility */
/** @typedef {ReturnType<typeof import("./index-revisions.mjs").createIndexRevisions>} Index */
/** @typedef {Pick<TopicStore, "applyCardPlacement" | "dropCard" | "forCard" | "forCards" | "markCardsFailed" | "pendingCards">} CardPlacement */
/** @typedef {{ id: string, placedAtUs: bigint }} CardMember */

const write = { write: true };

/** @param {Connection} db @param {Scope} scope @param {string} id */
export function clearCardPlacement(db, scope, id) {
  const keys = [...scopeKey(scope), id];
  db.prepare(`DELETE FROM cairn_document_card_outcomes WHERE ${cardWhere}`).run(...keys);
  db.prepare(`DELETE FROM cairn_document_card_failures WHERE ${cardWhere}`).run(...keys);
}

/** @param {Connection} db @param {Scope} scope @param {CardVisibility} visibility */
function cardReader(db, scope, visibility) {
  const input = visibility.inputReader(db, scope);
  /** @param {Row | undefined} row */
  return row => {
    if (row?.state !== "active") return null;
    const card = decodeCard(db, scope, row);
    return { card, input: input(card) };
  };
}

/** Prepare same-snapshot evidence before releasing the port's synchronous SQL scope.
 * @param {Connection} db @param {Scope} scope @param {CardVisibility} visibility
 */
export function cardTopicMembers(db, scope, visibility) {
  const load = cardReader(db, scope, visibility);
  /** @type {Map<string, ReturnType<typeof load>>} */
  const cards = new Map();
  return db.prepare(`SELECT m.topic_id, m.card_id, CAST(m.placed_at_us AS TEXT) AS time
    FROM cairn_document_card_memberships m JOIN cairn_document_card_outcomes o USING (owner_id, namespace_key, card_id)
    JOIN cairn_document_cards c ON c.owner_id = o.owner_id AND c.namespace_key = o.namespace_key AND c.id = o.card_id
    WHERE m.owner_id = ? AND m.namespace_key = ? AND c.state = 'active' AND c.content_hash = o.content_hash
    ORDER BY m.placed_at_us DESC, m.card_id DESC`).all(...scopeKey(scope)).flatMap(({ topic_id, card_id, time }) => {
    const id = String(card_id);
    if (!cards.has(id)) cards.set(id, load(readCardRow(db, scope, id)));
    const evidence = cards.get(id);
    return evidence ? [{ evidence, topic: String(topic_id), member: { id, placedAtUs: BigInt(String(time)) } }] : [];
  });
}

/** @param {ReturnType<typeof cardTopicMembers>} rows @param {CardVisibility} visibility */
export async function visibleCardTopicMembers(rows, visibility) {
  /** @type {Map<string, CardMember[]>} */
  const groups = new Map();
  /** @type {Map<string, boolean>} */
  const seen = new Map();
  for (const { evidence, topic, member } of rows) {
    const { id } = member;
    if (!seen.has(id)) seen.set(id, await visibility.fileable(evidence.input, evidence.card));
    if (!seen.get(id)) continue;
    const group = groups.get(topic) ?? [];
    if (group.length === 0) groups.set(topic, group);
    group.push(member);
  }
  return groups;
}

/** @param {Parameters<TopicStore["applyCardPlacement"]>[2]} basedOn
 * @param {Parameters<TopicStore["applyCardPlacement"]>[3]} proposal
 */
function proposalInput({ indexRevision, cards }, proposal) {
  if (!Number.isSafeInteger(indexRevision) || indexRevision < 0) invalidInput();
  const guards = new Map(placementArray(cards, placementBatchLimit).map(({ cardId, contentHash }) => {
    validateId(cardId);
    if (typeof contentHash !== "string" || !contentHash) invalidInput();
    return [cardId, contentHash];
  }));
  const items = placementArray(proposal.items, placementBatchLimit).map(({ cardId, parentIds }) => {
    const parents = placementArray(parentIds, 3);
    for (const id of parents) validateId(id);
    if (!guards.has(cardId) || new Set(parents).size !== parents.length) invalidInput();
    return { cardId, topicIds: parents };
  });
  if (items.length === 0 || cards.length !== guards.size || guards.size !== items.length ||
      new Set(items.map(({ cardId }) => cardId)).size !== items.length) invalidInput();
  return { indexRevision, guards, items };
}

/** @param {Port} port @param {Index} index @param {CardVisibility} visibility @param {() => number} now
 * @param {TopicOptions} options @param {(db: Connection, scope: Scope) => Topic[]} catalog @returns {CardPlacement}
 */
export function createTopicCardPlacement(port, index, visibility, now, { topicRetryAfterMs = 3_600_000, topicMaxAttempts = 3 }, catalog) {
  const access = placementPort(port);

  /** @param {Connection} db @param {Tx} tx @param {Scope} scope */
  function stamp(db, tx, scope) {
    return JSON.stringify([index.current(db, tx), readCardGeneration(db, scope),
      contextEpochs(db, { owner: scope.owner, namespaces: [scope.namespace], accessGenerations: [0] })]);
  }

  /** @param {Tx} tx @param {Scope} callerScope @param {readonly string[]} ids */
  async function annotations(tx, callerScope, ids) {
    const candidates = await access(tx, callerScope, {}, (db, scope) => {
      const batch = placementArray(ids, 100);
      validateLimit(batch.length);
      if (batch.some(id => typeof id !== "string")) invalidInput();
      const keys = scopeKey(scope);
      const load = cardReader(db, scope, visibility);
      const outcome = db.prepare(`SELECT content_hash FROM cairn_document_card_outcomes WHERE ${cardWhere}`);
      const membership = db.prepare(`SELECT topic_id FROM cairn_document_card_memberships WHERE ${cardWhere} ORDER BY topic_id`);
      const titles = new Map(catalog(db, scope).filter(topic => topic.level === "L1").map(({ id, title }) => [id, { id, title }]));
      return [...new Set(batch)].flatMap(cardId => {
        if (!cardId || /[\u0000\uD800-\uDFFF]/u.test(cardId)) return [];
        const row = readCardRow(db, scope, cardId);
        const evidence = row?.state === "active" && row.content_hash === outcome.get(...keys, cardId)?.content_hash && load(row);
        if (!evidence) return [];
        const topics = membership.all(...keys, cardId).flatMap(({ topic_id }) => titles.get(String(topic_id)) ?? []);
        return [{ cardId, evidence, topics }];
      });
    });
    const result = [];
    for (const { cardId, evidence, topics } of candidates) {
      if (await visibility.fileable(evidence.input, evidence.card)) result.push({ cardId, topics });
    }
    return result;
  }

  return {
    async pendingCards(tx, callerScope, { limit }) {
      const candidates = await access(tx, callerScope, {}, (db, scope) => {
        validateLimit(limit, placementBatchLimit);
        const load = cardReader(db, scope, visibility);
        const rows = db.prepare(`SELECT c.id, c.origin, c.title, c.body, c.content_hash, c.source_at_ms, c.stale, c.state,
            f.code, f.attempts, f.failed_at_ms FROM cairn_document_cards c
          LEFT JOIN cairn_document_card_failures f ON f.owner_id = c.owner_id AND f.namespace_key = c.namespace_key
            AND f.card_id = c.id AND f.content_hash = c.content_hash
          WHERE c.owner_id = ? AND c.namespace_key = ? AND c.state = 'active' AND NOT EXISTS (
            SELECT 1 FROM cairn_document_card_outcomes o WHERE o.owner_id = c.owner_id AND o.namespace_key = c.namespace_key
              AND o.card_id = c.id AND o.content_hash = c.content_hash)
          ORDER BY c.created_at_ms, c.id`).all(...scopeKey(scope));
        return rows.flatMap(row => {
          if (row.code !== null && (!isErrorCode(row.code) || ERROR_CODES[row.code] !== "retryable" ||
              Number(row.attempts) >= topicMaxAttempts || now() - Number(row.failed_at_ms) < topicRetryAfterMs)) return [];
          return load(row) ?? [];
        });
      });
      const result = [];
      for (const { card, input } of candidates) {
        if (await visibility.fileable(input, card)) result.push({ cardId: card.id, contentHash: card.contentHash });
        if (result.length === limit) break;
      }
      return result;
    },

    async applyCardPlacement(tx, callerScope, basedOn, proposal) {
      const snapshot = await access(tx, callerScope, write, (db, scope) => {
        const { indexRevision, guards, items } = proposalInput(basedOn, proposal);
        if (indexRevision !== index.start(db, tx)) throw new CoreError("revision_conflict");
        const load = cardReader(db, scope, visibility);
        const parents = db.prepare(`SELECT level FROM cairn_topics WHERE ${exactScope} AND id = ?`);
        const keys = scopeKey(scope);
        const evidence = items.map(({ cardId, topicIds }) => {
          const candidate = load(readCardRow(db, scope, cardId));
          if (!candidate || candidate.card.contentHash !== guards.get(cardId) ||
              topicIds.some(id => parents.get(...keys, id)?.level !== "L1")) throw new CoreError("revision_conflict");
          return candidate;
        });
        return { scope, items, evidence, version: stamp(db, tx, scope) };
      });
      const { scope, items, evidence, version } = snapshot;
      const verified = await Promise.all(evidence.map(({ input, card }) => visibility.fileable(input, card)));
      return access(tx, scope, write, (db, scope) => {
        if (verified.includes(false) || version !== stamp(db, tx, scope)) throw new CoreError("revision_conflict");
        const keys = scopeKey(scope);
        const put = db.prepare(`INSERT INTO cairn_document_card_outcomes VALUES (?, ?, ?, ?)
          ON CONFLICT (owner_id, namespace_key, card_id) DO UPDATE SET content_hash = excluded.content_hash`);
        const memberships = db.prepare(`SELECT topic_id, CAST(placed_at_us AS TEXT) AS time
          FROM cairn_document_card_memberships WHERE ${cardWhere}`);
        const remove = db.prepare(`DELETE FROM cairn_document_card_memberships WHERE ${cardWhere}`);
        const add = db.prepare("INSERT INTO cairn_document_card_memberships VALUES (?, ?, ?, ?, ?)");
        let changed = false, placedAtUs;
        for (const [i, { cardId, topicIds }] of items.entries()) {
          const previous = new Map(memberships.all(...keys, cardId)
            .map(({ topic_id, time }) => [String(topic_id), BigInt(String(time))]));
          put.run(...keys, cardId, evidence[i].card.contentHash);
          if (topicIds.length === previous.size && topicIds.every(id => previous.has(id))) continue;
          remove.run(...keys, cardId);
          for (const id of topicIds) add.run(...keys, cardId, id, previous.get(id) ?? (placedAtUs ??= writeTime(now()).updatedAtUs));
          changed = true;
        }
        if (changed) index.advanceDerived(db, tx);
        return { placed: items };
      });
    },

    markCardsFailed(tx, callerScope, ids, code) {
      return access(tx, callerScope, write, (db, scope) => {
        if (!isErrorCode(code)) invalidInput();
        const batch = placementArray(ids, Number.MAX_SAFE_INTEGER, false);
        for (const id of batch) validateId(id);
        const keys = scopeKey(scope);
        const put = db.prepare(`INSERT INTO cairn_document_card_failures VALUES (?, ?, ?, ?, ?, 1, ?)
          ON CONFLICT (owner_id, namespace_key, card_id) DO UPDATE SET
            attempts = CASE WHEN content_hash = excluded.content_hash THEN attempts + 1 ELSE 1 END,
            content_hash = excluded.content_hash, code = excluded.code, failed_at_ms = excluded.failed_at_ms`);
        let failedAtMs;
        for (const id of new Set(batch)) {
          const row = readCardRow(db, scope, id);
          if (row?.state === "active") put.run(...keys, id, row.content_hash, code, failedAtMs ??= now());
        }
      });
    },

    async forCard(tx, scope, cardId) {
      const [card] = await annotations(tx, scope, [cardId]);
      return card?.topics.map(({ id }) => id) ?? [];
    },

    forCards: annotations,

    dropCard(tx, callerScope, id) {
      return access(tx, callerScope, write, (db, scope) => {
        validateId(id);
        const dropped = Number(db.prepare(`DELETE FROM cairn_document_card_memberships WHERE ${cardWhere}`)
          .run(...scopeKey(scope), id).changes);
        if (dropped) index.advanceDerived(db, tx);
        return { dropped };
      });
    },
  };
}
