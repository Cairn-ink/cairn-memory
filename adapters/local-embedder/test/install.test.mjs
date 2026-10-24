import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { access, writeFile, mkdir, readdir, readFile, rename } from 'node:fs/promises';
import { fixture } from './fixtures/pack.mjs';
import { installPack as productionInstall } from '../install.mjs';
// No claim about atomic no-replace semantics: this controlled fixture publisher
// only allows testing transfers, extraction and verification without a release
// native publication primitive. Production intentionally has no such fallback.
const installPack = (path, options) => productionInstall(path, { publishNoReplace: rename, ...options });
import { sha256 } from '../common.mjs';
const absent = async path => assert.rejects(access(path), { code: 'ENOENT' });
test('L04 pinned file source, bounded chunk transfer, offline verification and identical retry', async t => {
  const f = await fixture(t), target = join(f.parent, 'installed'), options = { catalog: f.catalog, source: f.source };
  const p = await installPack(target, options); assert.equal(p.manifestHash, f.catalog[0].manifestHash);
  const again = await installPack(target, { ...options, source: () => { throw Error('must not fetch'); } });
  assert.equal(again.manifestHash, p.manifestHash);
  assert.equal((await readdir(f.parent)).some(p => p.includes('stage-') || p.includes('install-lock')), false);
});
test('L04 transfer short reads, overflow, redirects, abort and crash-before-rename leave final absent', async t => {
  for (const mode of ['short', 'overflow', 'redirect', 'abort', 'publish']) {
    const f = await fixture(t), target = join(f.parent, 'installed'), controller = new AbortController();
    if (mode === 'abort') controller.abort();
    const source = async (url, options) => {
      assert.equal(options.redirect, 'error'); const r = await f.source(url);
      if (mode === 'short') r.body = (async function* () { yield Buffer.from('x'); })();
      if (mode === 'overflow') r.body = (async function* () { yield Buffer.alloc(100000); })();
      if (mode === 'redirect') r.redirected = true;
      return r;
    };
    await assert.rejects(installPack(target, { catalog: f.catalog, source, signal: controller.signal,
      beforePublish: () => { if (mode === 'publish') throw Error('simulated crash'); } }), { code: mode === 'short' ? 'model_pack_integrity' : mode === 'publish' ? 'model_pack_unavailable' : 'model_pack_download_failed' });
    await absent(target); assert.deepEqual((await readdir(f.parent)).filter(p => p !== 'pack'), []);
  }
});
test('L04 destination races and existing conflicting packs are never repaired', async t => {
  const f = await fixture(t), target = join(f.parent, 'installed');
  await assert.rejects(installPack(target, { catalog: f.catalog, source: f.source, beforePublish: async () => { await mkdir(target); await writeFile(join(target, 'sentinel'), 'preserve'); } }), { code: 'model_pack_conflict' });
  assert.equal(await readFile(join(target, 'sentinel'), 'utf8'), 'preserve');
  await assert.rejects(installPack(target, { catalog: f.catalog, source: () => { throw Error('must not fetch'); } }), { code: 'model_pack_conflict' });
});
test('L05 hash-valid missing MIT evidence blocks publication; corrupt evidence fails integrity', async t => {
  for (const validHash of [true, false]) {
    const f = await fixture(t), target = join(f.parent, 'installed'), path = 'provenance/model-card.md';
    f.contents.get(path).bytes = Buffer.from('No reviewed declaration.');
    f.contents.get('provenance/model-license.txt').bytes = Buffer.from('No declaration.');
    if (validHash) {
      for (const file of f.manifest.files) { const b = f.contents.get(file.path).bytes; file.bytes = b.length; file.sha256 = sha256(b); }
      f.catalog.splice(0, 1, ...(await f.publish()));
    }
    await assert.rejects(installPack(target, { catalog: f.catalog, source: f.source }), { code: validHash ? 'model_pack_license' : 'model_pack_integrity' });
    await absent(target);
  }
});
test('L04 injected idle and total transfer clocks fail without network or elapsed-time gates', async t => {
  for (const expiry of [120000, 1800000]) {
    const f = await fixture(t), target = join(f.parent, 'installed'), timers = new Map(); let enter;
    const entered = new Promise(resolve => { enter = resolve; });
    const operation = installPack(target, { catalog: f.catalog, source: () => { enter(); return new Promise(() => {}); },
      transferClock: { setTimer(fn, ms) { timers.set(ms, fn); return ms; }, clearTimer(ms) { timers.delete(ms); } } });
    await entered; timers.get(expiry)(); await assert.rejects(operation, { code: 'model_pack_download_failed' }); await absent(target);
  }
});
function archive(files, mutate = () => {}) {
  const blocks = [];
  for (const [name, bytes] of files) {
    const h = Buffer.alloc(512); h.write(name, 0, 100); h.write('0000600\0', 100); h.write('0000000\0', 108); h.write('0000000\0', 116);
    h.write(bytes.length.toString(8).padStart(11, '0') + '\0', 124); h.write('00000000000\0', 136); h.fill(32, 148, 156); h[156] = 48;
    mutate(h);
    const sum = h.reduce((n, b) => n + b, 0); h.write(sum.toString(8).padStart(6, '0') + '\0 ', 148);
    blocks.push(h, bytes, Buffer.alloc((512 - bytes.length % 512) % 512));
  }
  return Buffer.concat([...blocks, Buffer.alloc(1024)]);
}
test('L04 archive digest, safe extraction and expansion bounds precede publication', async t => {
  for (const mode of ['valid', 'expansion', 'link', 'traversal', 'digest']) {
    const f = await fixture(t), target = join(f.parent, 'installed');
    const bytes = archive([...f.contents].map(([p, f]) => [p, f.bytes]), h => { if (mode === 'link') h[156] = 50; if (mode === 'traversal') { h.fill(0, 0, 100); h.write('../escape', 0); } });
    const d = { url: 'https://example.invalid/pinned/archive', sha256: mode === 'digest' ? '0'.repeat(64) : sha256(bytes), bytes: bytes.length, maxExpandedBytes: mode === 'expansion' ? 512 : bytes.length, files: f.manifest.files.map(f => f.path), format: 'tar' };
    f.catalog[0].downloads = [d];
    const operation = installPack(target, { catalog: f.catalog, source: async url => ({ url, status: 200, body: (async function* () { for (let i = 0; i < bytes.length; i += 193) yield bytes.subarray(i, i + 193); })() }) });
    if (mode === 'valid') assert.equal((await operation).manifestHash, f.catalog[0].manifestHash);
    else { await assert.rejects(operation, { code: 'model_pack_integrity' }); await absent(target); }
  }
});

test('L04 production refuses publication without an atomic no-replace primitive', async t => {
  const f = await fixture(t), target = join(f.parent, 'installed');
  await assert.rejects(productionInstall(target, { catalog: f.catalog, source: f.source }), { code: 'model_pack_unavailable' });
  await absent(target); assert.deepEqual((await readdir(f.parent)).filter(p => p !== 'pack'), []);
});
