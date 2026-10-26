import * as z from 'zod/v4';
import { registerContextReadTools } from './context-read-tools.mjs';
import { contextToolResponse } from './context-read-transport.mjs';

/** Compose the legacy registration. Only opted-in search/assembly schemas gain
 * narrowing; full/compact/snapshot fetch parsing remains the original code. */
export function registerContextReadSourcesTools(tool, core, access, enabled) {
  const sources = z.array(z.enum(enabled)).max(enabled.length).refine(ids => new Set(ids).size === ids.length).optional();
  registerContextReadTools((name, description, schema, action, readOnly) => tool(name, description,
    ['find_memory_candidates', 'read_memory_context'].includes(name) ? schema.extend({ sources }) : schema,
    action, readOnly), core, access);
}

// Source diagnostics are host metadata. Candidate identities, via and moc rank
// entries remain in the candidate tool's ordinary result. Assembly uses the
// unchanged v2 serializer and two metadata keys, with no extra text block.
export function contextSourcesToolResponse(envelope, { assembly = false } = {}) {
  if (assembly || Buffer.byteLength(JSON.stringify(envelope)) > 65536) return contextToolResponse(envelope, { assembly });
  const sources = envelope.value?.trace?.sources ?? envelope.error?.details?.trace?.sources;
  if (!sources) return contextToolResponse(envelope);
  const copy = structuredClone(envelope);
  delete (copy.value?.trace ?? copy.error.details.trace).sources;
  const result = contextToolResponse(copy);
  result._meta = { ...result._meta, 'ink.cairn/context-read-diagnostics': { trace: { sources } } };
  if (Buffer.byteLength(JSON.stringify(result)) > 262144)
    return contextToolResponse({ ok: false, error: { code: 'response_too_large', retryable: false } });
  return result;
}
