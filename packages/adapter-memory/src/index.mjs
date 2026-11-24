import { CoreError, assertAdapterCapabilities, capabilities, toCoreError } from "@cairn-ink/core";
import { createCapturePorts } from "./capture.mjs";
import { withContextRawRead } from "./context-raw-read.mjs";
import { createContextReadStore } from "./context-read.mjs";
import { createDocumentCardStore } from "./document-cards.mjs";
import { createFactMatcher } from "./fact-match.mjs";
import { createInspectStore } from "./inspect.mjs";
import { createRelationStores } from "./memory-relations.mjs";
import { createMemoryStore } from "./memory-store.mjs";
import { createFactStore, createFingerprintProvider, createPauseStore } from "./privacy.mjs";
import { createRationaleStore } from "./rationale.mjs";
import { createRationaleHarness } from "./rationale-harness.mjs";
import { createRawPorts } from "./raw.mjs";
import { createReceiptReadSafety } from "./receipt-read-safety.mjs";
import { createCardVisibility, createRetrievalPorts } from "./retrieval.mjs";
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
  if ((flags.contextRead && flags.cards) || (flags.contextRawRead && (!flags.contextRead || !flags.rawArchive))) {
    throw new CoreError("capability_unavailable");
  }
  const sessionRefs = options.sessionRefs ?? "plain";
  if (sessionRefs !== "plain" && sessionRefs !== "hashed") throw new CoreError("invalid_input");
  const newId = options.newId ?? (() => crypto.randomUUID());
  const clock = options.now ?? Date.now;
  let clockOffset = 0;
  const now = () => clock() + clockOffset;
  const work = createUnitOfWork(nativeErrorMap, now, flags.placement);
  const { uow, port, dump, runSeed, setWriteTime, rowsMissingKeyedDigest } = work;
  const matchFacts = createFactMatcher(flags.vectorSuppression, options.hashSessionKey, sessionRefs);
  const { keys, ringKeys, labels, setFingerprintSecret, setRetainedDigestFixture } =
    createFingerprintProvider(flags.fingerprintKey, options.fingerprint, work);
  const archive = flags.rawArchive ?
    createRawPorts(work, keys, ringKeys, labels, options.hashSessionKey, flags.rationaleEdges) : undefined;
  const receiptReadSafety = createReceiptReadSafety(ringKeys, archive?.receiptSourcesVisible);
  const contextRead = flags.contextRead ? createContextReadStore(work, matchFacts, ringKeys, archive?.receiptSourcesVisible) : undefined;
  const store = createMemoryStore(port, flags, newId, matchFacts, ringKeys);
  const { supersession, conflicts } = createRelationStores(port, matchFacts);
  const { suppressions, seedFact } = createFactStore(port, runSeed, { sessionRefs, newId, now }, matchFacts,
    flags.fingerprintKey ? ringKeys : undefined);
  const cardVisible = createCardVisibility(matchFacts, keys, archive?.sourceVisible);
  const rationale = flags.rationaleEdges ? createRationaleStore(port, matchFacts, ringKeys, archive?.findVisibleSource) : undefined;
  const placement = flags.placement ? handleWriteRejections(
    createTopicStore(port, flags, newId, now, matchFacts, options, cardVisible),
    ["applyPlacement", "markFailed", "dropMemory", "applyCardPlacement", "markCardsFailed", "dropCard"]) : undefined;
  const inspect = flags.inspect ? createInspectStore({ placement,
    supersession: flags.supersession ? supersession : undefined,
    conflicts: flags.conflictEdges ? conflicts : undefined }, work, matchFacts, receiptReadSafety) : undefined;
  /** @type {import("./index.d.mts").MemoryAdapter} */
  const adapter = {
    name: "memory",
    capabilities: flags,
    uow,
    memories: handleWriteRejections(store.memories, ["insert", "touchDuplicate", "replaceContent", "erase"]),
    capture: handleWriteRejections(createCapturePorts(port, store, now, matchFacts, flags.embeddingRequiredOnInsert, archive, flags.contextRead),
      ["admit", "claim", "beginDispatch", "abandon", "finish", "assertEligible"]),
    suppressions: handleWriteRejections(suppressions, ["writeFact"]),
    pause: handleWriteRejections(createPauseStore(port), ["set"]),
    keys,
    ...createRetrievalPorts(port, flags, matchFacts, archive?.visibleRawRefs, cardVisible),
    ...(contextRead && { contextRead: flags.contextRawRead && archive ? withContextRawRead(work, archive, contextRead) : contextRead }),
    ...(archive && { raw: handleWriteRejections(archive.raw,
      ["recordLineage", "archive", "importArchive", "fenceSession", "purgeWithheld", "eraseSessions", "deleteConversation"]) }),
    ...(flags.supersession && { supersession: handleWriteRejections(supersession, ["record", "markHistorical"]) }),
    ...(flags.conflictEdges && { conflicts: handleWriteRejections(conflicts, ["insert", "invalidate"]) }),
    ...(rationale && { ...rationale, rationale: handleWriteRejections(rationale.rationale, ["insert", "invalidate"]) }),
    ...(placement && { placement }),
    ...(inspect && { inspect: inspect.inspect }),
    ...(flags.documentCards && { documentCards: handleWriteRejections(
      createDocumentCardStore(port, now), ["put", "linkMemories", "amend", "hideAmendment", "hide", "hideWhere", "markStale"]) }),
    nativeErrorMap,
    harness: {
      async dump() { return dump(flags.rawArchive, flags.documentCards, flags.rationaleEdges); },
      ...(archive && { seedClientlessRaw: archive.seedClientlessRaw }),
      async seedFact(owner, fact) {
        try {
          await seedFact(owner, fact);
        } catch (error) {
          throw toCoreError(error, nativeErrorMap);
        }
      },
      ...(rationale && createRationaleHarness(port, runSeed)),
      ...(inspect && { seedInspectEvidence: inspect.seedInspectEvidence }),
      setWriteTime,
      setFingerprintSecret,
      setRetainedDigestFixture,
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
