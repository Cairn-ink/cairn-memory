import { membersInput } from './topic-members-input.mjs';
import { performance } from 'node:perf_hooks';
import { Worker } from 'node:worker_threads';
import { readerOptions, overviewInput, readerFailure, safeReaderFailure, safeLegacyReaderFailure } from './topic-overview-input.mjs';

/** The trusted host authenticates ownerId; this handle only enforces its boundary. */
export function openMemoryReader(input) {
  const options = readerOptions(input);
  let worker, pending, idle, closed = false, termination = Promise.resolve();
  const stop = async () => {
    clearTimeout(idle);
    const previous = worker; worker = undefined;
    if (previous) termination = Promise.all([termination, previous.terminate()]);
    await termination;
  };
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
  async function failed(instance, code) {
    if (worker !== instance) return;
    const slot = pending;
    await stop();
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
        catch { void failed(instance, 'reader_failed'); return; }
      }
      if ((result?.ok && pending.expiresAt !== undefined && performance.now() >= pending.expiresAt) || result?.error?.code === 'read_timeout') void failed(instance, 'read_timeout');
      else finish(pending, result);
    });
    instance.on('error', () => { void failed(instance, 'reader_failed'); });
    instance.on('exit', () => { void failed(instance, 'reader_failed'); });
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
      slot.deadline = setTimeout(() => {
        void (async () => { await stop(); finish(slot, readerFailure('read_timeout')); })();
      }, members ? Math.max(0, duration - (performance.now() - started)) : 5000);
      try {
        const instance = start(); instance.ref();
        instance.postMessage(members ? { method: 'members', request, deadlineAt: started + duration } : { ...request, deadlineAt: started + duration });
      } catch { void (async () => { await stop(); finish(slot, readerFailure('reader_failed')); })(); }
    });
  }
  return Object.freeze({
    readTopicOverview: input => dispatch(input),
    readTopicMembers: input => dispatch(input, true),
    async close() {
      closed = true;
      const slot = pending;
      await stop();
      if (slot) finish(slot, readerFailure('store_closed'));
    },
  });
}
