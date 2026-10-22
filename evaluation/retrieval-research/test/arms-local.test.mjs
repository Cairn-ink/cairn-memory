import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { createLocalEmbedder } from '../lib/embed-local.mjs';

for (const stage of ['directory inspection', 'cache creation']) {
  test(`local model is disposed when post-load ${stage} fails`, async t => {
    const workspace = createTestWorkspace(t, { prefix: 'hr1-local-init-' });
    let loaded = false, disposals = 0;
    const failure = new Error('synthetic initialization failure');
    const dependencies = {
      async loadTransformers() {
        return {
          AutoTokenizer: { async from_pretrained() { return () => {}; } },
          AutoModel: { async from_pretrained() {
            loaded = true;
            return { async dispose() { disposals++; } };
          } },
        };
      },
      async measureDirectoryBytes() {
        assert.equal(loaded, true);
        if (stage === 'directory inspection') throw failure;
        return 123;
      },
      async makeDirectory() {
        assert.equal(loaded, true);
        throw failure;
      },
    };
    await assert.rejects(createLocalEmbedder({ model: 'e5-small', cacheDir: join(workspace.path, 'cache') }, dependencies),
      error => error === failure);
    assert.equal(disposals, 1);
  });
}

test('successful local initialization transfers model disposal to the returned embedder', async t => {
  const workspace = createTestWorkspace(t, { prefix: 'hr1-local-owner-' });
  let disposals = 0;
  const embedder = await createLocalEmbedder({ model: 'e5-small', cacheDir: workspace.path }, {
    async loadTransformers() {
      return {
        AutoTokenizer: { async from_pretrained() { return () => {}; } },
        AutoModel: { async from_pretrained() { return { async dispose() { disposals++; } }; } },
      };
    },
    async measureDirectoryBytes() { return 123; },
    async makeDirectory() {},
  });
  assert.equal(disposals, 0);
  await embedder.close();
  assert.equal(disposals, 1);
});
