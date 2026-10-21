import { createHmac } from 'node:crypto';
import { join } from 'node:path';
import { opendir } from 'node:fs/promises';
import { checkedPath, privateDirectory, privateRead, privateWrite } from '../private-state.mjs';
import { stateLock } from '../state-lock.mjs';
import { fault, exact, integer, digest, reasons } from './local-worker-input.mjs';

export const keyed = (key, purpose, value) => createHmac('sha256',key).update(JSON.stringify(['local-raw-worker-v1',purpose,value]));
export async function loadIdentity(options, context, operation) {
  try {
    operation.check(); await checkedPath(options.stateRoot,{ directory: true });
    const text = await privateRead(options.identityKeyPath); operation.check();
    if (!/^[a-f0-9]{64}\n?$/.test(text)) fault('key_invalid');
    const key = Buffer.from(text.trim(),'hex'), { authority } = options;
    const keyCommitment = keyed(key,'installation-key',null).digest('hex');
    const binding = [authority.storeId,authority.targetId,authority.namespace,authority.client,context.sessionId];
    const sessionKey = keyed(key,'session-state',binding).digest('hex');
    const wireSessionId = 'localv2_' + keyed(key,'wire-session',binding).digest('hex');
    const authorityCommitment = keyed(key,'authority',authority).digest('hex');
    const directory = join(options.stateRoot,'sessions');
    return { key,keyCommitment,sessionKey,wireSessionId,authorityCommitment,directory,
      claimPath: join(directory,sessionKey+'.claim.json'), cursorPath: join(directory,sessionKey+'.json'), lockPath: join(directory,sessionKey+'.lock') };
  } catch (error) { if (error?.reason === 'cancelled' || error?.reason === 'work_limit') throw error; fault('key_invalid'); }
}
export async function bindRoot(options, identity, initialize, operation) {
  try {
    await stateLock(join(options.stateRoot,'.root.lock'),async () => {
      operation.check(); const path = join(options.stateRoot,'root.json');
      let text = await privateRead(path,{ missing: true });
      if (text === undefined) {
        if (!initialize) fault('state_invalid');
        // A lost root cannot authorize adopting an established session tree,
        // especially after a different installation key changes every basename.
        if (await checkedPath(identity.directory,{ directory:true,missing:true })) {
          const directory = await opendir(identity.directory);
          try { if (await directory.read()) fault('state_invalid'); }
          finally { await directory.close(); }
        }
        await privateWrite(path,JSON.stringify({ version:'local-raw-state-v1',keyCommitment:identity.keyCommitment }),{ exclusive:true });
        text = await privateRead(path);
      }
      const root = exact(JSON.parse(text),['version','keyCommitment']);
      if (root.version !== 'local-raw-state-v1' || root.keyCommitment !== identity.keyCommitment) fault('key_invalid');
      if (initialize) await privateDirectory(identity.directory);
      else await checkedPath(identity.directory,{ directory:true });
      operation.check();
    });
  } catch (error) {
    if (error.message === 'state_busy') fault('state_busy');
    if (['state_invalid','key_invalid','cancelled','work_limit'].includes(error.reason)) throw error;
    fault('state_invalid');
  }
}
function validProjection(value, cursor) {
  const p = exact(value,['version','profile','client','wireSessionId','generation','epoch','range','messageOrdinal','role',
    'sourceIdentity','contentIdentity','totalUnits','totalBytes','part','eventId']);
  const range = exact(p.range,['start','end']), part = exact(p.part,['index','start','end']);
  if (p.version !== 1 || p.profile !== 'raw-producer-v1' || !['claude-code','codex'].includes(p.client) ||
      p.wireSessionId !== cursor.wireSessionId || p.epoch !== 0 || typeof p.generation !== 'string' ||
      !/^(?:initial|[a-f0-9-]{36}|legacy-[a-f0-9]{64})$/.test(p.generation) ||
      !integer(p.messageOrdinal,1) || p.messageOrdinal !== cursor.issuedOrdinal || !['user','assistant'].includes(p.role) ||
      !digest(p.sourceIdentity) || !digest(p.contentIdentity) || !digest(p.eventId) || !integer(p.totalUnits,1) || !integer(p.totalBytes,1) ||
      range.start !== cursor.offset || !integer(range.end,range.start+1) || range.end-range.start > 33554432 ||
      !integer(part.index) || !integer(part.start) || !integer(part.end,part.start+1) || part.end > p.totalUnits ||
      part.end-part.start > 4000 || (part.index === 0 ? part.start !== 0 : part.start === 0)) fault('state_invalid');
}
export function validateCursor(value, identity, client) {
  const cursor = exact(value,['version','sessionKey','wireSessionId','authorityCommitment','epoch','offset','issuedOrdinal','source','selection','pending','blockedReason']);
  const source = exact(cursor.source,['identity','anchor']), anchor = exact(source.anchor,['start','end','commitment']);
  if (cursor.version !== 'local-raw-cursor-v1' || cursor.sessionKey !== identity.sessionKey || cursor.wireSessionId !== identity.wireSessionId ||
      cursor.epoch !== 0 || !integer(cursor.offset) || !integer(cursor.issuedOrdinal) || !digest(cursor.authorityCommitment) ||
      !digest(source.identity) || !digest(anchor.commitment) || anchor.end !== cursor.offset || anchor.start !== Math.max(0,cursor.offset-4096) ||
      cursor.blockedReason !== null && !reasons.includes(cursor.blockedReason)) fault('state_invalid');
  if (cursor.authorityCommitment !== identity.authorityCommitment) fault('authority_changed');
  const selection = exact(cursor.selection,client === 'claude-code' ? ['ownSkillTurn','awaitingUserBoundary'] : []);
  if (client === 'claude-code' && (typeof selection.ownSkillTurn !== 'boolean' || typeof selection.awaitingUserBoundary !== 'boolean')) fault('state_invalid');
  if (cursor.pending !== null) {
    const pending = exact(cursor.pending,['projection','attempts','nextEligibleAt','lastAttemptAt','state']);
    validProjection(pending.projection,cursor);
    if (pending.projection.client !== client || !integer(pending.attempts) || pending.attempts > 4 ||
        !['prepared','dispatched','processing','uncertain','unavailable','blocked'].includes(pending.state) ||
        ![pending.nextEligibleAt,pending.lastAttemptAt].every(time => time === null || integer(time)) ||
        pending.attempts === 0 && (pending.state !== 'prepared' || pending.nextEligibleAt !== null || pending.lastAttemptAt !== null) ||
        pending.attempts > 0 && pending.lastAttemptAt === null) fault('state_invalid');
    if (pending.attempts > 0) {
      const eligible = pending.nextEligibleAt !== null && pending.nextEligibleAt-pending.lastAttemptAt >= 125000;
      if (pending.state === 'prepared' || (pending.state === 'blocked') !== (cursor.blockedReason !== null) ||
          pending.state === 'unavailable' && pending.nextEligibleAt !== null ||
          ['dispatched','processing','uncertain'].includes(pending.state) && !eligible ||
          pending.state === 'blocked' && pending.nextEligibleAt !== null && !eligible) fault('state_invalid');
    }
  }
  return cursor;
}
export async function readSession(identity, client) {
  try {
    const claimText = await privateRead(identity.claimPath,{ missing:true }), cursorText = await privateRead(identity.cursorPath,{ missing:true });
    if (claimText === undefined && cursorText === undefined) return null;
    if (claimText === undefined || cursorText === undefined) fault('state_invalid');
    const claim = exact(JSON.parse(claimText),['version','sessionKey','wireSessionId','keyCommitment']);
    if (claim.version !== 'local-raw-claim-v1' || claim.sessionKey !== identity.sessionKey ||
        claim.wireSessionId !== identity.wireSessionId || claim.keyCommitment !== identity.keyCommitment) fault('state_invalid');
    return validateCursor(JSON.parse(cursorText),identity,client);
  } catch (error) { if (error.reason === 'authority_changed') throw error; fault('state_invalid'); }
}
export async function writeCursor(identity, cursor) {
  const text = JSON.stringify(cursor);
  if (Buffer.byteLength(text) >= 65536) fault('state_invalid');
  await privateWrite(identity.cursorPath,text);
}
export async function initializeSession(identity, cursor) {
  await privateWrite(identity.claimPath,JSON.stringify({ version:'local-raw-claim-v1',sessionKey:identity.sessionKey,
    wireSessionId:identity.wireSessionId,keyCommitment:identity.keyCommitment }),{ exclusive:true });
  const claim = exact(JSON.parse(await privateRead(identity.claimPath)),['version','sessionKey','wireSessionId','keyCommitment']);
  if (claim.version !== 'local-raw-claim-v1' || claim.sessionKey !== identity.sessionKey ||
      claim.wireSessionId !== identity.wireSessionId || claim.keyCommitment !== identity.keyCommitment) fault('state_invalid');
  await writeCursor(identity,cursor);
}
