import { Worker } from 'node:worker_threads';
import { readerOptions, overviewInput, readerFailure, safeReaderFailure } from './topic-overview-input.mjs';

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
    instance.on('message', result => { if (worker === instance && pending) finish(pending, result); });
    instance.on('error', () => { void failed(instance, 'reader_failed'); });
    instance.on('exit', () => { void failed(instance, 'reader_failed'); });
    return instance;
  }
  return Object.freeze({
    async readTopicOverview(input) {
      if (closed) return readerFailure('store_closed');
      let request;
      try { request = overviewInput(input, options.ownerId); } catch (error) { return safeReaderFailure(error); }
      if (pending) return readerFailure('read_in_progress');
      clearTimeout(idle);
      return new Promise(resolve => {
        const slot = { resolve }; pending = slot;
        slot.deadline = setTimeout(() => {
          void (async () => { await stop(); finish(slot, readerFailure('read_timeout')); })();
        }, 5000);
        try { const instance = start(); instance.ref(); instance.postMessage(request); }
        catch { void (async () => { await stop(); finish(slot, readerFailure('reader_failed')); })(); }
      });
    },
    async close() {
      closed = true;
      const slot = pending;
      await stop();
      if (slot) finish(slot, readerFailure('store_closed'));
    },
  });
}
