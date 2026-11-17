// Synthetic process fixture. Its single IPC bootstrap is the only configuration input.
import { daemonStderrTail } from './local-daemon-diagnostics.mjs';
import net from 'node:net';
import fsPromises from 'node:fs/promises';
import childProcess from 'node:child_process';
import { registerHooks, syncBuiltinESMExports } from 'node:module';
import { once } from 'node:events';
import { Duplex } from 'node:stream';
import { frameGuard } from '../../local-daemon-wire.mjs';
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
    if (configuration.observeToolExecutions) {
      const { McpServer } = await import('@modelcontextprotocol/server');
      const registerTool = McpServer.prototype.registerTool;
      McpServer.prototype.registerTool = function(name, options, handler) {
        return registerTool.call(this, name, options, (...args) => {
          send({ kind: 'tool-executed', name }); return handler(...args);
        });
      };
    }
    let restoreTempClock;
    if (configuration.observeTempScan) {
      const opendir = fsPromises.opendir;
      fsPromises.opendir = async (...args) => {
        const directory = await opendir(...args), read = directory.read.bind(directory), close = directory.close.bind(directory);
        let reads = 0;
        directory.read = (...args) => { reads++; return read(...args); };
        directory.close = async (...args) => {
          try {
            const result = await close(...args); restoreTempClock?.(); restoreTempClock = undefined;
            send({ kind: 'temp-scan-closed', reads });
            if (configuration.holdTempScanClose) while ((await once(process, 'message'))[0].kind !== 'release-temp-scan-close') {}
            return result;
          }
          finally { restoreTempClock?.(); restoreTempClock = undefined; }
        };
        return directory;
      };
      syncBuiltinESMExports();
    }
    if (configuration.cleanupUnlinkBarrier) {
      const unlink = fsPromises.unlink; let gated = false;
      fsPromises.unlink = async path => {
        if (!gated && /\.(stamp|json)\.tmp-[a-f0-9]{24}$/.test(String(path))) {
          gated = true; send({ kind: 'temp-unlink-pending' });
          while ((await once(process, 'message'))[0].kind !== 'release-temp-unlink') {}
        }
        return unlink(path);
      };
      syncBuiltinESMExports();
    }
    if (configuration.stampWriteBarrier) {
      const open = fsPromises.open;
      fsPromises.open = async (path, ...args) => {
        const file = await open(path, ...args);
        if (/\.stamp\.tmp-[a-f0-9]{24}$/.test(String(path))) {
          const write = file.writeFile.bind(file);
          file.writeFile = async (...args) => {
            await write(...args); send({ kind: 'stamp-write-pending' });
            await new Promise(() => {});
          };
        }
        return file;
      };
      syncBuiltinESMExports();
    }
    if (configuration.beforeLifetimeAcquisition) {
      const mkdir = fsPromises.mkdir; let paused = false;
      fsPromises.mkdir = async function(path, options) {
        // withFileLock's setup precedes its acquisition deadline. Delay here
        // so spawning the intervening owner cannot consume that deadline.
        if (!paused && options?.recursive && String(path).endsWith('/cairn-memory')) {
          paused = true; send({ kind: 'lifetime-acquisition-pending' });
          while ((await once(process, 'message'))[0].kind !== 'release-lifetime-acquisition') {}
        }
        return mkdir(path, options);
      };
      syncBuiltinESMExports();
    }
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
    if (configuration.lazyImportFailure) {
      const target = new URL('../../../../core/engine-card-maintenance.mjs', import.meta.url).href;
      registerHooks({ load(url, context, next) {
        if (url === target) { send({ kind: 'lazy-import-failed' }); throw Error('synthetic_lazy_import_failure'); }
        return next(url, context);
      } });
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
      ...((configuration.providerBarrier || configuration.lazyImportFailure) ? { runtimeOptions: { model: {
        contextWindow: 8192, countTokens: () => 1, rank: () => ({ refs: [] }),
        ...(configuration.lazyImportFailure ? { consolidate: () => { throw Error('synthetic_import_should_fail_first'); } } : {}),
        async select() {
          send({ kind: 'provider-entered' }); await new Promise(resolve => setTimeout(resolve, 300));
          send({ kind: 'provider-settled' }); return { refs: [] };
        },
      } } } : {}),
      afterLock: async () => {
        if (configuration.tempScanClock) {
          // Isolate the match-count control from the independently tested real
          // one-second budget. Restore before bind/publication or admission.
          const previous = Object.getOwnPropertyDescriptor(performance, 'now'), instant = performance.now();
          Object.defineProperty(performance, 'now', { configurable: true, value: () => instant });
          restoreTempClock = () => {
            if (previous) Object.defineProperty(performance, 'now', previous);
            else delete performance.now;
          };
        }
        if (configuration.holdAfterLock) {
          send({ kind: 'candidate-after-lock' });
          while ((await once(process, 'message'))[0].kind !== 'release-candidate-lock') {}
        }
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
    if (configuration.losingElectionRace) {
      const spawn = childProcess.spawn, open = fsPromises.open;
      let launched = false, paused = false;
      childProcess.spawn = function(executable, args, options) {
        if (args.some(arg => arg.endsWith('/local-daemon.mjs'))) {
          launched = true;
          return spawn(executable, [new URL('./local-daemon-gated-candidate.mjs', import.meta.url).pathname,
            configuration.losingElectionRace], options);
        }
        return spawn(executable, args, options);
      };
      fsPromises.open = async function(path, ...args) {
        if (launched && !paused && String(path).endsWith(configuration.losingElectionEntry ?? '.stamp')) {
          paused = true; send({ kind: 'private-open-pending' });
          while ((await once(process, 'message'))[0].kind !== 'try-private-open') {}
          try { return await open(path, ...args); }
          catch (error) {
            send({ kind: 'private-open-failed', name: error.name, code: error.code });
            while ((await once(process, 'message'))[0].kind !== 'release-private-error') {}
            throw error;
          }
        }
        return open(path, ...args);
      };
      syncBuiltinESMExports();
    }
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
    let takeoverFaultInjected = false;
    const takeoverFault = async stage => {
      if (takeoverFaultInjected || configuration.takeoverFault !== stage) return;
      takeoverFaultInjected = true;
      send({ kind: 'takeover-read-pending', stage });
      while ((await once(process, 'message'))[0].kind !== 'release-takeover-read') {}
      throw Object.assign(Error('synthetic_private_missing'), { code: 'ENOENT' });
    };
    const { armWatchdogOnTool, initializationTimeoutRace, ...forwarderOptions } = configuration.options ?? {};
    if (armWatchdogOnTool || initializationTimeoutRace) {
      let armed = false, attempts = 0;
      const shortMs = forwarderOptions.unresponsiveMs;
      // The existing numeric options seam is coerced at each watchdog check.
      // Keep the normal setup budget until a complete tool frame has passed
      // the ledger and reaches socket.write; no production arming option.
      forwarderOptions.unresponsiveMs = { valueOf: () => armed ? shortMs : 30000 };
      forwarderOptions.connect = async (args, options) => {
        const attempt = ++attempts;
        if (initializationTimeoutRace && attempt === 2) {
          armed = false;
          send({ kind: 'recovery-connect-pending' });
          while ((await once(process, 'message'))[0].kind !== 'release-recovery-connect') {}
        }
        // Connection setup keeps its ordinary takeover budget in both cases.
        const connection = await connectOrStart(args, { ...options, unresponsiveMs: 30000 });
        if (attempt === 1) {
          const frames = frameGuard(), push = frames.push.bind(frames);
          frames.push = (bytes, encoding) => {
            if (bytes && JSON.parse(bytes.toString('utf8')).result?.protocolVersion) {
              send({ kind: 'initialization-withheld' });
              if (initializationTimeoutRace) {
                // Withhold until this transport times out. The error is
                // emitted before the gated second connection can proceed.
                armed = true;
              } else {
                const release = message => {
                  if (message.kind !== 'release-initialization') return;
                  process.off('message', release); push(bytes, encoding);
                };
                process.on('message', release);
                frames.once('close', () => process.off('message', release));
              }
              return true;
            }
            return push(bytes, encoding);
          };
          connection.socket = Duplex.from({ readable: connection.socket.pipe(frames), writable: connection.socket });
          // Duplex.from emits ABORT_ERR when the forwarder destroys recovery's
          // old transport. Own it just as connectOrStart owns socket errors.
          connection.socket.on('error', () => {});
        }
        if (armWatchdogOnTool) {
          const write = connection.socket.write.bind(connection.socket);
          connection.socket.write = (bytes, ...rest) => {
            if (!armed && JSON.parse(bytes.toString('utf8')).method === 'tools/call') {
              armed = true; send({ kind: 'watchdog-armed' });
            }
            return write(bytes, ...rest);
          };
        }
        return connection;
      };
    }
    let result = await runForwarder(configuration.args, { ...forwarderOptions,
      ...((configuration.holdTakeoverLock || configuration.takeoverFault) ? { takeoverOptions: {
        ...configuration.options?.takeoverOptions,
        afterLock: async () => {
          if (configuration.holdTakeoverLock) {
            send({ kind: 'takeover-locked' });
            while ((await once(process, 'message'))[0].kind !== 'release-takeover') {}
          }
          await takeoverFault('lock');
        },
        afterTerm: () => takeoverFault('term'),
      } } : {}),
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
