import { CoreError } from "../errors.mjs";
import { decodeCursor, encodeCursor } from "../retrieval/hosted-paging.mjs";
import { compareSortKey, compareUtf8 } from "../utf8.mjs";

/** @import { HostedTopicListItem, Scope, TopicPage } from "../ports/index.d.ts" */

// The hosted database default is deterministic ICU en_US.UTF-8. Pin that
// locale in portable stores and use PostgreSQL's byte tie-break when ICU
// considers distinct IDs equivalent (for example, Unicode normalization forms).
const english = new Intl.Collator("en-US");

/** @param {string} a @param {string} b */
export function compareHostedTopicIds(a, b) {
  return english.compare(a, b) || compareUtf8(a, b);
}

/** @param {unknown} id @returns {id is string} */
export function validHostedTopicId(id) {
  return typeof id === "string" && id.length > 0 && !/[\0\uD800-\uDFFF]/u.test(id);
}

/**
 * @template T, K
 * @param {TopicPage} query @param {Scope} scope @param {string} view @param {string | null} filter
 * @param {number} revision @param {(order: unknown, id: string) => K} readKey
 * @param {(row: T) => [number | string, string]} writeKey
 * @param {(row: T, after: K) => number} compare
 */
function hostedPage({ cursor, limit }, { owner, namespace }, view, filter, revision, readKey, writeKey, compare) {
  if (!Number.isSafeInteger(limit) || limit < 1) throw new CoreError("invalid_input");
  const prefix = [view, owner, namespace, filter];
  let after = null;
  if (cursor !== null) {
    const token = decodeCursor(cursor);
    if (!Array.isArray(token) || encodeCursor(token) !== cursor || token.length !== 7 ||
        prefix.some((value, i) => token[i] !== value) ||
        !Number.isSafeInteger(token[4]) || token[4] < 0 || !validHostedTopicId(token[6])) {
      throw new CoreError("invalid_cursor");
    }
    after = readKey(token[5], token[6]);
    if (token[4] !== revision) throw new CoreError("cursor_stale");
  }
  /** @param {T[]} rows */
  function finish(rows) {
    const items = rows.slice(0, limit);
    return { items, nextCursor: rows.length > limit
      ? encodeCursor([...prefix, revision, ...writeKey(items[items.length - 1])]) : null };
  }
  return {
    after, finish,
    /** @param {T[]} sorted */
    seek(sorted) {
      // Find the first strict successor, even if the cursor row is absent.
      let low = 0;
      let high = sorted.length;
      if (after !== null) {
        while (low < high) {
          const middle = low + Math.floor((high - low) / 2);
          if (compare(sorted[middle], after) <= 0) low = middle + 1;
          else high = middle;
        }
      }
      return finish(sorted.slice(low, low + limit + 1));
    },
  };
}

/** @param {Pick<HostedTopicListItem, "memberCount" | "id">} a @param {Pick<HostedTopicListItem, "memberCount" | "id">} b */
export function compareHostedTopics(a, b) {
  return b.memberCount - a.memberCount || compareHostedTopicIds(a.id, b.id);
}

/** @param {TopicPage} query @param {Scope} scope @param {string | null} level @param {number} revision */
export function hostedTopicListPage(query, scope, level, revision) {
  return hostedPage(query, scope, "hosted-topic-list", level, revision, (memberCount, id) => {
    if (typeof memberCount !== "number" || !Number.isSafeInteger(memberCount) || memberCount < 1) {
      throw new CoreError("invalid_cursor");
    }
    return { memberCount, id };
  }, (/** @type {HostedTopicListItem} */ row) => [row.memberCount, row.id], compareHostedTopics);
}

/** @typedef {{id: string, placedAtUs: bigint}} PlacedMember */

/** @param {PlacedMember} a @param {PlacedMember} b */
export function compareHostedTopicMembers(a, b) {
  return compareSortKey(b.placedAtUs, a.placedAtUs) || compareHostedTopicIds(b.id, a.id);
}

/** @param {TopicPage} query @param {Scope} scope @param {string} topicId @param {number} revision */
export function hostedTopicMemberPage(query, scope, topicId, revision) {
  return hostedPage(query, scope, "hosted-topic-members", topicId, revision, (time, id) => {
    if (typeof time !== "string" || !/^(0|-?[1-9][0-9]{0,18})$/.test(time)) throw new CoreError("invalid_cursor");
    const placedAtUs = BigInt(time);
    if (BigInt.asIntN(64, placedAtUs) !== placedAtUs) throw new CoreError("invalid_cursor");
    return { placedAtUs, id };
  }, (/** @type {PlacedMember} */ row) => [row.placedAtUs.toString(), row.id], compareHostedTopicMembers);
}
