#!/usr/bin/env node
// Interactive Claude check for the 0.1.1 transcript filter. Manual, synthetic,
// never run by npm test or CI. One gated interactive session runs in a private
// tmux server (its own -L socket), targeted only by the session id it reports.
// Signal handlers and the run deadline are in place before tmux starts; a failed
// ledger write after launch tears the server and the host's process group down.
// Every transcript read is authorized from the ledger and uses a verified handle.
//
//   node interactive-claude.mjs run               launch, drive, summarize record shapes
//   node interactive-claude.mjs cleanup [--apply] remove this run's own host files via the ledger
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { legacyTranscriptMessages, machineUserRecord, transcriptMessages }
  from '../../../../plugins/cairn-memory/lib/transcript.mjs';
import { applyCleanup, planCleanup } from './lib/cleanup-plan.mjs';
import { randomTag } from './lib/common.mjs';
import { readLedger, writeLedger } from './lib/ledger.mjs';
import { preflight } from './lib/preflight.mjs';
import { createWaiter, launchPrivateTmux } from './lib/private-tmux.mjs';
import { claudeProjectDir, readOwnedSource } from './lib/source-access.mjs';
import { createInterruptGuard, SIGNAL_EXIT } from './lib/supervise.mjs';

const ROOT = '/tmp/f0-interactive';
const HOME = process.env.HOME;
const CLAUDE = join(HOME, '.local/bin/claude');
const PINS = { claude: '2.1.283 (Claude Code)', node: 'v22.16.0' };
const BUDGET = 3;
const RUN_DEADLINE_MS = 540_000;
const PATH = `${join(HOME, '.nvm/versions/node/v22.16.0/bin')}:/usr/local/bin:/usr/bin:/bin`;
const quote = value => `'${String(value).replace(/'/g, `'\\''`)}'`;

async function run() {
  const project = join(ROOT, 'project');
  mkdirSync(join(ROOT, 'logs'), { recursive: true, mode: 0o700 });
  mkdirSync(project, { recursive: true, mode: 0o700 });
  const tag = randomTag(8);
  const canaries = { typedOne: `F0TYPED1${tag}`, typedTwo: `F0TYPED2${tag}`, bash: `F0BASH${tag}` };
  // The ledger persists across attempts, so the run budget counts every launch.
  const ledger = existsSync(join(ROOT, 'ledger.json')) ? readLedger(ROOT)
    : { budget: { claude: BUDGET }, used: { claude: 0 }, runs: [] };
  writeLedger(ROOT, ledger);
  const sessionId = randomUUID();
  const args = ['--setting-sources', 'project,local', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}',
    '--session-id', sessionId, '--model', 'haiku'];
  const env = { HOME, USER: process.env.USER, LANG: 'C.UTF-8', TERM: 'xterm-256color', PATH };
  const gate = preflight({ step: { host: 'claude' }, built: { args, cwd: project }, pins: PINS, home: HOME,
    binaries: { claude: CLAUDE }, hookPrefix: '/nonexistent-harness-hook ', ledger, env });
  if (!gate.ok) {
    console.error(JSON.stringify({ preflight: 'failed', failures: gate.failures }, null, 2));
    process.exitCode = 1;
    return;
  }
  if (ledger.used.claude >= BUDGET) throw new Error('budget exhausted');
  ledger.used.claude++;
  const socket = `f0i-${tag.toLowerCase()}`;
  const record = { name: `claude-interactive#${ledger.used.claude}`, host: 'claude', preflight: gate.checks.map(check => check.name),
    launch: { sessionId, cwd: project, startedAt: Date.now(), exitAt: null }, tmux: { socket, socketPath: null, session: null, panePid: null } };
  ledger.runs.push(record);
  writeLedger(ROOT, ledger); // the launch is recorded before the host starts

  // Supervision is in place before tmux starts: signals reach the pane's group,
  // and every wait also observes the interrupt and the overall deadline.
  const guard = createInterruptGuard({ escalateMs: 5_000 });
  guard.install();
  const waitFor = createWaiter({ guard, deadline: Date.now() + RUN_DEADLINE_MS });
  const transcriptPath = join(claudeProjectDir(HOME, project), `${sessionId}.jsonl`);
  // Every read is authorized first and goes through a verified O_NOFOLLOW handle.
  const transcript = () => readOwnedSource({ host: 'claude', sessionId, path: transcriptPath, cwd: project, ledger, home: HOME });
  const command = ['env', '-i', ...Object.entries(env).map(([key, value]) => `${key}=${value}`), CLAUDE, ...args]
    .map(quote).join(' ');
  const snapshots = [];
  let host = null;
  try {
    host = await launchPrivateTmux({ socket, command, cwd: project, guard, onLaunch: ({ socketPath, session, panePid }) => {
      Object.assign(record.tmux, { socketPath, session, panePid });
      writeLedger(ROOT, ledger);
    } });
    const snap = label => snapshots.push({ label, text: host.pane() });
    // Typed text arrives as one burst, which the TUI treats as a paste; Enter must
    // come well after it, or it becomes a newline. Submission is confirmed from
    // the transcript, never from the screen (which echoes the typed text).
    const typeLine = async (text, submitted) => {
      host.keys('-l', text);
      await waitFor(() => host.pane().includes(text.slice(0, 24)), 10_000, 'typed text visible');
      await delay(2_000);
      host.keys('Enter');
      await waitFor(submitted, 20_000, `submitted: ${text.slice(0, 24)}`);
    };
    await waitFor(() => /trust|for shortcuts|❯|>/i.test(host.pane()), 30_000, 'first screen');
    snap('first-screen');
    if (/trust/i.test(host.pane())) { host.keys('Enter'); await delay(1_500); }
    await waitFor(() => /for shortcuts|❯/.test(host.pane()), 30_000, 'input ready');
    await typeLine(`Synthetic interactive prompt ${canaries.typedOne}. Reply with exactly: OK1`,
      async () => (await transcript()).includes(canaries.typedOne));
    await waitFor(async () => /"text":"OK1/.test(await transcript()), 90_000, 'reply one');
    await delay(1_500);
    await typeLine(`<note> Synthetic prompt ${canaries.typedTwo} mentions command-name mid-sentence. Reply with exactly: OK2`,
      async () => (await transcript()).includes(canaries.typedTwo));
    await waitFor(async () => /"text":"OK2/.test(await transcript()), 90_000, 'reply two');
    await delay(1_500);
    host.keys('-l', '!');
    await delay(1_000);
    await typeLine(`echo ${canaries.bash}`, async () => (await transcript()).includes(canaries.bash));
    await delay(2_000);
    snap('after-bash');
    await typeLine('/compact', async () => (await transcript()).includes('/compact'));
    await waitFor(async () => (await transcript()).includes('"isCompactSummary":true'), 150_000, 'compaction');
    await delay(3_000);
    snap('after-compact');
    await typeLine('/exit', () => true);
    await waitFor(() => !host.alive(), 30_000, 'exit');
  } catch (error) {
    record.error = error.message;
    // A failed launch (the ledger write included) has already been torn down.
    if (!host && !guard.interrupted) throw error;
    if (host) snapshots.push({ label: 'failure', text: host.pane() });
  } finally {
    if (host) await host.teardown();
    guard.dispose();
    record.launch.exitAt = Date.now();
    writeLedger(ROOT, ledger);
    writeFileSync(join(ROOT, 'logs', 'panes.json'), JSON.stringify(snapshots, null, 2));
  }
  if (guard.interrupted) { process.exitCode = SIGNAL_EXIT[guard.interrupted]; return; }
  const text = await transcript();
  if (!text) throw new Error('transcript_missing');
  summarize(text, canaries, sessionId, record.error ?? null);
}

function summarize(text, canaries, sessionId, error) {
  const typed = [canaries.typedOne, canaries.typedTwo];
  const userRecords = [];
  for (const line of text.split('\n').filter(Boolean)) {
    let record;
    try { record = JSON.parse(line); } catch { continue; }
    if (record.type !== 'user') continue;
    const content = record.message?.content;
    const raw = typeof content === 'string' ? content
      : Array.isArray(content) ? content.map(block => block?.text ?? `<${block?.type}>`).join('\n') : '';
    const typedPrompt = typed.find(value => raw.includes(value));
    userRecords.push({
      kind: typedPrompt ? `typed:${typedPrompt === canaries.typedOne ? 'one' : 'two'}` : 'machine',
      promptSource: record.promptSource ?? null, turnOrigin: record.turnOrigin ?? null,
      flags: ['isMeta', 'isCompactSummary', 'isVisibleInTranscriptOnly'].filter(flag => record[flag]),
      toolUseResult: record.toolUseResult !== undefined,
      rule: machineUserRecord(record),
      prefix: raw.trimStart().slice(0, 24).replace(/\/tmp\/\S*/g, '<tmp>').replace(/F0[A-Z0-9]+/g, '<canary>'),
    });
  }
  const kept = transcriptMessages(text, sessionId).map(message => message.content).join('\n');
  const legacy = legacyTranscriptMessages(text, sessionId).map(message => message.content).join('\n');
  const evidence = {
    error, userRecords,
    newRule: { typedKept: typed.map(value => kept.includes(value)), bashCanaryPresent: kept.includes(canaries.bash),
      commandWrapperPresent: /<command-name>|<local-command-|<bash-/.test(kept) },
    legacy: { typedKept: typed.map(value => legacy.includes(value)), bashCanaryPresent: legacy.includes(canaries.bash),
      commandWrapperPresent: /<command-name>|<local-command-|<bash-/.test(legacy) },
  };
  writeFileSync(join(ROOT, 'evidence.json'), `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(JSON.stringify(evidence, null, 2));
}

async function cleanup(apply) {
  const ledger = readLedger(ROOT);
  const plan = await planCleanup({ ledger, home: HOME, runRoot: ROOT });
  const result = apply ? await applyCleanup(plan) : { deleted: [], kept: [] };
  console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', ...plan, ...result }, null, 2));
  if (apply && !result.kept.length) rmSync(ROOT, { recursive: true, force: true });
}

const [command] = process.argv.slice(2);
if (command === 'run') await run();
else if (command === 'cleanup') await cleanup(process.argv.includes('--apply'));
else { console.error('usage: interactive-claude.mjs run | cleanup [--apply]'); process.exitCode = 1; }
