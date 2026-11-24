import { assertAdapterCapabilities, capabilities } from "@cairn-ink/core";
import { createCapturePorts } from "./capture.mjs";
import { createIndexRevisions } from "./index-revisions.mjs";
import { createMemoryStore } from "./memories.mjs";
import { migratedCaptureControls } from "./migrate/capture-controls.mjs";
import { createMigratedRawPolicy } from "./migrate/raw-privacy.mjs";
import { createPauseStore } from "./pause.mjs";
import { createRawStore } from "./raw.mjs";
import { createRawLineage, createSpanLineage } from "./raw-lineage.mjs";
import { createRawReads } from "./raw-read.mjs";
import { createRetrievalPorts } from "./retrieval.mjs";
import { openStorage } from "./schema/open.mjs";
import { createSuppressionStore, sessionHasher } from "./suppressions.mjs";

/** Opens the storage ports for a single installation database.
 * @param {string} filename
 * @param {import("./migrate/capture-controls.mjs").CaptureOptions} [options]
 */
export async function openSqliteAdapter(filename, options) {
  const storage = await openStorage(filename);
  try { return createSqliteAdapter(storage, options); }
  catch (error) {
    await storage.close();
    throw error;
  }
}

/** @param {Awaited<ReturnType<typeof openStorage>>} storage
 * @param {import("./migrate/capture-controls.mjs").CaptureOptions & { now?: () => number }} [options]
 */
export function createSqliteAdapter({ uow, port, close, sessionHashKey, legacyRawHashing, controls, preserveArrivalRefusal },
  { now, localAuthority } = {}) {
  const hashSessionKey = sessionHasher(sessionHashKey, legacyRawHashing);
  const migratedRaw = legacyRawHashing ?
    createMigratedRawPolicy(sessionHashKey, hashSessionKey, controls?.evidence.localRawPrivacy === true) : undefined;
  const captureControls = controls || localAuthority ? migratedCaptureControls(controls, localAuthority) : undefined;
  const index = createIndexRevisions(uow, port);
  const lineage = createRawLineage(sessionHashKey, hashSessionKey);
  const { raw, counters } = createRawStore(port, hashSessionKey, lineage, index, migratedRaw, captureControls);
  const { reads, visibleRawRefs } = createRawReads(port, hashSessionKey, sessionHashKey, migratedRaw, captureControls);
  const adapter = {
    name: "sqlite",
    capabilities: capabilities({ rawArchive: true, rawSpans: true, rawWindowHide: true, spanLineage: true }),
    uow: { run: index.run },
    capture: createCapturePorts(port, hashSessionKey, index, lineage, now, migratedRaw, captureControls, preserveArrivalRefusal),
    memories: createMemoryStore(port, hashSessionKey, index.markDirty),
    ...createRetrievalPorts(port, hashSessionKey, sessionHashKey, visibleRawRefs),
    raw: { ...raw, ...reads },
    spanLineage: createSpanLineage(port, hashSessionKey),
    counters,
    suppressions: createSuppressionStore(port, hashSessionKey, index.markDirty, migratedRaw, captureControls),
    pause: createPauseStore(port),
    keys: { async userKey(/** @type {string} */ _owner) { return null; } },
    hashSessionKey,
    close,
  };
  assertAdapterCapabilities(adapter);
  return adapter;
}
