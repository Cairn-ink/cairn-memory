import { threadId } from 'node:worker_threads';
// Synthetic trusted host. Shared publication state is independent of Worker IPC.
export function createContextReadHost(configuration) {
  const binding = configuration.requestBinding, state = new Int32Array(configuration.state);
  if (state.length > 4) Atomics.store(state, 4, threadId);
  if (configuration.throwAfterResource) {
    configuration.resourceOwner.register('lease', () => { Atomics.store(state, 7, 1); });
    throw Error('synthetic bootstrap failure');
  }
  function rejectedAuthority() {
    const promise = Promise.reject(Error('synthetic authority rejection'));
    Object.defineProperty(promise, 'then', { get() {
      Atomics.add(state, 7, 1); throw Error('own promise then');
    } });
    return promise;
  }
  return {
    authorize(request) {
      if (!['fetchCandidateEvidence', 'findCandidates', 'contextRead', 'getContextIndexStatus'].includes(request.method)) return null;
      return configuration.rejectedAuthorityAt === 'authorize' ? rejectedAuthority() : binding;
    },
    isCurrent() {
      const sample = Atomics.add(state, 1, 1) + 1;
      if (configuration.rejectedAuthorityAt === (sample === 1 ? 'entry' : 'final')) return rejectedAuthority();
      if (Atomics.load(state, 2) === sample) Atomics.store(state, 0, 0);
      if (state.length > 5 && Atomics.load(state, 5) === sample) Atomics.add(state, 3, 1);
      const current = Atomics.load(state, 0) === 1 && (binding.ownerGeneration === undefined || binding.ownerGeneration === Atomics.load(state, 3));
      if (state.length > 6 && Atomics.load(state, 6) === sample) Atomics.store(state, 0, 0);
      return current;
    },
  };
}
