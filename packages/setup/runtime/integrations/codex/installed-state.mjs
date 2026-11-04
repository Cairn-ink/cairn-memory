import { open, readdir, unlink } from 'node:fs/promises';
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
const attemptPath = configPath => join(dirname(configPath),'codex-qualification-attempt.json');
const validIdentity = identity => typeof identity === 'string' && /^[a-f0-9]{64}$/u.test(identity);
const validTime = time => Number.isSafeInteger(time) && time >= 0 && time <= 8640000000000000;
export async function recordQualificationAttempt(configPath, host, {now = Date.now} = {}) {
  try {
    const finishedAt = now();
    if (!validIdentity(host?.identity) || !validTime(finishedAt)) return;
    await privateWrite(attemptPath(configPath), JSON.stringify({version:1,identity:host.identity,finishedAt}));
  } catch { /* Attempt history must never change qualification or its cache. */ }
}
export async function pendingCaptureNotice(configPath, host, {now = Date.now} = {}) {
  try {
    if (!validIdentity(host?.identity)) return false;
    await checkedPath(dirname(configPath), {directory:true});
    const directory = join(dirname(configPath),'qualification');
    await checkedPath(directory, {directory:true,missing:true});
    const marker = join(directory,host.identity+'.pending');
    const pending = await privateRead(marker, {missing:true});
    // Qualifier markers are empty. Only ENOENT is absence; unsafe or malformed
    // marker/history reads suppress this invocation even if other evidence exists.
    if (pending !== undefined && pending !== '') return false;
    const info = pending === undefined ? undefined : await checkedPath(marker);
    const raw = await privateRead(attemptPath(configPath), {missing:true});
    let attempt;
    if (raw !== undefined) {
      attempt = JSON.parse(raw);
      if (!exact(attempt,['version','identity','finishedAt']) || attempt.version !== 1 ||
          !validIdentity(attempt.identity) || !validTime(attempt.finishedAt)) return false;
    }
    return attempt?.identity === host.identity || Boolean(info && now()-info.mtimeMs >= 600000);
  } catch { return false; }
}
const claimPattern = /^capture-stop-notice-\d{4}-\d{2}-\d{2}\.claim$/u;
async function pruneNoticeClaims(directory, today) {
  try {
    let removed = 0;
    for (const name of await readdir(directory)) {
      if (name === today || !claimPattern.test(name)) continue;
      if (removed++ >= 32) break;
      await unlink(join(directory,name)).catch(()=>{});
    }
  } catch { /* Pruning is bounded best effort, after the exclusive claim. */ }
}
export async function captureStopNotice(configPath, config, input, qualification,
  { now = Date.now, env = process.env, signal } = {}) {
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
    if (qualification.status === 'pending' && qualification.pendingNotice !== true) return '';
    await checkedPath(dirname(configPath), {directory:true});
    const day = [date.getFullYear(),String(date.getMonth()+1).padStart(2,'0'),
      String(date.getDate()).padStart(2,'0')].join('-');
    const name = `capture-stop-notice-${day}.claim`;
    const zh = (env.LC_ALL || env.LC_MESSAGES || env.LANG || '').startsWith('zh');
    const version = validVersion(qualification.version) ? qualification.version : 'unknown';
    const text = format ? (zh
      ? `Cairn 自動記憶暫停中：還不支援 Codex ${version}。檢查：npx @cairn-ink/memory status --client codex`
      : `Cairn automatic memory is paused: Codex ${version} is not supported yet. Check: npx @cairn-ink/memory status --client codex`)
      : (zh ? 'Cairn 自動記憶沒有在記：還沒登入。修正：npx @cairn-ink/memory setup'
      : 'Cairn automatic memory is off: not signed in. Fix: npx @cairn-ink/memory setup');
    if (signal?.aborted) return '';
    // wx never follows or replaces an existing entry. A crash here may consume
    // this day's notice silently; at-most-once is the intended guarantee.
    const claim = await open(join(dirname(configPath),name), 'wx', 0o600);
    await claim.close();
    await pruneNoticeClaims(dirname(configPath),name);
    return signal?.aborted ? '' : JSON.stringify({systemMessage:text});
  } catch { return ''; }
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
export async function recordLastCapture(root, at, count) {
  // Best effort compare-then-write, without a lock. Two simultaneous workers can
  // race between read and rename and briefly publish the slightly earlier time
  // until the next capture. Status shows minutes; this diagnostic never affects
  // capture, accounting or results.
  const path = lastCapturePath(root);
  try {
    await checkedPath(root, {directory:true});
    const previous = await readLastCapture(root);
    if (!previous || previous.at < at)
      await privateWrite(path,JSON.stringify({version:1,at,count}));
  } catch { /* Diagnostic publication is never capture authority. */ }
}
