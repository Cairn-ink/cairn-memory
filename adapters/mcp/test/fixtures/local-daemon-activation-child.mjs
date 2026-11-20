// Test-only instrumentation. Empty execArgv/environment keep the real owner
// identity checks; no bootstrap option, env flag or production hook is added.
import { once } from 'node:events';
import { registerHooks, syncBuiltinESMExports } from 'node:module';
import { existsSync, writeFileSync } from 'node:fs';
import fs from 'node:fs/promises';
import net from 'node:net';

const [{ bootstrap, paths, evidence, failure }] = await once(process, 'message');
const events = [];
let listener, releaseImport, releaseClose;
const importGate = new Promise(resolve => { releaseImport = resolve; });
const closeGate = new Promise(resolve => { releaseClose = resolve; });
const trace = kind => {
  const event = { kind, held: existsSync(paths.lock) };
  events.push(event); process.send?.(event);
};
process.on('exit', code => writeFileSync(evidence, JSON.stringify({ code, events })));
process.on('message', message => {
  if (message.kind === 'release-import') releaseImport();
  if (message.kind === 'release-close') releaseClose();
  if (message.kind === 'fault') {
    if (message.fault === 'listener') listener.emit('error', Error('synthetic_listener_error'));
    else process.kill(process.pid, 'SIGTERM');
    trace('fault-delivered');
  }
  if (message.kind === 'finish') process.disconnect();
});
// Observe the actual lifetime-lock unlink, including any premature release.
const unlink = fs.unlink;
fs.unlink = async function(path, ...args) {
  if (path === paths.lock) trace('lock-release');
  return unlink(path, ...args);
};
const createServer = net.createServer;
net.createServer = (...args) => { listener = createServer(...args); return listener; };
syncBuiltinESMExports();
globalThis.activationProbe = {
  async importing() {
    trace('activation-pending'); await importGate;
    if (failure === 'import') { trace('activation-rejected'); throw Error('synthetic_module_load_failure'); }
  },
  constructed(host) {
    trace('host-created');
    const close = host.close.bind(host);
    host.close = async () => {
      trace('host-close-started'); await closeGate; await close(); trace('host-closed');
    };
    trace('activation-fulfilled'); return host;
  },
  constructing() {
    if (failure === 'constructor') { trace('activation-rejected'); throw Error('synthetic_constructor_failure'); }
  },
};
const target = new URL('../../local-shared-runtime.mjs', import.meta.url).href;
registerHooks({ load(url, context, next) {
  const result = next(url, context);
  if (url !== target) return result;
  const source = String(result.source);
  const declaration = 'export function createLocalSharedRuntime(';
  if (!source.includes(declaration)) throw Error('synthetic_instrumentation_drift');
  return { ...result, source: 'await globalThis.activationProbe.importing();\n' + source.replace(declaration, 'function originalRuntime(') + `
export function createLocalSharedRuntime(...args) {
  globalThis.activationProbe.constructing();
  return globalThis.activationProbe.constructed(originalRuntime(...args));
}
` };
} });
const { runCandidate } = await import('../../local-daemon.mjs');
try { await runCandidate(bootstrap); trace('candidate-resolved'); }
catch { trace('candidate-rejected'); process.exitCode = 1; }
// Stay supervised even on the broken path so a late activation is observable.
trace('candidate-returned');
