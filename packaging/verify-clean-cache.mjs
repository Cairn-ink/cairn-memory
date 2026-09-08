// Network-enabled CI regression with a fresh cache, never the user's cache.
import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildArtifact, command } from './build.mjs';
import { prepareCache } from './prepare-cache.mjs';
const directory = mkdtempSync(join(tmpdir(), 'cairn-cache-repro-'));
const config = join(directory, 'isolated.npmrc');
writeFileSync(config, `cache=${join(directory, 'cache')}\nregistry=https://registry.npmjs.org/\n`);
for (const adapter of ['mcp', 'openai']) {
  const target = join(directory, adapter);
  mkdirSync(target);
  for (const file of ['package.json', 'package-lock.json']) {
    copyFileSync(new URL(`../adapters/${adapter}/${file}`, import.meta.url), join(target, file));
  }
  command('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], target, config);
}
const artifact = buildArtifact();
const target = join(directory, 'installed');
mkdirSync(target);
writeFileSync(join(target, 'package.json'), JSON.stringify({ name: 'synthetic-cache-repro', private: true }));
const install = () => command('npm', ['install', '--prefix', target, '--offline', '--ignore-scripts',
  '--no-audit', '--no-fund', artifact.artifactPath], target, config);
try {
  install();
  console.log('Baseline: offline install succeeds without metadata preparation on this npm version');
} catch (error) {
  if (error.message !== 'artifact_command_failed') throw error;
  console.log('Baseline: offline install requires metadata preparation on this npm version');
}
prepareCache(directory, config);
try {
  install();
  console.log('PASS: isolated CI-warmed cache installs artifact offline');
} catch {
  console.error('FAIL: artifact_command_failed after isolated npm ci cache warming');
  console.log(JSON.stringify({ directory, artifactPath: artifact.artifactPath }));
  process.exitCode = 1;
}
