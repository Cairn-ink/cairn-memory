import { dirname, join } from 'node:path';
import { executableFor } from './local-descriptor.mjs';
import { reconcileActiveCapture } from './local-cutover-detach.mjs';
import { activeCodexQualification, captureSettings, clientConfigDirectory, disableCapturePreference, showCapture } from './local-capture.mjs';

export async function repairActiveCapture(root, maintenance, descriptor, engineId, repairing, selected,
  { noCapture, reattach = false }, context) {
  const settings = await captureSettings(root);
  const executable = join(dirname(executableFor(root, engineId)), 'capture-cli.mjs');
  const outcomes = [];
  for (const client of repairing) {
    const report = selected.includes(client);
    const receipt = settings.clients[client];
    const disabled = report && noCapture;
    const enabled = disabled ? false : receipt?.enabled || (reattach ? false : undefined);
    const nativePath = async () => join(await clientConfigDirectory(client, context.env),
      client === 'claude' ? 'settings.json' : 'hooks.json');
    let outcome;
    try {
      outcome = await reconcileActiveCapture(root, maintenance, descriptor, client, {
        enabled, nativePath, desired: { executable, node: process.execPath },
      });
    } catch (error) {
      if (!report || disabled) throw error;
      outcome = { status: 'blocked', reason: error.reason ?? 'configuration_conflict', failed: true };
    }
    if (disabled) await disableCapturePreference(root, descriptor, client);
    if (outcome.status === 'active' && client === 'codex' && report) {
      const pinned = receipt ?? { engineId: descriptor.migration.sourceEngineId, node: process.execPath };
      outcome.qualification = await activeCodexQualification(root, pinned, outcome.request.installation.qualificationConfigPath, context);
    }
    if (report) outcomes.push({ client, requested: outcome.status !== 'disabled', failed: outcome.failed, ...showCapture(client, outcome, context) });
  }
  return outcomes;
}
