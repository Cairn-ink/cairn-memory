import { createHash } from 'node:crypto';
import { readFile, writeFile, rename, mkdir, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';

export const ROOT = fileURLToPath(new URL('.', import.meta.url));
export const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export const canonical = value => JSON.stringify(value, (_, v) => v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b, 'en'))) : v);
export async function atomicJSON(path, value) {
  const temp = path + `.tmp-${process.pid}`;
  await writeFile(temp, JSON.stringify(value, null, 2) + '\n');
  await rename(temp, path);
}
async function walk(dir) {
  const result = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (['reports', 'artifacts', 'node_modules', '.git'].includes(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) result.push(...await walk(path));
    else if (/\.(mjs|json)$/.test(path)) result.push(path);
  }
  return result.sort();
}
export async function implementationManifest() {
  const authority = ['../protocol/protocol-v0.3.4.md', '../protocol/errata.md', '../generator/public-contract.json'];
  const paths = [...await walk(ROOT), ...await walk(join(ROOT, '../scorer')), ...await walk(join(ROOT, '../integration')),
    ...authority.map(p => join(ROOT, p))];
  const files = {};
  for (const path of [...new Set(paths)].sort()) files[relative(ROOT, path)] = hash(await readFile(path));
  return { sha256: hash(canonical(files)), files };
}
export async function storeDataset(out, job, result, identitySHA256) {
  const directory = join(out, 'datasets', job.cell.id);
  await mkdir(directory, { recursive: true });
  const stem = join(directory, String(job.index).padStart(4, '0'));
  const arrays = [...result.primary, ...result.lineage];
  const bytes = Buffer.alloc(arrays.reduce((n, a) => n + a.length * 8, 0));
  let offset = 0;
  for (const a of arrays) for (const x of a) { bytes.writeDoubleLE(x, offset); offset += 8; }
  const binary = stem + '.f64le';
  await writeFile(binary + '.tmp', bytes); await rename(binary + '.tmp', binary);
  const summary = { ...result.summary, identitySHA256, replicateArtifact: { path: relative(out, binary), sha256: hash(bytes), bytes: bytes.length,
    encoding: 'IEEE754-f64-little-endian', layout: 'primary columns then lineage columns', draws: result.primary[0].length,
    primaryNames: result.summary.primary.names, lineageNames: result.summary.lineage?.names ?? [] } };
  summary.checkpointSHA256 = hash(canonical(summary));
  await atomicJSON(stem + '.json', summary);
  return summary;
}
export async function loadDataset(out, cell, index, draws, identitySHA256) {
  const path = join(out, 'datasets', cell.id, String(index).padStart(4, '0') + '.json');
  let summary;
  try { summary = JSON.parse(await readFile(path, 'utf8')); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
  const a = summary.replicateArtifact, bytes = await readFile(join(out, a.path));
  const { checkpointSHA256, ...content } = summary;
  if (summary.cell !== cell.id || summary.index !== index || summary.identitySHA256 !== identitySHA256 || a.draws !== draws || a.sha256 !== hash(bytes) || a.bytes !== bytes.length ||
    checkpointSHA256 !== hash(canonical(content)) ||
    bytes.length !== 8 * draws * (a.primaryNames.length + a.lineageNames.length)) throw Error('Corrupt/stale dataset checkpoint: ' + path);
  return summary;
}
