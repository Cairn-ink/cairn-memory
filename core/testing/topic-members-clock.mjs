// Imported only by the test's Worker override, never a public reader option.
import { workerData } from 'node:worker_threads';
import { performance } from 'node:perf_hooks';
Object.defineProperty(performance, 'now', { value: () => workerData.e1mTestClock ? Number(Atomics.load(new BigInt64Array(workerData.e1mTestClock), 0)) : 100 });
