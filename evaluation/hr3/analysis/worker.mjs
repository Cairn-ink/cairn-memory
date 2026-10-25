import { parentPort } from 'node:worker_threads';
import { runDataset } from './simulation.mjs';
parentPort.on('message', job => {
  try {
    const result = runDataset(job.cell, job.index, { ...job.options, onProgress: progress => parentPort.postMessage({ progress }) });
    parentPort.postMessage({ result }, [...result.primary, ...result.lineage].map(a => a.buffer));
  } catch (error) { parentPort.postMessage({ error: error.stack }); }
});
