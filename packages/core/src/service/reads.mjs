import { isWellFormedText, validateObject } from "../capture/validate.mjs";
import { CoreError } from "../errors.mjs";
import { redactHostedCurrent } from "../privacy/redact.mjs";
import { decodeCursor, encodeCursor, pageLimit } from "../retrieval/hosted-paging.mjs";
import { packSessionStart } from "../retrieval/session-start.mjs";
import { entry, entryError, scopeOf } from "./entry.mjs";
import { hostedProjection } from "./session-wire.mjs";

/** @typedef {import("../ports/index.d.ts").StorageAdapter} StorageAdapter */
/** @typedef {import("../ports/common.d.ts").MemoryRow} MemoryRow */
/** @typedef {import("../ports/common.d.ts").ItemRef} ItemRef */
/** @typedef {import("../ports/common.d.ts").Scope} Scope */
/** @typedef {import("../ports/retrieval.d.ts").RetrievalScope} RetrievalScope */
/** @typedef {import("../ports/unit-of-work.d.ts").Tx} Tx */

/** @param {Scope} scope @returns {RetrievalScope} */
function readSet({ owner, namespace }) {
  return { owner, namespaces: [namespace] };
}

/** @param {MemoryRow[]} rows @param {RetrievalScope} scope @param {Tx} tx @param {StorageAdapter["fence"]} fence */
async function visibleRows(rows, scope, tx, fence) {
  const scoped = rows.filter(row => row.scope.owner === scope.owner && scope.namespaces.includes(row.scope.namespace));
  const refs = scoped.map(({ id, scope: { namespace } }) => /** @type {ItemRef} */ ({ type: "memory", id, namespace }));
  const visible = await fence.assertVisible(tx, scope, refs);
  const keys = new Set(visible.filter(ref => ref.type === "memory").map(ref => JSON.stringify([ref.namespace, ref.id])));
  return scoped.filter(row => keys.has(JSON.stringify([row.scope.namespace, row.id])));
}

const CURSOR_ROUTES = Object.freeze(["recent-v1", "export-v1"]);

/** Hosted's pre-core cursors: recent [timestamp, id] and search offsets. @param {unknown} value */
function isLegacyHostedCursor(value) {
  return (Array.isArray(value) && value.length === 2 && typeof value[0] === "string" && typeof value[1] === "string") ||
    (typeof value === "number" && Number.isSafeInteger(value) && value >= 0);
}

/** @param {unknown} options @param {Scope} scope @param {"recent-v1" | "export-v1"} route */
function readPage(options, { owner, namespace }, route) {
  const { cursor, limit } = validateObject(options === undefined ? {} : options, ["cursor", "limit"]);
  if (limit !== undefined && typeof limit !== "number") throw new CoreError("invalid_input");
  if (cursor == null) return { position: null, limit: pageLimit(limit) };
  if (typeof cursor !== "string") throw new CoreError("invalid_cursor");
  const value = decodeCursor(cursor);
  // Versioned cursors: an old (hosted timestamp/id or offset) or foreign (other route) cursor is
  // stale, not malformed, so a client restarts its listing.
  if (isLegacyHostedCursor(value) || (Array.isArray(value) && value.length === 5 &&
      CURSOR_ROUTES.includes(value[0]) && value[0] !== route)) {
    throw new CoreError("cursor_stale");
  }
  if (!Array.isArray(value) || value.length !== 5 || value[0] !== route ||
      typeof value[1] !== "string" || (value[2] !== null && typeof value[2] !== "string") ||
      typeof value[3] !== "string" || !value[3] || typeof value[4] !== "string" || !value[4]) {
    throw new CoreError("invalid_cursor");
  }
  const [, cursorOwner, cursorNamespace, token, inner] = value;
  if (cursorOwner !== owner || cursorNamespace !== namespace) throw new CoreError("cursor_stale");
  return { position: { token, inner }, limit: pageLimit(limit) };
}

/** @param {unknown} value @param {number} max */
function budget(value, max) {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > max) {
    throw new CoreError("invalid_input");
  }
  return value;
}

/**
 * @param {StorageAdapter} storage
 * @param {import("../ports/model.d.ts").TokenCounter} tokens
 * @returns {Pick<import("../ports/host.d.ts").MemoryService, "recent" | "sessionStart" | "exportMemories">}
 */
export function readMethods({ uow, recent, memories, snapshot, fence }, tokens) {
  /** @param {string} text */
  const countTokens = text => {
    try {
      const count = tokens.countTokens(text);
      if (!Number.isSafeInteger(count) || count < 0) throw new CoreError("internal_error");
      return count;
    } catch (error) {
      throw entryError(error);
    }
  };

  /** @param {Tx} tx @param {RetrievalScope} scope */
  async function stateToken(tx, scope) {
    const token = await snapshot.stateToken(tx, scope);
    if (typeof token !== "string" || !token) throw new CoreError("internal_error");
    return token;
  }

  /** @param {"recent-v1" | "export-v1"} route */
  const paged = route => entry(async (/** @type {unknown} */ input, /** @type {unknown} */ options) => {
    const scope = scopeOf(input);
    const readScope = readSet(scope);
    const { position, limit } = readPage(options, scope, route);
    return uow.run(scope.owner, { readOnly: true }, async tx => {
      const token = position ? position.token : await stateToken(tx, readScope);
      if (position) await snapshot.assertUnchanged(tx, readScope, token);
      const page = { cursor: position?.inner ?? null, limit };
      const result = route === "recent-v1"
        ? await recent.recent(tx, readScope, page)
        : await memories.exportPage(tx, scope, page);
      const items = await visibleRows(result.items, readScope, tx, fence);
      // Use the store's last scanned position even if the fence drops a row.
      const nextCursor = result.nextCursor === null ? null
        : encodeCursor([route, scope.owner, scope.namespace, token, result.nextCursor]);
      return { items, nextCursor };
    });
  });

  return {
    recent: paged("recent-v1"),
    exportMemories: paged("export-v1"),
    sessionStart: entry(async (input, options) => {
      const scope = scopeOf(input);
      const { maxTokens, maxChars, projectId } = validateObject(options, ["maxTokens", "maxChars", "projectId"]);
      if (projectId != null && (!isWellFormedText(projectId) || !projectId)) throw new CoreError("invalid_input");
      const packing = {
        maxTokens: budget(maxTokens, 2000), maxChars: budget(maxChars, 8000),
        projectId, project: hostedProjection(scope.owner, projectId),
      };
      const empty = packSessionStart([], packing, countTokens);
      if (projectId != null) return empty;

      const readScope = readSet(scope);
      const { rows, token } = await uow.run(scope.owner, { readOnly: true }, async tx => {
        const token = await stateToken(tx, readScope);
        /** @type {MemoryRow[]} */
        const rows = [];
        let background = 0;
        let procedural = 0;
        let cursor = null;
        do {
          const page = await recent.recent(tx, readScope, { cursor, limit: 50 });
          for (const row of await visibleRows(page.items, readScope, tx, fence)) {
            if (row.kind === "instruction" && procedural < 7) {
              rows.push(row);
              procedural++;
            }
            if ((row.kind === "fact" || row.kind === "context") && background < 7) {
              rows.push(row);
              background++;
            }
          }
          cursor = page.nextCursor;
        } while (cursor !== null && (background < 7 || procedural < 7));
        return { rows, token };
      });

      if (!rows.length) return empty;
      const context = packSessionStart(rows.map(row => {
        const text = redactHostedCurrent(row.text);
        return text === row.text ? row : { ...row, text };
      }), packing, countTokens);
      const selected = [...context.groups.background.items, ...context.groups.procedural.items];
      if (selected.length) {
        await uow.run(scope.owner, { readOnly: true }, async tx => {
          await snapshot.assertUnchanged(tx, readScope, token);
          const visible = await visibleRows(selected, readScope, tx, fence);
          if (visible.length !== selected.length) throw new CoreError("cursor_stale");
        });
      }
      return context;
    }),
  };
}
