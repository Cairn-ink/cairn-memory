// Test-only opening census. Observe spawns and commit through SQLite only.
import { registerHooks, syncBuiltinESMExports } from 'node:module';
import childProcess from 'node:child_process';
import { lstatSync } from 'node:fs';
import { parentPort, workerData } from 'node:worker_threads';

const { port, behavior } = workerData.journalOpeningControl;
const Native = process.getBuiltinModule('node:sqlite').DatabaseSync;
let preflights = 0, committed = false, beforeNative = null;
const spawns = [];
const spawn = childProcess.spawnSync;
childProcess.spawnSync = function(command, args, options) {
  const program = args?.[2];
  const canonical = args?.[3] === workerData.path ||
    args?.[3]?.startsWith('file:') && new URL(args[3]).pathname === workerData.path;
  if (canonical && typeof program === 'string') {
    if (program.includes('header[18]')) spawns.push('header');
    else if (program.includes("import('node:sqlite')") && program.includes('PRAGMA journal_mode')) spawns.push('sqlite-probe');
    else spawns.push('other');
  }
  return Reflect.apply(spawn, this, [command, args, options]);
};
syncBuiltinESMExports();
globalThis.journalOpeningPreflight = () => { preflights++; };
globalThis.journalOpeningFacade = () => {
  if (behavior !== 'committed-fingerprint' || committed) return;
  const before = lstatSync(workerData.path, { bigint: true });
  const writer = new Native(workerData.path);
  try { writer.exec('PRAGMA user_version=18'); } finally { writer.close(); }
  const after = lstatSync(workerData.path, { bigint: true });
  committed = ['size', 'mtimeNs', 'ctimeNs'].some(key => before[key] !== after[key]);
  if (!committed) throw Error('test_commit_did_not_change_fingerprint');
};
globalThis.journalOpeningDatabase = class extends Native {
  constructor(path, options) {
    if (String(path) === workerData.path && beforeNative === null)
      beforeNative = { preflights, spawns: [...spawns] };
    super(path, options);
  }
};
const sidecar = new URL('../../context-read-sidecar.mjs', import.meta.url).href;
const facade = new URL('../../context-read-facade.mjs', import.meta.url).href;
registerHooks({ load(url, context, next) {
  if (url === 'node:sqlite') return { format: 'module', shortCircuit: true, source: `
    const actual=process.getBuiltinModule('node:sqlite');
    export const DatabaseSync=globalThis.journalOpeningDatabase;
    export const StatementSync=actual.StatementSync,constants=actual.constants,backup=actual.backup;
    export default {...actual,DatabaseSync};` };
  const loaded = next(url, context);
  if (url !== sidecar && url !== facade) return loaded;
  let source = String(loaded.source);
  const anchor = url === sidecar
    ? 'export function assertContextReadCanonicalDelete(path, observer) {'
    : 'export function openContextProductFacade(path, product) {';
  const occurrences = source.split(anchor).length - 1;
  if (occurrences !== 1) throw Error(`test_opening_anchor_count:${occurrences}`);
  source = source.replace(anchor, anchor + (url === sidecar
    ? ' globalThis.journalOpeningPreflight();' : ' globalThis.journalOpeningFacade();'));
  return { ...loaded, source };
} });
const send = parentPort.postMessage.bind(parentPort);
let reported = false;
parentPort.postMessage = function(message, ...args) {
  if (!reported && message.operation && !message.kind) {
    reported = true;
    port.postMessage({ preflights, spawns, committed, beforeNative });
  }
  return send(message, ...args);
};
await import('../../context-product-worker.mjs');
