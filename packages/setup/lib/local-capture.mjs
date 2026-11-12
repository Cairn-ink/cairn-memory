// Installer orchestration only. Authority, hook merging and capture belong to
// the installed engine; keep its identity and pinned runtime across uninstall.
import { spawn } from 'node:child_process';
import { mkdir, open, rename, lstat, readdir, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { boundedJSON, canonicalPath, executableFor, ownedDirectory, localFilesystemError, validPath, engineIdPattern, pidIsDead } from './local-descriptor.mjs';
import { SetupError } from './errors.mjs';

export const RAW_CAP = 200000000;
const file = root => join(root, 'capture-settings.json');
const fail = () => { throw new SetupError('local_recovery_required', 2); };
const exists = path => lstat(path).then(() => true, error => { if (error.code === 'ENOENT') return false; throw error; });
export async function captureSettings(root) {
  let value;
  try { value = await boundedJSON(file(root), 65536, { privateFile: true }); }
  catch (error) { if (error.code === 'ENOENT') return { version: 1, clients: {} }; fail(); }
  if (value?.version !== 1 || !value.clients || typeof value.clients !== 'object' || Array.isArray(value.clients) || Object.keys(value).sort().join(',') !== 'clients,version' ||
      Object.keys(value.clients).some(client => !['claude', 'codex'].includes(client))) fail();
  for (const receipt of Object.values(value.clients)) {
    if (!receipt || typeof receipt.enabled !== 'boolean' || typeof receipt.noticed !== 'boolean' ||
        !engineIdPattern.test(receipt.engineId) || !validPath(receipt.node)) fail();
  }
  return value;
}
// All three writes are installer metadata. Refuse aliases of the store and
// its sidecars before opening any file, including existing symlink targets.
async function metadataPath(path, database) {
  const resolved = await canonicalPath(path), store = await canonicalPath(database);
  const stores = await Promise.all([database, store].flatMap(base =>
    ['', '-wal', '-shm', '-journal'].map(suffix => canonicalPath(base + suffix))));
  if ([store, ...stores].includes(resolved) || /\.(?:sqlite3?|db)(?:-(?:wal|shm|journal))?$/iu.test(resolved)) fail();
  if (await exists(path)) {
    const stat = await lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) fail();
  }
}
async function atomicMetadata(path, database, create, text) {
  await ownedDirectory(dirname(path));
  if (await canonicalPath(dirname(path)) !== dirname(path)) fail();
  await metadataPath(path, database);
  const temporary = path + `.tmp-${process.pid}`;
  await metadataPath(temporary, database);
  let handle, created = false;
  try {
    handle = await create(temporary); created = true;
    await handle.writeFile(text); await handle.sync();
    await handle.close(); handle = undefined;
    await metadataPath(path, database);
    await rename(temporary, path);
  } finally {
    try { await handle?.close(); }
    finally { if (created) await rm(temporary, { force: true }); }
  }
}
async function save(root, settings, database) {
  await atomicMetadata(file(root), database,
    temporary => open(temporary, 'wx', 0o600), JSON.stringify(settings, null, 2) + '\n');
}
async function staleRequests(root, database) {
  await ownedDirectory(root);
  for (const name of await readdir(root)) {
    const match = /^capture-(?:claude|codex)-request\.json\.tmp-([1-9]\d*)$/u.exec(name);
    if (match && pidIsDead(Number(match[1]))) {
      const path = join(root, name);
      await metadataPath(path, database);
      await rm(path, { force: true });
    }
  }
}
async function directory(path) {
  await mkdir(path, { recursive: true, mode: 0o700 });
  await ownedDirectory(path);
  if (await canonicalPath(path) !== path) fail();
}
// Client-owned configuration can be readable by others, but never writable.
export async function clientConfigDirectory(client, env, { create = false } = {}) {
  const path = client === 'claude' ? env.CLAUDE_CONFIG_DIR ?? join(await canonicalPath(env.HOME), '.claude') :
    env.CODEX_HOME ?? join(await canonicalPath(env.HOME), '.codex');
  const resolved = typeof path === 'string' ? resolve(path) : path;
  try {
    if (!validPath(path) || await canonicalPath(path) !== resolved) throw new SetupError('local_root_invalid', 2);
    if (create) await mkdir(path, { recursive: true, mode: 0o700 });
    let stat;
    try { stat = await lstat(path.replace(/\/+$/u, '') || '/'); }
    catch (error) { if (!create && error.code === 'ENOENT') return resolved; throw error; }
    if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o022) ||
        (process.getuid && stat.uid !== process.getuid())) {
      throw new SetupError('local_root_invalid', 2, { code: 'insecure_directory' });
    }
    if (await canonicalPath(path) !== resolved) throw new SetupError('local_root_invalid', 2);
    return resolved;
  } catch (error) { throw localFilesystemError(error, 'local_root_invalid'); }
}
// Output is a bounded content-free engine DTO, never a child diagnostic. Kill
// the process group so a timed-out format probe cannot leave a schema child.
export async function engineChild(node, args, { env = process.env, onChild = async () => {}, timeout = 170000 } = {}) {
  return new Promise(resolve => {
    const child = spawn(node, args, { detached: process.platform !== 'win32',
      env: { PATH: env.PATH ?? '/usr/bin:/bin', HOME: env.HOME, TMPDIR: env.TMPDIR, LANG: 'C.UTF-8' },
      stdio: ['ignore', 'pipe', 'ignore'] });
    let text = '', stopped = false;
    const kill = () => { stopped = true; try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); } };
    const timer = setTimeout(kill, timeout);
    const tracking = Promise.resolve(onChild(child.pid)).catch(kill);
    child.stdout.on('data', chunk => { if (text.length + chunk.length > 65536) kill(); else text += chunk; });
    child.on('error', () => { stopped = true; });
    child.on('close', async code => {
      clearTimeout(timer); await tracking; await onChild(null);
      let value; try { value = JSON.parse(text); } catch { /* No arbitrary text escapes. */ }
      resolve(!stopped && value && typeof value.status === 'string' ? { ...value, exitCode: code } :
        { status: 'blocked', reason: stopped ? 'child_unavailable' : 'unexpected_failure', exitCode: code });
    });
  });
}
const engineRoot = (root, receipt) => dirname(dirname(executableFor(root, receipt.engineId)));
const cli = (root, receipt) => join(engineRoot(root, receipt), 'integrations/client/raw/local-setup-cli.mjs');
async function invoke(root, receipt, args, context) {
  return engineChild(receipt.node, [cli(root, receipt), ...args], context);
}
async function qualification(root, receipt, context) {
  const module = pathToFileURL(join(engineRoot(root, receipt), 'integrations/codex/qualification.mjs')).href;
  const config = join(root, 'capture-support/codex/installation.json');
  const script = `const q=await import(${JSON.stringify(module)});
    const host=await q.resolveCLI(process.env);
    if(host)await q.observeHost(${JSON.stringify(config)},host);
    const verdict=host?await q.qualifyBinary(${JSON.stringify(config)},host):{status:'pending'};
    console.log(JSON.stringify({status:verdict.status}));`;
  return engineChild(receipt.node, ['--input-type=module', '-e', script], { ...context, timeout: 90000 });
}
async function requestFor(root, descriptor, client, receipt, context) {
  const nativeHome = await clientConfigDirectory(client, context.env, { create: true });
  const sourceRoot = join(nativeHome, client === 'claude' ? 'projects' : 'sessions');
  await mkdir(sourceRoot, { recursive: true, mode: 0o700 });
  if (await canonicalPath(sourceRoot) !== sourceRoot) fail(); // The engine validates source ownership/mode.
  await directory(join(root, 'capture'));
  await directory(join(root, 'capture-usage'));
  await directory(join(root, 'capture-support'));
  const support = join(root, 'capture-support', client);
  await directory(support);
  if (client === 'codex') {
    const config = join(support, 'installation.json');
    await metadataPath(config, descriptor.database.path);
    if (!await exists(config)) {
      await atomicMetadata(config, descriptor.database.path,
        temporary => open(temporary, 'wx', 0o600), '{}\n');
    }
    await boundedJSON(config, 65536, { privateFile: true });
    await directory(join(support, 'qualification'));
  }
  return { version: 'local-raw-setup-request-v1', installationDirectory: join(root, 'capture', client),
    databasePath: descriptor.database.path,
    namespace: { ownerId: descriptor.ownerId, scope: descriptor.projectId === null ? 'personal' : 'project', projectId: descriptor.projectId },
    client: client === 'claude' ? 'claude-code' : 'codex', sourceRoot,
    clientConfigPath: join(nativeHome, client === 'claude' ? 'settings.json' : 'hooks.json'), usageRoot: join(root, 'capture-usage'),
    installation: client === 'claude' ? { pluginRoot: support } : { qualificationConfigPath: join(support, 'installation.json') },
    rawMode: 'local-plain-v1', rawCapBytes: RAW_CAP, dailyCap: 1000, providerApiKeyEnv: 'OPENAI_API_KEY',
    interpretationConsent: false, plaintextRawConsent: true, foregroundConsent: true };
}
export const captureRequested = (enabled, receipt) => enabled ?? receipt?.enabled ?? true;
export async function configureCapture(root, descriptor, selected, context, { enabled, uninstall = false } = {}) {
  if (!descriptor && !uninstall) fail();
  await directory(root);
  if (descriptor) {
    await metadataPath(file(root), descriptor.database.path);
    await staleRequests(root, descriptor.database.path);
  }
  const settings = await captureSettings(root), outcomes = [];
  for (const client of selected) {
    let receipt = settings.clients[client];
    if (!receipt && uninstall) continue;
    if (!uninstall && captureRequested(enabled, receipt)) await clientConfigDirectory(client, context.env);
    receipt ??= settings.clients[client] = { enabled: true, noticed: false, engineId: descriptor.engine.id, node: descriptor.node };
    if (enabled !== undefined) receipt.enabled = enabled;
    // Uninstall disables without changing the user's retained setup preference.
    // Orphan recovery has no trusted store path. Disable retained hooks using
    // their receipts, but never write metadata without a descriptor.
    if (descriptor) await save(root, settings, descriptor.database.path);
    const installation = join(root, 'capture', client);
    let outcome;
    if (!uninstall && !receipt.noticed) {
      context.write(context.t('local_capture_notice', { client: client === 'claude' ? 'Claude Code' : 'Codex' }));
      if (client === 'codex') context.write(context.t('local_capture_codex_approval'));
      receipt.noticed = true; await save(root, settings, descriptor.database.path);
    }
    if (uninstall || !receipt.enabled) {
      outcome = await exists(join(installation, 'installation.json')) ?
        await invoke(root, receipt, ['disable', '--installation', installation], context) : { status: 'disabled' };
    } else {
      const request = await requestFor(root, descriptor, client, receipt, context);
      if (client === 'codex') {
        await qualification(root, receipt, context);
      }
      if (!await exists(descriptor.database.path)) {
        const initialized = await invoke(root, receipt, ['init', '--database', descriptor.database.path], context);
        if (initialized.status !== 'initialized') { outcome = initialized; }
      }
      if (!outcome) {
        const requestPath = join(root, `capture-${client}-request.json`);
        // Sensitive paths, namespace and consent metadata only; requestFor
        // never includes conversation text, credentials or transcript bytes.
        await metadataPath(requestPath, descriptor.database.path);
        if (await exists(requestPath)) await boundedJSON(requestPath, 65536, { privateFile: true });
        await atomicMetadata(requestPath, descriptor.database.path,
          temporary => open(temporary, 'wx', 0o600), JSON.stringify(request) + '\n');
        outcome = enabled === true && await exists(join(installation, 'installation.json')) ?
          await invoke(root, receipt, ['activate', '--installation', installation], context) :
          await invoke(root, receipt, ['setup', '--request', requestPath], context);
        if (outcome.status === 'prepared') outcome = await invoke(root, receipt, ['activate', '--installation', installation], context);
      }
    }
    // Read the same cache-only observation as status, including after a failed
    // action. Never report capture from an intermediate action result.
    if (!uninstall && receipt.enabled) {
      outcome = await invoke(root, receipt, ['status', '--installation', installation], { ...context, timeout: 10000 });
    }
    const summary = showCapture(client, outcome, context);
    outcomes.push({ client, requested: !uninstall && receipt.enabled, ...summary });
    // A disable refusal must stop uninstall before engine/MCP detachment.
    if ((uninstall || !receipt.enabled) && outcome.status !== 'disabled') fail();
  }
  return outcomes;
}
export function finishCaptureSetup(outcomes, { write, t }) {
  const inactive = outcomes.filter(value => value.requested && value.state !== 'on');
  if (!inactive.length) { write(t('local_done')); write(t('next_reopen')); return 0; }
  write(t('next_reopen'));
  write(inactive.map(value => t(value.temporary ? 'local_capture_setup_waiting' : 'local_capture_setup_off', {
    client: value.client === 'claude' ? 'Claude Code' : 'Codex', reason: value.reason,
  })).join(' '));
  return inactive.some(value => !value.temporary) ? 2 : 0;
}
function showCapture(client, outcome, { write, t }) {
  // A retained older runtime may omit the DTO. Keep capture status waiting
  // rather than infer a qualified host or inspect its private cache ourselves.
  const verdict = client === 'codex' ? outcome.qualification ??
    (['active', 'prepared'].includes(outcome.status) ? { status: 'pending', reason: 'qualification_required' } : undefined) : undefined;
  const waiting = verdict && verdict.status !== 'qualified';
  const state = outcome.status === 'active' && !waiting ? 'on' : outcome.status === 'disabled' ? 'off' : 'blocked';
  const allowedReasons = new Set(['not_installed','prepared','rearm_required','recovery_required','configuration_conflict','configuration_changed',
    'invalid_input','declined','source_refused','event_refused','unsafe_path','store_invalid','authority_bound','authority_changed','qualification_required','runtime_unavailable','busy','cancelled','child_unavailable','unexpected_failure']);
  const reason = waiting ? 'qualification_required' : state === 'blocked' ? (allowedReasons.has(outcome.reason) ? outcome.reason : outcome.status === 'prepared' ? 'prepared' : outcome.status === 'busy' ? 'busy' : outcome.status === 'declined' ? 'declined' : 'not_installed') : state;
  write(t('local_capture_status', { client: client === 'claude' ? 'Claude Code' : 'Codex', state, reason }));
  if (client === 'codex') {
    write(t('local_capture_codex_approval'));
    if (verdict) {
      const status = ['qualified', 'pending', 'failed'].includes(verdict.status) ? verdict.status : 'pending';
      const reason = /^[a-z_]{1,64}$/.test(verdict.reason ?? '') ? verdict.reason : 'qualification_required';
      write(t('local_capture_qualification_status', { state: status, reason }));
      write(t(waiting ? 'local_capture_qualification' : 'local_capture_last_qualified'));
    } else if (outcome.reason === 'qualification_required') write(t('local_capture_qualification'));
  }
  return { state, reason, temporary: outcome.status === 'active' && outcome.qualification?.status === 'pending' };
}
export async function captureStatus(root, client, context) {
  const receipt = (await captureSettings(root)).clients[client];
  if (!receipt) return; // 0.6.5 descriptors retain their established status shape.
  let outcome = await invoke(root, receipt, ['status', '--installation', join(root, 'capture', client)], { ...context, timeout: 10000 });
  if (!receipt.enabled && outcome.reason === 'not_installed') outcome = { status: 'disabled' };
  showCapture(client, outcome, context);
}
export async function retainedCapture(root) { return Object.keys((await captureSettings(root)).clients).length > 0; }
