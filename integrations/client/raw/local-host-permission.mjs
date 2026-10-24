import { assertNoCardCurrentDependencies } from '../../../core/card-current-schema.mjs';
import { assertNoRoleProfiles } from '../../../core/role-profile-schema.mjs';
import { assertNoAssets } from '../../../core/asset-schema.mjs';
import { validateExistingStore } from '../../../core/existing-store.mjs';
import { checkedPath } from '../private-state.mjs';
import { localAuthorityInput } from '../../../core/local-authority-input.mjs';
import { fail, hostRuntime } from './local-host-profile.mjs';
import { createHmac, createHash } from 'node:crypto';
import { rawRegistration } from '../../../core/raw-input.mjs';
import { captureSnapshot } from '../../../core/capture-input.mjs';

// Import SQLite and the storage helper only after the runtime gate. No writable
// core opener, migration or consent setter participates in this read snapshot.
async function databaseSnapshot(config,inspect) {
  hostRuntime();
  let db;
  try {
    const [{ DatabaseSync },{ createLocalAuthorityStorage }] = await Promise.all([
      import('node:sqlite'),import('../../../core/local-authority-storage.mjs'),
    ]);
    await checkedPath(config.usage.root,{ directory:true });
    const before = await checkedPath(config.databasePath);
    db = new DatabaseSync(config.databasePath,{ readOnly:true });
    if (db.prepare('PRAGMA user_version').get().user_version < 33) assertNoCardCurrentDependencies(db);
    if (db.prepare('PRAGMA user_version').get().user_version < 32) assertNoRoleProfiles(db);
    if (db.prepare('PRAGMA user_version').get().user_version < 31) assertNoAssets(db);
    if (db.prepare('PRAGMA user_version').get().user_version >= 30) validateExistingStore(db, { storeId: config.authority.storeId });
    const after = await checkedPath(config.databasePath);
    if (before.dev !== after.dev || before.ino !== after.ino) fail('store_invalid');
    db.exec('BEGIN');
    if (db.prepare('PRAGMA application_id').get().application_id !== 0x43414952 ||
        ![29,30,31,32,33].includes(db.prepare('PRAGMA user_version').get().user_version) ||
        db.prepare('SELECT store_id FROM store_metadata WHERE singleton=1').get()?.store_id !== config.authority.storeId ||
        db.prepare('SELECT 1 FROM raw_owner_usage WHERE owner_id=? AND cap_bytes!=?').get(config.authority.namespace.ownerId,config.raw.capBytes))
      fail('store_invalid');
    const result = inspect(db,createLocalAuthorityStorage(db));
    db.exec('COMMIT');
    const final = await checkedPath(config.databasePath);
    if (before.dev !== final.dev || before.ino !== final.ino) fail('store_invalid');
    return result;
  } catch (error) {
    if (['store_invalid','capture_disabled','authority_changed','rearm_refused'].includes(error.reason)) throw error;
    fail('store_invalid');
  } finally { db?.close(); }
}
function check(storage,authority) {
  try { storage.check(authority,authority.namespace,authority.client); }
  catch (error) {
    if (error.code === 'capture_disabled') fail('capture_disabled');
    if (error.code === 'revision_conflict') fail('authority_changed');
    throw error;
  }
}
export async function checkHostPermission(config) {
  return databaseSnapshot(config,(_db,storage) => check(storage,localAuthorityInput(config.authority)));
}
export async function readRearmAuthority(config) {
  return databaseSnapshot(config,(db,storage) => {
    const old = localAuthorityInput(config.authority), ns = old.namespace;
    const current = storage.get({ namespace:ns,client:old.client });
    if (current.targetId !== old.targetId) fail('authority_changed');
    const namespace = db.prepare('SELECT generation FROM episode_controls WHERE owner_id=? AND scope=? AND project_id=?')
      .get(ns.ownerId,ns.scope,ns.projectId);
    const raw = db.prepare('SELECT revision FROM raw_capture_controls WHERE owner_id=? AND client=?').get(ns.ownerId,old.client);
    const authority = { ...old,namespace:{ ...ns,projectId:ns.projectId || null },expectedControlRevision:current.revision,
      expectedConsentGeneration:current.consentGeneration,expectedNamespaceGeneration:namespace?.generation ?? 'initial',
      expectedRawRevision:raw?.revision ?? 0 };
    check(storage,localAuthorityInput(authority)); return authority;
  });
}
function selectedRearmSession(db,config,identity) {
  const ns = localAuthorityInput(config.authority).namespace,client = config.authority.client;
  const boundary = [ns.ownerId,ns.scope,ns.projectId];
  const secret = db.prepare('SELECT secret FROM episode_identity WHERE singleton=1').get()?.secret;
  if (!/^[a-f0-9]{64}$/.test(secret ?? '')) fail('rearm_refused');
  const session = 's1:'+createHmac('sha256',Buffer.from(secret,'hex'))
    .update(JSON.stringify(['episode-v1',...boundary,client,identity.wireSessionId])).digest('hex');
  if (db.prepare('SELECT 1 FROM raw_session_fences WHERE owner_id=? AND scope=? AND project_id=? AND client=? AND session_key=?')
    .get(...boundary,client,session) || db.prepare('SELECT 1 FROM session_episodes WHERE owner_id=? AND scope=? AND project_id=? AND client=? AND session_key=? AND deleted=1')
    .get(...boundary,client,session)) fail('rearm_refused');
  return { ns,client,boundary,secret,session };
}
export async function checkRearmSession(config,identity) {
  await databaseSnapshot(config,db => { selectedRearmSession(db,config,identity); });
}
export async function inspectRearmBoundary(config,identity,cursor,proof,previousReceipt = null) {
  return databaseSnapshot(config,db => {
    const { metadata = null,firstBatch = null,oldAuthority,pendingPart = null } = proof;
    const { ns,client,boundary,secret,session } = selectedRearmSession(db,config,identity);
    const conversation = db.prepare('SELECT id FROM raw_conversations WHERE owner_id=? AND scope=? AND project_id=? AND client=? AND session_key=?')
      .get(...boundary,client,session);
    const last = conversation && db.prepare('SELECT * FROM raw_messages WHERE conversation_id=? ORDER BY ordinal DESC LIMIT 1').get(conversation.id);
    if (!cursor.issuedOrdinal) { if (last || metadata) fail('rearm_refused'); return; }
    if (!last || last.ordinal !== cursor.issuedOrdinal || last.reserved_bytes !== 0) fail('rearm_refused');
    const part = db.prepare('SELECT part_index,start,end,byte_count,digest,event_id,saved,reason FROM raw_parts WHERE conversation_id=? AND message_id=? AND part_index=0').get(conversation.id,last.message_id);
    const tail = db.prepare('SELECT part_index,start,end,byte_count FROM raw_parts WHERE conversation_id=? AND message_id=? ORDER BY part_index DESC LIMIT 1').get(conversation.id,last.message_id);
    const event = db.prepare('SELECT * FROM raw_events WHERE owner_id=? AND scope=? AND project_id=? AND client=? AND event_id=?')
      .get(...boundary,client,last.first_event_id);
    const captured = db.prepare('SELECT * FROM raw_capture_events WHERE owner_id=? AND scope=? AND project_id=? AND client=? AND event_id=?')
      .get(...boundary,client,last.first_event_id);
    if (!part || part.event_id !== last.first_event_id || !event || event.conversation_id !== conversation.id ||
      !captured || captured.conversation_id !== conversation.id || captured.session_key !== session ||
      captured.local_target_id !== config.authority.targetId || captured.local_store_id !== config.authority.storeId ||
      typeof captured.local_consent_generation !== 'string' ||
      JSON.stringify(JSON.parse(captured.first_message_ids)) !== JSON.stringify([last.message_id])) fail('rearm_refused');
    const historical = previousReceipt?.phase === 'committed' && previousReceipt.replacementCursor.issuedOrdinal === last.ordinal &&
      cursor.offset >= previousReceipt.replacementCursor.offset;
    if (!historical && (captured.local_consent_generation !== oldAuthority.expectedConsentGeneration ||
      captured.capture_generation !== oldAuthority.expectedNamespaceGeneration)) fail('rearm_refused');
    const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
    const mac = value => createHmac('sha256',Buffer.from(secret,'hex')).update(JSON.stringify(value)).digest('hex');
    const profile = { captureQualification:'source-bound-v2',...(Object.hasOwn(config,'captureQualifiedDuplicates')
      ? { captureQualifiedDuplicates:config.captureQualifiedDuplicates }:{}) };
    const binding = hash(['raw-capture-managed-v1',profile,{},config.authority.targetId,config.authority.storeId,
      boundary,client,captured.local_consent_generation]);
    const rawResult = JSON.parse(event.result), policy = JSON.parse(event.policy);
    if (captured.binding_digest !== binding || !/^[a-f0-9]{64}$/.test(event.digest) ||
      policy.generation !== 'local-capture-v1' || ![null,'notice_required'].includes(policy.reason) ||
      Object.keys(policy).length !== 2 || rawResult.conversationId !== conversation.id ||
      !Number.isSafeInteger(rawResult.revision) || rawResult.revision < 1 || Object.keys(rawResult).length !== 3 ||
      JSON.stringify(rawResult.parts) !== JSON.stringify([{ messageId:last.message_id,index:0,saved:Boolean(part.saved),reason:part.reason }]) ||
      part.start !== 0 || part.end < 1 || part.end > last.total_units || part.end > 4000 ||
      part.byte_count < 1 || part.byte_count > last.total_bytes || !/^[a-f0-9]{64}$/.test(part.digest) ||
      !tail || tail.part_index !== last.next_index-1 || tail.end !== last.next_start || tail.end > last.total_units ||
      !['complete','closed'].includes(last.assembly_state)) fail('rearm_refused');
    const eligible = JSON.parse(captured.eligible_message_ids);
    if (JSON.stringify(eligible) !== '[]' && JSON.stringify(eligible) !== JSON.stringify([last.message_id])) fail('rearm_refused');
    if (eligible.includes(last.message_id)) {
      const admission = db.prepare('SELECT state,payload_digest FROM admission_claims WHERE owner_id=? AND scope=? AND project_id=? AND client=? AND event_id=?')
        .get(...boundary,client,last.first_event_id);
      if (admission?.state !== 'completed' || admission.payload_digest !== captured.projection_digest) fail('rearm_refused');
    } else if (captured.projection_digest !== hash(['raw-capture-empty-v1',session,last.first_event_id,[last.message_id],binding])) fail('rearm_refused');
    if (firstBatch) {
      const wire = firstBatch.body, message = wire.messages[0];
      if (wire.event_id !== last.first_event_id || message.id !== last.message_id || message.part.index !== 0 || message.part.start !== 0 ||
        part.end !== message.content.length || part.byte_count !== Buffer.byteLength(message.content) ||
        part.digest !== mac(['raw-part-v1',message.id,message.message_ordinal,message.role,message.occurred_at,0,0,
          message.part.totalUnits,message.part.totalBytes,message.content])) fail('rearm_refused');
      const registration = rawRegistration({ namespace:config.authority.namespace,client,sessionId:identity.wireSessionId,eventId:wire.event_id,
        messages:[{ id:message.id,role:message.role,occurredAt:message.occurred_at,messageOrdinal:message.message_ordinal,
          content:message.content,part:message.part }] });
      delete registration.sessionId;
      if (event.digest !== mac(['raw-event-v1',session,registration])) fail('rearm_refused');
      if (eligible.length && captureSnapshot({ namespace:{ ...ns,projectId:ns.projectId || null },client,eventId:wire.event_id,
        sessionId:session,messages:[{ id:message.id,role:message.role,content:message.content }] },'source-bound-v2').payloadDigest !== captured.projection_digest)
        fail('rearm_refused');
    }
    if (metadata) {
      if (last.assembly_state !== 'closed' || !['capture_barrier','tool_off'].includes(last.reason) ||
        last.message_id !== metadata.id || last.role !== metadata.role || last.occurred_at !== metadata.occurredAt ||
        last.total_units !== metadata.totalUnits || last.total_bytes !== metadata.totalBytes || !pendingPart ||
        !(last.next_index === pendingPart.index && last.next_start === pendingPart.start ||
          last.next_index === pendingPart.index+1 && last.next_start === pendingPart.end)) fail('rearm_refused');
    } else {
      const discarded = historical && last.assembly_state === 'closed' && ['capture_barrier','tool_off'].includes(last.reason);
      if (!discarded) {
        if (last.next_start !== last.total_units || last.received_bytes !== last.total_bytes || last.next_index < 1 ||
          last.next_index > Math.ceil(last.total_units/3999) || last.assembly_state === 'complete' && last.reason !== null ||
          last.assembly_state === 'closed' && last.reason === null) fail('rearm_refused');
        const transport = db.prepare('SELECT count(*) n,sum(byte_count) bytes FROM raw_parts WHERE conversation_id=? AND message_id=?')
          .get(conversation.id,last.message_id);
        if (transport.n !== last.next_index || transport.bytes !== last.received_bytes ||
          db.prepare(`SELECT 1 FROM raw_parts p LEFT JOIN raw_parts prior ON prior.conversation_id=p.conversation_id
            AND prior.message_id=p.message_id AND prior.part_index=p.part_index-1
            WHERE p.conversation_id=? AND p.message_id=? AND p.part_index>0 AND (prior.end IS NULL OR prior.end!=p.start) LIMIT 1`)
            .get(conversation.id,last.message_id)) fail('rearm_refused');
      }
    }
  });
}
