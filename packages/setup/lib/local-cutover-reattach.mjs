import { SetupError } from './errors.mjs';
import { registerClaude } from './local-claude.mjs';
import { checkCodexLock, registerCodex } from './local-codex.mjs';
import { dirname } from 'node:path';
import { beginOperation, readDescriptor, recordClient, withLocalLock, writeDescriptor } from './local-descriptor.mjs';
import { finishCaptureSetup } from './local-capture.mjs';
import { engineBaseId, installEngine, readBundledCoreLocal } from './local-engine.mjs';
import { activeCutoverTarget } from './local-cutover-command.mjs';
import { maintenanceFor } from './local-cutover-reclaim.mjs';
import { assertTombstone } from './local-cutover-retirement.mjs';
import { repairActiveCapture } from './local-cutover-capture-repair.mjs';
import { cutoverImport } from './local-cutover-runtime.mjs';

const clients = ['claude', 'codex'];
const label = client => client === 'claude' ? 'Claude Code' : 'Codex';
const recovery = () => new SetupError('local_recovery_required', 2);

export async function reattachActiveLocal(options, selection, { root, descriptor, destinations, states }, context) {
  const { write, t, interactive, prompt, env, runClaude, inspection, progress = {} } = context;
  const { documentCardsReady } = await cutoverImport('provider');
  if ((!documentCardsReady && Object.hasOwn(env, 'OPENAI_API_KEY')) || options.project !== undefined) {
    throw new SetupError('local_option_invalid', 2);
  }
  write(t('local_privacy'));
  const selected = descriptor.operation?.clients ?? [];
  if (descriptor.operation) {
    if (descriptor.operation.kind !== 'setup' || (selection.client && selected.some(client => client !== selection.client)))
      throw recovery();
  } else for (const client of clients) {
    if (!states[client].available || (selection.client && selection.client !== client)) continue;
    if (interactive) {
      const answer = (await prompt(t('connect_' + client))).trim();
      if (!/^(?:y|yes)$/iu.test(answer) && (client !== 'claude' || answer)) continue;
    }
    selected.push(client);
  }
  if (!selected.length) { write(t('local_done')); return 0; }
  for (const client of selected) {
    const checkpoint = descriptor.operation?.checkpoints[client];
    if (!states[client].available || states[client].localUnknown ||
        (checkpoint && checkpoint.destination !== destinations[client])) throw recovery();
  }
  if (selected.includes('codex')) await checkCodexLock(dirname(destinations.codex));
  progress.localOperation = true;
  progress.localAction = 'setup';
  return withLocalLock(root, async onChild => {
    const current = await readDescriptor(root, { allowV2: true });
    if (JSON.stringify(current) !== JSON.stringify(descriptor)) throw recovery();
    const { migration, database } = current;
    const target = await activeCutoverTarget(root, current);
    if (!target) throw recovery();
    await assertTombstone(database.path);
    const manifest = await readBundledCoreLocal();
    const old = migration.targetEngineId;
    let installed;
    try {
      installed = await installEngine({ root, node: process.execPath, candidate: true,
        engineId: engineBaseId(old) === manifest.engineId ? old : manifest.engineId, references: [old],
        env, write, t, onChild: ({ kind, pid }) => onChild(kind === 'npm' ? pid : null) });
    } finally { await onChild(null); }
    progress.local_engine = true;
    if (current.operation && (current.node !== process.execPath || installed.engineId !== old)) throw recovery();
    // Only the setup checkpoint publishes intent. Both serving paths refuse
    // admission until the descriptor finishes reattachment.
    if (!current.operation) {
      current.node = process.execPath;
      migration.targetEngineId = installed.engineId;
      current.engine = { id: installed.engineId, package: manifest.package.name,
        packageVersion: manifest.package.version, sha256: installed.sha256 };
      beginOperation(current, 'setup', selected, destinations, { engineId: installed.engineId,
        node: current.node, databasePath: target, ownerId: current.ownerId, projectId: current.projectId });
      await writeDescriptor(root, current);
    }
    let manual = false;
    for (const client of selected) {
      const checkpoint = current.operation.checkpoints[client];
      const state = client === 'claude'
        ? await registerClaude({ root, home: checkpoint.destination, checkpoint, run: runClaude, write, t, allowCoreLocal: true })
        : await registerCodex({ root, checkpoint, env, inspection, write, t, allowCoreLocal: true });
      if (state !== 'done') { manual = true; continue; }
      recordClient(current, client, checkpoint.desired);
      await writeDescriptor(root, current);
      progress['local_' + client] = true;
      write(t('local_registered', { client: label(client) }));
    }
    if (manual) return 1;
    const maintenance = maintenanceFor(root, migration.cutover.id);
    const capture = await repairActiveCapture(root, maintenance, current, installed.engineId, selected, selected,
      { ...options, reattach: true }, { ...context, onChild });
    if (capture.some(outcome => outcome.failed)) return finishCaptureSetup(capture, context);
    if (await activeCutoverTarget(root, current) !== target) throw recovery();
    await assertTombstone(database.path);
    current.state = 'installed';
    current.operation = null;
    current.installerVersion = context.installerVersion;
    await writeDescriptor(root, current);
    return finishCaptureSetup(capture, context);
  });
}
