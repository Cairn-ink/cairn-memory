import { lstat, realpath, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { clearTimeout, setTimeout } from 'node:timers';
import { performance } from 'node:perf_hooks';
import { captureLock } from './capture-lock.mjs';
import { privateRead, privateRemove, privateWrite } from '../../integrations/client/private-state.mjs';
import { detectRunningHost, cachedQualification, boundBinary, hasQualifiedCreator } from './capture-codex-qualification.mjs';
import { sessionSourceMetadata } from '../../integrations/codex/session-source.mjs';
import { openLocalSource } from '../../integrations/client/raw/local-source-open.mjs';
import { withCaptureBinding } from './capture-binding.mjs';
import { dispatchCapture } from './capture-dispatch.mjs';
import { fault, hookSelection } from './capture-input.mjs';
import { loadIdentity, bindRoot, readSession, initializeSession } from './capture-state.mjs';
import { markSessionStart, hasSessionStart, readSessionStartAttempt, sessionStartSource, writeSessionStartAttempt } from './capture-start.mjs';
import { sourceBudget, openWorkerSource, qualifySource, sourceSize, completeBoundary, cursorSource, verifyCursorSource } from './capture-source.mjs';
import { advanceCapture } from './capture-progress.mjs';

async function openBoundAdapter(binding) {
  const { captureAdapter } = await import('./capture-slot.mjs');
  return captureAdapter(binding);
}

async function sourcePresent(binding, path, allowMissing) {
  const { sourceRoot, sourceIdentity } = binding;
  if (!path.startsWith(sourceRoot + '/') || await realpath(sourceRoot) !== sourceRoot) fault('source_unavailable');
  const root = await lstat(sourceRoot, { bigint: true });
  if (!root.isDirectory() || root.uid !== BigInt(process.getuid()) || root.mode & 0o022n ||
      String(root.dev) !== sourceIdentity.device || String(root.ino) !== sourceIdentity.inode) fault('source_changed');
  let current = sourceRoot;
  const segments = relative(sourceRoot, path).split('/');
  for (const [index, segment] of segments.entries()) {
    current = join(current, segment);
    let info;
    try { info = await lstat(current); }
    catch (error) { if (allowMissing && error.code === 'ENOENT') return false; throw error; }
    if (info.isSymbolicLink() || info.uid !== process.getuid() || info.mode & 0o022 ||
        (index === segments.length - 1 ? !info.isFile() : !info.isDirectory())) fault('source_unavailable');
  }
  if (await realpath(path) !== path) fault('source_changed');
  return true;
}

async function codexFormat(configPath, context, signal) {
  const host = await detectRunningHost();
  if (!host || host.execSession === true) fault('capture_refused');
  const path = await boundBinary(host);
  if (!path) fault('capture_refused');
  const executable = await stat(path);
  if (!executable.isFile() || executable.uid !== process.getuid() || executable.mode & 0o022) fault('capture_refused');
  const qualification = await cachedQualification(configPath, host);
  if (qualification.status !== 'qualified') fault('capture_refused');
  const selection = await sessionSourceMetadata(context.sourcePath, context.sessionId, {
    signal, qualifiedCreatorVersion: qualification.version,
    qualifyCreator: version => hasQualifiedCreator(configPath, version, { signal }), openSource: openLocalSource,
  });
  if (!selection?.interactive || !await boundBinary(host)) fault('capture_refused');
  return selection.formatAuthority;
}

async function markUsed(directory) {
  const path = join(directory, 'used');
  if (await privateRead(path, { missing: true }) !== undefined) return null;
  await privateWrite(path, 'capture write requested\n', { exclusive: true });
  return path;
}

async function capture(binding, legacy, input, operation) {
  const { client } = binding.authority;
  if (client === 'claude-code' && input.headless) return { status: 'ready', reason: 'headless_skipped' };
  const context = hookSelection(input.payload, input.event, client);
  const initialize = ['SessionStart', 'UserPromptSubmit'].includes(input.event);
  const claudeStart = client === 'claude-code' && input.event === 'SessionStart';
  const options = { authority: binding.authority, stateRoot: join(legacy, 'state'), identityKeyPath: join(legacy, 'identity.key') };
  const identity = await loadIdentity(options, context, operation);
  try {
    const runtime = await openBoundAdapter(binding);
    try { runtime.check(identity.wireSessionId); }
    catch (error) {
      if (claudeStart && error.code === 'storage_busy') {
        try {
          const present = await sourcePresent(binding, context.sourcePath, true);
          await writeSessionStartAttempt(identity, sessionStartSource(identity, context), present ? 'present' : 'fresh');
        } catch { /* A failed permission probe grants no capture authority. */ }
      }
      throw error;
    }
    if (client === 'codex' && input.event === 'SessionStart' && context.source === 'fork') {
      await markUsed(input.directory);
      await runtime.fence(identity.wireSessionId);
      return { status: 'blocked', reason: 'capture_refused' };
    }
    operation.check();
    const present = await sourcePresent(binding, context.sourcePath, claudeStart);
    context.pluginRoot = client === 'claude-code' ? binding.supportPath : null;
    context.formatAuthority = client === 'codex' ? await codexFormat(binding.supportPath, context, operation.signal) : null;
    await bindRoot(options, identity, initialize, operation);
    return await captureLock(identity.lockPath, async () => {
      runtime.check(identity.wireSessionId);
      operation.check();
      let cursor = await readSession(identity, client);
      if (!present) {
        if (!cursor) await markSessionStart(identity, context);
        return { status: 'ready' };
      }
      let fromStart = false;
      if (!initialize && !cursor) {
        if (client !== 'claude-code') fault('state_invalid');
        fromStart = await hasSessionStart(identity, context);
        if (!fromStart) {
          const attempt = await readSessionStartAttempt(identity, context);
          if (attempt === 'fresh') {
            await markSessionStart(identity, context, { recovery: true });
            fromStart = true;
          } else if (attempt !== 'present') fault('state_invalid');
        }
      }
      const bytes = sourceBudget(operation), opened = await openWorkerSource(context, operation, bytes);
      try {
        await qualifySource(options, context, opened, operation);
        if (cursor) await verifyCursorSource(identity, opened, cursor);
        else {
          const size = await sourceSize(opened);
          if (!fromStart && !await completeBoundary(opened, size)) return { status: 'waiting', reason: 'partial_record' };
          const offset = fromStart ? 0 : size;
          cursor = { version: 'local-raw-cursor-v1', sessionKey: identity.sessionKey, wireSessionId: identity.wireSessionId,
            authorityCommitment: identity.authorityCommitment, epoch: 0, offset, issuedOrdinal: 0,
            source: await cursorSource(identity, opened, offset),
            selection: client === 'claude-code' ? { ownSkillTurn: !fromStart, awaitingUserBoundary: !fromStart } : {},
            pending: null, blockedReason: null };
          operation.check();
          await initializeSession(identity, cursor);
        }
        if (initialize) return cursor.blockedReason ? { status: 'blocked', reason: cursor.blockedReason } : { status: 'ready' };
        return await advanceCapture({ options, identity, context, opened, cursor, operation, bytes,
          dispatch: (selection, message, recovering) => runtime.run(selection.sessionId, async ({ service, scope }) => {
            const marker = await markUsed(input.directory);
            const outcome = await dispatchCapture(service, scope, selection, message, operation.signal, recovering);
            // This gate rejects before admission. Every ambiguous outcome
            // keeps the rollback fence until the store can be reconciled.
            if (marker && outcome.reason === 'capability_unavailable') await privateRemove(marker);
            return outcome;
          }) });
      } finally { await opened.close(); }
    }, { signal: operation.signal });
  } finally { identity.key.fill(0); }
}

// The CLI suppresses the internal outcome. Qualification can inspect it through
// this trusted entry, which applies the same installation and store checks.
export async function runBoundCapture(input, signal) {
  const end = performance.now() + 155000;
  const controller = new AbortController();
  const cancel = () => controller.abort();
  signal.addEventListener('abort', cancel, { once: true });
  if (signal.aborted) cancel();
  const timer = setTimeout(cancel, 153000);
  const operation = { signal: controller.signal, remaining: () => Math.max(0, Math.floor(end - performance.now())),
    check() { if (controller.signal.aborted || performance.now() >= end - 2000) fault(signal.aborted ? 'cancelled' : 'work_limit'); } };
  try {
    return await withCaptureBinding(input.directory, input.executable, operation.signal,
      (binding, legacy) => capture(binding, legacy, input, operation));
  } catch (error) {
    return { status: 'blocked', reason: error.reason ?? error.code ?? 'authority_changed' };
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', cancel);
  }
}
