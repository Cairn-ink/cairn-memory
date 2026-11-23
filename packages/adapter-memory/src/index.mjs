import { CoreError, assertAdapterCapabilities, capabilities, toCoreError } from "@cairn-ink/core";
import { createCapturePorts } from "./capture.mjs";
import { createFactMatcher } from "./fact-match.mjs";
import { createMemoryStore } from "./memory-store.mjs";
import { createFactStore, createFingerprintProvider, createPauseStore } from "./privacy.mjs";
import { createRetrievalPorts } from "./retrieval.mjs";
import { createUnitOfWork } from "./unit-of-work.mjs";
import { validateTime } from "./validation.mjs";

export { TEST_FINGERPRINT_LABELS, TEST_FINGERPRINT_SECRET } from "./privacy.mjs";

const nativeErrorMap = Object.freeze({});

/**
 * @param {import("./index.d.mts").MemoryAdapterOptions} [options]
 * @returns {import("./index.d.mts").MemoryAdapter}
 */
export function createMemoryAdapter(options = {}) {
  const flags = capabilities(options.capabilities ?? {});
  const sessionRefs = options.sessionRefs ?? "plain";
  if (sessionRefs !== "plain" && sessionRefs !== "hashed") throw new CoreError("invalid_input");
  const newId = options.newId ?? (() => crypto.randomUUID());
  const clock = options.now ?? Date.now;
  let clockOffset = 0;
  const now = () => clock() + clockOffset;
  const { uow, port, dump, runSeed, setWriteTime } = createUnitOfWork(nativeErrorMap, now);
  const matchFacts = createFactMatcher(flags.vectorSuppression, options.hashSessionKey);
  const store = createMemoryStore(port, flags, newId, matchFacts);
  const { suppressions, seedFact } = createFactStore(port, runSeed, { sessionRefs, newId, now }, matchFacts);
  const { keys, setFingerprintSecret } = createFingerprintProvider(flags.fingerprintKey, options.fingerprint);
  /** @type {import("./index.d.mts").MemoryAdapter} */
  const adapter = {
    name: "memory",
    capabilities: flags,
    uow,
    memories: store.memories,
    capture: createCapturePorts(port, store, now),
    suppressions,
    pause: createPauseStore(port),
    keys,
    ...createRetrievalPorts(port, flags, matchFacts),
    nativeErrorMap,
    harness: {
      async dump() { return dump(); },
      async seedFact(owner, fact) {
        try {
          await seedFact(owner, fact);
        } catch (error) {
          throw toCoreError(error, nativeErrorMap);
        }
      },
      setWriteTime,
      setFingerprintSecret,
      async advanceClock(ms) {
        validateTime(ms);
        validateTime(clock() + clockOffset + ms);
        clockOffset += ms;
      },
      async counters() { return store.counters(); },
    },
  };
  assertAdapterCapabilities(adapter);
  return adapter;
}
