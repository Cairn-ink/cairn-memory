import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { removeCoreDeadlineProvenance } from '../testing/reliability-smoke-deadline-mutation.mjs';

const source = readFileSync(new URL('../../../core/model-call.mjs', import.meta.url), 'utf8');
const fence = 'assertContentPort({invoke:()=>controller.abort()});';

test('deadline mutation removes one real registration and preserves every fence', () => {
  const changed = removeCoreDeadlineProvenance(source);
  assert.equal(source.split('coreDeadlineSignals.add(controller.signal);').length
    - changed.split('coreDeadlineSignals.add(controller.signal);').length, 1);
  assert.equal(changed.split(fence).length, source.split(fence).length);
  assert.throws(() => removeCoreDeadlineProvenance(source + source),
    { code: 'ERR_ASSERTION', message: /one real fenced core timer provenance registration/ });
});

test('a copy without the timer fence fails the real load-hook assertion', t => {
  const root = mkdtempSync(join(tmpdir(), 'synthetic-deadline-hook-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'core'));
  const filename = join(root, 'core', 'model-call.mjs');
  writeFileSync(filename, source.replaceAll(fence, 'controller.abort();'));
  const mutation = new URL('../testing/reliability-smoke-deadline-mutation.mjs', import.meta.url).href;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import { registerHooks } from 'node:module';
    import { coreDeadlineProvenanceLoadHook } from ${JSON.stringify(mutation)};
    registerHooks(coreDeadlineProvenanceLoadHook());
    await import(process.argv[1]);
  `, pathToFileURL(filename).href], { encoding: 'utf8', env: {} });
  assert.equal(child.error, undefined);
  assert.equal(child.status, 1);
  assert.match(child.stderr, /ERR_ASSERTION/);
  assert.match(child.stderr, /one real fenced core timer provenance registration/);
  assert.doesNotMatch(child.stderr, /ERR_MODULE_NOT_FOUND/);
});
