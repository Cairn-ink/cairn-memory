// Installer orchestration only. Authority, hook merging and capture belong to
// the installed engine; keep its identity and pinned runtime across uninstall.
import { spawn } from 'node:child_process';
import { mkdir, open, rename, lstat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { boundedJSON, canonicalPath, executableFor, ownedDirectory, validPath, engineIdPattern } from './local-descriptor.mjs';
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
async function save(root, settings) {
  const temporary = file(root) + `.tmp-${process.pid}`;
  const handle = await open(temporary, 'wx', 0o600);
  try { await handle.writeFile(JSON.stringify(settings, null, 2) + '\n'); await handle.sync(); }
  finally { await handle.close(); }
  await rename(temporary, file(root));
}
async function directory(path) {
  await mkdir(path, { recursive: true, mode: 0o700 });
  await ownedDirectory(path);
  if (await canonicalPath(path) !== path) fail();
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
async function qualification(root, receipt, context, probe) {
  const module = pathToFileURL(join(engineRoot(root, receipt), 'integrations/codex/qualification.mjs')).href;
  const config = join(root, 'capture-support/codex/installation.json');
  const script = `const q=await import(${JSON.stringify(module)});
    const host=await q.resolveCLI(process.env);
    const verdict=host?await q.${probe ? 'qualifyBinary' : 'cachedQualification'}(${JSON.stringify(config)},host):{status:'pending'};
    console.log(JSON.stringify({status:verdict.status}));`;
  return engineChild(receipt.node, ['--input-type=module', '-e', script], { ...context, timeout: probe ? 90000 : 10000 });
}
async function requestFor(root, descriptor, client, receipt, context) {
  const home = await canonicalPath(context.env.HOME);
  const nativeHome = client === 'claude' ? await canonicalPath(context.env.CLAUDE_CONFIG_DIR ?? join(home, '.claude')) :
    await canonicalPath(context.env.CODEX_HOME ?? join(home, '.codex'));
  await directory(nativeHome);
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
    if (!await exists(config)) {
      const handle = await open(config, 'wx', 0o600); try { await handle.writeFile('{}\n'); } finally { await handle.close(); }
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
export async function configureCapture(root, descriptor, selected, context, { enabled, uninstall = false } = {}) {
  const settings = await captureSettings(root);
  for (const client of selected) {
    let receipt = settings.clients[client];
    if (!receipt && uninstall) continue;
    receipt ??= settings.clients[client] = { enabled: true, noticed: false, engineId: descriptor.engine.id, node: descriptor.node };
    if (enabled !== undefined) receipt.enabled = enabled;
    // Uninstall disables without changing the user's retained setup preference.
    await save(root, settings);
    const installation = join(root, 'capture', client);
    let outcome, format;
    if (!uninstall && !receipt.noticed) {
      context.write(context.t('local_capture_notice', { client: client === 'claude' ? 'Claude Code' : 'Codex' }));
      if (client === 'codex') context.write(context.t('local_capture_codex_approval'));
      receipt.noticed = true; await save(root, settings);
    }
    if (uninstall || !receipt.enabled) {
      outcome = await exists(join(installation, 'installation.json')) ?
        await invoke(root, receipt, ['disable', '--installation', installation], context) : { status: 'disabled' };
    } else {
      const request = await requestFor(root, descriptor, client, receipt, context);
      if (client === 'codex') {
        format = await qualification(root, receipt, context, true);
        if (format.status !== 'qualified') context.write(context.t('local_capture_qualification'));
      }
      if (!await exists(descriptor.database.path)) {
        const initialized = await invoke(root, receipt, ['init', '--database', descriptor.database.path], context);
        if (initialized.status !== 'initialized') { outcome = initialized; }
      }
      if (!outcome) {
        const requestPath = join(root, `capture-${client}-request.json`);
        // Only installer-owned request metadata, never engine authority files.
        if (await exists(requestPath)) await boundedJSON(requestPath, 65536, { privateFile: true });
        const temporary = requestPath + `.tmp-${process.pid}`;
        const handle = await open(temporary, 'wx', 0o600);
        try { await handle.writeFile(JSON.stringify(request) + '\n'); await handle.sync(); } finally { await handle.close(); }
        await rename(temporary, requestPath);
        outcome = enabled === true && await exists(join(installation, 'installation.json')) ?
          await invoke(root, receipt, ['activate', '--installation', installation], context) :
          await invoke(root, receipt, ['setup', '--request', requestPath], context);
        if (outcome.status === 'prepared') outcome = await invoke(root, receipt, ['activate', '--installation', installation], context);
      }
    }
    if (format && format.status !== 'qualified' && outcome.status === 'active') outcome = { ...outcome, status: 'blocked', reason: 'qualification_required' };
    showCapture(client, outcome, context);
    // A disable refusal must stop uninstall before engine/MCP detachment.
    if ((uninstall || !receipt.enabled) && outcome.status !== 'disabled') fail();
  }
}
function showCapture(client, outcome, { write, t }) {
  const state = outcome.status === 'active' ? 'on' : outcome.status === 'disabled' ? 'off' : 'blocked';
  const allowedReasons = new Set(['not_installed','prepared','rearm_required','recovery_required','configuration_conflict','configuration_changed',
    'unsafe_path','store_invalid','authority_bound','authority_changed','qualification_required','runtime_unavailable','busy','cancelled','child_unavailable','unexpected_failure']);
  const reason = state === 'blocked' ? (allowedReasons.has(outcome.reason) ? outcome.reason : 'not_installed') : state;
  write(t('local_capture_status', { client: client === 'claude' ? 'Claude Code' : 'Codex', state, reason }));
  if (client === 'codex') {
    write(t('local_capture_codex_approval'));
    if (outcome.reason === 'qualification_required') write(t('local_capture_qualification'));
  }
}
export async function captureStatus(root, client, context) {
  const receipt = (await captureSettings(root)).clients[client];
  if (!receipt) return; // 0.6.5 descriptors retain their established status shape.
  let outcome = await invoke(root, receipt, ['status', '--installation', join(root, 'capture', client)], { ...context, timeout: 10000 });
  if (!receipt.enabled && outcome.reason === 'not_installed') outcome = { status: 'disabled' };
  if (client === 'codex' && receipt.enabled && (['active', 'prepared'].includes(outcome.status) || ['not_installed', 'qualification_required'].includes(outcome.reason))) {
    // New engines can report the verdict directly. Older engines require only
    // an identity/cache read. Neither path generates schemas or starts Codex.
    const verdict = outcome.qualification ?? await qualification(root, receipt, context, false);
    if ((typeof verdict === 'string' ? verdict : verdict.status) !== 'qualified') outcome = { ...outcome, status: 'blocked', reason: 'qualification_required' };
  }
  showCapture(client, outcome, context);
}
export async function retainedCapture(root) { return Object.keys((await captureSettings(root)).clients).length > 0; }
