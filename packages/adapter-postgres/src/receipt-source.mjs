import { CoreError } from "../../core/src/index.mjs";
import { filterSources, hasRawFence } from "./capture-source.mjs";
import { readRawSpanFacts } from "./memory-visibility.mjs";
import { rawSpanFilter } from "./raw-import.mjs";
import { conversationSessions } from "./raw-session.mjs";

/** @import { CaptureMessage } from "../../core/src/ports/capture.d.ts" */
/** @import { Receipt, Scope } from "../../core/src/ports/common.d.ts" */
/** @import { CaptureOptions } from "./capture.d.mts" */
/** @import { Proof, Signer } from "./capture-source.mjs" */
/** @typedef {import("./driver.mjs").Connection["query"]} Query */

/**
 * @param {Query} query @param {Scope} scope @param {Receipt} receipt
 * @param {Signer | undefined} signer @param {CaptureOptions["hashSessionKey"]} hashSessionKey
 * @param {readonly CaptureMessage[]} [admitted]
 * @param {{times: (number | null)[], proofs: Proof[]}} [lease]
 */
export async function assertReceiptSource(query, scope, receipt, signer, hashSessionKey, admitted = [], lease) {
  const { client, sessionId, messageId, role } = receipt;
  const source = { scope, client, sessionId };
  if (await hasRawFence(query, source)) throw new CoreError("lineage_fenced");
  const messages = admitted.filter(message => message.id === messageId && message.role === role && message.content !== "");
  const sessions = await conversationSessions(query, scope, source);
  const params = [scope.owner, sessions.map(session => session.client), sessionId, messageId];
  const address = "user_id = $1 AND client = ANY($2::text[]) AND session_id = $3 AND message_id = $4";
  const { rows: tombstones } = await query(`SELECT 1 FROM core_memory_receipts
    WHERE ${address} AND forgotten_at IS NOT NULL LIMIT 1`, params);
  if (tombstones.length) throw new CoreError("suppressed");
  if (scope.namespace === null) {
    const { rows } = await query(`SELECT client, role, content, floor(EXTRACT(EPOCH FROM occurred_at) * 1000)::text AS occurred_at_ms
      FROM raw_messages WHERE ${address}`, params);
    const facts = rows.length ? await readRawSpanFacts(query, scope, messageId) : [];
    for (const row of rows) {
      const occurredAtMs = row.occurred_at_ms === null ? null : Number(row.occurred_at_ms);
      if (row.role !== role || !row.content || (occurredAtMs !== null && !Number.isSafeInteger(occurredAtMs))) {
        throw new CoreError("suppressed");
      }
      const message = { id: messageId, role, occurredAtMs, content: row.content };
      const spanBlocked = rawSpanFilter(facts, { ...source, client: row.client }, hashSessionKey);
      // The receipt cites the stored message regardless of the excerpt it carries.
      if (spanBlocked(message, row.content.length)) throw new CoreError("suppressed");
      messages.push(message);
    }
  }
  const times = [...messages.map(message => message.occurredAtMs), ...(lease?.times ?? [])];
  if (!times.length) throw new CoreError("suppressed");
  const proofs = signer ? await signer(source, messages) : [];
  await filterSources(query, source, times, proofs && [...proofs, ...(lease?.proofs ?? [])],
    "assert", signer, hashSessionKey, false, messages);
}
