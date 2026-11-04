// Isolated functional/test preparation worker. Never used by a measured cell.
import { performance } from 'node:perf_hooks';
process.hrtime.bigint=()=>0n;
Object.defineProperty(performance,'now',{value:()=>0});
await import('../../../../core/context-product-worker.mjs');
