import { constants } from 'node:fs';
import { lstat, open, realpath, rename, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { checkedPath, syncDirectory, notifyWrite } from '../private-state.mjs';
import { absolute, fail, runtimeRoot } from './local-setup-input.mjs';

export async function directory(path, privateLeaf = false) {
  try {
    if (!absolute(path) || await realpath(path) !== path) fail('unsafe_path');
    const info = await lstat(path);
    if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== process.getuid() || (info.mode & 0o022) ||
        privateLeaf && (info.mode & 0o777) !== 0o700) fail('unsafe_path');
    return { device:String(info.dev),inode:String(info.ino) };
  } catch { fail('unsafe_path'); }
}
// JSON settings are bounded and reject duplicate keys before JSON.parse can
// silently discard a conflicting registration. No comments/TOML/trust edits.
export function json(text) {
  let at = 0, nodes = 0;
  const space = () => { while (/\s/.test(text[at] ?? '') && at < text.length) at++; };
  function string() {
    const start = at++; while (at < text.length) { const value = text[at++]; if (value === '\\') at++; else if (value === '"') return JSON.parse(text.slice(start,at)); }
    throw Error();
  }
  function value(depth = 0) {
    if (++nodes > 100000 || depth > 64) throw Error(); space();
    if (text[at] === '{') { at++; space(); const seen = new Set(); if (text[at] === '}') { at++; return; }
      while (true) { space(); if (text[at] !== '"') throw Error(); const key = string(); if (seen.has(key)) throw Error(); seen.add(key);
        space(); if (text[at++] !== ':') throw Error(); value(depth+1); space(); const end = text[at++]; if (end === '}') return; if (end !== ',') throw Error(); }
    }
    if (text[at] === '[') { at++; space(); if (text[at] === ']') { at++; return; } while (true) { value(depth+1); space(); const end = text[at++]; if (end === ']') return; if (end !== ',') throw Error(); } }
    if (text[at] === '"') { string(); return; }
    const token = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(text.slice(at)); if (!token) throw Error(); at += token[0].length;
  }
  try { value(); space(); if (at !== text.length) throw Error(); const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw Error(); return parsed;
  } catch { fail('configuration_conflict'); }
}
export async function nativeSnapshot(path) {
  let file;
  try {
    if (!absolute(path)) fail('unsafe_path'); await directory(dirname(path),true);
    let initial;
    try { initial = await lstat(path); } catch (error) { if (error.code === 'ENOENT') return { text:'',identity:null }; throw error; }
    if (!initial.isFile() || initial.isSymbolicLink() || initial.uid !== process.getuid() || initial.nlink !== 1 || (initial.mode & 0o022) || initial.size > 1048576) fail('unsafe_path');
    file = await open(path,constants.O_RDONLY|constants.O_NOFOLLOW); const stat = await file.stat();
    if (stat.dev !== initial.dev || stat.ino !== initial.ino || stat.size > 1048576) fail('configuration_changed');
    const text = await file.readFile('utf8'), final = await file.stat();
    if (final.size !== stat.size || final.mtimeMs !== stat.mtimeMs || final.ctimeMs !== stat.ctimeMs) fail('configuration_changed');
    return { text,identity:[String(stat.dev),String(stat.ino),stat.size,stat.mtimeMs,stat.ctimeMs],mode:stat.mode & 0o777 };
  } catch (error) { if (error.reason) throw error; fail('unsafe_path'); }
  finally { await file?.close(); }
}
export const sameSnapshot = (a,b) => a.text === b.text && JSON.stringify(a.identity) === JSON.stringify(b.identity);
export async function nativeWrite(path, text, before) {
  const temporary = path + '.cairn-local-' + randomUUID() + '.tmp'; let file;
  try {
    file = await open(temporary,'wx',before.mode ?? 0o600); await file.writeFile(text); await file.sync(); await file.close(); file = undefined;
    await notifyWrite(path,'native-before-publication');
    if (!sameSnapshot(before,await nativeSnapshot(path))) fail('configuration_changed');
    await rename(temporary,path); await syncDirectory(dirname(path)); await notifyWrite(path,'native-published');
    if ((await nativeSnapshot(path)).text !== text) fail('configuration_changed');
  } finally { await file?.close(); await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
}
const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
export const events = client => client === 'codex' ? ['SessionStart','UserPromptSubmit','Stop','PreCompact'] : ['SessionStart','Stop','PreCompact'];
export const hookCommand = (root,event) => ['/usr/bin/env','-u','NODE_OPTIONS','-u','NODE_PATH',process.execPath,
  join(runtimeRoot,'integrations/client/raw/local-setup-cli.mjs'),'hook','--installation',root,'--event',event].map(quote).join(' ');
export function mergeNative(text, request, enabled, { own = true } = {}) {
  const value = text ? json(text) : {};
  if (value.enabledPlugins?.['cairn-memory@cairn-memory'] === true) fail('configuration_conflict');
  if (value.hooks !== undefined && (!value.hooks || typeof value.hooks !== 'object' || Array.isArray(value.hooks))) fail('configuration_conflict');
  value.hooks ??= {};
  for (const [event,groups] of Object.entries(value.hooks)) {
    if (!Array.isArray(groups) || groups.some(group => !group || typeof group !== 'object' || !Array.isArray(group.hooks))) fail('configuration_conflict');
    for (const group of groups) for (const hook of group.hooks) {
      if (!hook || typeof hook !== 'object' || Array.isArray(hook)) fail('configuration_conflict');
      if (typeof hook.command !== 'string') continue;
      const ours = own && events(request.client).includes(event) && hook.type === 'command' && hook.command === hookCommand(request.installationDirectory,event);
      if (!ours && /cairn[-_/ ]?memory|integrations\/codex\/entry\.mjs|scripts\/launch-capture\.mjs|local-setup-cli\.mjs/i.test(hook.command)) fail('configuration_conflict');
    }
  }
  for (const event of events(request.client)) {
    const groups = value.hooks[event] ?? [];
    value.hooks[event] = groups.map(group => ({ ...group,hooks:group.hooks.filter(hook => hook.command !== hookCommand(request.installationDirectory,event)) })).filter(group => group.hooks.length);
    if (enabled) value.hooks[event].push({ hooks:[{ type:'command',command:hookCommand(request.installationDirectory,event),timeout:160 }] });
    if (!value.hooks[event].length) delete value.hooks[event];
  }
  return JSON.stringify(value,null,2)+'\n';
}
export async function ensurePrivate(path, file = false) {
  try { return await checkedPath(path,{ directory:!file }); } catch { fail('unsafe_path'); }
}
