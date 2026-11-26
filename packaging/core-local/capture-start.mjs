import { join } from 'node:path';
import { privateDirectory, privateRead, privateWrite } from '../../integrations/client/private-state.mjs';
import { keyed } from './capture-state.mjs';
import { fault } from './capture-input.mjs';

const markerPath = identity => join(identity.stateRoot,'starts',identity.sessionKey+'.json');
const attemptPath = identity => join(identity.stateRoot,'starts',identity.sessionKey+'.attempt.json');
export const sessionStartSource = (identity,context) => keyed(identity.key,'start-source',context.sourcePath).digest('hex');
const markerBinding = (identity,source) => JSON.stringify({ version:'local-raw-start-v1',authority:identity.authorityCommitment,source });
const binding = (identity,context) => markerBinding(identity,sessionStartSource(identity,context));
const attemptVersion = 'local-raw-start-attempt-v1';
function attemptKind(text,identity,source) {
  if (text === undefined) return undefined;
  let attempt;
  try { attempt = JSON.parse(text); } catch { return undefined; }
  if (Object.keys(attempt).length !== 4 ||
      attempt.version !== attemptVersion || attempt.authority !== identity.authorityCommitment ||
      attempt.source !== source || !['fresh','present'].includes(attempt.kind)) return undefined;
  return attempt.kind;
}
export async function markSessionStart(identity,context,{ recovery = false } = {}) {
  await privateDirectory(join(identity.stateRoot,'starts'));
  const path = markerPath(identity), source = sessionStartSource(identity,context);
  const marker = markerBinding(identity,source);
  if (!recovery) {
    await privateWrite(path,marker);
    return;
  }
  let previous = await privateRead(path,{missing:true});
  if (previous === undefined) {
    await privateWrite(path,marker,{ exclusive:true });
    previous = await privateRead(path,{missing:true});
  }
  if (previous === marker) return;
  if (!attemptKind(previous,identity,source)) fault('state_invalid');
  // The worker holds the session lock while converting a validated legacy
  // attempt. Any late legacy attempt writer can only link into an empty slot.
  await privateWrite(path,marker);
  if (!await hasSessionStart(identity,context)) fault('state_invalid');
}
export async function hasSessionStart(identity,context) {
  const text = await privateRead(markerPath(identity),{missing:true});
  return text !== undefined && text === binding(identity,context);
}
export async function writeSessionStartAttempt(identity,source,kind) {
  const legacy = await privateRead(markerPath(identity),{missing:true});
  if (legacy === markerBinding(identity,source) || attemptKind(legacy,identity,source)) return;
  await privateWrite(attemptPath(identity),JSON.stringify({ version:attemptVersion,authority:identity.authorityCommitment,source,kind }),
    { exclusive:true });
}
export async function readSessionStartAttempt(identity,context) {
  const text = await privateRead(attemptPath(identity),{missing:true}) ?? await privateRead(markerPath(identity),{missing:true});
  return attemptKind(text,identity,sessionStartSource(identity,context));
}
