import { mkdtemp, readFile, writeFile, mkdir, copyFile, readdir } from 'node:fs/promises';
import { openSync, closeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { hash } from './adapters.mjs';
const root = fileURLToPath(new URL('..', import.meta.url));
const json = async p => JSON.parse(await readFile(p, 'utf8'));
export async function regenerate() {
  const temp = await mkdtemp(join(tmpdir(), 'hr3-integration-'));
  const commands = [], checks = [];
  async function run(args, logName) {
    const log = join(temp, logName), fd = openSync(log, 'wx');
    let result; try { result = spawnSync(process.execPath, args, { stdio: ['ignore', fd, fd] }); } finally { closeSync(fd); }
    commands.push({ command: ['node', ...args].join(' ').replaceAll(temp, '<TEMP>').replaceAll(root, 'evaluation/hr3/'), exitCode: result.status, signal: result.signal, error: result.error?.message ?? null, log: log.replaceAll(temp, '<TEMP>') });
    if (result.status !== 0) throw new Error(`Regeneration failed: ${JSON.stringify(commands.at(-1))}`);
  }
  async function check(path, expected, name) {
    const bytes = await readFile(path), actual = hash(bytes);
    if (actual !== expected.sha256 || (expected.bytes !== undefined && expected.bytes !== bytes.length)) throw new Error(`Frozen hash mismatch: ${name}`);
    checks.push({ name, sha256: actual, bytes: bytes.length });
  }
  const freeze = await json(join(root, 'generator/freeze.json'));
  for (const [name, expected] of Object.entries(freeze.hashes).filter(([name]) => !name.startsWith('artifacts/'))) await check(join(root, 'generator', name), expected, `generator/${name}`);
  await run([join(root, 'generator/cli.mjs'), '--split', 'pilot', '--out', join(temp, 'pilot')], 'generator.log');
  const pilotManifest = await json(join(temp, 'pilot/manifest.json'));
  for (const name of [...Object.keys(pilotManifest.hashes), 'manifest.json']) await check(join(temp, 'pilot', name), freeze.hashes[`artifacts/pilot/${name}`], `generator/artifacts/pilot/${name}`);
  // Challenge CLI has no --out. Execute a byte-for-byte copy in temp so its
  // ROOT-relative writes never touch a sibling directory.
  const manifest = await json(join(root, 'challenge/manifest.json'));
  await mkdir(join(temp, 'challenge')); await mkdir(join(temp, 'protocol'));
  for (const name of ['protocol-v0.3.4.md', 'errata.md']) await copyFile(join(root, 'protocol', name), join(temp, 'protocol', name));
  for (const entry of manifest.artifacts.filter(e => !e.path.endsWith('.jsonl'))) {
    await check(join(root, 'challenge', entry.path), entry, `challenge/source/${entry.path}`);
    await copyFile(join(root, 'challenge', entry.path), join(temp, 'challenge', entry.path));
  }
  await run([join(temp, 'challenge/generate.mjs')], 'challenge.log');
  for (const entry of manifest.artifacts) await check(join(temp, 'challenge', entry.path), entry, `challenge/${entry.path}`);
  for (const [name, expected] of [['generator', freeze.protocol_sha256], ['challenge', manifest.protocol.sha256]]) await check(join(root, 'protocol/protocol-v0.3.4.md'), { sha256: expected }, `${name}/protocol`);
  const scorerFiles = await readdir(join(root, 'scorer'));
  const scorer = [];
  for (const name of scorerFiles.filter(n => /\.(mjs|json)$/.test(n)).sort()) scorer.push({ path: name, sha256: hash(await readFile(join(root, 'scorer', name))) });
  const integration = [];
  for (const name of ['adapters.mjs', 'field-map.mjs', 'mechanical.mjs', 'reproduce.mjs', 'gate.mjs', 'cli.mjs']) integration.push({ path: name, sha256: hash(await readFile(new URL(name, import.meta.url))) });
  return { temp, pilot: join(temp, 'pilot'), challenge: join(temp, 'challenge'), verification: { runtime: process.version, commands, checks, scorer, integration, errata: hash(await readFile(join(root, 'protocol/errata.md'))) } };
}
export const readJSONL = async path => (await readFile(path, 'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);
