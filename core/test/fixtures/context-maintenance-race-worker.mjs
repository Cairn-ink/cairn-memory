// Inject an independent ordinary commit after the native staged item writes,
// before the engine's final in-batch fence check. No production seam changes.
import { registerHooks } from 'node:module';
import { workerData } from 'node:worker_threads';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const Native = process.getBuiltinModule('node:sqlite').DatabaseSync;
const state = new Int32Array(workerData.host.configuration.state);
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
          const child = spawnSync(process.execPath, [fileURLToPath(new URL('./context-maintenance-writer.mjs', import.meta.url)),
            workerData.path, JSON.stringify({ namespace: workerData.readSet[0], type: 'memory', operation: 'capture' })],
          { encoding: 'utf8', env: {}, timeout: 15000 });
          if (child.status !== 0) throw Error('independent writer exit ' + child.status + ': ' + child.stderr);
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
