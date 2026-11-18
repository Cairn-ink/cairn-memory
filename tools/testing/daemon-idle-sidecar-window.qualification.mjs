// Opt-in measurement, excluded from CI's *.test.mjs discovery. No history reads.
// Run each part separately with tools/testing/run.mjs --script, on Node 24.22.1:
//   this-file --part A|B|control --output ABSOLUTE_DIRECTORY --state ABSOLUTE_DIRECTORY
// B is one full natural idle lifetime. Control is 30 s.
// Optional CAIRN_SETUP_065_PACKAGE: an offline 0.6.5 setup directory/tarball.
// Its bundled engine is installed offline. No fallback retrieval is permitted.
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { buildArtifact, packageName } from '../../packaging/build.mjs';
import { runtimeDirectory, readPrivate } from '../../adapters/mcp/local-daemon-state.mjs';
import { startAwareAlive } from '../../adapters/mcp/local-daemon-liveness.mjs';
import { runtimeLease, runtimeSnapshot, classifyRuntimeHygiene, ownedRuntimeFiles } from '../../packaging/test/fixtures/installed-daemon-runtime.mjs';
import { sentinel, sentinelQuery, namespace, monotonic } from './fixtures/daemon-idle-sidecar.mjs';

const fixture = fileURLToPath(new URL('./fixtures/daemon-idle-sidecar.mjs', import.meta.url));
const query = { query: sentinelQuery, types: ['memory'], intent: 'current', semantic: false, maxTokens: 4000, deadlineMs: 1000 };
const args = process.argv.slice(2), part = args[1], output = args[3], statePath = args[5];
const commands = [], children = [], prefixes = new Set(), owners = [], samples = [];
const timings = {};
const traces = path => existsSync(path) ? readFileSync(path, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
const check = (condition, code) => { if (!condition) throw Error('qualification_' + code); };
let environment, workspace, directory, releaseLease, before, executable, database, gateChild;
const until = async (predicate, code, ms = 15000) => {
  const end = monotonic() + ms;
  while (monotonic() < end) { const value = await predicate(); if (value) return value; await delay(10); }
  throw Error('qualification_' + code);
};
function command(file, argv, cwd, env, label) {
  // Match packaging/build.mjs: use the existing offline cache with an empty
  // explicit userconfig. Application children retain their synthetic HOME.
  const commandEnv = { ...env }; if (file === 'npm') delete commandEnv.HOME;
  const result = spawnSync(file, argv, { cwd, env: commandEnv, encoding: 'utf8', timeout: 120000, maxBuffer: 4 * 1024 * 1024 });
  commands.push({ label, command: [file, ...argv], rc: result.status, signal: result.signal, spawnError: result.error?.code ?? null });
  check(!result.error && result.status === 0 && !result.signal, 'command_failed');
  return result.stdout;
}
function child(argv, label, { ipc = false } = {}) {
  const processChild = spawn(process.execPath, argv, { cwd: workspace.path, env: environment,
    stdio: ipc ? ['ignore', 'pipe', 'pipe', 'ipc', 'pipe'] : ['pipe', 'pipe', 'pipe'] });
  const item = { process: processChild, label, messages: [], stderr: '', exit: null, requestedClose: false };
  let buffer = '';
  processChild.stdout.on('data', chunk => { buffer += chunk; let end; while ((end = buffer.indexOf('\n')) >= 0) {
    try { item.messages.push(JSON.parse(buffer.slice(0, end))); } catch { item.invalidOutput = true; }
    buffer = buffer.slice(end + 1);
  } });
  processChild.stderr.on('data', value => { item.stderr += value; });
  processChild.stdio[4]?.on('error', () => { item.pipeFailed = true; });
  processChild.on('message', message => {
    item.messages.push(message);
    if (message.kind === 'identity' && /^d-[a-f0-9]{32}$/.test(message.prefix)) prefixes.add(message.prefix);
    if (message.kind === 'progress') console.error(JSON.stringify({ phase: 'seed', conversations: message.conversations, indexTurns: message.indexTurns,
      maintenancePhase: message.maintenancePhase, lastActualWork: message.lastActualWork }));
  });
  item.done = new Promise((resolve, reject) => {
    processChild.once('error', reject);
    processChild.once('close', (code, signal) => {
      item.exit = { code, signal, at: monotonic() };
      commands.push({ label, command: [process.execPath, ...argv], rc: code, signal }); resolve(item.exit);
    });
  });
  children.push(item); return item;
}
let requestId = 0;
async function request(item, method, params = {}) {
  const id = ++requestId;
  item.process.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  const response = await until(() => {
    check(!item.exit && !item.invalidOutput, 'mcp_child_exited');
    return item.messages.find(message => message.id === id);
  }, 'mcp_response');
  item.messages.splice(item.messages.indexOf(response), 1);
  check(!response.error, 'mcp_error'); return response.result;
}
async function session(bin, daemon = false) {
  const item = child([bin, '--db', database, '--owner', namespace.ownerId, ...(daemon ? [] : ['--no-context-semantic'])], daemon ? 'attached_session' : bin === executable ? 'current_reader' : '065_reader');
  item.process.stdin.on('error', () => {});
  const result = await request(item, 'initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'synthetic-idle-reader', version: '1' } });
  check(result.serverInfo, 'initialize');
  item.process.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  return item;
}
async function close(item) {
  if (!item.requestedClose && !item.exit) { item.requestedClose = true; item.process.stdin?.end(); }
  const result = await item.done;
  check(result.code === 0 && result.signal === null, 'child_exit');
  check(!item.stderr.includes('cairn_daemon_fallback:'), 'fallback');
}
function support(action) {
  return JSON.parse(command(process.execPath, [executable, 'daemon', action, '--db', database], workspace.path, environment, 'daemon_' + action));
}
async function stopped() {
  const result = support('stop'); check(result.still_running === 0, 'still_running');
  await delay(1050);
  check(support('status').daemons.length === 0, 'stop_status'); return result;
}
async function read(item, engine, phase, zero, requestQuery = query, marker = sentinel) {
  const start = monotonic();
  const response = await request(item, 'tools/call', { name: 'read_memory_context', arguments: requestQuery });
  const value = JSON.parse(response.content[0].text);
  const metadata = response._meta?.['ink.cairn/context-read-diagnostics'];
  const items = value.value?.items ?? [];
  // The MCP tool puts metered fields in the success value and diagnostics in
  // _meta. Keep only measurements; never persist captured text or responses.
  const row = { engine, phase, afterDetachMs: start - zero, durationMs: monotonic() - start,
    ok: value.ok === true && !response.isError, coverage: metadata?.coverage?.raw ?? null,
    itemCount: items.length, rawItems: items.filter(item => item.ref?.type === 'raw').length,
    sentinel: JSON.stringify(value).includes(marker) };
  row.failed = !row.ok || row.coverage === 'unavailable' || !row.sentinel;
  samples.push(row); return row;
}
async function ready(item, engine, phase) {
  // Positive setup readiness only; measured held/released/stopped and loop
  // reads are always single attempts. Preserve all preflight attempts too.
  await until(async () => {
    const result = await read(item, engine, phase, monotonic());
    if (!result.failed) return true;
    await delay(100); return false;
  }, 'baseline_sentinel', 15000);
}
async function oldEngine() {
  const supplied = process.env.CAIRN_SETUP_065_PACKAGE;
  if (!supplied) return { available: false, reason: 'not_configured' };
  if (!isAbsolute(supplied) || !existsSync(supplied)) return { available: false, reason: 'unusable_package' };
  const location = join(workspace.path, 'old'); mkdirSync(location);
  try {
    const extract = (archive, to) => command('tar', ['-xzf', archive, '-C', to], workspace.path, environment, '065_extract');
    let setup = supplied;
    if (!lstatSync(supplied).isDirectory()) { extract(supplied, location); setup = join(location, 'package'); }
    check(JSON.parse(readFileSync(join(setup, 'package.json'))).version === '0.6.5', '065_version');
    const vendor = join(setup, 'runtime/engine');
    const archives = readdirSync(vendor).filter(name => name.endsWith('.tgz')); check(archives.length === 1, '065_archive');
    const archive = join(vendor, archives[0]), manifest = JSON.parse(readFileSync(join(vendor, 'manifest.json')));
    check(createHash('sha256').update(readFileSync(archive)).digest('hex') === manifest.sha256, '065_archive_hash');
    // Install only the frozen, supplied engine, offline in this scratch prefix.
    const prefix = join(location, 'install'); mkdirSync(prefix);
    writeFileSync(join(prefix, 'package.json'), '{"name":"synthetic-idle-legacy-reader","private":true}');
    command('npm', ['install', '--prefix', prefix, '--offline', '--ignore-scripts', '--no-audit', '--no-fund', archive], workspace.path, environment, '065_install');
    const name = manifest.package.name;
    const bin = join(prefix, 'node_modules', name, 'bin/cairn-memory.mjs'); check(existsSync(bin), '065_bin');
    return { available: true, bin };
  } catch { return { available: false, reason: 'unusable_package' }; }
}
function summarize(engine) {
  const rows = samples.filter(row => row.engine === engine && row.phase === 'loop').sort((a, b) => a.afterDetachMs - b.afterDetachMs), failures = rows.filter(row => row.failed);
  return { engine, reads: rows.length, failures: failures.length, unavailable: rows.filter(row => row.coverage === 'unavailable').length,
    missingSentinel: rows.filter(row => !row.sentinel).length, failureRate: rows.length ? failures.length / rows.length : null,
    failureTimesMs: failures.map(row => row.afterDetachMs), maxReadMs: Math.max(0, ...rows.map(row => row.durationMs)) };
}
async function startCandidate(installed, trace, gate = false) {
  gateChild = child([fixture, 'candidate', JSON.stringify({ installed, args: ['--db', database, '--owner', namespace.ownerId], trace, gate })], 'candidate', { ipc: true });
  const descriptor = await until(async () => {
    check(!gateChild.exit, 'candidate_early_exit');
    for (const prefix of prefixes) {
      const text = await readPrivate(directory, join(directory.path, prefix + '.json'), { fileClass: 'descriptor', missing: true });
      if (text) { const value = JSON.parse(text); if (value.owner.pid === gateChild.process.pid) return value; }
    }
  }, 'candidate_ready');
  owners.push(descriptor.owner); return descriptor;
}

async function measureReattach(installed, trace) {
  // Keep B's natural lifetime intact. A separate warm lifetime measures a
  // SessionEnd capture after its last detach, without extending B's window.
  await startCandidate(installed, trace);
  const first = await session(executable, true);
  await ready(first, 'daemon', 'catchup-attached');
  const detached = monotonic(); await close(first);
  const processed = await until(() => traces(trace).find(row => row.category === 'detach_processed' && row.at >= detached), 'catchup_detach');
  const marker = 'sessionendmarker' + randomBytes(12).toString('hex');
  const capture = child([fixture, 'session-end', JSON.stringify({ installed, database, marker })], 'session_end', { ipc: true });
  await close(capture);
  const saved = capture.messages.find(message => message.kind === 'session_end_captured');
  check(saved?.at >= processed.at, 'capture_after_detach');
  const reattachAt = monotonic(), attached = await session(executable, true), attachedAt = monotonic();
  let firstRead, searchable;
  const result = { detachedAt: detached, processedDetachAt: processed.at, captureAt: saved.at, reattachAt,
    warmAttachMs: attachedAt - reattachAt, observationLimitMs: 600000, firstReadMs: null, searchableMs: null };
  try {
    await until(async () => {
      const row = await read(attached, 'daemon', 'reattach', reattachAt, { ...query, query: marker }, marker);
      firstRead ??= row;
      if (!row.failed && row.rawItems > 0) { searchable = row; return true; }
      await delay(50); return false;
    }, 'reattach_searchable', result.observationLimitMs);
    result.searchableMs = searchable.afterDetachMs + searchable.durationMs;
  } catch (error) {
    result.censoredMs = monotonic() - reattachAt;
    result.firstReadMs = firstRead?.durationMs ?? null;
    writeFileSync(join(output, 'reattach.json'), JSON.stringify(result, null, 2));
    throw error;
  }
  result.firstReadMs = firstRead.durationMs;
  await close(attached); result.stop = await stopped(); await close(gateChild);
  result.daemonExit = gateChild.exit;
  writeFileSync(join(output, 'reattach.json'), JSON.stringify(result, null, 2)); return result;
}
async function main() {
  check(args.length === 6 && args[0] === '--part' && ['A', 'B', 'control'].includes(part) && args[2] === '--output' && isAbsolute(output) &&
    args[4] === '--state' && isAbsolute(statePath), 'usage');
  check(process.platform === 'linux' && process.version === 'v24.22.1', 'platform_node');
  mkdirSync(output, { recursive: true });
  // Explicit synthetic state survives the separate A/B/control invocations so
  // every measurement uses the exact same store, sidecar and packed engine.
  // Caller owns its removal after the last run; never accept an unmarked DB.
  const fresh = !existsSync(statePath);
  if (fresh) mkdirSync(statePath, { mode: 0o700 });
  check(lstatSync(statePath).isDirectory() && !lstatSync(statePath).isSymbolicLink(), 'state_directory');
  const marker = join(statePath, 'synthetic-idle-sidecar.json');
  if (!fresh) check(existsSync(marker), 'unmarked_state');
  workspace = { path: resolve(statePath) };
  const home = join(workspace.path, 'home'); if (fresh) mkdirSync(home, { mode: 0o700 });
  environment = { PATH: dirname(process.execPath) + ':/usr/bin:/bin', HOME: home, USER: 'synthetic', LOGNAME: 'synthetic', SHELL: '/bin/sh', TERM: 'dumb',
    TMPDIR: workspace.path, TMP: workspace.path, TEMP: workspace.path, NODE_NO_WARNINGS: '1', NODE_DISABLE_COMPILE_CACHE: '1',
    npm_config_userconfig: join(workspace.path, 'empty.npmrc') };
  writeFileSync(environment.npm_config_userconfig, '');
  directory = await runtimeDirectory(); releaseLease = await runtimeLease(directory);
  before = await runtimeSnapshot(directory.path); writeFileSync(join(output, 'runtime-before.json'), JSON.stringify(before, null, 2));
  let artifactDirectory, stored;
  if (fresh) {
    try {
      const artifact = buildArtifact({ ownDirectory: path => { artifactDirectory = path; },
        runCommand: (file, argv, cwd) => command(file, argv, cwd, environment, 'pack_' + file) });
      writeFileSync(join(workspace.path, 'package.json'), '{"name":"synthetic-idle-sidecar","private":true}');
      command('npm', ['install', '--prefix', workspace.path, '--offline', '--ignore-scripts', '--no-audit', '--no-fund', artifact.artifactPath], workspace.path, environment, 'install');
      stored = { version: 'synthetic-idle-sidecar-v1', artifactSha256: artifact.sha256 };
    } finally { if (artifactDirectory) await rm(artifactDirectory, { recursive: true }); }
  } else { stored = JSON.parse(readFileSync(marker)); check(stored.version === 'synthetic-idle-sidecar-v1', 'state_marker'); }
  const installed = join(workspace.path, 'node_modules', packageName);
  executable = join(installed, 'bin/cairn-memory.mjs'); database = join(workspace.path, 'memory.sqlite');
  if (fresh) {
    const seeder = child([fixture, 'seed', JSON.stringify({ installed, database })], 'seed', { ipc: true });
    await close(seeder); stored.shape = seeder.messages.find(message => message.kind === 'seed');
    writeFileSync(marker, JSON.stringify(stored), { mode: 0o600 });
  }
  const shape = stored.shape;
  check(shape?.messages >= 2500 && shape.conversations >= 20 && shape.memories === 0, 'store_shape');
  const old = stored.old ?? await oldEngine();
  stored.old = old; writeFileSync(marker, JSON.stringify(stored), { mode: 0o600 });
  const readers = [{ engine: 'current', bin: executable }, ...(old.available ? [{ engine: '0.6.5', bin: old.bin }] : [])];
  for (const reader of readers) { reader.item = await session(reader.bin); await ready(reader.item, reader.engine, 'baseline'); }
  let detachAt = monotonic(), trace, daemonExit, stop, descriptor, processedDetachAt;
  if (part !== 'control') {
    trace = join(output, 'sidecar-trace.jsonl'); writeFileSync(trace, '', { mode: 0o600 });
    descriptor = await startCandidate(installed, trace, part === 'A');
    const attached = await session(executable, true);
    await until(() => {
      const rows = support('status').daemons;
      return rows.length === 1 && rows[0].running && rows[0].attached_sessions === 1;
    }, 'attach_status');
    await ready(attached, 'daemon', 'attached');
    if (part === 'B') {
      detachAt = monotonic(); timings.detachAt = detachAt; await close(attached);
    // Stamp is produced by the daemon when the socket detaches. Reading it
    // avoids starting a support process before the first 50 ms loop sample.
    await until(async () => {
      const prefix = [...prefixes][0];
      const text = await readPrivate(directory, join(directory.path, prefix + '.stamp'), { fileClass: 'stamp', missing: true });
      return text && JSON.parse(text).attachedSessions === 0;
    }, 'idle_stamp');
      processedDetachAt = (await until(() => traces(trace).find(row => row.category === 'detach_processed' && row.at >= detachAt), 'processed_detach')).at;
      timings.processedDetachAt = processedDetachAt;
    }
    if (part === 'A') {
      gateChild.process.send({ kind: 'arm' });
      await until(() => traces(trace).some(row => row.category === 'gate_held'), 'gate_held');
      for (const reader of readers) await read(reader.item, reader.engine, 'held', detachAt);
      gateChild.process.stdio[4].write('release');
      await until(() => traces(trace).some(row => row.category === 'gate_committed' && row.success), 'gate_commit');
      for (const reader of readers) await read(reader.item, reader.engine, 'released', detachAt);
      await close(attached);
      stop = await stopped(); await close(gateChild); daemonExit = gateChild.exit;
      for (const reader of readers) await read(reader.item, reader.engine, 'stopped', detachAt);
    }
  } else stop = await stopped();
  if (part !== 'A') {
    if (part === 'control') detachAt = monotonic();
    const loops = readers.map(async reader => {
      let due = detachAt, error;
      const pending = new Set();
      const active = () => part === 'B' ? !gateChild.exit : monotonic() - detachAt < 30000;
      while (active()) {
        await delay(Math.max(0, due - monotonic()));
        if (!active()) break;
        // Issue at the requested cadence even when a read takes >50 ms. The
        // ordinary per-session server owns concurrency; drain all replies
        // after the daemon exits, preserving each request's start timestamp.
        const operation = read(reader.item, reader.engine, 'loop', detachAt)
          .catch(value => { error ??= value; }).finally(() => pending.delete(operation));
        pending.add(operation);
        due += 50;
        check(monotonic() - detachAt < 45000, 'idle_exit_timeout');
      }
      await Promise.all(pending);
      if (error) throw error;
    });
    await Promise.all(loops);
    if (part === 'B') {
      await close(gateChild); daemonExit = gateChild.exit; stop = await stopped();
      for (const reader of readers) await close(reader.item);
    }
  }
  for (const reader of readers) await close(reader.item);
  const events = trace ? traces(trace).filter(row => row.at >= detachAt && (!daemonExit || row.at <= daemonExit.at)) : [];
  const commits = events.filter(row => row.category === 'commit' && row.success && row.wrote);
  const intervening = commits.filter(row => row.at <= processedDetachAt);
  const result = { part, node: process.version, shape, artifactSha256: stored.artifactSha256,
    old: { available: old.available, reason: old.reason ?? null }, cadenceMs: 50, detachAt,
    idleMs: daemonExit ? daemonExit.at - detachAt : 30000, daemonExit, stop, processedDetachAt, reattach: null,
    maintenance: { writeTransactions: commits.length, beginWriteTransactions: events.filter(row => row.category === 'begin_write' && row.success).length,
      failedOperations: events.filter(row => !row.success).length, commitTimesMs: commits.map(row => row.at - detachAt),
      eofToProcessedDetachTransactions: intervening.length, eofToProcessedDetachTimesMs: intervening.map(row => row.at - detachAt),
      successfulWrites: events.filter(row => row.category === 'write' && row.success).length },
    readers: readers.map(reader => summarize(reader.engine)),
    deterministic: part === 'A' ? samples.filter(row => ['held', 'released', 'stopped'].includes(row.phase)) : null };
  if (part === 'A') result.matchesExpected = result.deterministic.every(row => row.phase === 'held'
    ? row.ok && row.coverage === (row.engine === '0.6.5' ? 'unavailable' : 'partial') && row.itemCount === 0 && !row.sentinel
    : row.ok && row.sentinel);
  let measurementError;
  if (part === 'B') {
    // Preserve the original EOF window even if the separate visibility
    // observation reaches its supervision bound. No read is retried here.
    result.idleMatchesExpected = commits.length === 0 && result.maintenance.successfulWrites === 0 && result.readers.every(reader => reader.failures === 0);
    writeFileSync(join(output, 'result.json'), JSON.stringify(result, null, 2));
    try { result.reattach = await measureReattach(installed, trace); }
    catch (error) {
      measurementError = error;
      result.reattach = existsSync(join(output, 'reattach.json')) ? JSON.parse(readFileSync(join(output, 'reattach.json'))) : null;
      result.measurementError = /^[a-z_]+$/.test(error.message) ? error.message : 'qualification_failed';
    }
  }
  writeFileSync(join(output, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
  if (measurementError) throw measurementError;
  if (part === 'A') check(result.matchesExpected, 'held_lock_acceptance');
  if (part === 'B') check(result.idleMatchesExpected, 'idle_acceptance');
  if (part === 'control') {
    writeFileSync(join(output, 'measurements.json'), JSON.stringify(samples, null, 2));
    check(result.readers.every(reader => reader.failures === 0), 'control_reader_failure');
  }
}

let cleaning;
async function cleanup() {
  return cleaning ??= (async () => {
    // A release is harmless when unarmed and prevents teardown waiting on a
    // paused synchronous writer. Then close readers before supported stop.
    if (gateChild && !gateChild.exit && gateChild.process.stdio[4]?.writable) gateChild.process.stdio[4].write('release');
    const errors = [];
    for (const item of children.filter(item => !['candidate', 'seed'].includes(item.label))) try { await close(item); } catch (error) { errors.push(error); }
    if (executable && existsSync(database)) try { await stopped(); } catch (error) { errors.push(error); }
    for (const item of children.filter(item => ['candidate', 'seed'].includes(item.label))) try { await close(item); } catch (error) { errors.push(error); }
    check(owners.every(owner => !startAwareAlive(owner)), 'owner_alive');
    if (directory && before) {
      const mutate = ownedRuntimeFiles(directory, { prefixes });
      const baseline = new Set(before.entries.map(entry => entry.name));
      const preexistingLogs = new Set();
      for (const prefix of prefixes) {
        const name = prefix + '.log';
        if (baseline.has(name)) preexistingLogs.add(name);
        else await mutate('remove', name, { force: true });
      }
      const after = await runtimeSnapshot(directory.path, before.identities);
      writeFileSync(join(output, 'runtime-after.json'), JSON.stringify(after, null, 2));
      const names = after.entries.map(entry => entry.name).filter(name => !preexistingLogs.has(name) &&
        [...prefixes].some(prefix => name.startsWith(prefix + '.')));
      const hygiene = classifyRuntimeHygiene(before, after, { names, owners });
      writeFileSync(join(output, 'hygiene.json'), JSON.stringify(hygiene, null, 2));
      check(hygiene.errors.length === 0, 'runtime_hygiene');
    }
    // The explicit marked synthetic state is shared by later invocations.
    if (errors.length) throw errors[0];
  })();
}
for (const [signal, rc] of [['SIGTERM', 143], ['SIGINT', 130]]) process.once(signal, () => {
  void cleanup().then(() => process.exit(rc), () => { console.error('qualification_cleanup_failed'); process.exit(1); });
});
try { await main(); }
catch (error) { console.error(/^qualification_[a-z_]+$/.test(error.message) ? error.message : 'qualification_failed'); process.exitCode = 1; }
finally {
  try { await cleanup(); }
  catch { console.error('qualification_cleanup_failed'); process.exitCode = 1; }
  finally {
    if (output && isAbsolute(output) && existsSync(output)) {
      writeFileSync(join(output, 'measurements.json'), JSON.stringify(samples, null, 2));
      writeFileSync(join(output, 'commands.json'), JSON.stringify(commands, null, 2));
      writeFileSync(join(output, 'timings.json'), JSON.stringify(timings, null, 2));
      writeFileSync(join(output, 'ownership.json'), JSON.stringify({ prefixes: [...prefixes], owners }, null, 2));
      writeFileSync(join(output, 'child-outcomes.json'), JSON.stringify(children.map(item => ({ label: item.label,
        exit: item.exit, messages: item.messages.filter(message => ['child_failure', 'capture_refused'].includes(message.kind)) })), null, 2));
    }
    await releaseLease?.();
  }
}
