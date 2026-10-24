import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, readFile, rename, mkdir, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fixture } from './fixtures/pack.mjs';
import { verifyPack, checkFence } from '../pack.mjs';
import { productionBundle, runtimeEntry, tinyRuntime } from './fixtures/production-bundle.mjs';

for (const stage of ['before-import', 'before-load', 'runtime-imported', 'model-load', 'after-warm-up', 'after-inference', 'parent-acceptance', 'parent-settlement']) {
  for (const artifact of [runtimeEntry, 'runtime/node_modules/onnxruntime-node/fixture.node', 'model/tokenizer.json', 'model/onnx/model.onnx', 'model/onnx/model.onnx_data', 'directory']) {
    test('L03 production child fence checkpoints: ' + stage + ' / ' + artifact, async t => {
      const f = await fixture(t, { extra: { [runtimeEntry]: tinyRuntime } }), pack = await verifyPack(f.root, { catalog: f.catalog });
      let replaced = false, parentChecks = 0;
      const replace = async () => {
        assert.equal(replaced, false); replaced = true;
        if (artifact === 'directory') {
          const old = join(f.parent, 'model-old'); await rename(join(f.root, 'model'), old); await mkdir(join(f.root, 'model'));
          for (const name of await readdir(old)) await rename(join(old, name), join(f.root, 'model', name));
        }
        else { const path = join(f.root, artifact), bytes = await readFile(path); await writeFile(path + '.new', bytes); await rename(path + '.new', path); }
      };
      const parentStage = stage.startsWith('parent-');
      const harness = await productionBundle(t, pack, {
        atStage: async observed => { if (observed === stage) await replace(); },
        fence: async () => { if (parentStage && ++parentChecks === (stage === 'parent-acceptance' ? 3 : 4)) await replace(); return checkFence(f.root, pack.fence); } });
      if (stage === 'after-inference' || parentStage) {
        const b = await harness.operation;
        await assert.rejects(b.embed(['fixture inference']), { code: 'model_pack_integrity' });
        assert.deepEqual(b.localStatus(), { state: 'unavailable', reason: 'model_pack_integrity' });
        await assert.rejects(b.embed(['late']), { code: 'provider_error' });
      } else await assert.rejects(harness.operation, { code: 'model_pack_integrity' });
      assert.equal(replaced, true); harness.assertClean();
      const events = await harness.events(), stages = events.filter(event => event.stage).map(event => event.stage);
      if (!parentStage) assert.equal(stages.at(-1), stage === 'model-load' ? 'after-warm-up' : stage, 'the first required subsequent fence must suppress readiness/results');
      assert.equal(harness.frames.filter(frame => frame.op === 'ready').length, stage === 'after-inference' || parentStage ? 1 : 0);
      assert.equal(harness.frames.filter(frame => frame.op === 'result').length, parentStage ? 1 : 0);
      if (!parentStage) assert.deepEqual(harness.frames.filter(frame => frame.op === 'fatal').map(frame => frame.code), ['model_pack_integrity']);
      if (stage === 'before-import') assert.equal(events.some(event => event.guardCreated || event.runtimeImport), false);
      if (stage === 'before-load') assert.equal(events.some(event => event.runtimeImport), false);
    });
  }
}
