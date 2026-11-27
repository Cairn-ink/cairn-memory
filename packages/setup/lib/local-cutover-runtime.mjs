import { fileURLToPath } from 'node:url';
import { boundedJSON, canonicalPath } from './local-descriptor.mjs';
import { verifyInstalledFiles } from './local-engine.mjs';

const entryPaths = {
  liveness: 'adapters/mcp/local-daemon-liveness.mjs',
  state: 'integrations/client/private-state.mjs',
  lock: 'integrations/client/state-lock.mjs',
  profile: 'integrations/client/raw/local-host-profile.mjs',
  preparation: 'integrations/client/raw/local-host-preparation.mjs',
  files: 'integrations/client/raw/local-setup-files.mjs',
  request: 'integrations/client/raw/local-setup-input.mjs',
  settings: 'integrations/client/raw/local-settings-lock.mjs',
  binding: 'packaging/core-local/capture-binding.mjs',
  provider: 'packaging/core-local/provider-config.mjs',
  backup: 'packages/adapter-sqlite/src/legacy/backup.mjs',
  inventory: 'packages/adapter-sqlite/src/legacy/inventory.mjs',
  paths: 'packages/adapter-sqlite/src/legacy/paths.mjs',
  bootstraps: 'packages/adapter-sqlite/src/legacy/migration-bootstrap.mjs',
  migrate: 'packages/adapter-sqlite/src/migrate/index.mjs',
};
const packaged = new URL('../runtime/cutover/', import.meta.url);
const checkout = new URL('../../../', import.meta.url);
const pathPattern = /^(?:[\w-][\w.-]*\/)*[\w-][\w.-]*$/u;
const digestPattern = /^[a-f0-9]{64}$/u;
const manifestName = 'migration-manifest.json';
const invalid = () => new Error('setup_migration_bundle_invalid');
let verifiedRoot;

async function runtimeRoot() {
  // The checkout coordinator is also exercised without a generated bundle.
  if (new URL('packages/setup/package.json', checkout).href === new URL('../package.json', import.meta.url).href) {
    try {
      const manifest = await boundedJSON(fileURLToPath(new URL('packages/core/package.json', checkout)), 65536);
      if (manifest.name === '@cairn-ink/core') return checkout;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  const directory = fileURLToPath(new URL('.', packaged)).slice(0, -1);
  if (await canonicalPath(directory) !== directory) throw invalid();
  const manifest = await boundedJSON(fileURLToPath(new URL(manifestName, packaged)), 1048576);
  const entries = Object.values(entryPaths).sort();
  const files = Object.keys(manifest.files ?? {}).sort();
  if (manifest.schemaVersion !== 1 || JSON.stringify(manifest.entries) !== JSON.stringify(entries) ||
      entries.some(path => !Object.hasOwn(manifest.files, path)) ||
      files.some(file => !pathPattern.test(file) || !digestPattern.test(manifest.files[file]))) throw invalid();
  const payload = new URL('files/', packaged);
  await verifyInstalledFiles(fileURLToPath(payload), manifest.files);
  return payload;
}

export async function cutoverImport(entry) {
  if (!Object.hasOwn(entryPaths, entry)) throw invalid();
  verifiedRoot ??= runtimeRoot();
  return import(new URL(entryPaths[entry], await verifiedRoot));
}
