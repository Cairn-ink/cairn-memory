import { join } from 'node:path';
import { readdir, unlink } from 'node:fs/promises';
import { privateDirectory, privateRead, privateWrite, checkedPath, syncDirectory } from '../private-state.mjs';
import { keyed } from './local-worker-state.mjs';
import { fault } from './local-worker-input.mjs';

const location = identity => join(identity.stateRoot,'starts',identity.sessionKey+'.json');
const binding = (identity,context) => JSON.stringify({ version:'local-raw-start-v1',authority:identity.authorityCommitment,
  source:keyed(identity.key,'start-source',context.sourcePath).digest('hex') });
export async function markSessionStart(identity,context) {
  await privateDirectory(join(identity.stateRoot,'starts'));
  await privateWrite(location(identity),binding(identity,context));
}
export async function hasSessionStart(identity,context) {
  const text = await privateRead(location(identity),{missing:true});
  return text !== undefined && text === binding(identity,context);
}
export async function clearSessionStarts(stateRoot) {
  const directory=join(stateRoot,'starts');
  if (!await checkedPath(directory,{directory:true,missing:true})) return;
  for (const name of await readdir(directory)) {
    if (!/^[a-f0-9]{64}\.json$/.test(name)) fault('state_invalid');
    const path=join(directory,name); await checkedPath(path); await unlink(path);
  }
  await syncDirectory(directory);
}
