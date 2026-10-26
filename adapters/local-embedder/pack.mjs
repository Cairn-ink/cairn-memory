import { lstat, readdir, open, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, parse } from 'node:path';
import { release } from 'node:os';
import { canonical, closed, fail, HASH, IDENTITY, MODEL, relativePath, sha256, strictJSON, absolutePath, qualification } from './common.mjs';
import { RELEASE_CATALOG } from './catalog.mjs';
const INVALID = 'model_pack_manifest_invalid';
const exact = (v, keys) => { closed(v, keys, INVALID); if (Object.keys(v).length !== keys.length) fail(INVALID); };
const integer = v => Number.isSafeInteger(v) && v >= 0;
const version = v => typeof v === 'string' && v.length > 0 && v.length <= 200 && v.isWellFormed() && !v.includes('\0');
function sorted(rows, key) {
  if (!Array.isArray(rows) || !rows.length || rows.some((row, i) => i && key(rows[i - 1]) >= key(row))) fail(INVALID);
}
const paths = values => { if (!Array.isArray(values)) fail(INVALID); for (const v of values) relativePath(v); if (values.some((v, i) => i && values[i - 1] >= v)) fail(INVALID); };
export function parseManifest(bytes, catalog = RELEASE_CATALOG) {
  if (bytes.length > 4194304) fail(INVALID);
  const m = strictJSON(bytes, INVALID);
  exact(m, ['format', 'packId', 'packVersion', 'protocolVersion', 'model', 'runtime', 'licenses', 'files']);
  if (m.format !== 'cairn-model-pack-v1' || m.packId !== 'bge-m3' || !version(m.packVersion) || m.protocolVersion !== 'cairn-local-embed-v1') fail(INVALID);
  if (canonical(m.model) !== canonical(MODEL)) fail(INVALID);
  const r = m.runtime;
  exact(r, ['nodeRange', 'transformersVersion', 'ortVersion', 'device', 'interOpThreads', 'executionMode', 'lockPath', 'packages', 'nativeTargets']);
  if (!version(r.nodeRange) || r.transformersVersion !== '3.7.6' || r.ortVersion !== '1.21.0' || r.device !== 'cpu' || r.interOpThreads !== 1 || r.executionMode !== 'sequential' || r.lockPath !== 'runtime/package-lock.json') fail(INVALID);
  sorted(r.packages, row => row.root);
  for (const p of r.packages) {
    exact(p, ['name', 'version', 'root', 'license']); relativePath(p.root);
    if (![p.name, p.version, p.license].every(version) || !p.root.startsWith('runtime/node_modules/')) fail(INVALID);
  }
  for (const [name, pinned] of [['@huggingface/transformers', '3.7.6'], ['onnxruntime-node', '1.21.0'], ['sharp', '0.34.5']]) {
    if (r.packages.filter(p => p.name === name && p.version === pinned).length !== 1) fail(INVALID);
  }
  if (!r.packages.some(p => p.name.includes('sharp-libvips') && p.version === '1.2.4' && p.license === 'LGPL-3.0-or-later')) fail(INVALID);
  const targetKey = t => canonical([t.os, t.arch, t.libc, t.minOs, t.nodeAbi, t.entry]);
  sorted(r.nativeTargets, targetKey);
  for (const t of r.nativeTargets) {
    exact(t, ['os', 'arch', 'libc', 'minOs', 'nodeAbi', 'entry', 'files']);
    if (![t.os, t.arch].every(version) || ![t.libc, t.minOs, t.nodeAbi].every(v => v === null || version(v))) fail(INVALID);
    relativePath(t.entry); paths(t.files); if (!t.files.includes(t.entry)) fail(INVALID);
  }
  sorted(m.files, f => f.path);
  if (m.files.length > 16384) fail(INVALID);
  const seen = new Set();
  for (const f of m.files) {
    exact(f, ['path', 'bytes', 'sha256', 'role']); relativePath(f.path);
    const key = f.path.toLowerCase();
    if (f.path === 'manifest.json' || seen.has(key) || !integer(f.bytes) || !HASH.test(f.sha256) || !['model', 'tokenizer', 'runtime', 'native', 'provenance', 'license'].includes(f.role)) fail(INVALID);
    seen.add(key);
  }
  const inventory = new Map(m.files.map(f => [f.path, f]));
  for (const required of ['model/config.json', 'model/tokenizer.json', 'model/tokenizer_config.json', 'model/onnx/model.onnx', 'model/onnx/model.onnx_data', 'provenance/model-card.md', 'provenance/model-license.txt', 'runtime/package.json', r.lockPath, 'licenses/THIRD_PARTY_NOTICES.md']) if (!inventory.has(required)) fail(INVALID);
  for (const p of r.packages) if (!inventory.has(p.root + '/package.json')) fail(INVALID);
  for (const t of r.nativeTargets) for (const path of t.files) if (inventory.get(path)?.role !== 'native') fail(INVALID);
  sorted(m.licenses, row => row.component + '\0' + row.version);
  for (const l of m.licenses) {
    exact(l, ['component', 'version', 'spdx', 'source', 'revision', 'evidencePaths', 'noticePaths', 'sourceOfferPaths']);
    if (![l.component, l.version, l.spdx, l.source].every(version) || !(l.revision === null || version(l.revision))) fail(INVALID);
    for (const key of ['evidencePaths', 'noticePaths', 'sourceOfferPaths']) {
      paths(l[key]); if (key !== 'sourceOfferPaths' && !l[key].length) fail(INVALID);
      for (const path of l[key]) if (!inventory.has(path)) fail(INVALID);
    }
    if (l.spdx.includes('LGPL') && !l.sourceOfferPaths.length) fail(INVALID);
  }
  for (const p of r.packages) if (!m.licenses.some(l => l.component === p.name && l.version === p.version && l.spdx === p.license)) fail(INVALID);
  if (!m.licenses.some(l => l.component === 'Xenova/bge-m3' && l.spdx === 'MIT' && l.revision === MODEL.revision)) fail(INVALID);
  if (!Buffer.from(canonical(m)).equals(bytes)) fail(INVALID);
  const manifestHash = sha256(bytes), descriptor = catalog.find(d => d.manifestHash === manifestHash && d.packVersion === m.packVersion);
  if (!descriptor) fail(INVALID);
  return { manifest: m, manifestHash, descriptor };
}
export function fileIdentity(stat) {
  return Object.fromEntries(['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs'].map(k => [k, String(stat[k])]));
}
const directoryIdentity = stat => ({ dev: String(stat.dev), ino: String(stat.ino) });
const equal = (a, b) => canonical(a) === canonical(b);
async function stat(path) {
  try { return await lstat(path, { bigint: true }); } catch { fail('model_pack_unavailable'); }
}
async function directories(root) {
  const dirs = [];
  for (let path = root;; path = dirname(path)) { dirs.unshift(path); if (path === parse(path).root) break; }
  const result = [];
  for (const path of dirs) { const s = await stat(path); if (!s.isDirectory() || s.isSymbolicLink()) fail('model_pack_integrity'); result.push({ path, ...directoryIdentity(s) }); }
  return result;
}
async function boundedRead(path, before, maximum) {
  let handle;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    if (!equal(fileIdentity(await handle.stat({ bigint: true })), fileIdentity(before))) fail('model_pack_integrity');
    const parts = []; let size = 0;
    for await (const chunk of handle.createReadStream({ autoClose: false })) { size += chunk.length; if (size > maximum) fail('model_pack_integrity'); parts.push(chunk); }
    if (!equal(fileIdentity(await handle.stat({ bigint: true })), fileIdentity(before)) || !equal(fileIdentity(await stat(path)), fileIdentity(before))) fail('model_pack_integrity');
    return Buffer.concat(parts, size);
  } finally { await handle?.close(); }
}
async function hashFile(path, before, maximum) {
  let handle;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    if (!equal(fileIdentity(await handle.stat({ bigint: true })), fileIdentity(before))) fail('model_pack_integrity');
    const hash = createHash('sha256'); let bytes = 0;
    for await (const chunk of handle.createReadStream({ autoClose: false })) { bytes += chunk.length; if (bytes > maximum) fail('model_pack_integrity'); hash.update(chunk); }
    if (!equal(fileIdentity(await handle.stat({ bigint: true })), fileIdentity(before)) || !equal(fileIdentity(await stat(path)), fileIdentity(before))) fail('model_pack_integrity');
    return { bytes, sha256: hash.digest('hex') };
  } catch (error) { if (error.code?.startsWith('model_')) throw error; fail('model_pack_unavailable'); }
  finally { await handle?.close(); }
}
async function enumerate(root) {
  const files = [], dirs = [], aliases = new Set(), casePaths = new Set();
  async function walk(relative) {
    const path = relative ? join(root, relative) : root, s = await stat(path);
    const key = relative.toLowerCase(); if (casePaths.has(key)) fail('model_pack_integrity'); casePaths.add(key);
    if (s.isSymbolicLink()) fail('model_pack_integrity');
    if (s.isDirectory()) {
      dirs.push({ path, ...directoryIdentity(s) });
      for (const name of (await readdir(path)).sort()) await walk(relative ? relative + '/' + name : name);
    } else if (s.isFile()) {
      const inode = s.dev + ':' + s.ino;
      if (s.nlink !== 1n || aliases.has(inode)) fail('model_pack_integrity'); aliases.add(inode);
      files.push({ path: relative, stat: s });
    } else fail('model_pack_integrity');
  }
  await walk(''); return { files, dirs };
}
export async function checkFence(root, fence) {
  try {
    exactFence(fence);
    const ancestors = await directories(root);
    if (!equal(ancestors, fence.directories.filter(d => ancestors.some(a => a.path === d.path)))) fail('model_pack_integrity');
    for (const dir of fence.directories) {
      const s = await stat(dir.path);
      if (!s.isDirectory() || !equal(directoryIdentity(s), { dev: dir.dev, ino: dir.ino })) fail('model_pack_integrity');
    }
    const tree = await enumerate(root);
    if (!equal(tree.files.map(f => f.path).sort(), fence.files.map(f => f.path).sort()) || !equal(tree.dirs.map(d => d.path).sort(), fence.directories.filter(d => d.path === root || d.path.startsWith(root + '/')).map(d => d.path).sort())) fail('model_pack_integrity');
    for (const f of fence.files) {
      const s = await stat(join(root, f.path));
      if (!s.isFile() || s.nlink !== 1n || !equal(fileIdentity(s), f.identity)) fail('model_pack_integrity');
    }
    const manifestRecord = fence.files.find(f => f.path === 'manifest.json');
    if (!manifestRecord || BigInt(manifestRecord.identity.size) > 4194304n) fail('model_pack_integrity');
    const bytes = await boundedRead(join(root, 'manifest.json'), await stat(join(root, 'manifest.json')), 4194304);
    if (sha256(bytes) !== fence.manifestHash) fail('model_pack_integrity');
    const m = strictJSON(bytes, 'model_pack_integrity');
    if (!equal(fence.files.map(f => f.path).sort(), ['manifest.json', ...m.files.map(f => f.path)].sort()) || !m.runtime.nativeTargets.some(t => equal(t, fence.target)) || !equal(fence.selectedNativeFiles, fence.target.files)) fail('model_pack_integrity');
    return m;
  } catch { fail('model_pack_integrity'); }
}
function exactFence(fence) {
  closed(fence, ['manifestHash', 'directories', 'files', 'selectedNativeFiles', 'target'], 'model_pack_integrity');
  if (!HASH.test(fence.manifestHash) || !Array.isArray(fence.files) || !Array.isArray(fence.directories) || new Set(fence.files.map(f => f.path)).size !== fence.files.length || new Set(fence.directories.map(d => d.path)).size !== fence.directories.length) fail('model_pack_integrity');
  if (Object.keys(fence).length !== 5 || !Array.isArray(fence.selectedNativeFiles)) fail('model_pack_integrity');
  for (const d of fence.directories) {
    closed(d, ['path', 'dev', 'ino'], 'model_pack_integrity'); absolutePath(d.path, 'model_pack_integrity');
    if (Object.keys(d).length !== 3 || ![d.dev, d.ino].every(v => typeof v === 'string' && /^(?:0|[1-9][0-9]*)$/.test(v))) fail('model_pack_integrity');
  }
  for (const f of fence.files) {
    closed(f, ['path', 'identity'], 'model_pack_integrity'); if (Object.keys(f).length !== 2) fail('model_pack_integrity');
    relativePath(f.path); closed(f.identity, ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs'], 'model_pack_integrity');
    if (Object.keys(f.identity).length !== 5 || Object.entries(f.identity).some(([key, v]) => typeof v !== 'string' || !(/^(?:0|[1-9][0-9]*)$/.test(v) || ['mtimeNs', 'ctimeNs'].includes(key) && /^-[1-9][0-9]*$/.test(v)))) fail('model_pack_integrity');
  }
}
async function inspectPack(packPath, { catalog = RELEASE_CATALOG, platform = process.platform, arch = process.arch, nodeVersion = process.versions.node, nodeAbi = process.versions.modules, osVersion = process.platform === 'darwin' ? process.getSystemVersion?.() : release(), libc = process.report?.getReport().header.glibcVersionRuntime ? 'glibc' : null, onStage = () => {} } = {}) {
  absolutePath(packPath);
  const ancestors = await directories(packPath), manifestPath = join(packPath, 'manifest.json'), ms = await stat(manifestPath);
  if (!ms.isFile() || ms.isSymbolicLink() || ms.nlink !== 1n) fail('model_pack_integrity');
  if (ms.size > 4194304n) fail(INVALID);
  const bytes = await boundedRead(manifestPath, ms, 4194304);
  const approved = parseManifest(bytes, catalog); onStage('manifest');
  const { manifest, manifestHash, descriptor } = approved, tree = await enumerate(packPath);
  const expected = ['manifest.json', ...manifest.files.map(f => f.path)].sort();
  if (!equal(tree.files.map(f => f.path).sort(), expected)) fail('model_pack_integrity');
  const inventory = new Map(manifest.files.map(f => [f.path, f]));
  const records = [];
  for (const f of tree.files) {
    const wanted = inventory.get(f.path) ?? { bytes: bytes.length, sha256: manifestHash };
    if (f.stat.size !== BigInt(wanted.bytes)) fail('model_pack_integrity');
    onStage('hash', f.path);
    const actual = await hashFile(join(packPath, f.path), f.stat, wanted.bytes);
    if (actual.bytes !== wanted.bytes || actual.sha256 !== wanted.sha256) fail('model_pack_integrity');
    records.push({ path: f.path, identity: fileIdentity(f.stat) });
  }
  // Metadata is inspected only after the complete independent inventory/hash pass.
  onStage('metadata');
  const metadata = path => readFile(join(packPath, path)).then(b => strictJSON(b, INVALID));
  const lock = await metadata(manifest.runtime.lockPath), pkg = await metadata('runtime/package.json');
  if (lock.lockfileVersion !== 3 || !lock.packages || !equal(pkg.dependencies, { '@huggingface/transformers': '3.7.6', 'onnxruntime-node': '1.21.0' })) fail(INVALID);
  const roots = Object.keys(lock.packages).filter(k => k !== '').map(k => 'runtime/' + k).sort();
  const actualRoots = tree.files.map(f => f.path).filter(p => /^runtime\/(?:node_modules\/(?:@[^/]+\/)?[^/]+\/)+package\.json$/.test(p)).map(p => p.slice(0, -13)).sort();
  if (!equal(roots, manifest.runtime.packages.map(p => p.root)) || !equal(actualRoots, roots)) fail(INVALID);
  for (const p of manifest.runtime.packages) {
    const installed = await metadata(p.root + '/package.json'), locked = lock.packages[p.root.slice(8)];
    if (installed.name !== p.name || installed.version !== p.version || locked.version !== p.version || installed.license !== p.license || locked.link) fail(INVALID);
  }
  onStage('native-selection');
  // Release catalog freezes the supported Node versions; no ambient semver resolver.
  if (!descriptor.nodeVersions?.includes(nodeVersion)) fail('model_runtime_unavailable');
  const target = manifest.runtime.nativeTargets.find(t => t.os === platform && t.arch === arch && (t.libc === null || t.libc === libc) && (t.nodeAbi === null || t.nodeAbi === nodeAbi));
  if (!target) fail('model_runtime_unavailable');
  if (target.minOs !== null) {
    const parts = value => typeof value === 'string' && /^[0-9]+(?:\.[0-9]+)*$/.test(value) ? value.split('.').map(Number) : null;
    const current = parts(osVersion), minimum = parts(target.minOs);
    if (!current || !minimum) fail('model_runtime_unavailable');
    for (let i = 0; i < minimum.length; i++) { if ((current[i] ?? 0) < minimum[i]) fail('model_runtime_unavailable'); if ((current[i] ?? 0) > minimum[i]) break; }
  }
  const fence = { manifestHash, directories: [...ancestors.slice(0, -1), ...tree.dirs], files: records.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0), selectedNativeFiles: [...target.files], target };
  // Account for JSON init envelope overhead before spawning any process.
  if (Buffer.byteLength(canonical(fence)) > 8 * 1024 * 1024 - 1024) fail(INVALID);
  await checkFence(packPath, fence);
  return { ...approved, packPath, fence, metadata: { ...IDENTITY, revision: 'sha256:' + manifestHash }, runtimeStatus: 'not-loaded', qualification: qualification(platform, arch) };
}

export async function verifyPack(packPath, options = {}) {
  absolutePath(packPath);
  try { return await inspectPack(packPath, options); }
  catch (error) {
    const allowed = ['model_pack_unavailable', 'model_pack_manifest_invalid', 'model_pack_integrity', 'model_runtime_unavailable'];
    fail(allowed.includes(error?.code) ? error.code : 'model_pack_unavailable');
  }
}
