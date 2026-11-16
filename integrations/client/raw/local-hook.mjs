import { performance } from 'node:perf_hooks';
import { stateLock } from '../state-lock.mjs';
import { fenceLocalSession, selectLocalResume } from './local-session-fence.mjs';
import { lstat, realpath } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { types } from 'node:util';
import { ownData } from '../../../core/local-authority-input.mjs';
import { readLocalInstallation } from './local-setup.mjs';
import { createLocalRawHost, localHostResult } from './local-host.mjs';
import { directory, events } from './local-setup-files.mjs';
import { absolute, exact, locations, runtime, checkSignal, fail, failure, reasons as setupReasons } from './local-setup-input.mjs';

export const hookReasons = Object.freeze([...setupReasons,'headless_skipped']);
function hookResult(status,reason = null) {
  // Reuse the host's validator and its host/worker reason lists, without copying
  // them or changing the host. Setup failures and this skip are hook-local.
  localHostResult(status,hookReasons.includes(reason) ? null:reason);
  return Object.freeze({ version:'local-raw-hook-v1',status,reason });
}
function payload(value,event,client) {
  if (!value || typeof value !== 'object' || types.isProxy(value) || Array.isArray(value) ||
      ![Object.prototype,null].includes(Object.getPrototypeOf(value))) fail('event_refused');
  const input = {};
  // Read only the fields capture uses; native clients may add arbitrary data.
  for (const key of ['hook_event_name','session_id','transcript_path','source']) {
    const descriptor = Object.getOwnPropertyDescriptor(value,key);
    if (!descriptor) continue;
    if (!Object.hasOwn(descriptor,'value')) fail('event_refused');
    input[key] = descriptor.value;
  }
  if (!events(client).includes(event) || input.hook_event_name !== event || typeof input.session_id !== 'string' ||
      !input.session_id || input.session_id.length > 200 || input.session_id.trim() !== input.session_id ||
      !input.session_id.isWellFormed() || /[\x00-\x1f\x7f]/.test(input.session_id) || !absolute(input.transcript_path)) fail('event_refused');
  if (input.source != null && (typeof input.source !== 'string' || input.source.length > 65536)) fail('event_refused');
  return { sessionId:input.session_id,sourcePath:input.transcript_path,source:input.source ?? undefined };
}
async function source(record,path,allowMissing = false) {
  const root = record.request.sourceRoot;
  if (!path.startsWith(root+'/')) fail('source_refused');
  const identity = await directory(root);
  if (identity.device !== record.sourceIdentity.device || identity.inode !== record.sourceIdentity.inode) fail('source_refused');
  // Check every component, not just the final realpath: aliases, intermediate
  // symlinks and unsafe/foreign ancestors cannot select an unrelated transcript.
  let current = root;
  const components = relative(root,path).split('/');
  for (let index = 0; index < components.length; index++) {
    current = join(current,components[index]);
    let info;
    try { info = await lstat(current); }
    catch (error) { if (allowMissing && error.code === 'ENOENT') return false; throw error; }
    if (info.isSymbolicLink() || info.uid !== process.getuid() || info.mode & 0o022 ||
        (index === components.length-1 ? !info.isFile():!info.isDirectory())) fail('source_refused');
  }
  if (await realpath(path) !== path) fail('source_refused');
  return true;
}
export async function runLocalRawHook(value,options = {}) {
  const startedAt = performance.now();
  try {
    const input = exact(value,['installationDirectory','event','payload']);
    const call = ownData(options,['signal','headless']); checkSignal(call.signal); runtime();
    const headless = Object.hasOwn(call,'headless') ? call.headless:false;
    if (typeof headless !== 'boolean') fail('invalid_input');
    const paths = locations(input.installationDirectory),record = await readLocalInstallation(paths.root);
    if (record.phase !== 'active') fail(record.phase === 'rearm_required' ? 'rearm_required':'authority_changed');
    if (record.request.client === 'claude-code' && headless) return hookResult('ready','headless_skipped');
    const {source:nativeSource,...selection} = payload(input.payload,input.event,record.request.client);
    const host = createLocalRawHost({ profilePath:paths.profile });
    // No source contents or transcript metadata are inspected before the real
    // host has verified the exact preparation, profile and fresh SQL permission.
    if ((await host.status({ signal:call.signal })).status !== 'ready') fail('authority_changed');
    if (record.request.client === 'codex' && input.event === 'SessionStart' && nativeSource === 'fork') {
      await fenceLocalSession(paths.profile,selection); return hookResult('blocked','capture_refused');
    }
    checkSignal(call.signal);
    const present = await source(record,selection.sourcePath,record.request.client === 'claude-code' && input.event === 'SessionStart');
    checkSignal(call.signal);
    if (!present) return await stateLock(paths.lock,async () => {
      if ((await readLocalInstallation(paths.root)).phase !== 'active') fail('authority_changed');
      const outcome = await host.markStart({...selection,start:'eof'},{signal:call.signal});
      return hookResult(outcome.status,outcome.status === 'ready' ? null:outcome.reason);
    });
    const outcome = await (input.event === 'SessionStart' || input.event === 'UserPromptSubmit'
      ? host.initialize({ ...selection,start:'eof' },{ signal:call.signal }) : host.run(selection,{ signal:call.signal }));
    const result = hookResult(outcome.status,['ready','progress'].includes(outcome.status) ? null:outcome.reason);
    if (input.event === 'Stop' && ['ready','progress'].includes(outcome.status) && 155000-(performance.now()-startedAt) >= 20000) {
      // Best effort only: preserve the own-session outcome and the silent hook
      // contract even for malformed hints, stale authority or a failed sweep.
      try {
        const selected = await selectLocalResume(paths.profile);
        const remaining = 155000-(performance.now()-startedAt);
        if (selected && remaining >= 20000) {
          checkSignal(call.signal);
          await source(record,selected.sourcePath);
          const budget = Math.min(155000-(performance.now()-startedAt)-5000,15000);
          if (budget >= 15000) await host.run(selected,{signal:call.signal,deadlineMs:Math.floor(budget),sweep:true});
        }
      } catch {}
    }
    return result;
  } catch (error) {
    const outcome = failure(error); return hookResult(outcome.status,outcome.reason);
  }
}
