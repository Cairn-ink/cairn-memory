import { assertAdapterCapabilities, capabilities, toCoreError } from "@cairn-ink/core";
import { createMemoryStore } from "./memory-store.mjs";
import { createRetrievalPorts } from "./retrieval.mjs";
import { createUnitOfWork } from "./unit-of-work.mjs";

const nativeErrorMap = Object.freeze({});

/**
 * @param {import("./index.d.mts").MemoryAdapterOptions} [options]
 * @returns {import("./index.d.mts").MemoryAdapter}
 */
export function createMemoryAdapter(options = {}) {
  const flags = capabilities(options.capabilities ?? {});
  const { uow, port, dump, appendFact, setWriteTime } = createUnitOfWork(nativeErrorMap);
  const { memories, counters } = createMemoryStore(port, flags, options.newId ?? (() => crypto.randomUUID()));
  /** @type {import("./index.d.mts").MemoryAdapter} */
  const adapter = {
    name: "memory",
    capabilities: flags,
    uow,
    memories,
    ...createRetrievalPorts(port, flags),
    nativeErrorMap,
    harness: {
      async dump() { return dump(); },
      async seedFact(owner, fact) {
        try {
          appendFact(owner, fact);
        } catch (error) {
          throw toCoreError(error, nativeErrorMap);
        }
      },
      setWriteTime,
      async counters() { return counters(); },
    },
  };
  assertAdapterCapabilities(adapter);
  return adapter;
}
