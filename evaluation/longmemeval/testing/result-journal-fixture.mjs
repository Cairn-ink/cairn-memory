import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { inspectMem0NativeArtifact } from '../../experiment-budget/mem0-native-artifact.mjs';
import { mem0NativeConfiguration } from '../../experiment-budget/mem0-native-gateway.mjs';
import { manifestSourceFamily } from '../mixed-source-policy.mjs';
import { packMixedAnswer } from '../mixed-answer.mjs';
import { completeMixedJournalPhase, enterMixedJournalArm, recordMixedJournalArm,
  startMixedJournalPhase } from '../mixed-result-journal.mjs';
import { completionOnce, trackedTransport } from '../mixed-transport.mjs';
import { freeze, hash, reportSnapshot } from '../mixed-validation.mjs';

// An inspected layout sufficient for runner preflight. Never execute this fake Python.
export function syntheticNativeDescriptors(root, actual = false) {
  const configuration = mem0NativeConfiguration({ topK: 6, threshold: 0,
    childTimeoutMs: 3_600_000, httpTimeoutMs: 10_000 });
  if (actual) return { configuration, artifact: inspectMem0NativeArtifact({
    venvRoot: process.env.CAIRN_MEM0_NATIVE_VENV_ROOT,
    pythonRoot: process.env.CAIRN_MEM0_NATIVE_PYTHON_ROOT }) };
  const venvRoot = join(root, 'venv'), pythonRoot = join(root, 'python');
  for (const directory of [join(venvRoot, 'bin'),
    join(venvRoot, 'lib/python3.11/site-packages/mem0/memory'),
    join(venvRoot, 'lib/python3.11/site-packages/mem0ai-2.2.0.dist-info'),
    join(pythonRoot, 'bin'), join(pythonRoot, 'lib/python3.11/encodings')]) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
  }
  writeFileSync(join(venvRoot, 'pyvenv.cfg'), `home = ${join(pythonRoot, 'bin')}\n`);
  writeFileSync(join(venvRoot, 'lib/python3.11/site-packages/mem0/memory/main.py'), '# synthetic\n');
  writeFileSync(join(venvRoot, 'lib/python3.11/site-packages/mem0ai-2.2.0.dist-info/METADATA'),
    'Name: mem0ai\nVersion: 2.2.0\n');
  writeFileSync(join(pythonRoot, 'bin/python3.11'), '#!/fake-never-execute\n');
  writeFileSync(join(pythonRoot, 'lib/python3.11/encodings/__init__.py'), '# synthetic\n');
  symlinkSync(join(pythonRoot, 'bin/python3.11'), join(venvRoot, 'bin/python'));
  return { configuration, artifact: inspectMem0NativeArtifact({ venvRoot, pythonRoot }) };
}

// Real X receipts and fake-HTTP answers; scorer validates all generation scopes normally.
export async function syntheticScoringGeneration(fixture, guard, resultJournal) {
  const { prepared } = fixture;
  const entry = { questionId: prepared.roster[0].questionId,
    question: { text: 'What synthetic fact?', date: '2024-01-02 10:00' },
    caseDigest: prepared.preflight[0].caseDigest, preflight: { status: 'ready', reason: null },
    arms: ['cairn', 'mem0'].map(name => ({ name, status: 'completed', reason: null,
      answer: null, scope: null, diagnostics: {} })) };
  if (resultJournal) startMixedJournalPhase(resultJournal, 'generation', prepared);
  for (const [ordinal, name] of prepared.roster[0].armOrder.entries()) {
    if (resultJournal) enterMixedJournalArm(resultJournal, 'generation', ordinal);
    const caseId = prepared.roster[0].arms.find(arm => arm.name === name).scopeId;
    const outcome = await guard.withCaseScope({ phase: 'generation', caseId }, async () => {
      const transport = trackedTransport();
      try {
        const request = packMixedAnswer({ question: entry.question, units: [], countTokens: () => 10 }).request;
        return { answer: await completionOnce({ guard, stage: 'answer', request,
          apiKey: 'JOURNAL_KEY_CANARY', timeoutMs: 200_000, transport }) };
      } finally { await transport.drain(); }
    });
    assert.equal(outcome.status, 'completed');
    const arm = entry.arms.find(arm => arm.name === name), snapshot = guard.caseScopeSnapshot();
    arm.answer = outcome.value.answer;
    arm.scope = { ordinal: snapshot.ordinal, status: snapshot.status, reason: snapshot.reason };
    if (resultJournal) recordMixedJournalArm(resultJournal, 'generation', ordinal, entry, arm);
  }
  const report = freeze(reportSnapshot({ schemaVersion: manifestSourceFamily(prepared.manifest).generation,
    manifest: prepared.manifest, roster: prepared.roster,
    manifestDigest: hash('cairn.lme.mixed.manifest.v1', prepared.manifest),
    rosterDigest: hash('cairn.lme.mixed-source-pair.roster.v1', prepared.roster),
    cases: [entry], halted: false, haltReason: null }));
  if (resultJournal) completeMixedJournalPhase(resultJournal, 'generation', report);
  return report;
}

export async function interruption(t, phase, actualNative = false, observations = false, sourceOptions = {}) {
  if (phase === 'scoring' && !actualNative && observations) {
    throw new Error('scoring_interruption_observations_require_actual_native');
  }
  const workspace = createTestWorkspace(null, { prefix: 'cairn-journal-interrupt-' });
  const child = spawn(process.execPath, [fileURLToPath(new URL('./result-journal-child.mjs',
    import.meta.url)), workspace.path, phase, actualNative ? 'native' : 'synthetic',
    observations ? 'enabled' : 'omitted', JSON.stringify(sourceOptions)],
  { detached: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  const groups = new Map(child.pid ? [[child.pid, processIdentity(child.pid)]] : []);
  child.on('message', message => {
    if (message.kind === 'native_group' && Number.isSafeInteger(message.pid) && message.pid > 0
      && (message.startTime === null || /^\d+$/u.test(message.startTime))) {
      groups.set(message.pid, message.startTime);
    }
  });
  let stderr = '';
  child.stderr.on('data', data => { stderr += data; });
  const exited = new Promise(resolve => child.once('close', (code, signal) => resolve({ code, signal })));
  // Cleanup is registered before waiting. Verify owned child/native groups have
  // stopped even on assertion/setup failure, before allowing workspace removal.
  let cleaned;
  const cleanup = () => cleaned ??= (async () => {
    for (const [group, startTime] of groups) {
      if (!groupAlive(group)) continue;
      // Never signal an exited/reaped native PID now owned by another process.
      // Unverifiable ownership retains scratch instead of guessing at a group.
      if (process.platform === 'linux' && (!startTime || processIdentity(group) !== startTime)) {
        throw new Error('journal_child_group_identity_changed_workspace_retained');
      }
      try { process.kill(-group, 'SIGKILL'); }
      catch (error) { if (error.code !== 'ESRCH') throw error; }
    }
    await exited;
    for (let attempt = 0; attempt < 100; attempt++) {
      if ([...groups.keys()].every(group => !groupAlive(group))) { await workspace.cleanup(); return; }
      await delay(25);
    }
    throw new Error('journal_children_still_running_workspace_retained');
  })();
  t.after(cleanup);
  const checkpoint = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`checkpoint_timeout:${stderr}`)), 45_000);
    const onMessage = message => {
      if (!message.checkpoint) return;
      clearTimeout(timer); child.off('message', onMessage); resolve(message);
    };
    child.on('message', onMessage);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', () => { clearTimeout(timer); reject(new Error(`child_before_checkpoint:${stderr}`)); });
  });
  assert.equal(checkpoint.checkpoint, phase);
  assert.equal(checkpoint.completedScopes, phase === 'generation' ? 1 : 3);
  if (phase === 'generation') assert.equal(checkpoint.actual, 'Synthetic memory fact.');
  else assert.equal(checkpoint.actual.correct, true);
  assert.ok(checkpoint.dispatches > 0, 'real HTTP seam and scope completed');
  child.kill('SIGKILL');
  assert.equal((await exited).signal, 'SIGKILL');
  let observed = null;
  if (existsSync(checkpoint.directory)) {
    const { inspectMixedResultJournal } = await import('../mixed-result-journal.mjs');
    observed = inspectMixedResultJournal({ directory: checkpoint.directory });
  }
  const retained = observed?.phases[phase].arms[0];
  assert.equal(phase === 'generation' ? retained?.result?.answer?.text
    : retained?.result?.judgment?.correct, phase === 'generation' ? checkpoint.actual : true,
  'first actual completed arm must survive SIGKILL before whole-phase return');
  assert.equal(retained.state, 'terminal');
  assert.equal(observed.phases[phase].arms[1].state, 'entered');
  assert.equal(observed.phases[phase].completion, null);
  assert.equal(observed.phases[phase].arms.filter(arm => arm.state === 'terminal').length, 1);
  if (observations) {
    const cairn = observed.phases.generation.arms.find(arm => arm.name === 'cairn');
    assert.equal(cairn.state, 'terminal');
    assert.equal(cairn.result.status, 'completed');
    assert.ok(cairn.result.diagnostics.adapterPhaseTiming);
    assert.equal(cairn.result.diagnostics.recallWitness.closed, true);
    assert.equal(cairn.result.diagnostics.recallWitness.disposed, true);
    assert.equal(cairn.result.answer.text, 'Synthetic memory fact.');
  }
  await cleanup();
  assert.equal(existsSync(workspace.path), false);
}

function groupAlive(group) {
  if (process.platform !== 'linux') {
    try { process.kill(-group, 0); return true; }
    catch (error) { if (error.code === 'ESRCH') return false; throw error; }
  }
  for (const name of readdirSync('/proc')) {
    if (!/^\d+$/u.test(name)) continue;
    let stat;
    try { stat = readFileSync(`/proc/${name}/stat`, 'utf8'); }
    catch (error) { if (['ENOENT', 'ESRCH'].includes(error.code)) continue; throw error; }
    const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
    if (Number(fields[2]) === group && !['Z', 'X'].includes(fields[0])) return true;
  }
  return false;
}

function processIdentity(pid) {
  if (process.platform !== 'linux') return null;
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
    return stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19];
  } catch (error) { if (['ENOENT', 'ESRCH'].includes(error.code)) return null; throw error; }
}
