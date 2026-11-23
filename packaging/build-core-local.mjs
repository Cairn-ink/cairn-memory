import { chmodSync, copyFileSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync,
  realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { command } from './build.mjs';
import { engineIdForCoreLocal, sha256 } from './core-local/engine-id.mjs';
import { cliEntry, coreManifest, coreRuntimeManifest, deriveRuntimeGraph } from './core-local/import-graph.mjs';

const repo = realpathSync(fileURLToPath(new URL('../', import.meta.url)));
const name = 'cairn-memory-core-local-candidate';
const version = '0.0.0';
const filename = `${name}-${version}.tgz`;
const readJSON = path => JSON.parse(readFileSync(path, 'utf8'));
const json = value => JSON.stringify(value, null, 2) + '\n';

function treeDigests(root) {
  const files = [];
  function walk(path) {
    const absolute = join(root, path);
    const stat = lstatSync(absolute);
    if (stat.isDirectory()) {
      for (const entry of readdirSync(absolute)) walk(path ? path + '/' + entry : entry);
    } else {
      if (!stat.isFile()) throw new Error(`nonregular_core_local_payload: ${path}`);
      files.push(path);
    }
  }
  walk('');
  return Object.fromEntries(files.sort().map(path => [path, sha256(readFileSync(join(root, path)))]));
}

export function buildCoreLocalCandidate(output) {
  const dest = resolve(output);
  const runtime = readJSON(join(repo, 'packaging/core-local-files.json'));
  const graph = deriveRuntimeGraph(repo);
  if (!isDeepStrictEqual(runtime, graph)) throw new Error('core_local_inventory_graph_mismatch');
  const copied = [...runtime, 'LICENSE'];
  const files = [...copied, 'package.json', coreManifest].sort();
  const generated = {
    'package.json': json({
      name, version, private: true, type: 'module', license: 'Apache-2.0',
      engines: { node: '>=22.16.0' },
      bin: { 'cairn-memory-core-local': cliEntry },
      files,
    }),
    [coreManifest]: json(coreRuntimeManifest(repo)),
  };
  const scratch = mkdtempSync(join(tmpdir(), 'cairn-core-local-'));
  const stage = join(scratch, 'stage'), extract = join(scratch, 'extract'), install = join(scratch, 'install');
  const npmrc = join(scratch, 'empty.npmrc'), cache = join(scratch, 'cache');
  try {
    for (const directory of [stage, extract, install]) mkdirSync(directory);
    writeFileSync(npmrc, '', { mode: 0o600 });
    const sourceDigests = {};
    for (const path of copied) {
      const source = join(repo, path), target = join(stage, path);
      if (!lstatSync(source).isFile() || realpathSync(source) !== source) {
        throw new Error(`nonregular_core_local_source: ${path}`);
      }
      const bytes = readFileSync(source);
      sourceDigests[path] = sha256(bytes);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, bytes);
    }
    chmodSync(join(stage, cliEntry), 0o755);
    for (const [path, bytes] of Object.entries(generated)) {
      writeFileSync(join(stage, path), bytes);
      sourceDigests[path] = sha256(bytes);
    }

    const npmFlags = ['--offline', '--ignore-scripts', '--no-audit', '--no-fund', '--cache', cache];
    const packed = JSON.parse(command('npm', ['pack', ...npmFlags, '--json',
      '--pack-destination', scratch], stage, npmrc));
    if (packed.length !== 1 || packed[0].filename !== filename) throw new Error('unexpected_core_local_archive_name');
    const archive = join(scratch, filename);
    const members = command('tar', ['-tzf', archive], scratch, npmrc).trim().split(/\r?\n/u).sort();
    if (!isDeepStrictEqual(members, files.map(path => 'package/' + path))) {
      throw new Error('core_local_archive_inventory_mismatch');
    }
    command('tar', ['-xzf', archive, '-C', extract], scratch, npmrc);
    const extracted = join(extract, 'package');
    const archiveDigests = treeDigests(extracted);
    if (!isDeepStrictEqual(archiveDigests, sourceDigests)) throw new Error('core_local_archive_digest_mismatch');
    if (!isDeepStrictEqual(deriveRuntimeGraph(extracted), graph)) throw new Error('core_local_archive_graph_mismatch');

    command('npm', ['install', ...npmFlags, '--no-package-lock', archive], install, npmrc);
    const installed = join(install, 'node_modules', name);
    const installedDigests = treeDigests(installed);
    if (!isDeepStrictEqual(installedDigests, archiveDigests)) throw new Error('core_local_install_digest_mismatch');
    if (!isDeepStrictEqual(deriveRuntimeGraph(installed), graph)) throw new Error('core_local_install_graph_mismatch');

    const archiveBytes = readFileSync(archive);
    const manifest = {
      schemaVersion: 1,
      package: { name, version },
      engineId: engineIdForCoreLocal(archiveDigests),
      archive: { filename, bytes: archiveBytes.length, sha256: sha256(archiveBytes) },
      files: archiveDigests,
    };
    // Stage in a new output directory so a build never replaces an existing
    // candidate or the shipped generation.
    mkdirSync(dest);
    try {
      copyFileSync(archive, join(dest, filename));
      writeFileSync(join(dest, 'candidate-manifest.json'), json(manifest));
    } catch (error) {
      rmSync(dest, { recursive: true, force: true });
      throw error;
    }
    return manifest;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length !== 4 || process.argv[2] !== '--output') {
      throw new Error('Usage: node packaging/build-core-local.mjs --output NEW_DIRECTORY');
    }
    console.log(json(buildCoreLocalCandidate(process.argv[3])).trimEnd());
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
