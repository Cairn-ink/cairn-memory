import { assertAdapterCapabilities, capabilities } from "@cairn-ink/core";
import { createCapturePorts } from "./capture.mjs";
import { createIndexRevisions } from "./index-revisions.mjs";
import { createMemoryStore } from "./memories.mjs";
import { createPauseStore } from "./pause.mjs";
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
export function createSqliteAdapter({ uow, port, close, sessionHashKey }, { now } = {}) {
  const hashSessionKey = sessionHasher(sessionHashKey);
  const index = createIndexRevisions(uow, port);
  const adapter = {
    name: "sqlite",
    capabilities: capabilities({ rawSpans: true }),
    uow: { run: index.run },
    capture: createCapturePorts(port, hashSessionKey, index, now),
    memories: createMemoryStore(port, hashSessionKey, index.markDirty),
    ...createRetrievalPorts(port, hashSessionKey, sessionHashKey),
    suppressions: createSuppressionStore(port, hashSessionKey, index.markDirty),
    pause: createPauseStore(port),
    keys: { async userKey(/** @type {string} */ _owner) { return null; } },
    hashSessionKey,
    close,
  };
  assertAdapterCapabilities(adapter);
  return adapter;
}
