import { detach } from "../capture/validate.mjs";
import { CoreError } from "../errors.mjs";
import { decideWrite } from "../memory-policy/index.mjs";
import { cleanContent, prepareCoreText } from "../privacy/text.mjs";
import { entryError, scopeOf } from "./entry.mjs";
import { pauseResult } from "./pause.mjs";
import { fullWriteWithholds, memoryKindOf, prepareWriteText, sourceOf, writeEmbedding } from "./writes.mjs";

/** @import {ImportMemory, ImportResult, MemoryService} from "../ports/host.d.ts" */

const batchSize = 100;
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

/** @param {unknown} input @param {unknown} items @param {unknown} inputSource */
function snapshotImport(input, items, inputSource) {
  const [scopeInput, sourceInput] = detach([input, inputSource], "invalid_input");
  const scope = scopeOf(scopeInput);
  const source = sourceOf(sourceInput);
  if (source.client === "" || source.sessionId === "") throw new CoreError("invalid_input");

  /** @type {(ImportMemory | null)[]} */
  const rows = [];
  try {
    if (!Array.isArray(items)) throw new CoreError("invalid_input");
    const length = items.length;
    if (!Number.isInteger(length) || length < 0 || length > 2 ** 32 - 1) throw new CoreError("invalid_input");
    for (let index = 0; index < length; index++) {
      try {
        rows.push(cleanMemoryRow(items[index]));
      } catch {
        rows.push(null);
      }
    }
    if (items.length !== length) throw new CoreError("invalid_input");
  } catch {
    throw new CoreError("invalid_input");
  }
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
      for (let start = 0; start < rows.length; start += batchSize) {
        const inputBatch = rows.slice(start, start + batchSize);
        const batch = inputBatch.filter(item => item !== null).map(item => ({
          ...item, raw: item.text, text: prepareCoreText(item.text),
        })).filter(item => item.text);
        counts.invalid += inputBatch.length - batch.length;
        if (!batch.length) continue;

        const before = await uow.run(owner, { pauseLock: true }, async tx => pauseResult(await pause.get(tx, owner)));
        if (before.paused) return { status: "paused" };
        const key = await keys.userKey(owner);
        const prepared = await Promise.all(batch.map(async ({ raw, ...item }) => {
          const { query, passages } = await prepareWriteText(raw, item.text, key, text => clock.sha256Hex(text));
          const { legacyHash: _legacyHash, ...exactQuery } = query;
          return { ...item, query: exactQuery, passages };
        }));
        const embeddings = await embedImport(owner, prepared.map(({ text }) => text), key);
        if (embeddings === null) return { status: "paused" };

        const committed = await uow.run(owner, { pauseLock: true }, async tx => {
          const state = pauseResult(await pause.get(tx, owner));
          if (state.paused || state.generation !== before.generation) return null;
          const withheld = await fullWriteWithholds(suppressions, tx, scope, source, prepared);
          const queries = prepared.map(({ query }, i) => ({ ...query, embedding: embeddings[i]?.vector }));
          const policy = await memories.readWritePolicy(tx, scope, queries, source, "full");
          const exactPolicy = {
            ...policy, matches: policy.matches.map(matches => matches.filter(match => match.match === "exact")),
          };
          const inserted = new Set();
          const result = { imported: 0, duplicate: 0, suppressed: 0 };
          for (const [i, { kind, text, query: { textHash, digests } }] of prepared.entries()) {
            const decision = decideWrite(exactPolicy, i);
            if (withheld[i] || decision.status === "suppressed") {
              result.suppressed++;
            } else if (inserted.has(textHash) || decision.status === "duplicate") {
              result.duplicate++;
            } else {
              await memories.insert(tx, scope, {
                kind, text, textHash, source, origin: "explicit", confidence: 1, embedding: embeddings[i],
                ...(digests && { digests }),
              }, [], clock.nowMs());
              inserted.add(textHash);
              result.imported++;
            }
          }
          return result;
        });
        if (committed === null) return { status: "paused" };
        counts.imported += committed.imported;
        counts.duplicate += committed.duplicate;
        counts.suppressed += committed.suppressed;
      }
      return counts;
    } catch (error) {
      throw entryError(error);
    }
  };
}
