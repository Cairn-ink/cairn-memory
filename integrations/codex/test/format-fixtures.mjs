import { readFile } from 'node:fs/promises';
import { SERDE_MARKERS } from '../schema-evidence.mjs';

// Historical bytes and their manifests stay frozen. Only the marker profile in
// the hash input is refreshed, as required by contract section 18, Rule 2.
export const currentMarkers = evidence => ({ ...evidence, serdeMarkers: [...SERDE_MARKERS].sort() });
export async function formatFixture(version) {
  return currentMarkers(JSON.parse(await readFile(new URL(`./fixtures/binary-${version}/format.json`, import.meta.url))));
}
