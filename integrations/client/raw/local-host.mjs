import { AsyncLocalStorage } from 'node:async_hooks';
import { performance } from 'node:perf_hooks';
import { types } from 'node:util';
import { lstat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import { ownData } from '../../../core/local-authority-input.mjs';
import { normalizedPath } from '../../../adapters/local/configuration.mjs';
import { createLocalRawWorker } from './local-worker.mjs';
import { reasons as workerReasons } from './local-worker-input.mjs';
import { readHostProfile, readHostConfiguration, hostRuntime, hostSelection, exact, overlaps, canonicalHostPath, fail } from './local-host-profile.mjs';
import { checkHostPermission } from './local-host-permission.mjs';
import { inspectPreparation, prepareHost } from './local-host-preparation.mjs';
import { detectRunningHost, boundBinary, cachedQualification, hasQualifiedCreator } from '../../codex/qualification.mjs';
import { sessionSourceMetadata } from '../../codex/session-source.mjs';
import { executeRearm, checkHostRearm } from './local-host-rearm.mjs';
import { rearmResult } from './local-rearm-state.mjs';

const dependencies = new AsyncLocalStorage();
// Trusted-code-only dependency scope, absent from every profile and CLI DTO.
// Installed evidence uses real worker/transport/core and synthetic ancestry.
export const withLocalHostDependencies = (value, work) => dependencies.run(value,work);
const runtimeRoot = resolve(fileURLToPath(new URL('../../../',import.meta.url)));
const hostReasons = ['prepared','preparation_required','preparation_invalid','profile_invalid','config_invalid','store_invalid',
  'authority_changed','capture_disabled','runtime_unavailable','host_unavailable','host_unqualified','source_unqualified',
  'invalid_input','cancelled','work_limit','unexpected_failure'];
const aborted = Object.getOwnPropertyDescriptor(AbortSignal.prototype,'aborted').get;
const add = EventTarget.prototype.addEventListener, remove = EventTarget.prototype.removeEventListener;
export function localHostResult(status, reason = null, worker = null) {
  if (!['ready','progress','waiting','blocked','busy'].includes(status) ||
      reason !== null && !hostReasons.includes(reason) && !workerReasons.includes(reason)) fail('unexpected_failure');
  return Object.freeze({ version:'local-raw-host-v1',status,reason,worker });
}

function operation(value, deps) {
  let signal;
  try {
    signal = ownData(value,['signal']).signal;
    if (signal !== undefined) { if (types.isProxy(signal)) fail('invalid_input'); aborted.call(signal); }
  } catch { fail('invalid_input'); }
  const controller = new AbortController(), end = performance.now() + (deps.deadlineMs ?? 155000);
  let cancelled = signal !== undefined && aborted.call(signal);
  const cancel = () => { cancelled = true; controller.abort(); };
  if (signal !== undefined) add.call(signal,'abort',cancel,{ once:true });
  if (cancelled) controller.abort();
  const timer = setTimeout(() => controller.abort(),Math.max(0,end-performance.now()-2000));
  return { signal:controller.signal,remaining:() => Math.max(0,Math.floor(end-performance.now())),check() {
    if (controller.signal.aborted || performance.now() >= end-2000) fail(cancelled ? 'cancelled' : 'work_limit');
  }, close() { clearTimeout(timer); if (signal !== undefined) remove.call(signal,'abort',cancel); } };
}

async function runtimeFiles() {
  for (const path of [join(runtimeRoot,'adapters/local/cli.mjs'),join(runtimeRoot,'integrations/client/raw/local-worker.mjs')]) {
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink()) fail('runtime_unavailable');
  }
}

export function createLocalRawHost(value) {
  let input;
  try { input = exact(value,['profilePath']); if (!normalizedPath(input.profilePath)) fail('invalid_input'); }
  catch { fail('invalid_input'); }
  const profilePath = input.profilePath;
  async function execute(action, selection, callOptions = {}) {
    let op;
    const deps = dependencies.getStore() ?? {};
    try {
      op = operation(callOptions,deps); op.check();
      hostRuntime();
      await runtimeFiles(); op.check();
      if (action === 'rearm' || action === 'rearmStatus') return await executeRearm(profilePath,selection,op,deps,action === 'rearmStatus');
      const selected = ['initialize','run'].includes(action) ? hostSelection(selection,action === 'initialize') : null;
      const profile = await readHostProfile(profilePath), config = await readHostConfiguration(profile); op.check();
      await checkHostRearm(profile,config); op.check();
      await checkHostPermission(config); op.check();
      if (action === 'prepare') {
        await prepareHost(profile,config,() => op.check()); op.check();
        return localHostResult('ready','prepared');
      }
      const prepared = await inspectPreparation(profile,config); op.check();
      if (prepared !== 'ready') return localHostResult('blocked','preparation_required');
      if (action === 'status') return localHostResult('ready');
      let selectedPath,privatePaths;
      try {
        [selectedPath,...privatePaths] = await Promise.all([selected.sourcePath,profile.stateRoot,profile.identityKeyPath,
          profile.profilePath,profile.markerPath,profile.lockPath,profile.rearmPath,profile.configPath,config.databasePath,config.usage.root].map(canonicalHostPath));
      } catch { fail('source_unqualified'); }
      if (privatePaths.some(path => overlaps(selectedPath,path))) fail('invalid_input');
      async function freshPermission() {
        const finalProfile = await readHostProfile(profilePath);
        if (finalProfile.profileDigest !== profile.profileDigest) fail('preparation_invalid');
        const finalConfig = await readHostConfiguration(finalProfile);
        await checkHostRearm(finalProfile,finalConfig);
        if (await inspectPreparation(finalProfile,finalConfig) !== 'ready') fail('preparation_invalid');
        await checkHostPermission(finalConfig); op.check();
      }
      let formatAuthority = null;
      if (profile.installation.client === 'codex') {
        const host = await (deps.detectHost ?? detectRunningHost)(); op.check();
        if (!host || !await boundBinary(host)) fail('host_unavailable');
        const qualification = await cachedQualification(profile.installation.qualificationConfigPath,host); op.check();
        if (qualification.status !== 'qualified' || host.execSession === true) fail('host_unqualified');
        await deps.checkpoint?.('before_header'); op.check();
        await freshPermission();
        const source = await sessionSourceMetadata(selected.sourcePath,selected.sessionId,{ signal:op.signal,
          qualifiedCreatorVersion:qualification.version,
          qualifyCreator: version => hasQualifiedCreator(profile.installation.qualificationConfigPath,version,{ signal:op.signal }),
          ...(deps.openSource ? { openSource:deps.openSource } : {}) });
        op.check();
        if (!source?.interactive) fail('source_unqualified');
        formatAuthority = source.formatAuthority;
        if (!await boundBinary(host)) fail('host_unavailable');
      }
      await deps.checkpoint?.('before_dispatch'); op.check();
      // Re-read the exact profile and preparation binding, then take a fresh
      // authority snapshot immediately before the trusted worker invocation.
      await freshPermission();
      const worker = createLocalRawWorker({ stateRoot:profile.stateRoot,identityKeyPath:profile.identityKeyPath,
        nodeExecutable:process.execPath,runtimeRoot,configPath:profile.configPath,expectedAuthority:config.authority,home:profile.home });
      const result = await worker[action]({ ...selected,pluginRoot:profile.installation.client === 'claude-code' ? profile.installation.pluginRoot : null,
        formatAuthority },{ signal:op.signal });
      // The outer deadline includes preflight. Preserve the worker's exact
      // acknowledgement/progress even when cancellation won the host budget.
      await deps.checkpoint?.('after_dispatch');
      if (!['ready','progress'].includes(result.status)) {
        try { op.check(); }
        catch (stopped) { return localHostResult('blocked',stopped.reason,result); }
      }
      return localHostResult(result.status,result.reason,result);
    } catch (error) {
      let reason = hostReasons.includes(error.reason) || workerReasons.includes(error.reason) ? error.reason : 'unexpected_failure';
      try { op?.check(); } catch (stopped) { reason = stopped.reason; }
      if (action === 'rearm' || action === 'rearmStatus') return rearmResult(action === 'rearmStatus',reason === 'state_busy' ? 'busy':'blocked',reason);
      return localHostResult(reason === 'state_busy' ? 'busy' : 'blocked',reason);
    } finally { op?.close(); }
  }
  return Object.freeze({ status:(options = {}) => execute('status',null,options),prepare:(options = {}) => execute('prepare',null,options),
    initialize:(selection,options = {}) => execute('initialize',selection,options),run:(selection,options = {}) => execute('run',selection,options),
    rearmStatus:(options = {}) => execute('rearmStatus',null,options),rearm:(selection,options = {}) => execute('rearm',selection,options) });
}
