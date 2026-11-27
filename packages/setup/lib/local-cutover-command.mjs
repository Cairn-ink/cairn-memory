import { join } from 'node:path';
import { boundedJSON, localRoot } from './local-descriptor.mjs';
import { installEngine, readBundledCoreLocal } from './local-engine.mjs';
import { captureTargetFor } from './local-cutover-journal.mjs';
import { SetupError } from './errors.mjs';
import { cutoverImport } from './local-cutover-runtime.mjs';

const lines = {
  verified: 'Local cutover verified. Confirm to switch clients and remove the legacy store and migration backup.',
  active: 'Local cutover active. Restart your MCP clients.',
  aborted: 'Local cutover aborted. Legacy service restored.',
  paused: 'Local cutover paused. Close local Cairn sessions, then retry.',
  cutover_model_configured: 'Local cutover is unavailable for model-configured installations. Legacy service remains active.',
  cutover_legacy_content_unrepresentable: 'Local cutover cannot migrate all data in this installation. Legacy service remains active.',
};

export const cutoverActions = Object.freeze({
  '--activate': 'prepare-activation',
  '--confirm': 'confirm-activation',
  '--abort': 'abort',
});

async function installedCutoverState(root, descriptor) {
  const { migration } = descriptor;
  if (!migration?.cutover) return null;
  const [{ maintenanceFor }, { readActivation }] = await Promise.all([
    import('./local-cutover-reclaim.mjs'), import('./local-cutover-retirement.mjs'),
  ]);
  const { cutover } = migration, maintenance = maintenanceFor(root, cutover.id);
  const receipt = await readActivation(maintenance, cutover);
  let target;
  if (receipt?.phase === 'active') {
    const { captureStoreIdentity } = await cutoverImport('binding');
    target = captureTargetFor(cutover.sourcePath, cutover.attemptId);
    const { device, inode } = await captureStoreIdentity(target);
    if (receipt.target !== device + ':' + inode) throw new Error('cutover_target_changed');
  }
  return { state: receipt?.phase === 'active' ? 'active'
    : !receipt && migration.state === 'verified' && !cutover.aborting ? 'verified' : 'paused',
  canResumePrepare: !receipt && migration.state !== 'verified' && !cutover.aborting, maintenance, cutover, target };
}

export async function activeCutoverTarget(root, descriptor) {
  return (await installedCutoverState(root, descriptor))?.target;
}

export async function runActiveDaemon(action, root, descriptor) {
  const target = await activeCutoverTarget(root, descriptor).catch(() => undefined);
  if (!target) throw new SetupError('local_recovery_required', 2);
  try {
    const { runDaemonCommand } = await cutoverImport('liveness');
    let stdout = '';
    const code = await runDaemonCommand([action, '--db', target], { write: text => { stdout += text; } });
    return { code, stdout };
  } catch {
    // The legacy subprocess suppresses internal daemon diagnostics.
    return { code: 1, stdout: '' };
  }
}

export async function showInstalledCutover(root, descriptor, context, { retryPrepare = false } = {}) {
  const { write } = context;
  let current;
  try { current = await installedCutoverState(root, descriptor); }
  catch {
    write.literal(lines.paused);
    return 2;
  }
  if (!current) return 2;
  if (retryPrepare && current.canResumePrepare) return runInstalledCutover('prepare-activation', context);
  write.literal(lines[current.state]);
  if (current.state !== 'active') return current.state === 'paused' ? 2 : 0;
  for (const [client, label] of [['claude', 'Claude Code'], ['codex', 'Codex']]) {
    const journal = await optionalJSON(join(current.maintenance, `capture-${client}.json`));
    if (journal?.attempt !== current.cutover.attemptId ||
        !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u.test(journal.generation ?? '')) continue;
    const failure = await optionalJSON(join(root, 'capture', client, 'core-' + journal.generation, 'last-model-failure.json'));
    if (/^[a-z_]{1,64}$/u.test(failure?.code ?? '')) {
      write(`${label} capture archived Raw without saving memories for a chunk (${failure.code}).`);
    }
  }
  return 0;
}

async function optionalJSON(path) {
  try { return await boundedJSON(path, 65536, { privateFile: true }); }
  catch (error) {
    if (error.code === 'ENOENT') return undefined;
    throw error;
  }
}

export async function runInstalledCutover(action, context) {
  const { env, platform, write } = context;
  if (action !== 'abort' && !['linux', 'darwin'].includes(platform ?? process.platform)) {
    write.literal(lines.paused);
    return 2;
  }
  try {
    const root = await localRoot(env);
    const manifest = action === 'abort' ? undefined : await readBundledCoreLocal();
    const { runLocalCutover } = await import('./local-cutover.mjs');
    const result = await runLocalCutover({ root, manifest, action, env, platform, context,
      ...(action === 'prepare-activation' && {
        stageCandidate: async ({ descriptor, updateChild }) => {
          try {
            const installed = await installEngine({ root, engineId: manifest.engineId, node: descriptor.node,
              references: descriptor.migration ? [descriptor.migration.targetEngineId] : [],
              candidate: true, env, onChild: ({ kind, pid }) => updateChild(kind === 'npm' ? pid : null) });
            if (installed.engineId !== manifest.engineId) throw new Error('cutover_candidate_changed');
          } finally {
            await updateChild(null);
          }
        },
      }) });
    write.literal(lines[result.state]);
    return 0;
  } catch (error) {
    if (error.key === 'cutover_timeless_raw') {
      const count = error.params.timeless;
      write.literal(`Local cutover paused. Found ${count} Raw ${count === 1 ? 'session' : 'sessions'} without event times. Legacy service remains active until a follow-up release addresses this.`);
      return 2;
    }
    const refusal = error.params?.code ?? error.code;
    const status = Object.hasOwn(lines, refusal) ? refusal : 'paused';
    write.literal(lines[status]);
    return 2;
  }
}
