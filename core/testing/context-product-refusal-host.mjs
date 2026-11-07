// Fault injection stays in the host fixture; the actual Worker checks execute.
import { parentPort, workerData } from 'node:worker_threads';
export function createContextReadHost({serviceBinding, requestBinding, mode, calls}) {
  const binding = serviceBinding ?? requestBinding;
  const counts = new Int32Array(calls);
  if (mode === 'worker_epoch') parentPort.on('message', message => {
    if (message.method === 'close') return;
    // verifyRecords checks the opening epoch first. Change the observed epoch
    // between its sample and the explicit Worker epoch check, without stubbing
    // either check. Plain IPC cannot independently reach this redundant guard.
    const epoch = workerData.operation.workerEpoch;
    let reads = 0;
    Object.defineProperty(workerData.operation, 'workerEpoch', {configurable: true,
      get: () => ++reads === 1 ? epoch : epoch + 1});
  });
  const host = {
    authorize() {
      Atomics.add(counts, 0, 1);
      if (mode === 'authorize_error') throw new TypeError('synthetic authority failure');
      if (mode === 'grant_mismatch') return {...binding, issuedAt: binding.issuedAt + 1};
      return binding;
    },
    isCurrent() {Atomics.add(counts, 1, 1); return mode !== 'not_current';},
    counter: {id: 'synthetic-refusal-counter', countTokens: () => 1},
  };
  if (mode === 'host_port') delete host.authorize;
  return host;
}
