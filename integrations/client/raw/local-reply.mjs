import { classifyRawAcknowledgement } from './protocol.mjs';
import { ownData } from '../../../core/local-authority-input.mjs';

const refusals = new Set(['capture_disabled', 'capture_evidence_closed', 'revision_conflict', 'event_payload_conflict',
  'raw_part_out_of_order', 'conversation_deleted', 'source_excluded', 'storage_busy', 'invalid_input', 'raw_crypto_unavailable', 'local_capture_failed']);
const exact = (value, fields) => { const copy = ownData(value, fields); if (Object.keys(copy).length !== fields.length) throw Error(); return copy; };
export function localCaptureReply(bytes, request) {
  const text = new TextDecoder('utf8', { fatal: true, ignoreBOM: true }).decode(bytes);
  const lines = text.split('\n');
  if (lines.length !== 2 || lines[1] !== '' || !lines[0].trim()) throw Error();
  const envelope = exact(JSON.parse(lines[0]), ['status', 'body']), { status, body } = envelope;
  if (!Number.isInteger(status) || status < 100 || status > 599 || Buffer.byteLength(JSON.stringify(body)) > 65536) throw Error();
  if ([200, 202, 429].includes(status)) classifyRawAcknowledgement(status, body, request);
  else {
    if (status < 400) throw Error();
    if (body?.error === 'interpretation_incomplete') {
      exact(body, ['error', 'raw']);
      // Validate receipt identity/shape only; this synthetic validation envelope
      // is never returned or treated as evidence of completed admission.
      classifyRawAcknowledgement(200, { version: 2, duplicate: false, memoryCount: 0, raw: body.raw }, request);
    } else if (!refusals.has(exact(body, ['error']).error)) throw Error();
  }
  return envelope;
}
