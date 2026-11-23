import { factHidesRow } from "../privacy/fact-match.mjs";
import { buildDocumentCard } from "./card.mjs";

/** @import { Scope } from "../ports/common.d.ts" */
/** @import { DocumentCardHiddenReason, DocumentCardSourceWithheldInput, DocumentCardStalenessInput, DocumentCardVisibility, DocumentCardVisibilityInput, StaleReplacement, StaleReplacementInput } from "./visibility.mjs" */

/** @param {unknown} value @returns {value is string} */
const nonempty = (value) => typeof value === "string" && value.length > 0;

/** @param {Scope | undefined} scope */
const validScope = (scope) => nonempty(scope?.owner) && (scope.namespace === null || nonempty(scope.namespace));

/** @param {unknown} value @returns {value is number} */
const natural = (value) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

/** @param {DocumentCardHiddenReason} reason @returns {DocumentCardVisibility} */
const hidden = (reason) => ({ visible: false, reason });

/** @param {DocumentCardVisibilityInput} input @returns {Promise<DocumentCardVisibility>} */
export async function documentCardVisible(input) {
  try {
    const { card, requestedScope, memoryStates, sourceWithheld } = input;
    if (!validScope(card?.scope) || !validScope(requestedScope)) return hidden("uncertain");
    if (card.scope.owner !== requestedScope.owner || card.scope.namespace !== requestedScope.namespace) {
      return hidden("scope_mismatch");
    }
    if (sourceWithheld === true) return hidden("source_withheld");
    if (sourceWithheld !== false || typeof memoryStates?.get !== "function" || !Array.isArray(card.sourceMemories)) {
      return hidden("uncertain");
    }

    const { sourceMessage, canonicalSessionKey } = card;
    if (!nonempty(card.id) || !nonempty(sourceMessage?.client) || !nonempty(sourceMessage.sessionId) ||
        !nonempty(sourceMessage.messageId) || !nonempty(canonicalSessionKey)) return hidden("uncertain");
    // The builder owns the ID recipe. A fixed body lets it compute the ID without reading stored text.
    const expected = await buildDocumentCard(
      { id: sourceMessage.messageId, role: "user", content: "." },
      { scope: requestedScope, client: sourceMessage.client, canonicalSessionKey },
    );
    if (!expected.card) return hidden("uncertain");
    if (expected.card.id !== card.id) return hidden("id_mismatch");

    for (const source of card.sourceMemories) {
      if (!nonempty(source?.id) || !natural(source.revision)) return hidden("uncertain");
      const state = memoryStates.get(source.id);
      if (!state) return hidden("source_memory_missing");
      if (state.status === "forgotten") return hidden("source_memory_forgotten");
      if (state.status !== "visible") return hidden("source_memory_not_visible");
      if (!natural(state.revision)) return hidden("uncertain");
    }
    return { visible: true, reason: null };
  } catch {
    return hidden("uncertain");
  }
}

/** @param {DocumentCardStalenessInput} input */
export function documentCardStaleness(input) {
  try {
    const { card, memoryStates } = input;
    if (typeof memoryStates?.get !== "function" || !Array.isArray(card?.stale) || !Array.isArray(card.sourceMemories)) {
      return true;
    }
    if (card.stale.length > 0) return true;
    for (const source of card.sourceMemories) {
      if (!nonempty(source?.id) || !natural(source.revision)) return true;
      const state = memoryStates.get(source.id);
      if (state?.status !== "visible" || state.revision !== source.revision) return true;
    }
    return false;
  } catch {
    return true;
  }
}

/** @param {StaleReplacementInput} input @returns {StaleReplacement | null} */
export function resolveStaleReplacement(input) {
  try {
    const { replacementMemoryId, memoryStates, successorOf } = input;
    if (!memoryStates || !successorOf) return null;
    let memoryId = replacementMemoryId ?? undefined;
    const visited = new Set();
    while (nonempty(memoryId) && !visited.has(memoryId)) {
      visited.add(memoryId);
      const state = memoryStates.get(memoryId);
      if (state?.status === "historical" && natural(state.revision)) {
        memoryId = successorOf.get(memoryId);
        continue;
      }
      if (state?.status !== "visible" || successorOf.has(memoryId)) return null;
      const { revision, content, date } = state;
      return natural(revision) && nonempty(content) &&
        (date === null || (typeof date === "number" && Number.isSafeInteger(date)))
        ? { memoryId, revision, content, date }
        : null;
    }
  } catch {
    return null;
  }
  return null;
}

/** @param {DocumentCardSourceWithheldInput} input */
export function documentCardSourceWithheld(input) {
  try {
    const { rawRows, sourceLengthUtf16, facts, sourceExcluded, policy } = input;
    if (sourceExcluded !== false || !natural(sourceLengthUtf16) || sourceLengthUtf16 === 0 ||
        !Array.isArray(rawRows) || !rawRows.length || !Array.isArray(facts)) return true;
    const source = rawRows[0];
    let coveredUntil = 0;
    for (const row of rawRows) {
      if (row?.type !== "raw" || !validScope(row.scope) || !nonempty(row.messageKey) ||
          !nonempty(row.sessionKeyHash) || !/^[0-9a-f]{64}$/u.test(row.sessionKeyHash) ||
          row.startUtf16 !== coveredUntil || !natural(row.endUtf16) ||
          row.endUtf16 <= coveredUntil || row.endUtf16 > sourceLengthUtf16) return true;
      if (row.scope.owner !== source.scope.owner || row.scope.namespace !== source.scope.namespace ||
          row.sessionKeyHash !== source.sessionKeyHash || row.messageKey !== source.messageKey) return true;
      for (const fact of facts) {
        if (factHidesRow(fact, row, policy) !== false) return true;
      }
      coveredUntil = row.endUtf16;
    }
    return coveredUntil !== sourceLengthUtf16;
  } catch {
    return true;
  }
}
