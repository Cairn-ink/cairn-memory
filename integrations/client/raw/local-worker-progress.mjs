import { createLocalCaptureTransport } from './local-transport.mjs';
import { prepareRawRecord, verifyRawRecordSource } from './message.mjs';
import { planRawBatch, restoreRawBatch } from './planner.mjs';
import { scanRawRecordRanges } from './bounds.mjs';
import { classifyRawAcknowledgement } from './protocol.mjs';
import { fault, integer, summary } from './local-worker-input.mjs';
import { validateCursor, writeCursor } from './local-worker-state.mjs';
import { RECORD_LIMIT, openWorkerSource, producerInput, producerOptions, sourceSize, verifyCursorSource, anchor, sourceReason } from './local-worker-source.mjs';

const clone = value => structuredClone(value);
const project = options => options.authority.namespace.projectId || null;
const projection = pending => {
  const { sessionId, messageId, projectId, occurredAt, ...opaque } = pending;
  return clone(opaque);
};
const preparedPending = pending => ({ projection:projection(pending),attempts:0,nextEligibleAt:null,lastAttemptAt:null,state:'prepared' });
const afterSelection = (options, cursor, selected) => options.authority.client === 'claude-code'
  ? { ownSkillTurn:selected.nextSelectionState.ownSkillTurn,
    awaitingUserBoundary:cursor.selection.awaitingUserBoundary && selected.nextSelectionState.ownSkillTurn } : {};
function timestamp(previous = 0) {
  const now = Math.max(previous ?? 0,Date.now());
  if (!integer(now) || !integer(now+280000)) fault('state_invalid');
  return now;
}

// The caller owns the per-session lock and source handle for this entire run.
export async function runProgress({ options,identity,context,opened,cursor,operation,bytes }) {
  const initialOffset = cursor.offset, counts = { completedRecords:0,completedParts:0,dispatchedParts:0,savedParts:0,skippedParts:0 };
  let scan, scanStart, scanEnd, selected, binding, range, batch, recovery = false, persistenceFault = false;
  const finish = (status,reason,remainingWork = false) => summary(status,reason,cursor,
    { ...counts,bytesAdvanced:cursor.offset-initialOffset,remainingWork });
  const persist = async next => {
    validateCursor(next,identity,options.authority.client);
    // A failed write may already have renamed/fsynced the new cursor. Never
    // overwrite that unknown durable outcome with our older in-memory state.
    try { await writeCursor(identity,next); }
    catch { persistenceFault = true; fault('state_invalid'); }
    Object.assign(cursor,next);
  };
  const block = async reason => {
    const next = clone(cursor); next.blockedReason = reason;
    if (next.pending?.attempts > 0) next.pending.state = 'blocked';
    await persist(next); return finish('blocked',reason,true);
  };
  const prove = async (expected, end) => {
    let fresh;
    try {
      operation.check(); fresh = await openWorkerSource(context,operation,bytes);
      await verifyCursorSource(identity,fresh,cursor);
      await verifyRawRecordSource({ ...binding,source:fresh.source },producerOptions(identity,operation),expected);
      const result = end === cursor.offset ? cursor.source.anchor : await anchor(identity,fresh,end);
      operation.check(); return result;
    } finally { await fresh?.close(); }
  };
  const availableProof = () => bytes.remaining >= range.end-range.start+(options.authority.client === 'codex' ? 65537 : 0)+8192;
  try {
    if (cursor.blockedReason) return finish('blocked',cursor.blockedReason,true);
    while (counts.completedRecords < 64 && counts.dispatchedParts < 32) {
      operation.check();
      if (!selected) {
        if (cursor.pending) {
          recovery = cursor.pending.attempts > 0;
          if (cursor.pending.state === 'blocked') return finish('blocked',cursor.blockedReason ?? 'capture_refused',true);
          if (cursor.pending.attempts >= 4) return await block('recovery_exhausted');
          if (cursor.pending.nextEligibleAt !== null && Date.now() < cursor.pending.nextEligibleAt)
            return finish('waiting',cursor.pending.state === 'processing' ? 'processing' : 'uncertain',true);
          range = clone(cursor.pending.projection.range);
          binding = producerInput(options,identity,context,opened.source,range,cursor.pending.projection.messageOrdinal,cursor.selection);
          selected = await prepareRawRecord(binding,producerOptions(identity,operation));
          if (selected.disposition !== 'selected') fault('source_changed');
          const pending = { ...clone(cursor.pending.projection),sessionId:context.sessionId,messageId:selected.message.metadata.id,
            projectId:project(options),occurredAt:selected.message.metadata.occurredAt };
          batch = await restoreRawBatch({ message:selected.message,projectId:project(options),pending });
        } else {
          if (!scan) {
            scanStart = cursor.offset;
            scanEnd = Math.min(await sourceSize(opened),scanStart+RECORD_LIMIT);
            const { limits,signal } = producerOptions(identity,operation);
            scan = scanRawRecordRanges({ source:opened.source,start:scanStart,end:scanEnd },{ limits,signal });
          }
          let record;
          try { record = await scan.next(); }
          catch (error) {
            if (error.code === 'raw_source_incomplete') {
              const actualEnd = await sourceSize(opened);
              if (scanEnd < actualEnd) return cursor.offset === scanStart ? await block('record_limit') : finish('waiting','work_limit',true);
              return finish('waiting','partial_record',true);
            }
            throw error;
          }
          if (record.done) break;
          range = record.value;
          if (range.start !== cursor.offset || range.end-range.start > RECORD_LIMIT) return await block('record_limit');
          binding = producerInput(options,identity,context,opened.source,range,cursor.issuedOrdinal+1,cursor.selection);
          selected = await prepareRawRecord(binding,producerOptions(identity,operation));
          if (selected.disposition === 'excluded') {
            if (!availableProof()) return finish('waiting','work_limit',true);
            const next = clone(cursor), sourceAnchor = await prove(selected.sourceIdentity,range.end);
            next.offset = range.end; next.source.anchor = sourceAnchor; next.selection = afterSelection(options,cursor,selected);
            await persist(next); counts.completedRecords++; selected = undefined; continue;
          }
          batch = await planRawBatch({ message:selected.message,projectId:project(options),position:{ index:0,start:0 } });
          const next = clone(cursor); next.issuedOrdinal++; next.pending = preparedPending(batch.pending);
          await persist(next);
        }
      }
      if (!availableProof() || operation.remaining() < 3000) return finish('waiting','work_limit',true);
      operation.check();
      const startedAt = timestamp(cursor.pending.lastAttemptAt), dispatch = clone(cursor);
      dispatch.pending.attempts++; dispatch.pending.lastAttemptAt = startedAt;
      dispatch.pending.nextEligibleAt = startedAt+280000; dispatch.pending.state = 'dispatched';
      await persist(dispatch);
      let response;
      try {
        operation.check();
        const remaining = operation.remaining();
        if (remaining < 3000) fault('work_limit');
        const transport = createLocalCaptureTransport({ ...options.transport,deadlineMs:remaining });
        counts.dispatchedParts++;
        response = await transport.capture(batch.body,{ signal:operation.signal });
      } catch (error) {
        const next = clone(cursor), uncertain = error.uncertain === true;
        next.pending.state = uncertain ? 'uncertain' : 'unavailable';
        next.pending.nextEligibleAt = uncertain ? timestamp(next.pending.lastAttemptAt)+125000 : null;
        await persist(next);
        let reason = error.reason === 'cancelled' || error.reason === 'work_limit' ? error.reason : uncertain ? 'uncertain' : 'unavailable';
        try { operation.check(); } catch (stopped) { reason = stopped.reason; }
        return finish(uncertain || ['cancelled','work_limit'].includes(reason) ? 'waiting' : 'blocked',reason,true);
      }
      const closedAt = timestamp(cursor.pending.lastAttemptAt), observed = clone(cursor);
      observed.pending.nextEligibleAt = closedAt+125000;
      await persist(observed);
      if (response.status === 202 || response.status === 200 && response.body.processing === true) {
        const next = clone(cursor); next.pending.state = 'processing'; await persist(next); return finish('waiting','processing',true);
      }
      if (response.status === 429) return await block('quota_reached');
      if (response.status !== 200) return await block(response.body.error === 'interpretation_incomplete' ? 'interpretation_incomplete'
        : ['capture_disabled','capture_evidence_closed','revision_conflict'].includes(response.body.error) ? 'authority_changed' : 'capture_refused');
      if (classifyRawAcknowledgement(response.status,response.body,batch.body).disposition !== 'complete') fault('uncertain');
      counts.savedParts += response.body.raw.parts.filter(part => part.saved).length;
      counts.skippedParts += response.body.raw.parts.filter(part => !part.saved).length;
      const final = batch.nextPosition === null;
      const sourceAnchor = await prove(selected.message.metadata.sourceIdentity,final ? range.end : cursor.offset), next = clone(cursor);
      if (final) {
        next.offset = range.end; next.source.anchor = sourceAnchor; next.selection = afterSelection(options,cursor,selected); next.pending = null;
      } else {
        batch = await planRawBatch({ message:selected.message,projectId:project(options),position:batch.nextPosition });
        next.pending = preparedPending(batch.pending);
      }
      await persist(next); counts.completedParts++;
      if (final) { counts.completedRecords++; await selected.message.close(); selected = undefined; }
      if (recovery) return finish('progress',null,cursor.pending !== null || cursor.offset < await sourceSize(opened));
    }
    const remaining = cursor.pending !== null || cursor.offset < await sourceSize(opened);
    return finish(remaining ? 'waiting' : counts.completedRecords || counts.completedParts ? 'progress' : 'ready',
      remaining ? 'work_limit' : cursor.selection.awaitingUserBoundary ? 'awaiting_user_boundary' : null,remaining);
  } catch (error) {
    if (persistenceFault) return finish('blocked','state_invalid',true);
    let reason = sourceReason(error,bytes);
    try { operation.check(); } catch (deadline) { reason = deadline.reason; }
    if (reason === 'work_limit' || reason === 'cancelled') {
      if (cursor.pending?.state === 'dispatched') {
        const next = clone(cursor); next.pending.state = 'uncertain'; await persist(next);
      }
      return finish('waiting',reason,true);
    }
    if (error.code === 'raw_source_resource_limit') reason = 'record_limit';
    return await block(reason);
  } finally { await selected?.message?.close(); await scan?.return(); }
}
