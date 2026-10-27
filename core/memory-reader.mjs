import { membersInput } from './topic-members-input.mjs';
import { performance } from 'node:perf_hooks';
import { Worker } from 'node:worker_threads';
import { readerOptions, overviewInput, readerFailure, safeReaderFailure, safeLegacyReaderFailure } from './topic-overview-input.mjs';

/** The trusted host authenticates ownerId; this handle only enforces its boundary. */
export function openMemoryReader(input) {
  const options = readerOptions(input);
  let worker, pending, idle, closed = false, cleaning = false, termination = Promise.resolve();
  function stop() {
    clearTimeout(idle);
    // Detach before requesting termination: a synchronous native call may keep
    // the thread alive, but none of its later events may settle a request.
    const previous = worker; worker = undefined;
    if (previous) {
      cleaning = true;
      termination = Promise.all([termination, previous.terminate()]).then(() => { cleaning = false; });
      // Observe background cleanup failure; close() and queued dispatch also
      // retain the rejecting promise, and no replacement starts on failure.
      void termination.catch(() => {});
    }
    return termination;
  }
  function finish(slot, result) {
    if (pending !== slot) return;
    pending = undefined; clearTimeout(slot.deadline);
    if (worker && !closed) {
      worker.unref();
      idle = setTimeout(() => { void stop(); }, 60000);
      idle.unref();
    }
    slot.resolve(result);
  }
  function cancel(slot, code) {
    if (pending !== slot) return;
    stop();
    finish(slot, readerFailure(code));
  }
  function failed(instance, code) {
    if (worker !== instance) return;
    const slot = pending;
    stop();
    if (slot) finish(slot, readerFailure(code));
  }
  function start() {
    if (worker) return worker;
    const instance = new Worker(new URL('./topic-overview-worker.mjs', import.meta.url), {
      workerData: options, env: {}, execArgv: [],
      resourceLimits: { maxOldGenerationSizeMb: 64 }, stdout: true, stderr: true,
    });
    instance.stdout.resume(); instance.stderr.resume();
    worker = instance;
    instance.on('message', result => {
      if (worker !== instance || !pending) return;
      if (pending.previews) {
        try { result = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(result)); }
        catch { failed(instance, 'reader_failed'); return; }
      }
      if ((result?.ok && pending.expiresAt !== undefined && performance.now() >= pending.expiresAt) || result?.error?.code === 'read_timeout') failed(instance, 'read_timeout');
      else finish(pending, result);
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
    if (pending) return readerFailure('read_in_progress');
    clearTimeout(idle);
    return new Promise(resolve => {
      const slot = { resolve }; pending = slot;
      const duration = members ? request.deadlineMs : 5000;
      if (members) slot.expiresAt = started + duration;
      if (members && request.previews) slot.previews = true;
      slot.deadline = setTimeout(() => { cancel(slot, 'read_timeout'); },
        members ? Math.max(0, duration - (performance.now() - started)) : 5000);
      function launch() {
        if (pending !== slot || closed) return;
        if (performance.now() >= started + duration) { cancel(slot, 'read_timeout'); return; }
        try {
          const instance = start(); instance.ref();
          instance.postMessage(members ? { method: 'members', request, deadlineAt: started + duration } : { ...request, deadlineAt: started + duration });
        } catch { cancel(slot, 'reader_failed'); }
      }
      // Cleanup wait belongs to this request's existing deadline. A timed-out
      // or closed slot cannot launch from a later termination continuation.
      if (cleaning) termination.then(launch, () => { finish(slot, readerFailure('reader_failed')); });
      else launch();
    });
  }
  return Object.freeze({
    readTopicOverview: input => dispatch(input),
    readTopicMembers: input => dispatch(input, true),
    async close() {
      closed = true;
      const slot = pending;
      const released = stop();
      if (slot) finish(slot, readerFailure('store_closed'));
      await released;
    },
  });
}
