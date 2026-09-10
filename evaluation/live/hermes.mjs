import { createHash, randomUUID } from 'node:crypto';
import {
  cpSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync,
} from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readDiagnostics } from './diagnostics.mjs';

export const HERMES_REVISION = 'c8aa5608c24e3636e77c267650c0f1f52e44adb0';
export const MODEL = 'gpt-4.1-mini-2025-04-14';
export const VALUE_ACCEPTANCE_VERSION = 'cairn-value-authority-v2';
export const VALUE_PROMPTS = Object.freeze({
  A: 'Please remember this explicit decision: the fictional Lantern project runs its release review on Tuesday.',
  B: 'Use Cairn to check: when does the fictional Lantern project run its release review?',
  C: 'Please correct the Lantern release-review decision to Friday, replacing the old day rather than adding a second decision.',
  D: 'Use Cairn to check: when does the fictional Lantern project run its release review?',
  E: 'Please forget the Lantern release-review decision.',
  F: 'Use Cairn to check: when does the fictional Lantern project run its release review?',
  control: 'Use Cairn to check: when does the fictional Lantern project run its release review?',
});

const HERE = path.dirname(fileURLToPath(import.meta.url));
const STAGE_SCRIPT = path.join(HERE, 'hermes-stage.py');
const CAIRN_LAUNCHER = path.join(HERE, 'cairn-launcher.mjs');
const EXPECTED_TOOLS = new Set(['cairn_correct_memory', 'cairn_forget_memory', 'cairn_inspect_memory',
  'cairn_recall_memory', 'cairn_remember_memory']);
const fail = (code) => { throw new Error(code); };
const hash = (value) => createHash('sha256').update(value).digest('hex');
const shellQuote = (value) => `'${String(value).replaceAll("'", "'\"'\"'")}'`;
const fileHash = (filename) => hash(readFileSync(filename));

function privateWrite(filename, value) {
  writeFileSync(filename, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
}

function prepareDirectory(directory, requireEmpty = false) {
  const absolute = path.resolve(directory);
  let exists = true;
  try { lstatSync(absolute); }
  catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    exists = false;
  }
  if (!exists) {
    const parent = path.dirname(absolute);
    if (realpathSync(parent) !== parent) fail('unsafe_private_directory');
    mkdirSync(absolute, { mode: 0o700 });
  }
  const stat = lstatSync(absolute);
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail('unsafe_private_directory');
  const real = realpathSync(absolute);
  if (real !== absolute || (process.platform !== 'win32' && (stat.mode & 0o777) !== 0o700)
    || (requireEmpty && readdirSync(real).length !== 0)) fail('unsafe_private_directory');
  return real;
}

function installedPackageRoot(executable) {
  const target = realpathSync(executable);
  const root = path.dirname(path.dirname(target));
  const manifest = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  if (manifest.name !== 'cairn-memory-local-preview') fail('invalid_cairn_artifact');
  return root;
}

function childEnvironment() {
  const env = {};
  for (const key of ['PATH', 'LANG', 'LC_ALL', 'TZ', 'PYTHONHASHSEED']) {
    if (process.env[key]) env[key] = process.env[key];
  }
  return env;
}

function runStage(python, hermesCheckout, request, timeoutMs = 300_000) {
  return new Promise((resolve) => {
    const child = spawn(python, [STAGE_SCRIPT], {
      cwd: hermesCheckout, env: childEnvironment(), stdio: ['pipe', 'pipe', 'ignore'], detached: true,
    });
    const chunks = [];
    let size = 0;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try { process.kill(-child.pid, 'SIGKILL'); } catch { /* already exited */ }
    }, timeoutMs);
    child.stdout.on('data', (chunk) => {
      size += chunk.length;
      if (size <= 300_000) chunks.push(chunk);
      else try { process.kill(-child.pid, 'SIGKILL'); } catch { /* already exited */ }
    });
    child.on('error', () => { clearTimeout(timer); resolve({ ok: false, error: { code: 'hermes_stage_spawn_failed' } }); });
    child.stdin.on('error', () => { /* Child close reports the fixed failure. */ });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut) return resolve({ ok: false, error: { code: 'hermes_stage_timeout' } });
      if (size > 300_000) return resolve({ ok: false, error: { code: 'hermes_stage_output_too_large' } });
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (code !== 0 && parsed.ok !== false) fail('invalid_child_result');
        resolve(parsed);
      } catch { resolve({ ok: false, error: { code: 'invalid_hermes_stage_output' } }); }
    });
    child.stdin.end(JSON.stringify(request));
  });
}

async function snapshotStore(packageRoot, database, ownerId, memoryId) {
  if (!ownerId) return { ok: false, error: { code: 'owner_not_created' } };
  const { openMemoryCore } = await import(pathToFileURL(path.join(packageRoot, 'core/contract.mjs')).href);
  const core = openMemoryCore({ path: database });
  const namespace = { ownerId, scope: 'personal', projectId: null };
  try {
    return {
      list: core.list({ namespace, limit: 50 }),
      target: memoryId ? core.get({ namespace, memoryId }) : null,
    };
  } finally { core.close(); }
}

const tool = (stage, name) => (stage.toolEvents || []).filter((event) => event.name === name);
const success = (event) => event?.result?.ok === true ? event.result.value : null;
const answerHas = (stage, word) => new RegExp(`\\b${word}\\b`, 'iu').test(stage.finalResponse || '');

function observedCurrentBefore(stage, mutation, state) {
  const events = stage.toolEvents || [];
  const index = events.indexOf(mutation);
  for (const event of events.slice(0, Math.max(0, index))) {
    const value = success(event);
    const candidates = event.name === 'cairn_inspect_memory' ? [value]
      : event.name === 'cairn_recall_memory' ? value?.memories || [] : [];
    if (candidates.some(item => item?.memory?.id === state.memoryId
      && item.memory.revision === state.revision && item.receipts?.some(receipt =>
        receipt.id === state.receiptId && receipt.excerpt === item.memory.content))) {
      return event.name;
    }
  }
  return null;
}

export function inspectHermesStage(name, stage, store, state) {
  const base = { stage: name, childSucceeded: stage.ok === true, completed: stage.completed === true };
  if (!base.childSucceeded || !base.completed) return { ...base, passedAutomated: false };
  if (name === 'A') {
    const rememberEvent = tool(stage, 'cairn_remember_memory')[0];
    const saved = success(rememberEvent)?.memory;
    const content = rememberEvent?.arguments?.content;
    const receipt = store?.target?.value?.receipts?.[0];
    const pass = content?.includes('Tuesday') && store?.target?.ok === true
      && store.target.value.memory.id === saved?.id && store.target.value.memory.revision === saved?.revision
      && store.target.value.memory.content === content && receipt?.excerpt === content;
    if (pass) { state.memoryId = saved.id; state.revision = saved.revision; state.receiptId = receipt.id; }
    return { ...base, passedAutomated: Boolean(pass), memoryId: saved?.id ?? null,
      revision: saved?.revision ?? null, receiptId: receipt?.id ?? null };
  }
  if (name === 'B' || name === 'D') {
    const expected = name === 'B' ? 'Tuesday' : 'Friday';
    const recalled = tool(stage, 'cairn_recall_memory').flatMap((event) => success(event)?.memories || []);
    const match = recalled.find((memory) => memory.memory?.id === state.memoryId);
    const current = store?.target?.value;
    const receipt = match?.receipts?.[0];
    const currentReceipt = current?.receipts?.[0];
    const pass = Boolean(match?.memory?.content?.includes(expected) && answerHas(stage, expected)
      && match.memory.revision === state.revision && current?.memory?.revision === state.revision
      && current.memory.content === match.memory.content && receipt?.id === currentReceipt?.id
      && receipt?.excerpt === match.memory.content && receipt.excerpt === currentReceipt?.excerpt
      && (name !== 'D' || !answerHas(stage, 'Tuesday')));
    return { ...base, passedAutomated: pass, recalledMemoryId: match?.memory?.id ?? null,
      recalledRevision: match?.memory?.revision ?? null, receiptId: receipt?.id ?? null,
      answerMentionsExpected: answerHas(stage, expected), operatorReviewRequired: true };
  }
  if (name === 'C') {
    const inspected = tool(stage, 'cairn_inspect_memory').some((event) => success(event)?.memory?.id === state.memoryId);
    const correctedEvent = tool(stage, 'cairn_correct_memory').find((event) => success(event)?.memory?.id === state.memoryId);
    const corrected = success(correctedEvent);
    const observedVia = observedCurrentBefore(stage, correctedEvent, state);
    const current = store?.target?.value?.memory;
    const receipt = store?.target?.value?.receipts?.[0];
    const active = store?.list?.value?.memories;
    const guarded = correctedEvent?.arguments?.memoryId === state.memoryId
      && correctedEvent?.arguments?.expectedRevision === state.revision;
    const pass = observedVia && guarded && corrected?.memory?.content?.includes('Friday')
      && current?.content === corrected.memory.content && current?.revision === corrected.memory.revision
      && current.revision === state.revision + 1 && receipt?.id !== state.receiptId
      && active?.length === 1 && active[0].id === state.memoryId && receipt?.excerpt === current.content;
    if (pass) { state.revision = current.revision; state.receiptId = receipt.id; }
    return { ...base, passedAutomated: Boolean(pass), inspected, observedVia, guarded,
      revision: current?.revision ?? null, receiptId: receipt?.id ?? null };
  }
  if (name === 'E') {
    const inspected = tool(stage, 'cairn_inspect_memory').some((event) => success(event)?.memory?.id === state.memoryId);
    const forgottenEvent = tool(stage, 'cairn_forget_memory').find((event) => success(event) !== null
      && event.arguments?.memoryId === state.memoryId && event.arguments?.expectedRevision === state.revision);
    const forgotten = Boolean(forgottenEvent);
    const observedVia = observedCurrentBefore(stage, forgottenEvent, state);
    const empty = store?.list?.ok === true && store.list.value.memories?.length === 0;
    const missing = store?.target?.error?.code === 'memory_not_found';
    return { ...base, passedAutomated: Boolean(observedVia) && forgotten && empty && missing,
      inspected, observedVia, forgotten, empty, missing };
  }
  if (name === 'F') {
    const successfulRecall = tool(stage, 'cairn_recall_memory').find((event) => success(event) !== null);
    const recalled = success(successfulRecall)?.memories || [];
    const absent = !recalled.some((memory) => memory.memory?.id === state.memoryId);
    const noDay = !answerHas(stage, 'Tuesday') && !answerHas(stage, 'Friday');
    const empty = store?.list?.ok === true && store.list.value.memories?.length === 0;
    const missing = store?.target?.error?.code === 'memory_not_found';
    return { ...base, passedAutomated: Boolean(successfulRecall) && absent && noDay && empty && missing,
      successfulRecall: Boolean(successfulRecall), absent, noDay, empty, missing, operatorReviewRequired: true };
  }
  const noTools = (stage.toolEvents || []).length === 0;
  return { ...base, passedAutomated: noTools, noTools,
    guessedTuesday: answerHas(stage, 'Tuesday'), guessedFriday: answerHas(stage, 'Friday'), operatorReviewRequired: true };
}

export async function runHermesValueExperiment({
  session, hermesCheckout, hermesPython, nodePath, cairnExecutable, cairnArtifact,
  cairnArtifactSha256, privateDirectory,
  startProxy = null, collectDiagnostics = false,
}) {
  if (typeof collectDiagnostics !== 'boolean') fail('invalid_collect_diagnostics');
  if (!session || typeof session.getState !== 'function') fail('invalid_live_session');
  const host = realpathSync(hermesCheckout);
  if (!path.basename(host).endsWith(HERMES_REVISION)) fail('unpinned_hermes_host');
  const python = path.resolve(hermesPython);
  if (!statSync(python).isFile()) fail('invalid_hermes_python');
  const node = realpathSync(nodePath);
  const artifact = realpathSync(cairnArtifact);
  if (!/^[a-f0-9]{64}$/u.test(cairnArtifactSha256) || fileHash(artifact) !== cairnArtifactSha256) {
    fail('unpinned_cairn_artifact');
  }
  const packageRoot = installedPackageRoot(cairnExecutable);
  const runtimeFiles = JSON.parse(readFileSync(path.resolve(HERE, '../../packaging/artifact-files.json'), 'utf8'));
  const runtimeSourceSha256 = {};
  try {
    for (const relative of runtimeFiles) {
      const installedHash = fileHash(path.join(packageRoot, relative));
      if (installedHash !== fileHash(path.resolve(HERE, '../..', relative))) fail('cairn_install_source_mismatch');
      runtimeSourceSha256[relative] = installedHash;
    }
  } catch { fail('cairn_install_source_mismatch'); }
  const root = prepareDirectory(privateDirectory, true);
  const profile = prepareDirectory(path.join(root, 'profile'));
  mkdirSync(path.join(profile, 'plugins'), { mode: 0o700 });
  cpSync(path.resolve(HERE, '../../integrations/hermes/cairn'), path.join(profile, 'plugins/cairn'), { recursive: true });
  const memoryDirectory = prepareDirectory(path.join(profile, 'cairn'));
  const transportFile = path.join(memoryDirectory, 'experiment-transport.json');
  privateWrite(transportFile, { version: 1, packageRoot, proxyUrl: 'http://127.0.0.1:1' });
  const shim = path.join(root, 'guarded-node');
  writeFileSync(shim, `#!/bin/sh\nCAIRN_LIVE_CONFIG=${shellQuote(transportFile)} exec ${shellQuote(node)} "$@"\n`,
    { encoding: 'utf8', mode: 0o700, flag: 'wx' });
  privateWrite(path.join(profile, 'cairn.json'), { node_path: shim, executable_path: realpathSync(CAIRN_LAUNCHER) });
  privateWrite(path.join(profile, 'config.yaml'), {
    model: { context_length: 256000, streaming: false },
    agent: { api_max_retries: 1 },
    tools: { tool_search: { enabled: 'off' } },
    memory: { provider: 'cairn', memory_enabled: false, user_profile_enabled: false },
  });

  const requestBase = { maxIterations: 4, maxOutputTokens: 1024, hermesCheckout: host, profileDirectory: profile };
  const discovery = await runStage(python, host, { ...requestBase, operation: 'discover', stage: 'schema', prompt: '',
    sessionId: `schema-${randomUUID()}`, proxyUrl: '', proxyToken: '', control: false });
  if (!discovery.ok || discovery.tools?.length !== EXPECTED_TOOLS.size
    || new Set(discovery.tools.map((entry) => entry.function.name)).size !== EXPECTED_TOOLS.size
    || discovery.tools.some((entry) => !EXPECTED_TOOLS.has(entry.function.name))) fail('hermes_schema_discovery_failed');
  const hostSourceSha256 = Object.fromEntries(['run_agent.py', 'agent/conversation_loop.py', 'agent/agent_init.py',
    'hermes_cli/__init__.py'].map((relative) => [relative, fileHash(path.join(host, relative))]));
  const cairnSourceSha256 = Object.fromEntries(['adapters/mcp/server.mjs', 'adapters/openai/index.mjs',
    'core/contract.mjs'].map((relative) => [relative, fileHash(path.join(packageRoot, relative))]));
  const freeze = { version: 2, acceptanceVersion: VALUE_ACCEPTANCE_VERSION,
    declaredHermesRevision: HERMES_REVISION, hostSourceSha256,
    cairnArtifactSha256, cairnSourceSha256, model: MODEL, prompts: VALUE_PROMPTS,
    toolSchemas: discovery.tools, toolSchemaSha256: hash(JSON.stringify(discovery.tools)) };
  if (collectDiagnostics) freeze.diagnostics = {
    version: 1, runtimeSourceSha256,
    collectorSha256: fileHash(path.join(packageRoot, 'evaluation/live/diagnostics.mjs')),
    launcherSha256: fileHash(CAIRN_LAUNCHER),
  };
  privateWrite(path.join(root, 'frozen-protocol.json'), freeze);

  const proxyFactory = startProxy ?? (await import('./proxy.mjs')).startExperimentProxy;
  const proxy = await proxyFactory({ session });
  if (!proxy || typeof proxy.url !== 'string' || typeof proxy.token !== 'string' || typeof proxy.close !== 'function') {
    fail('invalid_experiment_proxy');
  }
  writeFileSync(transportFile, `${JSON.stringify({ version: 1, packageRoot, proxyUrl: proxy.url }, null, 2)}\n`,
    { encoding: 'utf8', mode: 0o600, flag: 'w' });
  const database = path.join(memoryDirectory, 'memory.sqlite');
  const report = { version: 2, kind: 'real-hermes-native-memory', frozen: freeze,
    budgetBefore: session.getState(), stages: [], budgetAfter: null };
  const state = { memoryId: null, revision: null, receiptId: null };
  let halted = false;
  try {
    for (const name of Object.keys(VALUE_PROMPTS)) {
      if (halted && name !== 'control') {
        report.stages.push({ stage: name, status: 'not_run', reason: 'prior_stage_failed' });
        continue;
      }
      const control = name === 'control';
      const diagnosticDirectory = collectDiagnostics
        ? prepareDirectory(path.join(root, `diagnostics-${name}`), true) : null;
      if (collectDiagnostics) {
        writeFileSync(transportFile, `${JSON.stringify({ version: 1, packageRoot,
          proxyUrl: proxy.url, diagnosticDirectory }, null, 2)}\n`,
        { encoding: 'utf8', mode: 0o600, flag: 'w' });
      }
      const result = await runStage(python, host, { ...requestBase, operation: 'turn', stage: name,
        prompt: VALUE_PROMPTS[name], sessionId: `lantern-${name}-${randomUUID()}`,
        proxyUrl: proxy.url, proxyToken: proxy.token, control });
      let ownerId = null;
      try { ownerId = `hermes-${readFileSync(path.join(memoryDirectory, 'owner-id'), 'utf8')}`; } catch { /* not created */ }
      const candidateId = state.memoryId ?? (name === 'A'
        ? success(tool(result, 'cairn_remember_memory')[0])?.memory?.id ?? null : null);
      const store = await snapshotStore(packageRoot, database, ownerId, candidateId);
      const verdict = inspectHermesStage(name, result, store, state);
      const record = { stage: name, status: verdict.passedAutomated ? 'completed' : 'failed', result, store, verdict };
      if (collectDiagnostics) record.diagnostics = readDiagnostics(diagnosticDirectory);
      privateWrite(path.join(root, `stage-${name}.json`), record);
      report.stages.push(record);
      if (!verdict.passedAutomated && !control) halted = true;
    }
  } finally {
    report.budgetAfter = session.getState();
    await proxy.close();
    privateWrite(path.join(root, 'report.json'), report);
  }
  return report;
}
