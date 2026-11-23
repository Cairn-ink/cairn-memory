import { compareUtf8, CoreError } from "../../core/src/index.mjs";
import { copyReadScope, copyRefs, guardOwner, invalid, pgText } from "./memory-input.mjs";
import { CREATED_MS, MEMORY_COLUMNS, readEntry, timestampUs } from "./memory-rows.mjs";
import { readVisibility } from "./memory-visibility.mjs";
import { runOperation } from "./uow.mjs";

/** @import { HydrateItems, ListRecent, ReadSnapshot, Receipt, Tx, VisibilityFence } from "../../core/src/ports/index.d.ts" */
/** @import { FactMatchPolicy } from "../../core/src/index.mjs" */
/** @import { Query } from "./memory-rows.mjs" */
/** @typedef {ReturnType<typeof copyReadScope>} ReadSet */
/** @typedef {{cursor: string | null, limit: number}} Page */
/** @typedef {{id: string, updatedAtUs: bigint}} PageKey */

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
const PAGE_BATCH_SIZE = 128;
const FILTER = `user_id = $1 AND array_position($2::text[], core_namespace) IS NOT NULL
  AND ($3::text[] IS NULL OR source_client = ANY($3))
  AND ($4::bigint IS NULL OR ${CREATED_MS} >= $4)
  AND ($5::bigint IS NULL OR ${CREATED_MS} < $5)
  AND ($6::boolean OR currentness = 'current')`;

/** @param {unknown[]} values */
function encode(values) {
  const binary = Array.from(encoder.encode(JSON.stringify(values)), byte => String.fromCharCode(byte)).join("");
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

/** @param {string} cursor @returns {unknown[]} */
function decode(cursor) {
  try {
    if (typeof cursor !== "string" || !/^[A-Za-z0-9_-]+$/u.test(cursor)) throw new Error();
    const bytes = Uint8Array.from(atob(cursor.replaceAll("-", "+").replaceAll("_", "/")), char => char.charCodeAt(0));
    const values = JSON.parse(decoder.decode(bytes));
    if (!Array.isArray(values) || encode(values) !== cursor) throw new Error();
    return values;
  } catch {
    throw new CoreError("invalid_cursor");
  }
}

/** @param {string} cursor @returns {PageKey} */
function pageAfter(cursor) {
  const [us, id, ...extra] = decode(cursor);
  if (extra.length || typeof us !== "string" || !/^(?:0|-?[1-9][0-9]{0,18})$/u.test(us) || !pgText(id) || !id) {
    throw new CoreError("invalid_cursor");
  }
  const updatedAtUs = BigInt(us);
  if (updatedAtUs < -210866803200000000n || updatedAtUs > 9223372036854775807n) throw new CoreError("invalid_cursor");
  return { id, updatedAtUs };
}

/** @param {ReadSet} scope @param {boolean} historical */
function scopeParams({ owner, keys, clients, since, until }, historical) {
  return [owner, keys, clients, since, until, historical];
}

/** @param {Tx} tx @param {ReadSet} scope @param {Page} page @param {boolean} historical
 * @param {FactMatchPolicy["hashSessionKey"]} [hashSessionKey] */
export function memoryPage(tx, scope, page, historical, hashSessionKey) {
  if (!page || typeof page !== "object") invalid();
  const { cursor, limit } = page;
  if (!Number.isSafeInteger(limit) || limit < 1) invalid();
  const start = cursor === null ? null : pageAfter(cursor);

  return runOperation(tx, async (query) => {
    let after = start;
    const items = [];
    const visibility = await readVisibility(query, scope.owner, hashSessionKey);
    while (items.length <= limit) {
      const batchSize = Math.min(PAGE_BATCH_SIZE, Math.max(16, limit - items.length + 1));
      const { rows } = await query(`SELECT ${MEMORY_COLUMNS} FROM memories WHERE ${FILTER}
        AND ($7::bigint IS NULL OR (updated_at, id COLLATE "C") < (${timestampUs("$7")}, $8::text COLLATE "C"))
        ORDER BY updated_at DESC, id COLLATE "C" DESC LIMIT $9`,
      [...scopeParams(scope, historical), after?.updatedAtUs.toString() ?? null, after?.id ?? null, batchSize]);
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
    return { items, nextCursor: hasMore && last ? encode([last.updatedAtUs.toString(), last.id]) : null };
  });
}

/** @param {Query} query @param {ReadSet} scope @param {ReturnType<typeof copyRefs>} refs
 * @param {boolean} historical @param {boolean} includeReceipts @param {FactMatchPolicy["hashSessionKey"]} hashSessionKey */
async function visibleRefs(query, scope, refs, historical, includeReceipts, hashSessionKey) {
  const keys = new Set(scope.keys);
  const selected = refs.filter(({ ref, key }) => ref.type === "memory" && keys.has(key));
  if (!selected.length) return [];
  const { rows } = await query(`SELECT ${MEMORY_COLUMNS} FROM memories WHERE ${FILTER} AND id = ANY($7::text[])`,
    [...scopeParams(scope, historical), [...new Set(selected.map(({ ref }) => ref.id))]]);
  const visibility = await readVisibility(query, scope.owner, hashSessionKey);
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

/** @param {ReadSet} scope @param {string} revision */
function scopeToken({ owner, keys, clients, since, until, hasWindow }, revision) {
  const namespaces = keys.map(key => key ?? "").sort(compareUtf8);
  return encode([owner, revision, namespaces, clients?.slice().sort(compareUtf8) ?? null, hasWindow ? [since, until] : null]);
}

/** @param {string} token */
function validateToken(token) {
  const [owner, revision, keys, clients, bounds, ...extra] = decode(token);
  if (extra.length || !pgText(owner) || !owner || typeof revision !== "string" ||
      !/^(?:0|[1-9][0-9]{0,18})$/u.test(revision) || BigInt(revision) > 9223372036854775807n) {
    throw new CoreError("invalid_cursor");
  }
  try {
    if (!Array.isArray(keys) || keys.some(key => typeof key !== "string") ||
        (bounds !== null && (!Array.isArray(bounds) || bounds.length !== 2))) throw new Error();
    const selection = copyReadScope(owner, { namespaces: keys.map(key => key === "" ? null : JSON.parse(key)),
      clients: clients === null ? undefined : /** @type {string[]} */ (clients),
      window: bounds === null ? undefined : { sinceMs: bounds[0] ?? undefined, untilMs: bounds[1] ?? undefined } });
    if (scopeToken(selection, revision) !== token) throw new Error();
  } catch {
    throw new CoreError("invalid_cursor");
  }
}

/** @param {Tx} tx @param {ReadSet} scope */
function stateToken(tx, scope) {
  return runOperation(tx, async (query) => {
    const { rows: [row] } = await query("SELECT index_revision::text FROM core_owner_state WHERE user_id = $1", [tx.owner]);
    return scopeToken(scope, row?.index_revision ?? "0");
  });
}

/** @param {Pick<FactMatchPolicy, "hashSessionKey">} [options]
 * @returns {{ recent: ListRecent, snapshot: ReadSnapshot, hydrate: HydrateItems, fence: VisibilityFence }} */
export function createPostgresMemoryReads({ hashSessionKey } = {}) {
  return {
    recent: {
      async recent(tx, scope, page) {
        guardOwner(tx, scope);
        return memoryPage(tx, copyReadScope(tx.owner, scope), page, false, hashSessionKey);
      },
    },
    snapshot: {
      async stateToken(tx, scope) {
        guardOwner(tx, scope);
        return stateToken(tx, copyReadScope(tx.owner, scope));
      },
      async assertUnchanged(tx, scope, token) {
        guardOwner(tx, scope);
        const selection = copyReadScope(tx.owner, scope);
        validateToken(token);
        if (await stateToken(tx, selection) !== token) throw new CoreError("cursor_stale");
      },
    },
    hydrate: {
      async hydrate(tx, scope, refs, intent) {
        guardOwner(tx, scope);
        const selection = copyReadScope(tx.owner, scope);
        const references = copyRefs(refs);
        if (intent !== "recall" && intent !== "read" && intent !== "export") invalid();
        return runOperation(tx, async (query) => {
          const rows = await visibleRefs(query, selection, references, intent !== "recall", true, hashSessionKey);
          return rows.map(item => ({ ...structuredClone(item), sourceDates: sourceDates(item.receipts) }));
        });
      },
    },
    fence: {
      async assertVisible(tx, scope, refs, intent) {
        guardOwner(tx, scope);
        const selection = copyReadScope(tx.owner, scope);
        const references = copyRefs(refs);
        if (intent !== undefined && intent !== "read") invalid();
        return runOperation(tx, async (query) =>
          (await visibleRefs(query, selection, references, intent === "read", false, hashSessionKey)).map(({ ref }) => ref));
      },
    },
  };
}
