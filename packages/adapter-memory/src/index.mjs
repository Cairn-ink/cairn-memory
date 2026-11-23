import { CoreError, assertAdapterCapabilities, capabilities, toCoreError } from "@cairn-ink/core";
import { createCapturePorts } from "./capture.mjs";
import { createFactMatcher } from "./fact-match.mjs";
import { createRelationStores } from "./memory-relations.mjs";
import { createMemoryStore } from "./memory-store.mjs";
import { createFactStore, createFingerprintProvider, createPauseStore } from "./privacy.mjs";
import { createRationaleStore } from "./rationale.mjs";
import { createRationaleHarness } from "./rationale-harness.mjs";
import { createRawPorts } from "./raw.mjs";
import { createRetrievalPorts } from "./retrieval.mjs";
import { createTopicStore } from "./topics.mjs";
import { createUnitOfWork, handleWriteRejections } from "./unit-of-work.mjs";
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
  const work = createUnitOfWork(nativeErrorMap, now, flags.placement);
  const { uow, port, dump, runSeed, setWriteTime, rotateRowDigests, rowsMissingKeyedDigest } = work;
  const matchFacts = createFactMatcher(flags.vectorSuppression, options.hashSessionKey);
  const { keys, ringKeys, labels, setFingerprintSecret } =
    createFingerprintProvider(flags.fingerprintKey, options.fingerprint, rotateRowDigests);
  const archive = flags.rawArchive ?
    createRawPorts(work, keys, ringKeys, labels, options.hashSessionKey, flags.rationaleEdges) : undefined;
  const store = createMemoryStore(port, flags, newId, matchFacts, ringKeys);
  const { supersession, conflicts } = createRelationStores(port, matchFacts);
  const { suppressions, seedFact } = createFactStore(port, runSeed, { sessionRefs, newId, now }, matchFacts,
    flags.fingerprintKey ? ringKeys : undefined);
  const rationale = flags.rationaleEdges ? createRationaleStore(port, matchFacts, ringKeys, archive?.findVisibleSource) : undefined;
  /** @type {import("./index.d.mts").MemoryAdapter} */
  const adapter = {
    name: "memory",
    capabilities: flags,
    uow,
    memories: handleWriteRejections(store.memories, ["insert", "touchDuplicate", "replaceContent", "erase"]),
    capture: handleWriteRejections(createCapturePorts(port, store, now, matchFacts, flags.embeddingRequiredOnInsert, archive),
      ["admit", "claim", "beginDispatch", "abandon", "finish", "assertEligible"]),
    suppressions: handleWriteRejections(suppressions, ["writeFact"]),
    pause: handleWriteRejections(createPauseStore(port), ["set"]),
    keys,
    ...createRetrievalPorts(port, flags, matchFacts, archive?.visibleRawRefs),
    ...(archive && { raw: handleWriteRejections(archive.raw,
      ["recordLineage", "archive", "importArchive", "fenceSession", "purgeWithheld", "eraseSessions", "deleteConversation"]) }),
    ...(flags.supersession && { supersession: handleWriteRejections(supersession, ["record", "markHistorical"]) }),
    ...(flags.conflictEdges && { conflicts: handleWriteRejections(conflicts, ["insert", "invalidate"]) }),
    ...(rationale && { ...rationale, rationale: handleWriteRejections(rationale.rationale, ["insert", "invalidate"]) }),
    ...(flags.placement && { placement: handleWriteRejections(
      createTopicStore(port, flags, newId, now, matchFacts, options), ["applyPlacement", "markFailed", "dropMemory"]) }),
    nativeErrorMap,
    harness: {
      async dump() { return dump(flags.rawArchive); },
      ...(archive && { seedClientlessRaw: archive.seedClientlessRaw }),
      async seedFact(owner, fact) {
        try {
          await seedFact(owner, fact);
        } catch (error) {
          throw toCoreError(error, nativeErrorMap);
        }
      },
      ...(rationale && createRationaleHarness(port, runSeed)),
      setWriteTime,
      setFingerprintSecret,
      rowsMissingKeyedDigest(owner) { return rowsMissingKeyedDigest(owner, ringKeys); },
      async advanceClock(ms) {
        validateTime(ms);
        validateTime(clock() + clockOffset + ms);
        clockOffset += ms;
      },
      async counters() { return { ...store.counters(), ...archive?.counters() }; },
    },
  };
  assertAdapterCapabilities(adapter);
  return adapter;
}
