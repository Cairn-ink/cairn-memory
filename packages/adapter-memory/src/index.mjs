import { CoreError, assertAdapterCapabilities, capabilities, toCoreError } from "@cairn-ink/core";
import { createMemoryStore } from "./memory-store.mjs";
import { createFactStore, createFingerprintProvider, createPauseStore } from "./privacy.mjs";
import { createRetrievalPorts } from "./retrieval.mjs";
import { createTopicStore } from "./topics.mjs";
import { createUnitOfWork } from "./unit-of-work.mjs";

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
  const now = options.now ?? Date.now;
  const newId = options.newId ?? (() => crypto.randomUUID());
  const { uow, port, dump, runSeed, setWriteTime } = createUnitOfWork(nativeErrorMap, flags.placement);
  const { memories, counters } = createMemoryStore(port, flags, newId);
  const { suppressions, seedFact } = createFactStore(port, runSeed, { sessionRefs, newId, now });
  const { keys, setFingerprintSecret } = createFingerprintProvider(flags.fingerprintKey, options.fingerprint);
  /** @type {import("./index.d.mts").MemoryAdapter} */
  const adapter = {
    name: "memory",
    capabilities: flags,
    uow,
    memories,
    suppressions,
    pause: createPauseStore(port),
    keys,
    ...createRetrievalPorts(port, flags),
    ...(flags.placement && { placement: createTopicStore(port, flags, newId, now) }),
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
      async counters() { return counters(); },
    },
  };
  assertAdapterCapabilities(adapter);
  return adapter;
}
