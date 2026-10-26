import { privateRead, privateWrite, checkedPath } from '../private-state.mjs';
import { stateLock } from '../state-lock.mjs';
import { readConfigurationSnapshot } from '../../../adapters/local/configuration.mjs';
import { localAuthorityInput } from '../../../core/local-authority-input.mjs';
import { readHostProfile, readHostConfiguration, hostSelection, canonicalHostPath, overlaps } from './local-host-profile.mjs';
import { inspectPreparation } from './local-host-preparation.mjs';
import { readRearmAuthority, inspectRearmBoundary, checkRearmSession } from './local-host-permission.mjs';
import { loadIdentity, bindRoot, readSession, validateCursor, writeCursor } from './local-worker-state.mjs';
import { sourceBudget, openWorkerSource, qualifySource, verifyCursorSource, sourceSize, completeBoundary, cursorSource,
  producerInput, producerOptions, sourceReason } from './local-worker-source.mjs';
import { prepareRawRecord } from './message.mjs';
import { restoreRawBatch, planRawBatch } from './planner.mjs';
import { detectRunningHost, boundBinary, cachedQualification, hasQualifiedCreator } from '../../codex/qualification.mjs';
import { sessionSourceMetadata } from '../../codex/session-source.mjs';
import { sha, same, keyed, authorityCommitment, nonAuthorityCommitment, installationCommitment, rearmFail,
  rearmRequest, rearmResult, readGlobalRearm, readSessionRearm, sessionRearmPath, sessionRecord, globalRecord,
  assertSessionRearm, writeRearmRecord, encodeRecord } from './local-rearm-state.mjs';

const clone = value => structuredClone(value);
const actionSame = (a,b) => same({ ...a,phase:'pending' },{ ...b,phase:'pending' });
const snapshot = async profile => {
  const configText = await privateRead(profile.configPath), profileText = await privateRead(profile.profilePath);
  const preparationText = await privateRead(profile.markerPath);
  const { config,digest } = await readConfigurationSnapshot(profile.configPath);
  if (sha(configText) !== digest || sha(profileText) !== profile.profileDigest) rearmFail('rearm_invalid');
  return { config,configText,profileText,preparationText };
};
function frozenFiles(profile,files,authority) {
  const configText = JSON.stringify({ ...JSON.parse(files.configText),authority });
  const profileText = JSON.stringify({ ...JSON.parse(files.profileText),configDigest:sha(configText) });
  const preparationText = JSON.stringify({ ...JSON.parse(files.preparationText),configDigest:sha(configText),
    profileDigest:sha(profileText),authorityCommitment:sha(JSON.stringify(authority)) });
  return { configText,profileText,preparationText,files:{ oldConfigDigest:sha(files.configText),configDigest:sha(configText),
    oldProfileDigest:sha(files.profileText),profileDigest:sha(profileText),oldPreparationDigest:sha(files.preparationText),
    preparationDigest:sha(preparationText) } };
}
function assertBindings(profile,files,record) {
  if (installationCommitment(profile) !== record.transition.installationCommitment ||
    nonAuthorityCommitment(files.config) !== record.transition.nonAuthorityConfigCommitment) rearmFail('rearm_invalid');
  for (const [field,oldKey,newKey] of [['configText','oldConfigDigest','configDigest'],['profileText','oldProfileDigest','profileDigest'],
    ['preparationText','oldPreparationDigest','preparationDigest']]) {
    if (![record.action.files[oldKey],record.action.files[newKey]].includes(sha(files[field]))) rearmFail('rearm_invalid');
  }
}
export async function checkHostRearm(profile,config) {
  const record = await readGlobalRearm(profile);
  if (!record) return;
  if (record.phase !== 'ready' || installationCommitment(profile) !== record.transition.installationCommitment ||
    nonAuthorityCommitment(config) !== record.transition.nonAuthorityConfigCommitment ||
    !same(config.authority,record.transition.authority)) rearmFail('preparation_invalid');
  const files = await snapshot(profile);
  if (sha(files.configText) !== record.action.files.configDigest || sha(files.profileText) !== record.action.files.profileDigest ||
    sha(files.preparationText) !== record.action.files.preparationDigest) rearmFail('preparation_invalid');
}
async function qualifiedContext(profile,selection,authority,operation,deps) {
  let formatAuthority = null;
  if (profile.installation.client === 'codex') {
    const host = await (deps.detectHost ?? detectRunningHost)(); operation.check();
    if (!host || !await boundBinary(host)) rearmFail('host_unavailable');
    const qualification = await cachedQualification(profile.installation.qualificationConfigPath,host);
    if (qualification.status !== 'qualified' || host.execSession === true) rearmFail('host_unqualified');
    const config = (await readConfigurationSnapshot(profile.configPath)).config;
    if (!same(await readRearmAuthority(config),authority)) rearmFail('authority_changed');
    const source = await sessionSourceMetadata(selection.sourcePath,selection.sessionId,{ signal:operation.signal,
      qualifiedCreatorVersion:qualification.version,
      qualifyCreator:version => hasQualifiedCreator(profile.installation.qualificationConfigPath,version,{ signal:operation.signal }),
      ...(deps.openSource ? { openSource:deps.openSource }:{}) });
    if (!source?.interactive) rearmFail('source_unqualified');
    formatAuthority = source.formatAuthority;
    if (!await boundBinary(host)) rearmFail('host_unavailable');
  }
  return { ...selection,pluginRoot:profile.installation.client === 'claude-code' ? profile.installation.pluginRoot:null,formatAuthority };
}
async function sourcePaths(profile,config,selection) {
  const [source,...privatePaths] = await Promise.all([selection.sourcePath,profile.stateRoot,profile.identityKeyPath,profile.profilePath,
    profile.markerPath,profile.lockPath,profile.rearmPath,profile.configPath,config.databasePath,config.usage.root].map(canonicalHostPath));
  if (privatePaths.some(path => overlaps(source,path))) rearmFail('invalid_input');
}

export async function executeRearm(profilePath,value,operation,deps = {},statusCall = false) {
  let record,identity,opened,bytes;
  const outcome = (status,reason = null) => rearmResult(statusCall,status,reason,record?.revision ?? 0,record?.phase === 'pending');
  try {
    let request,selection;
    if (!statusCall) { request = rearmRequest(value); selection = hostSelection({ sessionId:request.sessionId,sourcePath:request.sourcePath },false); }
    let profile = await readHostProfile(profilePath);
    const work = async () => {
      operation.check(); profile = await readHostProfile(profilePath); record = await readGlobalRearm(profile);
      let files = await snapshot(profile), config = files.config;
      if (!record) {
        await readHostConfiguration(profile);
        if (await inspectPreparation(profile,config) !== 'ready') rearmFail('preparation_required');
      } else assertBindings(profile,files,record);
      if (statusCall) return outcome(record?.phase === 'pending' ? 'waiting':'ready',record?.phase === 'pending' ? 'rearm_pending':null);
      const matching = record && record.action.actionId === request.actionId;
      if (record?.phase === 'pending' && (!matching || request.expectedRevision !== record.revision)) rearmFail('action_conflict');
      if (record?.phase !== 'pending' && !(matching && request.expectedRevision === record.action.expectedRevision) &&
        request.expectedRevision !== (record?.revision ?? 0)) rearmFail('stale_revision');
      if (matching && request.expectedRevision !== record.action.expectedRevision) rearmFail('action_conflict');
      if (!matching && (record?.revision ?? 0) === Number.MAX_SAFE_INTEGER) rearmFail('revision_exhausted');
      const fresh = await readRearmAuthority(config); operation.check();
      const resuming = matching;
      const oldAuthority = resuming ? record.transition.predecessorAuthority:config.authority;
      const options = { stateRoot:profile.stateRoot,identityKeyPath:profile.identityKeyPath,authority:localAuthorityInput(oldAuthority) };
      identity = await loadIdentity(options,selection,operation);
      if (resuming && keyed(identity,'request',request) !== record.action.requestCommitment) rearmFail('action_conflict');
      await bindRoot(options,identity,false,operation);
      return stateLock(identity.lockPath,async () => {
        operation.check();
        let cursorText = await privateRead(identity.cursorPath), rawCursor = JSON.parse(cursorText), previousReceipt;
        let predecessor = oldAuthority;
        if (!resuming && rawCursor.authorityCommitment !== identity.authorityCommitment) {
          if (!record || record.phase !== 'ready' || !same(fresh,record.transition.authority)) rearmFail('rearm_refused');
          predecessor = record.transition.predecessorAuthority;
          identity.authorityCommitment = authorityCommitment(identity,predecessor);
        }
        const adopted = { ...identity,authorityCommitment:authorityCommitment(identity,resuming ? record.transition.authority:fresh) };
        const currentIdentity = rawCursor.authorityCommitment === adopted.authorityCommitment ? adopted:identity;
        let cursor = await readSession(currentIdentity,profile.installation.client,resuming);
        if (!cursor) rearmFail('rearm_refused');
        if (!resuming) {
          previousReceipt = await assertSessionRearm(identity,cursor);
          if (!record && (previousReceipt || cursor.rearmRevision !== undefined)) rearmFail('rearm_invalid');
          if ((previousReceipt?.revision ?? 0) > (record?.revision ?? 0) || (cursor.rearmRevision ?? 0) > (record?.revision ?? 0)) rearmFail('rearm_invalid');
          if (cursor.authorityCommitment === adopted.authorityCommitment ||
            cursor.blockedReason !== null && !(cursor.pending && cursor.blockedReason === 'authority_changed') ||
            cursor.pending && (cursor.pending.projection.part.index === 0 || cursor.pending.attempts >= 4)) rearmFail('rearm_refused');
        }
        if (resuming && !same(fresh,record.transition.authority)) rearmFail('authority_changed');
        await sourcePaths(profile,config,selection);
        const context = await qualifiedContext(profile,selection,fresh,operation,deps);
        bytes = sourceBudget(operation); opened = await openWorkerSource(context,operation,bytes);
        await qualifySource({ authority:config.authority },context,opened,operation);
        await verifyCursorSource(identity,opened,cursor); operation.check();
        if (!resuming) {
          let selected,firstBatch;
          try {
            if (cursor.pending) {
              const projection = cursor.pending.projection;
              selected = await prepareRawRecord(producerInput({ authority:predecessor },identity,context,opened.source,
                projection.range,projection.messageOrdinal,cursor.selection),producerOptions(identity,operation));
              if (selected.disposition !== 'selected') rearmFail('rearm_refused');
              await restoreRawBatch({ message:selected.message,projectId:predecessor.namespace.projectId || null,
                pending:{ ...projection,sessionId:context.sessionId,messageId:selected.message.metadata.id,
                  projectId:predecessor.namespace.projectId || null,occurredAt:selected.message.metadata.occurredAt } });
              firstBatch = await planRawBatch({ message:selected.message,projectId:predecessor.namespace.projectId || null,position:{ index:0,start:0 } });
            }
            await inspectRearmBoundary(config,identity,cursor,{ metadata:selected?.message.metadata ?? null,firstBatch,oldAuthority:predecessor,
              pendingPart:cursor.pending?.projection.part ?? null },previousReceipt);
          } finally { await selected?.message?.close(); }
          const eof = await sourceSize(opened);
          if (!await completeBoundary(opened,eof)) rearmFail('partial_record');
          const revision = (record?.revision ?? 0)+1;
          const replacementCursor = { ...clone(cursor),authorityCommitment:adopted.authorityCommitment,offset:eof,
            source:await cursorSource(identity,opened,eof),selection:config.authority.client === 'claude-code'
              ? { ownSkillTurn:true,awaitingUserBoundary:true }:{},pending:null,blockedReason:null,rearmRevision:revision };
          validateCursor(replacementCursor,adopted,config.authority.client);
          const frozen = frozenFiles(profile,files,fresh), root = await checkedPath(profile.stateRoot,{ directory:true });
          const transition = record && same(record.transition.authority,fresh) ? record.transition:
            { revision,predecessorAuthority:predecessor,authority:fresh,nonAuthorityConfigCommitment:nonAuthorityCommitment(config),
              installationCommitment:installationCommitment(profile) };
          const action = sessionRecord({ version:'local-raw-session-rearm-v1',phase:'pending',expectedRevision:request.expectedRevision,
            revision,actionId:request.actionId,requestCommitment:keyed(identity,'request',request),transitionRevision:transition.revision,
            sessionKey:identity.sessionKey,wireSessionId:identity.wireSessionId,keyCommitment:identity.keyCommitment,
            rootDevice:String(root.dev),rootInode:String(root.ino),oldAuthorityCommitment:identity.authorityCommitment,
            authorityCommitment:adopted.authorityCommitment,nonAuthorityConfigCommitment:transition.nonAuthorityConfigCommitment,
            oldCursorDigest:sha(cursorText),replacementCursorDigest:sha(JSON.stringify(replacementCursor)),replacementCursor,files:frozen.files });
          const next = globalRecord({ version:'local-raw-rearm-state-v1',phase:'pending',revision:revision-1,transition,action });
          encodeRecord(next); encodeRecord({ ...next,phase:'ready',revision,action:{ ...action,phase:'committed' } });
          if (!same(await readRearmAuthority(config),fresh)) rearmFail('authority_changed');
          const finalProfile = await readHostProfile(profilePath), finalFiles = await snapshot(finalProfile);
          if (sha(finalFiles.configText) !== sha(files.configText) || sha(finalFiles.profileText) !== sha(files.profileText) ||
            sha(finalFiles.preparationText) !== sha(files.preparationText)) rearmFail('rearm_invalid');
          await checkRearmSession(config,identity);
          operation.check(); await writeRearmRecord(profile.rearmPath,next); record = next;
        }
        const action = record.action;
        if (identity.sessionKey !== action.sessionKey || identity.wireSessionId !== action.wireSessionId ||
          identity.keyCommitment !== action.keyCommitment || identity.authorityCommitment !== action.oldAuthorityCommitment ||
          adopted.authorityCommitment !== action.authorityCommitment) rearmFail('rearm_invalid');
        validateCursor(action.replacementCursor,adopted,config.authority.client);
        const root = await checkedPath(profile.stateRoot,{ directory:true });
        if (String(root.dev) !== action.rootDevice || String(root.ino) !== action.rootInode) rearmFail('rearm_invalid');
        const prove = async () => {
          operation.check(); if (!same(await readRearmAuthority(config),record.transition.authority)) rearmFail('authority_changed');
          let freshSource;
          try { freshSource = await openWorkerSource(context,operation,bytes);
            await verifyCursorSource(identity,freshSource,action.replacementCursor);
            await verifyCursorSource(identity,freshSource,cursor); }
          finally { await freshSource?.close(); }
          await checkRearmSession(config,identity); operation.check();
        };
        await prove();
        let receipt = await readSessionRearm(identity);
        if (receipt?.revision === action.revision && !actionSame(receipt,action)) rearmFail('rearm_invalid');
        const terminal = receipt?.revision === action.revision && receipt.phase === 'committed';
        if (record.phase === 'ready' && !terminal) rearmFail('rearm_invalid');
        if (terminal) {
          await assertSessionRearm(adopted,cursor);
        } else {
          cursorText = await privateRead(identity.cursorPath);
          if (![action.oldCursorDigest,action.replacementCursorDigest].includes(sha(cursorText))) rearmFail('rearm_invalid');
          if (!receipt && (sha(cursorText) !== action.oldCursorDigest || cursor.rearmRevision !== undefined)) rearmFail('rearm_invalid');
          if (receipt && receipt.revision !== action.revision && (receipt.phase !== 'committed' || sha(cursorText) !== action.oldCursorDigest)) rearmFail('rearm_invalid');
          if (!receipt || receipt.revision !== action.revision) {
            if (receipt) await assertSessionRearm(identity,cursor);
            operation.check(); await writeRearmRecord(sessionRearmPath(identity),action);
          }
          await prove();
          if (sha(cursorText) === action.oldCursorDigest) {
            operation.check(); await writeCursor(adopted,action.replacementCursor); cursor = clone(action.replacementCursor);
          }
          if (sha(await privateRead(identity.cursorPath)) !== action.replacementCursorDigest) rearmFail('rearm_invalid');
          await prove();
          receipt = { ...action,phase:'committed' }; await writeRearmRecord(sessionRearmPath(identity),receipt);
        }
        // A terminal receipt makes cursor publication permanently non-repeatable.
        // Direct workers may already progress under a fresh global configuration.
        files = await snapshot(profile); assertBindings(profile,files,record);
        const frozen = frozenFiles(profile,files,record.transition.authority);
        for (const [path,text,oldDigest,newDigest] of [
          [profile.configPath,frozen.configText,action.files.oldConfigDigest,action.files.configDigest],
          [profile.profilePath,frozen.profileText,action.files.oldProfileDigest,action.files.profileDigest],
          [profile.markerPath,frozen.preparationText,action.files.oldPreparationDigest,action.files.preparationDigest],
        ]) {
          if (sha(text) !== newDigest) rearmFail('rearm_invalid');
          const actual = sha(await privateRead(path));
          if (actual !== newDigest) { if (actual !== oldDigest) rearmFail('rearm_invalid'); await prove(); await privateWrite(path,text); }
          if (sha(await privateRead(path)) !== newDigest) rearmFail('rearm_invalid');
        }
        if (record.phase !== 'ready') {
          await prove();
          const ready = { ...record,phase:'ready',revision:action.revision,action:{ ...action,phase:'committed' } };
          await writeRearmRecord(profile.rearmPath,ready); record = ready;
        }
        return outcome('ready',resuming ? 'replayed':'rearmed');
      });
    };
    return statusCall ? await work():await stateLock(profile.lockPath,work);
  } catch (error) {
    let reason = error.message === 'state_busy' ? 'state_busy':error.reason ?? 'rearm_invalid';
    if (error.code?.startsWith('raw_source_')) reason = sourceReason(error,bytes ?? { exhausted:false });
    try { operation.check(); } catch (stopped) { reason = stopped.reason; }
    const known = ['stale_revision','action_conflict','rearm_invalid','rearm_refused','revision_exhausted','preparation_required',
      'preparation_invalid','profile_invalid','config_invalid','store_invalid','authority_changed','capture_disabled','runtime_unavailable',
      'host_unavailable','host_unqualified','source_unqualified','invalid_input','cancelled','work_limit','unexpected_failure',
      'source_changed','source_unavailable','partial_record','state_invalid','key_invalid','state_busy'];
    return rearmResult(statusCall,reason === 'state_busy' ? 'busy':'blocked',known.includes(reason) ? reason:'rearm_invalid',
      record?.revision ?? null,record ? record.phase === 'pending':null);
  } finally {
    try { await opened?.close(); }
    finally { identity?.key.fill(0); }
  }
}
