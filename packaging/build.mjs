import { createHash } from 'node:crypto';
import { chmodSync, copyFileSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const readJSON = (path) => JSON.parse(readFileSync(path, 'utf8'));
const hash = (value) => createHash('sha256').update(value).digest('hex');
export const packageName = 'cairn-memory-local-preview';
export const packageVersion = '0.0.0-preview.1';
export const runtimeFiles = Object.freeze(readJSON(join(root, 'packaging/artifact-files.json')));
const extraFiles = [
  ['packaging/bin/cairn-memory.mjs', 'bin/cairn-memory.mjs'],
  ['packaging/README.md', 'README.md'],
  ['packaging/THIRD_PARTY_NOTICES.md', 'THIRD_PARTY_NOTICES.md'],
  ['packaging/licenses/tiktoken-LICENSE', 'licenses/tiktoken-LICENSE'],
];

// npm receives no application environment, credentials or project npm config.
export function command(executable, args, cwd, userconfig) {
  const result = spawnSync(executable, args, { cwd, encoding: 'utf8', timeout: 120000,
    maxBuffer: 4 * 1024 * 1024, env: { PATH: `${dirname(process.execPath)}${delimiter}${process.env.PATH ?? ''}`,
      ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
      npm_config_userconfig: userconfig, npm_config_audit: 'false', npm_config_fund: 'false' } });
  if (result.error || result.status !== 0) throw new Error('artifact_command_failed');
  return result.stdout;
}

function productionLock(manifest) {
  const mcp = readJSON(join(root, 'adapters/mcp/package-lock.json'));
  const openai = readJSON(join(root, 'adapters/openai/package-lock.json'));
  const packages = { '': { name: manifest.name, version: manifest.version, license: manifest.license,
    dependencies: manifest.dependencies, bin: manifest.bin, engines: manifest.engines } };
  const expected = { '@modelcontextprotocol/server': '2.0.0', '@modelcontextprotocol/core': '2.0.0',
    zod: '4.5.4', tiktoken: '1.0.22' };
  for (const [name, version] of Object.entries(expected)) {
    const key = `node_modules/${name}`;
    const entry = (name === 'tiktoken' ? openai : mcp).packages[key];
    if (!entry || entry.version !== version || entry.dev || entry.hasInstallScript ||
      !entry.resolved?.startsWith('https://registry.npmjs.org/') || !entry.integrity?.startsWith('sha512-') ||
      Object.keys(entry.dependencies ?? {}).some((dependency) => !Object.hasOwn(expected, dependency))) {
      throw new Error('unreviewed_production_dependency');
    }
    packages[key] = structuredClone(entry);
  }
  return { name: manifest.name, version: manifest.version, lockfileVersion: 3, requires: true, packages };
}

export function buildArtifact({ version = packageVersion } = {}) {
  if (!/^0\.0\.0-preview\.[1-9]\d*$/.test(version)) throw new Error('invalid_preview_version');
  const directory = mkdtempSync(join(tmpdir(), 'cairn-local-artifact-'));
  const stagingPath = join(directory, 'staging');
  mkdirSync(stagingPath);
  const userconfig = join(directory, 'empty.npmrc');
  writeFileSync(userconfig, '', { mode: 0o600 });
  const copied = [...runtimeFiles.map((path) => [path, path]), ...extraFiles];
  const files = copied.map(([, target]) => target).concat('package.json', 'npm-shrinkwrap.json').sort();
  if (new Set(files).size !== files.length) throw new Error('duplicate_artifact_path');
  const sourceHashes = {};
  for (const [source, target] of copied) {
    if (source.split('/').includes('..') || target.split('/').includes('..') || source.startsWith('/') || target.startsWith('/')) {
      throw new Error('invalid_artifact_path');
    }
    const sourcePath = join(root, source);
    if (!lstatSync(sourcePath).isFile()) throw new Error('nonregular_artifact_source');
    mkdirSync(dirname(join(stagingPath, target)), { recursive: true });
    copyFileSync(sourcePath, join(stagingPath, target));
    sourceHashes[target] = hash(readFileSync(sourcePath));
  }
  chmodSync(join(stagingPath, 'bin/cairn-memory.mjs'), 0o755);
  const manifest = { name: packageName, version, private: true, type: 'module',
    description: 'Local install preview of the shared Cairn memory core and stdio host.',
    license: 'Apache-2.0', engines: { node: '>=22.16.0' },
    bin: { 'cairn-memory': 'bin/cairn-memory.mjs' }, files,
    dependencies: { '@modelcontextprotocol/server': '2.0.0', zod: '4.5.4', tiktoken: '1.0.22' } };
  writeFileSync(join(stagingPath, 'package.json'), JSON.stringify(manifest, null, 2) + '\n');
  writeFileSync(join(stagingPath, 'npm-shrinkwrap.json'), JSON.stringify(productionLock(manifest), null, 2) + '\n');
  const packed = JSON.parse(command('npm', ['pack', '--offline', '--ignore-scripts', '--json',
    '--pack-destination', directory], stagingPath, userconfig));
  if (packed.length !== 1 || packed[0].filename !== `${packageName}-${version}.tgz`) throw new Error('unexpected_artifact_name');
  const artifactPath = join(directory, packed[0].filename);
  const archiveFiles = command('tar', ['-tzf', artifactPath], stagingPath, userconfig)
    .trim().split('\n').map((path) => {
      if (!path.startsWith('package/')) throw new Error('unexpected_archive_prefix');
      return path.slice('package/'.length);
    }).sort();
  if (JSON.stringify(archiveFiles) !== JSON.stringify(files)) throw new Error('unexpected_archive_contents');
  const report = { name: packageName, version, artifactPath, sha256: hash(readFileSync(artifactPath)),
    bytes: lstatSync(artifactPath).size, files: archiveFiles, sourceHashes, stagingPath, userconfig };
  writeFileSync(join(directory, 'build-report.json'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length !== 2) throw new Error('unexpected_build_arguments');
    console.log(JSON.stringify(buildArtifact(), null, 2));
  } catch { console.error('cairn_artifact_build_failed'); process.exitCode = 1; }
}
