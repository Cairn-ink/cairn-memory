import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';

// A temporary experiment bridge, not a public service. Children receive only this
// random capability; the actual provider credential remains inside the session.
export async function startExperimentProxy({ session }) {
  if (typeof session?.request !== 'function') throw new Error('invalid_proxy_session');
  const token = randomBytes(32).toString('hex');
  const authorization = Buffer.from(`Bearer ${token}`);
  const active = new Set();
  const handlers = new Set();
  let closing = false;
  let closePromise;
  const handle = async (incoming, outgoing) => {
    const supplied = Buffer.from(incoming.headers.authorization ?? '');
    if (supplied.length !== authorization.length || !timingSafeEqual(supplied, authorization)) {
      outgoing.writeHead(401).end(); incoming.resume(); return;
    }
    if (incoming.method !== 'POST' || !['/v1/chat/completions', '/v1/responses', '/v1/responses/input_tokens'].includes(incoming.url)
      || incoming.headers['content-type']?.split(';')[0] !== 'application/json') {
      outgoing.writeHead(400).end(); incoming.resume(); return;
    }
    const controller = new AbortController();
    active.add(controller);
    const timeout = setTimeout(() => { controller.abort(); incoming.destroy(); }, 60_000);
    const cancel = () => controller.abort();
    incoming.once('aborted', cancel);
    outgoing.once('close', cancel);
    try {
      const chunks = [];
      let bytes = 0;
      for await (const chunk of incoming) {
        bytes += chunk.length;
        if (bytes > 100_000) throw new Error('request_too_large');
        chunks.push(chunk);
      }
      if (controller.signal.aborted) throw new Error('request_aborted');
      const response = await session.request(incoming.url.slice(3), Buffer.concat(chunks).toString('utf8'),
        { signal: controller.signal });
      const body = Buffer.from(await response.arrayBuffer());
      outgoing.writeHead(response.status, { 'content-type': 'application/json', 'content-length': body.length });
      outgoing.end(body);
    } catch {
      if (!outgoing.destroyed) outgoing.writeHead(502, { 'content-type': 'application/json' })
        .end(JSON.stringify({ error: { message: 'experiment_request_failed', type: 'experiment_guard' } }));
    } finally {
      clearTimeout(timeout); active.delete(controller);
      incoming.removeListener('aborted', cancel); outgoing.removeListener('close', cancel);
    }
  };
  const server = createServer((incoming, outgoing) => {
    if (closing) { outgoing.writeHead(503).end(); incoming.resume(); return; }
    const pending = handle(incoming, outgoing).catch(() => outgoing.destroy());
    handlers.add(pending);
    void pending.finally(() => handlers.delete(pending));
  });
  server.requestTimeout = 60_000;
  server.headersTimeout = 10_000;
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return Object.freeze({ url: `http://127.0.0.1:${server.address().port}`, token,
    close: () => {
      if (closePromise) return closePromise;
      closing = true;
      closePromise = (async () => {
        const stopped = new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
        for (const controller of active) controller.abort();
        server.closeAllConnections();
        await Promise.allSettled([...handlers]);
        await stopped;
      })();
      return closePromise;
    } });
}
