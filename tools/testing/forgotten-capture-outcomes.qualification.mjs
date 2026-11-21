// Historical executions belong in qualification, never in node:test.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync, StatementSync } from 'node:sqlite';
import { openMemoryCore } from '../../core/index.mjs';
import { safetyFixture, ns, ok } from '../../core/testing/content-safety-s2h-fixture.mjs';

async function meter(call) {
  const prepare = DatabaseSync.prototype.prepare, exec = DatabaseSync.prototype.exec;
  const methods = new Map(['get', 'all', 'run', 'iterate'].map(name => [name, StatementSync.prototype[name]]));
  const counts = { prepared: 0, executed: 0, exec: 0 };
  DatabaseSync.prototype.prepare = function (...args) { counts.prepared++; return Reflect.apply(prepare, this, args); };
  DatabaseSync.prototype.exec = function (...args) { counts.exec++; return Reflect.apply(exec, this, args); };
  for (const [name, original] of methods) StatementSync.prototype[name] = function (...args) {
    counts.executed++; return Reflect.apply(original, this, args);
  };
  try { return { value: await call(), counts }; }
  finally {
    DatabaseSync.prototype.prepare = prepare; DatabaseSync.prototype.exec = exec;
    for (const [name, original] of methods) StatementSync.prototype[name] = original;
  }
}

export async function forgottenCaptureOutcome(open) {
  const cleanup = [], t = { after: fn => cleanup.push(fn) };
  try {
    const f = safetyFixture(t, 18);
    let calls = 0;
    const core = open({ path: f.path, model: { contextWindow: 8192, countTokens: () => 1,
      extract() { calls++; return { items: [{ content: 'Synthetic forgotten fact', kind: 'fact', confidence: .9, sourceIndices: [0] }] }; } } });
    f.workspace.defer(() => core.close());
    const input = { namespace: ns, client: 'synthetic', sessionId: 'synthetic-session', eventId: 'first',
      messages: [{ id: 'synthetic-message', role: 'user', content: 'Synthetic forgotten source.' }] };
    const first = ok(await core.capture(input)).admission.memories[0];
    const { indexRevision } = ok(core.forget({ namespace: ns, memoryId: first.id, expectedRevision: first.revision }));
    calls = 0;
    const result = await meter(() => core.capture({ ...input, eventId: 'second' }));
    const replay = await meter(() => core.capture({ ...input, eventId: 'second' }));
    return { result: result.value, replay: replay.value, extractCalls: calls, indexRevision,
      counts: { capture: result.counts, replay: replay.counts } };
  } finally { while (cleanup.length) await cleanup.pop()(); }
}

export async function compareForgottenCapture(base, { observe = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'forgotten-capture-base-'));
  try {
    const paths = execFileSync('git', ['ls-tree', '-r', '--name-only', base], { encoding: 'utf8' }).trim().split('\n')
      .filter(path => /^core\/[^/]+\.mjs$/.test(path) || path.startsWith('core/prompts/') || path === 'plugins/cairn-memory/lib/redact.mjs');
    const archive = execFileSync('git', ['archive', base, '--', ...paths], { maxBuffer: 32 * 1024 * 1024 });
    execFileSync('tar', ['-x', '-C', root], { input: archive });
    const before = await import(pathToFileURL(join(root, 'core/index.mjs')));
    const a = await forgottenCaptureOutcome(before.openMemoryCore), b = await forgottenCaptureOutcome(openMemoryCore);
    console.log(JSON.stringify({ kind: 'all-suppressed-capture', base, baseOutcome: a, currentOutcome: b }));
    if (!observe) {
      assert.deepEqual(b.result, a.result, 'the new ok-empty capture cell matches the executed all-suppressed base exactly');
      assert.deepEqual(b.replay, a.replay, 'the empty admission claim completes durably');
      assert.equal(b.extractCalls, 0, 'no extraction of forgotten text');
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const phase = process.argv[2];
  if (phase === 'after' && !process.argv[3]) {
    const outcome = await forgottenCaptureOutcome(openMemoryCore);
    assert.deepEqual(outcome.result, { ok: true, value: { duplicate: false,
      admission: { memories: [], suppressedCount: 1, indexRevision: outcome.indexRevision },
      classification: { status: 'skipped', reason: 'empty' } } });
    assert.deepEqual(outcome.replay, { ok: true, value: { duplicate: true, memoryIds: [], suppressedCount: 1 } });
    assert.equal(outcome.extractCalls, 0, 'no extraction of forgotten text');
    console.log(JSON.stringify({ kind: 'all-suppressed-capture', currentOutcome: outcome }));
  } else {
    await compareForgottenCapture(phase === 'after' ? process.argv[3] : phase,
      { observe: process.argv.includes('--observe') });
  }
}
