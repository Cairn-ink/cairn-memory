import { openMemoryCore } from '../../core/index.mjs';
import { classifyRawAcknowledgement } from '../../integrations/client/raw/protocol.mjs';
import { guardedModel } from './guarded-model.mjs';
import { LocalCaptureError } from './configuration.mjs';

const refusalCodes = new Set(['capture_disabled', 'capture_evidence_closed', 'revision_conflict', 'event_payload_conflict',
  'raw_part_out_of_order', 'conversation_deleted', 'source_excluded', 'storage_busy', 'invalid_input', 'raw_crypto_unavailable']);
const port = Object.freeze({ version: 'raw-seal-v1',
  sealRaw: ({ text }) => ({ format: 'local-plain-v1', keyVersion: null, sealed: Buffer.from(text) }),
  openRaw: ({ sealed }) => ({ text: new TextDecoder('utf8', { fatal: true }).decode(sealed) }) });
const idsCount = ids => {
  if (!Array.isArray(ids) || ids.some(id => typeof id !== 'string' || !id.length)) throw new LocalCaptureError();
  return new Set(ids).size;
};
export function captureReply(result, request) {
  if (!result.ok) {
    const code = refusalCodes.has(result.error?.code) ? result.error.code : 'local_capture_failed';
    return { status: code === 'capture_disabled' ? 403 : 409, body: { error: code } };
  }
  const { raw, interpretation } = result.value;
  const outcome = interpretation?.ok ? interpretation.value : null;
  let status = 200, memoryCount;
  if (outcome?.processing === true) { status = 202; memoryCount = 0; }
  else if (Array.isArray(outcome?.admission?.memories)) memoryCount = idsCount(outcome.admission.memories.map(memory => memory.id));
  else if (outcome?.duplicate === true && Array.isArray(outcome.memoryIds)) memoryCount = idsCount(outcome.memoryIds);
  else if (outcome?.duplicate === true && outcome.overlap === true && outcome.admission?.status === 'covered' ||
      outcome?.status === 'not-run' && ['continuation', 'no-eligible-first-part'].includes(outcome.reason)) memoryCount = 0;
  else return { status: 503, body: { error: 'interpretation_incomplete', raw } };
  const body = { version: 2, duplicate: outcome?.duplicate === true, memoryCount, raw, ...(status === 202 ? { processing: true } : {}) };
  classifyRawAcknowledgement(status, body, request);
  return { status, body };
}

export async function captureLocal(config, request, { signal, env, fetchImpl, captureMs = config.timeouts.captureMs, onClose = () => {} } = {}) {
  let core;
  const guarded = guardedModel(config, { core: () => core, signal, env, fetchImpl });
  try {
    core = openMemoryCore({ path: config.databasePath, model: guarded.model, captureQualification: 'source-bound-v2', captureDeadlineMs: captureMs,
      ...(Object.hasOwn(config, 'captureQualifiedDuplicates') ? { captureQualifiedDuplicates: config.captureQualifiedDuplicates } : {}),
      rawConversations: { mode: config.raw.mode === 'local-plain-v1' ? 'raw-v1' : 'off', capBytes: config.raw.capBytes, configureCap: false,
        port, readPolicy: () => ({ generation: 'local-capture-v1', reason: null }), localAuthority: config.authority } });
    onClose(() => core.close());
    const input = { namespace: config.authority.namespace, client: request.client, sessionId: request.session_id, eventId: request.event_id,
      messages: request.messages.map(message => ({ id: message.id, role: message.role, occurredAt: message.occurred_at,
        messageOrdinal: message.message_ordinal, content: message.content, part: { ...message.part } })) };
    const result = await core.captureRaw(input);
    await guarded.settled();
    return captureReply(result, request);
  } finally {
    await guarded.settled(); core?.close(); onClose(() => {});
  }
}
