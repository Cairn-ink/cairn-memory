import http from 'node:http';
import { randomBytes, randomUUID, createHash } from 'node:crypto';

export const secret = 'synthetic-browser-PAT-never-print-123';
const client = 'cairn-memory-setup';
const scope = 'memory:capture memory:recall';
const opaque = () => randomBytes(32).toString('base64url');

// A fake of the CLI contract, with independent proof validation and terminal
// states. Requests stay in memory; never write them into a test output file.
export async function fakeAuthServer(t, options = {}) {
  const requests = [], violations = [];
  let grant, delivery, lastProof, polls = 0, acks = 0, endpoint;
  const sequence = [...(options.sequence ?? [])];
  const serverNow = () => Date.now() + (options.clockSkew ?? 0);
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    let body;
    try { body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : undefined; }
    catch { violations.push('invalid JSON request'); res.writeHead(400).end(); return; }
    const route = req.url.replace('/api/cli-auth/v1/', '');
    requests.push({ route, body, headers: req.headers, url: req.url });
    const send = (status, value, headers = {}) => {
      res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Pragma': 'no-cache', ...headers });
      res.end(JSON.stringify(value));
    };
    const error = (code, status = 400, extra = {}) => send(status, {
      error: code, error_description: 'Synthetic safe message', request_id: grant?.request_id ?? null, ...extra,
    }, code === 'rate_limited' ? { 'Retry-After': String(extra.retry_after) } : {});
    if (req.url.includes('?') || req.headers.cookie) violations.push('query or cookie on CLI request');
    if (route === 'device-authorizations') {
      if (options.createStatus) {
        if (options.createHTML) { res.writeHead(options.createStatus, { 'Content-Type': 'text/html' }).end('<html>old server</html>'); return; }
        error('cli_auth_not_supported', options.createStatus); return;
      }
      if (options.createMalformed) { res.writeHead(200, { 'Content-Type': 'application/json' }).end('{'); return; }
      if (options.redirect) { res.writeHead(302, { Location: `${endpoint}/trap`, 'Content-Type': 'application/json' }).end('{}'); return; }
      if (body.client_id !== client || body.scope !== scope || body.code_challenge_method !== 'S256' ||
          !/^[\w-]{43}$/u.test(body.code_challenge)) violations.push('invalid create contract');
      grant = { request_id: randomUUID(), device_code: opaque(), user_code: 'ABCD-EFGH',
        verification_uri: options.foreignURI ?? `${endpoint}/device`, expires_in: options.expiresIn ?? 600,
        interval: options.interval ?? 5, state: 'approved', challenge: body.code_challenge };
      send(200, Object.fromEntries(Object.entries(grant).filter(([key]) => !['state', 'challenge'].includes(key))));
      return;
    }
    if (route === 'credential') {
      if (options.credentialStatus) { error('invalid_grant', options.credentialStatus); return; }
      if (req.method !== 'GET' || req.headers.authorization !== `Bearer ${secret}`) { error('invalid_grant', 401); return; }
      if (grant && !['issued_unacked', 'delivered'].includes(grant.state)) { error('invalid_grant', 401); return; }
      send(200, { valid: true, token_id: delivery?.token_id ?? 'manual-token', scopes: options.legacy ? null : scope.split(' '),
        expires_at: delivery?.expires_at ?? (options.legacy ? null : options.expiresAt ?? new Date(serverNow() + 180 * 86400000).toISOString()) }); return;
    }
    if (!grant || body?.client_id !== client || body.device_code !== grant.device_code ||
        createHash('sha256').update(body.code_verifier ?? '').digest('base64url') !== grant.challenge) {
      error('invalid_grant'); return;
    }
    lastProof = Object.fromEntries(['client_id', 'device_code', 'code_verifier', 'exchange_id'].map(key => [key, body[key]]));
    if (route === 'token') {
      polls++;
      if (['delivered', 'cancelled', 'expired', 'denied'].includes(grant.state)) { error('invalid_grant'); return; }
      const next = sequence.shift();
      if (next && next !== 'lost_delivery') {
        if (next === 'drop') { req.socket.destroy(); return; }
        if (next === 'access_denied') grant.state = 'denied';
        if (next === 'expired_token') grant.state = 'expired';
        if (next === 'active_token_limit') { error(next, 429, { retry_after: options.retryAfter ?? 17 }); return; }
        if (next === 'rate_limited') { error(next, 429, { retry_after: options.retryAfter ?? 17 }); return; }
        if (typeof next === 'number') { error('temporary_failure', next); return; }
        error(next); return;
      }
      if (options.pendingForever) { error('authorization_pending'); return; }
      if (delivery && delivery.exchange_id !== body.exchange_id) { error('exchange_conflict', 409); return; }
      if (!delivery) {
        delivery = { access_token: secret, token_type: 'Bearer', scope,
          expires_at: options.expiresAt ?? new Date(serverNow() + 180 * 86400000).toISOString(), token_id: randomUUID(),
          delivery_receipt: opaque(), ack_deadline: new Date(Math.floor(serverNow() / 1000) * 1000 + 60000).toISOString(), exchange_id: body.exchange_id };
        grant.state = 'issued_unacked';
      }
      const { exchange_id: _exchange, ...value } = delivery;
      if (next === 'lost_delivery') { req.socket.destroy(); return; }
      send(200, value); return;
    }
    if (route === 'cancel') {
      if (!['delivered', 'denied', 'expired'].includes(grant.state)) grant.state = 'cancelled';
      send(200, { state: grant.state }); return;
    }
    if (route === 'ack') {
      acks++;
      if (options.ackStatus) { error('temporary_failure', options.ackStatus); return; }
      if (options.ackRevoked) { grant.state = 'failed_revoked'; error('failed_revoked', 409, { state: 'failed_revoked' }); return; }
      if (!delivery || body.delivery_receipt !== delivery.delivery_receipt || body.exchange_id !== delivery.exchange_id) { error('invalid_grant'); return; }
      grant.state = 'delivered';
      if (options.ackLost && acks === 1) { req.socket.destroy(); return; }
      if (options.ackUnavailable) { error('temporary_failure', 503); return; }
      send(200, { delivered: true }); return;
    }
    violations.push(`unexpected route ${route}`); error('invalid_request');
  });
  endpoint = options.endpoint ?? 'http://127.0.0.1:31415';
  t.after(() => server.closeAllConnections());
  return { endpoint, server, requests, violations, get grant() { return grant; }, get delivery() { return delivery; },
    get lastProof() { return lastProof; }, get polls() { return polls; } };
}
