import { createContextReadHost as batchHost } from './context-read-three-layer-host.mjs';

// Existing hosts can keep the original single-candidate preparation port.
export async function createContextReadHost(configuration) {
  const host = await batchHost(configuration);
  const { prepareMany, ...rawSearch } = host.rawSearch;
  return { ...host, rawSearch };
}
