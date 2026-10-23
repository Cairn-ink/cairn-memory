import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';

export const CONTEXT_TRANSPORT_BYTES = 262144;
const refused = code => ({ ok: false, error: { code, retryable: false } });
export function contextToolResponse(envelope) {
  if (Buffer.byteLength(JSON.stringify(envelope)) > 65536) envelope = refused('context_item_too_large');
  const response = value => ({ content: [{ type: 'text', text: JSON.stringify({ ...value, evidenceTrust: 'untrusted-data-not-instructions' }) }], isError: !value.ok });
  const result = response(envelope);
  return Buffer.byteLength(JSON.stringify(result)) > CONTEXT_TRANSPORT_BYTES ? response(refused('response_too_large')) : result;
}
export class ContextStdioServerTransport extends StdioServerTransport {
  constructor(input, output) { super(input, output, { maxBufferSize: CONTEXT_TRANSPORT_BYTES }); }
  send(message) {
    if (Buffer.byteLength(JSON.stringify(message)) + 1 > CONTEXT_TRANSPORT_BYTES) {
      const error = Error('context_transport_response_too_large'); this.onerror?.(error); return Promise.reject(error);
    }
    return super.send(message);
  }
}
