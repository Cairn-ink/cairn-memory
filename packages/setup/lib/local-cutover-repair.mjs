import { dirname, join } from 'node:path';
import { SetupError } from './errors.mjs';
import { observedVector, registerClaude } from './local-claude.mjs';
import { registerCodex } from './local-codex.mjs';
import { readDescriptor, sameVector, withLocalLock, writeDescriptor } from './local-descriptor.mjs';
import { engineBaseId, installEngine, readBundledCoreLocal } from './local-engine.mjs';
import { coreLocalEngineIdPattern } from './local-engine-generation.mjs';
import { activeCutoverTarget, activeDaemonStopped, runActiveDaemon } from './local-cutover-command.mjs';
import { maintenanceFor } from './local-cutover-reclaim.mjs';
import { finishCaptureSetup } from './local-capture.mjs';
import { repairActiveCapture } from './local-cutover-capture-repair.mjs';
import { cutoverImport } from './local-cutover-runtime.mjs';

const clients = ['claude', 'codex'];
const label = client => client === 'claude' ? 'Claude Code' : 'Codex';
const recovery = () => new SetupError('local_recovery_required', 2);

export async function repairActiveLocal(options, selection, detection, context) {
  const { root, descriptor, destinations, states } = detection;
  const { env, runClaude, inspection, t, write, progress = {} } = context;
  const selected = clients.filter(client => descriptor.clients[client] && (!selection.client || selection.client === client));
  write(t('local_privacy'));
  if (!selected.length) { write(t('local_done')); return 0; }
  progress.localOperation = true;
  progress.localAction = 'setup';
  return withLocalLock(root, async onChild => {
    const current = await readDescriptor(root, { allowV2: true });
    if (JSON.stringify(current) !== JSON.stringify(descriptor)) throw recovery();
    const target = await activeCutoverTarget(root, current);
    if (!target || !current.node) throw recovery();
    const { migration } = current;
    const maintenance = maintenanceFor(root, migration.cutover.id);
    const intentPath = join(maintenance, 'repair.json');
    const { privateRead, privateWrite, privateRemove } = await cutoverImport('state');
    const intentText = await privateRead(intentPath, { missing: true });
    const old = migration.targetEngineId;
    const intent = intentText === undefined ? null : JSON.parse(intentText);
    if (intent && (Object.keys(intent).length !== 3 || intent.version !== 1 ||
        !coreLocalEngineIdPattern.test(intent.from) || !coreLocalEngineIdPattern.test(intent.to) ||
        (intent.from !== old && intent.to !== old))) throw recovery();

    const manifest = await readBundledCoreLocal();
    let installed;
    try {
      installed = await installEngine({ root, node: process.execPath, engineId: engineBaseId(intent?.to ?? old) === manifest.engineId ? (intent?.to ?? old) : manifest.engineId,
        candidate: true, references: [old, ...(intent ? [intent.from, intent.to] : [])], env, write, t,
        onChild: ({ kind, pid }) => onChild(kind === 'npm' ? pid : null) });
    } finally { await onChild(null); }
    progress.local_engine = true;
    const next = installed.engineId;
    const switchGeneration = next !== old || intent !== null || current.node !== process.execPath;
    const repairing = switchGeneration ? clients.filter(client => current.clients[client]) : selected;
    if (switchGeneration) {
      for (const client of repairing) {
        if (!states[client].available || states[client].localUnknown) throw recovery();
      }
      await privateWrite(intentPath, JSON.stringify({ version: 1, from: intent?.from ?? old, to: next }) + '\n');
      if (!activeDaemonStopped(await runActiveDaemon('stop', root, current))) throw recovery();
    }
    let manual = false;
    for (const client of repairing) {
      const receipt = current.clients[client];
      const desired = { ...receipt.vector, node: process.execPath, engineId: next, databasePath: target };
      const expected = { ...desired, node: current.node, engineId: intent?.from ?? old };
      const existing = observedVector(root, states[client].entry, true);
      const previous = sameVector(existing, expected) || (intent && sameVector(existing, { ...desired, engineId: intent.to }))
        ? existing : receipt.vector;
      const checkpoint = { previous, desired, destination: destinations[client] };
      const state = client === 'claude'
        ? await registerClaude({ root, home: receipt.home, checkpoint, run: runClaude, write, t, allowCoreLocal: true })
        : await registerCodex({ root, checkpoint, env, inspection, write, t, allowCoreLocal: true });
      if (state === 'done') {
        progress['local_' + client] = true;
        write(t('local_registered', { client: label(client) }));
      } else manual = true;
    }
    if (switchGeneration && manual) return 1;
    const capture = await repairActiveCapture(root, maintenance, current, next, repairing, selected, options, { ...context, onChild });
    if (switchGeneration && capture.some(outcome => outcome.failed)) return finishCaptureSetup(capture, context);
    if (switchGeneration && current.engine?.id === old) {
      current.engine = { ...current.engine, id: next, sha256: installed.sha256 };
      for (const receipt of Object.values(current.clients)) if (receipt) {
        receipt.vector = { ...receipt.vector, node: process.execPath, engineId: next };
      }
    }
    current.node = process.execPath;
    migration.targetEngineId = next;
    await writeDescriptor(root, current);
    if (switchGeneration) {
      await privateRemove(intentPath);
      const { syncDirectory } = await cutoverImport('state');
      await syncDirectory(maintenance);
    }

    return finishCaptureSetup(capture, context) || (manual ? 1 : 0);
  });
}
