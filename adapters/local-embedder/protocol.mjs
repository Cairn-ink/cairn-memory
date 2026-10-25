import { once } from 'node:events';
import { strictJSON, fail, VERSION, closed } from './common.mjs';
export const INPUT_BYTES = 8388608;
export const OUTPUT_BYTES = 65536;
export const nextRequestId = (id, previous) => Number.isSafeInteger(id) && id > previous;
export function frame(value, maximum) {
  const payload = Buffer.from(JSON.stringify(value));
  if (!payload.length || payload.length > maximum) fail('context_item_too_large');
  const header = Buffer.alloc(4); header.writeUInt32BE(payload.length); return Buffer.concat([header, payload]);
}
export function decoder(maximum, accept, poison) {
  const header = Buffer.alloc(4); let headerBytes = 0, payload = null, used = 0, dead = false;
  return {
    push(chunk) {
      if (dead) return;
      try {
        let offset = 0;
        while (offset < chunk.length && !dead) {
          if (!payload) {
            const n = Math.min(4 - headerBytes, chunk.length - offset); chunk.copy(header, headerBytes, offset, offset + n); headerBytes += n; offset += n;
            if (headerBytes !== 4) continue;
            const length = header.readUInt32BE(0); if (!length || length > maximum) fail('protocol_error');
            payload = Buffer.allocUnsafe(length); used = 0;
          }
          const n = Math.min(payload.length - used, chunk.length - offset); chunk.copy(payload, used, offset, offset + n); used += n; offset += n;
          if (used === payload.length) { const value = strictJSON(payload); payload = null; headerBytes = 0; used = 0; accept(value); }
        }
      } catch { dead = true; payload = null; poison('protocol_error'); }
    },
    end() { if (!dead && (payload || headerBytes)) { dead = true; payload = null; poison('protocol_error'); } },
    stop() { dead = true; payload = null; },
    get bufferedBytes() { return headerBytes + used; }
  };
}
export async function writeFrame(stream, value, maximum) {
  if (!stream.write(frame(value, maximum))) await once(stream, 'drain');
}
export function shape(value, op, keys) {
  closed(value, ['v', 'op', ...keys], 'protocol_error');
  if (Object.keys(value).length !== keys.length + 2 || value.v !== VERSION || value.op !== op) fail('protocol_error');
}
export function stderrDrain(stream) {
  let retained = Buffer.alloc(0), bytes = 0;
  stream.on('data', chunk => { bytes = Math.min(Number.MAX_SAFE_INTEGER, bytes + chunk.length); retained = Buffer.concat([retained, chunk.subarray(-16384)]).subarray(-16384); });
  return { get bytes() { return bytes; }, clear() { retained = Buffer.alloc(0); } };
}
