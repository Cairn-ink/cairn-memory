import { detach, identifier, isWellFormedText, validateObject } from "../capture/validate.mjs";
import { CoreError } from "../errors.mjs";
import { decideWrite } from "../memory-policy/index.mjs";
import { cleanContent, prepareCoreText } from "../privacy/text.mjs";
import { captureTextWithholding, prepareMessageContent } from "./capture.mjs";
import { entryError, scopeOf } from "./entry.mjs";
import { pauseResult } from "./pause.mjs";
import { fullWriteWithholds, memoryKindOf, prepareWriteText, sourceOf, writeEmbedding } from "./writes.mjs";

/** @import {CaptureMessage} from "../ports/capture.d.ts" */
/** @import {ImportMemory, ImportResult, MemoryService} from "../ports/host.d.ts" */

const batchSize = 100;
const rawMessageLimit = 500;
const maxArrayLength = 2 ** 32 - 1;
const firstTimestampMs = Date.parse("0001-01-01T00:00:00.000Z");
const lastTimestampMs = Date.parse("9999-12-31T23:59:59.999Z");

/** @param {unknown} value @returns {ImportMemory | null} */
function cleanMemoryRow(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const { text: raw, kind, createdAtMs } = /** @type {Record<string, unknown>} */ (value);
  if (typeof raw !== "string") return null;
  if (createdAtMs !== undefined && (typeof createdAtMs !== "number" || !Number.isSafeInteger(createdAtMs) ||
      createdAtMs < firstTimestampMs || createdAtMs > lastTimestampMs)) return null;
  const text = cleanContent(raw);
  if (!text.trim() || (text.length > 4000 && Array.from(text).length > 4000)) return null;
  return { text, kind: memoryKindOf(kind), createdAtMs };
}

/**
 * @template T
 * @param {unknown} input
 * @param {(items: unknown[], index: number) => T} read
 * @param {number} [limit]
 */
function snapshotBatch(input, read, limit = maxArrayLength) {
  try {
    if (!Array.isArray(input)) throw new CoreError("invalid_input");
    const length = input.length;
    if (!Number.isInteger(length) || length < 0 || length > limit) throw new CoreError("invalid_input");
    const rows = [];
    for (let index = 0; index < length; index++) rows.push(read(input, index));
    if (input.length !== length) throw new CoreError("invalid_input");
    return rows;
  } catch {
    throw new CoreError("invalid_input");
  }
}

/** @template T @param {unknown[]} items @param {number} index @param {(item: unknown) => T} clean */
function importItem(items, index, clean) {
  try {
    return clean(items[index]);
  } catch {
    return null;
  }
}

/** @param {unknown} input @param {unknown} items @param {unknown} inputSource */
function snapshotImport(input, items, inputSource) {
  const [scopeInput, sourceInput] = detach([input, inputSource], "invalid_input");
  const scope = scopeOf(scopeInput);
  const source = sourceOf(sourceInput);
  if (source.client === "" || source.sessionId === "") throw new CoreError("invalid_input");

  const rows = snapshotBatch(items, (batch, index) => importItem(batch, index, cleanMemoryRow));
  return { scope, source, rows };
}

/** @param {import("./index.d.mts").MemoryServiceDeps} deps @returns {MemoryService["importMemories"]} */
export function importMethod(deps) {
  const { storage: { uow, pause, memories, suppressions, keys }, clock } = deps;
  const { embedImport } = writeEmbedding(deps);

  return async (input, items, inputSource) => {
    try {
      const { scope, source, rows } = snapshotImport(input, items, inputSource);
      const { owner } = scope;
      if (typeof keys?.userKey !== "function" || typeof suppressions?.snapshot !== "function" ||
          typeof memories.readWritePolicy !== "function" || typeof memories.insert !== "function") {
        throw new CoreError("capability_unavailable");
      }

      /** @type {ImportResult} */
      const counts = { imported: 0, duplicate: 0, suppressed: 0, invalid: 0 };
      const paused = () => /** @type {const} */ ({ status: "paused", ...counts });
      /** @type {readonly import("../ports/privacy.d.ts").RetainedDigester[] | undefined} */
      let digesters;
      for (let start = 0; start < rows.length; start += batchSize) {
        const inputBatch = rows.slice(start, start + batchSize);
        let validationTime;
        const batch = inputBatch.filter(item => item !== null)
          .filter(({ createdAtMs }) => createdAtMs === undefined || createdAtMs <= (validationTime ??= clock.nowMs()))
          .map(item => ({ ...item, raw: item.text, text: prepareCoreText(item.text) })).filter(item => item.text);
        const invalid = inputBatch.length - batch.length;
        if (!batch.length) {
          counts.invalid += invalid;
          continue;
        }

        const before = await uow.run(owner, { pauseLock: true }, async tx => pauseResult(await pause.get(tx, owner)));
        if (before.paused) return paused();
        const key = await keys.userKey(owner);
        digesters ??= await keys.retainedDigesters?.(owner) ?? [];
        const prepared = await Promise.all(batch.map(async ({ raw, ...item }) => {
          const { query, passages } = await prepareWriteText(raw, item.text, key, text => clock.sha256Hex(text), digesters);
          return { ...item, query, passages };
        }));
        const embeddings = await embedImport(owner, prepared.map(({ text }) => text), key);
        if (embeddings === null) return paused();

        const committed = await uow.run(owner, { pauseLock: true }, async tx => {
          const state = pauseResult(await pause.get(tx, owner));
          if (state.paused || state.generation !== before.generation) return null;
          if (keys.userKeyForWrite && (await keys.userKeyForWrite(tx))?.id !== key?.id) {
            throw new CoreError("fingerprint_key_mismatch");
          }
          const withheld = await fullWriteWithholds(suppressions, tx, scope, source, prepared);
          const queries = prepared.map(({ query }, i) => ({ ...query, embedding: embeddings[i]?.vector }));
          const policy = await memories.readWritePolicy(tx, scope, queries, source, "full", undefined, { nearDuplicate: false });
          const exactPolicy = {
            ...policy, matches: policy.matches.map(matches => matches.filter(match => match.match === "exact")),
          };
          const inserted = new Set();
          const result = { imported: 0, duplicate: 0, suppressed: 0, invalid };
          for (const [i, { kind, text, createdAtMs, query: { textHash, digests } }] of prepared.entries()) {
            // The wall clock may have moved back during embedding or while waiting for the write lock.
            const writeTime = createdAtMs === undefined ? undefined : clock.nowMs();
            if (createdAtMs !== undefined && writeTime !== undefined && createdAtMs > writeTime) {
              result.invalid++;
              continue;
            }
            const decision = decideWrite(exactPolicy, i);
            if (withheld[i] || decision.status === "suppressed") {
              result.suppressed++;
            } else if (inserted.has(textHash) || decision.status === "duplicate") {
              result.duplicate++;
            } else {
              await memories.insert(tx, scope, {
                kind, text, textHash, source, origin: "explicit", confidence: 1, embedding: embeddings[i],
                ...(digests && { digests }),
                ...(createdAtMs !== undefined && { createdAtMs }),
              }, [], writeTime ?? clock.nowMs());
              inserted.add(textHash);
              result.imported++;
            }
          }
          return result;
        });
        if (committed === null) return paused();
        counts.imported += committed.imported;
        counts.duplicate += committed.duplicate;
        counts.suppressed += committed.suppressed;
        counts.invalid += committed.invalid;
      }
      return counts;
    } catch (error) {
      throw entryError(error);
    }
  };
}

/** @param {unknown} value @returns {value is string} */
function validRawIdentifier(value) {
  return isWellFormedText(value) && value.length > 0 && !value.includes("\0");
}

/** @param {unknown} value @returns {{message: CaptureMessage, originalContent: string} | null} */
function prepareRawMessage(value) {
  if (value == null) return null;
  const { id, role, content, occurredAtMs } = /** @type {Partial<Record<keyof CaptureMessage, unknown>>} */ (value);
  if (!validRawIdentifier(id) || id.length > 512 ||
      (role !== "user" && role !== "assistant") || typeof content !== "string" ||
      (occurredAtMs !== null && (typeof occurredAtMs !== "number" || !Number.isSafeInteger(occurredAtMs) ||
        occurredAtMs < firstTimestampMs || occurredAtMs > lastTimestampMs))) return null;
  const originalContent = cleanContent(content);
  return { message: { id, role, content: prepareMessageContent(originalContent), occurredAtMs }, originalContent };
}

/** @param {unknown} input */
function snapshotRawSessions(input) {
  let remaining = rawMessageLimit;
  let invalid = 0;
  const sessions = snapshotBatch(input, (batch, index) => {
    const { client: rawClient, sessionId: rawSessionId, messages: rawMessages } =
      validateObject(batch[index], ["client", "sessionId", "messages"]);
    const client = identifier(rawClient);
    if (!validRawIdentifier(rawSessionId)) throw new CoreError("invalid_input");
    const sessionId = rawSessionId;
    const rows = snapshotBatch(rawMessages, (messages, index) => importItem(messages, index, prepareRawMessage), remaining);
    remaining -= rows.length;
    const messages = rows.filter(message => message !== null);
    invalid += rows.length - messages.length;
    return { client, sessionId, messages };
  });
  return { sessions, invalid };
}

/** @param {import("./index.d.mts").MemoryServiceDeps} deps @returns {MemoryService["importRawMessages"]} */
export function importRawMethod({ storage }) {
  const { capabilities, raw, uow, pause, suppressions, keys } = storage;
  return async (input, inputSessions) => {
    try {
      const scope = scopeOf(detach(input, "invalid_input"));
      const { sessions, invalid } = snapshotRawSessions(inputSessions);
      const importArchive = raw?.importArchive;
      if (!capabilities.rawArchive || typeof importArchive !== "function") {
        throw new CoreError("capability_unavailable");
      }

      const { owner } = scope;
      const counts = { imported: 0, duplicate: 0, suppressed: 0, invalid };
      for (const { client, sessionId, messages } of sessions) {
        const committed = await uow.run(owner, { pauseLock: true }, async tx => {
          if (pauseResult(await pause.get(tx, owner)).paused) return null;
          const session = { client, sessionId };
          const { passages } = await suppressions.snapshot(tx, scope, {
            ...session, occurredAtMs: messages.map(({ message }) => message.occurredAtMs),
          });
          const { legacyKeyUnavailable, matches } = captureTextWithholding(passages);
          const prepared = messages.map(({ message }) => message);
          /** @type {number[]} */
          let withheld = [];
          if (legacyKeyUnavailable) {
            withheld = prepared.map((_, position) => position);
          } else if (matches && messages.length) {
            const key = capabilities.fingerprintKey
              ? await (keys.userKeyForWrite ? keys.userKeyForWrite(tx) : keys.userKey(owner)) : null;
            const blocked = await Promise.all(messages.map(({ message, originalContent }) =>
              matches(originalContent, message.content, key)));
            withheld = blocked.flatMap((matched, position) => matched ? [position] : []);
          }
          return importArchive.call(raw, tx, scope, session, prepared, { withheld });
        });
        if (committed === null) return { status: "paused" };
        counts.imported += committed.archived;
        counts.duplicate += committed.existing;
        counts.suppressed += committed.withheld;
      }
      return counts;
    } catch (error) {
      throw entryError(error);
    }
  };
}
