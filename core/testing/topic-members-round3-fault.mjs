import { DatabaseSync } from 'node:sqlite';
import { workerData } from 'node:worker_threads';
import { performance } from 'node:perf_hooks';
import crypto from 'node:crypto';
import { syncBuiltinESMExports } from 'node:module';
const prepare = DatabaseSync.prototype.prepare;
const fault = workerData.round3Fault;
Object.defineProperty(performance, 'now', { value: () => 100 });
let snapshots = 0;
function raise() { throw Object.assign(Error('controlled overview fault'), fault.error); }
const randomBytes = crypto.randomBytes;
let randomCalls = 0;
crypto.randomBytes = (...args) => {
  if (fault?.phase === 'token') raise();
  if (fault?.phase === 'cursor bytes') return Buffer.alloc(args[0], ++randomCalls);
  return randomBytes(...args);
};
syncBuiltinESMExports();
DatabaseSync.prototype.prepare = function (sql) {
  if (fault?.phase === 'worker exit') process.exit(23);
  if (fault?.phase === 'construction' && /SELECT id,revision,level,substr\(title/.test(sql)) raise();
  if (fault?.phase === 'configuration' && /PRAGMA schema_version/i.test(sql)) raise();
  if (fault?.phase === 'opening' && /PRAGMA application_id/i.test(sql)) raise();
  const statement = prepare.call(this, sql);
  return new Proxy(statement, { get(target, key) {
    if (key === 'get') return (...args) => {
      if (/FROM namespace_index_state WHERE/.test(sql)) {
        snapshots++;
        if (fault?.phase === 'snapshot' || (fault?.phase === 'final fence' && snapshots === 3)) raise();
      }
      if (fault?.phase === 'scan' && /SELECT id,revision,level,substr\(title/.test(sql)) raise();
      return target.get(...args);
    };
    const value = Reflect.get(target, key, target); return typeof value === 'function' ? value.bind(target) : value;
  } });
};
