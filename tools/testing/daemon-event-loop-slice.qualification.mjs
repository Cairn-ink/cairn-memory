// Outside CI. Run with --store PATH (quiescent synthetic input) or --synthetic N.
import { createDaemonQualification, daemonStoreCommand, waitQualification, qualificationValue, daemonQualificationQuery, stopQualificationOwner, reportQualificationFailure } from './fixtures/daemon-qualification.mjs';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { daemonMonotonicMs } from '../../adapters/mcp/local-daemon-liveness.mjs';
import { classifyDaemonIdle } from './fixtures/daemon-idle.mjs';
async function main() {
const args = process.argv.slice(2);
const limitIndex = args.indexOf('--upkeep-limit-s');
let upkeepLimitS = 3600;
if (limitIndex >= 0) {
  upkeepLimitS = Number(args[limitIndex + 1]);
  if (!Number.isFinite(upkeepLimitS) || upkeepLimitS <= 0) throw Error('qualification_upkeep_limit');
  args.splice(limitIndex, 2);
}
const q = await createDaemonQualification(args), { w, before } = q;
try {
  console.error('qualification_phase:first_activation');
  const child = w.child({ role: 'candidate', bootstrap: await w.bootstrap(), instrumentSlices: true }); child.release();
  await waitQualification(w.descriptor, 'measured candidate publishes');
  let client = w.forward(), activationRefusals = 0; client.release();
  const outcome = await waitQualification(() => client.messages.find(m => m.kind === 'connected' || m.kind === 'forwarder-done'), 'first activation settles');
  if (outcome.kind === 'forwarder-done') {
    if (outcome.code?.refused !== 'daemon_connect_timeout') throw Error('qualification_activation_refused');
    activationRefusals++;
    // A long first activation must be measured, without a new forwarder trying
    // takeover while the candidate is still blocked. IPC settles after its
    // event loop resumes; then wait for its normal heartbeat before retrying.
    child.process.send({ kind: 'slice-report', sequence: 'activation-probe' });
    await waitQualification(() => child.messages.find(m => m.kind === 'slice-report' && m.sequence === 'activation-probe'), 'candidate finishes activation', 300000);
    await waitQualification(async () => {
      const directory = join(w.root, 'run', 'cairn-memory');
      const name = (await readdir(directory)).find(name => name.endsWith('.stamp'));
      return name && daemonMonotonicMs() - JSON.parse(await readFile(join(directory,name),'utf8')).monotonicMs < 10000;
    }, 'normal heartbeat resumes before attaching again');
    client = w.forward(); client.release();
  }
  const descriptor = await w.connect(client);
  const phase = async value => {
    console.error('qualification_phase:' + value);
    child.process.send({ kind: 'slice-phase', phase: value });
    await waitQualification(() => child.messages.some(m => m.kind === 'slice-phase-ready' && m.phase === value), 'phase installed before workload: ' + value);
  };
  const afterActivation = await daemonStoreCommand('inspect', w.path);
  await phase('admission');
  const memories = [];
  for (let i=0;i<24;i++) memories.push(qualificationValue(await client.tool('remember_memory', { content: 'Synthetic measured cobalt telescope admission ' + i, kind: 'fact' })).memory);
  await daemonStoreCommand('capture', w.path, 40, before.namespace);
  await phase('upkeep');
  let coverage, rawCoverage, idle = false, polls = 0;
  const upkeepStarted = performance.now(), deadline = upkeepStarted + upkeepLimitS * 1000;
  do {
    const result = await client.tool('find_memory_candidates', daemonQualificationQuery);
    // Check fatal errors before probing. A rebuilding index is normal upkeep.
    classifyDaemonIdle({ result });
    const probe = await client.request('tools/call', { name: 'read_memory_context', arguments: { ...daemonQualificationQuery, query: '__cairn_qualification_index_probe_9d72aa__', maxTokens: 4000, deadlineMs: 5000 } });
    if (probe.error || probe.result?.isError) throw Error('qualification_upkeep_probe_failed');
    rawCoverage = probe.result?._meta?.['ink.cairn/context-read-diagnostics']?.coverage?.raw;
    const state = classifyDaemonIdle({ result, rawReadCoverage: rawCoverage, deadlineReached: performance.now() >= deadline });
    coverage = state.coverage; idle = state.idle;
    if (++polls % 10 === 0) console.error(JSON.stringify({ phase: 'upkeep', polls, memory_indexed: coverage?.byType?.memory?.indexed, memory_eligible: coverage?.byType?.memory?.eligible, raw: rawCoverage }));
    if (!idle) await new Promise(resolve => setTimeout(resolve, 1000));
  } while (!idle && performance.now() < deadline);
  const upkeepElapsedMs = performance.now() - upkeepStarted;
  // No read-only complete-population Raw status is exposed by this engine.
  // Keep the original read criterion; deadline expiry still preserves slices.
  if (!idle) process.exitCode = 2;
  // Leave a full maintenance interval while the real daemon stays attached.
  await new Promise(resolve => setTimeout(resolve, 1100));
  await phase('commit');
  qualificationValue(await client.tool('forget_memory', { memoryId: memories[0].id, expectedRevision: memories[0].revision }));
  await phase('recall');
  const response = await client.request('tools/call', { name: 'read_memory_context', arguments: { ...daemonQualificationQuery, maxTokens: 4000, deadlineMs: 5000 } });
  if (response.error || response.result?.isError) throw Error('qualification_recall_failed');
  await new Promise(resolve => setTimeout(resolve, 30));
  child.process.send({ kind: 'slice-report', sequence: 'final' });
  const measured = await waitQualification(() => child.messages.find(m => m.kind === 'slice-report' && m.sequence === 'final'), 'candidate reports measured event-loop blocks');
  client.process.stdin.end(); await waitQualification(() => client.messages.some(m => m.kind === 'forwarder-done'), 'measurement forwarder closes');
  await stopQualificationOwner(w, descriptor); await waitQualification(() => child.exit, 'measured candidate exit recorded');
  if (child.exit.code !== 0) throw Error('qualification_candidate_failed');
  const { namespace, ...shape } = before;
  console.log(JSON.stringify({ qualification: 'daemon_event_loop_slice', input: shape,
    migration: { before: before.schema_version, after: afterActivation.schema_version,
      schema_before: before.schema_digest, schema_after: afterActivation.schema_digest,
      performed: before.schema_version !== afterActivation.schema_version || before.schema_digest !== afterActivation.schema_digest, note: before.schema_version === afterActivation.schema_version && before.schema_digest === afterActivation.schema_digest ? 'none_needed' : 'first_activation_migrated' },
    ...measured.value, coverage_idle: idle, raw_read_coverage: rawCoverage, memory_coverage: coverage,
    raw_index_coverage: null, raw_index_completion: 'surface_unavailable',
    upkeep_limit_s: upkeepLimitS, upkeep_elapsed_ms: upkeepElapsedMs, exit_code: idle ? 0 : 2, activation_refusals: activationRefusals,
    workload: { admission_memories: 24, raw_capture_messages: 40, forget_commits: 1, recall_max_tokens: 4000 }, candidate_exit: child.exit.code }));
} finally { await q.close(); }

}
try { await main(); } catch (error) { reportQualificationFailure(error); }
