// Refuse discovery before touching any external PATH directory or executable.
import { accessSync, constants, realpathSync } from 'node:fs';
import { basename, delimiter, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

function inside(root, path) {
  const name = relative(root, path);
  return name !== '..' && !name.startsWith('..' + sep) && !isAbsolute(name);
}
function refuse(detail) { throw new Error('fixture client guard: ' + detail); }

export function assertFixtureBinary(path, fixture) {
  const root = realpathSync(fixture);
  if (!inside(root, resolve(path))) refuse('binary outside fixture directory');
  if (!inside(root, realpathSync(path))) refuse('binary target outside fixture directory');
}

export function assertFixtureClients(env, fixture) {
  const root = realpathSync(fixture);
  const directories = (env.PATH ?? '').split(delimiter);
  // Reject even a trailing external entry: an absent fake must never fall back
  // to a native client in Node's bin directory (or the caller's PATH).
  for (const directory of directories) {
    if (!isAbsolute(directory) || !inside(root, resolve(directory))) refuse('PATH entry outside fixture directory');
    if (!inside(root, realpathSync(directory))) refuse('PATH target outside fixture directory');
  }
  const clients = {};
  for (const client of ['codex', 'claude']) {
    for (const directory of directories) {
      const path = join(directory, client);
      try { accessSync(path, constants.X_OK); }
      catch (error) { if (['ENOENT', 'EACCES'].includes(error.code)) continue; throw error; }
      assertFixtureBinary(path, root);
      // resolveCLI treats codex.js specially and may resolve a vendor package
      // through ancestor node_modules. Fixtures use direct, guarded binaries.
      if (basename(realpathSync(path)) !== client) refuse('unexpected fixture client launcher');
      clients[client] = realpathSync(path);
      break;
    }
  }
  return clients; // Missing clients are intentional in single-client fixtures.
}

// Embed the absolute test module and fixture root; qualification children have
// a minimal environment, so the fake's refusal must not depend on an env flag.
export function fixtureBinaryGuard(fixture) {
  return `import { assertFixtureBinary as guardFixtureClient } from ${JSON.stringify(fileURLToPath(import.meta.url))};\n` +
    `guardFixtureClient(process.argv[1], ${JSON.stringify(fixture)});\n`;
}
