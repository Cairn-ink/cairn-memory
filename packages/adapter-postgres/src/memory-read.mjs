import { CoreError } from "../../core/src/index.mjs";
import { copyReadScope, copyRefs, guardOwner, invalid, namespaceKey, pgText } from "./memory-input.mjs";
import { MEMORY_COLUMNS, readEntry, timestampUs } from "./memory-rows.mjs";
import { readVisibility } from "./memory-visibility.mjs";
import { createRawRefReader } from "./raw-read.mjs";
import { decode, encode, readStateToken, validateToken } from "./read-snapshot.mjs";
import { MEMORY_FILTER, memoryScopeParams } from "./retrieval-scope.mjs";
import { readSupersessionViews } from "./supersession-store.mjs";
import { runOperation } from "./uow.mjs";

/** @import { HydrateItems, ListRecent, ReadSnapshot, Receipt, Tx, VisibilityFence } from "../../core/src/ports/index.d.ts" */
/** @import { FactMatchPolicy } from "../../core/src/index.mjs" */
/** @import { Query } from "./memory-rows.mjs" */
/** @import { VisibilityFactsCache } from "./memory-visibility.mjs" */
/** @typedef {ReturnType<typeof copyReadScope>} ReadSet */
/** @typedef {{cursor: string | null, limit: number}} Page */
/** @typedef {{id: string, updatedAtUs: bigint}} PageKey */

const PAGE_BATCH_SIZE = 128;

/** @param {string} cursor @param {string} owner @returns {PageKey} */
function pageAfter(cursor, owner) {
  const [cursorOwner, us, id, ...extra] = decode(cursor);
  if (extra.length || !pgText(cursorOwner) || typeof us !== "string" ||
      !/^(?:0|-?[1-9][0-9]{0,18})$/u.test(us) || !pgText(id) || !id) {
    throw new CoreError("invalid_cursor");
  }
  const updatedAtUs = BigInt(us);
  if (updatedAtUs < -210866803200000000n || updatedAtUs > 9223372036854775807n) throw new CoreError("invalid_cursor");
  if (cursorOwner !== owner) throw new CoreError("cursor_stale");
  return { id, updatedAtUs };
}

/** @param {Tx} tx @param {ReadSet} scope @param {Page} page @param {boolean} historical
 * @param {FactMatchPolicy["hashSessionKey"]} [hashSessionKey] */
export function memoryPage(tx, scope, page, historical, hashSessionKey) {
  if (!page || typeof page !== "object") invalid();
  const { cursor, limit } = page;
  if (!Number.isSafeInteger(limit) || limit < 1) invalid();
  const start = cursor === null ? null : pageAfter(cursor, scope.owner);

  return runOperation(tx, async (query, run) => {
    let after = start;
    const items = [];
    const visibility = await readVisibility(query, scope.owner, hashSessionKey, run.visibilityFacts);
    while (items.length <= limit) {
      const batchSize = Math.min(PAGE_BATCH_SIZE, Math.max(16, limit - items.length + 1));
      const { rows } = await query(`SELECT ${MEMORY_COLUMNS} FROM memories WHERE ${MEMORY_FILTER}
        AND ($7::bigint IS NULL OR (updated_at, id COLLATE "C") < (${timestampUs("$7")}, $8::text COLLATE "C"))
        ORDER BY updated_at DESC, id COLLATE "C" DESC LIMIT $9`,
      [...memoryScopeParams(scope, historical), after?.updatedAtUs.toString() ?? null, after?.id ?? null, batchSize]);
      const entries = rows.map(row => readEntry(row, scope.owner));
      const checked = await visibility.check(entries);
      for (const { memory, hidden } of checked) {
        if (hidden) continue;
        items.push(memory);
        if (items.length > limit) break;
      }
      if (rows.length < batchSize) break;
      after = entries.at(-1)?.memory ?? null;
    }
    const hasMore = items.length > limit;
    if (hasMore) items.pop();
    const last = items.at(-1);
    return { items, nextCursor: hasMore && last ? encode([scope.owner, last.updatedAtUs.toString(), last.id]) : null };
  });
}

/** @param {Query} query @param {ReadSet} scope @param {ReturnType<typeof copyRefs>} refs
 * @param {boolean} historical @param {boolean} includeReceipts @param {FactMatchPolicy["hashSessionKey"]} hashSessionKey
 * @param {VisibilityFactsCache} [cache] */
async function visibleRefs(query, scope, refs, historical, includeReceipts, hashSessionKey, cache) {
  const keys = new Set(scope.keys);
  const selected = refs.filter(({ ref, key }) => ref.type === "memory" && keys.has(key));
  if (!selected.length) return [];
  const { rows } = await query(`SELECT ${MEMORY_COLUMNS} FROM memories WHERE ${MEMORY_FILTER} AND id = ANY($7::text[])`,
    [...memoryScopeParams(scope, historical), [...new Set(selected.map(({ ref }) => ref.id))]]);
  const visibility = await readVisibility(query, scope.owner, hashSessionKey, cache);
  const checked = await visibility.check(rows.map(row => readEntry(row, scope.owner)), includeReceipts);
  const byId = new Map(checked.map(entry => [entry.memory.id, entry]));
  return selected.flatMap(({ ref }) => {
    const entry = byId.get(ref.id);
    return entry && !entry.hidden && entry.memory.scope.namespace === ref.namespace
      ? [{ ref, memory: entry.memory, receipts: entry.evidence }]
      : [];
  });
}

/** @param {readonly Receipt[]} receipts */
function sourceDates(receipts) {
  let firstMs = null;
  let lastMs = null;
  for (const { occurredAtMs } of receipts) {
    if (occurredAtMs === null) continue;
    firstMs = firstMs === null ? occurredAtMs : Math.min(firstMs, occurredAtMs);
    lastMs = lastMs === null ? occurredAtMs : Math.max(lastMs, occurredAtMs);
  }
  return { firstMs, lastMs };
}

/** @param {Pick<FactMatchPolicy, "hashSessionKey"> & {allowNonNullNamespace?: boolean} |
 *   (import("./raw-visibility.mjs").RawReadOptions & {allowNonNullNamespace?: boolean})} [options]
 * @returns {{ recent: ListRecent, snapshot: ReadSnapshot, hydrate: HydrateItems, fence: VisibilityFence }} */
export function createPostgresMemoryReads(options = {}) {
  const visibleRawRows = "lineageSecret" in options ? createRawRefReader(options) : undefined;
  // Raw delivery accepts mixed scopes and returns only personal raw refs.
  const { hashSessionKey, allowNonNullNamespace = visibleRawRows !== undefined } = options;

  /** @param {ReturnType<typeof copyRefs>} references */
  const rawIds = references => references.flatMap(({ ref }) =>
    ref.type === "raw" && ref.namespace === null ? [ref.id] : []);

  /** @type {ReadSnapshot["stateToken"]} */
  async function memoryStateToken(tx, scope) {
    guardOwner(tx, scope);
    const selection = copyReadScope(tx.owner, scope, allowNonNullNamespace);
    return runOperation(tx, async query => {
      // The owner revision also advances for Raw writes. Use only the rows
      // and suppression facts that can affect memory ranking or delivery.
      const { rows: [row] } = await query(`WITH selected AS MATERIALIZED (
        SELECT id, xmin::text AS version FROM memories WHERE ${MEMORY_FILTER}
      ), versions AS (
        SELECT jsonb_build_array('memory', id, version) AS row FROM selected
        UNION ALL
        SELECT jsonb_build_array('receipt', r.memory_id, r.client, r.session_id, r.message_id, r.xmin::text)
          FROM core_memory_receipts r JOIN selected m ON m.id = r.memory_id WHERE r.user_id = $1
        UNION ALL
        SELECT jsonb_build_array('fact', fact_id, xmin::text) FROM core_suppression_facts
          WHERE user_id = $1 AND kind <> 'rawSpan'
          AND array_position($2::text[], body ->> 'namespace') IS NOT NULL
        UNION ALL
        SELECT jsonb_build_array('legacy', id, xmin::text) FROM suppressions
          WHERE user_id = $1 AND array_position($2::text[], NULL::text) IS NOT NULL
      )
      SELECT encode(sha256(convert_to(COALESCE(string_agg(row::text, E'\\n' ORDER BY row), ''), 'UTF8')), 'hex') AS token
      FROM versions`, memoryScopeParams(selection, false));
      return row.token;
    });
  }

  return {
    recent: {
      async recent(tx, scope, page) {
        guardOwner(tx, scope);
        return memoryPage(tx, copyReadScope(tx.owner, scope, allowNonNullNamespace), page, false, hashSessionKey);
      },
    },
    snapshot: {
      findMemory: {
        stateToken: memoryStateToken,
        async assertUnchanged(tx, scope, token) {
          if (await memoryStateToken(tx, scope) !== token) throw new CoreError("cursor_stale");
        },
      },
      async stateToken(tx, scope) {
        guardOwner(tx, scope);
        const selection = copyReadScope(tx.owner, scope, allowNonNullNamespace);
        return runOperation(tx, (query, run) => readStateToken(query, selection, run));
      },
      async assertUnchanged(tx, scope, token) {
        guardOwner(tx, scope);
        const selection = copyReadScope(tx.owner, scope, allowNonNullNamespace);
        validateToken(token, allowNonNullNamespace);
        if (await runOperation(tx, (query, run) => readStateToken(query, selection, run)) !== token) throw new CoreError("cursor_stale");
      },
    },
    hydrate: {
      async hydrate(tx, scope, refs, intent) {
        guardOwner(tx, scope);
        const selection = copyReadScope(tx.owner, scope, allowNonNullNamespace);
        const references = copyRefs(refs);
        if (intent !== "recall" && intent !== "read" && intent !== "export") invalid();
        return runOperation(tx, async (query, run) => {
          const rows = await visibleRefs(query, selection, references, intent !== "recall", true, hashSessionKey, run.visibilityFacts);
          if (intent === "read") {
            const historical = rows.map(({ memory }) => memory).filter(memory => memory.historical);
            for (const namespace of new Set(historical.map(memory => memory.scope.namespace))) {
              const memories = historical.filter(memory => memory.scope.namespace === namespace);
              const views = await readSupersessionViews(query, tx.owner, namespaceKey(namespace, allowNonNullNamespace),
                memories.map(memory => memory.id), hashSessionKey);
              for (const memory of memories) {
                if (views.get(memory.id)?.supersededBy === null) {
                  memory.supersession = "superseded (replacement no longer available)";
                }
              }
            }
          }
          return rows.map(item => ({ ...structuredClone(item), sourceDates: sourceDates(item.receipts) }));
        });
      },
    },
    fence: {
      async assertVisible(tx, scope, refs, intent) {
        guardOwner(tx, scope);
        const selection = copyReadScope(tx.owner, scope, allowNonNullNamespace);
        const references = copyRefs(refs);
        if (intent !== undefined && intent !== "read") invalid();
        return runOperation(tx, async (query) => {
          const memories = await visibleRefs(query, selection, references, intent === "read", false, hashSessionKey);
          if (!visibleRawRows) return memories.map(({ ref }) => ref);
          const raw = await visibleRawRows(query, selection, rawIds(references));
          const visibleMemoryRefs = new Set(memories.map(({ ref }) => ref));
          return references.flatMap(({ ref }) => visibleMemoryRefs.has(ref) ||
            (ref.type === "raw" && ref.namespace === null && raw.has(ref.id)) ? [ref] : []);
        });
      },
      async readVisibleRaw(tx, scope, refs, matchesVersion) {
        guardOwner(tx, scope);
        const selection = copyReadScope(tx.owner, scope, allowNonNullNamespace);
        const ids = rawIds(copyRefs(refs));
        if (!visibleRawRows) return [];
        return runOperation(tx, async query => {
          const rows = await visibleRawRows(query, selection, ids, matchesVersion);
          return [...rows.values()];
        });
      },
    },
  };
}
