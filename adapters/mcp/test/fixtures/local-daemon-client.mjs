// Synthetic process fixture. Its single IPC bootstrap is the only configuration input.
import { once } from 'node:events';
import { runForwarder, connectOrStart } from '../../local-forwarder.mjs';
import { runCandidate } from '../../local-daemon.mjs';

const [configuration] = await once(process, 'message');
const send = message => { if (process.connected) process.send(message); };
try {
  if (configuration.role === 'connection-probe') {
    // The owner identity describes a normal Node process. node:test on Node 24
    // carries runner flags that production correctly refuses as injection.
    let code = null;
    try {
      const connection = await connectOrStart(configuration.args, configuration.options);
      connection.socket.destroy();
    } catch (error) { code = error.code; }
    send({ kind: 'connection-probe-result', code, execArgv: process.execArgv });
  } else if (configuration.role === 'candidate') {
    if (configuration.activationImportFailure) {
      const { register } = await import('node:module');
      const target = new URL('../../local-shared-runtime.mjs', import.meta.url).href;
      register('data:text/javascript,' + encodeURIComponent(`
        export async function resolve(specifier, context, next) {
          const result = await next(specifier, context);
          if (result.url === ${JSON.stringify(target)})
            throw Object.assign(Error('synthetic_module_load_failure'), { code: 'ERR_MODULE_NOT_FOUND', url: result.url });
          return result;
        }`), import.meta.url);
    }
    let armed = false;
    process.on('message', message => { if (message.kind === 'arm') { armed = true; send({ kind: 'armed' }); } });
    const acquired = await runCandidate(configuration.bootstrap, { ...configuration.lifecycle,
      ...(configuration.providerBarrier ? { runtimeOptions: { model: {
        contextWindow: 8192, countTokens: () => 1, rank: () => ({ refs: [] }),
        async select() {
          send({ kind: 'provider-entered' }); await new Promise(resolve => setTimeout(resolve, 300));
          send({ kind: 'provider-settled' }); return { refs: [] };
        },
      } } } : {}),
      afterLock: async () => {
        if (!configuration.commitBarrier) return;
        const { DatabaseSync } = await import('node:sqlite');
        const prepare = DatabaseSync.prototype.prepare, exec = DatabaseSync.prototype.exec;
        let target;
        DatabaseSync.prototype.prepare = function(sql) {
          const statement = Reflect.apply(prepare, this, [sql]);
          if (/INSERT\s+INTO\s+memories\b/i.test(sql)) {
            const run = statement.run, db = this;
            statement.run = function(...args) { if (armed) target = db; return Reflect.apply(run, this, args); };
          }
          return statement;
        };
        DatabaseSync.prototype.exec = function(sql) {
          const selected = armed && target === this && /^\s*COMMIT\s*;?\s*$/i.test(sql);
          const barrier = () => { send({ kind: 'commit-barrier', side: configuration.commitBarrier }); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0); };
          if (selected && configuration.commitBarrier === 'before') barrier();
          const result = Reflect.apply(exec, this, [sql]);
          if (selected && configuration.commitBarrier === 'after') barrier();
          return result;
        };
      },
    });
    send({ kind: 'candidate-done', acquired });
  } else {
    const candidates = [];
    let bytesRead = 0;
    const read = process.stdin.read.bind(process.stdin);
    process.stdin.read = (...args) => { const bytes = read(...args); if (bytes) bytesRead += bytes.length; return bytes; };
    const result = await runForwarder(configuration.args, { ...configuration.options,
      ...(configuration.storeType === undefined ? {} : { storeStatfs: async parent => {
        send({ kind: 'store-statfs', parent }); return { type: configuration.storeType };
      } }),
      onCandidate(child) {
        // Production detaches/unrefs candidates. This fixture supervises their
        // actual wait status until test teardown, including idle resets caused
        // by later sessions; their lifetime is not bounded by forwarder EOF.
        child.ref();
        send({ kind: 'candidate', pid: child.pid });
        candidates.push(new Promise(resolve => child.on('exit', (code, signal) => {
          send({ kind: 'candidate-exit', pid: child.pid, code, signal }); resolve();
        })));
      },
      onConnected({ descriptor, ready }) { send({ kind: 'connected', owner: descriptor.owner,
        incarnation: descriptor.incarnation, metadata: ready.metadata }); },
    });
    send({ kind: 'forwarder-done', code: result, bytesRead });
    if (result) process.exitCode = 1;
    // Keep the supervisor alive after stdio EOF so detached children's actual
    // wait status is reported, including losers and the idle-exiting winner.
    await Promise.all(candidates);
  }
} catch { send({ kind: 'fixture-failed' }); process.exitCode = 1; }
finally { process.disconnect?.(); }
