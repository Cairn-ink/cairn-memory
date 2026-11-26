import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { privateRead } from '../../../integrations/client/private-state.mjs';
import { captureStoreIdentity } from '../../../packaging/core-local/capture-binding.mjs';
import { pinColdFile } from '../../adapter-sqlite/src/legacy/paths.mjs';
import { codexHome, inspectCodexServers } from './codex.mjs';
import { claudeCapabilities, observedVector, readClaudeServers, registerClaude } from './local-claude.mjs';
import { codexCapabilities, registerCodex } from './local-codex.mjs';
import { activateCapture, stageStore } from './local-cutover-activation.mjs';
import { captureTargetFor } from './local-cutover-journal.mjs';
import { cutoverRefusal as refuse, withColdStoreLease } from './local-cutover-lease.mjs';
import { removeActivationBackup } from './local-cutover-reclaim.mjs';
import { assertNoLegacyCaches, beginActivation, retireLegacy } from './local-cutover-retirement.mjs';
import { canonicalPath, parseStrictJSON, sameVector } from './local-descriptor.mjs';

export async function checkActivationClients({ root, descriptor, env, context, target, resume = false }) {
  const { runClaude, inspection, write, t } = context ?? {};
  if (typeof write !== 'function' || typeof t !== 'function') throw refuse('cutover_arguments');
  const clients = [];
  for (const [name, record] of Object.entries(descriptor.clients)) {
    if (!record) continue;
    const previous = record.vector;
    const desired = { ...previous, engineId: descriptor.migration?.targetEngineId,
      node: descriptor.node, databasePath: target };
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
      entry = (await inspectCodexServers({ ...inspection, home: dirname(record.configPath), env,
        includeLaunchOptions: true })).find(item => item.name === 'cairn-local');
      register = () => registerCodex({ root, checkpoint: { previous, desired, destination: record.configPath },
        env, inspection, capable: true, write, t, allowCoreLocal: true });
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

export async function assertKeylessActivation(root, env) {
  if (Object.hasOwn(env, 'OPENAI_API_KEY')) throw refuse('cutover_model_configured');
  for (const client of ['claude', 'codex']) {
    const text = await privateRead(join(root, 'capture', client, 'installation.json'), { missing: true });
    if (text === undefined) continue;
    const { request } = parseStrictJSON(text);
    if (!request || request.interpretationConsent || Object.hasOwn(env, request.providerApiKeyEnv)) {
      throw refuse('cutover_model_configured');
    }
  }
}

export async function assertSupportedLegacyContents(path) {
  const file = pinColdFile(path);
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(file.path, { readOnly: true });
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
  } finally { db.close(); }
  file.check();
}

export async function confirmActivation({ root, maintenance, descriptor, manifest, env, context,
  receipt, drain, reattest, proveRetired, onCheckpoint }) {
  const { cutover } = descriptor.migration;
  const target = captureTargetFor(cutover.sourcePath, cutover.attemptId);
  const clients = await checkActivationClients({ root, descriptor, env, context, target,
    resume: !!receipt && ['reclaimed', 'active'].includes(receipt.phase) });
  const notify = state => onCheckpoint(state, structuredClone(cutover));
  const captureClients = [];
  for (const { name } of clients) {
    if (await privateRead(join(maintenance, name + '.json'), { missing: true }) !== undefined) captureClients.push(name);
  }
  const handoff = (client, stagedStore, checkSource, stageOnly) => activateCapture({
    root, maintenance, descriptor, manifest, client, env, reattest: checkSource, stagedStore, stageOnly, onCheckpoint,
  });

  if (!receipt || receipt.phase === 'staging') {
    assertNoLegacyCaches(cutover.sourcePath);
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

  // Before reclamation no registered candidate may write. After reclamation
  // the inode stays pinned, while legitimate MCP writes may change its bytes.
  const preCommit = receipt.phase === 'staging' || receipt.phase === 'exchanging' ||
    receipt.phase === 'sealed';
  const identity = preCommit ? (await stageStore(cutover)).identity : await captureStoreIdentity(target);
  const targetIdentity = [identity.device, identity.inode].join(':');
  const advance = await retireLegacy({ maintenance, cutover, receipt, targetIdentity, drain, reattest, proveRetired, onCheckpoint });
  if (receipt.phase === 'sealed') {
    await removeActivationBackup(maintenance, cutover.attemptId);
    await notify('activation-backup-removed');
    await advance('reclaimed', 'activation-reclaimed');
  }
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
  for (const client of captureClients) await handoff(client, { target, identity }, checkTarget, false);
  if (receipt.phase !== 'active') await advance('active', 'activation-active');
  return { state: 'active', targetPath: target };
}
