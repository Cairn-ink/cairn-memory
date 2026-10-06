// Offline synthetic diagnosis only: unchanged installed child and genuine kernel.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectMem0NativeArtifact, checkedMem0NativeArtifact } from '../mem0-native-artifact.mjs';
import { mem0NativeConfiguration } from '../mem0-native-gateway.mjs';
import { runNativeGatewayKernel } from '../mem0-native-runtime.mjs';
import { nativeHttpTimeoutFixture } from './native-http-timeout-fixture.mjs';

assert.deepEqual(process.execArgv, []);
assert.ok(['v22.16.0', 'v24.15.0'].includes(process.version));
assert.ok(process.env.TMPDIR?.startsWith('/tmp/cairn-test-run-'));
const output = process.env.CAIRN_NLB_EVIDENCE_DIR;
assert.ok(typeof output === 'string' && output.startsWith('/tmp/cairn-nlb-'));
assert.ok(fs.statSync(output).isDirectory());
const artifact = inspectMem0NativeArtifact({ venvRoot: process.env.CAIRN_MEM0_NATIVE_VENV_ROOT,
  pythonRoot: process.env.CAIRN_MEM0_NATIVE_PYTHON_ROOT });
const configuration = mem0NativeConfiguration({ topK: 6, threshold: 0,
  childTimeoutMs: 3_600_000, httpTimeoutMs: 60_000 });
assert.equal(configuration.configuration.localTransportTimeoutMs, 65_000);
const here = path.dirname(fileURLToPath(import.meta.url));
const sourceSha = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const runtimeFile = fileURLToPath(new URL('../mem0-native-runtime.mjs', import.meta.url));
const childFile = path.join(here, 'mem0-native-child.py');
const runtimeSourceSha256 = sourceSha(runtimeFile), childSourceSha256 = sourceSha(childFile);
assert.equal(childSourceSha256, configuration.configuration.childSourceSha256);
const round = n => Math.round(n * 1000) / 1000;
const ownCode = error => Object.getOwnPropertyDescriptor(error ?? {}, 'code')?.value;
const failureCodes = new Set(['native_spawn_failed', 'native_kill_failed', 'native_child_failed',
  'native_gateway_failed', 'native_output_invalid', 'native_input_failed', 'native_input_exceeded',
  'native_output_exceeded', 'native_stderr_exceeded', 'native_http_invalid', 'native_http_timeout',
  'native_scope_closed', 'native_response_disconnect', 'native_reap_failed', 'native_process_group_live',
  'native_listener_cleanup_failed', 'native_guard_drain_failed', 'native_artifact_changed',
  'native_child_source_changed', 'native_accounting_unsettled', 'native_cleanup_failed',
  'native_listener_failed', 'native_connection_cap', 'native_response_invalid',
  'case_cancelled', 'case_deadline_exceeded']);
const finiteError = error => {
  const code = ownCode(error);
  return failureCodes.has(code) ? code : 'unknown';
};
const socketCode = error => {
  const code = ownCode(error);
  return ['EPIPE', 'ECONNRESET', 'ERR_HTTP_REQUEST_TIMEOUT'].includes(code) ? code
    : typeof code === 'string' && code.startsWith('HPE_') ? 'parser' : 'unknown';
};
function tail(limit) {
  const values = [];
  let count = 0;
  return { push(value) { count++; values.push(value); if (values.length > limit) values.shift(); },
    record: () => ({ total: count, omitted: count - values.length, tail: values }) };
}
function groupAbsent(pid) {
  try { process.kill(-pid, 0); return false; }
  catch (error) { return ownCode(error) === 'ESRCH'; }
}
const records = [];
for (const spec of [{ name: 'long-54-single', batches: 54, facts: 1 },
  { name: 'large-3-sixteen', batches: 3, facts: 16 }]) {
  const start = performance.now(), stamp = () => round(performance.now() - start);
  const events = tail(128), providers = tail(64), connections = new WeakMap();
  const children = [], delivered = { count: 0, maxBytes: 0, above200000: 0 };
  let ordinal = 0, chatCount = 0, caseRoot, fixture, native, result, account;
  let errorCategory = null, fatalCategory = null;
  const originalServer = http.createServer, originalSpawn = childProcess.spawn;
  const originalWriteHead = http.ServerResponse.prototype.writeHead;
  const observedServer = function(...args) {
    const server = originalServer.apply(this, args);
    server.once('listening', () => { caseRoot = path.dirname(server.address()); });
    server.on('connection', socket => {
      const id = ++ordinal; connections.set(socket, id);
      events.push({ event: 'connection', ordinal: id, atMs: stamp() });
      socket.once('close', hadError => events.push({ event: 'socket-close', ordinal: id,
        hadError, atMs: stamp() }));
    });
    server.on('request', (request, response) => {
      const id = connections.get(request.socket);
      events.push({ event: 'request', ordinal: id, atMs: stamp() });
      response.once('finish', () => events.push({ event: 'response-finish', ordinal: id, atMs: stamp() }));
      response.once('close', () => events.push({ event: 'response-close', ordinal: id,
        writableFinished: response.writableFinished, atMs: stamp() }));
    });
    server.on('clientError', (error, socket) => {
      const syscall = Object.getOwnPropertyDescriptor(error, 'syscall')?.value;
      events.push({ event: 'client-error', ordinal: connections.get(socket), code: socketCode(error),
        syscall: ['read', 'write'].includes(syscall) ? syscall : null, atMs: stamp() });
    });
    server.on('timeout', socket => events.push({ event: 'socket-timeout',
      ordinal: connections.get(socket), atMs: stamp() }));
    return server;
  };
  const observedWriteHead = function(status, ...args) {
    const id = connections.get(this.socket);
    if (id !== undefined) {
      const headers = args.find(value => value && typeof value === 'object' && !Array.isArray(value));
      const bytes = headers?.['content-length'];
      if (Number.isSafeInteger(bytes) && bytes >= 0) {
        delivered.count++; delivered.maxBytes = Math.max(delivered.maxBytes, bytes);
        if (bytes > 200_000) delivered.above200000++;
      }
      events.push({ event: 'response-head', ordinal: id, status,
        contentLength: Number.isSafeInteger(bytes) ? bytes : null, atMs: stamp() });
    }
    return originalWriteHead.call(this, status, ...args);
  };
  const observedSpawn = function(...args) {
    const child = originalSpawn.apply(this, args);
    if (args[0] === 'bwrap') {
      const observed = { pid: child.pid ?? null, startMs: stamp(), exit: null, close: null };
      children.push(observed);
      child.once('exit', (code, signal) => { observed.exit = { code, signal, atMs: stamp() }; });
      child.once('close', (code, signal) => { observed.close = { code, signal, atMs: stamp() }; });
    }
    return child;
  };
  http.createServer = observedServer;
  http.ServerResponse.prototype.writeHead = observedWriteHead;
  childProcess.spawn = observedSpawn;
  syncBuiltinESMExports();
  try {
    fixture = nativeHttpTimeoutFixture(null, { artifact, configuration,
      generationBatchCount: spec.batches,
      fetchImpl: async (url, options) => {
        const body = JSON.parse(options.body), embedding = url.endsWith('/embeddings');
        const enteredMs = stamp();
        let response;
        if (embedding) {
          response = { object: 'list', model: 'text-embedding-3-small',
            usage: { prompt_tokens: body.input.length, total_tokens: body.input.length },
            data: body.input.map((_, index) => ({ object: 'embedding', index,
              embedding: Array.from({ length: 1536 }, (_, dimension) =>
                Math.sin(dimension + index + 1) * 0.5) })) };
        } else {
          chatCount++;
          response = { object: 'chat.completion', model: 'gpt-4.1-mini-2025-04-14',
            usage: { prompt_tokens: 64, completion_tokens: 256, total_tokens: 320 },
            choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant',
              content: JSON.stringify({ memory: Array.from({ length: spec.facts }, (_, index) =>
                ({ text: `synthetic bounded fact batch ${chatCount} item ${index + 1}` })) }) } }] };
        }
        const bytes = JSON.stringify(response);
        providers.push({ route: embedding ? 'embedding' : 'chat',
          itemCount: embedding ? body.input.length : spec.facts,
          enteredMs, returnedMs: stamp(), elapsedMs: round(performance.now() - start - enteredMs),
          rawResponseBytes: Buffer.byteLength(bytes) });
        return new Response(bytes, { status: 200, headers: { 'content-type': 'application/json' } });
      } });
    try {
      result = await fixture.guard.withCaseScope(fixture.capability.schedule[0], async handle => {
        native = await runNativeGatewayKernel({ artifact, roots: checkedMem0NativeArtifact(artifact),
          configuration: configuration.configuration, childFile,
          guard: fixture.guard, handle,
          input: { batches: Array.from({ length: spec.batches }, (_, index) =>
            [{ role: 'user', content: `synthetic distinct evidence batch ${index + 1}` }]),
          query: 'synthetic bounded facts?' }, scope: { caseId: fixture.capability.schedule[0].caseId } });
        return native;
      });
    } catch (error) { errorCategory = finiteError(error); }
    const attempts = fixture.guard.attempts();
    account = { requests: attempts.length, successful: attempts.filter(row => row.outcome === 'succeeded').length,
      unknown: attempts.filter(row => row.outcome === 'unknown').length,
      pending: attempts.filter(row => row.outcome === null).length,
      allResponsesPriced: attempts.every(row => row.outcome === 'succeeded'
        && Number.isSafeInteger(row.actualMicroUsd) && row.transportTermination === 'response'),
      halted: fixture.guard.isHalted() };
  } catch (error) { fatalCategory = finiteError(error); }
  finally {
    http.createServer = originalServer;
    http.ServerResponse.prototype.writeHead = originalWriteHead;
    childProcess.spawn = originalSpawn;
    syncBuiltinESMExports();
    try { await fixture?.guard.close(); }
    catch (error) { fatalCategory ??= finiteError(error); }
    if (caseRoot && fs.existsSync(caseRoot)) fatalCategory ??= 'native_cleanup_failed';
    if (fixture && fatalCategory !== 'native_cleanup_failed') {
      try { await fixture.workspace.cleanup(); }
      catch (error) { fatalCategory ??= finiteError(error); }
    }
  }
  const record = { version: 1, node: process.version, name: spec.name,
    batches: spec.batches, factsPerBatch: spec.facts, expectedAddRecords: spec.batches * spec.facts,
    elapsedMs: stamp(), configurationSha256: configuration.configurationSha256,
    httpTimeoutMs: 60_000, localTransportTimeoutMs: 65_000, childTimeoutMs: 3_600_000,
    account, errorCategory, fatalCategory, chatCount, delivered,
    result: result ? { status: result.status, reason: result.reason ?? null } : null,
    native: native ? { status: native.status, reason: native.reason ?? null,
      verifiedAddRecords: native.value?.verifiedAddRecords ?? null,
      resultCount: native.value?.results?.length ?? null } : null,
    children: children.map(child => ({ ...child, groupAbsent: child.pid !== null && groupAbsent(child.pid) })),
    pythonExceptionCategory: 'unknown-original-child-suppresses-cause',
    observersRestored: http.createServer === originalServer
      && http.ServerResponse.prototype.writeHead === originalWriteHead && childProcess.spawn === originalSpawn,
    caseRootAbsent: Boolean(caseRoot) && !fs.existsSync(caseRoot),
    fixtureRootAbsent: Boolean(fixture) && !fs.existsSync(fixture.workspace.path),
    events: events.record(), providers: providers.record(), paidCalls: 0 };
  record.accepted = !fatalCategory && !errorCategory && result?.status === 'completed'
    && native?.status === 'completed' && native.value.verifiedAddRecords === spec.batches * spec.facts
    && chatCount === spec.batches && account?.pending === 0 && account.unknown === 0
    && account.allResponsesPriced && !account.halted && record.observersRestored
    && record.caseRootAbsent && record.fixtureRootAbsent && children.length === 1
    && record.children.every(child => child.close?.code === 0 && child.groupAbsent)
    && (spec.facts === 1 || delivered.above200000 >= spec.batches);
  records.push(record);
  fs.writeFileSync(path.join(output, `${process.version}-${spec.name}.json`),
    `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  console.log(JSON.stringify({ node: record.node, name: record.name, accepted: record.accepted,
    elapsedMs: record.elapsedMs, account, native: record.native, delivered,
    errorCategory, fatalCategory, caseRootAbsent: record.caseRootAbsent,
    fixtureRootAbsent: record.fixtureRootAbsent }));
  if (!record.accepted) { process.exitCode = 1; break; }
}
assert.equal(sourceSha(runtimeFile), runtimeSourceSha256);
assert.equal(sourceSha(childFile), childSourceSha256);
const evidence = { version: 1, node: process.version, paidCalls: 0,
  probeSha256: createHash('sha256').update(fs.readFileSync(fileURLToPath(import.meta.url))).digest('hex'),
  completedCases: records.length, verdict: process.exitCode ? 'natural-failure-or-acceptance-gap'
    : 'natural-failure-not-reproduced', probeMutatesRuntimeOrChild: false,
  runtimeSourceSha256, childSourceSha256, sourcePinsUnchanged: true,
  runnerWorkspace: process.env.TMPDIR };
fs.writeFileSync(path.join(output, `${process.version}-evidence.json`),
  `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
console.log(JSON.stringify(evidence));
