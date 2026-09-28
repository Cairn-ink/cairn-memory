// Offline self-test: a handler failure reaches the client only as
// `{ error: 'harness_error' }`, while the local record keeps its message.
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { createTestWorkspace } from '../../../../../tools/testing/workspace.mjs';
import { createRecordingServer } from '../lib/core-http.mjs';

const TOKEN = 'f0-synthetic-token';

async function serve(t, handle) {
  const workspace = createTestWorkspace(t, { prefix: 'f0-core-http-' });
  mkdirSync(join(workspace.path, 'logs'));
  const server = createRecordingServer({ root: workspace.path, config: { step: 'selftest', token: TOKEN }, handle });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  workspace.defer(() => new Promise(resolve => server.close(resolve)));
  const post = async (body, token = TOKEN) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/memory/capture`, { method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body });
    return { status: response.status, text: await response.text() };
  };
  const records = () => readFileSync(join(workspace.path, 'logs', 'bodies.jsonl'), 'utf8').trim().split('\n')
    .map(line => JSON.parse(line));
  return { post, records };
}

test('a throwing handler gives a 500 without detail, and the local record keeps the message only', async t => {
  const failure = new Error('synthetic handler failure');
  const { post, records } = await serve(t, async () => { throw failure; });
  const reply = await post('{"messages":[]}');
  assert.equal(reply.status, 500);
  assert.deepEqual(JSON.parse(reply.text), { error: 'harness_error' });
  assert.equal(reply.text.includes('synthetic handler failure'), false);
  const [record] = records();
  assert.deepEqual(record.reply, { error: 'harness_error' });
  assert.deepEqual(record.failure, { message: 'synthetic handler failure' });
  assert.equal(JSON.stringify(record).includes(failure.stack.split('\n')[1].trim()), false, 'no stack frame recorded');
});

test('malformed JSON is a detail-free 500; unauthorized stays 401; a normal handler is unchanged', async t => {
  const { post, records } = await serve(t, async () => [200, { duplicate: false, memoryCount: 1 }]);
  const malformed = await post('{not json');
  assert.deepEqual([malformed.status, JSON.parse(malformed.text)], [500, { error: 'harness_error' }]);
  const unauthorized = await post('{}', 'wrong-token');
  assert.deepEqual([unauthorized.status, JSON.parse(unauthorized.text)], [401, { error: 'unauthorized' }]);
  const ok = await post('{"messages":[]}');
  assert.deepEqual([ok.status, JSON.parse(ok.text)], [200, { duplicate: false, memoryCount: 1 }]);
  const [bad, denied, good] = records();
  assert.match(bad.failure.message, /JSON/);
  assert.equal(denied.failure, undefined);
  assert.equal(good.failure, undefined);
});
