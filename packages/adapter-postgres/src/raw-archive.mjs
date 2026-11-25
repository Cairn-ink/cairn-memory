import { decodeRequest, hostedTime, pgText } from "./capture-input.mjs";
import { filterSources } from "./capture-source.mjs";
import { readVisibilityFacts } from "./memory-visibility.mjs";
import { rawSpanFilter } from "./raw-import.mjs";

/** @import { CaptureKey, CaptureMessage } from "../../core/src/ports/capture.d.ts" */
/** @import { Signer } from "./capture-source.mjs" */
/** @import { Query } from "./memory-rows.mjs" */
/** @import { RawOptions } from "./raw-options.d.mts" */

const LOCK_ARCHIVE_OUTBOX = `SELECT raw_request, core_outbox_metadata FROM capture_events
  WHERE user_id = $1 AND client = $2 AND session_id = $3 AND event_id = $4
    AND core_namespace IS NULL AND (core_admitted OR core_payload_digest IS NULL) FOR UPDATE`;

/** @param {CaptureMessage} message */
export function rawMessageStorable({ id, content }) {
  return pgText(id) && id.length > 0 && pgText(content);
}

/** @param {Query} query @param {Pick<CaptureKey, "scope" | "client" | "sessionId" | "eventId">} capture
 * @param {readonly CaptureMessage[]} batch @param {Signer} signer
 * @param {RawOptions["hashSessionKey"]} hashSessionKey @param {boolean} [requireOutbox] */
export async function archiveCandidates(query, capture, batch, signer, hashSessionKey, requireOutbox = false) {
  const times = batch.map(({ occurredAtMs }) => occurredAtMs);
  // An unrepresentable time cannot be archived as an unknown time.
  const hostedTimes = times.map(time => time === null ? null : hostedTime(time) ?? undefined);
  const withheld = hostedTimes.filter(time => time === undefined).length;
  const positions = await filterSources(query, capture, times, await signer(capture, batch),
    "raw", signer, hashSessionKey, false, batch);
  if (!positions.length) return { candidates: [], withheld };

  const { scope, client, sessionId, eventId } = capture;
  const { rows: [outbox] } = await query(LOCK_ARCHIVE_OUTBOX, [scope.owner, client, sessionId, eventId]);
  if (!outbox && requireOutbox) return { candidates: [], withheld };
  /** @type {Set<string> | undefined} */
  let eligible;
  if (outbox) {
    const { messages: stored } = decodeRequest(outbox.raw_request);
    const metadata = decodeRequest(outbox.core_outbox_metadata);
    eligible = new Set(stored.flatMap((/** @type {{id: string, content: string}} */ { id, content }, /** @type {number} */ index) =>
      content ? [JSON.stringify([metadata?.[index]?.id ?? id, content])] : []));
  }
  const facts = await readVisibilityFacts(query, scope.owner, { rawSpans: true });
  const spanBlocked = rawSpanFilter(facts, capture, hashSessionKey);
  const candidates = positions.flatMap(index => {
    const message = batch[index];
    const occurredAt = hostedTimes[index];
    if (occurredAt === undefined || spanBlocked(message) ||
        (eligible && !eligible.has(JSON.stringify([message.id, message.content])))) return [];
    return [{ message, occurredAt }];
  });
  return { candidates, withheld };
}
