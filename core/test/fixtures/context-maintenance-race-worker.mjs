// Inject an independent ordinary commit after the native staged item writes,
// before the engine's final in-batch fence check. No production seam changes.
import { registerHooks } from 'node:module';
import { Worker, workerData } from 'node:worker_threads';
import { once } from 'node:events';
const Native = process.getBuiltinModule('node:sqlite').DatabaseSync;
const state = new Int32Array(workerData.host.configuration.state);
const rendezvous = new Int32Array(new SharedArrayBuffer(8));
if (Atomics.load(state, 6) === 0) {
  const writer = new Worker(new URL('./context-maintenance-writer.mjs', import.meta.url), {
    workerData: { path: workerData.path, input: { namespace: workerData.readSet[0], type: 'memory', operation: 'capture' },
      rendezvous: rendezvous.buffer }, env: {}, execArgv: [], stdout: true, stderr: true,
  });
  // Imported runtime sends ready only after the independent writer is ready.
  const [message] = await once(writer, 'message');
  if (message !== 'ready') throw Error('independent writer not ready');
}
globalThis.maintenanceRaceDatabase = class extends Native {
  constructor(path, options) { super(path, options); this.side = String(path).endsWith('.context-read-product-v1.1.sqlite'); }
  prepare(sql) {
    const stmt = super.prepare(sql);
    if (!this.side || !sql.startsWith('UPDATE statistics SET n=')) return stmt;
    return new Proxy(stmt, { get(target, key) {
      const value = Reflect.get(target, key, target);
      if (typeof value !== 'function') return value;
      return (...args) => {
        const result = Reflect.apply(value, target, args);
        if (Atomics.compareExchange(state, 6, 0, 1) === 0) {
          Atomics.store(rendezvous, 0, 1); Atomics.notify(rendezvous, 0);
          Atomics.wait(rendezvous, 1, 0, 15000);
          if (Atomics.load(rendezvous, 1) !== 1) throw Error('independent writer did not commit');
        }
        return result;
      };
    } });
  }
};
registerHooks({ load(url, context, next) {
  if (url !== 'node:sqlite') return next(url, context);
  return { format: 'module', shortCircuit: true, source: `
    const actual=process.getBuiltinModule('node:sqlite');
    export const DatabaseSync=globalThis.maintenanceRaceDatabase;
    export const StatementSync=actual.StatementSync,constants=actual.constants,backup=actual.backup;
    export default {...actual,DatabaseSync};` };
} });
await import('../../context-product-worker.mjs');
