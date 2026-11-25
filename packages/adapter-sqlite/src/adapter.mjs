import { assertAdapterCapabilities, capabilities, CoreError } from "@cairn-ink/core";
import { createCapturePorts } from "./capture.mjs";
import { createContextLexical } from "./context-lexical.mjs";
import { createContextRawRead, reconcileRawInventory } from "./context-raw-read.mjs";
import { createContextReadStore } from "./context-read.mjs";
import { contextDeadline, contextEpochs } from "./context-read-state.mjs";
import { handleWriteRejections } from "./errors.mjs";
import { createIndexRevisions } from "./index-revisions.mjs";
import { anchorsVisible, createInspectStore, receiptProjector } from "./inspect.mjs";
import { createRelationStores } from "./memory-relations.mjs";
import { createMemoryStore } from "./memories.mjs";
import { migratedCaptureControls } from "./migrate/capture-controls.mjs";
import { createMigratedRawPolicy } from "./migrate/raw-privacy.mjs";
import { createPlacementVisibility, createTitleScrubber } from "./placement-visibility.mjs";
import { createPauseStore } from "./pause.mjs";
import { createProceduralTagStore } from "./procedural-tags.mjs";
import { createRawStore } from "./raw.mjs";
import { createRawLineage, createSpanLineage } from "./raw-lineage.mjs";
import { createRawReads } from "./raw-read.mjs";
import { createReceiptReadSafety } from "./receipt-read-safety.mjs";
import { createRetrievalPorts } from "./retrieval.mjs";
import { openStorage } from "./schema/open.mjs";
import { createSuppressionStore, sessionHasher } from "./suppressions.mjs";
import { createTopicStore } from "./topics.mjs";

/** @import { CallOptions, ContextReadSet } from "@cairn-ink/core/ports" */
/** @typedef {{ now?: () => number, monotonicMs?: () => number,
 * capabilities?: { contextRead?: boolean, contextRawRead?: boolean, placement?: boolean,
 * supersession?: boolean, conflictEdges?: boolean } } & import("./topics.mjs").TopicOptions & import("./migrate/capture-controls.mjs").CaptureOptions} Options */

/** Opens the storage ports for a single installation database.
 * @param {string} filename @param {Options} [options]
 */
export async function openSqliteAdapter(filename, options) {
  const storage = await openStorage(filename);
  try {
    return createSqliteAdapter(storage, options);
  } catch (error) {
    await storage.close();
    throw error;
  }
}

/** @param {Awaited<ReturnType<typeof openStorage>>} storage @param {Options} [options] */
export function createSqliteAdapter({ uow, port, close, sessionHashKey, legacyRawHashing, controls, preserveArrivalRefusal },
  { now, localAuthority, monotonicMs = () => performance.now(), capabilities: requested, ...topicOptions } = {}) {
  const flags = capabilities({ rawArchive: true, rawSpans: true, rawWindowHide: true, spanLineage: true, inspect: true,
    contextRead: requested?.contextRead ?? false, contextRawRead: requested?.contextRawRead ?? false,
    placement: requested?.placement ?? false, supersession: requested?.supersession ?? false,
    conflictEdges: requested?.conflictEdges ?? false,
    embeddingRequiredOnInsert: false, receiptAttachAdvancesRevision: true, proceduralTags: true });
  if (flags.contextRawRead && !flags.contextRead) throw new CoreError("capability_unavailable");
  const hashSessionKey = sessionHasher(sessionHashKey, legacyRawHashing);
  const migratedRaw = legacyRawHashing ?
    createMigratedRawPolicy(sessionHashKey, hashSessionKey, controls?.evidence.localRawPrivacy === true) : undefined;
  const captureControls = controls || localAuthority ? migratedCaptureControls(controls, localAuthority) : undefined;
  const index = createIndexRevisions(uow, port);
  const lineage = createRawLineage(sessionHashKey, hashSessionKey, migratedRaw);
  const receiptReadSafety = createReceiptReadSafety(hashSessionKey, lineage, migratedRaw);
  const visibility = createPlacementVisibility(hashSessionKey, receiptReadSafety, migratedRaw);
  const scrubTitles = createTitleScrubber(visibility);
  const placement = flags.placement ? handleWriteRejections(createTopicStore(port, index, visibility, now ?? Date.now, topicOptions),
    ["applyPlacement", "markFailed", "dropMemory", "applyCardPlacement", "markCardsFailed", "dropCard"]) : undefined;
  const relations = createRelationStores(port, index, visibility);
  const supersession = flags.supersession ? handleWriteRejections(relations.supersession, ["record", "markHistorical"]) : undefined;
  const conflicts = flags.conflictEdges ? handleWriteRejections(relations.conflicts, ["insert", "invalidate"]) : undefined;
  const { raw, counters } = createRawStore(port, hashSessionKey, lineage, index, migratedRaw, captureControls, scrubTitles);
  const { reads, visibleRawRefs } = createRawReads(port, hashSessionKey, sessionHashKey, migratedRaw, captureControls);
  const inspect = createInspectStore(port, hashSessionKey, receiptReadSafety, visibility, flags);
  const proceduralTags = createProceduralTagStore(port, hashSessionKey, (db, scope, policy, id, anchors) =>
    anchorsVisible(db, scope, id, receiptProjector(db, scope, policy, receiptReadSafety), anchors), index.markDirty);
  const rawContext = flags.contextRawRead
    ? createContextRawRead(port, hashSessionKey, sessionHashKey, lineage, receiptReadSafety, monotonicMs, migratedRaw, captureControls) : undefined;
  const contextRead = flags.contextRead ? createContextReadStore(uow, port, hashSessionKey, receiptReadSafety, inspect.identity,
    createContextLexical(port, hashSessionKey, sessionHashKey, monotonicMs), monotonicMs, rawContext) : undefined;
  const adapter = {
    name: "sqlite",
    capabilities: flags,
    uow: { run: index.run },
    capture: createCapturePorts(port, hashSessionKey, index, lineage, now, migratedRaw, captureControls, preserveArrivalRefusal),
    memories: createMemoryStore(port, hashSessionKey, index, scrubTitles),
    ...(placement && { placement }),
    ...(supersession && { supersession }),
    ...(conflicts && { conflicts }),
    proceduralTags,
    inspect,
    ...(contextRead && { contextRead }),
    ...(rawContext && {
      /** Advance the full-inventory checkpoint by one bounded upkeep pass.
       * @param {ContextReadSet} readSet @param {CallOptions} [options]
       */
      maintainContextRaw(readSet, options = {}) {
        return uow.run(readSet.owner, {}, tx => port(tx, readSet.owner, { write: true }, db =>
          reconcileRawInventory(db, readSet, contextEpochs(db, readSet), contextDeadline(options, monotonicMs), true)));
      },
    }),
    ...createRetrievalPorts(port, hashSessionKey, sessionHashKey, visibleRawRefs),
    raw: { ...raw, ...reads },
    spanLineage: createSpanLineage(port, hashSessionKey),
    counters,
    suppressions: createSuppressionStore(port, hashSessionKey, index.markDirty, migratedRaw, captureControls, scrubTitles),
    pause: createPauseStore(port),
    keys: { async userKey(/** @type {string} */ _owner) { return null; } },
    hashSessionKey,
    close,
  };
  assertAdapterCapabilities(adapter);
  return adapter;
}
