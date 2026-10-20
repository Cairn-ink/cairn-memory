import { createHash } from 'node:crypto';
import { transaction } from './database.mjs';
import { createRawJournal } from './raw-journal.mjs';
import { rawBoundary, rawRegistration, rawNamespace } from './raw-input.mjs';
import { captureSnapshot } from './capture-input.mjs';
import { episodeSnapshot } from './episode-input.mjs';
import { episodeText } from './episode-storage.mjs';
import { boundedText, fail, identifier, object, revision } from './validation.mjs';

const where = 'owner_id=? AND scope=? AND project_id=? AND client=? AND event_id=?';
const key = input => [...rawBoundary(input.namespace), input.client, input.eventId];
const freeze = value => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** Internal only: joins the real admission/episode transaction, never interprets. */
export function createRawCaptureStorage({ db, profile, ...options }) {
  const journal = createRawJournal({ db, ...options });
  const binding = input => db.prepare(`SELECT * FROM raw_capture_events WHERE ${where}`).get(...key(input));
  const rawEvent = input => db.prepare(`SELECT result FROM raw_events WHERE ${where}`).get(...key(input));

  async function prepare(request) {
    object(request, ['namespace','client','sessionId','eventId','messages',
      ...(profile.sessionEpisodes ? ['episodeContext'] : ['causal'])]);
    const { causal, episodeContext, ...source } = request;
    const input = freeze(rawRegistration(source));
    // Copy the complete context/profile and projection before the first await.
    let context = {};
    if (profile.sessionEpisodes) {
      object(episodeContext, ['clientLabel','generation','origin']);
      if (!['ordinary','precompact'].includes(episodeContext.origin)) fail('invalid_input');
      context = { episodeContext: { clientLabel: episodeText(episodeContext.clientLabel, 80),
        generation: identifier(episodeContext.generation), origin: episodeContext.origin } };
    } else if (causal !== undefined) {
      if (profile.captureEvidence || profile.captureSourcePolicy === 'indexed-evidence-v1') fail('invalid_input');
      object(causal, ['streamId','sequence']);
      context = { causal: { streamId: identifier(causal.streamId), sequence: revision(causal.sequence) } };
    }
    const sessionKey = journal.sessionKey(input.namespace, input.client, input.sessionId);
    const previous = binding(input);
    const bindingDigest = hash(['raw-capture-v1', profile, context]);
    if (previous && previous.binding_digest !== bindingDigest) fail('event_payload_conflict');
    const row = db.prepare(`SELECT id FROM raw_conversations WHERE owner_id=? AND scope=? AND project_id=? AND client=? AND session_key=?`)
      .get(...rawBoundary(input.namespace), input.client, sessionKey);
    const firstIds = previous ? JSON.parse(previous.first_message_ids) : input.messages.filter(message =>
      message.part.index === 0 && !(row && db.prepare('SELECT 1 FROM raw_parts WHERE conversation_id=? AND message_id=? AND part_index=0')
        .get(row.id, message.id))).map(message => message.id);
    const messages = input.messages.filter(message => firstIds.includes(message.id)).flatMap(message => {
      let content;
      try { content = boundedText(message.content, 4000, true); }
      catch (error) { if (error.code === 'invalid_text') return []; throw error; }
      return [{ id: message.id, role: message.role, content,
        ...(profile.sessionEpisodes ? { occurredAt: message.occurredAt } : {}) }];
    });
    const projection = freeze({ namespace: { ...input.namespace, projectId: input.namespace.projectId || null },
      client: input.client, eventId: input.eventId,
      sessionId: profile.sessionEpisodes ? input.sessionId : sessionKey, messages, ...context });
    const snapshot = messages.length ? profile.sessionEpisodes ? episodeSnapshot(projection)
      : captureSnapshot(projection, profile.captureQualification, profile.captureSourcePolicy) : null;
    const projectionDigest = snapshot?.payloadDigest ?? hash(['raw-capture-empty-v1', sessionKey, input.eventId, firstIds, bindingDigest]);
    if (previous && previous.projection_digest !== projectionDigest) fail('event_payload_conflict');
    const generation = db.prepare('SELECT generation FROM episode_controls WHERE owner_id=? AND scope=? AND project_id=?')
      .get(...rawBoundary(input.namespace))?.generation ?? 'initial';
    if (profile.sessionEpisodes && context.episodeContext.generation !== generation) fail('generation_conflict');
    const token = await journal.prepareRegistration(input);

    function emptyOutcome() {
      const overlap = input.messages.filter(message => message.part.index === 0 && !firstIds.includes(message.id));
      if (!overlap.length) return { status: 'not-run', reason: firstIds.length ? 'no-eligible-first-part' : 'continuation' };
      let processing = false, incomplete = false, interpreted = false;
      for (const message of overlap) {
        const owner = db.prepare('SELECT first_event_id FROM raw_messages WHERE conversation_id=? AND message_id=?').get(row?.id, message.id);
        const origin = owner && binding({ ...input, eventId: owner.first_event_id });
        if (!origin || !JSON.parse(origin.eligible_message_ids).includes(message.id)) continue;
        interpreted = true;
        const admission = db.prepare(`SELECT state,lease_expires_at FROM admission_claims WHERE ${where}`)
          .get(...rawBoundary(input.namespace), input.client, owner.first_event_id);
        if (admission?.state === 'completed') continue;
        const writer = admission?.state === 'reserved' && db.prepare(`SELECT writer_expires_at FROM session_episodes
          WHERE owner_id=? AND scope=? AND project_id=? AND client=? AND session_key=?`)
          .get(...rawBoundary(input.namespace), input.client, sessionKey);
        if (admission?.lease_expires_at > Date.now() || writer?.writer_expires_at > Date.now()) processing = true;
        else incomplete = true;
      }
      return processing ? { processing: true, admission: { status: 'processing' } }
        : incomplete ? { status: 'incomplete', reason: 'interpretation-incomplete' }
          : interpreted ? { duplicate: true, overlap: true, admission: { status: 'covered' } }
            : { status: 'not-run', reason: 'no-eligible-first-part' };
    }

    function commit() {
      if (!db.isTransaction) fail('raw_transaction_required');
      const result = journal.commitRegistration(token);
      const existing = binding(input);
      if (existing) {
        if (existing.binding_digest !== bindingDigest || existing.projection_digest !== projectionDigest) fail('event_payload_conflict');
      } else {
        db.prepare(`INSERT INTO raw_capture_events(owner_id,scope,project_id,client,event_id,conversation_id,
          session_key,first_message_ids,eligible_message_ids,projection_digest,binding_digest,capture_generation)
          VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(...key(input), result.conversationId, sessionKey,
          JSON.stringify(firstIds), JSON.stringify(messages.map(message => message.id)), projectionDigest, bindingDigest, generation);
      }
      return result;
    }
    let accepted = false;
    return Object.freeze({ input: projection, hasProjection: Boolean(snapshot), replay: Boolean(previous),
      emptyOutcome, commit,
      accept: () => { accepted = true; },
      commitOnly: () => { const result = transaction(db, commit); accepted = true; return result; },
      result: () => { const row = accepted && rawEvent(input); return row ? JSON.parse(row.result) : null; },
      setStaging: staging => db.prepare(`UPDATE raw_capture_events SET staging=? WHERE ${where}`).run(staging, ...key(input)),
    });
  }

  function fenceSession(input) {
    object(input, ['namespace','client','sessionId']);
    const { client, sessionId } = input, namespace = rawNamespace(input.namespace);
    // Reuse the journal's strict namespace/client/session identity validation.
    const session = journal.sessionKey(namespace, client, sessionId);
    return transaction(db, () => {
      db.prepare('INSERT OR IGNORE INTO raw_session_fences VALUES(?,?,?,?,?)')
        .run(...rawBoundary(namespace), client, session);
      return journal.closePending({ ownerId: namespace.ownerId, namespace, client, sessionKey: session, reason: 'capture_barrier' });
    });
  }
  return Object.freeze({ ...journal, prepare, fenceSession });
}
