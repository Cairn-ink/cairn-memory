import { parentPort, workerData } from 'node:worker_threads';
import { productFailure } from '../../context-product-reader.mjs';
import { sealNative } from '../../context-product-telemetry.mjs';

parentPort.postMessage({ operation: workerData.operation, result: { ok: true, value: null }, fileIdentity: '1:2' });
parentPort.on('message', message => {
  if (message.method === 'close') { sealNative(workerData.frame); parentPort.close(); return; }
  sealNative(message.frame);
  parentPort.postMessage({ operation: message.operation, result: productFailure(message.input.fixtureCode) });
});
