import { lstatSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, parse, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { identifier } from '../core/validation.mjs';
import { buildArtifact, command, packageName } from './build.mjs';

function configuration(args) {
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 22 || (major === 22 && minor < 16)) throw new Error('unsupported_runtime');
  const allowed = new Set(['--directory', '--owner', '--project']);
  const values = new Map();
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (!allowed.has(key) || values.has(key) || typeof value !== 'string' ||
        !value || value.startsWith('--')) throw new Error('invalid_arguments');
    values.set(key, value);
  }
  const requested = values.get('--directory');
  const ownerId = identifier(values.get('--owner'));
  const projectId = values.has('--project') ? identifier(values.get('--project')) : null;
  if (typeof requested !== 'string' || !isAbsolute(requested) || /[\x00-\x1f\x7f]/.test(requested) ||
      requested.split(/[\\/]/).some((part) => part === '.' || part === '..')) throw new Error('invalid_directory');
  const directory = resolve(requested);
  if (directory === parse(directory).root) throw new Error('invalid_directory');
  // lstat also detects dangling symlinks; existsSync would incorrectly accept them.
  try { lstatSync(directory); } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    for (let parent = dirname(directory); ; parent = dirname(parent)) {
      const stat = lstatSync(parent);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('invalid_parent');
      if (parent === dirname(parent)) break;
    }
    return { directory, ownerId, projectId };
  }
  throw new Error('existing_directory');
}

// The command seam lets offline verification use the same installation workflow.
export function installPreview(args, { runCommand = command } = {}) {
  try {
    const { directory, ownerId, projectId } = configuration(args);
    const artifact = buildArtifact();
    // Revalidate after building, before claiming the new directory exclusively.
    configuration(args);
    mkdirSync(directory, { mode: 0o700 });
    const app = join(directory, 'app');
    const data = join(directory, 'data');
    mkdirSync(app, { mode: 0o700 });
    mkdirSync(data, { mode: 0o700 });
    const userconfig = join(app, '.npmrc');
    writeFileSync(userconfig, 'registry=https://registry.npmjs.org/\n', { mode: 0o600, flag: 'wx' });
    writeFileSync(join(app, 'package.json'), JSON.stringify({ name: 'cairn-preview-installation',
      version: '0.0.0', private: true }) + '\n', { mode: 0o600, flag: 'wx' });
    runCommand('npm', ['install', '--prefix', app, '--ignore-scripts', '--no-audit', '--no-fund',
      '--registry=https://registry.npmjs.org/', artifact.artifactPath], app, userconfig);
    const executable = join(app, 'node_modules', packageName, 'bin/cairn-memory.mjs');
    const databasePath = join(data, 'memory.sqlite');
    const stdio = { command: process.execPath, args: [executable, '--db', databasePath, '--owner', ownerId,
      ...(projectId === null ? [] : ['--project', projectId])] };
    const check = JSON.parse(runCommand(stdio.command, [executable, '--check-config', ...stdio.args.slice(1)], app, userconfig));
    if (check.ok !== true || check.databaseOpened !== false || check.providerContacted !== false ||
        check.modelKeyPresent !== false) throw new Error('configuration_check_failed');
    const receiptPath = join(directory, 'installation-receipt.json');
    const receipt = { artifact: { path: artifact.artifactPath, sha256: artifact.sha256,
      name: artifact.name, version: artifact.version, sourceHashes: artifact.sourceHashes },
    executable, databasePath, ownerId, projectId, stdio };
    writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    return { receiptPath, ...receipt };
  } catch {
    throw new Error('cairn_preview_install_failed: check Node >=22.16, arguments, a new absolute target with real existing parents, and npm availability. Any partial installation is retained; no overwrite or cleanup was attempted.');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const report = installPreview(process.argv.slice(2));
    console.log(JSON.stringify({ notice: 'Local path and identity report: contains exact paths and owner/project IDs; unlike the secret-free --check-config report, keep this private.', ...report }, null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
