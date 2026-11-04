// No request, host configuration or application files exist in this phase.
import { parentPort, workerData } from 'node:worker_threads';
import { READER_POOL_BOOTSTRAP, READER_POOL_COMPATIBILITY } from './context-product-reader-pool.mjs';

if (workerData.compatibility !== READER_POOL_COMPATIBILITY || typeof workerData.generation !== 'string' ||
    Object.keys(workerData).length !== 2) throw Error('reader_pool_incompatible');
const { generation } = workerData;
await Promise.all([
  import('./context-product-attribution.mjs'), import('./context-product-service.mjs'),
  import('./context-product-authority.mjs'), import('./context-product-telemetry.mjs'),
  import('./context-product-control.mjs'), import('./context-product-reader.mjs'),
  import('./context-product-sqlite.mjs'), import('./validation.mjs'),
  import('./context-product-open-diagnostic.mjs'), import('./read-database.mjs'),
  import('./context-read-facade.mjs'), import('./context-product-index.mjs'),
]);

let consumed = false, listening = false, earlyClose;
const on = parentPort.on;
const ownOn = Object.getOwnPropertyDescriptor(parentPort, 'on');
function restore() {
  if (ownOn) Object.defineProperty(parentPort, 'on', ownOn);
  else delete parentPort.on;
}

parentPort.on('message', message => {
  if (message?.kind !== READER_POOL_BOOTSTRAP) {
    if (consumed && !listening && message?.method === 'close') earlyClose = message;
    return;
  }
  if (consumed) throw Error('reader_pool_bootstrap_reused');
  consumed = true;
  if (message.generation !== generation || !message.data || Object.getPrototypeOf(message.data) !== Object.prototype ||
      message.data.maintenance !== false || Object.keys(message).length !== 3) throw Error('reader_pool_incompatible');

  // Mutate the isolate's original own-data container, so the existing Worker
  // consumes precisely the ordinary bootstrap and retains all issuance checks.
  // Defining own properties avoids prototype setters during this private copy.
  for (const key of Object.keys(workerData)) delete workerData[key];
  Object.defineProperties(workerData, Object.getOwnPropertyDescriptors(message.data));

  // MessagePort is a NodeEventTarget, not an EventEmitter with newListener.
  // #513 installs its close handler first. Observe that one registration, then
  // restore the native method before delivering any buffered close to it.
  parentPort.on = function(event, listener) {
    const result = Reflect.apply(on, this, [event, listener]);
    if (event === 'message') {
      listening = true;
      restore();
      if (earlyClose) queueMicrotask(() => Reflect.apply(listener, parentPort, [earlyClose]));
    }
    return result;
  };
  void import('./context-product-worker.mjs').catch(error => {
    restore();
    throw error;
  });
});
parentPort.postMessage({ kind: 'context-reader-pool-ready', compatibility: READER_POOL_COMPATIBILITY, generation });
