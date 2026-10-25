import { mkdir, open, lstat, mkdtemp, readFile, rm } from 'node:fs/promises';
import { dirname, basename, join } from 'node:path';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { createGunzip } from 'node:zlib';
import { pipeline, finished } from 'node:stream/promises';
import { RELEASE_CATALOG } from './catalog.mjs';
import { absolutePath, fail, canonical, HASH, MODEL, refusal, relativePath } from './common.mjs';
import { publisherArtifact, publishPackNoReplace } from './publish.mjs';
import { parseManifest, verifyPack } from './pack.mjs';

const directoryId = s => canonical({ dev: String(s.dev), ino: String(s.ino) });
async function absent(path) { try { await lstat(path); return false; } catch (e) { if (e.code === 'ENOENT') return true; fail('model_pack_unavailable'); } }
async function parentFence(path) {
  let current = path; const fence = [];
  for (;;) {
    const s = await lstat(current, { bigint: true }); if (!s.isDirectory() || s.isSymbolicLink()) fail('model_pack_integrity');
    fence.push([current, directoryId(s)]); if (dirname(current) === current) return fence; current = dirname(current);
  }
}
async function assertParent(fence) {
  for (const [path, identity] of fence) {
    const s = await lstat(path, { bigint: true }); if (!s.isDirectory() || directoryId(s) !== identity) fail('model_pack_conflict');
  }
}
function approvedDownload(d, manifest) {
  const url = new URL(d.url);
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || !HASH.test(d.sha256) || !Number.isSafeInteger(d.bytes) || d.bytes < 0 || !Number.isSafeInteger(d.maxExpandedBytes) || d.maxExpandedBytes < 0 || !['file', 'tar', 'tar.gz'].includes(d.format)) fail('model_pack_manifest_invalid');
  if (!Array.isArray(d.files) || !d.files.length || new Set(d.files).size !== d.files.length) fail('model_pack_manifest_invalid');
  for (const file of d.files) { relativePath(file); if (!manifest.files.some(f => f.path === file)) fail('model_pack_manifest_invalid'); }
  if (d.format === 'file' && d.files.length !== 1) fail('model_pack_manifest_invalid');
  return url;
}
async function bounded(promise, ms, signal, clock) {
  let timer, abort;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      abort = () => reject(refusal('model_pack_download_failed')); signal.addEventListener('abort', abort, { once: true });
      timer = clock.setTimer(abort, ms); if (signal.aborted) abort();
    })]);
  } finally { clock.clearTimer(timer); signal.removeEventListener('abort', abort); }
}
async function transfer(d, path, source, signal, clock) {
  const controller = new AbortController();
  const abort = () => controller.abort(); signal?.addEventListener('abort', abort, { once: true });
  const total = clock.setTimer(abort, 1800000); if (signal?.aborted) abort();
  let handle, iterator;
  try {
    const response = await bounded(Promise.resolve().then(() => source(d.url, { redirect: 'error', signal: controller.signal })), 120000, controller.signal, clock);
    if (!response || response.status !== 200 || response.redirected || response.url && response.url !== d.url || !response.body?.[Symbol.asyncIterator]) fail('model_pack_download_failed');
    handle = await open(path, 'wx', 0o600); iterator = response.body[Symbol.asyncIterator]();
    const hash = createHash('sha256'); let bytes = 0;
    for (;;) {
      const step = await bounded(iterator.next(), 120000, controller.signal, clock); if (step.done) break;
      if (!(step.value instanceof Uint8Array)) fail('model_pack_download_failed');
      bytes += step.value.length; if (bytes > d.bytes) fail('model_pack_download_failed');
      hash.update(step.value); await handle.writeFile(step.value);
    }
    if (bytes !== d.bytes || hash.digest('hex') !== d.sha256) fail('model_pack_integrity');
    await handle.sync();
  } catch (e) { if (e.code?.startsWith('model_')) throw e; fail('model_pack_download_failed'); }
  finally { controller.abort(); clock.clearTimer(total); signal?.removeEventListener('abort', abort); iterator?.return?.().catch(() => {}); await handle?.close(); }
}
async function writeArtifact(root, path, chunks, expected) {
  await mkdir(dirname(join(root, path)), { recursive: true, mode: 0o700 });
  const h = await open(join(root, path), 'wx', publisherArtifact(path, expected.role) ? 0o700 : 0o600), hash = createHash('sha256'); let bytes = 0;
  try {
    for await (const chunk of chunks) { bytes += chunk.length; if (bytes > expected.bytes) fail('model_pack_integrity'); hash.update(chunk); await h.writeFile(chunk); }
    if (bytes !== expected.bytes || hash.digest('hex') !== expected.sha256) fail('model_pack_integrity'); await h.sync();
  } finally { await h.close(); }
}
// Minimal closed tar reader: ordinary regular-file headers only. No links,
// devices, PAX, GNU path extensions, absolute paths or metadata side effects.
async function extract(d, archive, root, manifest, readArchive) {
  const inventory = new Map(manifest.files.map(f => [f.path, f]));
  if (d.format === 'file') return writeArtifact(root, d.files[0], readArchive(archive), inventory.get(d.files[0]));
  const source = readArchive(archive), stream = d.format === 'tar.gz' ? createGunzip() : source;
  const pumping = stream === source ? null : pipeline(source, stream);
  // Extraction can reject while the pipeline is still reading. Observe its
  // rejection immediately, then await full source closure in the finalizer.
  pumping?.catch(() => {});
  let buffer = Buffer.alloc(0), expanded = 0, ended = false, current, padding = 0, handle, hash, count = 0;
  const seen = new Set();
  try {
    for await (const chunk of stream) {
      expanded += chunk.length; if (expanded > d.maxExpandedBytes) fail('model_pack_integrity');
      buffer = Buffer.concat([buffer, chunk]);
      for (;;) {
        if (current) {
          const n = Math.min(current.remaining, buffer.length); if (!n) break;
          const bytes = buffer.subarray(0, n); hash.update(bytes); await handle.writeFile(bytes); count += n; current.remaining -= n; buffer = buffer.subarray(n);
          if (current.remaining) break;
          await handle.sync(); await handle.close(); handle = null;
          if (count !== current.expected.bytes || hash.digest('hex') !== current.expected.sha256) fail('model_pack_integrity'); current = null;
        }
        if (padding) { const n = Math.min(padding, buffer.length); if (buffer.subarray(0, n).some(Boolean)) fail('model_pack_integrity'); buffer = buffer.subarray(n); padding -= n; if (padding) break; }
        if (buffer.length < 512) break;
        const header = buffer.subarray(0, 512); buffer = buffer.subarray(512);
        if (!header.some(Boolean)) { ended = true; continue; }
        if (ended) fail('model_pack_integrity');
        const field = (a, b) => header.subarray(a, b).toString('utf8').replace(/\0.*$/s, '');
        const name = field(0, 100), sizeText = field(124, 136).trim(), checksum = field(148, 156).trim();
        try { relativePath(name); } catch { fail('model_pack_integrity'); }
        const sum = header.reduce((total, v, i) => total + (i >= 148 && i < 156 ? 32 : v), 0);
        if (!/^[0-7]+$/.test(sizeText) || !/^[0-7]+$/.test(checksum) || sum !== parseInt(checksum, 8) || ![0, 48].includes(header[156]) || field(345, 500) || !d.files.includes(name) || seen.has(name)) fail('model_pack_integrity');
        seen.add(name); const bytes = parseInt(sizeText, 8), expected = inventory.get(name);
        if (!Number.isSafeInteger(bytes) || bytes !== expected.bytes) fail('model_pack_integrity');
        if (bytes === 0) { await writeArtifact(root, name, [], expected); continue; }
        await mkdir(dirname(join(root, name)), { recursive: true, mode: 0o700 }); handle = await open(join(root, name), 'wx', publisherArtifact(name, expected.role) ? 0o700 : 0o600);
        current = { remaining: bytes, expected }; padding = (512 - bytes % 512) % 512; hash = createHash('sha256'); count = 0;
      }
    }
    if (current || padding || buffer.some(Boolean) || !ended || canonical([...seen].sort()) !== canonical([...d.files].sort())) fail('model_pack_integrity');
  } finally {
    source.destroy(); stream.destroy();
    await Promise.allSettled([finished(source, { cleanup: true }), ...(pumping ? [pumping] : [])]);
    await handle?.close();
  }
}
async function confirmLicense(stage, manifest) {
  const row = manifest.licenses.find(l => l.component === MODEL.repository);
  const card = await readFile(join(stage, 'provenance/model-card.md'), 'utf8');
  const license = await readFile(join(stage, 'provenance/model-license.txt'), 'utf8');
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(card)?.[1];
  const declarations = frontmatter?.split(/\r?\n/).filter(line => /^license\s*:/.test(line)) ?? [];
  if (row.spdx !== 'MIT' || declarations.length !== 1 || !/^license\s*:\s*mit\s*$/i.test(declarations[0]) ||
      !license.includes('Permission is hereby granted, free of charge') ||
      !license.includes('THE SOFTWARE IS PROVIDED "AS IS"')) fail('model_pack_license');
}
export async function installPack(packPath, { catalog = RELEASE_CATALOG, source = globalThis.fetch, signal, beforePublish = () => {}, publishNoReplace = publishPackNoReplace, transferClock = { setTimer: setTimeout, clearTimer: clearTimeout }, readArchive = createReadStream, ...verification } = {}) {
  absolutePath(packPath);
  const descriptor = catalog.find(d => d.packId === 'bge-m3'); if (!descriptor?.manifestBytes || !descriptor.downloads?.length) fail('model_pack_manifest_invalid');
  const { manifest, manifestHash } = parseManifest(Buffer.from(descriptor.manifestBytes), catalog);
  const files = descriptor.downloads.flatMap(d => { approvedDownload(d, manifest); return d.files; }).sort();
  if (canonical(files) !== canonical(manifest.files.map(f => f.path))) fail('model_pack_manifest_invalid');
  if (!await absent(packPath)) {
    try { const result = await verifyPack(packPath, { catalog, ...verification }); if (result.manifestHash === manifestHash) return result; } catch { /* Existing destinations are never repaired. */ }
    fail('model_pack_conflict');
  }
  let stage, stageId, parent, publishedId;
  try {
    parent = await parentFence(dirname(packPath));
    const parentStat = await lstat(dirname(packPath));
    if (process.getuid && (parentStat.uid !== process.getuid() || (parentStat.mode & 0o022) !== 0)) fail('model_pack_unavailable');
    stage = await mkdtemp(join(dirname(packPath), '.' + basename(packPath) + '.cairn-stage-'));
    stageId = directoryId(await lstat(stage, { bigint: true }));
    await assertParent(parent);
    for (let i = 0; i < descriptor.downloads.length; i++) {
      if (signal?.aborted) fail('model_pack_download_failed');
      const d = descriptor.downloads[i], archive = join(stage, '.download-' + i);
      await transfer(d, archive, source, signal, transferClock); await extract(d, archive, stage, manifest, readArchive); await rm(archive);
    }
    await confirmLicense(stage, manifest);
    const h = await open(join(stage, 'manifest.json'), 'wx', 0o600); try { await h.writeFile(descriptor.manifestBytes); await h.sync(); } finally { await h.close(); }
    const verified = await verifyPack(stage, { catalog, ...verification });
    await beforePublish(stage); await assertParent(parent);
    if (!await absent(packPath)) fail('model_pack_conflict');
    if (directoryId(await lstat(stage, { bigint: true })) !== stageId) fail('model_pack_integrity');
    // Publication uses a verified release-owned no-replace primitive. Plain
    // fs.rename is never a production fallback for directory publication.
    try { await publishNoReplace(stage, packPath, verified); }
    catch (e) { if (directoryId(await lstat(packPath, { bigint: true }).catch(() => ({}))) === stageId) publishedId = stageId; throw e; }
    publishedId = stageId; stage = null;
    const result = await verifyPack(packPath, { catalog, ...verification });
    publishedId = null; return result;
  } catch (e) { if (e.code?.startsWith('model_')) throw e; fail('model_pack_unavailable'); }
  finally {
    if (publishedId && directoryId(await lstat(packPath, { bigint: true }).catch(() => ({}))) === publishedId) await rm(packPath, { recursive: true, force: true });
    if (stage && directoryId(await lstat(stage, { bigint: true }).catch(() => ({}))) === stageId) await rm(stage, { recursive: true, force: true });
  }
}
