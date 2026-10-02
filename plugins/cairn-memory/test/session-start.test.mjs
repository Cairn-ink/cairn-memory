import assert from 'node:assert/strict';
import test from 'node:test';
import { createJsonPoster as sharedPoster } from '../../../integrations/client/transport-hosted.mjs';
import { createJsonPoster as pluginPoster } from '../lib/http.mjs';
import { parseSessionStartRequest, conforms } from '../lib/hosted-contract.mjs';
import { sessionContext } from './hosted-fixtures.mjs';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { readControlState, setPaused, startIfActive } from '../../../integrations/client/control-state.mjs';

const path = '/api/memory/session-start';
const session_id = 'synthetic-host-conversation';
const rejection = { error: 'Invalid session-start payload.', issues: [
  { code: 'unrecognized_keys', keys: ['session_id'], path: [], message: 'Unrecognized key: "session_id"' },
] };
const request = { version: 1, session_id, project_id: 'p'.repeat(16), max_chars: 8000, max_tokens: 2000 };
const limits = { countTokens: () => 100 };
const context = sessionContext();
context.namespace = { ownerId: 'synthetic-owner', scope: 'project', projectId: request.project_id };

// Fake HTTP only: no listener, credentials, host process or network.
async function peer(t, poster, respond) {
  const requests = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, wire) => {
    const body = JSON.parse(wire.body);
    requests.push({ url, body, signal: wire.signal });
    return respond(body, requests.length, wire);
  };
  t.after(() => { globalThis.fetch = original; });
  const post = poster({ endpoint: 'https://synthetic.invalid', token: 'synthetic-token' });
  return { post, requests };
}

test('session-start accepts an optional host id with capture-compatible limits', () => {
  assert.equal(parseSessionStartRequest({ version: 1, session_id }).session_id, session_id);
  assert.equal(conforms('session-start-request', { version: 1 }), true);
  for (const value of ['', 'x'.repeat(201), null, 123]) {
    assert.throws(() => parseSessionStartRequest({ version: 1, session_id: value }), /invalid_memory_input/);
  }
  assert.equal(conforms('session-start-request', { version: 1, session_id: 'x'.repeat(200) }), true);
});

for (const [name, poster] of [['shared', sharedPoster], ['plugin', pluginPoster]]) {
  test(`${name} session-start supports new and old strict servers with bounded exact fallback`, async t => {
    let respond = () => Response.json(context);
    const f = await peer(t, poster, (...args) => respond(...args));
    assert.equal((await f.post.reply(path, request, 2000, limits)).status, 'complete');
    assert.deepEqual(f.requests.map(x => x.body), [request]);

    const oldKeys = new Set(['version', 'project_id', 'max_chars', 'max_tokens']);
    respond = body => {
      const unknown = Object.keys(body).filter(k => !oldKeys.has(k));
      return unknown.length ? Response.json({ ...rejection, issues: [
        { ...rejection.issues[0], keys: unknown },
      ] }, { status: 400 }) : Response.json(context);
    };
    f.requests.length = 0;
    assert.equal((await f.post.reply(path, request, 2000, limits)).status, 'complete');
    const { session_id: omitted, ...legacy } = request;
    assert.deepEqual(f.requests.map(x => x.body), [request, legacy]);
    assert.equal(f.requests[0].signal, f.requests[1].signal);
    assert.equal(request.session_id, omitted);
    f.requests.length = 0;
    assert.equal((await f.post.reply(path, legacy, 2000, limits)).status, 'complete');
    assert.deepEqual(f.requests.map(x => x.body), [legacy]);

    respond = () => Response.json(rejection, { status: 400 });
    f.requests.length = 0;
    assert.equal((await f.post.reply(path, request, 2000, limits)).status, 'error');
    assert.equal(f.requests.length, 2);
    for (const [label, status, body] of [
      ['generic 400', 400, { error: 'invalid_memory_input' }],
      ['another field', 400, { ...rejection, issues: [{ ...rejection.issues[0], keys: ['session_id', 'extra'] }] }],
      ['nested field', 400, { ...rejection, issues: [{ ...rejection.issues[0], path: ['nested'] }] }],
      ['other issue', 400, { ...rejection, issues: [...rejection.issues, { code: 'too_small', path: ['max_chars'] }] }],
      ['wrong code', 400, { ...rejection, issues: [{ ...rejection.issues[0], code: 'invalid_type' }] }],
      ['wrong error', 400, { ...rejection, error: 'Other error' }],
      ['auth', 401, rejection], ['quota', 429, rejection], ['outage', 503, rejection],
      ['invalid success', 200, rejection],
    ]) {
      respond = () => Response.json(body, {status});
      f.requests.length = 0;
      assert.notEqual((await f.post.reply(path, request, 2000, limits)).status, 'complete', label);
      assert.equal(f.requests.length, 1, label);
    }

    const abort = new AbortController();
    respond = () => { abort.abort(); return Response.json(rejection, {status:400}); };
    f.requests.length = 0;
    assert.equal((await f.post.reply(path, request, 2000, limits, abort.signal)).status, 'unavailable');
    assert.equal(f.requests.length, 1);
    // Let the original deadline expire while reading a schema rejection.
    respond = async (_, __, wire) => {
      await new Promise(resolve => wire.signal.addEventListener('abort', resolve, {once:true}));
      return Response.json(rejection, {status:400});
    };
    f.requests.length = 0;
    const keepAlive = setTimeout(() => {}, 1000);
    try {
      assert.equal((await f.post.reply(path, request, 20, limits)).status, 'unavailable');
      assert.equal(f.requests.length, 1);
    } finally { clearTimeout(keepAlive); }
    respond = () => { throw new Error(session_id); };
    f.requests.length = 0;
    assert.deepEqual(await f.post.reply(path, request, 2000, limits), {status:'unavailable'});
    assert.equal(f.requests.length, 1);
    const ws = createTestWorkspace(t, {prefix:'session-start-pause-'});
    const control = await readControlState(ws.path);
    let dispatches = 0;
    const dispatch = async start => {
      dispatches++;
      const started = await startIfActive(ws.path, control.generation, start);
      if (!started.started) throw new Error('dispatch_not_started');
      return started.operation;
    };
    respond = async () => {
      await setPaused(ws.path, true);
      return Response.json(rejection, {status:400});
    };
    f.requests.length = 0;
    assert.deepEqual(await f.post.reply(path, request, 2000, limits, undefined, dispatch),
      {status:'unavailable', notStarted:true});
    assert.equal(dispatches, 2);
    assert.equal(f.requests.length, 1);
  });
}
