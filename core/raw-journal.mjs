import { createHmac, randomUUID } from 'node:crypto';
import { transaction } from './database.mjs';
import { fail, identifier, object } from './validation.mjs';
import { rawBoundary, rawClient, rawContext, rawNamespace, rawPolicy, rawRegistration, rawSealed, RAW_CLIENTS } from './raw-input.mjs';
import { createRawReads } from './raw-reads.mjs';
import { createRawControlStorage } from './raw-control-storage.mjs';
import { createRawSourceRoots } from './raw-source-roots.mjs';
import { createRawSourceReader } from './raw-source-reader.mjs';
import { createLocalAuthorityStorage } from './local-authority-storage.mjs';

const where = 'owner_id=? AND scope=? AND project_id=?';
const clock = () => new Date().toISOString();
const freeze = value => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};

/** Internal model-free seam. Hosts must not expose this before P2 controls/lineage. */
export function createRawJournal({ db, mode = 'off', port, capBytes, configureCap, readPolicy, sources = false, localAuthority }) {
  const rawControls = createRawControlStorage(db);
  const sourceRoots = createRawSourceRoots(db);
  const local = localAuthority ? createLocalAuthorityStorage(db) : null;
  const updateCap = capBytes !== undefined && configureCap !== false;
  if (capBytes === undefined) capBytes = 200000000;
  if (!['raw-v1','off'].includes(mode) || !Number.isSafeInteger(capBytes) || capBytes < 1 || typeof readPolicy !== 'function') fail('invalid_input');
  if (port !== undefined && (port?.version !== 'raw-seal-v1' || typeof port.sealRaw !== 'function' || typeof port.openRaw !== 'function')) fail('raw_crypto_unavailable');
  if (mode === 'raw-v1' && !port) fail('raw_crypto_unavailable');
  const seal = port?.sealRaw.bind(port), open = port?.openRaw.bind(port);
  const identity = db.prepare('SELECT store_id,cursor_secret FROM store_metadata WHERE singleton=1').get();
  const secret = db.prepare('SELECT secret FROM episode_identity WHERE singleton=1').get()?.secret;
  if (!identity || !/^[a-f0-9]{64}$/.test(secret ?? '') || !db.prepare("SELECT 1 FROM sqlite_master WHERE name='raw_parts'").get()) fail('unsupported_database');
  const key = Buffer.from(secret, 'hex'), prepared = new WeakMap();
  let savepoint = 0;
  const digest = value => createHmac('sha256', key).update(JSON.stringify(value)).digest('hex');
  const epoch = ns => db.prepare(`SELECT epoch FROM namespace_epochs WHERE ${where}`).get(...rawBoundary(ns))?.epoch ?? 1;
  const advanceEpoch = ns => db.prepare(`INSERT INTO namespace_epochs(owner_id,scope,project_id,epoch) VALUES(?,?,?,2)
    ON CONFLICT(owner_id,scope,project_id) DO UPDATE SET epoch=epoch+1`).run(...rawBoundary(ns));
  const conversation = (ns, client, sessionKey) => db.prepare(`SELECT * FROM raw_conversations WHERE ${where} AND client=? AND session_key=?`)
    .get(...rawBoundary(ns), client, sessionKey);
  const event = input => db.prepare(`SELECT * FROM raw_events WHERE ${where} AND client=? AND event_id=?`)
    .get(...rawBoundary(input.namespace), input.client, input.eventId);
  const messageRow = (id, messageId) => db.prepare('SELECT * FROM raw_messages WHERE conversation_id=? AND message_id=?').get(id,messageId);
  const partRow = (id, messageId, index) => db.prepare('SELECT * FROM raw_parts WHERE conversation_id=? AND message_id=? AND part_index=?').get(id,messageId,index);
  const usageRow = ownerId => db.prepare('SELECT * FROM raw_owner_usage WHERE owner_id=?').get(ownerId);
  const inTransaction = work => db.isTransaction ? work() : transaction(db,work);
  // The configured cap is durable. A different connection sees a cap decrease
  // without revoking any outstanding reservation.
  if (updateCap) inTransaction(() => db.prepare('UPDATE raw_owner_usage SET cap_bytes=?,revision=revision+1 WHERE cap_bytes!=?').run(capBytes,capBytes));

  function sessionKey(ns, client, sessionId) {
    return `s1:${digest(['episode-v1', ...rawBoundary(ns), client, sessionId])}`;
  }
  function getRawCaptureControl({ ownerId, client }) {
    identifier(ownerId); rawClient(client);
    const row = db.prepare('SELECT enabled,revision FROM raw_capture_controls WHERE owner_id=? AND client=?').get(ownerId,client);
    return { client, enabled: row?.enabled !== 0, revision: row?.revision ?? 0 };
  }
  function durableFence(ns, client, session) {
    const control = db.prepare(`SELECT generation,paused,enabled FROM episode_controls WHERE ${where}`).get(...rawBoundary(ns));
    if (control?.paused || control?.enabled === 0) fail('capture_disabled');
    const deleted = db.prepare(`SELECT deleted FROM session_episodes WHERE ${where} AND client=? AND session_key=?`)
      .get(...rawBoundary(ns),client,session);
    if (deleted?.deleted) fail('conversation_deleted');
    if (db.prepare("SELECT 1 FROM sqlite_master WHERE name='raw_session_fences'").get() &&
        db.prepare(`SELECT 1 FROM raw_session_fences WHERE ${where} AND client=? AND session_key=?`)
          .get(...rawBoundary(ns),client,session)) fail('conversation_deleted');
    return { epoch: epoch(ns), capture: control ? { ...control } : null, raw: getRawCaptureControl({ ownerId: ns.ownerId,client }) };
  }
  function policy(input) {
    const current = local?.check(localAuthority,input.namespace,input.client);
    // This callback is host-owned, synchronous, model-free authority; wire data
    // has no policy fields. The same authority is checked at preparation/commit.
    const result = rawPolicy(readPolicy(freeze({ namespace: { ...input.namespace, projectId: input.namespace.projectId || null }, client: input.client })));
    // The trusted synchronous policy can still change durable settings. A
    // revoked snapshot must not reach even the first sealing callback.
    local?.check(localAuthority,input.namespace,input.client);
    return current && current.rawNoticeVersion === null ? { ...result,reason:'notice_required' } : result;
  }
  function disposition(input, authority, fence) {
    return mode === 'off' ? 'raw_disabled' : !fence.raw.enabled ? 'tool_off' : authority.reason;
  }
  function partDigest(message) { return digest(['raw-part-v1',message.id,message.messageOrdinal,message.role,message.occurredAt,
    message.part.index,message.part.start,message.part.totalUnits,message.part.totalBytes,message.content]); }
  function validateMessage(id, message, shadow) {
    const previous = id && messageRow(id,message.id), index = message.part.index;
    if (previous && (previous.ordinal !== message.messageOrdinal || previous.role !== message.role || previous.occurred_at !== message.occurredAt ||
        previous.total_units !== message.part.totalUnits || previous.total_bytes !== message.part.totalBytes)) fail('event_payload_conflict');
    const priorPart = id && partRow(id,message.id,index);
    if (priorPart) {
      if (priorPart.digest !== partDigest(message)) fail('event_payload_conflict');
      return { previous, priorPart };
    }
    const ordinal = id && db.prepare('SELECT message_id FROM raw_messages WHERE conversation_id=? AND ordinal=?').get(id,message.messageOrdinal);
    if (ordinal && ordinal.message_id !== message.id) fail('event_payload_conflict');
    if ((!previous && index !== 0) || (previous && (previous.next_index !== index || previous.next_start !== message.part.start))) fail('raw_part_out_of_order');
    if (!previous) {
      const last = shadow ? shadow.last : id && db.prepare('SELECT ordinal,next_start,total_units,assembly_state,reason FROM raw_messages WHERE conversation_id=? ORDER BY ordinal DESC LIMIT 1').get(id);
      const discardedSuffix = last?.assembly_state === 'closed' && ['capture_barrier','tool_off'].includes(last.reason);
      if (last && (message.messageOrdinal <= last.ordinal || (last.next_start !== last.total_units && !discardedSuffix))) fail('raw_part_out_of_order');
    }
    const bytes = (previous?.received_bytes ?? 0) + Buffer.byteLength(message.content);
    const end = message.part.start + message.content.length;
    if (bytes > message.part.totalBytes || (end === message.part.totalUnits && bytes !== message.part.totalBytes) ||
        (end < message.part.totalUnits && bytes >= message.part.totalBytes)) fail('event_payload_conflict');
    return { previous, priorPart: null };
  }
  function replay(input, eventDigest) {
    const prior = event(input);
    if (prior && prior.digest !== eventDigest) fail('event_payload_conflict');
    return prior ? JSON.parse(prior.result) : null;
  }

  async function prepareRegistration(request) {
    if (db.isTransaction) fail('raw_transaction_active');
    const input = rawRegistration(request), ns = input.namespace;
    const session = sessionKey(ns,input.client,input.sessionId);
    // Raw session IDs never survive preparation or enter persisted metadata.
    delete input.sessionId;
    const eventDigest = digest(['raw-event-v1',session,input]);
    const authority = policy(input), fence = durableFence(ns,input.client,session);
    const duplicate = replay(input,eventDigest), row = conversation(ns,input.client,session);
    const id = row?.id ?? randomUUID(), revision = row?.revision ?? null;
    const token = Object.freeze({});
    if (duplicate) {
      prepared.set(token,{ input,session,eventDigest,authority,fence,id,revision,duplicate });
      return token;
    }
    const sealedParts = new Map(), sealMessages = [];
    const usage = usageRow(ns.ownerId);
    let available = (usage?.cap_bytes ?? capBytes) - (usage?.saved_bytes ?? 0) - (usage?.reserved_bytes ?? 0);
    // There is at most one part per message in a batch. Only the latest
    // message's projected progress is needed by the next new message's order
    // check; existing message/part identities still validate against SQL.
    const shadow = { last: row && db.prepare('SELECT ordinal,next_start,total_units,assembly_state,reason FROM raw_messages WHERE conversation_id=? ORDER BY ordinal DESC LIMIT 1').get(row.id) };
    let previousOrdinal = 0;
    // Clone/freeze once before the first await. The port never receives mutable
    // caller input or a reference to the private prepared record.
    freeze(input);
    for (const message of input.messages) {
      if (message.messageOrdinal === previousOrdinal) fail('event_payload_conflict');
      if (message.messageOrdinal < previousOrdinal) fail('raw_part_out_of_order');
      previousOrdinal = message.messageOrdinal;
      const { previous,priorPart } = validateMessage(row?.id,message,shadow);
      if (priorPart) continue;
      let reason = previous?.reason ?? disposition(input,authority,fence);
      if (!previous && reason === null) {
        if (message.part.totalBytes > available) reason = 'quota_reached';
        else available -= message.part.totalBytes;
      }
      const end = message.part.start+message.content.length;
      if (!shadow.last || message.messageOrdinal >= shadow.last.ordinal) {
        shadow.last = { ordinal: message.messageOrdinal,next_start: end,total_units: message.part.totalUnits,
          assembly_state: reason === null ? end === message.part.totalUnits ? 'complete' : 'pending' : 'closed',reason };
      }
      if (reason !== null || previous?.assembly_state === 'closed') continue;
      sealMessages.push({ message,context: freeze(rawContext(ns,input.client,session,id,message)) });
    }
    // Validate the complete projected sequence before invoking any port. No
    // ledger/usage writes occur until commit revalidates the real SQL sequence.
    for (const { message,context } of sealMessages) {
      if (db.isTransaction) fail('raw_transaction_active');
      // An earlier asynchronous seal can change authority before this dispatch.
      local?.check(localAuthority,input.namespace,input.client);
      try {
        const result = rawSealed(await seal({ ownerId: ns.ownerId,context,text: message.content }));
        if (result.format === 'local-plain-v1' && !result.sealed.equals(Buffer.from(message.content))) fail('raw_crypto_unavailable');
        sealedParts.set(message.id,result);
      } catch { fail('raw_crypto_unavailable'); }
      if (db.isTransaction) fail('raw_transaction_active');
    }
    prepared.set(token,{ input,session,eventDigest,authority,fence,id,revision,sealedParts });
    return token;
  }

  function commitInside(value) {
    const { input,session,eventDigest,authority,fence,id,revision,sealedParts } = value, ns = input.namespace;
    const currentPolicy = policy(input), currentFence = durableFence(ns,input.client,session);
    const duplicate = replay(input,eventDigest);
    if (duplicate) return duplicate;
    if (JSON.stringify(currentPolicy) !== JSON.stringify(authority) || JSON.stringify(currentFence) !== JSON.stringify(fence)) fail('revision_conflict');
    const current = conversation(ns,input.client,session);
    if ((current?.revision ?? null) !== revision || (current && current.id !== id)) fail('revision_conflict');
    const now = clock();
    if (!current) db.prepare(`INSERT INTO raw_conversations(id,owner_id,scope,project_id,client,session_key,revision,first_received_at,last_received_at)
      VALUES(?,?,?,?,?,?,1,?,?)`).run(id,...rawBoundary(ns),input.client,session,now,now);
    db.prepare('INSERT OR IGNORE INTO raw_owner_usage(owner_id,cap_bytes) VALUES(?,?)').run(ns.ownerId,capBytes);
    const results = [];
    let changed = false;
    for (const message of input.messages) {
      let { previous,priorPart } = validateMessage(id,message);
      if (priorPart) { results.push({ messageId: message.id,index: message.part.index,saved: Boolean(priorPart.saved),reason: priorPart.reason }); continue; }
      let reason = previous?.reason ?? disposition(input,authority,currentFence);
      if (!previous) {
        const usage = usageRow(ns.ownerId);
        if (reason === null && message.part.totalBytes > usage.cap_bytes-usage.saved_bytes-usage.reserved_bytes) reason = 'quota_reached';
        const reserved = reason === null ? message.part.totalBytes : 0;
        db.prepare(`INSERT INTO raw_messages(conversation_id,message_id,ordinal,role,occurred_at,total_units,total_bytes,assembly_state,reason,reserved_bytes,first_event_id)
          VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(id,message.id,message.messageOrdinal,message.role,message.occurredAt,message.part.totalUnits,message.part.totalBytes,
          reason === null ? 'pending' : 'closed',reason,reserved,input.eventId);
        if (reserved) db.prepare('UPDATE raw_owner_usage SET reserved_bytes=reserved_bytes+?,revision=revision+1 WHERE owner_id=?').run(reserved,ns.ownerId);
        previous = messageRow(id,message.id);
      }
      if (previous.assembly_state === 'closed') reason = previous.reason;
      if (previous.assembly_state === 'pending' && reason !== null) {
        if (previous.reserved_bytes) db.prepare('UPDATE raw_owner_usage SET reserved_bytes=reserved_bytes-?,revision=revision+1 WHERE owner_id=?')
          .run(previous.reserved_bytes,ns.ownerId);
        db.prepare("UPDATE raw_messages SET reserved_bytes=0,assembly_state='closed',reason=? WHERE conversation_id=? AND message_id=?")
          .run(reason,id,message.id);
      }
      const saved = reason === null, sealed = saved ? sealedParts.get(message.id) : null;
      if (saved && !sealed) fail('revision_conflict'); // Capacity/policy changed after a seal-free preflight.
      const bytes = Buffer.byteLength(message.content), end = message.part.start+message.content.length;
      db.prepare(`INSERT INTO raw_parts(conversation_id,message_id,part_index,start,end,byte_count,digest,event_id,saved,reason,format,key_version,sealed)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id,message.id,message.part.index,message.part.start,end,bytes,partDigest(message),input.eventId,
        Number(saved),reason,sealed?.format ?? null,sealed?.keyVersion ?? null,sealed?.sealed ?? null);
      const complete = end === message.part.totalUnits;
      db.prepare(`UPDATE raw_messages SET next_index=next_index+1,next_start=?,received_bytes=received_bytes+?,reserved_bytes=reserved_bytes-?,assembly_state=?
        WHERE conversation_id=? AND message_id=?`).run(end,bytes,saved ? bytes : 0,
        saved ? complete ? 'complete' : 'pending' : 'closed',id,message.id);
      if (saved) db.prepare('UPDATE raw_owner_usage SET saved_bytes=saved_bytes+?,reserved_bytes=reserved_bytes-?,revision=revision+1 WHERE owner_id=?').run(bytes,bytes,ns.ownerId);
      changed = true;
      results.push({ messageId: message.id,index: message.part.index,saved,reason });
    }
    if (changed) {
      if (current) db.prepare('UPDATE raw_conversations SET revision=revision+1,last_received_at=? WHERE id=?').run(now,id);
      advanceEpoch(ns);
    }
    const result = { conversationId: id,revision: conversation(ns,input.client,session).revision,parts: results };
    db.prepare(`INSERT INTO raw_events(owner_id,scope,project_id,client,event_id,digest,conversation_id,policy,result) VALUES(?,?,?,?,?,?,?,?,?)`)
      .run(...rawBoundary(ns),input.client,input.eventId,eventDigest,id,JSON.stringify(authority),JSON.stringify(result));
    return result;
  }
  function commitRegistration(token) {
    if (!db.isTransaction) fail('raw_transaction_required');
    const value = prepared.get(token);
    if (!value) fail('invalid_input');
    const name = `raw_registration_${++savepoint}`;
    db.exec(`SAVEPOINT ${name}`);
    try {
      const { input } = value;
      const result = sourceRoots.mutateSources(input.namespace, input.messages.map(message => ({
        client: input.client, sessionId: value.session, eventId: message.id })), () => commitInside(value));
      db.exec(`RELEASE ${name}`); return result;
    }
    catch (error) { db.exec(`ROLLBACK TO ${name}; RELEASE ${name}`); throw error; }
  }
  async function register(input) {
    const token = await prepareRegistration(input);
    return transaction(db,() => commitRegistration(token));
  }

  function closePendingInside({ ownerId,client,namespace,sessionKey: session,reason }) {
    return rawControls.closePendingInside({ ownerId, client, namespace, sessionKey: session, reason });
  }
  function closePending(input) { return inTransaction(() => closePendingInside(input)); }
  function setRawCaptureControl(input) {
    object(input,['ownerId','client','enabled','expectedRevision']);
    identifier(input.ownerId); rawClient(input.client);
    if (typeof input.enabled !== 'boolean' || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) fail('invalid_input');
    return inTransaction(() => {
      const previous = getRawCaptureControl(input);
      if (previous.revision !== input.expectedRevision) fail('revision_conflict');
      db.prepare(`INSERT INTO raw_capture_controls(owner_id,client,enabled,revision) VALUES(?,?,?,?)
        ON CONFLICT(owner_id,client) DO UPDATE SET enabled=excluded.enabled,revision=excluded.revision`)
        .run(input.ownerId,input.client,Number(input.enabled),previous.revision+1);
      if (!input.enabled) closePendingInside({ ownerId: input.ownerId,client: input.client,reason: 'tool_off' });
      return getRawCaptureControl(input);
    });
  }
  function usageSnapshot({ ownerId }) {
    identifier(ownerId);
    const row = usageRow(ownerId), savedBytes = row?.saved_bytes ?? 0, reservedBytes = row?.reserved_bytes ?? 0;
    const cap = row?.cap_bytes ?? capBytes, remainingBytes = Math.max(0,cap-savedBytes-reservedBytes);
    const clients = RAW_CLIENTS.map(client => {
      const counts = db.prepare(`SELECT count(*) conversation_count FROM raw_conversations WHERE owner_id=? AND client=?`).get(ownerId,client);
      const usage = db.prepare(`SELECT coalesce(sum(m.reserved_bytes),0) reserved_bytes FROM raw_messages m JOIN raw_conversations c ON c.id=m.conversation_id
        WHERE c.owner_id=? AND c.client=?`).get(ownerId,client);
      const saved = db.prepare(`SELECT coalesce(sum(p.byte_count),0) saved_bytes FROM raw_parts p JOIN raw_conversations c ON c.id=p.conversation_id
        WHERE c.owner_id=? AND c.client=? AND p.saved=1`).get(ownerId,client);
      return { client,savedBytes: saved.saved_bytes,reservedBytes: usage.reserved_bytes,conversationCount: counts.conversation_count };
    });
    return { ownerId,revision: row?.revision ?? 0,capBytes: cap,savedBytes,reservedBytes,remainingBytes,atCap: remainingBytes === 0,clients };
  }
  function getRawUsage(input) {
    object(input,['ownerId']);
    if (db.isTransaction) return usageSnapshot(input);
    db.exec('BEGIN');
    try { const result = usageSnapshot(input); db.exec('COMMIT'); return result; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  const getConversation = createRawReads({ db,identity,epoch,open,digest,partDigest });
  const sourceReader = sources ? createRawSourceReader({ db,identity,open,partDigest }) : undefined;
  return Object.freeze({ prepareRegistration,commitRegistration,register,getConversation,getRawUsage,
    sourceReader,
    getRawCaptureControl,setRawCaptureControl,closePending,
    sessionKey: (namespace, client, sessionId) => sessionKey(rawNamespace(namespace), rawClient(client), identifier(sessionId)) });
}
