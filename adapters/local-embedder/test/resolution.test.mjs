import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { fixture } from './fixtures/pack.mjs';
import { verifyPack } from '../pack.mjs';
import { resolutionGuard } from '../runtime.mjs';
test('L05 ESM and CommonJS ancestor/sibling/WASM/native fallback cannot execute a canary, even when caught', async t => {
  for (const mode of ['esm', 'cjs', 'wasm', 'binding']) {
    const target = mode === 'esm' ? 'outside.mjs' : 'outside.cjs';
    const source = mode === 'esm' ? `await import('../../../../${target}').catch(()=>{});export const caught=true;` : mode === 'binding' ? "try{require('./fixture.node')}catch{};try{require('./fallback.cjs')}catch{};" : mode === 'wasm' ? "try{require('./fallback.wasm')}catch{};" : `try{require('../../../../${target}')}catch{};`;
    const entry = 'runtime/node_modules/sharp/guard-' + mode + (mode === 'esm' ? '.mjs' : '.cjs');
    const f = await fixture(t, { extra: { [entry]: source, 'runtime/node_modules/sharp/fallback.cjs': 'globalThis.__cairnCanary=true;', 'runtime/node_modules/sharp/fallback.wasm': 'globalThis.__cairnCanary=true;' } });
    await writeFile(join(f.root, target), 'globalThis.__cairnCanary=true;');
    // Canary is deliberately outside the verified inventory, as if in an
    // ancestor/global/sibling install. Verify first, then place it outside root.
    const outside = join(f.parent, target); await writeFile(outside, 'globalThis.__cairnCanary=true;');
    await unlink(join(f.root, target));
    const pack = await verifyPack(f.root, { catalog: f.catalog }), attempts = [];
    const guard = resolutionGuard(pack, { attempt: (...args) => attempts.push(args) });
    try { await import(pathToFileURL(join(f.root, entry)).href); assert.throws(() => guard.assert(), { code: 'model_runtime_unavailable' }); }
    finally { guard.close(); }
    assert.notEqual(globalThis.__cairnCanary, true); assert.ok(attempts.length > 0);
  }
});
