import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { codexHome } from './codex.mjs';
import { claudeCapabilities, observedVector, readClaudeServers, registerClaude } from './local-claude.mjs';
import { codexCapabilities, inspectLocalCodexServers, recoverCutoverCodexLock, registerCodex } from './local-codex.mjs';
import { activateCapture, stageStore } from './local-cutover-activation.mjs';
import { captureTargetFor } from './local-cutover-journal.mjs';
import { cutoverRefusal as refuse, withColdStoreLease } from './local-cutover-lease.mjs';
import { maintenanceFor, removeActivationBackup } from './local-cutover-reclaim.mjs';
import { beginActivation, retireLegacy } from './local-cutover-retirement.mjs';
import { canonicalPath, parseStrictJSON, sameVector } from './local-descriptor.mjs';
import { cutoverImport } from './local-cutover-runtime.mjs';
import { SetupError } from './errors.mjs';

const { privateRead, privateWrite } = await cutoverImport('state');
const { captureStoreIdentity } = await cutoverImport('binding');
const { pinColdFile } = await cutoverImport('paths');
const { documentCardsReady, localProviderProfile, localProviderConsentFile, localProviderConsentText } = await cutoverImport('provider');

export async function checkActivationClients({ root, descriptor, env, context, target, resume = false, rollback = false }) {
  const { runClaude, inspection, write, t } = context ?? {};
  if (typeof write !== 'function' || typeof t !== 'function') throw refuse('cutover_arguments');
  const clients = [];
  for (const [name, record] of Object.entries(descriptor.clients)) {
    if (!record) continue;
    const candidate = { ...record.vector, engineId: descriptor.migration?.targetEngineId,
      node: descriptor.node, databasePath: target };
    const previous = rollback ? candidate : record.vector;
    const desired = rollback ? record.vector : candidate;
    let entry, register;
    if (name === 'claude') {
      if (record.home !== await canonicalPath(env.HOME || homedir()) || typeof runClaude !== 'function' ||
          !await claudeCapabilities(runClaude)) throw refuse('cutover_client_unavailable');
      entry = (await readClaudeServers(record.home, { includeLaunchOptions: true }))['cairn-local'];
      register = () => registerClaude({ root, home: record.home, checkpoint: { previous, desired }, run: runClaude,
        write, t, allowCoreLocal: true });
    } else {
      if (dirname(record.configPath) !== await canonicalPath(codexHome(env)) ||
          !await codexCapabilities(env)) throw refuse('cutover_client_unavailable');
      if (resume) await recoverCutoverCodexLock(dirname(record.configPath), root);
      entry = (await inspectLocalCodexServers({ ...inspection, home: dirname(record.configPath), env,
        includeLaunchOptions: true })).find(item => item.name === 'cairn-local');
      register = () => registerCodex({ root, checkpoint: { previous, desired, destination: record.configPath },
        env, inspection, capable: true, write, t, allowCoreLocal: true, cutover: true });
    }
    if (entry?.customEnvironment) throw refuse('cutover_model_configured');
    if (entry?.enabled === false) throw refuse('cutover_client_changed');
    const observed = observedVector(root, entry, true);
    const installed = resume && sameVector(observed, desired);
    if (!installed && !sameVector(observed, previous) && !(resume && !entry)) throw refuse('cutover_client_changed');
    clients.push({ name, installed, register });
  }
  return clients;
}

function providerConsentPath(root, descriptor) {
  const cutover = descriptor.migration?.cutover;
  return cutover && join(maintenanceFor(root, cutover.id), localProviderConsentFile);
}

export async function hasProviderConsent(root, descriptor) {
  const path = providerConsentPath(root, descriptor);
  if (!path) return false;
  const text = await privateRead(path, { missing: true });
  if (text === undefined) return false;
  if (text !== localProviderConsentText(descriptor.ownerId, descriptor.projectId)) throw refuse('cutover_model_configured');
  return true;
}

export async function recordProviderConsent(root, descriptor) {
  await privateWrite(providerConsentPath(root, descriptor), localProviderConsentText(descriptor.ownerId, descriptor.projectId),
    { exclusive: true });
}

export async function hasLegacyProviderConfiguration(root) {
  for (const client of ['claude', 'codex']) {
    const text = await privateRead(join(root, 'capture', client, 'installation.json'), { missing: true });
    if (text === undefined) continue;
    const { request } = parseStrictJSON(text);
    if (!request || request.interpretationConsent) return true;
  }
  return false;
}

export async function activationModelConfigured(root, descriptor, env, requestModel = false) {
  const offered = requestModel && Object.hasOwn(env, localProviderProfile.providerApiKeyEnv);
  const consented = await hasProviderConsent(root, descriptor);
  if (((consented || offered) && !documentCardsReady) || await hasLegacyProviderConfiguration(root)) {
    throw refuse('cutover_model_configured');
  }
  return { keyed: consented || offered, recordConsent: offered && !consented };
}

export async function assertSupportedLegacyContents(path, { keyless = true } = {}) {
  const file = pinColdFile(path);
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(file.path, { readOnly: true });
  let timeless = 0;
  try {
    db.exec('PRAGMA query_only = ON; PRAGMA trusted_schema = OFF; BEGIN');
    const exists = db.prepare("SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = ?");
    // An earlier model configuration can have left user content behind,
    // even if neither client has a provider key configured now.
    const unsupported = ['private_cards', 'card_notes', 'session_episodes', 'staged_capture_evidence',
      'assets', 'method_packages', 'role_profiles'];
    for (const table of unsupported) {
      if (exists.get(table) && db.prepare(`SELECT 1 FROM ${table} LIMIT 1`).get()) {
        throw refuse('cutover_legacy_content_unrepresentable');
      }
    }
    if (exists.get('raw_messages')) {
      // Before the local range index, receive time could stand in for event
      // time. A stored timestamp alone cannot prove those sessions are timed.
      const hasRanges = exists.get('local_raw_session_ranges');
      timeless = db.prepare(`SELECT count(*) AS total FROM raw_conversations c
        ${hasRanges ? `LEFT JOIN local_raw_session_ranges r
          USING (owner_id, scope, project_id, client, session_key)` : ''}
        WHERE EXISTS (SELECT 1 FROM raw_messages m WHERE m.conversation_id = c.id
          ${hasRanges ? 'AND (r.session_key IS NULL OR r.unknown_time = 1 OR m.occurred_at IS NULL)' : ''})`).get().total;
    }
  } finally { db.close(); }
  file.check();
  if (keyless && timeless > 0) {
    throw new SetupError('cutover_timeless_raw', 2, { timeless });
  }
  return timeless;
}

export async function confirmActivation({ root, maintenance, descriptor, manifest, env, context,
  receipt, drain, reattest, proveRetired, onCheckpoint }) {
  const { cutover } = descriptor.migration;
  const target = captureTargetFor(cutover.sourcePath, cutover.attemptId);
  const clients = await checkActivationClients({ root, descriptor, env, context, target,
    resume: !!receipt });
  const notify = state => onCheckpoint(state, structuredClone(cutover));
  const captureClients = [];
  for (const { name } of clients) {
    if (await privateRead(join(maintenance, name + '.json'), { missing: true }) !== undefined) captureClients.push(name);
  }
  const handoff = (client, stagedStore, checkSource, stageOnly) => activateCapture({
    root, maintenance, descriptor, manifest, client, reattest: checkSource, stagedStore, stageOnly, onCheckpoint,
  });

  if (!receipt || receipt.phase === 'staging') {
    drain();
    await withColdStoreLease(cutover.sourcePath, async assertLease => {
      const checkSource = () => reattest(assertLease);
      await checkSource();
      if (!receipt) {
        receipt = await beginActivation(maintenance, cutover);
        await notify('activation-staging');
      }
      const stagedStore = await stageStore(cutover, checkSource);
      await notify('activation-target-published');
      for (const client of captureClients) await handoff(client, stagedStore, checkSource, true);
    });
  }

  // Probe the verified bytes until retirement and reclamation are complete.
  // Once activated, legitimate MCP writes can change those bytes.
  const preCommit = receipt.phase === 'staging' || receipt.phase === 'exchanging' ||
    receipt.phase === 'sealed';
  const identity = preCommit ? (await stageStore(cutover)).identity : await captureStoreIdentity(target);
  const targetIdentity = [identity.device, identity.inode].join(':');
  const checkTarget = async () => {
    const current = await captureStoreIdentity(target);
    if (current.device !== identity.device || current.inode !== identity.inode) throw refuse('cutover_target_changed');
  };
  for (const { name, installed, register } of clients) {
    if (installed) continue;
    await checkTarget();
    if (await register() !== 'done') throw refuse('cutover_client_unavailable');
    await notify('activation-mcp-' + name);
  }
  // Leave the legacy pathname and backup in place until both native CLIs
  // verify their new vectors. Keep write authority gated until the cold-store
  // proof succeeds, so a late legacy write can still be rolled back safely.
  const advance = await retireLegacy({ maintenance, cutover, receipt, targetIdentity, drain, reattest, proveRetired, onCheckpoint });
  if (receipt.phase === 'sealed') {
    await removeActivationBackup(maintenance, cutover.attemptId);
    await notify('activation-backup-removed');
    await advance('reclaimed', 'activation-reclaimed');
  }
  for (const client of captureClients) await handoff(client, { target, identity }, checkTarget, false);
  if (receipt.phase !== 'active') await advance('active', 'activation-active');
  return { state: 'active', targetPath: target };
}
