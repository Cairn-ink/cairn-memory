// Shared prompt-cancellation state machine. Detach before terminating, latch a
// public terminal result before awaiting cleanup, and retain cleanup rejection.
export function createReaderWorkerLifecycle({ clearTimer = clearTimeout, onStop = () => {}, stopWorker = instance => instance.terminate() } = {}) {
  let worker, pending, idle, cleaning = false, termination = Promise.resolve();
  function stop() {
    clearTimer(idle);
    const previous = worker; worker = undefined;
    if (previous) {
      cleaning = true;
      let released;
      try { released = stopWorker(previous); } catch (error) { released = Promise.reject(error); }
      termination = Promise.all([termination, released]).then(() => { cleaning = false; });
      void termination.catch(() => {});
      onStop(termination);
    }
    return termination;
  }
  function finish(slot, result) {
    if (pending !== slot) return false;
    pending = undefined;
    try { clearTimer(slot.deadline); slot.detach?.(); }
    catch { /* Detachment cannot strand an already terminal public request. */ }
    finally { slot.resolve(result); }
    return true;
  }
  return {
    get worker() { return worker; }, set worker(value) { worker = value; },
    get pending() { return pending; }, set pending(value) { pending = value; },
    get cleaning() { return cleaning; }, get termination() { return termination; },
    set idle(value) { idle = value; },
    stop, finish,
    cancel(slot, result) { if (pending === slot) { stop(); finish(slot, result); } },
  };
}
