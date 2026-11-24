import { assertAdapterCapabilities, capabilities } from "@cairn-ink/core";
import { createCapturePorts } from "./capture.mjs";
import { createIndexRevisions } from "./index-revisions.mjs";
import { createInspectStore } from "./inspect.mjs";
import { createMemoryStore } from "./memories.mjs";
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
 */
export async function openSqliteAdapter(filename) {
  return createSqliteAdapter(await openStorage(filename));
}

/** @param {Awaited<ReturnType<typeof openStorage>>} storage @param {{ now?: () => number }} [options] */
export function createSqliteAdapter({ uow, port, close, sessionHashKey, legacyRawHashing }, { now } = {}) {
  const hashSessionKey = sessionHasher(sessionHashKey, legacyRawHashing);
  const migratedRaw = legacyRawHashing ? createMigratedRawPolicy(sessionHashKey, hashSessionKey) : undefined;
  const index = createIndexRevisions(uow, port);
  const lineage = createRawLineage(sessionHashKey, hashSessionKey);
  const { raw, counters } = createRawStore(port, hashSessionKey, lineage, index, migratedRaw);
  const { reads, visibleRawRefs } = createRawReads(port, hashSessionKey, sessionHashKey, migratedRaw);
  const adapter = {
    name: "sqlite",
    capabilities: capabilities({ rawArchive: true, rawSpans: true, rawWindowHide: true, spanLineage: true, inspect: true }),
    uow: { run: index.run },
    capture: createCapturePorts(port, hashSessionKey, index, lineage, now, migratedRaw),
    memories: createMemoryStore(port, hashSessionKey, index.markDirty),
    inspect: createInspectStore(port, hashSessionKey),
    ...createRetrievalPorts(port, hashSessionKey, sessionHashKey, visibleRawRefs),
    raw: { ...raw, ...reads },
    spanLineage: createSpanLineage(port, hashSessionKey),
    counters,
    suppressions: createSuppressionStore(port, hashSessionKey, index.markDirty, migratedRaw),
    pause: createPauseStore(port),
    keys: { async userKey(/** @type {string} */ _owner) { return null; } },
    hashSessionKey,
    close,
  };
  assertAdapterCapabilities(adapter);
  return adapter;
}
