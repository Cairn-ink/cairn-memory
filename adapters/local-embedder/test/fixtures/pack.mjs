import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { canonical, MODEL, sha256 } from '../../common.mjs';
export async function fixture(t, { salt = '', extra = {}, platform = process.platform, arch = process.arch } = {}) {
  const parent = await mkdtemp(join(tmpdir(), 'cairn-bge-fixture-'));
  t?.after(() => rm(parent, { recursive: true, force: true }));
  const root = join(parent, 'pack'), contents = new Map();
  const packages = [
    { name: '@huggingface/transformers', version: '3.7.6', license: 'Apache-2.0' },
    { name: '@img/sharp-libvips-fixture', version: '1.2.4', license: 'LGPL-3.0-or-later' },
    { name: 'onnxruntime-node', version: '1.21.0', license: 'MIT' },
    { name: 'sharp', version: '0.34.5', license: 'Apache-2.0' }
  ].map(p => ({ ...p, root: 'runtime/node_modules/' + p.name })).sort((a, b) => a.root < b.root ? -1 : 1);
  const add = (path, value, role) => contents.set(path, { bytes: Buffer.from(typeof value === 'string' ? value : canonical(value)), role });
  const dependencies = { '@huggingface/transformers': '3.7.6', 'onnxruntime-node': '1.21.0' };
  add('runtime/package.json', { dependencies }, 'runtime');
  add('runtime/package-lock.json', { lockfileVersion: 3, packages: Object.fromEntries([['', { dependencies }], ...packages.map(p => [p.root.slice(8), { version: p.version, license: p.license }])]) }, 'runtime');
  for (const p of packages) add(p.root + '/package.json', { name: p.name, version: p.version, license: p.license }, 'runtime');
  for (const path of ['model/config.json', 'model/tokenizer.json', 'model/tokenizer_config.json']) add(path, { fixture: true, salt }, path.includes('tokenizer') ? 'tokenizer' : 'model');
  add('model/onnx/model.onnx', 'fake graph ' + salt, 'model'); add('model/onnx/model.onnx_data', 'fake external tensor ' + salt, 'model');
  add('provenance/model-card.md', '---\nlicense: mit\n---\nTiny fixture; Xenova conversion and tokenizer attribution.\n', 'provenance');
  add('provenance/model-license.txt', 'MIT License\nTiny fixture only. Permission is hereby granted, free of charge.\nTHE SOFTWARE IS PROVIDED \"AS IS\"\n', 'provenance');
  add('licenses/THIRD_PARTY_NOTICES.md', 'Apache-2.0 Transformers.js and Sharp; MIT ORT; LGPL-3.0-or-later libvips.\n', 'license');
  add('licenses/libvips-source-offer.txt', 'Fixture corresponding source offer.\n', 'license');
  add('runtime/node_modules/onnxruntime-node/fixture.node', 'not a real binary ' + salt, 'native');
  add('runtime/node_modules/sharp/fixture.node', 'not a real binary ' + salt, 'native');
  for (const [path, value] of Object.entries(extra)) add(path, value, 'runtime');
  const licenses = [...packages.map(p => ({ component: p.name, version: p.version, spdx: p.license, source: 'https://example.invalid/reviewed/' + p.name, revision: null,
    evidencePaths: [p.root + '/package.json'], noticePaths: ['licenses/THIRD_PARTY_NOTICES.md'], sourceOfferPaths: p.license.includes('LGPL') ? ['licenses/libvips-source-offer.txt'] : [] })),
  { component: MODEL.repository, version: MODEL.revision, spdx: 'MIT', source: 'https://example.invalid/reviewed/model', revision: MODEL.revision,
    evidencePaths: ['provenance/model-card.md', 'provenance/model-license.txt'], noticePaths: ['licenses/THIRD_PARTY_NOTICES.md'], sourceOfferPaths: [] }].sort((a, b) => a.component + '\0' + a.version < b.component + '\0' + b.version ? -1 : 1);
  const files = [...contents].map(([path, f]) => ({ path, bytes: f.bytes.length, sha256: sha256(f.bytes), role: f.role })).sort((a, b) => a.path < b.path ? -1 : 1);
  const manifest = { format: 'cairn-model-pack-v1', packId: 'bge-m3', packVersion: 'fixture-1', protocolVersion: 'cairn-local-embed-v1', model: { ...MODEL }, runtime: {
    nodeRange: '22.16.0 || 24.15.0', transformersVersion: '3.7.6', ortVersion: '1.21.0', device: 'cpu', interOpThreads: 1, executionMode: 'sequential', lockPath: 'runtime/package-lock.json', packages,
    nativeTargets: [{ os: platform, arch, libc: null, minOs: null, nodeAbi: null, entry: 'runtime/node_modules/onnxruntime-node/fixture.node', files: ['runtime/node_modules/onnxruntime-node/fixture.node', 'runtime/node_modules/sharp/fixture.node'] }] }, licenses, files };
  async function publish() {
    await mkdir(root, { recursive: true, mode: 0o700 });
    for (const [path, f] of contents) { await mkdir(dirname(join(root, path)), { recursive: true }); await writeFile(join(root, path), f.bytes); }
    const manifestBytes = canonical(manifest), manifestHash = sha256(manifestBytes);
    await writeFile(join(root, 'manifest.json'), manifestBytes);
    const descriptor = { packId: 'bge-m3', packVersion: manifest.packVersion, manifestHash, manifestBytes, nodeVersions: ['22.16.0', '24.15.0'], downloads: files.map((f, i) => ({ url: 'https://example.invalid/pinned/' + MODEL.revision + '/' + i, sha256: f.sha256, bytes: f.bytes, format: 'file', files: [f.path], maxExpandedBytes: f.bytes })) };
    return [descriptor];
  }
  const catalog = await publish();
  const source = async url => {
    const d = catalog[0].downloads.find(d => d.url === url); if (!d) throw new Error('unexpected artifact');
    const bytes = contents.get(d.files[0]).bytes;
    return { status: 200, url, redirected: false, body: (async function* () { for (let i = 0; i < bytes.length; i += 7) yield bytes.subarray(i, i + 7); })() };
  };
  return { root, parent, contents, manifest, catalog, source, publish, read: path => readFile(join(root, path)) };
}
