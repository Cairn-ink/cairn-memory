// Shared process harness for ordinary coverage and the opt-in timing measurement.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, writeFile, readdir, readFile } from 'node:fs/promises';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTestWorkspace } from '../../../../tools/testing/workspace.mjs';
import { withFileLock } from '../../lib/file-lock.mjs';
import { hostedTargetId } from '../../lib/http.mjs';

const hook = fileURLToPath(new URL('../../scripts/hook.mjs', import.meta.url));
const preload = fileURLToPath(new URL('./recall-deadline-preload.mjs', import.meta.url));
const monotonicMs = () => Number(process.hrtime.bigint()) / 1e6;
export const scenarios = {
  'slow-recall': { recallMs: 5000 },
  'success-slow-telemetry': { lockMs: 450, recallMs: 1800, telemetry: true },
  'unavailable-quota-lock': { holdQuotaLock: true, telemetry: true },
  // Without the application cutoff, contention + the shared 2000 ms HTTP
  // deadline would take about 2900 ms after entry, beyond the 2500 ms budget.
  'schema-fallback': { lockMs: 900, reply: 'old-schema' },
};

export async function invocation(t, { lockMs = 0, holdQuotaLock = false, recallMs = 0,
  telemetry = false, stalledInput = false, reply = 'valid', missingToken = false, onFetch } = {}) {
  const workspace = createTestWorkspace(t, { prefix: 'recall-deadline-' });
  try {
    const home = join(workspace.path, 'home'), root = join(home, 'data');
    await mkdir(root, { recursive: true, mode: 0o700 });
    await writeFile(join(root, 'project-key'), '12345678-1234-4234-8234-123456789abc\n', { mode: 0o600 });
    const lock = join(root, 'hosted-quota', hostedTargetId({ endpoint: 'https://synthetic.invalid' }) + '.json.lock');
    let ready, unlock, releaseTimer;
    const acquired = new Promise(resolve => ready = resolve), release = new Promise(resolve => unlock = resolve);
    const holder = lockMs || holdQuotaLock ? withFileLock(lock, async () => { ready(); await release; }) : Promise.resolve(true);
    workspace.defer(async () => { clearTimeout(releaseTimer); unlock(); await holder; });
    if (lockMs || holdQuotaLock) await acquired;
    const ownerBefore = holdQuotaLock ? await readFile(lock, 'utf8') : undefined;
    const lockNames = async () => (await readdir(dirname(lock))).filter(name => name.startsWith(basename(lock))).sort();
    const namesBefore = holdQuotaLock ? await lockNames() : undefined;
    const ownerFile = namesBefore?.find(name => name.includes('.owner-'));
    const ownerFileBefore = holdQuotaLock ? await readFile(join(dirname(lock), ownerFile), 'utf8') : undefined;
    const started = monotonicMs(), events = [];
    const mark = ({ monotonicMs: childTime, ...event }) => events.push({ ...event,
      ms: (Number.isFinite(childTime) ? childTime : monotonicMs()) - started });
    const child = spawn(process.execPath, ['--import', preload, hook, 'recall'], {
      cwd: home, env: { PATH: '/usr/bin:/bin', HOME: home, TMPDIR: workspace.path,
        CLAUDE_PLUGIN_DATA: root, CLAUDE_PLUGIN_OPTION_API_ENDPOINT: 'https://synthetic.invalid',
        CLAUDE_PLUGIN_OPTION_API_TOKEN: missingToken ? '' : 'synthetic-token', CLAUDE_PLUGIN_OPTION_TELEMETRY: String(telemetry),
        CAIRN_TEST_RECALL_DELAY: String(recallMs), CAIRN_TEST_RECALL_REPLY: reply,
        CAIRN_TEST_RECALL_ACK: String(Boolean(onFetch)) }, stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
    });
    let stdout = '', stderr = '', hostKilled = false, duringFetch, fetchFailed = false;
    child.on('message', event => {
      mark(event);
      // Rendezvous on EEXIST from the child's actual quota-lock link attempt.
      if (event.kind === 'quota-lock-contended' && lockMs && !releaseTimer)
        releaseTimer = setTimeout(unlock, lockMs);
      if (event.kind === 'recall-fetch' && onFetch && !duringFetch)
        duringFetch = Promise.resolve().then(async () => {
          await onFetch(root);
          mark({ kind: 'recall-control-complete' });
          await new Promise((resolve, reject) => child.send({ kind: 'recall-fetch-ack', attempt: event.attempt },
            error => error ? reject(error) : resolve()));
        }).catch(() => { fetchFailed = true; });
    });
    child.stdout.on('data', chunk => { if (!stdout) mark({ kind: 'stdout' }); stdout += chunk; });
    child.stderr.on('data', chunk => stderr += chunk);
    const done = new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (code, signal) => {
        // Close time must exclude callbacks, lock release and later parent work.
        const elapsedMs = monotonicMs() - started;
        events.push({ kind: 'exit', ms: elapsedMs });
        resolve({ code, signal, elapsedMs });
      });
    });
    workspace.defer(async () => {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      await done;
    });
    const timer = setTimeout(() => { hostKilled = true; child.kill('SIGTERM'); }, 3000);
    if (!stalledInput) child.stdin.end(JSON.stringify({ session_id: 'synthetic-session', prompt: 'Synthetic question' }));
    let outcome;
    try { outcome = await done; } finally { clearTimeout(timer); }
    await duringFetch;
    assert.ok(!fetchFailed, 'during_fetch_failed');
    if (holdQuotaLock) {
      // Keep the foreign holder live until after close and both residue checks.
      const foreignOwnerUnchanged = await readFile(lock, 'utf8') === ownerBefore &&
        await readFile(join(dirname(lock), ownerFile), 'utf8') === ownerFileBefore;
      const noChildResidue = JSON.stringify(await lockNames()) === JSON.stringify(namesBefore);
      unlock(); await holder;
      const cleaned = (await lockNames()).length === 0;
      mark({ kind: 'quota-lock-checked', foreignOwnerUnchanged, noChildResidue, cleaned });
    }
    return { ...outcome, stdout, stderr, hostKilled, events };
  } finally { await workspace.cleanup(); }
}

// Use finite messages/booleans so assertion diagnostics never dump context,
// request bodies, auth tokens or arbitrary stderr/reason text.
export function processViolations(result) {
  return [
    [result.code === 0, 'exit_code'], [result.signal === null, 'exit_signal'],
    [result.stderr === '', 'stderr'], [result.hostKilled === false, 'host_kill'],
    [result.elapsedMs < 3000, 'spawn_close_deadline'],
  ].filter(([ok]) => !ok).map(([, name]) => name);
}
export function assertProcessOutcome(result) {
  assert.deepEqual(processViolations(result), []);
}
export function assertScenario(name, result) {
  const count = kind => result.events.filter(event => event.kind === kind).length;
  assert.equal(count('telemetry-fetch'), 0, 'no_telemetry');
  if (name === 'success-slow-telemetry') {
    let envelope;
    try { envelope = JSON.parse(result.stdout); } catch { assert.fail('invalid_context_envelope'); }
    assert.ok(envelope !== null && typeof envelope === 'object' && !Array.isArray(envelope), 'context_object');
    assert.ok(JSON.stringify(Object.keys(envelope)) === JSON.stringify(['hookSpecificOutput']), 'envelope_fields');
    const output = envelope.hookSpecificOutput;
    assert.ok(output !== null && typeof output === 'object' && !Array.isArray(output), 'hook_output_object');
    assert.ok(JSON.stringify(Object.keys(output).sort()) === JSON.stringify(['additionalContext', 'hookEventName']), 'context_fields');
    assert.ok(output.hookEventName === 'UserPromptSubmit', 'context_event');
    assert.ok(typeof output.additionalContext === 'string' &&
      output.additionalContext.includes('Synthetic remembered preference.'), 'synthetic_memory_present');
    assert.equal(count('recall-fetch'), 1);
    return;
  }
  assert.ok(result.stdout === '', 'silent_stdout');
  if (name === 'unavailable-quota-lock') {
    assert.equal(count('quota-lock-contended'), 1);
    assert.equal(count('recall-fetch'), 0);
    const checked = result.events.find(event => event.kind === 'quota-lock-checked');
    assert.ok(checked?.foreignOwnerUnchanged, 'foreign_owner_unchanged');
    assert.ok(checked?.noChildResidue, 'no_child_lock_residue');
    assert.ok(checked?.cleaned, 'holder_cleanup');
    return;
  }
  const aborted = result.events.filter(event => event.kind === 'recall-aborted');
  assert.equal(aborted.length, 1);
  if (name === 'slow-recall') {
    assert.equal(count('recall-fetch'), 1);
    assert.ok(aborted[0].source === 'http', 'http_deadline');
  } else {
    assert.ok(name === 'schema-fallback', 'known_scenario');
    assert.equal(count('quota-lock-contended'), 1);
    const calls = result.events.filter(event => event.kind === 'recall-fetch');
    assert.equal(calls.length, 2);
    assert.equal(calls[0].hasSession, true); assert.equal(calls[1].hasSession, false);
    assert.equal(calls[1].sameSignal, true); assert.equal(calls[1].sameLegacyPayload, true);
    assert.ok(aborted[0].source === 'application', 'application_deadline');
  }
}
