import { prepareRawRecord, verifyRawRecordSource } from '../../integrations/client/raw/message.mjs';
import { planRawBatch, restoreRawBatch } from '../../integrations/client/raw/planner.mjs';
import { scanRawRecordRanges } from '../../integrations/client/raw/bounds.mjs';
import { fault } from './capture-input.mjs';
import { validateCursor, writeCursor } from './capture-state.mjs';
import { RECORD_LIMIT, openWorkerSource, producerInput, producerOptions, sourceSize, verifyCursorSource, anchor, sourceReason }
  from './capture-source.mjs';

function selectionAfter(client, cursor, selected) {
  if (client === 'codex') return {};
  const { ownSkillTurn } = selected.nextSelectionState;
  return { ownSkillTurn, awaitingUserBoundary: cursor.selection.awaitingUserBoundary && ownSkillTurn };
}

async function captureMessage(message) {
  const { id, role, occurredAt, totalUnits } = message.metadata;
  // One admission keeps the producer's message identity intact for legacy
  // UUID fences, including an ancestor captured in a different namespace.
  if (totalUnits > 20_000) fault('record_limit');
  const parts = [];
  for (let start = 0; start < totalUnits;) {
    const part = await message.readPart({ start, maxUnits: 4000 });
    parts.push(part.text);
    start = part.end;
  }
  return { id, role, occurredAtMs: occurredAt === null ? null : Date.parse(occurredAt), content: parts.join('') };
}

export async function advanceCapture({ options, identity, context, opened, cursor, operation, bytes, dispatch }) {
  const { client, namespace } = options.authority;
  const projectId = namespace.projectId || null;
  if (cursor.blockedReason) return { status: 'blocked', reason: cursor.blockedReason };
  let selected, scan, advanced = false;
  const save = async next => {
    validateCursor(next, identity, client);
    await writeCursor(identity, next);
    Object.assign(cursor, next);
  };
  async function prove(binding, expected, end) {
    const fresh = await openWorkerSource(context, operation, bytes);
    try {
      await verifyCursorSource(identity, fresh, cursor);
      await verifyRawRecordSource({ ...binding, source: fresh.source }, producerOptions(identity, operation), expected);
      return await anchor(identity, fresh, end);
    } finally { await fresh.close(); }
  }
  try {
    const scanEnd = Math.min(await sourceSize(opened), cursor.offset + RECORD_LIMIT);
    let dispatched = 0;
    for (let records = 0; records < 64 && dispatched < 32; records++) {
      operation.check();
      const pending = cursor.pending;
      if (pending?.state === 'blocked') return { status: 'blocked', reason: 'capture_refused' };
      if (pending?.nextEligibleAt > Date.now()) return { status: 'waiting', reason: pending.state };
      if (pending?.attempts >= 4 || pending?.projection.part.index > 0) fault('capture_refused');
      let range = pending?.projection.range;
      if (!range) {
        const { limits, signal } = producerOptions(identity, operation);
        scan ??= scanRawRecordRanges({ source: opened.source, start: cursor.offset, end: scanEnd }, { limits, signal });
        const next = await scan.next();
        if (next.done) return { status: advanced ? 'progress' : 'ready' };
        range = next.value;
      }
      if (range.start !== cursor.offset || range.end - range.start > RECORD_LIMIT) fault('record_limit');
      const binding = producerInput(options, identity, context, opened.source, range,
        pending ? pending.projection.messageOrdinal : cursor.issuedOrdinal + 1, cursor.selection);
      selected = await prepareRawRecord(binding, producerOptions(identity, operation));
      if (selected.disposition === 'excluded') {
        if (pending) fault('source_changed');
        const source = { ...cursor.source, anchor: await prove(binding, selected.sourceIdentity, range.end) };
        await save({ ...cursor, offset: range.end, source, selection: selectionAfter(client, cursor, selected) });
        selected = undefined;
        advanced = true;
        continue;
      }
      const { message } = selected;
      const input = await captureMessage(message);
      const batch = pending ? await restoreRawBatch({ message, projectId, pending: { ...pending.projection,
        sessionId: context.sessionId, messageId: message.metadata.id, projectId, occurredAt: message.metadata.occurredAt } })
        : await planRawBatch({ message, projectId, position: { index: 0, start: 0 } });
      if (bytes.remaining < range.end - range.start + (client === 'codex' ? 65537 : 0) + 8192 ||
          operation.remaining() < 3000) return { status: 'waiting', reason: 'work_limit' };
      const { sessionId, messageId, projectId: _, occurredAt, ...projection } = batch.pending;
      const started = Math.max(Date.now(), pending?.lastAttemptAt ?? 0);
      await save({ ...cursor, issuedOrdinal: projection.messageOrdinal, pending: { projection,
        attempts: (pending?.attempts ?? 0) + 1, state: 'dispatched', lastAttemptAt: started, nextEligibleAt: started + 280000 } });
      // Source proof immediately before admission and again after completion.
      const expected = message.metadata.sourceIdentity;
      await prove(binding, expected, cursor.offset);
      const result = await dispatch({ client, sessionId: identity.wireSessionId, eventId: projection.eventId }, input, !!pending);
      dispatched++;
      if (result.status !== 'done') {
        if (result.status === 'busy') {
          await save({ ...cursor, pending: { projection, attempts: 0, state: 'prepared', lastAttemptAt: null, nextEligibleAt: null } });
        } else if (result.status === 'processing') {
          const closedAt = Math.max(Date.now(), started);
          await save({ ...cursor, pending: { ...cursor.pending, state: 'processing', nextEligibleAt: closedAt + 125000 } });
        } else fault(result.reason ?? 'capture_refused');
        return { status: 'waiting', reason: result.status };
      }
      const source = { ...cursor.source, anchor: await prove(binding, expected, range.end) };
      await save({ ...cursor, source, offset: range.end, pending: null, selection: selectionAfter(client, cursor, selected) });
      advanced = true;
      await message.close();
      selected = undefined;
      if (pending?.attempts) return { status: 'progress' };
    }
    return { status: 'waiting', reason: 'work_limit' };
  } catch (error) {
    const reason = sourceReason(error, bytes);
    if (['cancelled', 'work_limit'].includes(reason) && cursor.pending?.state === 'dispatched') {
      const nextEligibleAt = Math.max(Date.now(), cursor.pending.lastAttemptAt) + 125000;
      await save({ ...cursor, pending: { ...cursor.pending, state: 'uncertain', nextEligibleAt } });
    }
    if (['partial_record', 'cancelled', 'work_limit'].includes(reason)) return { status: 'waiting', reason };
    if (reasonsForCursor.has(reason)) await save({ ...cursor, blockedReason: reason, pending: cursor.pending &&
      { ...cursor.pending, state: cursor.pending.attempts ? 'blocked' : 'prepared' } });
    return { status: 'blocked', reason };
  } finally { await selected?.message?.close(); await scan?.return(); }
}
const reasonsForCursor = new Set(['state_invalid', 'authority_changed', 'source_changed', 'source_unavailable', 'record_limit', 'capture_refused']);
