#!/usr/bin/env node
// Detached capture worker. Before touching the hook-supplied transcript it
// requires a harness-owned session (from the launch ledger), the exact host
// location for that session, no active pause, and a regular non-symlink file.
// It then reads only through one O_NOFOLLOW handle, applies the candidate
// allowlist, redacts and bounds each message, and posts batches through the
// extracted client seam. Harness only.
import { existsSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { captureCursorPath, readCaptureCursor, writeCaptureCursor } from '../../capture-cursor.mjs';
import { readControlState, startIfActive } from '../../control-state.mjs';
import { withFileLock } from '../../file-lock.mjs';
import { opaqueProjectId } from '../../identity.mjs';
import { redactSecrets } from '../../redact.mjs';
import { createJsonPoster } from '../../transport-hosted.mjs';
import { appendRecord, boundUtf16, commandName, confinement, errorDetail, hostClient, processPlacement, readBoundedStdin,
  readConfig, sha256, wireSessionId } from './lib/common.mjs';
import { tryReadLedger } from './lib/ledger.mjs';
import { parseTranscript } from './lib/parsers.mjs';
import { authorizeSource, openAuthorizedSource, ownerLaunch } from './lib/source-access.mjs';

const MAX_READ = 1024 * 1024;
const root = process.argv[2];
const config = readConfig(root);
const { text } = await readBoundedStdin(64 * 1024, 2_000);
const job = JSON.parse(text);
const base = { step: config.step, host: job.host, label: job.label, sessionId: job.session_id };
const hostAlive = () => Boolean(job.hostPid) && existsSync(`/proc/${job.hostPid}`) &&
  ['claude', 'codex'].some(name => commandName(job.hostPid)?.startsWith(name));
appendRecord(root, 'workers.jsonl', { ...base, phase: 'start', placement: processPlacement(), confinement: confinement(),
  hostAliveAtStart: hostAlive(), launchDelayMs: Date.now() - job.launchedAt });

// Common-profile canonicalization: NFKC, redact, collapse whitespace, trim, then bound.
function canonical(value) {
  const normalized = redactSecrets(value.normalize('NFKC')).replace(/\s+/gu, ' ').trim();
  const bounded = boundUtf16(normalized, 4_000);
  return { content: redactSecrets(bounded.text).trim(), truncated: bounded.truncated };
}

async function readRange(handle, start, end) {
  const buffer = Buffer.alloc(Math.max(0, end - start));
  let position = 0;
  while (position < buffer.length) {
    const { bytesRead } = await handle.read(buffer, position, buffer.length - position, start + position);
    if (!bytesRead) break;
    position += bytesRead;
  }
  return buffer.subarray(0, position);
}

/** A Codex binding appears once the orchestrator reads `thread.started`; wait a bounded time for it. */
async function ownerLedger() {
  for (let attempt = 0; ; attempt++) {
    const ledger = tryReadLedger(root);
    const owner = ownerLaunch(ledger, job.host, job.session_id);
    if (job.host !== 'codex' || owner.run || attempt >= 8 || owner.reason !== 'not_a_harness_session') return ledger;
    await delay(250);
  }
}

async function captureLocked(handle, cursorPath, generation, summary) {
  const cursor = await readCaptureCursor(cursorPath) ?? { offset: 0, generation, discardUntilNewline: false };
  const { size } = await handle.stat();
  const end = Math.min(size, cursor.offset + MAX_READ);
  if (end <= cursor.offset) { summary.status = 'nothing_new'; return; }
  const slice = await readRange(handle, cursor.offset, end);
  summary.readAt = Date.now();
  summary.hostAliveAtRead = hostAlive();
  summary.bytesRead = slice.length;
  const parsed = parseTranscript(job.host, slice, cursor.offset);
  summary.excluded = parsed.excluded;
  const messages = [];
  let truncated = 0;
  for (const message of parsed.messages) {
    const { content, truncated: cut } = canonical(message.text);
    if (cut) truncated++;
    if (!content || content === '[REDACTED]') { summary.excluded.redactionOnly = (summary.excluded.redactionOnly ?? 0) + 1; continue; }
    messages.push({ id: sha256(`${job.host}\0${job.session_id}\0${message.offset}\0${message.role}`), role: message.role, content });
  }
  summary.truncated = truncated;
  const batches = [];
  for (const message of messages) {
    const last = batches.at(-1);
    const units = last?.reduce((sum, item) => sum + item.content.length, 0) ?? 0;
    if (!last || last.length >= 24 || units + message.content.length > 20_000) batches.push([message]);
    else last.push(message);
  }
  const projectId = await opaqueProjectId(config.stateDir, job.cwd);
  const post = createJsonPoster({ endpoint: config.coreUrl, token: config.token });
  summary.batches = [];
  for (const batch of batches) {
    const eventId = sha256(`cairn.f0.batch.v1\0${batch.map(message => message.id).join('\0')}`);
    const started = await startIfActive(config.stateDir, generation, () => post('/api/memory/capture', {
      client: hostClient(job.host), event_id: eventId, session_id: wireSessionId(job.host, job.session_id),
      project_id: projectId, messages: batch }, 25_000));
    if (!started.started) { summary.status = 'paused_before_dispatch'; return; }
    const reply = await started.operation;
    summary.batches.push({ size: batch.length, reply });
    if (reply?.processing) { summary.status = 'processing'; return; }
  }
  await writeCaptureCursor(cursorPath, { offset: cursor.offset + parsed.consumed, generation,
    discardUntilNewline: false });
  summary.messagesSent = messages.length;
  summary.status = 'acknowledged';
}

const summary = {};
try {
  if (job.delayMs) await delay(job.delayMs);
  summary.sourceCheckedAt = Date.now();
  summary.hostAliveAtCheck = hostAlive();
  let control;
  const authorization = await authorizeSource({ host: job.host, sessionId: job.session_id,
    suppliedPath: job.transcript_path, suppliedCwd: job.cwd, ledger: await ownerLedger(), home: process.env.HOME,
    isPaused: async () => { control = await readControlState(config.stateDir); return control.paused; } });
  summary.authorization = authorization.ok ? 'harness_source' : authorization.reason;
  if (!authorization.ok) {
    summary.status = ['paused', 'transcript_unavailable', 'source_unavailable'].includes(authorization.reason)
      ? authorization.reason : 'refused';
  } else {
    const handle = await openAuthorizedSource(authorization);
    try {
      // Readability probe of the authorized source, independent of cursor progress.
      const whole = await readRange(handle, 0, Math.min(authorization.size, 8 * 1024 * 1024));
      summary.sourceProbe = { at: Date.now(), hostAlive: hostAlive(), bytes: whole.length, sha256: sha256(whole) };
      const cursorPath = captureCursorPath(config.stateDir, `${job.host}:${job.session_id}`);
      const locked = await withFileLock(`${cursorPath}.lock`, () => captureLocked(handle, cursorPath, control.generation, summary),
        { timeoutMs: 250, pollMs: 25 });
      if (!locked) summary.status = 'cursor_busy';
    } finally { await handle.close(); }
  }
} catch (error) {
  summary.status = 'error';
  summary.error = errorDetail(error);
}
appendRecord(root, 'workers.jsonl', { ...base, phase: 'finish', ...summary });
