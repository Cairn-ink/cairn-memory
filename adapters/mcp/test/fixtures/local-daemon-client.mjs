// Synthetic process fixture. Its single IPC bootstrap is the only configuration input.
import { daemonStderrTail } from './local-daemon-diagnostics.mjs';
import net from 'node:net';
import fsPromises from 'node:fs/promises';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { once } from 'node:events';
import { runForwarder, connectOrStart } from '../../local-forwarder.mjs';
import { runCandidate } from '../../local-daemon.mjs';
import { processStart } from '../../local-daemon-liveness.mjs';

const [configuration] = await once(process, 'message');
const send = message => { if (process.connected) process.send(message); };
try {
  if (configuration.role === 'per-session') {
    process.argv = [process.execPath, new URL('../../cli.mjs', import.meta.url).pathname, ...configuration.args];
    const { start } = await import('../../cli.mjs'); await start();
  } else if (configuration.role === 'connection-probe') {
    // The owner identity describes a normal Node process. node:test on Node 24
    // carries runner flags that production correctly refuses as injection.
    let code = null;
    try {
      const connection = await connectOrStart(configuration.args, configuration.options);
      connection.socket.destroy();
    } catch (error) { code = error.code; }
    send({ kind: 'connection-probe-result', code, execArgv: process.execArgv });
  } else if (configuration.role === 'candidate') {
    let monitor;
    if (configuration.instrumentSlices) {
      const { installDaemonSliceMonitor } = await import('../../../../tools/testing/fixtures/daemon-event-loop-monitor.mjs');
      monitor = installDaemonSliceMonitor();
      process.on('message', message => {
        if (message.kind === 'slice-phase') { monitor.phase(message.phase); send({ kind: 'slice-phase-ready', phase: message.phase }); }
        if (message.kind === 'slice-report') send({ kind: 'slice-report', sequence: message.sequence, value: monitor.report() });
      });
    }
    let fault;
    if (configuration.midWrite) {
      const { installDaemonMidWrite } = await import('./local-daemon-mid-write.mjs');
      fault = installDaemonMidWrite({ send, ...configuration.midWrite });
    }
    if (configuration.observeConnections) {
      const createServer = net.createServer;
      net.createServer = (...args) => {
        const server = createServer(...args); server.on('connection', () => send({ kind: 'connection-accepted' })); return server;
      };
      syncBuiltinESMExports();
    }
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
    if (configuration.unpublishedSocket) {
      const chmod = fsPromises.chmod;
      fsPromises.chmod = async function(path, mode) {
        if (String(path).endsWith('.sock') && configuration.unpublishedSocket === 'before-chmod') {
          send({ kind: 'socket-bound-unpublished' });
          await new Promise(() => {});
        }
        const result = await chmod(path, mode);
        if (String(path).endsWith('.sock')) {
          send({ kind: 'socket-bound-unpublished' });
          if (configuration.unpublishedSocket === 'exit') process.exit(17);
          await new Promise(() => {});
        }
        return result;
      };
      syncBuiltinESMExports();
    }
    let armed = false;
    process.on('message', message => { if (message.kind === 'arm') { armed = true; fault?.arm(); send({ kind: 'armed' }); } });
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
    monitor?.close();
    send({ kind: 'candidate-done', acquired });
  } else {
    const candidates = [], liveCandidates = new Map();
    let connected = false, failedRespawn = false;
    if (configuration.endpointReadRace) {
      const lstat = fsPromises.lstat; let paused = false;
      fsPromises.lstat = async function(path, ...args) {
        if (connected && !paused && String(path).endsWith('.sock')) {
          paused = true; send({ kind: 'endpoint-between-reads' });
          while ((await once(process, 'message'))[0].kind !== 'release-endpoint-read') {}
        }
        return lstat(path, ...args);
      };
      syncBuiltinESMExports();
    }
    if (configuration.options?.failRespawnOnce || configuration.options?.failEveryCandidate) {
      const spawn = childProcess.spawn;
      childProcess.spawn = function(executable, args, options) {
        if ((configuration.options?.failEveryCandidate || connected && !failedRespawn) && args.some(arg => arg.endsWith('/local-daemon.mjs'))) {
          failedRespawn = true;
          return spawn(executable, [new URL('./local-daemon-losing-candidate.mjs', import.meta.url).pathname], options);
        }
        return spawn(executable, args, options);
      };
      syncBuiltinESMExports();
    }
    let bytesRead = 0;
    const read = process.stdin.read.bind(process.stdin);
    process.stdin.read = (...args) => { const bytes = read(...args); if (bytes) bytesRead += bytes.length; return bytes; };
    if (configuration.observeTakeover) {
      const kill = process.kill.bind(process);
      process.kill = (pid, signal) => {
        const result = kill(pid, signal);
        if (signal === 'SIGTERM' || signal === 'SIGKILL') send({ kind: 'takeover-signal', pid, signal });
        return result;
      };
    }
    let result = await runForwarder(configuration.args, { ...configuration.options,
      ...(configuration.holdTakeoverLock ? { takeoverOptions: { afterLock: async () => {
        send({ kind: 'takeover-locked' });
        while ((await once(process, 'message'))[0].kind !== 'release-takeover') {}
      } } } : {}),
      ...(configuration.storeType === undefined ? {} : { storeStatfs: async parent => {
        send({ kind: 'store-statfs', parent }); return { type: configuration.storeType };
      } }),
      onCandidate(child) {
        // Production detaches/unrefs candidates. This fixture supervises their
        // actual wait status until test teardown, including idle resets caused
        // by later sessions; their lifetime is not bounded by forwarder EOF.
        child.ref();
        // Socket close can reach reconnect before Node delivers the old
        // child's exit event. Count actual live processes, retaining every
        // child's independent close/exit record below.
        for (const [pid, start] of liveCandidates) {
          const current = processStart(pid);
          if (!current || current.zombie || current.start !== start) {
            liveCandidates.delete(pid);
            send({ kind: 'candidate-observed-dead', pid, start, observed: current });
          }
        }
        const start = processStart(child.pid)?.start;
        liveCandidates.set(child.pid, start);
        child.once('exit', () => {
          if (!configuration.options?.retainExitedCandidateRecords && liveCandidates.get(child.pid) === start) liveCandidates.delete(child.pid);
        });
        send({ kind: 'candidate', pid: child.pid, start, active_candidates: liveCandidates.size });
        const stderr = daemonStderrTail();
        child.stderr.on('data', bytes => stderr.write(bytes));
        candidates.push(new Promise(resolve => child.on('close', (code, signal) => {
          send({ kind: 'candidate-exit', pid: child.pid, code, signal, stderr: stderr.read() }); resolve();
        })));
      },
      onConnected({ socket, descriptor, ready }) {
        connected = true;
        if (configuration.observeLiveness) {
          let buffer = '';
          socket.on('data', chunk => {
            buffer += chunk; let end;
            while ((end = buffer.indexOf('\n')) >= 0) {
              const message = JSON.parse(buffer.slice(0, end)); buffer = buffer.slice(end + 1);
              if (message.method === 'notifications/cairn/daemon_liveness') send({ kind: 'liveness-seen' });
            }
          });
        }
        send({ kind: 'connected', owner: descriptor.owner,
          incarnation: descriptor.incarnation, metadata: ready.metadata });
      },
    });
    if (configuration.fallbackSession && result?.refused) {
      send({ kind: 'fallback-session', code: result.refused });
      process.argv = [process.execPath, new URL('../../cli.mjs', import.meta.url).pathname, ...configuration.args];
      const { start } = await import('../../cli.mjs'); await start(); result = null;
    }
    send({ kind: 'forwarder-done', code: result, bytesRead });
    if (result) process.exitCode = 1;
    // Keep the supervisor alive after stdio EOF so detached children's actual
    // wait status is reported, including losers and the idle-exiting winner.
    await Promise.all(candidates);
  }
} catch { send({ kind: 'fixture-failed' }); process.exitCode = 1; }
finally { process.disconnect?.(); }
