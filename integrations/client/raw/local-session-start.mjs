import { join } from 'node:path';
import { lstat, readdir, unlink } from 'node:fs/promises';
import { privateDirectory, privateRead, privateWrite, checkedPath, syncDirectory } from '../private-state.mjs';
import { keyed } from './local-worker-state.mjs';
import { fault } from './local-worker-input.mjs';
import { json } from './local-setup-files.mjs';

const location = identity => join(identity.stateRoot,'starts',identity.sessionKey+'.json');
export const sessionStartSource = (identity,context) => keyed(identity.key,'start-source',context.sourcePath).digest('hex');
const binding = (identity,context) => JSON.stringify({ version:'local-raw-start-v1',authority:identity.authorityCommitment,
  source:sessionStartSource(identity,context) });
const attemptVersion = 'local-raw-start-attempt-v1';
export async function markSessionStart(identity,context) {
  await privateDirectory(join(identity.stateRoot,'starts'));
  await privateWrite(location(identity),binding(identity,context));
}
export async function hasSessionStart(identity,context) {
  const text = await privateRead(location(identity),{missing:true});
  return text !== undefined && text === binding(identity,context);
}
const isAttempt = text => {
  try {
    const attempt = json(text);
    return Object.keys(attempt).length === 4 && attempt.version === attemptVersion &&
      typeof attempt.authority === 'string' && typeof attempt.source === 'string' && ['fresh','present'].includes(attempt.kind);
  } catch { return false; }
};
export async function writeSessionStartAttempt(identity,source,kind) {
  // A newer attempt atomically replaces an earlier attempt for this session
  // (temporary file + rename). A start marker or an unrecognized file stays.
  const path = location(identity), existing = await privateRead(path,{missing:true});
  if (existing !== undefined && !isAttempt(existing)) return;
  await privateWrite(path,JSON.stringify({ version:attemptVersion,authority:identity.authorityCommitment,source,kind }),
    { exclusive:existing === undefined });
}
export async function readSessionStartAttempt(identity,context) {
  const text = await privateRead(location(identity),{missing:true});
  if (text === undefined) return undefined;
  let attempt;
  try { attempt = json(text); } catch { return undefined; }
  if (Object.keys(attempt).length !== 4 ||
      attempt.version !== attemptVersion || attempt.authority !== identity.authorityCommitment ||
      attempt.source !== sessionStartSource(identity,context) || !['fresh','present'].includes(attempt.kind)) return undefined;
  return attempt.kind;
}
export async function clearSessionStarts(stateRoot) {
  const directory=join(stateRoot,'starts');
  if (!await checkedPath(directory,{directory:true,missing:true})) return;
  for (const name of await readdir(directory)) {
    const path=join(directory,name);
    if (/^[a-f0-9]{64}\.json$/.test(name)) await checkedPath(path);
    else if (!/^[a-f0-9]{64}\.json\.tmp-\d+-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(name) ||
      !(await lstat(path)).isFile()) fault('state_invalid');
    await unlink(path);
  }
  await syncDirectory(directory);
}
