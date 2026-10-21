import { createHash, createHmac } from 'node:crypto';
import { join } from 'node:path';
import { ownData, localAuthorityInput } from '../../../core/local-authority-input.mjs';
import { checkedPath, privateRead, privateWrite } from '../private-state.mjs';

export const rearmFail = reason => { const error = new Error('local_raw_rearm_' + reason); error.reason = reason; throw error; };
export const sha = value => createHash('sha256').update(value).digest('hex');
export const canonical = value => JSON.stringify(value && typeof value === 'object'
  ? Array.isArray(value) ? value.map(item => JSON.parse(canonical(item)))
    : Object.fromEntries(Object.keys(value).sort().map(key => [key,JSON.parse(canonical(value[key]))])) : value);
export const same = (a,b) => canonical(a) === canonical(b);
export const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const integer = (value,min = 0) => Number.isSafeInteger(value) && value >= min;
export function exact(value,fields) {
  const result = ownData(value,fields);
  if (Object.keys(result).length !== fields.length) rearmFail('rearm_invalid');
  return result;
}
export const authorityValue = value => {
  const authority = localAuthorityInput(value);
  return { ...authority,namespace:{ ...authority.namespace,projectId:authority.namespace.projectId || null } };
};
export const keyed = (identity,purpose,value) => createHmac('sha256',identity.key)
  .update(JSON.stringify(['local-raw-rearm-v1',purpose,value])).digest('hex');
export const authorityCommitment = (identity,authority) => createHmac('sha256',identity.key)
  .update(JSON.stringify(['local-raw-worker-v1','authority',localAuthorityInput(authority)])).digest('hex');
export const nonAuthorityCommitment = config => sha(canonical(Object.fromEntries(Object.entries(config).filter(([key]) => key !== 'authority'))));
export const installationCommitment = profile => sha(canonical({ configPath:profile.configPath,stateRoot:profile.stateRoot,
  identityKeyPath:profile.identityKeyPath,home:profile.home,installation:profile.installation,profilePath:profile.profilePath }));
export const sessionRearmPath = identity => join(identity.directory,identity.sessionKey+'.rearm.json');
export function encodeRecord(value) {
  const text = JSON.stringify(value);
  if (Buffer.byteLength(text) >= 65536) rearmFail('rearm_invalid');
  return text;
}
export const writeRearmRecord = (path,value) => privateWrite(path,encodeRecord(value));
export function rearmRequest(value) {
  try {
    const input = exact(value,['expectedRevision','actionId','sessionId','sourcePath']);
    if (!integer(input.expectedRevision) || typeof input.actionId !== 'string' ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(input.actionId)) throw Error();
    return input;
  } catch { rearmFail('invalid_input'); }
}
const fileKeys = ['oldConfigDigest','configDigest','oldProfileDigest','profileDigest','oldPreparationDigest','preparationDigest'];
const sessionKeys = ['version','phase','expectedRevision','revision','actionId','requestCommitment','transitionRevision',
  'sessionKey','wireSessionId','keyCommitment','rootDevice','rootInode','oldAuthorityCommitment','authorityCommitment',
  'nonAuthorityConfigCommitment','oldCursorDigest','replacementCursorDigest','replacementCursor','files'];
export function sessionRecord(value) {
  const input = exact(value,sessionKeys), files = exact(input.files,fileKeys), cursor = input.replacementCursor;
  exact(cursor,['version','sessionKey','wireSessionId','authorityCommitment','epoch','offset','issuedOrdinal','source','selection',
    'pending','blockedReason','rearmRevision']);
  const source = exact(cursor.source,['identity','anchor']), anchor = exact(source.anchor,['start','end','commitment']);
  const selection = ownData(cursor.selection,['ownSkillTurn','awaitingUserBoundary']);
  if (cursor.version !== 'local-raw-cursor-v1' || cursor.epoch !== 0 || !integer(cursor.offset) || !integer(cursor.issuedOrdinal) ||
    !digest(source.identity) || !digest(anchor.commitment) || anchor.end !== cursor.offset || anchor.start !== Math.max(0,cursor.offset-4096) ||
    Object.keys(selection).length !== 0 && (Object.keys(selection).length !== 2 ||
      typeof selection.ownSkillTurn !== 'boolean' || typeof selection.awaitingUserBoundary !== 'boolean')) rearmFail('rearm_invalid');
  if (input.version !== 'local-raw-session-rearm-v1' || !['pending','committed'].includes(input.phase) ||
    !integer(input.expectedRevision) || !integer(input.revision,1) || input.revision !== input.expectedRevision+1 ||
    !integer(input.transitionRevision,1) || input.transitionRevision > input.revision ||
    typeof input.actionId !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(input.actionId) ||
    !['requestCommitment','sessionKey','keyCommitment','oldAuthorityCommitment','authorityCommitment','nonAuthorityConfigCommitment',
      'oldCursorDigest','replacementCursorDigest'].every(key => digest(input[key])) ||
    !/^localv2_[a-f0-9]{64}$/.test(input.wireSessionId) ||
    ![input.rootDevice,input.rootInode].every(value => typeof value === 'string' && /^(0|[1-9]\d*)$/.test(value)) ||
    !Object.values(files).every(digest) || !cursor || cursor.rearmRevision !== input.revision ||
    cursor.pending !== null || cursor.blockedReason !== null || cursor.sessionKey !== input.sessionKey ||
    cursor.wireSessionId !== input.wireSessionId || cursor.authorityCommitment !== input.authorityCommitment ||
    sha(JSON.stringify(cursor)) !== input.replacementCursorDigest) rearmFail('rearm_invalid');
  encodeRecord(input); return input;
}
export function globalRecord(value) {
  const input = exact(value,['version','phase','revision','transition','action']);
  const transition = exact(input.transition,['revision','predecessorAuthority','authority','nonAuthorityConfigCommitment','installationCommitment']);
  const action = sessionRecord(input.action);
  const predecessor = authorityValue(transition.predecessorAuthority), authority = authorityValue(transition.authority);
  const domain = value => [value.version,value.targetId,value.storeId,value.namespace,value.client];
  if (input.version !== 'local-raw-rearm-state-v1' || !['pending','ready'].includes(input.phase) || !integer(input.revision) ||
    !integer(transition.revision,1) || transition.revision !== action.transitionRevision ||
    !digest(transition.nonAuthorityConfigCommitment) || !digest(transition.installationCommitment) ||
    transition.nonAuthorityConfigCommitment !== action.nonAuthorityConfigCommitment ||
    action.revision !== input.revision+(input.phase === 'pending' ? 1:0) ||
    input.phase === 'ready' && action.phase !== 'committed' || !same(domain(predecessor),domain(authority)) || same(predecessor,authority)) rearmFail('rearm_invalid');
  encodeRecord(input); return input;
}
export async function readGlobalRearm(profile) {
  const text = await privateRead(profile.rearmPath,{ missing:true });
  return text === undefined ? null:globalRecord(JSON.parse(text));
}
export async function readSessionRearm(identity) {
  const text = await privateRead(sessionRearmPath(identity),{ missing:true });
  return text === undefined ? null:sessionRecord(JSON.parse(text));
}
export async function assertSessionRearm(identity,cursor) {
  const receipt = await readSessionRearm(identity);
  if (!receipt && cursor?.rearmRevision === undefined) return null;
  if (!receipt || receipt.phase !== 'committed' || !cursor || cursor.rearmRevision !== receipt.revision ||
    receipt.sessionKey !== identity.sessionKey || receipt.wireSessionId !== identity.wireSessionId ||
    receipt.keyCommitment !== identity.keyCommitment || receipt.authorityCommitment !== identity.authorityCommitment ||
    cursor.source.identity !== receipt.replacementCursor.source.identity ||
    cursor.offset < receipt.replacementCursor.offset || cursor.issuedOrdinal < receipt.replacementCursor.issuedOrdinal)
    rearmFail('rearm_invalid');
  const root = await checkedPath(identity.stateRoot,{ directory:true });
  if (String(root.dev) !== receipt.rootDevice || String(root.ino) !== receipt.rootInode) rearmFail('rearm_invalid');
  return receipt;
}
const reasons = new Set(['rearm_pending','rearmed','replayed','stale_revision','action_conflict','rearm_invalid','rearm_refused',
  'revision_exhausted','preparation_required','preparation_invalid','profile_invalid','config_invalid','store_invalid','authority_changed',
  'capture_disabled','runtime_unavailable','host_unavailable','host_unqualified','source_unqualified','invalid_input','cancelled','work_limit',
  'unexpected_failure','source_changed','source_unavailable','partial_record','state_invalid','key_invalid','state_busy']);
export function rearmResult(statusCall,status,reason = null,revision = null,pending = null) {
  if (!['ready','waiting','blocked','busy'].includes(status) || reason !== null && !reasons.has(reason) ||
    revision !== null && !integer(revision) || pending !== null && typeof pending !== 'boolean') rearmFail('unexpected_failure');
  return Object.freeze({ version:statusCall ? 'local-raw-rearm-status-v1':'local-raw-rearm-result-v1',status,reason,revision,pending });
}
