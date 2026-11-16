import { workerData } from 'node:worker_threads';
const entry = workerData.sqliteChildFaults.entry;
await import('./sqlite-helper-child-faults.mjs');
await import(entry);
