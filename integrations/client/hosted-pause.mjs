import { join } from 'node:path';
import { privateList, privateRemove, privateRead, privateWrite } from './private-state.mjs';
import { stateLock } from './state-lock.mjs';
import { rotateAutomaticBoundary } from './automatic-policy.mjs';
import { conforms } from './hosted-contract.mjs';
import { hostedTargetId } from './transport-hosted.mjs';

// H5 source evidence: cairn-wiki origin/main app/api/memory/pause-state/route.ts.
// A missing, unenforced or regressing state never authorizes capture/injection.
const statusPath = config => join(config.root, 'hosted-pause-status', hostedTargetId(config) + '.json');
// Timestamped atomic records avoid lock contention for either outcome. Keep the
// old single-file format readable, including its original freshness semantics.
const statusDirectory = config => statusPath(config) + '.observations';
const observationName = (state, at) => at.replace(/\D/gu, '') + '.' + state + '.json';
const isObservation = name => /^\d{17}\.(available|unavailable)\.json$/u.test(name);
function decodeStatus(bytes) {
  if (bytes === undefined) return { state: 'not yet observed' };
  let value;
  try { value = JSON.parse(bytes); }
  catch { return { state: 'observation unreadable' }; }
  if (!value || value.version !== 1 || !['available','unavailable'].includes(value.state) ||
    typeof value.observedAt !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value.observedAt) ||
    !Number.isFinite(Date.parse(value.observedAt)) ||
    new Date(value.observedAt).toISOString() !== value.observedAt ||
    Date.parse(value.observedAt) > Date.now()) return { state: 'observation invalid' };
  return { state: value.state, observedAt: value.observedAt,
    stale: Date.now() - Date.parse(value.observedAt) > 300000 };
}
export async function hostedPauseStatus(config) {
  try {
    const directory = statusDirectory(config);
    // A newer durable writer may prune the selected old record between list and
    // read. Retry that disappearance; never fall back to stale available bytes.
    for (let attempt = 0; attempt < 8; attempt++) {
      const previous = decodeStatus(await privateRead(statusPath(config), { missing: true }));
      const names = await privateList(directory, { missing: true });
      if (!names) return previous;
      const latest = names.filter(isObservation).sort().at(-1);
      if (!latest) return previous;
      const bytes = await privateRead(join(directory, latest), { missing: true });
      if (bytes === undefined) continue;
      const value = decodeStatus(bytes);
      if (!value.observedAt || observationName(value.state, value.observedAt) !== latest)
        return { state: 'observation invalid' };
      if (previous.observedAt > value.observedAt ||
          (previous.observedAt === value.observedAt && previous.state === 'unavailable')) return previous;
      return value;
    }
    return { state: 'observation unreadable' };
  } catch { return { state: 'observation unreadable' }; }
}
// Only diagnostics read these records. No status lock or retries delay failure
// publication. Names order by observation time, with unavailable winning ties.
async function publishStatus(config, state, observedAt) {
  const directory = statusDirectory(config), name = observationName(state, observedAt);
  try {
    await privateWrite(join(directory, name), JSON.stringify({version:1,state,observedAt}));
    // Publish durably before pruning. Only strictly older names may be removed:
    // a delayed writer can never delete a newer outcome, even after a crash.
    for (const older of (await privateList(directory)).filter(isObservation)) {
      if (older < name) await privateRemove(join(directory, older));
    }
  } catch { /* Diagnostics cannot change the observation's result. */ }
}
export async function observeHostedPause(config, token, signal, { available } = {}) {
  try {
    const remote = await observe(config, token, signal);
    const observedAt = new Date().toISOString();
    if (available) available(observedAt);
    else await publishStatus(config, 'available', observedAt);
    return remote;
  } catch (error) {
    await publishStatus(config, 'unavailable', new Date().toISOString());
    throw error;
  }
}
// Recall can coalesce successful diagnostics after its fetch/decision. Privacy
// barriers stay inside observe(), and failures are always published immediately.
export function deferHostedPauseStatus(config, token, signal) {
  let pending;
  return {
    async observe() {
      try {
        return await observeHostedPause(config, token, signal, { available: at => { pending = at; } });
      } catch (error) { pending = undefined; throw error; }
    },
    async publish() {
      if (pending && !signal?.aborted) await publishStatus(config, 'available', pending);
      pending = undefined;
    },
  };
}
async function observe(config, token, signal) {
  signal?.throwIfAborted();
  const response = await fetch(config.endpoint + '/api/memory/pause-state', {
    headers: { authorization: `Bearer ${token}`, 'cache-control': 'no-store' },
    redirect: 'error', signal,
  });
  if (response.status !== 200) throw new Error('pause_unavailable');
  const reader = response.body.getReader();
  let length = 0; const chunks = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 4096) throw new Error('pause_unavailable');
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  const remote = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (!conforms('pause-state', remote) || !remote.enforced) throw new Error('pause_unavailable');
  const file = join(config.root, 'hosted-pause', hostedTargetId(config) + '.json');
  const observed = await stateLock(file + '.lock', async () => {
    signal?.throwIfAborted();
    const bytes = await privateRead(file, { missing: true });
    const previous = bytes === undefined ? null : JSON.parse(bytes);
    if (previous && (!conforms('pause-state', previous) || !previous.enforced ||
        remote.generation < previous.generation ||
        (remote.generation === previous.generation && remote.paused && !previous.paused))) {
      throw new Error('pause_unavailable');
    }
    // Rotate the shared LOCAL barrier once per observed hosted pause. Do not
    // clear a pause the user established locally; hosted state is a separate gate.
    if ((!previous && remote.generation > 0) ||
        (previous && remote.generation !== previous.generation)) {
      await rotateAutomaticBoundary(config.root);
    }
    // The locked, validated bytes already carry this exact privacy barrier.
    const next = JSON.stringify(remote);
    if (bytes !== next) await privateWrite(file, next);
    return remote;
  });
  if (!observed) throw new Error('pause_unavailable');
  return observed;
}
