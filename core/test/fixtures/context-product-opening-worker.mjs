// Synthetic native instrumentation installed inside the real product Worker.
import childProcess from 'node:child_process';
import { registerHooks, syncBuiltinESMExports } from 'node:module';
import { workerData } from 'node:worker_threads';

const configuration = workerData.host.configuration;
{
  const { openingFault: fault, state: buffer } = configuration;
  const state = new Int32Array(buffer), Native = process.getBuiltinModule('node:sqlite').DatabaseSync;
  const nativeError = () => Object.assign(Error('synthetic private native message'), { code: 'ERR_SQLITE_ERROR', errcode: fault.code });
  if (fault?.kind === 'probe') {
    const spawn = childProcess.spawnSync;
    childProcess.spawnSync = (command, args, options) => {
      if (!args[2]?.includes('PRAGMA journal_mode')) return spawn(command, args, options);
      args = [...args];
      const target = { open: 'new DatabaseSync(process.argv[1], { readOnly: true })',
        prepare: "db.prepare('PRAGMA journal_mode')", execute: 'query.get()', close: 'db.close()' }[fault.stage];
      if (target) args[2] = args[2].replace(target,
        `(() => { throw Object.assign(Error('synthetic private probe message'), { code: 'ERR_SQLITE_ERROR', errcode: ${fault.code} }); })()`);
      const result = spawn(command, args, options);
      if (fault.damage === 'missing') result.stdout = '';
      if (fault.damage === 'unknown') result.stdout = JSON.stringify({ value: { mode: 'delete' } }) + '\n';
      if (fault.damage === 'lost-close') result.stdout = result.stdout.split('\n').filter(line => !line.includes('"stage":"close"')).join('\n');
      return result;
    };
  }
  globalThis.syntheticProductDatabase = class extends Native {
    constructor(...args) {
      if (fault?.kind === 'native' && fault.stage === 'open') throw nativeError();
      super(...args);
    }
    exec(sql) {
      if (fault?.kind === 'native' && fault.stage === 'configure') throw nativeError();
      return super.exec(sql);
    }
    prepare(sql) {
      if (fault?.kind === 'native' && fault.stage === 'prepare' && sql === 'PRAGMA user_version') throw nativeError();
      const statement = super.prepare(sql);
      const metadata = /sqlite_master|sqlite_schema|pragma_/i.test(sql) ||
        /^PRAGMA\s+(application_id|user_version|schema_version|encoding|query_only|trusted_schema|busy_timeout)\b/i.test(sql) || /FROM store_metadata\b/i.test(sql);
      return new Proxy(statement, { get(target, key) {
        const value = Reflect.get(target, key, target);
        if (!['get', 'all', 'iterate'].includes(key)) return typeof value === 'function' ? value.bind(target) : value;
        return (...args) => {
          if (state.length > 8) {
            if (!metadata) { Atomics.add(state, 9, 1); if (Atomics.load(state, 1) === 0) Atomics.add(state, 8, 1); }
            else if (Atomics.load(state, 1) === 0) Atomics.add(state, 10, 1);
          }
          return Reflect.apply(value, target, args);
        };
      } });
    }
  };
  syncBuiltinESMExports();
  registerHooks({ load(url, context, nextLoad) {
    if (url !== 'node:sqlite') return nextLoad(url, context);
    return { format: 'module', shortCircuit: true, source: `
      export const DatabaseSync = globalThis.syntheticProductDatabase;
      const actual = process.getBuiltinModule('node:sqlite');
      export const StatementSync = actual.StatementSync, constants = actual.constants, backup = actual.backup;
      export default { ...actual, DatabaseSync };
    ` };
  } });
}

await import('../../context-product-worker.mjs');
