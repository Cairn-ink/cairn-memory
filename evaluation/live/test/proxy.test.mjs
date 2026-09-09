import assert from 'node:assert/strict';
import test from 'node:test';
import { startExperimentProxy } from '../proxy.mjs';
import { setImmediate } from 'node:timers/promises';

test('loopback proxy requires capability, rejects routes, forwards only fixed provider paths', async () => {
  const seen = [];
  const proxy = await startExperimentProxy({ session: { request: async (path, body, options) => {
    seen.push({ path, body, signal: options.signal });
    return Response.json({ marker: 'synthetic' });
  } } });
  const send = (path, auth) => fetch(proxy.url + path, { method: 'POST',
    headers: { 'content-type': 'application/json', authorization: auth }, body: '{"safe":true}' });
  try {
    assert.equal((await send('/v1/chat/completions', 'Bearer wrong')).status, 401);
    assert.equal((await send('/v1/files', `Bearer ${proxy.token}`)).status, 400);
    const result = await send('/v1/chat/completions', `Bearer ${proxy.token}`);
    assert.deepEqual(await result.json(), { marker: 'synthetic' });
    assert.equal(seen.length, 1);
    assert.equal(seen[0].path, '/chat/completions');
    assert.equal(seen[0].body, '{"safe":true}');
    assert.ok(seen[0].signal instanceof AbortSignal);
  } finally { await proxy.close(); }
});

test('proxy does not reflect raw transport failures or capability into HTTP errors', async () => {
  const proxy = await startExperimentProxy({ session: { request: async () => { throw new Error('PRIVATE_SECRET'); } } });
  try {
    const result = await fetch(`${proxy.url}/v1/responses`, { method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${proxy.token}` }, body: '{}' });
    assert.equal(result.status, 502);
    assert.equal((await result.text()).includes('PRIVATE_SECRET'), false);
  } finally { await proxy.close(); }
});

test('proxy close aborts and drains active handlers before allowing session shutdown', async () => {
  let release;
  let entered;
  let signal;
  const enteredRequest = new Promise(resolve => { entered = resolve; });
  const pendingRequest = new Promise(resolve => { release = resolve; });
  const proxy = await startExperimentProxy({ session: { request: async (_path, _body, options) => {
    signal = options.signal; entered();
    await pendingRequest;
    throw new Error('synthetic_cancelled');
  } } });
  const request = fetch(`${proxy.url}/v1/responses`, { method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${proxy.token}` }, body: '{}' })
    .catch(() => null);
  await enteredRequest;
  let closed = false;
  const closing = proxy.close();
  assert.equal(proxy.close(), closing);
  void closing.then(() => { closed = true; });
  await setImmediate();
  assert.equal(signal.aborted, true);
  assert.equal(closed, false);
  release();
  await closing;
  await request;
  assert.equal(closed, true);
});
