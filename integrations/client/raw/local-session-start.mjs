import { constants } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { lstat, open, readdir, realpath, unlink } from 'node:fs/promises';
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
export async function writeSessionStartAttempt(identity,source,kind) {
  await privateWrite(location(identity),JSON.stringify({ version:attemptVersion,authority:identity.authorityCommitment,source,kind }),
    { exclusive:true });
}
function parseAttempt(text,identity,context) {
  if (text === undefined) return undefined;
  let attempt;
  try { attempt = json(text); } catch { return undefined; }
  if (Object.keys(attempt).length !== 4 ||
      attempt.version !== attemptVersion || attempt.authority !== identity.authorityCommitment ||
      attempt.source !== sessionStartSource(identity,context) || !['fresh','present'].includes(attempt.kind)) return undefined;
  return attempt.kind;
}
export async function readSessionStartAttempt(identity,context) {
  return parseAttempt(await privateRead(location(identity),{missing:true}),identity,context);
}

const sameEntry = (left,right) => left.dev === right.dev && left.ino === right.ino;
const sameSnapshot = (left,right) => sameEntry(left,right) && left.size === right.size &&
  left.mtimeNs === right.mtimeNs && left.ctimeNs === right.ctimeNs;
const readFlags = constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK;
async function attemptSnapshot(file,allowed) {
  const before = await file.stat({ bigint:true });
  if (!allowed() || !before.isFile() || before.uid !== BigInt(process.getuid()) ||
      (before.mode & 0o777n) !== 0o600n || before.size > 65536n) return;
  const bytes = await file.readFile();
  const info = await file.stat({ bigint:true });
  if (BigInt(bytes.length) === info.size && sameSnapshot(before,info)) return { bytes,info };
}
export async function sweepSessionStartAttempt(identity,context,allowed) {
  let directoryHandle, parsedFile, currentFile;
  try {
    if (!allowed()) return;
    const path = location(identity), directory = dirname(path);
    const initial = await checkedPath(directory,{ directory:true,missing:true });
    if (!initial || !allowed()) return;
    const canonical = join(await realpath(identity.stateRoot),'starts');
    if (!allowed()) return;
    directoryHandle = await open(canonical,readFlags | constants.O_DIRECTORY);
    if (!sameEntry(initial,await directoryHandle.stat()) || !allowed()) return;
    // Use the pinned directory for Linux lookups. On macOS use its canonical
    // path and revalidate the directory before the final entry check.
    const target = join(process.platform === 'linux' ? `/proc/self/fd/${directoryHandle.fd}` : canonical,basename(path));
    parsedFile = await open(target,readFlags);
    const parsed = await attemptSnapshot(parsedFile,allowed);
    if (!parsed || !allowed() || !parseAttempt(parsed.bytes.toString('utf8'),identity,context)) return;

    // Disable can remove the parsed file even while the caller owns the
    // session lock. Keep that inode open until the new lookup is verified.
    currentFile = await open(target,readFlags);
    const current = await attemptSnapshot(currentFile,allowed);
    if (!current || !sameEntry(parsed.info,current.info) || !parsed.bytes.equals(current.bytes) || !allowed()) return;
    const parent = await checkedPath(directory,{ directory:true,missing:true });
    if (!parent || !sameEntry(initial,parent) || await realpath(directory) !== canonical || !allowed()) return;
    const final = await lstat(target,{ bigint:true });
    if (sameSnapshot(current.info,final) && allowed()) await unlink(target);
  } catch {
    // Optional cleanup must not change the hook outcome or cursor.
  } finally { await Promise.allSettled([parsedFile?.close(),currentFile?.close(),directoryHandle?.close()]); }
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
