import { createHmac, createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { opendir } from 'node:fs/promises';
import { checkedPath, privateDirectory, privateRead, privateWrite, privateRemove } from '../private-state.mjs';
import { stateLock } from '../state-lock.mjs';
import { fault, exact, integer, digest, reasons } from './local-worker-input.mjs';
import { ownData } from '../../../core/local-authority-input.mjs';
import { checkHostPermission } from './local-host-permission.mjs';
import { assertSessionRearm } from './local-rearm-state.mjs';

export const keyed = (key, purpose, value) => createHmac('sha256',key).update(JSON.stringify(['local-raw-worker-v1',purpose,value]));
export async function loadIdentity(options, context, operation) {
  try {
    if (operation.check() === false) return {status:'deadline'};
    await checkedPath(options.stateRoot,{ directory: true });
    if (operation.check() === false) return {status:'deadline'};
    const text = await privateRead(options.identityKeyPath);
    if (operation.check() === false) return {status:'deadline'};
    if (!/^[a-f0-9]{64}\n?$/.test(text)) fault('key_invalid');
    const key = Buffer.from(text.trim(),'hex'), { authority } = options;
    const keyCommitment = keyed(key,'installation-key',null).digest('hex');
    const binding = [authority.storeId,authority.targetId,authority.namespace,authority.client,context.sessionId];
    const sessionKey = keyed(key,'session-state',binding).digest('hex');
    const wireSessionId = 'localv2_' + keyed(key,'wire-session',binding).digest('hex');
    const authorityCommitment = keyed(key,'authority',authority).digest('hex');
    const directory = join(options.stateRoot,'sessions');
    return { key,keyCommitment,sessionKey,wireSessionId,authorityCommitment,directory,stateRoot:options.stateRoot,
      claimPath: join(directory,sessionKey+'.claim.json'), cursorPath: join(directory,sessionKey+'.json'), lockPath: join(directory,sessionKey+'.lock') };
  } catch (error) { if (operation.check() === false) return {status:'deadline'}; if (error?.reason === 'cancelled' || error?.reason === 'work_limit') throw error; fault('key_invalid'); }
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
  const fields = ['version','sessionKey','wireSessionId','authorityCommitment','epoch','offset','issuedOrdinal','source','selection','pending','blockedReason'];
  const data = ownData(value,[...fields,'rearmRevision']);
  const cursor = exact(data,[...fields,...(Object.hasOwn(data,'rearmRevision') ? ['rearmRevision']:[])]);
  if (Object.hasOwn(cursor,'rearmRevision') && !integer(cursor.rearmRevision,1)) fault('state_invalid');
  const source = exact(cursor.source,['identity','anchor']), anchor = exact(source.anchor,['start','end','commitment']);
  if (cursor.version !== 'local-raw-cursor-v1' || cursor.sessionKey !== identity.sessionKey || cursor.wireSessionId !== identity.wireSessionId ||
      cursor.epoch !== 0 || !integer(cursor.offset) || !integer(cursor.issuedOrdinal) || !digest(cursor.authorityCommitment) ||
      !digest(source.identity) || !digest(anchor.commitment) || anchor.end !== cursor.offset || anchor.start !== Math.max(0,cursor.offset-4096) ||
      cursor.blockedReason !== null && !reasons.includes(cursor.blockedReason)) fault('state_invalid');
  // Historical Codex beginning cursors (including pending dispatches) must
  // never import old turns. Preserve their identity and refuse before recovery.
  if (client === 'codex' && cursor.offset === 0) fault('codex_boundary_required');
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
export async function readSession(identity, client, rearming = false,operation) {
  try {
    if (operation?.check() === false) return {status:'deadline'};
    const claimText = await privateRead(identity.claimPath,{ missing:true });
    if (operation?.check() === false) return {status:'deadline'};
    const cursorText = await privateRead(identity.cursorPath,{ missing:true });
    if (operation?.check() === false) return {status:'deadline'};
    if (claimText === undefined && cursorText === undefined) {
      if (!rearming && (await assertSessionRearm(identity,null,operation))?.status === 'deadline') return {status:'deadline'};
      return null;
    }
    if (claimText === undefined || cursorText === undefined) fault('state_invalid');
    const claim = exact(JSON.parse(claimText),['version','sessionKey','wireSessionId','keyCommitment']);
    if (claim.version !== 'local-raw-claim-v1' || claim.sessionKey !== identity.sessionKey ||
        claim.wireSessionId !== identity.wireSessionId || claim.keyCommitment !== identity.keyCommitment) fault('state_invalid');
    const cursor = validateCursor(JSON.parse(cursorText),identity,client);
    if (!rearming && (await assertSessionRearm(identity,cursor,operation))?.status === 'deadline') return {status:'deadline'};
    return cursor;
  } catch (error) { if (operation?.check() === false) return {status:'deadline'}; if (['authority_changed','codex_boundary_required'].includes(error.reason)) throw error; fault('state_invalid'); }
}
export async function writeCursor(identity, cursor) {
  const text = JSON.stringify(cursor);
  if (Buffer.byteLength(text) >= 65536) fault('state_invalid');
  // Publish recovery authority before the dispatch cursor can become durable:
  // a hook killed immediately after dispatch must already have a sealed hint.
  if (identity.resumeContext && cursor.pending?.state !== 'blocked' && cursor.pending)
    await refreshResumeHint(identity,identity.resumeContext,cursor,false,identity.resumeConfig);
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

const resumeName = /^[a-f0-9]{64}\.json$/;
const resumeDirectory = identity => join(identity.stateRoot,'resume');
export const dropResumeHint = (identity, name = identity.sessionKey+'.json') => privateRemove(join(resumeDirectory(identity),name));
async function resumeNames(identity,operation) {
  const path = resumeDirectory(identity);
  if (operation?.check() === false) return {status:'deadline'};
  if (!await checkedPath(path,{directory:true,missing:true})) return [];
  if (operation?.check() === false) return {status:'deadline'};
  const directory = await opendir(path), names = [];
  try {
    for (;;) {
      if (operation?.check() === false) return {status:'deadline'};
      const entry = await directory.read();
      if (operation?.check() === false) return {status:'deadline'};
      if (!entry) return names;
      if (!resumeName.test(entry.name)) { await dropResumeHint(identity,entry.name); fault('state_invalid'); }
      names.push(entry.name);
      if (names.length > 64) fault('state_invalid');
    }
  } finally { await directory.close(); }
}
async function resumeRecord(identity,name) {
  const text = await privateRead(join(resumeDirectory(identity),name),{missing:true});
  if (text === undefined) return null;
  const hint = exact(JSON.parse(text),['version','updatedAt','iv','tag','sealed']);
  if (hint.version !== 'local-raw-resume-v1' || !integer(hint.updatedAt) ||
      !/^[a-f0-9]{24}$/.test(hint.iv) || !/^[a-f0-9]{32}$/.test(hint.tag) ||
      typeof hint.sealed !== 'string' || !/^(?:[a-f0-9]{2})+$/.test(hint.sealed)) fault('state_invalid');
  return hint;
}
// The caller holds the session lock. The separate bounded-directory lock only
// serializes hint publication and cleanup; it never acquires a session lock.
export async function refreshResumeHint(identity,context,cursor,remainingWork = false,config) {
  await stateLock(join(identity.stateRoot,'.resume.lock'),async () => {
    if (!(cursor?.pending && cursor.pending.state !== 'blocked') && !remainingWork) {
      await dropResumeHint(identity); return;
    }
    await privateDirectory(resumeDirectory(identity));
    const names = await resumeNames(identity), name = identity.sessionKey+'.json';
    if (!names.includes(name) && names.length === 64) {
      const hints = [];
      for (const item of names) hints.push({ name:item,updatedAt:(await resumeRecord(identity,item))?.updatedAt ?? 0 });
      hints.sort((a,b)=>a.updatedAt-b.updatedAt || a.name.localeCompare(b.name));
      await dropResumeHint(identity,hints[0].name);
    }
    const key = keyed(identity.key,'resume-hint',null).digest(), iv = randomBytes(12);
    try {
      const cipher = createCipheriv('aes-256-gcm',key,iv); cipher.setAAD(Buffer.from(identity.sessionKey));
      const sealed = Buffer.concat([cipher.update(JSON.stringify({sessionId:context.sessionId,sourcePath:context.sourcePath}),'utf8'),cipher.final()]);
      // Disable revokes the core grant before locking this directory to clear.
      try { await checkHostPermission(config); }
      catch { await dropResumeHint(identity); return; }
      await privateWrite(join(resumeDirectory(identity),name),JSON.stringify({version:'local-raw-resume-v1',updatedAt:Date.now(),
        iv:iv.toString('hex'),tag:cipher.getAuthTag().toString('hex'),sealed:sealed.toString('hex')}));
    } finally { key.fill(0); }
  });
}
async function chooseResumeHintInside(options,identity,operation) {
  const now = Date.now(), hints = [];
  const names = await resumeNames(identity,operation);
  if (names.status === 'deadline') return names;
  for (const name of names) {
    if (operation.check() === false) return {status:'deadline'};
    let hint;
    try { hint = await resumeRecord(identity,name); }
    catch {
      if (operation.check() === false) return {status:'deadline'};
      await dropResumeHint(identity,name); return null;
    }
    if (operation.check() === false) return {status:'deadline'};
    if (!hint) continue;
    if (now-hint.updatedAt > 7*24*60*60*1000) { await dropResumeHint(identity,name); continue; }
    if (now-hint.updatedAt >= 10*60*1000) hints.push({name,hint});
  }
  hints.sort((a,b)=>a.hint.updatedAt-b.hint.updatedAt || a.name.localeCompare(b.name));
  if (!hints.length) return null;
  if (operation.check() === false) return {status:'deadline'};
  const {name,hint} = hints[0], sessionKey = name.slice(0,-5), key = keyed(identity.key,'resume-hint',null).digest();
  let selectedIdentity;
  try {
    const cipher = createDecipheriv('aes-256-gcm',key,Buffer.from(hint.iv,'hex'));
    cipher.setAAD(Buffer.from(sessionKey)); cipher.setAuthTag(Buffer.from(hint.tag,'hex'));
    const selection = exact(JSON.parse(Buffer.concat([cipher.update(Buffer.from(hint.sealed,'hex')),cipher.final()]).toString('utf8')),['sessionId','sourcePath']);
    // Validate the native selection before any source-path proof or metadata.
    if (typeof selection.sessionId !== 'string' || typeof selection.sourcePath !== 'string') fault('state_invalid');
    selectedIdentity = await loadIdentity(options,selection,operation);
    if (selectedIdentity.status === 'deadline') return selectedIdentity;
    if (operation.check() === false) return {status:'deadline'};
    if (selectedIdentity.sessionKey !== sessionKey) fault('state_invalid');
    return {selection,sessionKey};
  } catch {
    if (operation.check() === false) return {status:'deadline'};
    await dropResumeHint(identity,name); return null;
  }
  finally { key.fill(0); selectedIdentity?.key?.fill(0); }
}

export async function chooseResumeHint(options,identity,operation) {
  // Never mistake privateWrite's transient atomic-replacement file for an
  // untrusted entry while another session publishes a hint.
  if (operation.check() === false) return {status:'deadline'};
  return stateLock(join(identity.stateRoot,'.resume.lock'),()=>chooseResumeHintInside(options,identity,operation));
}
