import { toCoreError } from "@cairn-ink/core";
import { memoryCases } from "./memory-cases.mjs";
import { retrievalCases } from "./retrieval-cases.mjs";
import { bounded, check, DEFAULT_TIMEOUT_MS, isFixtureEmbeddingExhaustion, referenceVector } from "./support.mjs";
import { unitOfWorkCases } from "./unit-of-work-cases.mjs";

export { privacyCases as PRIVACY_CASES } from "./privacy-cases.mjs";
export { captureCases as CAPTURE_CASES } from "./capture-cases.mjs";
export { CAPTURE_CONTAINMENT_CASES } from "./capture-containment-cases.mjs";
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
export { RAW_LEDGER_CASES } from "./raw-ledger-cases.mjs";
export { IMPORT_ARCHIVE_CASES } from "./import-archive-cases.mjs";
export { PROVEN_FORK_CASES } from "./proven-fork-cases.mjs";
export { relationCases as RELATION_CASES } from "./relation-cases.mjs";
export { TOPIC_CARD_CASES } from "./topics-cards-cases.mjs";
export { DOCUMENT_CARD_AMENDMENT_CASES } from "./document-card-amendment-cases.mjs";
export { DOCUMENT_CARD_LINK_CASES } from "./document-card-link-cases.mjs";
export { TOPICS_FOR_CARDS_CASES } from "./topics-for-cards-cases.mjs";
export { DELIVERY_VISIBILITY_CASES } from "./delivery-visibility-cases.mjs";

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
  try {
    opened = await factory.open({ capabilities });
  } catch (error) {
    const { rawArchive, ...withoutRawArchive } = capabilities;
    if (rawArchive !== true || testCase.needs.includes("rawArchive") ||
        toCoreError(error).code !== "capability_unavailable") throw error;
    // A factory can reject an optional raw archive request during setup. Retry with its default raw setting.
    opened = await factory.open({ capabilities: withoutRawArchive });
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
      if (caseFailure) {
        throw new AggregateError([caseFailure.error, closeError], "Conformance case and adapter close both failed",
          { cause: closeError });
      }
      throw closeError;
    }
  }
}
