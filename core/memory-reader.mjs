import { createReaderWorkerLifecycle } from './reader-worker-lifecycle.mjs';
import { membersInput } from './topic-members-input.mjs';
import { performance } from 'node:perf_hooks';
import { Worker } from 'node:worker_threads';
import { readerOptions, overviewInput, readerFailure, safeReaderFailure, safeLegacyReaderFailure } from './topic-overview-input.mjs';

/** The trusted host authenticates ownerId; this handle only enforces its boundary. */
export function openMemoryReader(input) {
  const options = readerOptions(input);
  let idle, closed = false;
  const lifecycle = createReaderWorkerLifecycle();
  const stop = () => lifecycle.stop();
  function finish(slot, result) {
    if (lifecycle.pending !== slot) return;
    if (lifecycle.worker && !closed) {
      lifecycle.worker.unref();
      idle = setTimeout(() => { void stop(); }, 60000);
      lifecycle.idle = idle; idle.unref();
    }
    lifecycle.finish(slot, result);
  }
  function cancel(slot, code) {
    if (lifecycle.pending !== slot) return;
    stop();
    finish(slot, readerFailure(code));
  }
  function failed(instance, code) {
    if (lifecycle.worker !== instance) return;
    const slot = lifecycle.pending;
    stop();
    if (slot) finish(slot, readerFailure(code));
  }
  function start() {
    if (lifecycle.worker) return lifecycle.worker;
    const instance = new Worker(new URL('./topic-overview-worker.mjs', import.meta.url), {
      workerData: options, env: {}, execArgv: [],
      resourceLimits: { maxOldGenerationSizeMb: 64 }, stdout: true, stderr: true,
    });
    instance.stdout.resume(); instance.stderr.resume();
    lifecycle.worker = instance;
    instance.on('message', result => {
      if (lifecycle.worker !== instance || !lifecycle.pending) return;
      if ((result?.ok && lifecycle.pending.expiresAt !== undefined && performance.now() >= lifecycle.pending.expiresAt) || result?.error?.code === 'read_timeout') failed(instance, 'read_timeout');
      else finish(lifecycle.pending, result);
    });
    instance.on('error', () => { failed(instance, 'reader_failed'); });
    instance.on('exit', () => { failed(instance, 'reader_failed'); });
    return instance;
  }
  async function dispatch(input, members = false) {
    if (closed) return readerFailure('store_closed');
    const started = performance.now();
    let request;
    try { request = (members ? membersInput : overviewInput)(input, options.ownerId); }
    catch (error) { return (members ? safeReaderFailure : safeLegacyReaderFailure)(error); }
    if (lifecycle.pending) return readerFailure('read_in_progress');
    clearTimeout(idle);
    return new Promise(resolve => {
      const slot = { resolve }; lifecycle.pending = slot;
      const duration = members ? request.deadlineMs : 5000;
      if (members) slot.expiresAt = started + duration;
      slot.deadline = setTimeout(() => { cancel(slot, 'read_timeout'); },
        members ? Math.max(0, duration - (performance.now() - started)) : 5000);
      function launch() {
        if (lifecycle.pending !== slot || closed) return;
        if (performance.now() >= started + duration) { cancel(slot, 'read_timeout'); return; }
        try {
          const instance = start(); instance.ref();
          instance.postMessage(members ? { method: 'members', request, deadlineAt: started + duration } : { ...request, deadlineAt: started + duration });
        } catch { cancel(slot, 'reader_failed'); }
      }
      // Cleanup wait belongs to this request's existing deadline. A timed-out
      // or closed slot cannot launch from a later termination continuation.
      if (lifecycle.cleaning) lifecycle.termination.then(launch, () => { finish(slot, readerFailure('reader_failed')); });
      else launch();
    });
  }
  return Object.freeze({
    readTopicOverview: input => dispatch(input),
    readTopicMembers: input => dispatch(input, true),
    async close() {
      closed = true;
      const slot = lifecycle.pending;
      const released = stop();
      if (slot) finish(slot, readerFailure('store_closed'));
      await released;
    },
  });
}
