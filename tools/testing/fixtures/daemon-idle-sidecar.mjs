// Qualification-only child. Production never imports or packages this module.
import { DatabaseSync } from 'node:sqlite';
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Worker } from 'node:worker_threads';
import { registerHooks } from 'node:module';

export const sentinel = 'zirconaxwindowmarker';
export const sentinelQuery = sentinel;
export const namespace = { ownerId: 'synthetic-idle-sidecar-owner', scope: 'personal', projectId: null };
export const monotonic = () => Number(process.hrtime.bigint()) / 1e6;
const ok = result => {
  if (!result.ok) throw Error('qualification_core_refused');
  return result.value;
};

// Wrap only the application's existing connections and execution methods.
// Identify the sidecar by its distinctive header probe, never by opening a file.
// Trace categories and outcomes only: no SQL, arguments, source text or paths.
export function traceSidecar(trace, gate) {
  const note = value => typeof trace === 'function' ? trace({ at: monotonic(), ...value })
    : appendFileSync(trace, JSON.stringify({ at: monotonic(), ...value }) + '\n', { mode: 0o600 });
  const prepare = DatabaseSync.prototype.prepare, exec = DatabaseSync.prototype.exec;
  const sidecars = new WeakSet(), transactions = new WeakMap();
  let armed = false, selected;
  DatabaseSync.prototype.prepare = function(sql, ...args) {
    if (/^SELECT 1 FROM sqlite_master WHERE name='header'$/.test(sql) ||
      typeof trace === 'function' && sql === 'SELECT * FROM header WHERE singleton=1') sidecars.add(this);
    const statement = prepare.call(this, sql, ...args), db = this;
    const write = /^\s*(?:INSERT|UPDATE|DELETE|REPLACE|CREATE|DROP|ALTER)\b/i.test(sql);
    for (const method of ['run', 'get', 'all', 'iterate']) {
      const original = statement[method];
      statement[method] = function(...values) {
        try {
          const result = original.apply(this, values);
          if (sidecars.has(db) && write) {
            if (transactions.has(db)) transactions.get(db).wrote = true;
            note({ category: 'write', success: true });
          }
          return result;
        } catch (error) {
          if (sidecars.has(db)) note({ category: write ? 'write' : 'read', success: false });
          throw error;
        }
      };
    }
    return statement;
  };
  DatabaseSync.prototype.exec = function(sql, ...args) {
    if (!sidecars.has(this)) return exec.call(this, sql, ...args);
    const begin = /^\s*BEGIN\s+IMMEDIATE\s*;?\s*$/i.test(sql);
    const commit = /^\s*COMMIT\s*;?\s*$/i.test(sql);
    const rollback = /^\s*ROLLBACK\s*;?\s*$/i.test(sql);
    const promote = gate && armed && begin;
    if (promote) { armed = false; selected = this; }
    if (gate && selected === this && commit) {
      if (!this.isTransaction) throw Error('qualification_gate_no_transaction');
      note({ category: 'gate_held', success: true, exclusive: true, inTransaction: true });
      // The control worker consumes a dedicated IPC pipe and notifies shared
      // memory. The entire paused write stays synchronous, including commit.
      const outcome = Atomics.wait(gate, 0, 0, 20000);
      if (outcome === 'timed-out' || Atomics.load(gate, 0) !== 1) throw Error('qualification_gate_timeout');
    }
    try {
      const result = exec.call(this, promote ? 'BEGIN EXCLUSIVE' : sql, ...args);
      if (begin) { transactions.set(this, { wrote: false }); note({ category: 'begin_write', success: true, exclusive: Boolean(promote) }); }
      if (commit || rollback) {
        note({ category: commit ? 'commit' : 'rollback', success: true, wrote: transactions.get(this)?.wrote === true });
        transactions.delete(this);
        if (selected === this) { selected = undefined; note({ category: 'gate_committed', success: commit }); }
      }
      return result;
    } catch (error) {
      note({ category: begin ? 'begin_write' : commit ? 'commit' : rollback ? 'rollback' : 'other', success: false });
      throw error;
    }
  };
  return { arm() { if (!gate) throw Error('qualification_gate_disabled'); armed = true; },
    close() { DatabaseSync.prototype.prepare = prepare; DatabaseSync.prototype.exec = exec; } };
}

async function captureConfiguration({ installed, database, initial = false }) {
  const { openMemoryCore } = await import(pathToFileURL(join(installed, 'core/index.mjs')));
  // Lineage 0 is readable by the supplied 0.6.5 engine, when available.
  const core = openMemoryCore({ path: database, ...(initial ? { contentSafety: 's2h-v1' } : {}), raw: true, rawSearch: false });
  let authority;
  try {
    const current = ok(core.getLocalCaptureControl({ namespace, client: 'claude-code' }));
    const grant = ok(core.setLocalCaptureControl({ namespace, client: 'claude-code', targetId: 'synthetic-idle-sidecar',
      expectedStoreId: current.storeId, expectedRevision: current.revision, automaticCaptureEnabled: true, rawNoticeVersion: 'local-plain-v1' }));
    authority = { version: 'local-capture-authority-v1', targetId: grant.targetId, storeId: grant.storeId, namespace, client: 'claude-code',
      expectedControlRevision: grant.revision, expectedConsentGeneration: grant.consentGeneration,
      expectedNamespaceGeneration: ok(core.getCaptureControl({ namespace })).generation,
      expectedRawRevision: ok(core.getRawCaptureControl({ ownerId: namespace.ownerId, client: 'claude-code' })).revision };
  } finally { await core.close(); }
  return { databasePath: database, authority, interpretation: 'raw-only', raw: { mode: 'local-plain-v1', capBytes: 512 * 1024 * 1024 }, timeouts: { captureMs: 120000 } };
}

async function sessionEnd(settings) {
  const { captureLocal } = await import(pathToFileURL(join(settings.installed, 'adapters/local/capture.mjs')));
  const config = await captureConfiguration(settings), content = 'Synthetic SessionEnd ' + settings.marker;
  const result = await captureLocal(config, { version: 2, client: 'claude-code', session_id: settings.marker, event_id: settings.marker,
    messages: [{ id: settings.marker, role: 'user', occurred_at: '2001-01-01T00:00:00.000Z', message_ordinal: 1,
      content, part: { index: 0, start: 0, totalUnits: content.length, totalBytes: Buffer.byteLength(content) } }] },
  { env: {}, fetchImpl() { throw Error('qualification_network_forbidden'); } });
  if (result.status !== 200) {
    process.send({ kind: 'capture_refused', status: result.status,
      code: /^[a-z_]+$/.test(result.body?.error ?? '') ? result.body.error : null });
    throw Error('qualification_capture_failed');
  }
  process.send({ kind: 'session_end_captured', at: monotonic() });
}

async function seed({ installed, database }) {
  const { openMemoryCore } = await import(pathToFileURL(join(installed, 'core/index.mjs')));
  const { captureLocal } = await import(pathToFileURL(join(installed, 'adapters/local/capture.mjs')));
  const config = await captureConfiguration({ installed, database, initial: true });
  for (let conversation = 0; conversation < 125; conversation++) {
    const session = 'synthetic-idle-sidecar-' + conversation;
    const messages = Array.from({ length: 20 }, (_, index) => {
      const content = `Synthetic telescope engineering conversation ${conversation}, message ${index}. ` +
        'Synthetic calibration observation and documented engineering discussion. '.repeat(12) +
        (conversation === 124 && index === 0 ? ' ' + sentinel : '');
      return { id: session + '-' + index, role: index % 2 ? 'assistant' : 'user', occurred_at: '2001-01-01T00:00:00.000Z', message_ordinal: index + 1,
        content, part: { index: 0, start: 0, totalUnits: content.length, totalBytes: Buffer.byteLength(content) } };
    });
    const result = await captureLocal(config, { version: 2, client: 'claude-code', session_id: session, event_id: session, messages },
      { env: {}, fetchImpl() { throw Error('qualification_network_forbidden'); } });
    if (result.status !== 200) throw Error('qualification_capture_failed');
    if (conversation % 25 === 0) process.send({ kind: 'progress', conversations: conversation + 1 });
  }
  // Publish the recent Raw sentinel through normal installed-engine upkeep.
  // A complete inventory pass is unnecessary: the 2,500 captured messages stay
  // present, and natural reconciliation continues throughout the idle runs.
  const core = openMemoryCore({ path: database, raw: true });
  try {
    for (let turn = 0; turn < 60; turn++) {
      const progress = ok(await core.maintainRawSearch({ namespace }));
      const result = ok(await core.searchRaw({ namespace, query: sentinelQuery, intent: 'current', semantic: false }));
      if (result.candidates.length) break;
      if (turn === 59) throw Error('qualification_seed_sentinel_unavailable');
      if (turn % 20 === 0) process.send({ kind: 'progress', indexTurns: turn + 1,
        maintenancePhase: progress.maintenance?.phase, lastActualWork: progress.maintenance?.lastActualWork });
      await new Promise(resolve => setTimeout(resolve, 1050));
    }
  } finally { await core.close(); }
  const db = new DatabaseSync(database, { readOnly: true });
  try {
    const n = table => db.prepare('SELECT count(*) AS n FROM ' + table).get().n;
    process.send({ kind: 'seed', messages: n('raw_messages'), conversations: n('raw_conversations'), memories: n('memories') });
  } finally { db.close(); }
}

async function candidate(settings) {
  if (process.execArgv.length) throw Error('qualification_candidate_execargv');
  let control;
  const barrier = settings.gate ? new Int32Array(new SharedArrayBuffer(4)) : null;
  if (barrier) {
    // fd 4 is an IPC pipe created by this qualification, never a SQLite file.
    control = new Worker(`const {workerData,parentPort}=require('node:worker_threads');
      const barrier=new Int32Array(workerData);
      new (require('node:net').Socket)({fd:4,readable:true,writable:false}).on('data',()=>{
        Atomics.store(barrier,0,1);Atomics.notify(barrier,0);});parentPort.postMessage('ready');`, { eval: true, workerData: barrier.buffer });
    await new Promise((resolve, reject) => { control.once('message', resolve); control.once('error', reject); });
  }
  const hook = traceSidecar(settings.trace, barrier);
  const detachHook = registerHooks({ load(url, context, next) {
    const result = next(url, context);
    if (!url.endsWith('/local-shared-runtime.mjs')) return result;
    return { ...result, source: String(result.source).replace('disconnect.abort();',
      `globalThis.recordProcessedRawUpkeepDetach(); disconnect.abort();`) };
  } });
  globalThis.recordProcessedRawUpkeepDetach = () => appendFileSync(settings.trace,
    JSON.stringify({ at: monotonic(), category: 'detach_processed', success: true }) + '\n', { mode: 0o600 });
  process.on('message', message => {
    if (message.kind === 'arm') { hook.arm(); process.send({ kind: 'armed' }); }
  });
  const load = name => import(pathToFileURL(join(settings.installed, 'adapters/mcp/' + name + '.mjs')));
  const state = await load('local-daemon-state'), engine = await load('local-daemon-identity');
  const directory = await state.runtimeDirectory(); await directory.validate();
  const environment = engine.selectedEnvironment();
  const identity = await engine.createIdentity(settings.args, { key: await state.identityKey(directory), environment });
  if (!identity.eligible) throw Error('qualification_candidate_ineligible');
  process.send({ kind: 'identity', prefix: 'd-' + identity.digest.slice(0, 32) });
  try { await (await load('local-daemon')).runCandidate({ args: settings.args, identity: identity.record, environment }); }
  finally { detachHook.deregister(); delete globalThis.recordProcessedRawUpkeepDetach; await control?.terminate(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const settings = JSON.parse(process.argv[3]);
    if (process.argv[2] === 'seed') await seed(settings);
    else if (process.argv[2] === 'session-end') await sessionEnd(settings);
    else if (process.argv[2] === 'candidate') await candidate(settings);
    else throw Error('qualification_child_role');
  } catch (error) {
    process.send?.({ kind: 'child_failure', name: error.name,
      code: /^[a-z_]+$/.test(error.code ?? error.message ?? '') ? error.code ?? error.message : 'exception' });
    console.error('qualification_child_failed'); process.exitCode = 1;
  }
  finally { process.disconnect?.(); }
}
