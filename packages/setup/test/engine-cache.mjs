import { createHash } from 'node:crypto';
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { delimiter, dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const packageRoot = process.env.CAIRN_SETUP_TEST_PACKAGE || fileURLToPath(new URL('../', import.meta.url));
const bundle = join(packageRoot, 'runtime', 'engine');
const manifest = JSON.parse(readFileSync(join(bundle, 'manifest.json'), 'utf8'));
const archive = join(bundle, `${manifest.package.name}-${manifest.package.version}.tgz`);
function command(executable, args, options = {}) {
  const result = spawnSync(executable, args, { encoding: 'utf8', timeout: 120000,
    maxBuffer: 8 * 1024 * 1024, ...options });
  if (result.error || result.status !== 0) throw new Error(`engine_cache_command_failed: exit ${result.status}`);
  return result.stdout;
}

// Inspect actual content-addressed dependency tarballs, not a marker that could
// outlive the cache. This check never invokes npm or reaches the network.
export function engineCacheComplete(cacheDir) {
  if (!cacheDir || !isAbsolute(cacheDir)) return false;
  try {
    if (!lstatSync(cacheDir).isDirectory()) return false;
    const lock = JSON.parse(command('tar', ['-xOf', archive, 'package/npm-shrinkwrap.json']));
    const dependencies = Object.entries(lock.packages).filter(([name]) => name !== '');
    if (dependencies.length !== 4) return false;
    return dependencies.every(([, entry]) => {
      const digest = Buffer.from(entry.integrity.slice('sha512-'.length), 'base64').toString('hex');
      const content = readFileSync(join(cacheDir, '_cacache', 'content-v2', 'sha512',
        digest.slice(0, 2), digest.slice(2, 4), digest.slice(4)));
      return createHash('sha512').update(content).digest('hex') === digest;
    });
  } catch { return false; }
}

export async function primeEngineCache(cacheDir) {
  if (typeof cacheDir !== 'string' || !isAbsolute(cacheDir) || cacheDir.includes('\0')) {
    throw new Error('invalid_engine_cache_directory');
  }
  if (engineCacheComplete(cacheDir)) return;
  if (process.env.CAIRN_SETUP_TEST_NETWORK !== '1' || process.env.CAIRN_SETUP_NPM_OFFLINE === '1') {
    throw new Error('Engine cache is incomplete; set CAIRN_SETUP_TEST_NETWORK=1 in the network phase.');
  }
  mkdirSync(cacheDir, { recursive: true, mode: 0o700 });
  if (!lstatSync(cacheDir).isDirectory()) throw new Error('invalid_engine_cache_directory');
  const scratch = mkdtempSync(join(tmpdir(), 'cairn-engine-cache-'));
  try {
    const userconfig = join(scratch, '.npmrc');
    writeFileSync(userconfig, 'registry=https://registry.npmjs.org/\n', { mode: 0o600 });
    writeFileSync(join(scratch, 'package.json'), '{"name":"engine-cache-prime","private":true}\n');
    const env = { PATH: `${dirname(process.execPath)}${delimiter}${process.env.PATH ?? ''}`,
      npm_config_cache: cacheDir, npm_config_userconfig: userconfig,
      npm_config_audit: 'false', npm_config_fund: 'false' };
    command('npm', ['install', '--prefix', scratch, '--ignore-scripts', '--no-audit', '--no-fund', archive],
      { cwd: scratch, env });
    if (!engineCacheComplete(cacheDir)) throw new Error('engine_cache_incomplete_after_priming');
  } finally { rmSync(scratch, { recursive: true, force: true }); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await primeEngineCache(process.argv[2] ?? process.env.CAIRN_SETUP_NPM_CACHE);
  console.log('Engine dependency cache is complete (4 tarballs).');
}
