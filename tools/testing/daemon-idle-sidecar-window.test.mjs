import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { registerHooks } from 'node:module';
import { join } from 'node:path';
import test from 'node:test';
import { runtimeDirectory } from '../../adapters/mcp/local-daemon-state.mjs';
import { runtimeSnapshot } from '../../packaging/test/fixtures/installed-daemon-runtime.mjs';
import { createTestWorkspace } from './workspace.mjs';

const qualification = new URL('./daemon-idle-sidecar-window.qualification.mjs', import.meta.url);

async function recordedQualification(t, part, samples, setup = {}) {
  const workspace = setup.workspace ?? createTestWorkspace(t);
  const output = join(workspace.path, part);
  await mkdir(output);
  const url = new URL(qualification);
  url.search = output;
  const supplied = { part, output, samples, directory: setup.directory, before: setup.before, prefixes: setup.prefixes ?? [] };
  const dataName = 'daemonIdleQualificationTestData';
  const source = await readFile(qualification, 'utf8');
  const workloadStart = source.indexOf('  check(args.length ===');
  const acceptanceStart = source.indexOf("  if (part === 'A') result.matchesExpected");
  assert.ok(workloadStart > 0 && acceptanceStart > workloadStart);
  const replay = (source.slice(0, workloadStart) + `
    const { samples: recorded } = globalThis.${dataName};
    samples.push(...recorded);
    const result = { part, deterministic: part === 'A' ? samples : null, readers: [summarize('current')] };
  ` + source.slice(acceptanceStart))
    .replace('process.argv.slice(2)', `[null, globalThis.${dataName}.part, null, globalThis.${dataName}.output]`)
    .replace('try { await main(); }', `
      ({ directory, before } = globalThis.${dataName});
      for (const prefix of globalThis.${dataName}.prefixes) prefixes.add(prefix);
      try { await main(); }`);
  const hooks = registerHooks({ load(target, context, next) {
    const result = next(target, context);
    return target === url.href ? { ...result, source: replay } : result;
  } });
  const previousExit = process.exitCode;
  const previousListeners = new Map(['SIGINT', 'SIGTERM'].map(signal => [signal, process.listeners(signal)]));
  let rc;
  globalThis[dataName] = supplied;
  try {
    await import(url.href);
    rc = process.exitCode ?? 0;
  } finally {
    process.exitCode = previousExit;
    for (const [signal, listeners] of previousListeners) {
      for (const listener of process.listeners(signal)) if (!listeners.includes(listener)) process.off(signal, listener);
    }
    delete globalThis[dataName];
    hooks.deregister();
  }
  return { rc, json: async name => JSON.parse(await readFile(join(output, name + '.json'), 'utf8')) };
}

test('a missing control sentinel fails after saving the result and the failed sample', async t => {
  const failed = { engine: 'current', phase: 'loop', afterDetachMs: 25, durationMs: 1, ok: true,
    coverage: 'partial', itemCount: 0, rawItems: 0, sentinel: false, failed: true };
  const replay = await recordedQualification(t, 'control', [failed]);
  assert.deepEqual(await replay.json('measurements'), [failed]);
  assert.equal((await replay.json('result')).readers[0].failures, 1);
  assert.equal(replay.rc, 1);
});

test('reused state preserves its existing log when the candidate announces the same prefix', { skip: process.platform !== 'linux' }, async t => {
  const workspace = createTestWorkspace(t);
  const directory = await runtimeDirectory({ root: workspace.path });
  const prefixes = ['d-' + '1'.repeat(32), 'd-' + '2'.repeat(32)];
  const existing = join(directory.path, prefixes[0] + '.log'), created = join(directory.path, prefixes[1] + '.log');
  await writeFile(existing, 'daemon_ready\n', { mode: 0o600 });
  const before = await runtimeSnapshot(directory.path);
  await writeFile(existing, 'daemon_ready\ndaemon_ready\n', { mode: 0o600 });
  await writeFile(created, 'daemon_ready\n', { mode: 0o600 });
  const replay = await recordedQualification(t, 'control', [], { workspace, directory, before, prefixes });
  assert.equal(await readFile(existing, 'utf8'), 'daemon_ready\ndaemon_ready\n');
  await assert.rejects(readFile(created), { code: 'ENOENT' });
  const hygiene = await replay.json('hygiene');
  assert.deepEqual(hygiene.errors, []);
  assert.ok(hygiene.diagnostics.includes('foreign log append: ' + prefixes[0] + '.log'));
  assert.equal(replay.rc, 0);
});

test('held coverage is partial for the current reader and unavailable for the optional legacy reader', async t => {
  const rows = ['current', '0.6.5'].flatMap(engine => [
    { engine, phase: 'held', ok: true, coverage: engine === 'current' ? 'partial' : 'unavailable', itemCount: 0, sentinel: false },
    ...['released', 'stopped'].map(phase => ({ engine, phase, ok: true, coverage: 'included', itemCount: 1, sentinel: true })),
  ]);
  const replay = await recordedQualification(t, 'A', rows);
  assert.equal((await replay.json('result')).matchesExpected, true);
  assert.equal(replay.rc, 0);
});

test('qualification and lifetime instrumentation use behaviour-based labels', async () => {
  const files = [qualification, new URL('./fixtures/daemon-idle-sidecar.mjs', import.meta.url),
    new URL('../../adapters/mcp/test/local-daemon-writer-lifetime.test.mjs', import.meta.url)];
  for (const file of files) {
    const source = await readFile(file, 'utf8');
    assert.doesNotMatch(source, /\b(?:synthetic-|pre-)a\d+\b|\bglobalThis\.a\d+\w*/i, file.pathname);
  }
});
