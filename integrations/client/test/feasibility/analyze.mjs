#!/usr/bin/env node
// Summarize F0 evidence from one run root. Output holds canary names, counts,
// record kinds, schema keys and timings only; never transcript text.
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { transcriptMessages } from '../../../../plugins/cairn-memory/lib/transcript.mjs';
import { canaryHits, canaryTable, plantedCheck } from './lib/canaries.mjs';
import { readLedger } from './lib/ledger.mjs';
import { parseTranscript } from './lib/parsers.mjs';
import { expectedSourcePaths, ownerLaunch, readOwnedSource } from './lib/source-access.mjs';

const ROOT = process.env.F0_RUN_ROOT ?? '/tmp/f0-tmp/f0-run';
const config = JSON.parse(readFileSync(join(ROOT, 'config.json'), 'utf8'));
const ledger = readLedger(ROOT);
const lines = path => (existsSync(path) ? readFileSync(path, 'utf8').split('\n').filter(Boolean) : []);
const jsonl = path => lines(path).map(line => { try { return JSON.parse(line); } catch { return null; } }).filter(Boolean);
const events = jsonl(join(ROOT, 'logs', 'events.jsonl'));
const workers = jsonl(join(ROOT, 'logs', 'workers.jsonl'));
const bodies = jsonl(join(ROOT, 'logs', 'bodies.jsonl'));
const recalls = jsonl(join(ROOT, 'logs', 'recalls.jsonl'));
const c = config.canaries;

// Canaries that must never reach delivered bodies, state or recall output.
// canaryTable throws on any missing value, so no check is ever skipped.
const CANARIES = canaryTable(c);
const hits = text => canaryHits(CANARIES, text);

/**
 * The run's own sources: exact paths derived from ledger ownership, each read
 * like any other through `readOwnedSource`. An absent or refused path is skipped.
 */
async function ownedTranscripts(run) {
  const sessionId = run.host === 'claude' ? run.launch?.sessionId : run.binding?.threadId;
  if (!sessionId) return [];
  const owner = ownerLaunch(ledger, run.host, sessionId);
  if (!owner.run) return [];
  const transcripts = [];
  for (const path of expectedSourcePaths(run.host, process.env.HOME, owner.run.launch, sessionId)) {
    let text = '';
    try {
      text = await readOwnedSource({ host: run.host, sessionId, path, cwd: owner.run.launch.cwd, ledger,
        home: process.env.HOME });
    } catch { continue; }
    if (text) transcripts.push({ path, text });
  }
  return transcripts;
}

function recordKind(host, record) {
  if (host === 'claude') {
    const blocks = Array.isArray(record?.message?.content) ? record.message.content.map(b => b?.type).join('+')
      : typeof record?.message?.content === 'string' ? 'string' : '';
    const flags = ['isMeta', 'isSidechain', 'isCompactSummary', 'isVisibleInTranscriptOnly'].filter(f => record?.[f]);
    return [record?.type, record?.subtype, record?.attachment?.type, blocks, ...flags, record?.toolUseResult !== undefined ? 'toolUseResult' : '']
      .filter(Boolean).join('/');
  }
  const p = record?.payload ?? {};
  return [record?.type, p.type, p.role, p.item?.type].filter(Boolean).join('/');
}

function transcriptSummary(host, text) {
  const kinds = {};
  const canaryKinds = {};
  for (const line of text.split('\n').filter(Boolean)) {
    let record;
    try { record = JSON.parse(line); } catch { kinds.malformed = (kinds.malformed ?? 0) + 1; continue; }
    const kind = recordKind(host, record);
    kinds[kind] = (kinds[kind] ?? 0) + 1;
    for (const name of hits(line)) (canaryKinds[name] ??= new Set()).add(kind);
  }
  const summary = { exists: true, bytes: Buffer.byteLength(text), kinds,
    canaryKinds: Object.fromEntries(Object.entries(canaryKinds).map(([k, v]) => [k, [...v]])) };
  // Replay the committed candidate parser over the whole synthetic transcript.
  const candidate = parseTranscript(host, Buffer.from(text), 0);
  summary.candidateParser = { messages: candidate.messages.length, roles: candidate.messages.map(m => m.role),
    canaries: [...new Set(candidate.messages.flatMap(m => hits(m.text)))] };
  if (host === 'claude') {
    // Released 0.1.0 parser, evaluated offline only; its output is never sent anywhere.
    const legacy = transcriptMessages(text, 'offline');
    summary.releasedParser = { messages: legacy.length, canaries: [...new Set(legacy.flatMap(m => hits(m.content)))] };
  }
  return summary;
}

/** Windows of host-generated compaction summary text, used to prove it is never delivered. */
function compactionWindows(host, transcript) {
  const windows = [];
  for (const line of transcript.split('\n').filter(Boolean)) {
    let record;
    try { record = JSON.parse(line); } catch { continue; }
    let text = '';
    if (host === 'claude' && record.isCompactSummary) {
      const content = record.message?.content;
      text = typeof content === 'string' ? content : (content ?? []).map(block => block?.text ?? '').join('\n');
    }
    if (host === 'codex' && record.type === 'compacted') text = String(record.payload?.message ?? '');
    for (let i = 0; i + 48 <= text.length; i += 48) windows.push(text.slice(i, i + 48));
  }
  return windows;
}

function hostOutput(run) {
  const events = jsonl(run.stdoutPath ?? '');
  const visible = [];
  const out = { eventTypes: {} };
  for (const event of events) {
    const type = [event.type, event.subtype].filter(Boolean).join('/');
    out.eventTypes[type] = (out.eventTypes[type] ?? 0) + 1;
    if (run.host === 'claude') {
      if (event.type === 'system' && event.subtype === 'init') {
        out.init = { model: event.model, permissionMode: event.permissionMode, apiKeySource: event.apiKeySource,
          tools: event.tools, mcpServers: event.mcp_servers, plugins: event.plugins, slashCommands: event.slash_commands?.length,
          agents: event.agents?.length, skills: event.skills?.length, outputStyle: event.output_style,
          keys: Object.keys(event).sort() };
      }
      if (event.type === 'rate_limit_event') {
        const info = event.rate_limit_info ?? {};
        (out.rateLimit ??= []).push({ keys: Object.keys(event).sort(), infoKeys: Object.keys(info).sort(),
          types: Object.fromEntries(Object.entries(info).map(([k, v]) => [k, v === null ? 'null' : typeof v])),
          status: info.status ?? null, rateLimitType: info.rateLimitType ?? null });
      }
      if (event.type === 'assistant') {
        for (const block of event.message?.content ?? []) if (block.type === 'text') visible.push(block.text);
      }
      if (event.type === 'result') {
        out.result = { isError: event.is_error, durationMs: event.duration_ms, durationApiMs: event.duration_api_ms,
          numTurns: event.num_turns, modelUsage: Object.keys(event.modelUsage ?? {}) };
        if (typeof event.result === 'string') visible.push(event.result);
      }
    } else {
      if (event.type === 'item.completed' && event.item?.type === 'agent_message') visible.push(event.item.text);
      if (/rate|limit/i.test(JSON.stringify(Object.keys(event)))) out.rateKeys = Object.keys(event);
    }
  }
  out.visibleCanaries = hits(visible.join('\n'));
  out.visibleWords = [c.wordClaude, c.wordCodex].filter(word => visible.join('\n').includes(word));
  out.visibleText = visible.join(' | ').slice(0, 120);
  return out;
}

function codexRateLimits(transcript) {
  const found = [];
  for (const line of transcript.split('\n').filter(Boolean)) {
    const record = JSON.parse(line);
    if (record.type === 'event_msg' && record.payload?.type === 'token_count') {
      const limits = record.payload.rate_limits;
      found.push(limits ? { keys: Object.keys(limits).sort(),
        primaryKeys: limits.primary ? Object.keys(limits.primary).sort() : null,
        secondaryKeys: limits.secondary ? Object.keys(limits.secondary).sort() : null } : null);
    }
  }
  return found;
}

function traceSummary(path) {
  if (!path || !existsSync(path)) return null;
  const execs = {};
  const external = new Set();
  let agentState = false;
  for (const line of lines(path)) {
    const exec = line.match(/^\d+ +execve\("([^"]+)", \[("[^"]*")?(?:, "([^"]*)")?/);
    if (exec) {
      const program = exec[1].replace(/codex-arg0[A-Za-z0-9]+/, 'codex-arg0X');
      const hookArg = exec[3]?.includes('/feasibility/') ? ` ${exec[3].split('/').pop()}` : '';
      const key = `${program}${program.endsWith('/sh') || program.endsWith('/zsh') ? '' : hookArg}`;
      execs[key] = (execs[key] ?? 0) + 1;
      if (line.includes('agent-state')) agentState = true;
    }
    if (line.includes('agent-state')) agentState = true;
    const write = line.match(/^\d+ +(?:open|openat|openat2|creat)\((?:[^"]*)"([^"]+)"[^)]*(O_WRONLY|O_RDWR|O_CREAT|O_APPEND|O_TRUNC)/);
    const change = line.match(/^\d+ +(?:mkdir|mkdirat|rmdir|unlink|unlinkat)\((?:[^"]*)"([^"]+)"/);
    // rename/link/symlink create their second path; the first is a source or link target.
    const pair = line.match(/^\d+ +(?:rename|renameat2?|link|linkat|symlink|symlinkat)\((?:[^"]*)"[^"]+"[^"]*"([^"]+)"/);
    for (const match of [write, change, pair]) {
      const target = match?.[1];
      if (target?.startsWith('/') && !target.startsWith('/tmp/f0-tmp') && !target.startsWith('/dev/') &&
          !target.startsWith('/proc/') && !target.startsWith('/newroot') && !target.startsWith('/oldroot')) {
        external.add(target.replace(/codex-arg0[A-Za-z0-9]+/, 'codex-arg0X'));
      }
    }
  }
  const mcpLike = Object.keys(execs).filter(program => /npx|playwright|chrome|mcp|uvx/i.test(program));
  return { execs, agentState, mcpLike, externalPaths: [...external].sort() };
}

function stateScan() {
  const found = new Set();
  const walk = dir => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else for (const hit of hits(readFileSync(path).toString('latin1'))) found.add(`${path.replace(ROOT, '')}:${hit}`);
    }
  };
  walk(join(ROOT, 'state'));
  walk(join(ROOT, 'core'));
  return [...found];
}

const results = { pins: config.pins, platform: `${process.platform} ${readFileSync('/proc/version', 'utf8').split(' ').slice(0, 3).join(' ')}`,
  budget: ledger, runs: [], plantFailures: [] };
for (const run of ledger.runs) {
  const label = run.label ?? run.name;
  const stepEvents = events.filter(e => e.step === label);
  const transcripts = await ownedTranscripts(run);
  const delivered = {};
  for (const e of stepEvents.filter(e => e.phase === 'delivered')) delivered[e.label] = (delivered[e.label] ?? 0) + 1;
  const hookMs = stepEvents.filter(e => e.phase === 'hook_exit').map(e => `${e.label}:${e.elapsedMs}`);
  const stepBodies = bodies.filter(b => b.step === label);
  const captureBodies = stepBodies.filter(b => b.path === '/api/memory/capture');
  const recallBodies = stepBodies.filter(b => b.path === '/api/memory/recall');
  const stepRecalls = recalls.filter(r => r.step === label);
  const stepWorkers = workers.filter(w => w.step === label && w.phase === 'finish').map(w => ({ label: w.label,
    status: w.status, messagesSent: w.messagesSent ?? 0, excluded: w.excluded, truncated: w.truncated,
    hostAliveAtRead: w.hostAliveAtRead ?? null, hostAliveAtCheck: w.hostAliveAtCheck,
    sourceProbe: w.sourceProbe ? { bytes: w.sourceProbe.bytes, hostAlive: w.sourceProbe.hostAlive,
      afterHostExitMs: run.exitAt ? w.sourceProbe.at - run.exitAt : null } : null,
    error: w.error ?? null }));
  const workerStarts = workers.filter(w => w.step === label && w.phase === 'start').map(w => ({ label: w.label,
    ownSession: w.placement?.sid === w.placement?.pid, seccompFilters: w.confinement?.Seccomp_filters }));
  const hookConfinement = [...new Set(stepEvents.filter(e => e.confinement).map(e => `seccomp_filters=${e.confinement.Seccomp_filters}`))];
  const output = hostOutput(run);
  const capturedRoles = captureBodies.flatMap(b => JSON.parse(b.raw).messages.map(m => m.role));
  const summaryWindows = transcripts.flatMap(({ text }) => compactionWindows(run.host, text));
  const summaries = transcripts.map(({ path, text }) => ({ path, ...transcriptSummary(run.host, text),
    ...(run.host === 'codex' ? { rateLimits: codexRateLimits(text) } : {}) }));
  // Zero delivery hits only count for canaries this step actually planted in its own source.
  const found = new Set(summaries.flatMap(summary => Object.keys(summary.canaryKinds ?? {})));
  if (summaryWindows.length) found.add('compaction_summary_text');
  const planted = plantedCheck({ plants: run.plants, mayPlant: run.mayPlant }, found, CANARIES);
  if (!planted.ok) results.plantFailures.push({ label, missing: planted.missing, unknown: planted.unknown });
  results.runs.push({ planted, label, host: run.host, fakeModel: run.fakeModel, traced: run.traced, exitCode: run.exitCode,
    timedOut: run.timedOut ?? false, wallMs: run.wallMs, firstOutputMs: run.firstOutputMs, sessionId: run.sessionId,
    hooksDelivered: delivered, hookExitMs: hookMs, hookConfinement, hookHost: [...new Set(stepEvents.flatMap(e => e.ancestry?.[0]?.comm ?? []))],
    workers: stepWorkers, workerStarts,
    delivery: { captureBodies: captureBodies.length, recallBodies: recallBodies.length, capturedRoles,
      captureStatuses: captureBodies.map(b => b.status), recallStatuses: recallBodies.map(b => b.status),
      canariesInCapture: [...new Set(captureBodies.flatMap(b => hits(b.raw)))],
      compactionSummaryWindows: summaryWindows.length,
      compactionTextInCapture: summaryWindows.filter(window => captureBodies.some(b => b.raw.includes(window))).length,
      canariesInRecallRequests: [...new Set(recallBodies.flatMap(b => hits(b.raw)))],
      canariesInRecallReplies: [...new Set(recallBodies.flatMap(b => hits(JSON.stringify(b.reply))))],
      recalledClients: [...new Set(stepRecalls.flatMap(r => r.memories.map(m => m.receiptClient)))],
      recalledWords: [c.wordClaude, c.wordCodex].filter(word => JSON.stringify(stepRecalls).includes(word)) },
    output,
    transcripts: summaries,
    trace: traceSummary(run.stracePath) });
}
results.stateCanaries = stateScan();
writeFileSync(join(ROOT, 'results.json'), `${JSON.stringify(results, null, 2)}\n`);
console.log(JSON.stringify(results, null, 1));
// Unplanted required canaries or any leak (delivered bodies, recall, state or
// checked host output) make the analysis fail rather than pass silently.
const leakKinds = run => Object.entries({
  capture: run.delivery.canariesInCapture.length, recallRequest: run.delivery.canariesInRecallRequests.length,
  recallReply: run.delivery.canariesInRecallReplies.length, compactionText: run.delivery.compactionTextInCapture,
  visibleOutput: run.output.visibleCanaries.length,
}).filter(([, count]) => count).map(([kind]) => kind);
const leaks = results.runs.map(run => ({ label: run.label, kinds: leakKinds(run) })).filter(leak => leak.kinds.length);
if (results.plantFailures.length || leaks.length || results.stateCanaries.length) {
  console.error(JSON.stringify({ plantFailures: results.plantFailures, leaks, stateCanaries: results.stateCanaries }));
  process.exitCode = 1;
}
