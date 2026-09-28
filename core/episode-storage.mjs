import { createHmac, randomUUID } from 'node:crypto';
import { transaction, isStorageBusy } from './database.mjs';
import { ADMISSION_LEASE_MS, HEX_DIGEST } from './episode-schema.mjs';
import { boundedText, denseArray, fail, identifier, object, revision } from './validation.mjs';
import { sourceDigest, sourceSpan } from './procedural-storage.mjs';

const GAP_CODES = new Set(['forgotten', 'discarded', 'expired', 'capacity', 'omitted',
  'episode_failed', 'episode_timeout', 'invalid_model_output', 'context_budget_exceeded',
  'generation_conflict', 'missing_evidence']);

const where = 'owner_id=? AND scope=? AND project_id=?';
const boundary = ns => [ns.ownerId, ns.scope, ns.projectId];
const eventWhere = `${where} AND client=? AND event_id=?`;
const eventKey = (ns, input) => [...boundary(ns), input.client, input.eventId];
const iso = () => new Date().toISOString();
const types = ['work', 'research', 'meeting', 'diary', 'quick-one-off-question'];
const fields = ['gist', 'outcome', 'nextStep'];
export function episodeText(value, max) {
  if (typeof value !== 'string' || !value.isWellFormed() || value.length > max) fail('invalid_input');
  return boundedText(value, max);
}
export function episodeOptions(value) {
  object(value, ['mode', 'draftEveryBatches']);
  if (value.mode !== 'episode-v1') fail('invalid_input');
  const draftEveryBatches = Object.hasOwn(value,'draftEveryBatches') ? value.draftEveryBatches : 8;
  if (!Number.isInteger(draftEveryBatches) || draftEveryBatches < 2 || draftEveryBatches > 16) fail('invalid_input');
  return Object.freeze({ mode: 'episode-v1', draftEveryBatches });
}
export function episodeClient(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9._-]{1,64}$/.test(value)) fail('invalid_input');
  return value;
}
function instant(value) {
  if (value === null) return value;
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) ||
      !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) fail('invalid_input');
  return value;
}
const blank = label => ({ clientLabel: label, eventStart: null, eventEnd: null, eventTimeCoverage: 'unknown',
  interpretedAt: null, type: null, language: null, gist: null, outcome: null, nextStep: null,
  anchors: {}, modelMetadata: null, semanticSupport: 'unassessed', editor: {},
  processing: { state: 'pending', missing: 0, expired: 0, omitted: 0, errorCode: null } });

/** All write seams are model-free. SE-2 owns scheduling and provider calls. */
export function createEpisodeStorage({ db, options, stagedEvidence, advanceEpoch, epoch, forgetMutation }) {
  const read = (ns, id) => db.prepare(`SELECT * FROM session_episodes WHERE ${where} AND id=?`)
    .get(...boundary(ns), id);
  const event = (ns, input) => input.keepActionId ? null : db.prepare(`SELECT * FROM episode_events WHERE ${eventWhere}`)
    .get(...eventKey(ns, input));
  function secret() {
    const value = db.prepare('SELECT secret FROM episode_identity WHERE singleton=1').get()?.secret;
    if (typeof value !== 'string' || !HEX_DIGEST.test(value)) fail('episode_identity_unavailable');
    return value;
  }
  if (options) secret();
  function sessionKey(ns, client, sessionId) {
    episodeClient(client); identifier(sessionId);
    return `s1:${createHmac('sha256', Buffer.from(secret(), 'hex'))
      .update(JSON.stringify(['episode-v1', ...boundary(ns), client, sessionId])).digest('hex')}`;
  }
  function messageLedger(messages) {
    const key = Buffer.from(secret(), 'hex');
    return denseArray(messages, 1, 24).map(message => {
      object(message, ['id', 'role', 'content', 'occurredAt']);
      if (!['user', 'assistant'].includes(message.role) || typeof message.content !== 'string' ||
          !message.content.isWellFormed() || !message.content.length || message.content.length > 20000 ||
          !Object.hasOwn(message, 'occurredAt')) fail('invalid_input');
      const time = instant(message.occurredAt);
      return { id: identifier(message.id), digest: createHmac('sha256', key)
        .update(JSON.stringify(['m1', message.role, message.content, time])).digest('hex') };
    });
  }
  function messageCoverage(ns, row, client, ledger) {
    let unfinished = false;
    const fresh = ledger.filter(message => {
      const previous = row && db.prepare('SELECT digest,coverage_event_id FROM episode_messages WHERE episode_id=? AND message_id=?')
        .get(row.id, message.id);
      if (!previous) return true;
      if (previous.digest !== message.digest) fail('event_payload_conflict');
      const admission = db.prepare(`SELECT state,lease_expires_at FROM admission_claims WHERE ${eventWhere}`)
        .get(...boundary(ns), client, previous.coverage_event_id);
      if (admission?.state === 'completed') return false;
      const original = event(ns, { client, eventId: previous.coverage_event_id });
      // A stop/discard closes old ownership even if its lease has not expired.
      if (original && guard(ns, { client, eventId: previous.coverage_event_id,
        payloadDigest: original.payload_digest }) === 'capture_evidence_closed') return true;
      const active = admission?.lease_expires_at > Date.now();
      const evidence = db.prepare(`SELECT state,payload,expires_at FROM staged_capture_evidence WHERE ${eventWhere}`)
        .get(...boundary(ns), client, previous.coverage_event_id);
      const bypassResumable = original?.staging === 'not-staged' &&
        (admission?.state === 'reserved' || (admission?.state === 'pending' && admission.lease_expires_at > 0));
      const resumable = bypassResumable ||
        (evidence?.state === 'pending' && evidence.payload !== null && evidence.expires_at > Date.now());
      if (active || resumable) { unfinished = true; return false; }
      return true;
    });
    return { fresh, unfinished };
  }
  function control(ns) {
    return db.prepare(`SELECT * FROM episode_controls WHERE ${where}`).get(...boundary(ns));
  }
  function getControl(ns) {
    const row = control(ns);
    return { generation: row?.generation ?? 'initial', paused: row?.paused === 1, enabled: row?.enabled !== 0 };
  }
  function assertControl(ns, generation) {
    identifier(generation);
    const current = getControl(ns);
    if (current.generation !== generation) fail('generation_conflict');
    if (current.paused || !current.enabled) fail('capture_disabled');
  }
  function live(ns, id, expectedRevision) {
    const row = read(ns, identifier(id));
    if (!row || row.deleted) fail('episode_not_found');
    if (expectedRevision !== undefined && row.revision !== revision(expectedRevision)) fail('revision_conflict');
    return row;
  }
  function save(ns, row, record) {
    db.prepare('UPDATE session_episodes SET record=?,revision=revision+1,updated_at=? WHERE id=?')
      .run(JSON.stringify(record), iso(), row.id);
    advanceEpoch(ns);
  }
  function invalidate(ns, id) {
    const row = read(ns, id);
    if (!row || row.deleted) return;
    const record = blank(null); record.processing.state = 'invalidated';
    db.prepare('DELETE FROM episode_sources WHERE episode_id=?').run(id);
    db.prepare('UPDATE session_episodes SET source_fence=source_fence+1,writer_token=NULL,writer_expires_at=NULL WHERE id=?').run(id);
    save(ns, row, record);
  }
  function invalidateMemory(ns, memoryId) {
    const roots = db.prepare('SELECT episode_id FROM episode_memory_links WHERE memory_id=?').all(memoryId);
    for (const { episode_id: id } of roots) invalidateSources(ns, id);
  }
  function invalidateSources(ns, id) {
    // Capture consumers before deleting passages, including zero-memory episodes.
    const pending = [id], seen = new Set();
    while (pending.length) {
      const current = pending.pop();
      if (seen.has(current)) continue;
      seen.add(current);
      for (const row of db.prepare('SELECT DISTINCT episode_id FROM episode_sources WHERE origin_episode_id=?').all(current)) pending.push(row.episode_id);
    }
    for (const current of seen) invalidate(ns, current);
  }
  function setControl(ns, input, project = false) {
    if (!options) fail('episode_mode_required');
    if (project && ns.scope !== 'project') fail('invalid_input');
    return transaction(db, () => {
      if (getControl(ns).generation !== input.expectedGeneration) fail('generation_conflict');
      const previous = getControl(ns);
      const flag = project ? input.enabled : input.paused;
      if (typeof flag !== 'boolean') fail('invalid_input');
      const next = { ...previous, generation: randomUUID(), [project ? 'enabled' : 'paused']: flag };
      db.prepare(`INSERT INTO episode_controls(owner_id,scope,project_id,generation,paused,enabled) VALUES(?,?,?,?,?,?)
        ON CONFLICT(owner_id,scope,project_id) DO UPDATE SET generation=excluded.generation,paused=excluded.paused,enabled=excluded.enabled`)
        .run(...boundary(ns), next.generation, +next.paused, +next.enabled);
      if (project && !flag) {
        for (const registered of db.prepare(`SELECT client,event_id FROM episode_events WHERE ${where}
          AND (admission!='completed' OR disposition=0)`).all(...boundary(ns))) {
          mergeGap(ns, { client: registered.client, eventId: registered.event_id }, 'discarded');
        }
        db.prepare(`UPDATE staged_capture_evidence SET state='discarded',payload=NULL,payload_bytes=0
          WHERE ${where} AND event_mode='episode-v1' AND payload IS NOT NULL`).run(...boundary(ns));
        db.prepare(`UPDATE session_episodes SET source_fence=source_fence+1,writer_token=NULL,writer_expires_at=NULL WHERE ${where}`).run(...boundary(ns));
      }
      advanceEpoch(ns);
      return next;
    });
  }
  function guard(ns, input) {
    if (input.keepActionId) return keepGuard(ns, input);
    const registered = event(ns, input);
    if (!registered) return null;
    const row = read(ns, registered.episode_id);
    if (!row || row.deleted || ['forgotten','discarded'].includes(registered.gap)) return 'capture_evidence_closed';
    // Pause excludes new text, not an already registered request. Project stop is durable.
    const current = control(ns);
    if (current && !current.enabled) return 'capture_evidence_closed';
    const messageIds = JSON.parse(registered.message_ids);
    if (messageIds.length && messageIds.every(id => db.prepare(
      'SELECT coverage_event_id FROM episode_messages WHERE episode_id=? AND message_id=?')
      .get(row.id, id)?.coverage_event_id !== input.eventId)) return 'capture_evidence_closed';
    if (registered.payload_digest !== input.payloadDigest) return 'event_payload_conflict';
    return null;
  }
  function admissionStarted(ns,input) {
    const registered=event(ns,input); if (!registered) return;
    db.prepare(`UPDATE episode_events SET admission='pending' WHERE ${eventWhere}`).run(...eventKey(ns,input));
  }
  function reserveBatch(ns, input) {
    if (!options) fail('episode_mode_required');
    object(input, ['client','clientLabel','sessionId','eventId','payloadDigest','generation','view',
      'eventStart','eventEnd','eventTimeCoverage','writerToken','messages','acquireWriter']);
    episodeClient(input.client); identifier(input.eventId); identifier(input.sessionId);
    const label = episodeText(input.clientLabel, 80);
    if (!HEX_DIGEST.test(input.payloadDigest)) fail('invalid_input');
    const start = instant(input.eventStart ?? null), end = instant(input.eventEnd ?? null);
    const coverage = input.eventTimeCoverage ?? 'unknown';
    if (!['complete','partial','unknown'].includes(coverage) || (start && end && start > end) ||
      (coverage === 'complete' && (!start || !end)) || (coverage === 'unknown' && (start || end))) fail('invalid_input');
    const ledger = messageLedger(input.messages);
    stagedEvidence.serializeView(input.view, true); // Validate before registration, including overlaps.
    const identity = sessionKey(ns, input.client, input.sessionId);
    return transaction(db, () => {
      let row = db.prepare(`SELECT * FROM session_episodes WHERE ${where} AND client=? AND session_key=?`)
        .get(...boundary(ns), input.client, identity);
      if (row?.deleted) fail('capture_evidence_closed');
      const prior = event(ns, input);
      if (prior) {
        if (prior.episode_id !== row?.id || prior.payload_digest !== input.payloadDigest) fail('event_payload_conflict');
        const denied = guard(ns, input); if (denied) fail(denied);
        return { episodeId: row.id, sessionKey: identity, position: prior.position, staging: prior.staging, duplicate: true,
          messageIds: db.prepare('SELECT message_id FROM episode_messages WHERE episode_id=? AND coverage_event_id=?').all(row.id, input.eventId).map(value => value.message_id),
          ...(input.acquireWriter ? captureWriter(row) : {}) };
      }
      assertControl(ns, input.generation);
      if (db.prepare(`SELECT 1 FROM admission_claims WHERE ${eventWhere}`).get(...eventKey(ns, input))) fail('event_payload_conflict');
      const { fresh, unfinished } = messageCoverage(ns, row, input.client, ledger);
      if (!fresh.length) return { episodeId: row.id, sessionKey: identity, position: row.observed, overlap: true, processing: unfinished };
      const now = stagedEvidence.touch(ns, true), received = new Date(now).toISOString();
      db.prepare(`INSERT OR IGNORE INTO episode_controls(owner_id,scope,project_id,generation,paused,enabled) VALUES(?,?,?,'initial',0,1)`).run(...boundary(ns));
      db.prepare(`UPDATE episode_controls SET ordinal=ordinal+1 WHERE ${where}`).run(...boundary(ns));
      const ordinal = control(ns).ordinal;
      if (!row) {
        const id = randomUUID();
        db.prepare(`INSERT INTO session_episodes(id,owner_id,scope,project_id,client,session_key,revision,generation,draft_every,
          first_received_at,last_received_at,updated_at,record) VALUES(?,?,?,?,?,?,1,?,?,?,?,?,?)`)
          .run(id, ...boundary(ns), input.client, identity, input.generation, options.draftEveryBatches, received, received, received, JSON.stringify(blank(label)));
        row = read(ns, id);
      }
      const previousOwners = new Set();
      for (const message of fresh) {
        const previous = db.prepare('SELECT coverage_event_id FROM episode_messages WHERE episode_id=? AND message_id=?')
          .get(row.id, message.id);
        if (previous) previousOwners.add(previous.coverage_event_id);
        db.prepare(`INSERT INTO episode_messages VALUES(?,?,?,?,?)
          ON CONFLICT(episode_id,message_id) DO UPDATE SET coverage_event_id=excluded.coverage_event_id`)
          .run(row.id, message.id, message.digest, input.eventId, input.eventId);
      }
      for (const eventId of previousOwners) {
        const remaining = db.prepare('SELECT 1 FROM episode_messages WHERE episode_id=? AND coverage_event_id=?')
          .get(row.id, eventId);
        const evidence = db.prepare(`SELECT state FROM staged_capture_evidence WHERE ${eventWhere}`)
          .get(...boundary(ns), input.client, eventId);
        // Failed staging remains closed. Make any leftover, unadmittable evidence
        // visible without restoring its payload or weakening deletion/TTL fences.
        if (remaining && evidence?.state === 'failed') gap(ns, { client: input.client, eventId }, 'missing_evidence');
      }
      // Parent reservation always precedes both event and staging children.
      db.prepare(`INSERT INTO admission_claims(owner_id,scope,project_id,client,event_id,payload_digest,state) VALUES(?,?,?,?,?,?,'reserved')`)
        .run(...eventKey(ns, input), input.payloadDigest);
      const position = row.observed + 1;
      const messageIds = fresh.map(message => message.id);
      const selected = input.view.messages.flatMap((message, index) => messageIds.includes(message.id) ? [{ message, index }] : []);
      const serialized = stagedEvidence.serializeView({ ...input.view, messages: selected.map(item => item.message),
        retainedSourceWindow: { ...input.view.retainedSourceWindow, truncatedMessageIndices: selected.flatMap((item, index) =>
          input.view.retainedSourceWindow.truncatedMessageIndices.includes(item.index) ? [index] : []) } }, true);
      const staged = stagedEvidence.episodeCapacity(ns, serialized);
      db.prepare(`INSERT INTO episode_events(owner_id,scope,project_id,client,event_id,episode_id,payload_digest,position,ordinal,generation,staging,gap,gap_reasons,created_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(...eventKey(ns, input), row.id, input.payloadDigest, position, ordinal, input.generation,
          staged ? 'staged' : 'not-staged', staged ? null : 'capacity', staged ? '[]' : '["capacity"]', received);
      db.prepare(`UPDATE episode_events SET message_ids=? WHERE ${eventWhere}`).run(JSON.stringify(messageIds), ...eventKey(ns, input));
      if (staged) stagedEvidence.insert(ns, input, serialized, now, 'episode-v1');
      row = read(ns, row.id);
      const record = JSON.parse(row.record);
      record.eventStart = record.eventStart && start ? [record.eventStart,start].sort()[0] : record.eventStart ?? start;
      record.eventEnd = record.eventEnd && end ? [record.eventEnd,end].sort().at(-1) : record.eventEnd ?? end;
      record.eventTimeCoverage = row.observed === 0 ? coverage : record.eventTimeCoverage === coverage ? coverage : 'partial';
      if (!staged) { record.processing.missing++; record.processing.state = 'incomplete'; }
      db.prepare(`UPDATE session_episodes SET observed=?,last_received_at=?,generation=? WHERE id=?`).run(position, received, input.generation, row.id);
      save(ns, row, record);
      return { episodeId: row.id, sessionKey: identity, position, staging: staged ? 'staged' : 'not-staged', duplicate: false, messageIds,
        ...(input.acquireWriter ? captureWriter(read(ns, row.id)) : {}) };
    });
  }
  // Preserve all reasons and keep terminal fences stronger than diagnostic failures.
  function mergeGap(ns, input, reason) {
    if (!GAP_CODES.has(reason)) fail('invalid_input');
    const registered = event(ns, input);
    if (!registered) return false;
    const reasons = [...new Set([...JSON.parse(registered.gap_reasons), ...(registered.gap ? [registered.gap] : [])])];
    if (reasons.includes(reason)) return false;
    reasons.push(reason);
    const primary = ['forgotten','discarded','expired','capacity'].find(value => reasons.includes(value)) ?? reason;
    db.prepare(`UPDATE episode_events SET gap=?,gap_reasons=? WHERE ${eventWhere}`)
      .run(primary, JSON.stringify(reasons), ...eventKey(ns,input));
    return true;
  }
  function gap(ns, input, reason) {
    const registered = event(ns, input);
    if (!registered || !mergeGap(ns,input,reason)) return;
    const row = read(ns, registered.episode_id);
    if (!row || row.deleted) return;
    const record = JSON.parse(row.record);
    record.processing.state = record.gist ? 'incomplete' : 'pending';
    record.processing[reason === 'expired' ? 'expired' : 'missing']++;
    db.prepare('UPDATE session_episodes SET source_fence=source_fence+1 WHERE id=?').run(row.id);
    save(ns, row, record);
  }
  function setPolicy(ns,input) {
    object(input,['client','eventId','payloadDigest','policy','expectedRevision']);
    if (!['normal','skip-quick','explicit-keep'].includes(input.policy)) fail('invalid_input');
    return transaction(db,()=>{
      const registered=event(ns,input); if (!registered) fail('episode_not_found');
      const denied=guard(ns,input); if (denied) fail(denied);
      const row=live(ns,registered.episode_id),record=JSON.parse(row.record);
      if (registered.admission==='completed') fail('stale_admission');
      if (input.policy==='skip-quick') {
        if (row.revision!==revision(input.expectedRevision) || record.type!=='quick-one-off-question' || !registered.disposition || registered.staging!=='staged') fail('revision_conflict');
        const anchored=(record.anchors.type??[]).some(anchor=>db.prepare('SELECT 1 FROM episode_sources WHERE id=? AND episode_id=? AND event_id=?')
          .get(anchor.sourceId,row.id,input.eventId));
        if (!anchored) fail('invalid_input');
      }
      db.prepare(`UPDATE episode_events SET policy=?,policy_revision=?,policy_type=?,policy_at=? WHERE ${eventWhere}`)
        .run(input.policy,input.policy==='skip-quick'?row.revision:null,input.policy==='skip-quick'?record.type:null,iso(),...eventKey(ns,input));
      advanceEpoch(ns); return { policy:input.policy };
    });
  }
  function admitted(ns, input, entries) {
    const registered = event(ns, input);
    if (!registered) return keepAdmitted(ns,input,entries);
    db.prepare(`UPDATE episode_events SET admission='completed',policy_at=coalesce(policy_at,?) WHERE ${eventWhere}`).run(iso(),...eventKey(ns, input));
    for (const entry of entries) {
      const memory = db.prepare('SELECT revision FROM memories WHERE id=?').get(entry.memoryId);
      const receiptIds = (entry.item?.receipts ?? []).flatMap(receipt => db.prepare(
        'SELECT id FROM receipts WHERE memory_id=? AND client=? AND session_id=? AND event_id=?')
        .all(entry.memoryId, receipt.client, receipt.sessionId, receipt.eventId).map(row => row.id));
      db.prepare(`INSERT INTO episode_memory_links VALUES(?,?,?,?,?,?) ON CONFLICT(episode_id,event_id,memory_id) DO UPDATE SET
        admission_revision=excluded.admission_revision,receipt_ids=excluded.receipt_ids`)
        .run(randomUUID(), registered.episode_id, entry.memoryId, input.eventId, memory.revision, JSON.stringify(receiptIds));
    }
    advanceEpoch(ns);
  }
  function captureWriter(row) {
    const result = acquireWriter(row);
    return result.processing ? { draftProcessing: true } : result;
  }
  function acquireWriter(row) {
    if (row.writer_expires_at > Date.now() || db.prepare(
      'SELECT 1 FROM episode_attempts WHERE episode_id=? AND finished=0 AND expires_at>?')
      .get(row.id, Date.now())) return { processing: true };
    const expired = db.prepare('SELECT * FROM episode_attempts WHERE episode_id=? AND finished=0 AND expires_at<=?')
      .all(row.id, Date.now());
    const ns = { ownerId: row.owner_id, scope: row.scope, projectId: row.project_id };
    const record = JSON.parse(row.record);
    let failed = false;
    for (const claim of expired) {
      if (!claim.started) {
        db.prepare('DELETE FROM episode_attempts WHERE episode_id=? AND token=?').run(row.id, claim.token);
        continue;
      }
      failed = true;
      record.processing.state = record.gist ? 'incomplete' : 'failed';
      record.processing.errorCode = 'episode_timeout';
      for (const event of db.prepare('SELECT client,event_id FROM episode_events WHERE episode_id=? AND position<=? AND disposition=0')
        .all(row.id, claim.watermark)) {
        mergeGap(ns, { client: event.client, eventId: event.event_id }, 'episode_timeout');
      }
      db.prepare('UPDATE episode_attempts SET finished=1 WHERE episode_id=? AND token=?').run(row.id, claim.token);
    }
    if (failed) save(ns, row, record);
    const token = randomUUID();
    db.prepare('UPDATE session_episodes SET writer_token=?,writer_expires_at=? WHERE id=?')
      .run(token, Date.now() + ADMISSION_LEASE_MS, row.id);
    return { token };
  }
  function validateBatch(ns, input) {
    return transaction(db, () => {
      const identity = sessionKey(ns, input.client, input.sessionId);
      const row = db.prepare(`SELECT * FROM session_episodes WHERE ${where} AND client=? AND session_key=?`)
        .get(...boundary(ns), input.client, identity);
      if (row?.deleted) fail('capture_evidence_closed');
      const prior = event(ns, input);
      if (prior) {
        const denied = guard(ns, input);
        if (denied) fail(denied);
        if (prior.episode_id !== row?.id) fail('event_payload_conflict');
        return { duplicate: true };
      }
      assertControl(ns, input.generation);
      if (db.prepare(`SELECT 1 FROM admission_claims WHERE ${eventWhere}`).get(...eventKey(ns, input))) fail('event_payload_conflict');
      const { fresh, unfinished } = messageCoverage(ns, row, input.client, messageLedger(input.messages));
      return { overlap: fresh.length === 0, processing: fresh.length === 0 && unfinished, episodeId: row?.id };
    });
  }
  function claimWriter(ns, input) {
    return transaction(db, () => {
      assertControl(ns, input.generation);
      const row = live(ns, input.episodeId);
      return acquireWriter(row);
    });
  }
  function writer(row, token) {
    if (row.writer_token !== token || row.writer_expires_at <= Date.now()) fail('stale_episode');
  }
  function releaseWriter(ns, input) {
    return transaction(db, () => ({ released: Boolean(db.prepare(`UPDATE session_episodes SET writer_token=NULL,writer_expires_at=NULL
      WHERE ${where} AND id=? AND writer_token=?`).run(...boundary(ns), input.episodeId, input.token).changes) }));
  }
  function claimDraft(ns, input) {
    return transaction(db, () => {
      const row = live(ns, input.episodeId); writer(row, input.writerToken);
      if (!['batch','end','lazy'].includes(input.trigger) || !Number.isSafeInteger(input.watermark) || input.watermark < 1 || input.watermark > row.observed) fail('invalid_input');
      const marker = input.trigger === 'batch' ? `batch:${input.watermark}` : input.trigger;
      if (db.prepare('SELECT 1 FROM episode_attempts WHERE episode_id=? AND marker=?').get(row.id, marker)) return { consumed: true };
      const current = getControl(ns);
      if (!current.enabled) fail('capture_evidence_closed');
      if (input.trigger !== 'batch') assertControl(ns, input.generation);
      const skipReason = current.generation !== input.generation ? 'generation_conflict' : null;
      const token = randomUUID();
      db.prepare('INSERT INTO episode_attempts(episode_id,marker,watermark,token,expires_at,revision,source_fence,generation,started) VALUES(?,?,?,?,?,?,?,?,?)')
        .run(row.id, marker, input.watermark, token, Date.now()+ADMISSION_LEASE_MS, row.revision, row.source_fence, input.generation, input.deferAttempt ? 0 : 1);
      if (!input.deferAttempt) db.prepare('UPDATE session_episodes SET attempted=max(attempted,?) WHERE id=?').run(input.watermark, row.id);
      return { token, revision: row.revision, sourceFence: row.source_fence, watermark: input.watermark, skipReason };
    });
  }
  function attempt(ns, input) {
    const row = live(ns, input.episodeId);
    const claim = db.prepare('SELECT * FROM episode_attempts WHERE episode_id=? AND token=?').get(row.id, input.token);
    if (!claim || claim.finished || claim.expires_at <= Date.now() || claim.revision !== row.revision || claim.source_fence !== row.source_fence) fail('stale_episode');
    // A pre-pause attempt can finish; project stop increments its source fence.
    if (control(ns)?.enabled === 0) fail('capture_disabled');
    return { row, claim };
  }
  function startAttempt(ns, input) {
    return transaction(db, () => {
      const { row, claim } = attempt(ns, input);
      db.prepare('UPDATE episode_attempts SET started=1 WHERE episode_id=? AND token=?').run(row.id, claim.token);
      db.prepare('UPDATE session_episodes SET attempted=max(attempted,?) WHERE id=?').run(claim.watermark, row.id);
    });
  }
  function failDraft(ns, input) {
    if (!['episode_failed','episode_timeout','invalid_model_output','context_budget_exceeded','capacity','expired','generation_conflict','missing_evidence'].includes(input.code)) fail('invalid_input');
    // Finalization authenticates ownership, not publication freshness. A correction,
    // release or deletion fences prose, but cannot strand the owner's failure.
    const timeout = db.prepare('PRAGMA busy_timeout').get().timeout;
    if (input.busyTimeoutMs !== undefined) db.exec(`PRAGMA busy_timeout=${Math.max(0, Math.min(timeout, Math.floor(input.busyTimeoutMs)))}`);
    try { return transaction(db, () => {
      const row = read(ns, input.episodeId);
      const claim = row && db.prepare('SELECT * FROM episode_attempts WHERE episode_id=? AND token=?').get(row.id, input.token);
      if (!claim || claim.finished) return;
      const record = JSON.parse(row.record);
      db.prepare('UPDATE episode_attempts SET started=1,finished=1 WHERE episode_id=? AND token=?').run(row.id, claim.token);
      db.prepare('UPDATE session_episodes SET attempted=max(attempted,?) WHERE id=?').run(claim.watermark, row.id);
      for (const registered of db.prepare('SELECT client,event_id FROM episode_events WHERE episode_id=? AND position<=? AND disposition=0').all(row.id, claim.watermark)) {
        mergeGap(ns, { client: registered.client, eventId: registered.event_id }, input.code);
      }
      if (!row.deleted) {
        record.processing.state = record.gist ? 'incomplete' : 'failed';
        record.processing.errorCode = input.code;
        save(ns, row, record);
      }
      return { revision: row.revision + 1 };
    }); } finally {
      if (input.busyTimeoutMs !== undefined) db.exec(`PRAGMA busy_timeout=${timeout}`);
    }
  }
  function commitDraft(ns, input) {
    return transaction(db, () => {
      stagedEvidence.touch(ns);
      const { row, claim } = attempt(ns, input), old = JSON.parse(row.record);
      object(input.result, ['type','language','gist','outcome','nextStep','disposition']);
      if (['type','language','gist','outcome','nextStep','disposition'].some(key => !Object.hasOwn(input.result,key))) fail('invalid_input');
      if (input.result.disposition != null) fail('invalid_input'); // Step transitions belong to SE-3.
      let sources = denseArray(input.sources, 1, 1552).map(ref => {
        object(ref, ['eventId','messageId','sourceId']);
        if (ref.sourceId !== undefined) {
          if (ref.eventId !== undefined || ref.messageId !== undefined) fail('invalid_input');
          const source = db.prepare(`SELECT s.* FROM episode_sources s JOIN session_episodes e ON e.id=s.episode_id
            WHERE s.id=? AND e.owner_id=? AND e.scope=? AND e.project_id=? AND e.deleted=0`)
            .get(identifier(ref.sourceId), ...boundary(ns));
          if (!source) fail('revision_conflict');
          return { ...source, id: randomUUID(), episode_id: row.id };
        }
        const registered = event(ns, { client: row.client, eventId: identifier(ref.eventId) });
        if (!registered || registered.episode_id !== row.id || registered.position > claim.watermark || registered.generation !== claim.generation) fail('invalid_input');
        const staged = db.prepare(`SELECT payload FROM staged_capture_evidence WHERE ${eventWhere}`)
          .get(...boundary(ns), row.client, ref.eventId);
        const view = staged?.payload ? JSON.parse(staged.payload) : null;
        const index = view?.messages.findIndex(message => message.id === ref.messageId) ?? -1;
        if (index < 0) fail('revision_conflict');
        const message = view.messages[index];
        return { id: randomUUID(), episode_id: row.id, origin_episode_id: row.id,
          event_id: ref.eventId, message_id: message.id, digest: sourceDigest(message.content), role: message.role,
          text: message.content, truncated: +view.retainedSourceWindow.truncatedMessageIndices.includes(index), ordinal: registered.ordinal };
      });
      const selected = new Set(sources.map(s => `${s.origin_episode_id}:${s.event_id}:${s.message_id}`));
      if (selected.size !== sources.length) fail('invalid_input');
      const anchors = value => denseArray(value, 1, 4).map(anchor => {
        object(anchor, ['sourceIndex','start','end']);
        if (!Number.isSafeInteger(anchor.sourceIndex)) fail('invalid_input');
        const source = sources[anchor.sourceIndex]; if (!source) fail('invalid_input');
        sourceSpan(source.text, anchor.start, anchor.end);
        return { sourceId: source.id, digest: source.digest, start: anchor.start, end: anchor.end };
      });
      const result = input.result, record = { ...old, anchors: {}, editor: { ...old.editor } };
      if (typeof result.language !== 'string' || result.language.length > 35 ||
        !/^(mixed|[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*)$/.test(result.language)) fail('invalid_input');
      record.language = result.language;
      for (const field of ['type', ...fields]) {
        const value = result[field];
        if (value == null) {
          if (field === 'type' || field === 'gist') fail('invalid_input');
          record[field] = null;
        } else {
          object(value, ['value','anchors']);
          const text = field === 'type' ? value.value : episodeText(value.value, field === 'gist' ? 400 : 240);
          if (field === 'type' && !types.includes(text)) fail('invalid_input');
          record.anchors[field] = anchors(value.anchors);
          record[field] = field === 'nextStep' ? { id: randomUUID(), text, status: 'open',
            anchors: record.anchors[field], receiptOrdinal: Math.max(...sources.map(source => source.ordinal)) } : text;
        }
        record.editor[field] = { origin: 'model', pinned: false };
      }
      if (old.nextStep?.status === 'open' && result.nextStep != null && !old.editor.nextStep?.pinned && result.nextStep.value !== old.nextStep.text) fail('episode_step_conflict');
      for (const field of fields) {
        if (old.editor[field]?.pinned || (field === 'nextStep' && old.nextStep?.status === 'open')) {
          record[field] = old[field]; record.editor[field] = old.editor[field];
          if (old.anchors[field]) record.anchors[field] = old.anchors[field];
          for (const anchor of old.anchors[field] ?? []) {
            if (!sources.some(source => source.id === anchor.sourceId)) {
              const source = db.prepare('SELECT * FROM episode_sources WHERE episode_id=? AND id=?').get(row.id, anchor.sourceId);
              if (!source) fail('revision_conflict');
              sources.push(source);
            }
          }
        }
      }
      const cited = new Set(Object.values(record.anchors).flat().map(anchor => anchor.sourceId));
      sources = sources.filter(source => cited.has(source.id));
      if (sources.length > 16) fail('invalid_input');
      object(input.modelMetadata, ['adapter','model','profile','promptVersion','digest','portVersion']);
      record.modelMetadata = {};
      for (const field of ['adapter','model','profile']) record.modelMetadata[field] = input.modelMetadata[field] == null ? null : episodeText(input.modelMetadata[field], 100);
      record.modelMetadata.promptVersion = episodeText(input.modelMetadata.promptVersion, 64);
      if (Object.values(record.modelMetadata).some(value => value && (/https?:|[\\/]|\[REDACTED\]/i.test(value)))) fail('invalid_input');
      if (!HEX_DIGEST.test(input.modelMetadata.digest) || input.modelMetadata.portVersion !== 'episode-v1') fail('invalid_input');
      Object.assign(record.modelMetadata, { digest: input.modelMetadata.digest, portVersion: 'episode-v1' });
      const disposed = denseArray(input.dispositions, 1, 64).map(item => {
        object(item, ['eventId','omitted','omittedIndices']);
        if (item.omittedIndices !== undefined && (denseArray(item.omittedIndices,0,24).length !== item.omitted ||
          new Set(item.omittedIndices).size !== item.omittedIndices.length || item.omittedIndices.some(index => !Number.isInteger(index) || index<0 || index>23))) fail('invalid_input');
        if (!Number.isSafeInteger(item.omitted) || item.omitted < 0 || item.omitted > 24) fail('invalid_input');
        const registered = event(ns, { client: row.client, eventId: identifier(item.eventId) });
        if (!registered || registered.episode_id !== row.id || registered.position > claim.watermark || registered.staging !== 'staged') fail('invalid_input');
        const staged = db.prepare(`SELECT payload FROM staged_capture_evidence WHERE ${eventWhere}`).get(...boundary(ns), row.client, item.eventId);
        if (!staged?.payload) fail('revision_conflict');
        return { ...item, registered };
      });
      if (new Set(disposed.map(item => item.eventId)).size !== disposed.length) fail('invalid_input');
      const consumers = db.prepare('SELECT DISTINCT episode_id FROM episode_sources WHERE origin_episode_id=? AND episode_id!=?').all(row.id,row.id);
      for (const consumer of consumers) invalidateSources(ns,consumer.episode_id);
      if (read(ns,row.id).revision !== row.revision) fail('stale_episode');
      db.prepare('DELETE FROM episode_sources WHERE episode_id=?').run(row.id);
      const insert = db.prepare('INSERT INTO episode_sources VALUES(?,?,?,?,?,?,?,?,?,?)');
      for (const source of sources) insert.run(source.id,row.id,source.origin_episode_id,source.event_id,source.message_id,source.digest,source.role,source.text,source.truncated,source.ordinal);
      for (const item of disposed) {
        if (item.omitted) {
          mergeGap(ns, { client: row.client, eventId: item.eventId }, 'omitted');
          db.prepare(`UPDATE episode_events SET omitted_count=?,omitted_indices=? WHERE ${eventWhere}`)
            .run(item.omitted, JSON.stringify(item.omittedIndices ?? []), ...boundary(ns), row.client, item.eventId);
        }
        db.prepare(`UPDATE episode_events SET disposition=1 WHERE ${eventWhere}`).run(...boundary(ns), row.client, item.eventId);
        db.prepare(`UPDATE staged_capture_evidence SET disposition=1 WHERE ${eventWhere}`).run(...boundary(ns), row.client, item.eventId);
        stagedEvidence.releaseCompleted(ns, { client: row.client, eventId: item.eventId });
      }
      record.processing.omitted += (input.priorOmitted ?? 0);
      record.processing.omitted += disposed.reduce((total, item) => total + item.omitted, 0);
      const uncovered = db.prepare('SELECT count(*) AS n FROM episode_events WHERE episode_id=? AND position<=? AND disposition=0').get(row.id, claim.watermark).n;
      record.processing.state = uncovered || record.processing.missing || record.processing.expired || record.processing.omitted ? 'incomplete' : 'ready';
      record.processing.errorCode = null; record.interpretedAt = iso();
      db.prepare('UPDATE episode_attempts SET finished=1 WHERE episode_id=? AND token=?').run(row.id, claim.token);
      db.prepare('UPDATE session_episodes SET covered=max(covered,?) WHERE id=?').run(Math.max(...disposed.map(item => item.registered.position)), row.id);
      save(ns, row, record);
      if (input.classificationEventId && record.type === 'quick-one-off-question') {
        const anchored = record.anchors.type.some(anchor => sources.some(source => source.id === anchor.sourceId && source.event_id === input.classificationEventId));
        if (anchored) db.prepare(`UPDATE episode_events SET policy='skip-quick',policy_revision=?,policy_type=?,policy_at=?
          WHERE ${eventWhere} AND admission!='completed' AND disposition=1`).run(row.revision+1,record.type,iso(),...boundary(ns),row.client,input.classificationEventId);
      }
      return { revision: row.revision+1 };
    });
  }
  // Bounded live staging, plus at most 16 durable passages. No source read drafts.
  function draftSnapshot(ns, input) {
    return transaction(db, () => {
      stagedEvidence.touch(ns);
      const { row, claim } = attempt(ns, input);
      const events = db.prepare(`SELECT e.event_id,e.position,e.generation,s.payload FROM episode_events e
        JOIN staged_capture_evidence s USING(owner_id,scope,project_id,client,event_id)
        WHERE e.episode_id=? AND e.position<=? AND e.disposition=0 AND s.payload IS NOT NULL
        AND e.generation=? ORDER BY e.position DESC LIMIT 64`).all(row.id, claim.watermark, claim.generation);
      const sources = db.prepare('SELECT * FROM episode_sources WHERE episode_id=? ORDER BY ordinal,id').all(row.id);
      const target = db.prepare('SELECT event_id,staging,gap FROM episode_events WHERE episode_id=? AND position=?').get(row.id, claim.watermark);
      return { episodeId: row.id, client: row.client, revision: row.revision, sourceFence: row.source_fence,
        targetEventId: target.event_id, missingReason: target.staging === 'not-staged' ? 'capacity' : target.gap ?? 'missing_evidence', events: events.map(event => ({ eventId: event.event_id,
          position: event.position, view: JSON.parse(event.payload) })), sources, record: JSON.parse(row.record) };
    });
  }
  function captureState(ns, input) {
    return transaction(db, () => {
      const stored = input.eventId ? event(ns,input) : null;
      if (stored) { const denied=guard(ns,{...input,payloadDigest:stored.payload_digest}); if (denied) fail(denied); }
      const row = input.episodeId ? live(ns, input.episodeId) : db.prepare(`SELECT * FROM session_episodes
        WHERE ${where} AND client=? AND session_key=? AND deleted=0`).get(...boundary(ns), input.client,
          sessionKey(ns, input.client, input.sessionId));
      if (!row) return null;
      const registered = input.eventId ? event(ns, input) : null;
      return { episodeId: row.id, revision: row.revision, observed: row.observed, attempted: row.attempted,
        unfinishedAttempt: Boolean(db.prepare('SELECT 1 FROM episode_attempts WHERE episode_id=? AND finished=0').get(row.id)),
        covered: row.covered, draftEvery: row.draft_every, record: JSON.parse(row.record),
        policy: registered?.policy, admission: registered?.admission,
        draftConsumed: registered ? Boolean(db.prepare('SELECT 1 FROM episode_attempts WHERE episode_id=? AND marker=?').get(row.id, `batch:${registered.position}`)) : false,
        generation: row.generation, sessionKey: row.session_key, client: row.client };
    });
  }
  function pendingSession(ns, input) {
    return transaction(db, () => {
      assertControl(ns, input.generation);
      const row = db.prepare(`SELECT e.id FROM session_episodes e WHERE ${where} AND client=?
        AND session_key!=? AND deleted=0 AND observed>attempted AND generation=?
        AND NOT EXISTS(SELECT 1 FROM episode_attempts a WHERE a.episode_id=e.id AND a.marker='lazy'
          AND (a.started=1 OR a.expires_at>?))
        ORDER BY last_received_at,id LIMIT 1`).get(...boundary(ns), input.client,
          sessionKey(ns, input.client, input.sessionId), input.generation, Date.now());
      return row?.id ?? null;
    });
  }
  function settleAttempt(ns, input) {
    // Only commit/failure/expiry may finish an attempt. Cleanup cannot erase an
    // unfinished paid call whose outcome could not be stored under a local lock.
    return transaction(db, () => {
      const row = read(ns, input.episodeId);
      if (!row) return;
      if (input.retryable) {
        db.prepare('DELETE FROM episode_attempts WHERE episode_id=? AND token=? AND started=0').run(row.id, input.token);
        return;
      }
      db.prepare(`UPDATE session_episodes SET attempted=max(attempted,coalesce(
        (SELECT watermark FROM episode_attempts WHERE episode_id=? AND token=?),0)) WHERE id=?`)
        .run(row.id, input.token, row.id);
      db.prepare('UPDATE episode_attempts SET started=1 WHERE episode_id=? AND token=?').run(row.id, input.token);
    });
  }
  // Busy cleanup can retry in this process; after restart the persisted admission lease expires.
  // No final failure is inferred from an interrupted owner.
  const keepCleanup = new Map();
  function keepAttempt(ns, input) {
    if (!input.keepActionId) return null;
    return db.prepare(`SELECT a.*,e.id,e.deleted,e.source_fence AS current_fence,e.revision AS current_revision
      FROM episode_keep_actions a JOIN session_episodes e ON e.id=a.episode_id
      WHERE e.owner_id=? AND e.scope=? AND e.project_id=? AND a.admission_key=?`)
      .get(...boundary(ns), input.keepActionId);
  }
  function keepGuard(ns, input) {
    const action = keepAttempt(ns, input);
    if (!action) return null;
    if (action.deleted || control(ns)?.enabled === 0) return 'capture_evidence_closed';
    if (action.keep_state === 'completed') return null;
    if (action.revision !== action.current_revision || action.source_fence !== action.current_fence) return 'revision_conflict';
    return null;
  }
  function cleanupKeep(ns, kept, code) {
    const claim = keepAttempt(ns, kept.key);
    if (claim?.state === 'completed' || claim?.token !== kept.admissionToken) return;
    const terminal = ['invalid_model_output', 'context_budget_exceeded', 'revision_conflict',
      'capture_evidence_closed', 'episode_sources_unavailable'].includes(code);
    db.prepare(`UPDATE episode_keep_actions SET state='reserved',token=NULL,lease_expires_at=NULL WHERE admission_key=?`)
      .run(kept.key.keepActionId);
    db.prepare('UPDATE episode_keep_actions SET keep_state=?,keep_error_code=? WHERE episode_id=? AND admission_key=?')
      .run(terminal ? 'failed' : 'retryable', terminal ? code : null, kept.episodeId, kept.key.eventId);
    advanceEpoch(ns);
  }
  function prepareKeep(ns, input) {
    return transaction(db, () => {
      const row = live(ns, input.episodeId);
      const eventId = createHmac('sha256', Buffer.from(secret(), 'hex'))
        .update(JSON.stringify(['keep-v1', row.id, identifier(input.actionId)])).digest('hex');
      const payloadDigest = sourceDigest(JSON.stringify(['episode-keep-v1', row.id, revision(input.expectedRevision), eventId]));
      const key = { client: row.client, eventId, payloadDigest, keepActionId: eventId };
      const pendingCleanup = keepCleanup.get(eventId);
      if (pendingCleanup) {
        cleanupKeep(ns, pendingCleanup.kept, pendingCleanup.code);
        keepCleanup.delete(eventId);
      }
      const prior = keepAttempt(ns, key);
      if (prior && prior.payload_digest !== payloadDigest) fail('event_payload_conflict');
      const action = keepAttempt(ns, key);
      const coverage = action && { sourceIds: JSON.parse(action.keep_source_ids), revision: action.revision, sourceFence: action.source_fence };
      if (action?.keep_state === 'failed') return { failure: action.keep_error_code };
      if (prior?.state === 'completed') return { key, client: row.client, sessionKey: row.session_key, sources: [], coverage };
      if (!getControl(ns).enabled) fail('capture_disabled');
      if (row.revision !== input.expectedRevision) fail('revision_conflict');
      const denied = keepGuard(ns, key); if (denied) fail(denied);
      const sources = db.prepare('SELECT * FROM episode_sources WHERE episode_id=? ORDER BY ordinal,id LIMIT 17').all(row.id);
      if (!sources.length || sources.length > 16) fail('episode_sources_unavailable');
      if (!prior) {
        // Independent, transactionally allocated per-episode action ordinal.
        const ordinal = db.prepare('SELECT coalesce(max(keep_ordinal),0)+1 AS next FROM episode_keep_actions WHERE episode_id=?')
          .get(row.id).next;
        db.prepare(`INSERT INTO episode_keep_actions(admission_key,action_id,episode_id,owner_id,scope,project_id,
          client,event_id,payload_digest,state,keep_state,keep_source_ids,revision,source_fence,keep_ordinal,keep_created_at)
          VALUES(?,?,?,?,?,?,?,?,?,'reserved','pending',?,?,?,?,?)`)
          .run(eventId, input.actionId, row.id, ...boundary(ns), row.client, eventId, payloadDigest,
            JSON.stringify(sources.map(source => source.id)), row.revision, row.source_fence, ordinal, iso());
        advanceEpoch(ns);
      } else db.prepare("UPDATE episode_keep_actions SET keep_state='pending',keep_error_code=NULL WHERE episode_id=? AND admission_key=?")
        .run(row.id, eventId);
      return { key, client: row.client, sessionKey: row.session_key, sources, episodeId: row.id,
        coverage: coverage ?? { sourceIds: sources.map(source => source.id), revision: row.revision, sourceFence: row.source_fence } };
    });
  }
  function failKeep(ns, kept, code) {
    keepCleanup.set(kept.key.eventId, { kept, code });
    try {
      transaction(db, () => cleanupKeep(ns, kept, code));
      keepCleanup.delete(kept.key.eventId);
    } catch (error) {
      if (!isStorageBusy(error)) throw error;
    }
  }
  function assertKeep(ns, kept) {
    const denied = keepGuard(ns, kept.key); if (denied) fail(denied);
  }
  function keepAdmitted(ns, input, entries) {
    const action = keepAttempt(ns, input); if (!action) return;
    db.prepare("UPDATE episode_keep_actions SET keep_state='completed',keep_error_code=NULL WHERE episode_id=? AND admission_key=?")
      .run(action.id, input.eventId);
    for (const entry of entries) {
      const memory = db.prepare('SELECT revision FROM memories WHERE id=?').get(entry.memoryId);
      const ids = (entry.item.receipts ?? []).flatMap(receipt => db.prepare(
        'SELECT id FROM receipts WHERE memory_id=? AND client=? AND session_id=? AND event_id=?')
        .all(entry.memoryId, receipt.client, receipt.sessionId, receipt.eventId).map(row => row.id));
      db.prepare('INSERT INTO episode_memory_links VALUES(?,?,?,?,?,?) ON CONFLICT DO NOTHING')
        .run(randomUUID(), action.id, entry.memoryId, input.eventId, memory.revision, JSON.stringify(ids));
    }
    advanceEpoch(ns);
  }
  function correctionAnchors(row, values) {
    return denseArray(values, 1, 4).map(anchor => {
      object(anchor, ['sourceId','digest','start','end']);
      const source = db.prepare('SELECT * FROM episode_sources WHERE episode_id=? AND id=?').get(row.id, identifier(anchor.sourceId));
      if (!source || source.digest !== anchor.digest) fail('invalid_input');
      sourceSpan(source.text, anchor.start, anchor.end);
      return { ...anchor };
    });
  }
  function correct(ns, input) {
    object(input.patch, fields);
    if (!Object.keys(input.patch).length) fail('invalid_input');
    return transaction(db, () => {
      revision(input.expectedRevision);
      const row = live(ns, input.episodeId, input.expectedRevision), record = JSON.parse(row.record);
      for (const [field, value] of Object.entries(input.patch)) {
        if (value === null) {
          if (field === 'gist') fail('invalid_input');
          if (field === 'nextStep' && record.nextStep) record.nextStep = { ...record.nextStep, status: 'closed' };
          else record[field] = null;
          if (field !== 'nextStep') delete record.anchors[field];
        } else {
          object(value, ['text','anchors']);
          const text = episodeText(value.text, field === 'gist' ? 400 : 240);
          record.anchors[field] = correctionAnchors(row, value.anchors);
          record[field] = field === 'nextStep' ? { id: record.nextStep?.id ?? randomUUID(), text, status: 'open',
            anchors: record.anchors[field], receiptOrdinal: control(ns)?.ordinal ?? 0 } : text;
        }
        record.editor[field] = { origin: 'explicit-correction', pinned: true };
      }
      save(ns, row, record);
      return { revision: row.revision+1 };
    });
  }
  function releaseCorrection(ns, input) {
    const names = denseArray(input.fields, 1, 3);
    if (new Set(names).size !== names.length || names.some(field => !fields.includes(field))) fail('invalid_input');
    return transaction(db, () => {
      revision(input.expectedRevision);
      const row = live(ns, input.episodeId, input.expectedRevision), record = JSON.parse(row.record);
      for (const name of names) if (record.editor[name]) record.editor[name].pinned = false;
      save(ns, row, record); return { revision: row.revision+1 };
    });
  }
  function forget(ns, input) {
    return transaction(db, () => {
      revision(input.expectedRevision);
      const row = live(ns, input.episodeId, input.expectedRevision);
      const ids = db.prepare('SELECT memory_id FROM episode_memory_links WHERE episode_id=?').all(row.id);
      invalidateSources(ns, row.id);
      for (const { memory_id: id } of ids) forgetMutation(ns, id);
      const record = blank(null); record.processing.state = 'invalidated';
      db.prepare(`UPDATE session_episodes SET deleted=1,record=?,writer_token=NULL,writer_expires_at=NULL,
        revision=revision+1,source_fence=source_fence+1,updated_at=? WHERE id=?`).run(JSON.stringify(record), iso(), row.id);
      db.prepare(`UPDATE episode_events SET policy='normal',policy_revision=NULL,policy_type=NULL,policy_at=NULL WHERE episode_id=?`).run(row.id);
      for (const registered of db.prepare('SELECT client,event_id FROM episode_events WHERE episode_id=?').all(row.id)) {
        mergeGap(ns, { client: registered.client, eventId: registered.event_id }, 'forgotten');
      }
      db.prepare(`UPDATE staged_capture_evidence SET state='forgotten',payload=NULL,payload_bytes=0,release_reason=NULL,disposition=0
        WHERE ${where} AND (client,event_id) IN (SELECT client,event_id FROM episode_events WHERE episode_id=?)`).run(...boundary(ns), row.id);
      advanceEpoch(ns);
      return { forgotten: true };
    });
  }
  function inspect(ns, input, pages) {
    return transaction(db, () => {
      stagedEvidence.touch(ns);
      const row = live(ns, input.episodeId), currentEpoch = epoch(ns);
      for (const page of Object.values(pages)) if (page.epoch !== undefined && page.epoch !== currentEpoch) fail('cursor_stale');
      const record = JSON.parse(row.record);
      const sources = db.prepare('SELECT * FROM episode_sources WHERE episode_id=? AND id>? ORDER BY id LIMIT ?')
        .all(row.id, pages.source.after ?? '', pages.source.limit+1).map(source => ({ id: source.id, digest: source.digest,
          originEpisodeId: source.origin_episode_id, eventId: source.event_id, messageId: source.message_id,
          role: source.role, text: source.text, truncated: !!source.truncated, receiptOrdinal: source.ordinal }));
      const memories = db.prepare(`SELECT l.* FROM episode_memory_links l JOIN memories m ON m.id=l.memory_id
        WHERE l.episode_id=? AND l.id>? AND m.deleted=0 ORDER BY l.id LIMIT ?`)
        .all(row.id, pages.memory.after ?? '', pages.memory.limit+1).map(link => ({ id: link.id, memoryId: link.memory_id,
          admissionRevision: link.admission_revision, receiptIds: JSON.parse(link.receipt_ids).filter(id => db.prepare('SELECT 1 FROM receipts WHERE id=? AND memory_id=?').get(id, link.memory_id)) }));
      const policies = db.prepare(`SELECT e.*,s.state,s.release_reason FROM episode_events e LEFT JOIN staged_capture_evidence s
        ON e.owner_id=s.owner_id AND e.scope=s.scope AND e.project_id=s.project_id AND e.client=s.client AND e.event_id=s.event_id
        WHERE e.episode_id=? AND e.position>? ORDER BY e.position LIMIT ?`)
        .all(row.id, pages.policy.after ?? 0, pages.policy.limit+1).map(e => ({ position: e.position, eventId: e.event_id,
          policy: e.policy, basisRevision: e.policy_revision, type: e.policy_type, decidedAt: e.policy_at, receivedAt: e.created_at, admission: e.admission,
          gapReasons: JSON.parse(e.gap_reasons), omittedCount: e.omitted_count, omittedMessageIndices: JSON.parse(e.omitted_indices), staging: e.staging === 'not-staged' ? 'not-staged' : e.state, gap: e.gap, releaseReason: e.release_reason ?? null }));
      return { episode: { id: row.id, revision: row.revision, namespace: { ...ns, projectId: ns.projectId || null },
        sessionKey: row.session_key, client: row.client, firstReceivedAt: row.first_received_at,
        lastReceivedAt: row.last_received_at, updatedAt: row.updated_at, ...record,
        processing: { ...record.processing, observed: row.observed, attempted: row.attempted, covered: row.covered } },
        sources, memoryLinks: memories, policies,
        keepActions: db.prepare(`SELECT * FROM episode_keep_actions WHERE episode_id=? AND keep_ordinal>?
          ORDER BY keep_ordinal LIMIT ?`).all(row.id, pages.keep.after ?? 0, pages.keep.limit + 1)
          .map(action => ({ actionKey: action.admission_key, ordinal: action.keep_ordinal,
            createdAt: action.keep_created_at, policy: 'explicit-keep', admission: action.keep_state,
            errorCode: action.keep_error_code, sourceCoverage: { sourceIds: JSON.parse(action.keep_source_ids),
              revision: action.revision, sourceFence: action.source_fence } })), epoch: currentEpoch };
    });
  }
  return { prepareKeep, failKeep, assertKeep, validateBatch, draftSnapshot, captureState, pendingSession, settleAttempt, startAttempt, sessionKey, setPolicy, reserveBatch, event, guard, admissionStarted, mergeGap, gap, admitted, invalidateMemory, getControl, setControl,
    claimWriter, releaseWriter, claimDraft, failDraft, commitDraft, correct, releaseCorrection, forget, inspect };
}
