import { join } from 'node:path';
import { privateDirectory, privateList, privateRemove, privateRead, privateWrite, syncDirectory } from './private-state.mjs';
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
  // These POSIX-private diagnostics have no portable Windows writer. Skipping
  // them cannot authorize content or delay a decision.
  if (!hostedPauseMode(config).barrier) return;
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
    if (!hostedPauseMode(config).barrier) volatileState(config).valid = false;
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
const pausePath = config => join(config.root, 'hosted-pause', hostedTargetId(config) + '.json');
const intentDirectory = config => pausePath(config) + '.intents';
const gatePath = config => pausePath(config) + '.gate';
const highWaterPath = config => pausePath(config) + '.high-water';
// A timed-out publisher still journals. Limit every admitted critical section
// at its synchronous side effect, including an uncooperative filesystem wait.
const GATE_WINDOW_MS = 250;
// Capability is selected once for each config, never from a lock failure.
// Tests inject the platform without changing the host or its lock semantics.
const modes = new WeakMap(), volatileStates = new Map();
// Portable mode is an explicit client capability. Unconfigured consumers keep
// the shared barrier (including consumers whose installation is unsupported).
export function hostedPauseMode(config, platform) {
  if (!modes.has(config)) modes.set(config, Object.freeze({ barrier: platform !== 'win32' }));
  return modes.get(config);
}
function volatileState(config) {
  const key = config.root + ':' + hostedTargetId(config);
  if (!volatileStates.has(key)) volatileStates.set(key, { valid: false });
  return volatileStates.get(key);
}
const intentName = remote => `${remote.generation}.${remote.paused}`;
const intentBytes = remote => JSON.stringify({ generation: remote.generation, paused: remote.paused });

function validateTransition(remote, previous) {
  if (previous && (!conforms('pause-state', previous) || !previous.enforced ||
      remote.generation < previous.generation ||
      (remote.generation === previous.generation && remote.paused && !previous.paused))) {
    throw new Error('pause_unavailable');
  }
}
async function readPause(config) {
  const bytes = await privateRead(pausePath(config), { missing: true });
  return { bytes, previous: bytes === undefined ? null : JSON.parse(bytes) };
}
// Immutable records cannot be overwritten by an older observer that finishes
// late. Within one generation, resume is irreversible: false supersedes true.
// Keep these content-free records across crashes; diagnostics are not authority.
function olderIntentName(name, remote) {
  const match = /^(0|[1-9]\d*)\.(true|false)\.(json|complete)$/u.exec(name);
  return match && (Number(match[1]) < remote.generation ||
    (Number(match[1]) === remote.generation && match[2] === 'true' && !remote.paused));
}
async function pruneIntents(config, intent) {
  const directory = intentDirectory(config);
  // A concurrent higher intent may be visible before its writer's directory
  // sync. Finish that sync ourselves before deleting any dominated authority.
  await syncDirectory(directory);
  for (const name of await privateList(directory)) {
    if (olderIntentName(name, intent)) await privateRemove(join(directory, name));
  }
  await syncDirectory(directory);
}
async function highestIntent(config) {
  const directory = intentDirectory(config);
  const checkpoint = await privateRead(highWaterPath(config), { missing: true });
  let selected;
  if (checkpoint !== undefined) {
    const value = JSON.parse(checkpoint);
    if (Object.keys(value ?? {}).sort().join(',') !== 'generation,paused' ||
        !Number.isSafeInteger(value.generation) || value.generation < 0 ||
        typeof value.paused !== 'boolean') throw new Error('pause_unavailable');
    selected = { ...value, name: intentName(value) + '.json' };
  }
  const names = await privateList(directory, { missing: true }) ?? [];
  for (const name of names) {
    if (!name.endsWith('.json')) continue; // Incomplete atomic-write temporaries.
    const match = /^(0|[1-9]\d*)\.(true|false)\.json$/u.exec(name);
    const generation = Number(match?.[1]);
    if (!match || !Number.isSafeInteger(generation)) throw new Error('pause_unavailable');
    const paused = match[2] === 'true';
    if (!selected || generation > selected.generation ||
        (generation === selected.generation && !paused)) selected = { name, generation, paused };
  }
  if (!selected) return undefined;
  // Completed observations checkpoint their durable high water before pruning.
  // Keep its matching immutable intent/receipt so all crash stages use the
  // same validation. Successful transitions retain exactly two journal names.
  const value = JSON.parse(await privateRead(join(directory, selected.name)));
  if (Object.keys(value ?? {}).sort().join(',') !== 'generation,paused' ||
      value.generation !== selected.generation || value.paused !== selected.paused) {
    throw new Error('pause_unavailable');
  }
  return { ...value, needsPrune: names.some(name => olderIntentName(name, value)) };
}
function validateIntent(remote, intent) {
  if (intent && (remote.generation < intent.generation ||
      (remote.generation === intent.generation && remote.paused && !intent.paused))) {
    throw new Error('pause_unavailable');
  }
}
async function writeOnce(path, bytes) {
  const previous = await privateRead(path, { missing: true });
  if (previous === undefined) await privateWrite(path, bytes, { exclusive: true });
  else if (previous !== bytes) throw new Error('pause_unavailable');
}
// Re-read the durable intent at the decision boundary, including after local
// control-lock waits. Callers pass check to the local gate as its guard. Work
// only starts a request (returns its promise in an object) or emits output.
export async function withHostedPauseGate(config, generation, work) {
  if (!hostedPauseMode(config).barrier) {
    const check = async () => {
      const state = volatileState(config);
      if (!state.valid || state.previous?.paused || state.previous?.generation !== generation)
        throw new Error('pause_unavailable');
    };
    await check();
    return work(check);
  }
  const check = async () => {
    const { previous } = await readPause(config), intent = await highestIntent(config);
    if (!previous || !conforms('pause-state', previous) || !previous.enforced ||
        previous.paused || previous.generation !== generation) throw new Error('pause_unavailable');
    validateIntent(previous, intent);
    if (intent) {
      const completed = await privateRead(join(intentDirectory(config), intentName(previous) + '.complete'), { missing: true });
      if (completed !== intentBytes(previous)) throw new Error('pause_unavailable');
    }
  };
  return stateLock(gatePath(config), async () => {
    const deadline = performance.now() + GATE_WINDOW_MS;
    check.beforeStart = () => {
      if (performance.now() >= deadline) throw new Error('pause_unavailable');
    };
    await check();
    return work(check);
  });
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
  if (!hostedPauseMode(config).barrier) {
    const state = volatileState(config);
    validateTransition(remote, state.previous);
    state.previous = remote; state.valid = true;
    return remote;
  }
  const file = pausePath(config);
  // Read-only on an unchanged observation. Record a changed, validated denial
  // BEFORE attempting the pause lock: timeout, rotation failure and process
  // death must never erase knowledge of a newer hosted generation.
  {
    const { previous } = await readPause(config);
    validateTransition(remote, previous);
    validateIntent(remote, await highestIntent(config));
    if ((!previous && (remote.generation > 0 || remote.paused)) ||
        (previous && (remote.generation !== previous.generation || remote.paused !== previous.paused))) {
      const publish = async () => {
        const directory = intentDirectory(config);
        await privateDirectory(directory);
        // Persist newly created ancestor entries too. A concurrent writer may
        // already expose the directory/record while its sync is still pending.
        await syncDirectory(config.root);
        await syncDirectory(join(config.root, 'hosted-pause'));
        // Identical exclusive publications are safe across processes. Even when
        // the name exists, finish its directory sync before attempting the lock.
        await privateWrite(join(directory, intentName(remote) + '.json'), intentBytes(remote), { exclusive: true });
        // Bound pending history even when rotation/publication repeatedly fails.
        // The durable maximum intent alone supersedes every older intent/receipt.
        await pruneIntents(config, await highestIntent(config));
      };
      let entered = false;
      try {
        await stateLock(gatePath(config), async () => { entered = true; await publish(); });
      } catch (error) {
        // Never discard a validated observation because the shared gate failed.
        // If publication itself failed, retain that failure rather than retrying
        // a partially completed write as though it were an acquisition failure.
        if (entered) throw error;
        await publish();
      }
    }
  }
  const observed = await stateLock(file + '.lock', async () => {
    signal?.throwIfAborted();
    const { bytes, previous } = await readPause(config);
    validateTransition(remote, previous);
    const intent = await highestIntent(config);
    validateIntent(remote, intent);
    // Rotate the shared LOCAL barrier once per observed hosted pause. Do not
    // clear a pause the user established locally; hosted state is a separate gate.
    if ((!previous && (remote.generation > 0 || remote.paused)) ||
        (previous && remote.generation !== previous.generation)) {
      await rotateAutomaticBoundary(config.root);
    }
    const next = JSON.stringify(remote);
    const completion = intent ? join(intentDirectory(config), intentName(remote) + '.complete') : undefined;
    const completed = completion ? await privateRead(completion, { missing: true }) : undefined;
    // An interrupted directory sync may have left identical but uncommitted
    // bytes. Re-publish those bytes durably before issuing the completion receipt.
    if (bytes !== next || (completion && completed === undefined)) await privateWrite(file, next);
    // A visible rename is insufficient if publication's directory sync failed.
    // This receipt is only written AFTER rotation and durable pause publication.
    // A retry repairs an interrupted publication even when its bytes now match.
    if (completion) {
      await writeOnce(completion, intentBytes(remote));
      const checkpoint = await privateRead(highWaterPath(config), { missing: true });
      if (checkpoint !== intentBytes(remote) || intent.needsPrune) {
        // Completed observations checkpoint authority before final compaction.
        // A retry also finishes pruning interrupted after the checkpoint sync.
        await privateWrite(highWaterPath(config), intentBytes(remote));
        await pruneIntents(config, remote);
      }
    }
    return remote;
  });
  if (!observed) throw new Error('pause_unavailable');
  return observed;
}
