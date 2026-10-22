import test from 'node:test';
import assert from 'node:assert/strict';
import * as filesystem from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import * as fixtureAPI from '../lib/fixture.mjs';
import { createApiLedger } from '../lib/api-ledger.mjs';
import { createOpenAIEmbedder, publicErrorCode } from '../lib/embed-openai.mjs';
import { runRankings } from '../run.mjs';
import { runLatency, measureLatency } from '../latency.mjs';
import { toyFixture } from './fixtures-arms/toy.mjs';

function response(input) {
  return { ok: true, status: 200, async json() {
    return { model: 'text-embedding-3-small', usage: { total_tokens: 1 },
      data: input.map((_, index) => ({ index, embedding: [1, ...Array(1535).fill(0)] })) };
  } };
}
function options(workspace, name) {
  return { fixtureDir: workspace.path, split: 'dev', scale: 'S300', arms: ['A2'], models: ['openai-3-small'],
    out: join(workspace.path, name + '.json'), ledgerPath: join(workspace.path, name + '.jsonl'),
    cacheDir: join(workspace.path, name + '-cache'), threads: 1 };
}
const apiFor = fixture => ({ ...fixtureAPI, async loadFixture() { return fixture; } });
// Use owned file descriptors for child output; this also works in sandboxes
// where Node's pipe-backed stdio requires unavailable socketpair permissions.
function capturedChild(workspace, name, args, env) {
  const stdoutPath = join(workspace.path, name + '.stdout'), stderrPath = join(workspace.path, name + '.stderr');
  const stdout = filesystem.openSync(stdoutPath, 'w'), stderr = filesystem.openSync(stderrPath, 'w');
  let child;
  try { child = spawnSync(process.execPath, args, { env, stdio: ['ignore', stdout, stderr] }); }
  finally { filesystem.closeSync(stdout); filesystem.closeSync(stderr); }
  assert.equal(child.error?.code, undefined, 'child process could not start');
  return { ...child, stdout: filesystem.readFileSync(stdoutPath, 'utf8'), stderr: filesystem.readFileSync(stderrPath, 'utf8') };
}
function assertPrivate(text, key) {
  // Boolean assertions deliberately avoid including any secret-bearing actual
  // value in a failed test's diagnostics.
  for (const marker of [key, ...key.split(/[\r\n]/).filter(Boolean), JSON.stringify(key).slice(1, -1)])
    assert.equal(text.includes(marker), false, 'credential marker reached output');
}

test('malformed keys fail before transport, cache I/O or reservation and never enter exception text', () => {
  for (const key of ['sk-synthetic-private-value\nunexpected', 'sk-synthetic-private-value\n',
    'sk-synthetic-private-value\r', 'sk-synthetic-private-value\t', 'sk-synthetic-private-value\0']) {
    let calls = 0;
    assert.throws(() => createOpenAIEmbedder({ model: 'openai-3-small', apiKey: key, cacheDir: '/unused',
      ledger: { reserve() { calls++; } }, fetchImpl() { calls++; } }), error => {
      assertPrivate(String(error), key); assert.equal(error.message, 'embedding_invalid_api_key'); return true;
    });
    assert.equal(calls, 0);
  }
});

test('malformed synthetic key is absent from actual rankings/latency artifacts, stdout and stderr', async t => {
  const workspace = createTestWorkspace(t, { prefix: 'hr1-key-cli-' }), fixture = toyFixture();
  const dir = join(workspace.path, 'toy'); await mkdir(dir);
  for (const [name, value] of Object.entries({ facts: { facts: [] }, corpus: fixture.corpus, queries: fixture.queries,
    split: fixture.split, labels: { queries: [] }, 'label-audit': { overrides: [] } }))
    await writeFile(join(dir, `hr1-${name}.json`), JSON.stringify(value));
  const key = 'sk-synthetic-private-value\nunexpected';
  for (const script of ['run.mjs', 'latency.mjs']) {
    const out = join(workspace.path, script + '.json');
    const env = { ...process.env, HR1_OPENAI_API_KEY: key }; delete env.NODE_TEST_CONTEXT;
    const child = capturedChild(workspace, script, [fileURLToPath(new URL('../' + script, import.meta.url)),
      '--fixture-dir', dir, '--split', 'dev', '--scale', 'S300', '--arms', 'A2', '--models', 'openai-3-small',
      '--ledger', join(workspace.path, script + '.jsonl'), '--out', out], env);
    assert.equal(child.status, 1);
    const artifact = await readFile(out, 'utf8');
    assertPrivate(artifact + child.stdout + child.stderr, key);
    const record = JSON.parse(artifact);
    assert.equal(script === 'run.mjs' ? record.run.error : record.error, 'embedding_invalid_api_key');
  }
});

test('transport exceptions cannot leak a valid synthetic key into rankings or timed error samples', async t => {
  const workspace = createTestWorkspace(t, { prefix: 'hr1-key-transport-' }), fixture = toyFixture();
  const key = 'sk-synthetic-private-valid-token';
  for (const [run, name, successfulRequests] of [[runRankings, 'rankings', 2], [runLatency, 'latency', 4]]) {
    let requests = 0;
    const result = await run(options(workspace, name), { fixtureAPI: apiFor(fixture),
      embedderFactory(model, opts, ledger) {
        return createOpenAIEmbedder({ model, apiKey: key, ledger, cacheDir: opts.cacheDir, maxRetries: 0,
          async fetchImpl(_url, request) {
            requests++;
            if (requests > successfulRequests) throw new TypeError(`invalid authorization value: Bearer ${key}`);
            return response(JSON.parse(request.body).input);
          },
        });
      },
    });
    for (const file of result.files) assertPrivate(await readFile(file, 'utf8'), key);
    if (name === 'rankings') assert.equal(result.outputs[0].run.error, 'embedding_transport_error');
    else {
      assert.equal(result.runs[0].failures, 10);
      assert.ok(result.runs[0].samples.every(sample => sample.error === 'embedding_transport_error'));
      assert.equal(result.runs[0].gatePassed, false);
    }
  }
});

test('raw injected errors at model and timing boundaries are reduced to fixed codes', async t => {
  const workspace = createTestWorkspace(t, { prefix: 'hr1-key-boundary-' });
  const key = 'sk-synthetic-boundary-private-token';
  for (const run of [runRankings, runLatency]) {
    const result = await run(options(workspace, run.name), { fixtureAPI: apiFor(toyFixture()),
      embedderFactory() { throw new Error(`Bearer ${key}`); } });
    assertPrivate(JSON.stringify(result), key);
  }
  const measured = await measureLatency({ queries: [{ queryId: 'q', text: 'toy', intent: 'current' }],
    async search() { throw new Error(`Bearer ${key}`); } });
  assert.ok(measured.samples.every(sample => sample.error === 'hr1_operation_failed'));
  assertPrivate(JSON.stringify(measured), key);
  const hostile = new Error(); Object.defineProperty(hostile, 'message', { get() { throw new Error(key); } });
  assert.equal(publicErrorCode(hostile), 'hr1_operation_failed');
});

test('even a caller logging a transport exception to stderr receives no original credential or cause', t => {
  const workspace = createTestWorkspace(t, { prefix: 'hr1-key-stderr-' });
  const key = 'sk-synthetic-stderr-private-token';
  const modulePath = new URL('../lib/embed-openai.mjs', import.meta.url).href;
  const ledgerPath = new URL('../lib/api-ledger.mjs', import.meta.url).href;
  const source = `
    import {createOpenAIEmbedder} from ${JSON.stringify(modulePath)};
    import {createApiLedger} from ${JSON.stringify(ledgerPath)};
    const apiKey = process.env.HR1_OPENAI_API_KEY;
    const client = createOpenAIEmbedder({model:'openai-3-small',apiKey,
      cacheDir:process.env.HR1_TEST_DIRECTORY+'/cache',ledger:createApiLedger(process.env.HR1_TEST_DIRECTORY+'/ledger.jsonl'),maxRetries:0,
      async fetchImpl(){throw new TypeError('Bearer '+apiKey);}});
    try { await client.embed(['synthetic']); } catch(error) { console.error(error); process.exitCode=1; }
  `;
  const env = { ...process.env, HR1_OPENAI_API_KEY: key, HR1_TEST_DIRECTORY: workspace.path }; delete env.NODE_TEST_CONTEXT;
  const child = capturedChild(workspace, 'transport', ['--input-type=module', '--eval', source], env);
  assert.equal(child.status, 1); assertPrivate(child.stdout + child.stderr, key);
  assert.equal(child.stderr.includes('embedding_transport_error'), true, 'fixed transport code absent from stderr');
});

function tracedFilesystem(events, failAt = Infinity) {
  const handles = new Map(); let syncs = 0;
  return { ...filesystem,
    mkdirSync(path, options) {
      const result = filesystem.mkdirSync(path, options); events.push({ type: 'mkdir', path }); return result;
    },
    openSync(path, flags, mode) {
      const fd = filesystem.openSync(path, flags, mode);
      handles.set(fd, { path, directory: filesystem.fstatSync(fd).isDirectory() }); return fd;
    },
    writeSync(fd, ...args) { events.push({ type: 'write', ...handles.get(fd) }); return filesystem.writeSync(fd, ...args); },
    fsyncSync(fd) {
      events.push({ type: 'sync', ...handles.get(fd), position: ++syncs });
      if (syncs === failAt) throw new Error('synthetic durability failure');
      return filesystem.fsyncSync(fd);
    },
    closeSync(fd) { handles.delete(fd); return filesystem.closeSync(fd); },
  };
}

test('dispatch follows directory creation, ledger file fsync and its parent-directory fence', async t => {
  const workspace = createTestWorkspace(t, { prefix: 'hr1-durable-order-' }), events = [];
  const path = join(workspace.path, 'new', 'nested', 'ledger.jsonl');
  const ledger = createApiLedger(path, { fs: tracedFilesystem(events) });
  let beforeDispatch;
  const client = createOpenAIEmbedder({ model: 'openai-3-small', apiKey: 'synthetic', ledger,
    cacheDir: join(workspace.path, 'cache'), async fetchImpl(_url, request) {
      beforeDispatch = [...events]; return response(JSON.parse(request.body).input);
    } });
  await client.embed(['synthetic']);
  const fileSync = beforeDispatch.findIndex(event => event.type === 'sync' && event.path === path);
  assert.ok(fileSync >= 0);
  assert.ok(beforeDispatch.slice(fileSync + 1).some(event => event.type === 'sync' && event.path === dirname(path)));
  for (const created of beforeDispatch.filter(event => event.type === 'mkdir')) {
    const position = beforeDispatch.indexOf(created);
    assert.ok(beforeDispatch.slice(position + 1).some(event => event.type === 'sync' && event.path === created.path));
    assert.ok(beforeDispatch.slice(position + 1).some(event => event.type === 'sync' && event.path === dirname(created.path)));
  }
  assert.equal(beforeDispatch.at(-1).type, 'sync'); assert.equal(beforeDispatch.at(-1).path, dirname(path));
});

test('every pre-dispatch fsync fault prevents dispatch, including first-ledger directory-entry faults', async t => {
  const baseline = createTestWorkspace(t, { prefix: 'hr1-durable-baseline-' }), baselineEvents = [];
  const path = join(baseline.path, 'new', 'nested', 'ledger.jsonl');
  const ledger = createApiLedger(path, { fs: tracedFilesystem(baselineEvents) });
  let preDispatchSyncs = 0;
  await createOpenAIEmbedder({ model: 'openai-3-small', apiKey: 'synthetic', ledger, cacheDir: join(baseline.path, 'cache'),
    async fetchImpl(_url, request) {
      preDispatchSyncs = baselineEvents.filter(event => event.type === 'sync').length;
      return response(JSON.parse(request.body).input);
    } }).embed(['synthetic']);
  assert.ok(preDispatchSyncs >= 7);
  for (let position = 1; position <= preDispatchSyncs; position++) {
    const workspace = createTestWorkspace(t, { prefix: 'hr1-durable-fault-' }), events = [];
    let dispatches = 0;
    await assert.rejects((async () => {
      const failedLedger = createApiLedger(join(workspace.path, 'new', 'nested', 'ledger.jsonl'), { fs: tracedFilesystem(events, position) });
      const client = createOpenAIEmbedder({ model: 'openai-3-small', apiKey: 'synthetic', ledger: failedLedger,
        cacheDir: join(workspace.path, 'cache'), maxRetries: 0, async fetchImpl() { dispatches++; return response(['synthetic']); } });
      await client.embed(['synthetic']);
    })());
    assert.equal(dispatches, 0, `dispatch preceded fsync fence ${position}`);
    assert.ok(events.some(event => event.type === 'sync' && event.position === position));
  }
});
