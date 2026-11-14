import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { deferHostedPauseStatus } from '../hosted-pause.mjs';

// A host may guard every endpoint read (for example to re-check that its tool
// invocation is still current). The pause observer must read such an accessor
// live before each request, whether the accessor is own or inherited.
async function guardedConfig(t, variant) {
  const root = join(createTestWorkspace(t).path, 'state');
  await mkdir(root, { mode: 0o700 });
  const state = { events: [], current: 'http://127.0.0.1:1', stale: false, urls: [] };
  const accessor = { get endpoint() {
    state.events.push('guard');
    if (state.stale) throw new Error('stale_invocation');
    return state.current;
  } };
  const config = variant === 'own'
    ? Object.defineProperties({ root }, Object.getOwnPropertyDescriptors(accessor))
    : Object.assign(Object.create(accessor), { root });
  t.mock.method(globalThis, 'fetch', async url => {
    state.events.push('request'); state.urls.push(String(url));
    return Response.json({ generation: 0, paused: false, enforced: true });
  });
  return { config, state };
}

for (const variant of ['own', 'inherited']) {
  test(`${variant} endpoint accessor is read live before every pause-state request and at publish`, async t => {
    const { config, state } = await guardedConfig(t, variant);
    // Three arguments and no deadline, as an embedding host calls it.
    const observation = deferHostedPauseStatus(config, 'synthetic-token', AbortSignal.timeout(10000));
    const expected = [];
    for (const port of [1, 2, 3]) {
      state.current = `http://127.0.0.1:${port}`;
      expected.push(`${state.current}/api/memory/pause-state`);
      assert.equal((await observation.observe()).paused, false);
    }
    assert.deepEqual(state.urls, expected);
    state.events.forEach((event, index) => {
      if (event === 'request') assert.equal(state.events[index - 1], 'guard');
    });
    const before = state.events.length;
    await observation.publish();
    assert.ok(state.events.slice(before).includes('guard'));
    assert.equal(state.urls.length, 3);
  });

  test(`${variant} endpoint accessor that turns stale stops the next request`, async t => {
    const { config, state } = await guardedConfig(t, variant);
    const observation = deferHostedPauseStatus(config, 'synthetic-token', AbortSignal.timeout(10000));
    await observation.observe();
    state.stale = true;
    await assert.rejects(observation.observe(), /stale_invocation/);
    await observation.publish();
    assert.equal(state.urls.length, 1);
  });
}
