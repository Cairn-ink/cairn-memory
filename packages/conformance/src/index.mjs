import { memoryCases } from "./memory-cases.mjs";
import { retrievalCases } from "./retrieval-cases.mjs";
import { bounded, check, DEFAULT_TIMEOUT_MS } from "./support.mjs";
import { unitOfWorkCases } from "./unit-of-work-cases.mjs";

export { privacyCases as PRIVACY_CASES } from "./privacy-cases.mjs";
export { captureCases as CAPTURE_CASES } from "./capture-cases.mjs";
export { PRIVACY_MATCH_CASES } from "./privacy-match-cases.mjs";

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
  const opened = await factory.open({ capabilities });
  const { adapter, embeddingDimensions, harness, nativeErrorMap, busyNativeCodes, sessionRefs, settleMs,
    timeoutMs = DEFAULT_TIMEOUT_MS } = opened;
  const validTimeout = Number.isFinite(timeoutMs) && timeoutMs > 0;
  /** @type {{ error: unknown } | undefined} */
  let caseFailure;
  try {
    check(validTimeout, "timeoutMs must be a finite number greater than 0");
    check(settleMs === undefined || (Number.isFinite(settleMs) && settleMs > 0),
      "settleMs must be a finite number greater than 0");
    const missing = testCase.needs.find((flag) => !adapter.capabilities[flag]);
    if (missing) return `needs ${missing}`;
    const enabled = needsOff.find((flag) => adapter.capabilities[flag]);
    if (enabled) return `needs ${enabled} off`;

    const owner = crypto.randomUUID();
    const skipReason = await testCase.run({
      adapter,
      harness,
      nativeErrorMap,
      busyNativeCodes,
      sessionRefs,
      settleMs,
      timeoutMs,
      owner,
      otherOwner: crypto.randomUUID(),
      scope: (namespace) => ({ owner, namespace }),
      hash,
      vec(distance) {
        const dimensions = embeddingDimensions ?? 4;
        if (!Number.isSafeInteger(dimensions) || dimensions < 2) throw new Error("At least two embedding dimensions are needed");
        const cosine = 1 - distance;
        const vector = Array(dimensions).fill(0);
        vector[0] = cosine;
        vector[1] = Math.sqrt(1 - cosine * cosine);
        return vector;
      },
    });
    return skipReason ?? null;
  } catch (error) {
    caseFailure = { error };
    throw error;
  } finally {
    try {
      await bounded(() => opened.close(), "Adapter close", validTimeout ? timeoutMs : DEFAULT_TIMEOUT_MS);
    } catch (closeError) {
      if (caseFailure) {
        throw new AggregateError([caseFailure.error, closeError], "Conformance case and adapter close both failed",
          { cause: closeError });
      }
      throw closeError;
    }
  }
}
