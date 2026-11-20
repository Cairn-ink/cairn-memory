// Outside CI; each sample uses the same private store copy, no provider keys.
import { createDaemonQualification, daemonStoreCommand, waitQualification, stopQualificationOwner, reportQualificationFailure } from './fixtures/daemon-qualification.mjs';
import { join } from 'node:path';
async function main() {
const q = await createDaemonQualification(process.argv.slice(2)), { w, before } = q;
const samples = { per_session: [], cold: [], warm: [] };
let coldFallbacks = 0, afterActivation;
const initialize = async client => {
  const reply = await client.request('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'synthetic-qualification', version: '1' } });
  if (reply.error || !reply.result?.serverInfo) throw Error('qualification_initialize_failed');
  return client.responseTimes.get(reply.id) - client.startedAt;
};
try {
  // Cold goes first so an older-layout input migrates in its first daemon
  // activation. Later samples reuse that same upgraded private copy.
  for (let i=0;i<10;i++) {
    console.error('qualification_cold_warm_sample:' + (i+1));
    const cold = w.child({ args: w.args, fallbackSession: true, options: { root: join(w.root, 'run'), environment: {} } }); cold.release();
    samples.cold.push(await initialize(cold));
    await waitQualification(() => cold.messages.some(m => m.kind === 'connected' || m.kind === 'fallback-session'), 'cold route metadata arrives');
    if (cold.messages.some(m => m.kind === 'fallback-session')) coldFallbacks++;
    if (i===0) afterActivation = await daemonStoreCommand('inspect', w.path);
    const warm = w.forward(); warm.release(); const descriptor = await w.connect(warm);
    if (!warm.lines.some(m => m.result?.serverInfo)) throw Error('qualification_warm_initialize_failed');
    const reply = warm.lines.find(m => m.result?.serverInfo);
    samples.warm.push(warm.responseTimes.get(reply.id) - warm.startedAt);
    cold.process.stdin.end(); warm.process.stdin.end();
    await waitQualification(() => warm.messages.some(m => m.kind === 'forwarder-done') && cold.messages.some(m => m.kind === 'forwarder-done'), 'sample forwarders close');
    await stopQualificationOwner(w, descriptor);
    await waitQualification(() => cold.exit && warm.exit, 'both supervised sample forwarders exit');
    if (cold.exit.code !== 0 || warm.exit.code !== 0) throw Error('qualification_sample_failed');
  }
  for (let i=0;i<10;i++) {
    console.error('qualification_per_session_sample:' + (i+1));
    const client = w.child({ role: 'per-session', args: w.args }); client.release();
    samples.per_session.push(await initialize(client));
    client.process.stdin.end(); await waitQualification(() => client.exit, 'per-session sample exits');
    if (client.exit.code !== 0) throw Error('qualification_per_session_failed');
  }
  const summary = Object.fromEntries(Object.entries(samples).map(([name, values]) => {
    const sorted = [...values].sort((a,b) => a-b);
    return [name, { samples_ms: values, median_ms: (sorted[4]+sorted[5])/2, p95_ms: sorted[9] }];
  }));
  const { namespace, ...shape } = before;
  console.log(JSON.stringify({ qualification: 'daemon_attach_latency', input: shape, ...summary,
    cold_exceeded_connect_budget: coldFallbacks, cold_fallbacks: coldFallbacks,
    migration: { before: before.schema_version, after: afterActivation.schema_version,
      schema_before: before.schema_digest, schema_after: afterActivation.schema_digest,
      performed: before.schema_version !== afterActivation.schema_version || before.schema_digest !== afterActivation.schema_digest, note: before.schema_version === afterActivation.schema_version && before.schema_digest === afterActivation.schema_digest ? 'none_needed' : 'first_activation_migrated' } }));
} finally { await q.close(); }

}
try { await main(); } catch (error) { reportQualificationFailure(error); }
