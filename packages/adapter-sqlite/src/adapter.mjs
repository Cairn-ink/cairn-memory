import { assertAdapterCapabilities, capabilities } from "@cairn-ink/core";
import { createMemoryStore } from "./memories.mjs";
import { createPauseStore } from "./pause.mjs";
import { openStorage } from "./schema/open.mjs";
import { createSuppressionStore, sessionHasher } from "./suppressions.mjs";

/** Opens the storage ports for a single installation database.
 * @param {string} filename
 */
export async function openSqliteAdapter(filename) {
  return createSqliteAdapter(await openStorage(filename));
}

/** @param {Awaited<ReturnType<typeof openStorage>>} storage */
export function createSqliteAdapter({ uow, port, close, sessionHashKey }) {
  const hashSessionKey = sessionHasher(sessionHashKey);
  const adapter = {
    name: "sqlite",
    capabilities: capabilities({ rawSpans: true }),
    uow,
    memories: createMemoryStore(port, hashSessionKey),
    suppressions: createSuppressionStore(port, hashSessionKey),
    pause: createPauseStore(port),
    keys: { async userKey(/** @type {string} */ _owner) { return null; } },
    hashSessionKey,
    close,
  };
  assertAdapterCapabilities(adapter);
  return adapter;
}
