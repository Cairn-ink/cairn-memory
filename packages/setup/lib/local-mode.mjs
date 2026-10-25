import { constants } from 'node:fs';
import { readFile, lstat, stat, access, mkdir, open, readdir, rm } from 'node:fs/promises';
import { dirname, join, sep } from 'node:path';
import { homedir } from 'node:os';
import { availableClient, codexHome, inspectCodexServers } from './codex.mjs';
import { installEngine, engineIdFor, engineBaseId } from './local-engine.mjs';
import { localRoot, requestedRoot, canonicalPath, readDescriptor, writeDescriptor, withLocalLock,
  engineIdPattern, executableFor, newDescriptor, beginOperation, recordClient, publishedReferences, deletionPath, inside, ownedDirectory, ownedLocalTree } from './local-descriptor.mjs';
import { readClaudeServers, registerClaude, detachClaude } from './local-claude.mjs';
import { registerCodex, detachCodex, checkCodexLock } from './local-codex.mjs';
import { shellArgument } from './output.mjs';
import { SetupError } from './errors.mjs';

const clientNames = ['claude', 'codex'];
const controls = ['disable', 'pause', 'resume', 'prompt-recall-on', 'prompt-recall-off', 'config'];
const yes = value => /^(?:y|yes)$/iu.test(value.trim());
const exists = path => lstat(path).then(() => true, error => { if (error.code === 'ENOENT') return false; throw error; });
const recorded = (descriptor, client) => Boolean(descriptor?.clients[client] ||
  (descriptor?.operation?.checkpoints[client] && descriptor.operation.checkpoints[client].state !== 'detached'));
export function modeUnion(states, pending = false) {
  if (states.some(state => state.unknown)) return 'unknown';
  const cloud = states.some(state => state.cloud), local = pending || states.some(state => state.local);
  return cloud && local ? 'mixed' : cloud ? 'cloud' : local ? 'local' : 'none';
}
export async function detectLocalMode({ env = process.env, runClaude }) {
  let root, descriptor = null, descriptorError;
  try { root = await localRoot(env); descriptor = await readDescriptor(root); }
  catch (error) { root = requestedRoot(env); descriptorError = error; }
  const destinations = { claude: await canonicalPath(env.HOME || homedir()),
    codex: join(await canonicalPath(codexHome(env)), 'config.toml') };
  const states = {};
  for (const client of clientNames) {
    const state = states[client] = { available: availableClient(client), cloud: false, local: recorded(descriptor, client),
      unknown: false, localUnknown: false, probe: '', scopes: [], entry: null };
    if (client === 'codex') {
      try { state.cloud = await exists(join(codexHome(env), 'cairn/installation.json')); }
      catch { state.unknown = true; state.probe = 'cairn/installation.json'; }
    }
    const destination = descriptor?.operation?.checkpoints[client]?.destination ??
      (client === 'claude' ? descriptor?.clients.claude?.home : descriptor?.clients.codex?.configPath);
    if (destination && destination !== destinations[client]) {
      state.unknown = state.localUnknown = true; state.probe = 'destination';
      state.changedHome = { previous: destination, current: destinations[client] };
    }
    if (!state.available) {
      if (recorded(descriptor, client)) { state.unknown = state.localUnknown = true; state.probe = 'CLI'; }
      continue;
    }
    if (client === 'claude') {
      try {
        const entries = await readClaudeServers(destinations.claude);
        state.legacy = Object.hasOwn(entries, 'cairn'); state.cloud = state.legacy;
        state.entry = entries['cairn-local'] ?? null;
        state.local ||= Object.hasOwn(entries, 'cairn-local');
      } catch { state.unknown = state.localUnknown = true; state.probe = '~/.claude.json'; }
      const result = await runClaude(['plugin', 'list', '--json']);
      try {
        if (result.error || result.status !== 0) throw new Error('probe');
        const entries = JSON.parse(result.stdout);
        if (!Array.isArray(entries)) throw new Error('probe');
        // No child JSON, credential field, or malformed excerpt is retained.
        state.scopes = [...new Set(entries.filter(entry => entry?.id === 'cairn-memory@cairn-memory')
          .map(entry => entry.scope).filter(scope => ['user', 'local', 'project', 'managed'].includes(scope)))];
        state.cloud ||= entries.some(entry => entry?.id === 'cairn-memory@cairn-memory');
      } catch {
        const absent = !result.error && result.status === 1 && /^No plugins installed\.?$/u.test((result.stdout + '\n' + result.stderr).trim());
        if (!absent) { state.unknown = true; if (!state.probe) state.probe = 'plugin list'; }
      }
    } else {
      try {
        const entries = await inspectCodexServers({ home: codexHome(env), env });
        state.cloud ||= entries.some(entry => entry.name === 'cairn' && entry.type === 'streamable_http');
        state.entry = entries.find(entry => entry.name === 'cairn-local' && entry.type === 'stdio') ?? null;
        state.local ||= Boolean(state.entry);
      } catch { state.unknown = state.localUnknown = true; state.probe ||= 'mcp list --json'; }
    }
  }
  const orphanEngine = !descriptor && !descriptorError && await exists(join(root, 'engine'));
  return { root, descriptor, descriptorError, orphanEngine, states, destinations,
    union: modeUnion(Object.values(states), descriptor?.operation?.kind === 'setup') };
}
const command = (write, line) => write.literal(line);
export function writeLocalResume(write, t, key = 'recovery_local_setup') {
  write(t(key)); write.literal('npx @cairn-ink/memory setup --local');
}
function detachCommands(detection, write) {
  if (detection.states.codex.cloud) {
    command(write, 'npx @cairn-ink/memory uninstall --client codex'); command(write, 'codex mcp remove cairn');
  }
  if (detection.states.claude.cloud) {
    for (const scope of detection.states.claude.scopes) command(write,
      'claude plugin uninstall cairn-memory@cairn-memory --scope ' + shellArgument(scope));
    if (detection.states.claude.legacy) command(write, 'claude mcp remove --scope user cairn');
  }
}
function refusal(key, detection, { write, t }, params = {}) {
  write(t(key, { ...params, client: params.client === 'claude' ? 'Claude Code' : params.client === 'codex' ? 'Codex' : params.client }));
  if (['mode_conflict_cloud', 'mode_mixed'].includes(key)) {
    detachCommands(detection, write); command(write, 'npx @cairn-ink/memory setup --local');
  }
  if (['mode_conflict_local', 'mode_mixed', 'local_orphan'].includes(key)) {
    command(write, 'npx @cairn-ink/memory uninstall --local');
    if (key !== 'local_orphan') command(write, 'npx @cairn-ink/memory setup --cloud');
  }
  if (key === 'local_recovery_required' || key === 'local_root_invalid') {
    command(write, shellArgument(join(detection.root, 'installation.json')));
    command(write, 'npx @cairn-ink/memory uninstall --local --purge-config');
  }
  if (key === 'mode_required') {
    command(write, 'npx @cairn-ink/memory setup --local'); command(write, 'npx @cairn-ink/memory setup --cloud');
  }
  if (key === 'local_client_home_changed') {
    command(write, shellArgument(params.previous)); command(write, shellArgument(params.current));
    command(write, `${params.client === 'claude' ? 'HOME' : 'CODEX_HOME'}=${shellArgument(params.client === 'claude' ? params.previous : dirname(params.previous))} npx @cairn-ink/memory ${params.action ?? 'setup'} --local`);
  }
  if (key === 'local_operation_pending') command(write, 'npx @cairn-ink/memory uninstall --local');
  return { handled: true, code: 2 };
}
function validateLocalOptions(options, selection, descriptor) {
  if (options.endpoint || options.dailyCap !== undefined || options.captureExec !== undefined ||
      selection.argv.some(arg => ['--reauthorize', '--manual-token', '--no-browser', '--no-clipboard'].includes(arg)) ||
      (descriptor && (options.owner !== undefined || options.db !== undefined ||
        (options.project !== undefined && descriptor.state !== 'uninstalled')))) throw new SetupError('local_option_invalid', 2);
}
export async function routeLocalMode(options, selection, context) {
  const [action, ...flags] = selection.argv;
  if (!['setup', 'status', 'uninstall', ...controls].includes(action)) { context.beforeRouting?.(); return { handled: false }; }
  if (flags.some(flag => !['--dry-run', '--no-browser', '--no-clipboard', '--manual-token', '--reauthorize'].includes(flag)) ||
      (action !== 'setup' && flags.length)) { context.beforeRouting?.(); throw new SetupError('unknown_command', 2); }
  if (!context.supportedNode(context.nodeVersion)) { context.beforeRouting?.(); throw new SetupError('node_required'); }
  const { write, t, interactive, prompt } = context;
  const detection = await detectLocalMode(context);
  const { states, descriptor, union } = detection;
  if (action === 'setup' && (options.local || union === 'local' || (detection.descriptorError && !options.cloud)))
    validateLocalOptions(options, selection, descriptor);
  context.beforeRouting?.();
  if (action === 'uninstall' && options.local) {
    validateLocalOptions(options, selection, descriptor);
    return { handled: true, code: await uninstallLocal(options, selection, detection, context) };
  }
  if (action === 'status') return { handled: false, detection, statusCode: detection.descriptorError || (!descriptor && (detection.orphanEngine || Object.values(states).some(state => state.entry))) ? 2 : 0 };
  if (controls.includes(action) || action === 'uninstall') {
    if (union === 'local') return refusal('local_control_unsupported', detection, context);
    if (union === 'mixed') return refusal('mode_mixed', detection, context);
    if (union === 'unknown' && Object.values(states).some(state => state.local)) return refusal('mode_unknown', detection, context);
    return { handled: false };
  }
  const localOwnership = Object.values(states).some(state => state.local) || Boolean(descriptor?.operation);
  if (union === 'mixed') return refusal('mode_mixed', detection, context);
  if (!descriptor && !detection.descriptorError && (detection.orphanEngine || Object.values(states).some(state => state.entry))) return refusal('local_orphan', detection, context);
  if (union === 'unknown' && (options.cloud || !Object.values(states).some(state => state.changedHome)) && (options.local || localOwnership || Object.values(states).some(state => state.localUnknown))) {
    const [client, state] = Object.entries(states).find(([, state]) => state.unknown);
    return refusal('mode_unknown', detection, context, { client: client === 'claude' ? 'Claude Code' : 'Codex', probe: state.probe });
  }
  if (options.cloud && localOwnership) return refusal('mode_conflict_local', detection, context);
  let local = options.local || union === 'local' || (!options.cloud && (localOwnership || Boolean(detection.descriptorError)));
  if (options.local && union === 'cloud') return refusal('mode_conflict_cloud', detection, context);
  if (!Object.values(states).some(state => state.available)) { write(t('clients_missing')); return { handled: true, code: 0 }; }
  if (union === 'none' && !detection.descriptorError && !options.local && !options.cloud) {
    if (!interactive) return refusal('mode_required', detection, context);
    write(t('mode_local_description')); write(t('mode_cloud_description'));
    const choice = (await prompt(t('ask_mode'))).trim();
    if (!['1', '2'].includes(choice)) return refusal('mode_required', detection, context);
    local = choice === '1';
  }
  if (!local) {
    if (detection.descriptorError) return refusal(detection.descriptorError.key, detection, context);
    return { handled: false };
  }
  validateLocalOptions(options, selection, descriptor);
  if (options.db) {
    const db = await canonicalPath(options.db);
    if (inside(detection.root, db) && db !== join(detection.root, 'data/memory.sqlite')) throw new SetupError('local_option_invalid', 2);
    options = { ...options, db };
  }
  if ((context.platform ?? process.platform) === 'win32') return refusal('local_windows_unsupported', detection, context);
  if (flags.includes('--dry-run')) {
    write(t('local_dry_run'));
    if (detection.descriptorError) {
      write(t(detection.descriptorError.key)); command(write, shellArgument(join(detection.root, 'installation.json')));
    }
    if (descriptor?.operation) writeLocalResume(write, t, 'local_resume_hint');
    return { handled: true, code: 0 };
  }
  if (detection.descriptorError) return refusal(detection.descriptorError.key, detection, context);
  for (const client of clientNames) if (states[client].changedHome) return refusal('local_client_home_changed', detection, context,
    { client, ...states[client].changedHome });
  if (descriptor?.operation && descriptor.operation.kind !== 'setup') return refusal('local_recovery_required', detection, context);
  return { handled: true, code: await setupLocal(options, selection, detection, context) };
}
async function setupLocal(options, selection, detection, context) {
  const { write, t, prompt, interactive, env, runClaude, installerVersion, progress = {} } = context;
  write(t('local_privacy'));
  let selected = detection.descriptor?.operation?.clients;
  if (!selected) {
    selected = [];
    for (const client of clientNames) {
      const state = detection.states[client];
      if (!state.available || (selection.client && selection.client !== client)) continue;
      if (recorded(detection.descriptor, client)) { selected.push(client); continue; }
      if (!interactive) { if (options.local) selected.push(client); else { write(client === 'claude' ? 'Claude Code' : 'Codex'); write(t('local_status_registration', { state: t('local_registration_missing') })); writeLocalResume(write, t, 'local_resume_hint'); } continue; }
      const answer = await prompt(t('connect_' + client));
      if (yes(answer) || (client === 'claude' && !answer.trim())) selected.push(client);
    }
  } else if (selection.client && selected.some(client => client !== selection.client)) throw new SetupError('local_option_invalid', 2);
  if (!selected.length) { write(t(detection.descriptor ? 'local_done' : 'clients_declined')); return 0; }
  if (selected.includes('codex') && !['done', 'manual'].includes(detection.descriptor?.operation?.checkpoints.codex?.state)) await checkCodexLock(dirname(detection.destinations.codex));
  progress.localOperation = true; progress.localAction = 'setup';
  await ownedLocalTree(detection.root);
  // CAIRN_SETUP_NPM_CACHE is caller-supplied test storage, not an owned
  // installation directory. S1 validates that absolute-directory seam when used.
  const root = await localRoot(env, { create: true });
  return withLocalLock(root, async updateChild => {
    let descriptor = await readDescriptor(root);
    if (descriptor && JSON.stringify(descriptor) !== JSON.stringify(detection.descriptor)) throw new SetupError('local_recovery_required', 2, { path: join(root, 'installation.json') });
    descriptor ??= newDescriptor(root, installerVersion, options);
    if (options.project !== undefined) descriptor.projectId = options.project;
    if (options.db && inside(root, await canonicalPath(options.db)) && options.db !== join(root, 'data/memory.sqlite')) throw new SetupError('local_option_invalid', 2);
    let bytes, manifest;
    try {
      bytes = await readFile(new URL('../runtime/engine/manifest.json', import.meta.url));
      manifest = JSON.parse(bytes);
      if (typeof manifest?.package?.name !== 'string' || typeof manifest?.package?.version !== 'string') throw new Error('manifest');
    } catch { throw new SetupError('engine_bundle_invalid'); }
    const baseId = engineIdFor(installerVersion, bytes);
    if (!descriptor.operation) {
      descriptor.node = process.execPath;
      beginOperation(descriptor, 'setup', selected, detection.destinations,
        { engineId: baseId, node: process.execPath, databasePath: descriptor.database.path,
          ownerId: descriptor.ownerId, projectId: descriptor.projectId });
    }
    // Validate destinations again under the root lock, before publishing intent.
    for (const client of descriptor.operation.clients) {
      if (!detection.states[client].available) throw new SetupError('mode_unknown', 2, { client, probe: 'CLI' });
      if (descriptor.operation.checkpoints[client].destination !== detection.destinations[client]) throw new SetupError('local_client_home_changed', 2);
    }
    descriptor.installerVersion = installerVersion;
    await writeDescriptor(root, descriptor);
    await mkdir(join(root, 'data'), { recursive: true, mode: 0o700 });
    for (const name of ['data', 'engine']) {
      await mkdir(join(root, name), { recursive: true, mode: 0o700 });
      await ownedDirectory(join(root, name));
    }
    await deletionPath(root, '.npmrc', { purge: true, databasePath: descriptor.database.path });
    const npmrc = await open(join(root, '.npmrc'), constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW, 0o600);
    await npmrc.chmod(0o600);
    try { await npmrc.writeFile('registry=https://registry.npmjs.org/\n'); await npmrc.sync(); } finally { await npmrc.close(); }
    const references = publishedReferences(descriptor);
    // A user can apply a manual snippet after its checkpoint was cleared.
    // Never quarantine a generation the current native registration still uses,
    // even when a manual receipt describes a newer desired generation.
    for (const state of Object.values(detection.states)) {
      for (const candidate of [state.entry?.command, state.entry?.args?.[0]]) {
        const paths = [candidate];
        try { paths.push(await canonicalPath(candidate)); } catch { /* Not a managed executable. */ }
        for (const path of paths) {
          const prefix = join(root, 'engine') + sep;
          if (typeof path !== 'string' || !path.startsWith(prefix)) continue;
          const id = path.slice(prefix.length).split(sep)[0];
          if (engineIdPattern.test(id) && path === executableFor(root, id)) references.add(id);
        }
      }
    }
    const desiredId = descriptor.operation.checkpoints[selected[0]].desired.engineId;
    // Existing repair generations are reused until the bundled base changes.
    const candidate = descriptor.engine && engineBaseId(descriptor.engine.id) === baseId ? descriptor.engine.id : desiredId;
    if (!references.has(candidate)) await deletionPath(root, 'engine/' + candidate, { renameOnly: true, references, databasePath: descriptor.database.path });
    let installed;
    try {
      installed = await installEngine({ root, engineId: candidate, node: process.execPath, env, write, t,
        databasePath: descriptor.database.path, ownerId: descriptor.ownerId, projectId: descriptor.projectId, references,
        onChild: ({ kind, pid }) => updateChild(kind === 'npm' ? pid : null) });
    } catch (error) {
      descriptor.engine = null; await writeDescriptor(root, descriptor); throw error;
    } finally { await updateChild(null); }
    progress.local_engine = true;
    descriptor.engine = { id: installed.engineId, package: manifest.package.name, packageVersion: manifest.package.version, sha256: installed.sha256 };
    descriptor.node = process.execPath;
    for (const cp of Object.values(descriptor.operation.checkpoints)) if (!['done', 'manual'].includes(cp.state)) {
      cp.desired = { ...cp.desired, engineId: installed.engineId, node: process.execPath };
    }
    await writeDescriptor(root, descriptor);
    let manual = Object.values(descriptor.operation.checkpoints).some(cp => cp.state === 'manual');
    for (const client of descriptor.operation.clients) {
      const checkpoint = descriptor.operation.checkpoints[client];
      if (['done', 'manual'].includes(checkpoint.state)) continue;
      checkpoint.state = 'registering'; await writeDescriptor(root, descriptor);
      const state = client === 'claude' ? await registerClaude({ root, home: checkpoint.destination, checkpoint, run: runClaude, write, t }) :
        await registerCodex({ root, checkpoint, env, write, t });
      if (state === 'done') progress['local_' + client] = true;
      recordClient(descriptor, client, checkpoint.desired);
      checkpoint.state = state; manual ||= state === 'manual'; await writeDescriptor(root, descriptor);
      if (state === 'done') write(t('local_registered', { client: client === 'claude' ? 'Claude Code' : 'Codex' }));

    }
    descriptor.state = 'installed'; descriptor.operation = null; await writeDescriptor(root, descriptor);
    write(t('local_done')); write(t('next_reopen')); return manual ? 1 : 0;
  });
}
export async function localStatus(detection, { write, t, verbose }) {
  if (!detection) return;
  const { descriptor, root, states } = detection;
  if (detection.descriptorError) { refusal(detection.descriptorError.key, detection, { write, t }); return; }
  if (!descriptor && (detection.orphanEngine || Object.values(states).some(state => state.entry))) { refusal('local_orphan', detection, { write, t }); return; }
  for (const client of clientNames) if (states[client].local || states[client].entry) {
    write(t('local_status_client', { client: client === 'claude' ? 'Claude Code' : 'Codex' }));
    const state = states[client].unknown ? 'unknown' : states[client].entry ? 'registered' : 'missing';
    write(t('local_status_registration', { state: t('local_registration_' + state) }));
  }
  if (!descriptor) return;
  if (descriptor.state === 'uninstalled') write(t('local_status_detached'));
  else {
    write(t(descriptor.engine && await exists(executableFor(root, descriptor.engine.id)) ? 'local_status_engine' : 'local_status_unverified', { version: descriptor.installerVersion }));
    let nodeOK = false;
    if (descriptor.node) { try { await access(descriptor.node, constants.X_OK); nodeOK = (await stat(descriptor.node)).isFile(); } catch { /* Missing or non-executable Node. */ } }
    write(t(nodeOK ? 'local_status_node_ok' : 'local_status_node_missing'));
  }
  write(t(descriptor.database.external || root !== join(detection.destinations.claude, '.cairn-memory') ? 'local_status_data_private' : 'local_status_data'));
  if (verbose) {
    for (const value of [descriptor.database.path, descriptor.node, descriptor.engine ? executableFor(root, descriptor.engine.id) : null, descriptor.ownerId, descriptor.engine?.id]) if (value) write.literal(shellArgument(value));
    const failed = await readdir(join(root, 'engine')).catch(() => []);
    if (failed.some(name => /\.failed-\d+$/u.test(name))) {
      write(t('local_status_failed_dirs'));
      for (const name of failed.filter(name => /\.failed-\d+$/u.test(name))) write.literal(shellArgument(join(root, 'engine', name)));
    }
  }
}
async function uninstallLocal(options, selection, detection, { write, t, prompt, interactive, env, runClaude, progress = {} }) {
  const pendingSetup = detection.descriptor?.operation?.kind === 'setup';
  if (pendingSetup && selection.client) return refusal('local_operation_pending', detection, { write, t }).code;
  if (selection.client && detection.descriptor && !['installed', 'uninstalling'].includes(detection.descriptor.state)) throw new SetupError('local_option_invalid', 2);
  const selected = detection.descriptor?.operation?.kind === 'uninstall' ? detection.descriptor.operation.clients :
    clientNames.filter(client => (!selection.client || selection.client === client) &&
      (detection.states[client].available || recorded(detection.descriptor, client)));
  if (selection.client && detection.descriptor?.operation?.kind === 'uninstall' && selected.some(client => client !== selection.client)) throw new SetupError('local_option_invalid', 2);
  for (const client of selected) {
    const state = detection.states[client];
    if (state.changedHome) { refusal('local_client_home_changed', detection, { write, t }, { client, action: 'uninstall', ...state.changedHome }); return 2; }
    if (detection.descriptor?.operation?.checkpoints[client]?.state === 'detached') continue;
    if (!state.available) { refusal('mode_unknown', detection, { write, t }, { client, probe: 'CLI' }); return 2; }
  }
  if (selected.includes('codex') && detection.descriptor?.operation?.checkpoints.codex?.state !== 'detached') await checkCodexLock(dirname(detection.destinations.codex));
  await ownedLocalTree(detection.root);
  write(t('local_uninstall_plan')); write(t('local_data_kept'));
  if (detection.descriptor?.operation?.kind !== 'uninstall' && !options.yes && (!interactive || !yes(await prompt(t('local_uninstall_confirm'))))) return 2;
  progress.localOperation = true; progress.localAction = 'uninstall';
  progress.localUninstallCommand = 'npx @cairn-ink/memory uninstall --local' + (options.yes ? ' --yes' : '') + (selection.client ? ' --client ' + selection.client : '') + (options.purgeConfig ? ' --purge-config' : '');
  const root = await localRoot(env, { create: true });
  return withLocalLock(root, async () => {
    let descriptor = detection.descriptorError ? null : await readDescriptor(root);
    if (descriptor?.operation?.kind === 'setup') {
      const previous = descriptor.operation;
      descriptor.state = 'uninstalling';
      descriptor.operation = { kind: 'uninstall', clients: selected, startedAt: new Date().toISOString(),
        checkpoints: Object.fromEntries(selected.map(client => [client, previous.checkpoints[client] ?
          { ...previous.checkpoints[client], state: 'detaching' } :
          { state: 'detaching', destination: client === 'claude' ? descriptor.clients[client]?.home ?? detection.destinations[client] :
            descriptor.clients[client]?.configPath ?? detection.destinations[client], previous: descriptor.clients[client]?.vector ?? null, desired: null }])) };
      await writeDescriptor(root, descriptor);
    } else if (descriptor && selected.length && descriptor.operation?.kind !== 'uninstall') {
      beginOperation(descriptor, 'uninstall', selected, detection.destinations); await writeDescriptor(root, descriptor);
    }
    for (const client of selected) {
      const cp = descriptor?.operation?.checkpoints[client];
      if (cp?.state === 'detached') continue;
      if (cp) { cp.state = 'detaching'; await writeDescriptor(root, descriptor); }
      if (client === 'claude') await detachClaude({ home: detection.destinations.claude, run: runClaude });
      else await detachCodex({ home: dirname(detection.destinations.codex), env });
      if (descriptor) { recordClient(descriptor, client, null); await writeDescriptor(root, descriptor); }
      write(t('local_uninstall_receipt')); write.literal(client + ': cairn-local');
    }
    if (descriptor) {
      if (Object.values(descriptor.clients).some(Boolean)) {
        descriptor.state = 'installed'; descriptor.operation = null; await writeDescriptor(root, descriptor);
        if (options.purgeConfig) throw new SetupError('local_option_invalid', 2);
      } else {
        const after = await detectLocalMode({ env, runClaude });
        if (Object.values(after.states).some(state => state.unknown || state.entry) ||
            Object.values(descriptor.operation?.checkpoints ?? {}).some(cp => cp.state !== 'detached')) {
          write(t('local_uninstall_retained')); write.literal(shellArgument(join(root, 'engine'))); return 2;
        }
        await rm(await deletionPath(root, 'engine', { databasePath: descriptor.database.path }), { recursive: true, force: true });
        descriptor.state = 'uninstalled'; descriptor.engine = null; descriptor.node = null; descriptor.operation = null;
        await writeDescriptor(root, descriptor);
      }
    } else {
      write(t('local_uninstall_retained')); write.literal(shellArgument(join(root, 'engine')));
      write.literal('rm -rf -- ' + shellArgument(join(root, 'engine')));
    }
    if (options.purgeConfig) for (const name of ['installation.json', '.npmrc']) {
      const path = await deletionPath(root, name, { purge: true, databasePath: descriptor?.database.path });
      if (await exists(path)) { await rm(path); write(t('local_uninstall_receipt')); write.literal(shellArgument(path)); }
    }
    write(t('local_uninstall_done')); write(t('local_data_kept'));
    write.literal(shellArgument(descriptor?.database.path ?? join(root, 'data/memory.sqlite'))); return 0;
  });
}
