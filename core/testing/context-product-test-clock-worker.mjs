import { workerData } from 'node:worker_threads';
const entry = workerData.productTestClock.entry;
const { testClock } = await import('./context-product-test-clock.mjs');
testClock.stall();
await import(entry);
