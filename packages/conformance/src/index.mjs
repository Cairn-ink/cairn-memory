import { toCoreError } from "@cairn-ink/core";
import { captureCases } from "./capture-cases.mjs";
import { captureFinishCases } from "./capture-finish-cases.mjs";
import { memoryCases } from "./memory-cases.mjs";
import { retrievalCases } from "./retrieval-cases.mjs";
import { bounded, check, DEFAULT_TIMEOUT_MS, isFixtureEmbeddingExhaustion, referenceVector } from "./support.mjs";
import { unitOfWorkCases } from "./unit-of-work-cases.mjs";

export { privacyCases as PRIVACY_CASES } from "./privacy-cases.mjs";
export { CAPTURE_CONTAINMENT_CASES } from "./capture-containment-cases.mjs";
export { CAPTURE_LATE_FORGET_CASES } from "./capture-late-forget-cases.mjs";
export { CAPTURE_DELETE_CASES } from "./capture-delete-cases.mjs";
export { ADMISSION_CASES } from "./admission-cases.mjs";
export { IMPORT_TIME_CASES } from "./import-time-cases.mjs";
export { PRIVACY_MATCH_CASES } from "./privacy-match-cases.mjs";
export { SOURCE_FILTER_CASES } from "./source-filter-cases.mjs";
export { KEYED_DIGEST_CASES } from "./keyed-digest-cases.mjs";
export { RETAINED_KEYED_DIGEST_CASES } from "./keyed-digest-cases.mjs";
export { RATIONALE_CASES } from "./rationale-cases.mjs";
export { RETRIEVAL_WINDOW_CASES } from "./retrieval-window-cases.mjs";
export { FENCE_INTENT_CASES } from "./fence-intent-cases.mjs";
export { topicCases as TOPIC_CASES } from "./topics-cases.mjs";
export { TOPIC_FOR_MEMORIES_CASES } from "./topics-for-memories-cases.mjs";
export { RAW_CASES } from "./raw-cases.mjs";
export { SPAN_LINEAGE_CASES } from "./span-lineage-cases.mjs";
export { RAW_LEDGER_CASES } from "./raw-ledger-cases.mjs";
export { IMPORT_ARCHIVE_CASES } from "./import-archive-cases.mjs";
export { PROVEN_FORK_CASES } from "./proven-fork-cases.mjs";
export { relationCases as RELATION_CASES } from "./relation-cases.mjs";
export { TOPIC_CARD_CASES } from "./topics-cards-cases.mjs";
export { DOCUMENT_CARD_AMENDMENT_CASES } from "./document-card-amendment-cases.mjs";
export { DOCUMENT_CARD_LINK_CASES } from "./document-card-link-cases.mjs";
export { CAPTURE_DOCUMENT_CARD_CASES } from "./capture-document-card-cases.mjs";
export { CAPTURE_DOCUMENT_AMENDMENT_CASES } from "./capture-document-amendment-cases.mjs";
export { CAPTURE_QUANTITY_LEDGER_CASES } from "./capture-quantity-ledger-cases.mjs";
export { CAPTURE_DOCUMENT_FORGET_CASES } from "./capture-document-forget-cases.mjs";
export { TOPICS_FOR_CARDS_CASES } from "./topics-for-cards-cases.mjs";
export { DELIVERY_VISIBILITY_CASES } from "./delivery-visibility-cases.mjs";
export { RECEIPT_WITHHELD_CASES } from "./receipt-withheld-cases.mjs";

/** @type {readonly import("./index.d.mts").ConformanceCase[]} */
export const CAPTURE_CASES = [...captureCases, ...captureFinishCases];

/** @type {readonly import("./index.d.mts").ConformanceCase[]} */
export const CASES = [...unitOfWorkCases, ...memoryCases, ...retrievalCases];

const encoder = new TextEncoder();

/** @param {string} text */
async function hash(text) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(text));
  return "sha256:" + Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * @param {import("./factory.d.ts").AdapterFactory} factory
 * @param {import("./index.d.mts").ConformanceCase} testCase
 */
export async function runCase(factory, testCase) {
  if (testCase.pending !== undefined) return testCase.pending;
  const reason = await runOpenedCase(factory, testCase);
  if (reason !== null || !testCase.followUp) return reason;
  return runOpenedCase(factory, testCase.followUp);
}

/**
 * @param {import("./factory.d.ts").AdapterFactory} factory
 * @param {Pick<import("./index.d.mts").ConformanceCase, "needs" | "needsOff" | "requests" | "run">} testCase
 */
async function runOpenedCase(factory, testCase) {
  const needsOff = testCase.needsOff ?? [];
  /** @type {Partial<import("@cairn-ink/core").Capabilities>} */
  const capabilities = {
    ...testCase.requests,
    ...Object.fromEntries(testCase.needs.map((flag) => [flag, true])),
    ...Object.fromEntries(needsOff.map((flag) => [flag, false])),
  };
  let opened;
  /** @type {{ error: unknown } | undefined} */
  let retryFailure;
  try {
    opened = await factory.open({ capabilities });
  } catch (error) {
    if (toCoreError(error).code !== "capability_unavailable") throw error;
    const retry = { ...capabilities };
    // A factory can reject these requests during setup. Check the actual flags after reopening.
    if (retry.rawArchive === true && !testCase.needs.includes("rawArchive")) delete retry.rawArchive;
    const unavailable = (/** @type {const} */ (["sessionLineage", "quantityLedger"]))
      .filter(flag => retry[flag] === true && testCase.needs.includes(flag));
    for (const flag of unavailable) delete retry[flag];
    if (retry.rawArchive === capabilities.rawArchive && !unavailable.length) throw error;
    opened = await factory.open({ capabilities: retry });
    // The retry may only turn a rejected NEEDED capability into a reported skip. If the store provides that
    // capability after all, the first rejection was a real setup failure and must not become a pass.
    if (unavailable.some(flag => opened.adapter?.capabilities?.[flag])) {
      retryFailure = { error };
    }
  }
  const { adapter, embeddingDimensions, harness, nativeErrorMap, busyNativeCodes, sessionRefs, settleMs,
    timeoutMs = DEFAULT_TIMEOUT_MS } = opened;
  const validTimeout = Number.isFinite(timeoutMs) && timeoutMs > 0;
  const roundedTimeout = validTimeout ? Math.ceil(timeoutMs) : DEFAULT_TIMEOUT_MS;
  /** @type {{ error: unknown } | undefined} */
  let caseFailure;
  /** @type {import("./index.d.mts").CaseContext | undefined} */
  let ctx;
  try {
    if (retryFailure) throw retryFailure.error;
    check(validTimeout, "timeoutMs must be a finite number greater than 0");
    check(settleMs === undefined || (Number.isFinite(settleMs) && settleMs > 0),
      "settleMs must be a finite number greater than 0");
    const missing = testCase.needs.find((flag) => !adapter.capabilities[flag]);
    if (missing) return `needs ${missing}`;
    const enabled = needsOff.find((flag) => adapter.capabilities[flag]);
    if (enabled) return `needs ${enabled} off`;

    const owner = crypto.randomUUID();
    /** @type {import("./index.d.mts").CaseContext} */
    const context = {
      adapter,
      embeddingDimensions,
      harness,
      nativeErrorMap,
      busyNativeCodes,
      sessionRefs,
      settleMs: settleMs === undefined ? undefined : Math.ceil(settleMs),
      timeoutMs: roundedTimeout,
      owner,
      otherOwner: crypto.randomUUID(),
      scope: (namespace) => ({ owner, namespace }),
      hash,
      vec(distance) {
        return referenceVector(context, distance);
      },
    };
    ctx = context;
    const skipReason = await testCase.run(context);
    return skipReason ?? null;
  } catch (error) {
    if (ctx && isFixtureEmbeddingExhaustion(error, ctx) && ctx.adapter.capabilities.embeddingRequiredOnInsert) return error.message;
    caseFailure = { error };
    throw error;
  } finally {
    try {
      await bounded(() => opened.close(), "Adapter close", roundedTimeout);
    } catch (closeError) {
      if (retryFailure) throw retryFailure.error;
      if (caseFailure) {
        throw new AggregateError([caseFailure.error, closeError], "Conformance case and adapter close both failed",
          { cause: closeError });
      }
      throw closeError;
    }
  }
}
