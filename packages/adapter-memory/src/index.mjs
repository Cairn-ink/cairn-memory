import { createMemoryHostWriteHooks } from "./host-write-hooks.mjs";
import { CoreError, assertAdapterCapabilities, capabilities, receiptExcerpt, toCoreError } from "@cairn-ink/core";
import { createCapturePorts } from "./capture.mjs";
import { createCardRawSourceChecks, withContextRawRead } from "./context-raw-read.mjs";
import { createContextReadStore } from "./context-read.mjs";
import { createDocumentCardStore, createForgottenReceiptCheck } from "./document-cards.mjs";
import { createFactMatcher } from "./fact-match.mjs";
import { createInspectStore } from "./inspect.mjs";
import { createRelationStores } from "./memory-relations.mjs";
import { createMemoryStore } from "./memory-store.mjs";
import { createFactStore, createFingerprintProvider, createPauseStore } from "./privacy.mjs";
import { createProceduralTagStore } from "./procedural-tags.mjs";
import { createRationaleStore } from "./rationale.mjs";
import { createRationaleHarness } from "./rationale-harness.mjs";
import { createRawPorts } from "./raw.mjs";
import { createReceiptReadSafety } from "./receipt-read-safety.mjs";
import { createCardVisibility, createCardVisibilityInputs,
  createDocumentCardCandidates, createRetrievalPorts } from "./retrieval.mjs";
import { createTopicStore } from "./topics.mjs";
import { createUnitOfWork, handleWriteRejections } from "./unit-of-work.mjs";
import { copyCaptureMessages, copyReceipts, validateTime, writeNamespace } from "./validation.mjs";

export { TEST_FINGERPRINT_LABELS, TEST_FINGERPRINT_SECRET } from "./privacy.mjs";

const nativeErrorMap = Object.freeze({});

/**
 * @param {import("./index.d.mts").MemoryAdapterOptions} [options]
 * @returns {import("./index.d.mts").MemoryAdapter}
 */
export function createMemoryAdapter(options = {}) {
  const flags = capabilities({ ...options.capabilities,
    ...(options.hostWriteHooks !== undefined && { hostWriteHooks: options.hostWriteHooks }),
    ...(options.receiptAttachAdvancesRevision === true && { receiptAttachAdvancesRevision: true }),
    ...(options.proceduralTags === true && { proceduralTags: true }),
    ...(options.documentCardSearch !== undefined && { documentCardSearch: options.documentCardSearch }),
  });
  if ((flags.contextRead && flags.cards) || (flags.contextRawRead && (!flags.contextRead || !flags.rawArchive)) ||
      (flags.documentCardSearch && !flags.documentCards)) {
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
    createRawPorts(work, keys, ringKeys, labels, options.hashSessionKey, flags.rationaleEdges, flags.documentCards) : undefined;
  const hooks = flags.hostWriteHooks ? createMemoryHostWriteHooks(work, archive) : undefined;
  const { receiptReadSafety, receiptWithheld } = createReceiptReadSafety(ringKeys, archive?.receiptSourcesVisible);
  const store = createMemoryStore(port, flags, newId, matchFacts, ringKeys);
  const { supersession, conflicts } = createRelationStores(port, matchFacts);
  const { suppressions, seedFact } = createFactStore(port, runSeed, { sessionRefs, newId, now }, matchFacts,
    flags.fingerprintKey ? ringKeys : undefined);
  const cardRawSources = archive && createCardRawSourceChecks(archive, matchFacts, receiptReadSafety);
  const forgottenReceiptCheck = createForgottenReceiptCheck(matchFacts, ringKeys);
  const { cardVisibilityInput, amendmentWithheld } = createCardVisibilityInputs(matchFacts, keys, cardRawSources?.sourceVisible,
    archive?.sourceWithholding, forgottenReceiptCheck);
  const cardVisible = createCardVisibility(cardVisibilityInput);
  const documentCards = flags.documentCards ? handleWriteRejections(
    createDocumentCardStore(port, now, cardVisibilityInput, amendmentWithheld, flags.documentCardSearch, forgottenReceiptCheck),
    ["put", "linkMemories", "amend", "hideAmendment", "hide", "hideWhere", "purgeById", "markStale"]) : undefined;
  const contextRead = flags.contextRead ? createContextReadStore(work, matchFacts, ringKeys, archive, documentCards) : undefined;
  const rationale = flags.rationaleEdges ? createRationaleStore(port, matchFacts, ringKeys, archive?.findVisibleSource) : undefined;
  const placement = flags.placement ? handleWriteRejections(
    createTopicStore(port, flags, newId, now, matchFacts, options, cardVisible),
    ["applyPlacement", "markFailed", "dropMemory", "applyCardPlacement", "markCardsFailed", "dropCard"]) : undefined;
  const proceduralTags = flags.proceduralTags === true ? handleWriteRejections(
    createProceduralTagStore(port, matchFacts, receiptReadSafety), ["write", "clear"]) : undefined;
  const inspect = flags.inspect ? createInspectStore({ placement,
    supersession: flags.supersession ? supersession : undefined,
    conflicts: flags.conflictEdges ? conflicts : undefined, proceduralTags }, work, matchFacts, receiptReadSafety) : undefined;
  /** @type {import("./index.d.mts").MemoryAdapter} */
  const adapter = {
    name: "memory",
    capabilities: flags,
    ...(hooks && { hostWriteHookPort: hooks.port }),
    uow,
    memories: handleWriteRejections(store.memories, ["insert", "touchDuplicate", "replaceContent", "erase"]),
    capture: handleWriteRejections(createCapturePorts(port, store, now, matchFacts, flags.embeddingRequiredOnInsert, archive, flags),
      ["admit", "claim", "beginDispatch", "abandon", "finish", "assertEligible"]),
    suppressions: handleWriteRejections({ ...suppressions,
      async receiptWithheld(tx, scope, receipt, admitted) {
        return port.read(tx, scope, getState => {
          const target = { owner: tx.owner, namespace: writeNamespace(scope) };
          const [copy] = copyReceipts([receipt]);
          if (copy.excerpt === undefined) throw new CoreError("invalid_input");
          const source = admitted === undefined ? undefined : copyCaptureMessages([admitted])[0];
          if (source && (!source.content || source.id !== copy.messageId || source.role !== copy.role ||
              source.occurredAtMs !== copy.occurredAtMs || receiptExcerpt(source.content) !== copy.excerpt)) return true;
          const state = getState();
          return receiptWithheld(state, target, { ...copy, excerpt: copy.excerpt }, matchFacts(state.facts, target),
            undefined, source?.content);
        });
      },
    }, ["writeFact"]),
    pause: handleWriteRejections(createPauseStore(port), ["set"]),
    keys,
    ...createRetrievalPorts(port, flags, matchFacts, archive?.visibleRawRefs, cardVisible),
    ...(contextRead && { contextRead: archive && (flags.contextRawRead || flags.documentCards)
      ? withContextRawRead(work, archive, contextRead, matchFacts, receiptReadSafety, {
        raw: flags.contextRawRead, amendmentLineage: flags.documentCards ? cardRawSources?.lineageVisible : undefined,
      })
      : contextRead }),
    ...(archive && { raw: handleWriteRejections(archive.raw,
      ["recordLineage", "archive", "importArchive", "fenceSession", "purgeWithheld", "eraseSessions", "deleteConversation"]) }),
    ...(flags.supersession && { supersession: handleWriteRejections(supersession, ["record", "markHistorical"]) }),
    ...(flags.conflictEdges && { conflicts: handleWriteRejections(conflicts, ["insert", "invalidate"]) }),
    ...(proceduralTags && { proceduralTags }),
    ...(rationale && { ...rationale, rationale: handleWriteRejections(rationale.rationale, ["insert", "invalidate"]) }),
    ...(placement && { placement }),
    ...(inspect && { inspect: inspect.inspect }),
    ...(documentCards && { documentCards }),
    ...(flags.documentCardSearch && { documentCardCandidates: createDocumentCardCandidates(port, cardVisible) }),
    nativeErrorMap,
    harness: {
      ...(hooks && { createHostHookTable: hooks.createTable }),
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
