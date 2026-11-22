import { memoryCases } from "./memory-cases.mjs";
import { unitOfWorkCases } from "./unit-of-work-cases.mjs";

/** @type {readonly import("./index.d.mts").ConformanceCase[]} */
export const CASES = [...unitOfWorkCases, ...memoryCases];

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

  const needsOff = testCase.needsOff ?? [];
  /** @type {Partial<import("@cairn-ink/core").Capabilities>} */
  const capabilities = {
    ...testCase.requests,
    ...Object.fromEntries(testCase.needs.map((flag) => [flag, true])),
    ...Object.fromEntries(needsOff.map((flag) => [flag, false])),
  };
  const opened = await factory.open({ capabilities });
  const { adapter, embeddingDimensions, harness, nativeErrorMap, busyNativeCodes } = opened;
  try {
    const missing = testCase.needs.find((flag) => !adapter.capabilities[flag]);
    if (missing) return `needs ${missing}`;
    const enabled = needsOff.find((flag) => adapter.capabilities[flag]);
    if (enabled) return `needs ${enabled} off`;

    const owner = crypto.randomUUID();
    await testCase.run({
      adapter,
      harness,
      nativeErrorMap,
      busyNativeCodes,
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
    return null;
  } finally {
    await opened.close();
  }
}
