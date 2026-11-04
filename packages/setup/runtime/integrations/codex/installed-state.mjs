import { randomUUID } from 'node:crypto';
import { open, link, unlink } from 'node:fs/promises';
import { readControlState } from '../client/control-state.mjs';
import { hostedTargetId } from '../client/transport-hosted.mjs';
import { conforms } from '../client/hosted-contract.mjs';
import { validateUsage } from '../client/runtime-usage.mjs';
import { join, isAbsolute, dirname } from 'node:path';
import { privateRead, privateWrite, checkedPath } from '../client/private-state.mjs';
import { normalizeEndpoint } from '../client/config.mjs';
import { validVersion } from './qualification.mjs';

export const exact = (value, names) => value && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).length === names.length && Object.keys(value).every(key => names.includes(key));
export function validateInstallation(value) {
  const legacy = value && !Object.hasOwn(value, 'captureExec');
  if ((!legacy && typeof value?.captureExec !== 'boolean') ||
      !exact(value, ['version','enabled','hostVersion','codex','node','home','root','pairingRecord','usesClaude',
    'endpoint','runtime','dailyCap', ...(legacy ? [] : ['captureExec'])]) || value.version !== 1 || typeof value.enabled !== 'boolean' ||
    !validVersion(value.hostVersion) || typeof value.usesClaude !== 'boolean' ||
    ![value.codex,value.node,value.home,value.root,value.runtime].every(path => typeof path === 'string' && isAbsolute(path)) ||
    !(value.pairingRecord === null || (typeof value.pairingRecord === 'string' && isAbsolute(value.pairingRecord))) ||
    !Number.isSafeInteger(value.dailyCap) || value.dailyCap < 1 || value.dailyCap > 100000 ||
    normalizeEndpoint(value.endpoint) !== value.endpoint) throw new Error('invalid_installation');
  return value;
}
export async function readInstallation(path) {
  await checkedPath(dirname(path), { directory: true });
  return validateInstallation(JSON.parse(await privateRead(path)));
}
export async function readCredential(path, endpoint) {
  const value = JSON.parse(await privateRead(join(dirname(path), 'credential.json')));
  if (!exact(value, ['version','endpoint','token']) || value.version !== 1 || value.endpoint !== endpoint ||
    typeof value.token !== 'string' || !value.token || value.token.length > 8192 ||
    /[\s\x00-\x1f\x7f]/u.test(value.token)) throw new Error('invalid_credential');
  return value.token;
}
// Prompt-recall kill switch: owner-private prompt-recall.json beside the
// installation. Absent means the A7-qualified default (on). {"version":1,
// "enabled":false} turns injection off; unreadable, unsafe or malformed fails closed.
export async function promptRecallEnabled(path) {
  try {
    const bytes = await privateRead(join(dirname(path), 'prompt-recall.json'), { missing: true });
    if (bytes === undefined) return true;
    const value = JSON.parse(bytes);
    return exact(value, ['version','enabled']) && value.version === 1 && value.enabled === true;
  } catch { return false; }
}
export const writePromptRecall = (path, enabled) => privateWrite(join(dirname(path), 'prompt-recall.json'),
  JSON.stringify({ version: 1, enabled }));
export const writeCredential = (path, endpoint, token) => privateWrite(join(dirname(path), 'credential.json'),
  JSON.stringify({ version: 1, endpoint, token }));

// Deliberately closed: do not inherit host tokens, proxy credentials, Node
// preload/debug flags or plugin options into the launcher, worker or version CLI.
export function childEnvironment(home) {
  return { HOME: home, PATH: process.env.PATH ?? '/usr/bin:/bin',
    ...(process.env.TMPDIR ? { TMPDIR: process.env.TMPDIR } : {}), LANG: 'C.UTF-8' };
}
export function clientOptions(config) {
  return { client: 'codex', home: config.home, root: config.root, usesClaude: config.usesClaude,
    isolatedCodex: !config.usesClaude && config.root !== join(config.home, '.cairn-memory'),
    pairingRecord: config.pairingRecord ?? undefined, env: childEnvironment(config.home) };
}

// Diagnostics are local, content-free and never authority for capture or recall.
// Nonwaiting diagnostic leases expire after 60 seconds. Prepare the mtime before
// exclusive publication so an injected clock cannot mistake a new lease for stale.
const diagnosticLeaseMs = 60000;
const sameFile = (a, b) => a && b && a.dev === b.dev && a.ino === b.ino;
async function diagnosticLock(path, time) {
  const temporary = `${path}.owner-${process.pid}-${randomUUID()}`;
  const file = await open(temporary, 'wx', 0o600);
  let recovery, acquired = false;
  try {
    await file.utimes(new Date(time), new Date(time));
    try { await link(temporary, path); acquired = true; }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const stale = await checkedPath(path, {missing:true});
      if (!stale || time - stale.mtimeMs < diagnosticLeaseMs) return;
      // Elect one reaper for this inode and clock interval. A killed reaper
      // cannot freeze recovery: the next interval uses a new election name.
      const electionBase = `${path}.reap-${stale.dev}-${stale.ino}-${stale.mtimeMs}-`;
      const interval = Math.floor(time / diagnosticLeaseMs);
      const election = electionBase + interval;
      try { await link(temporary, election); recovery = election; }
      catch (error) { if (error.code === 'EEXIST') return; throw error; }
      // Adjacent intervals overlap for a lease lifetime. Check AFTER election
      // so callers straddling a clock boundary cannot both reap this inode.
      for (const adjacent of [interval-1,interval+1]) {
        const other = await checkedPath(electionBase+adjacent, {missing:true});
        if (other && Math.abs(time-other.mtimeMs) < diagnosticLeaseMs) return;
      }
      const current = await checkedPath(path, {missing:true});
      if (!sameFile(stale, current) || current.mtimeMs !== stale.mtimeMs) return;
      await unlink(path);
      // link is an exclusive create: a competing normal acquisition can win.
      await link(temporary, path); acquired = true;
    }
    const owner = await file.stat();
    return async () => {
      try {
        if (sameFile(owner, await checkedPath(path, {missing:true}))) await unlink(path);
      } finally { await file.close(); }
    };
  } finally {
    if (!acquired) await file.close();
    await unlink(temporary).catch(()=>{});
    if (recovery) await unlink(recovery).catch(()=>{});
  }
}
export async function captureStopNotice(configPath, config, input, qualification,
  { now = Date.now, env = process.env, signal } = {}) {
  let lock;
  const path = join(dirname(configPath), 'capture-stop-notice.json');
  try {
    if (!config.enabled || signal?.aborted || input?.hook_event_name !== 'SessionStart' ||
        input.agent_id != null || input.agent_type != null) return '';
    const format = ['changed','unavailable','pending'].includes(qualification.status);
    let missing = false;
    if (!format) {
      try { await readCredential(configPath, config.endpoint); } catch { missing = true; }
      if (!missing) return '';
    }
    if ((await readControlState(config.root)).paused) return '';
    const target = hostedTargetId(config);
    const remoteBytes = await privateRead(join(config.root,'hosted-pause',target+'.json'), {missing:true});
    if (remoteBytes !== undefined) {
      const remote = JSON.parse(remoteBytes);
      if (!conforms('pause-state',remote) || !remote.enforced || remote.paused) return '';
    }
    const time = now(), date = new Date(time);
    const usageBytes = await privateRead(join(config.root,'usage',target+'.json'), {missing:true});
    if (usageBytes !== undefined) {
      const usage = validateUsage(JSON.parse(usageBytes));
      if (usage.day === date.toISOString().slice(0,10) && usage.used >= usage.cap) return '';
    }
    await checkedPath(dirname(configPath), {directory:true});
    lock = await diagnosticLock(path+'.lock', time);
    if (!lock) return '';
    const raw = await privateRead(path, {missing:true});
    const state = raw === undefined ? {version:1,day:null,pendingHost:null} : JSON.parse(raw);
    if (!exact(state,['version','day','pendingHost']) || state.version !== 1 ||
        !(state.day === null || /^\d{4}-\d{2}-\d{2}$/u.test(state.day)) ||
        !(state.pendingHost === null || /^[a-f0-9]{64}$/u.test(state.pendingHost))) return '';
    const day = [date.getFullYear(),String(date.getMonth()+1).padStart(2,'0'),
      String(date.getDate()).padStart(2,'0')].join('-');
    if (state.day !== null && state.day >= day) return '';
    if (qualification.status === 'pending') {
      const identity = qualification.host?.identity;
      if (!/^[a-f0-9]{64}$/u.test(identity ?? '')) return '';
      if (state.pendingHost !== identity) {
        await privateWrite(path, JSON.stringify({...state,pendingHost:identity}));
        return '';
      }
      if (!qualification.pendingFinished) return '';
    }
    const zh = (env.LC_ALL || env.LC_MESSAGES || env.LANG || '').startsWith('zh');
    const version = validVersion(qualification.version) ? qualification.version : 'unknown';
    const text = format ? (zh
      ? `Cairn 自動記憶暫停中：還不支援 Codex ${version}。檢查：npx @cairn-ink/memory status --client codex`
      : `Cairn automatic memory is paused: Codex ${version} is not supported yet. Check: npx @cairn-ink/memory status --client codex`)
      : (zh ? 'Cairn 自動記憶沒有在記：還沒登入。修正：npx @cairn-ink/memory setup'
      : 'Cairn automatic memory is off: not signed in. Fix: npx @cairn-ink/memory setup');
    if (signal?.aborted) return '';
    await privateWrite(path, JSON.stringify({...state,day}));
    return signal?.aborted ? '' : JSON.stringify({systemMessage:text});
  } catch { return ''; }
  finally {
    if (lock) await lock().catch(()=>{});
  }
}

const lastCapturePath = root => join(root,'codex-last-capture.json');
export async function readLastCapture(root) {
  try {
    const raw = await privateRead(lastCapturePath(root), {missing:true});
    if (raw === undefined) return null;
    const value = JSON.parse(raw);
    return exact(value,['version','at','count']) && value.version === 1 &&
      Number.isSafeInteger(value.at) && value.at >= 0 && value.at <= 8640000000000000 &&
      Number.isSafeInteger(value.count) && value.count > 0 ? value : null;
  } catch { return null; }
}
export async function recordLastCapture(root, at, count, {now = Date.now} = {}) {
  // Best effort, no lock waits or retries. Failure never changes worker accounting.
  let lock;
  const path = lastCapturePath(root);
  try {
    await checkedPath(root, {directory:true});
    lock = await diagnosticLock(path+'.lock', now());
    if (!lock) return;
    const previous = await readLastCapture(root);
    if (!previous || previous.at <= at)
      await privateWrite(path,JSON.stringify({version:1,at,count}));
  } catch { /* Diagnostic publication is never capture authority. */ }
  finally {
    if (lock) await lock().catch(()=>{});
  }
}
