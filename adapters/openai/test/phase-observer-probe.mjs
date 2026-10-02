import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setImmediate } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';

export const observerModes = Object.freeze([
  'omitted', 'enabled', 'throwing', 'async-rejecting', 'own-catch-getter', 'own-catch-function',
]);
const phases = ['prepare', 'count_transport', 'count_body', 'count_validation',
  'generation_transport', 'generation_body', 'output_validation'];
const runner = fileURLToPath(new URL('../../../tools/testing/run.mjs', import.meta.url));

// Standalone script mode avoids node:test's own unhandled-rejection handler.
export function runObserverProbe(owner, adapterPath, mode, invalidOutput, forceFailure = false) {
  const child = spawnSync(process.execPath, [runner, '--script', fileURLToPath(import.meta.url),
    adapterPath, mode, String(invalidOutput), String(forceFailure)], {
    encoding: 'utf8', timeout: 15000, maxBuffer: 256 * 1024,
    env: { PATH: process.env.PATH, NODE_DISABLE_COMPILE_CACHE: '1',
      TMPDIR: owner.path, TMP: owner.path, TEMP: owner.path },
  });
  assert.equal(child.error, undefined);
  assert.equal(child.signal, null);
  assert.deepEqual(readdirSync(owner.path), [], 'runner removes child scratch even on assertion failure');
  const report = JSON.parse(child.stdout.trim());
  assert.doesNotMatch(JSON.stringify(report), /synthetic-observer-canary/u);
  return { status: child.status, stderr: child.stderr, report };
}

export function assertObserverParity(owner, adapterPath) {
  for (const invalidOutput of [false, true]) {
    let baseline;
    for (const mode of observerModes) {
      const child = runObserverProbe(owner, adapterPath, mode, invalidOutput);
      const { requests, events, unhandled, ownCatchReads } = child.report;
      assert.equal(child.status, 0, JSON.stringify({ mode, invalidOutput,
        requests, events, unhandled, ownCatchReads }));
      const { wires, result, diagnostics } = child.report;
      const comparable = { wires, result, diagnostics };
      baseline ??= comparable;
      assert.deepEqual(comparable, baseline);
      assert.equal(child.report.requests, 2);
      assert.equal(child.report.events, mode === 'omitted' ? 0 : 7);
      assert.equal(child.report.unhandled, 0);
      assert.equal(child.report.ownCatchReads, 0);
      if (invalidOutput) {
        assert.equal(result.status, 'rejected');
        assert.equal(result.error.code, 'invalid_model_output');
        assert.deepEqual(diagnostics, [{ version: 1, stage: 'extract', layer: 'adapter',
          reason: 'response_envelope' }]);
      } else {
        assert.deepEqual(result, { status: 'fulfilled', value: { items: [] } });
        assert.deepEqual(diagnostics, []);
      }
    }
  }
}

async function probe(adapterPath, mode, invalidOutput, forceFailure) {
  assert.ok(observerModes.includes(mode));
  const owner = createTestWorkspace(null, { prefix: 'cairn-observer-probe-' });
  let unhandled = 0, ownCatchReads = 0;
  const listen = () => { unhandled++; };
  process.on('unhandledRejection', listen);
  try {
    writeFileSync(join(owner.path, 'synthetic-scratch'), 'owned', { flag: 'wx' });
    const { createOpenAIModel } = await import(pathToFileURL(adapterPath).href);
    const events = [], diagnostics = [], wires = [];
    const onPhaseTiming = mode === 'omitted' ? undefined : event => {
      events.push(event);
      if (mode === 'throwing') throw Error('synthetic-observer-canary');
      if (mode === 'async-rejecting') return (async () => { throw Error('synthetic-observer-canary'); })();
      if (mode.startsWith('own-catch-')) {
        const rejected = Promise.reject('synthetic-observer-canary');
        Object.defineProperty(rejected, 'catch', mode === 'own-catch-getter'
          ? { get() { ownCatchReads++; throw Error('synthetic-observer-canary'); } }
          : { value() { ownCatchReads++; throw Error('synthetic-observer-canary'); } });
        return rejected;
      }
    };
    globalThis.fetch = () => assert.fail('native network forbidden');
    const model = createOpenAIModel({ apiKey: 'synthetic-fake-only',
      ...(onPhaseTiming === undefined ? {} : { onPhaseTiming }),
      onDiagnostic: event => diagnostics.push(event),
      fetchImpl: async (url, options) => {
        wires.push({ url, body: options.body });
        if (url.endsWith('/input_tokens')) return Response.json({
          object: 'response.input_tokens', input_tokens: 100 });
        return Response.json({ object: 'response', model: JSON.parse(options.body).model,
          status: invalidOutput ? 'failed' : 'completed', error: null, incomplete_details: null,
          output: [{ type: 'message', role: 'assistant', status: 'completed',
            content: [{ type: 'output_text', text: '{"items":[]}' }] }],
          usage: { input_tokens: 100, output_tokens: 5, total_tokens: 105 } });
      } });
    let result;
    try {
      result = { status: 'fulfilled', value: await model.extract({ system: 'Synthetic instructions',
        input: { messages: [{ index: 0, role: 'user', content: 'Synthetic source' }] },
        maxOutputTokens: 1024, signal: new AbortController().signal }) };
    } catch (error) {
      result = { status: 'rejected', error: { name: error.name, message: error.message, code: error.code } };
    }
    await setImmediate();
    await setImmediate();
    console.log(JSON.stringify({ requests: wires.length, events: events.length,
      unhandled, ownCatchReads, wires, result, diagnostics }));
    assert.equal(wires.length, 2);
    assert.deepEqual(wires.map(({ url }) => url.endsWith('/input_tokens') ? 'count' : 'generation'),
      ['count', 'generation']);
    assert.deepEqual(events.map(event => event.phase), mode === 'omitted' ? [] : phases);
    for (const event of events) {
      assert.deepEqual(Object.keys(event), ['version', 'stage', 'phase', 'outcome', 'elapsedMs']);
      assert.equal(Object.isFrozen(event), true);
      assert.equal(event.version, 1);
      assert.equal(event.stage, 'extract');
      assert.equal(event.outcome, invalidOutput && event.phase === 'output_validation' ? 'failed' : 'completed');
      assert.ok(Number.isFinite(event.elapsedMs) && event.elapsedMs >= 0 && event.elapsedMs <= 2_147_483_647);
    }
    assert.equal(unhandled, 0, 'observer rejections must be handled');
    assert.equal(ownCatchReads, 0, 'observer own catch must not be read');
    if (forceFailure) assert.fail('synthetic_cleanup_assertion');
  } finally {
    process.off('unhandledRejection', listen);
    await owner.cleanup();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await probe(process.argv[2], process.argv[3], process.argv[4] === 'true', process.argv[5] === 'true');
}
