import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fixture } from './fixtures/pack.mjs';
import { verifyPack } from '../pack.mjs';
import { productionBundle, runtimeEntry, tinyRuntime } from './fixtures/production-bundle.mjs';

const canary = 'globalThis.fixtureEvent({canary:true});';
const locations = ['ancestor-node-modules', 'global-search-path', 'native-search-path', 'local-build', 'wasm', 'sibling-target'];
for (const pkg of ['sharp', 'onnxruntime-node']) for (const location of locations) {
  const apis = ['esm', 'cjs', ...(['native-search-path', 'local-build', 'sibling-target'].includes(location) ? ['native'] : [])];
  for (const api of apis) test('L05 native-fallback canary matrix is incomplete: ' + pkg + ' / ' + location + ' / ' + api, async t => {
    const root = 'runtime/node_modules/' + pkg;
    const fallback = location === 'ancestor-node-modules' ? 'cairn-fallback-canary' :
      location === 'global-search-path' ? '../../../../global-node/node_modules/cairn-fallback-canary/index.cjs' :
      location === 'native-search-path' ? '../../../../native-search/canary.node' :
      location === 'local-build' ? './build/Release/binding.node' :
      location === 'wasm' ? './fallback.wasm' : './targets/other-platform/binding.node';
    // The loader's synthetic global search root is explicit. No real
    // NODE_PATH, home directory or system-wide module installation is read.
    const expression = location === 'global-search-path' ? "require('node:path').resolve(__dirname,'../../../../global-node/node_modules/cairn-fallback-canary/index.cjs')" : JSON.stringify(fallback);
    let attempt;
    if (api === 'native') attempt = `process.dlopen({exports:{}},require('node:path').resolve(__dirname,${expression}));`;
    else if (api === 'cjs') attempt = `require(${expression});`;
    else if (location === 'global-search-path') attempt = `await import(require('node:url').pathToFileURL(${expression}).href);`;
    else attempt = `await import(${JSON.stringify(fallback)});`;
    const selected = `${root}/fixture.node`;
    const loader = `${root}/fallback-loader.cjs`;
    const source = `module.exports=(async()=>{
      try{require('./fixture.node')}catch(error){globalThis.fixtureEvent({selectedFailure:error.code})}
      try{${attempt}}catch(error){globalThis.fixtureEvent({fallbackFailure:error.code})}
    })();`;
    const extra = { [loader]: source,
      [runtimeEntry]: `await (await import(${JSON.stringify('../../../' + pkg + '/fallback-loader.cjs')})).default;\n${tinyRuntime}` };
    let internal;
    if (location === 'local-build') internal = root + '/build/Release/binding.node';
    if (location === 'wasm') internal = root + '/fallback.wasm';
    if (location === 'sibling-target') internal = root + '/targets/other-platform/binding.node';
    if (internal) extra[internal] = canary;
    const f = await fixture(t, { extra });
    // Files inside the pack are declared and hashed but never selected as
    // native bindings; ancestor/global candidates stay outside the pack.
    if (internal?.endsWith('.node')) {
      f.contents.get(internal).role = 'native'; f.manifest.files.find(row => row.path === internal).role = 'native';
      f.catalog.splice(0, 1, ...(await f.publish()));
    }
    let target;
    if (location === 'ancestor-node-modules') target = join(f.parent, 'node_modules/cairn-fallback-canary/index.cjs');
    if (location === 'global-search-path') target = join(f.parent, 'global-node/node_modules/cairn-fallback-canary/index.cjs');
    if (location === 'native-search-path') target = join(f.parent, 'native-search/canary.node');
    if (target) {
      await mkdir(dirname(target), { recursive: true }); await writeFile(target, canary);
      if (target.endsWith('/index.cjs')) await writeFile(join(dirname(target), 'package.json'), JSON.stringify({ name: 'cairn-fallback-canary', main: 'index.cjs' }));
    }
    const pack = await verifyPack(f.root, { catalog: f.catalog });
    const harness = await productionBundle(t, pack);
    await assert.rejects(harness.operation, error => {
      assert.equal(error.code, 'model_runtime_unavailable'); assert.equal(error.message, 'model_runtime_unavailable');
      assert.equal(JSON.stringify(error).includes(f.parent), false); return true;
    });
    harness.assertClean();
    const events = await harness.events();
    assert.deepEqual(events.filter(event => event.nativeLoad).map(event => event.nativeLoad), [join(f.root, selected)], 'no fallback may reach the native loader');
    assert.equal(events.some(event => event.selectedFailure === 'model_runtime_unavailable'), true);
    assert.equal(events.some(event => event.fallbackFailure === 'model_runtime_unavailable'), true, JSON.stringify(events));
    assert.equal(events.some(event => event.canary), false);
    assert.equal(events.some(event => event.latch === 'model_runtime_unavailable' && event.repeated === 'model_runtime_unavailable'), true);
    assert.equal(events.some(event => event.stage === 'model-load' || event.stage === 'warm-up' || event.stage === 'inference'), false);
    assert.deepEqual(harness.frames.map(frame => frame.op), ['fatal']);
    assert.equal(harness.frames[0].code, 'model_runtime_unavailable');
    assert.equal(events.some(event => event.resolution?.includes(location === 'native-search-path' ? 'native-search' : location === 'local-build' ? 'build/Release' : location === 'wasm' ? 'fallback.wasm' : location === 'sibling-target' ? 'other-platform' : 'cairn-fallback-canary')), true);
  });
}
