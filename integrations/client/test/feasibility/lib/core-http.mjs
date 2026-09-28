// Recording HTTP front for the loopback core. Every received body is recorded
// locally for analysis. A handler failure answers only `{ error: 'harness_error' }`;
// its message (never a stack) stays in the local record.
import { createServer } from 'node:http';
import { appendRecord, sha256 } from './common.mjs';

const MAX_BODY = 256 * 1024;

export function createRecordingServer({ root, config, handle }) {
  return createServer(async (request, response) => {
    const chunks = [];
    let size = 0;
    for await (const chunk of request) {
      size += chunk.length;
      if (size > MAX_BODY) break;
      chunks.push(chunk);
    }
    const raw = Buffer.concat(chunks).toString('utf8');
    const authorized = request.headers.authorization === `Bearer ${config.token}`;
    let status = 401;
    let reply = { error: 'unauthorized' };
    let failure = null;
    if (authorized && size <= MAX_BODY) {
      try { [status, reply] = await handle(request.url, JSON.parse(raw)); }
      catch (error) {
        status = 500;
        reply = { error: 'harness_error' };
        failure = { message: String(error?.message ?? error).slice(0, 500) };
      }
    }
    // Synthetic bodies only; kept inside the run's temporary directory.
    appendRecord(root, 'bodies.jsonl', { step: config.step, path: request.url, bytes: Buffer.byteLength(raw),
      sha256: sha256(raw), authorized, status, raw, reply, ...(failure ? { failure } : {}) });
    response.writeHead(status, { 'content-type': 'application/json' });
    response.end(JSON.stringify(reply));
  });
}
