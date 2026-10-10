import { detectLanguage, translator } from './messages.mjs';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { hostname } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { performance } from 'node:perf_hooks';
import { copyCode, formatCode, spinner } from './device-ui.mjs';
import { requestJSON } from './transport.mjs';
import { AuthError } from './errors.mjs';

const client = 'cairn-memory-setup';
const scope = 'memory:capture memory:recall';
const base = '/api/cli-auth/v1';
const opaque = value => typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/u.test(value);
const identifier = value => typeof value === 'string' && /^[\w-]{1,128}$/u.test(value);
export const validToken = value => typeof value === 'string' && value.length > 0 &&
  value.length <= 8192 && !/[\s\x00-\x1f\x7f]/u.test(value);
const date = value => typeof value === 'string' && /^\d{4}-\d\d-\d\dT/u.test(value) && Number.isFinite(Date.parse(value));
const integer = value => Number.isInteger(value) && value > 0 && value <= 600;
const scopesValid = value => value === null || (Array.isArray(value) && value.length === 2 &&
  new Set(value).size === 2 && value.includes('memory:capture') && value.includes('memory:recall'));

export function safeHostname(value = hostname()) {
  return Array.from(value.replace(/[\p{Cc}\p{Cf}<>"'`&]/gu, '').replace(/\s+/gu, ' ').trim()).slice(0, 64).join('') || 'Unknown host';
}

function failure(response) {
  if (response.status === 501) return new AuthError('protocol', 501);
  if (response.status >= 500) return new AuthError('server', response.status);
  const value = response.value;
  if (!value || typeof value.error !== 'string' || typeof value.error_description !== 'string' ||
      !(value.request_id === null || identifier(value.request_id))) return new AuthError('protocol');
  if (response.status === 429) {
    if (value.error === 'active_token_limit') return new AuthError('active_token_limit', 429);
    const header = Number(response.retryAfter);
    if (!Number.isInteger(value.retry_after) || value.retry_after < 1 ||
        (response.retryAfter !== undefined && (!Number.isInteger(header) || header < 1))) return new AuthError('protocol');
    return new AuthError('rate_limited', 429, Math.max(value.retry_after, header || 0), value.state);
  }
  return new AuthError(value.error, response.status, 0, value.state);
}

export async function credentialCheck(endpoint, token, { signal, request = requestJSON, timeout } = {}) {
  const response = await request(new URL(`${base}/credential`, endpoint), { token, signal, timeout });
  if ([404, 501].includes(response.status)) return null;
  if (response.status !== 200) {
    if (response.status === 401 || response.status === 403) throw new AuthError('credential');
    throw failure(response);
  }
  const value = response.value;
  if (!value || value.valid !== true || !identifier(value.token_id) || !scopesValid(value.scopes) ||
      !(value.expires_at === null || date(value.expires_at))) throw new AuthError('protocol');
  return value;
}

// Clocks, sleep and transport are injected only by tests, never by CLI flags or
// environment. Deadlines cannot be extended by a delayed HTTP response.
export async function browserAuthorize(endpoint, {
  authorization, write, browse, prompt, noBrowser, noClipboard, save, signal, progress = spinner, t = translator(detectLanguage()),
  copy = copyCode, tty = Boolean(process.stdout.isTTY), env = process.env,
  request = requestJSON, now = () => performance.now(), sleep = delay, jitter = Math.random,
} = {}) {
  if (authorization) return authorization.authorize(endpoint, { write, browse, prompt, noBrowser, noClipboard,
    save, signal, progress, t, copy, tty, env, request, now, sleep, jitter });
  let verifier = randomBytes(32).toString('base64url');
  let proof, token, receipt, grant, configured = false, ackStarted = false;
  let recoveryStart;
  let stop = () => {};
  const start = now();
  let deadline = start + 600000;
  const post = (route, body, options = {}) => request(new URL(`${base}/${route}`, endpoint), { body, signal, ...options });
  const cancel = async () => {
    if (!proof) return;
    try { await post('cancel', proof, { signal: undefined, timeout: 2000 }); } catch { /* best effort, no raw errors */ }
  };
  const pause = async seconds => {
    if (signal?.aborted) throw new AuthError('interrupted');
    const remaining = deadline - now();
    if (remaining <= 0) throw new AuthError('timeout');
    // Preserve the rate-limit cause when Retry-After cannot fit in the grant.
    await sleep(Math.min(seconds * 1000, remaining), undefined, { signal });
    if (now() >= deadline) throw new AuthError('timeout');
  };
  try {
    const created = await post('device-authorizations', {
      client_id: client, scope, hostname: safeHostname(),
      code_challenge: createHash('sha256').update(verifier, 'ascii').digest('base64url'), code_challenge_method: 'S256',
    });
    if ([404, 501].includes(created.status)) return { unsupported: true };
    if (created.status !== 200) throw failure(created);
    grant = created.value;
    if (!grant || !identifier(grant.request_id) || !opaque(grant.device_code)) throw new AuthError('protocol');
    proof = { client_id: client, device_code: grant.device_code, code_verifier: verifier, exchange_id: randomUUID() };
    const uri = new URL('/device', endpoint).href;
    if (!/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}$/u.test(grant.user_code) ||
        grant.verification_uri !== uri || !integer(grant.expires_in) || !integer(grant.interval)) throw new AuthError('protocol');
    deadline = start + Math.min(600, grant.expires_in) * 1000;
    if (now() >= deadline) throw new AuthError('timeout');
    write('');
    write(t('authorization_code', { code: formatCode(grant.user_code, { tty, env }) }));
    write('');
    let copied = false;
    if (!noClipboard) {
      try { copied = await copy(grant.user_code, { signal }); } catch { /* clipboard is optional */ }
    }
    if (signal?.aborted) throw new AuthError('interrupted');
    if (now() >= deadline) throw new AuthError('timeout');
    if (noBrowser) {
      write(uri);
      if (copied) write(t('clipboard_copied'));
    } else {
      // Keep terminal focus until the user has read/copied the code. Bound this
      // prompt by the same grant deadline; abort restores readline's raw mode.
      const gate = new AbortController();
      const interrupt = () => gate.abort(new AuthError('interrupted'));
      signal?.addEventListener('abort', interrupt, { once: true });
      if (signal?.aborted) interrupt();
      const timer = setTimeout(() => gate.abort(new AuthError('timeout')), Math.max(1, deadline - now()));
      try {
        await prompt(t('open_device', { url: uri.replace(/^https?:\/\//u, ''), copied: copied ? ` ${t('clipboard_copied')}` : '' }), { signal: gate.signal });
        if (gate.signal.aborted) throw gate.signal.reason;
      } catch (error) { throw gate.signal.aborted ? gate.signal.reason : error; }
      finally { clearTimeout(timer); signal?.removeEventListener('abort', interrupt); }
    }
    if (signal?.aborted) throw new AuthError('interrupted');
    if (now() >= deadline) throw new AuthError('timeout');
    const seconds = Math.ceil((deadline - now()) / 1000);
    write(seconds >= 60 ? t('code_deadline', { minutes: Math.ceil(seconds / 60) }) : t('code_deadline_seconds', { seconds }));
    if (!noBrowser) {
      try { await browse(write, uri, signal); }
      catch { if (!signal?.aborted) write(t('open_manually', { url: uri })); }
    }
    let interval = Math.max(5, grant.interval), backoff = 0;
    stop = progress(write, () => Math.max(0, Math.ceil((deadline - now()) / 1000)), false, t, grant.user_code, { tty });
    await pause(interval);
    while (!token) {
      let response;
      const exchangeStart = now();
      try {
        response = await post('token', proof, { timeout: Math.max(1, Math.min(15000, deadline - now())) });
      } catch (error) {
        if (error.kind !== 'transient') throw error;
        recoveryStart ??= exchangeStart;
        response = { status: 503 };
      }
      if (now() >= deadline) throw new AuthError('timeout');
      if (response.status === 200) {
        const value = response.value;
        // Capture the token only after validating the complete delivery shape.
        if (!value || !validToken(value.access_token) || value.token_type !== 'Bearer' || value.scope !== scope ||
            !identifier(value.token_id) || !opaque(value.delivery_receipt) || !date(value.expires_at) ||
            !date(value.ack_deadline)) throw new AuthError('protocol');
        token = value.access_token; receipt = value.delivery_receipt;
        value.access_token = undefined; value.delivery_receipt = undefined;
        // The server owns absolute timestamps and expiry enforcement. Bound
        // our work from BEFORE the potentially issuing exchange, subtracting
        // one second for the server's timestamp rounding. Replayed responses
        // cannot reset this budget; lost exchanges retain the earliest start.
        const ackDeadline = Math.min(deadline, (recoveryStart ?? exchangeStart) + 60000) - 1000;
        const remaining = () => Math.max(0, ackDeadline - now());
        if (!remaining()) throw new AuthError('timeout');
        stop();
        stop = progress(write, 0, true, t, grant.user_code, { tty });
        const checked = await credentialCheck(endpoint, token, { signal, request,
          timeout: Math.min(15000, remaining()) });
        if (!checked || checked.token_id !== value.token_id || checked.expires_at !== value.expires_at || checked.scopes === null) throw new AuthError('protocol');
        try {
          if (!remaining()) throw new AuthError('configure');
          await save({ api_endpoint: endpoint, api_token: token }, remaining());
          if (!remaining()) throw new AuthError('configure');
        }
        catch (error) {
          if (signal?.aborted || error.code === 130) throw new AuthError('interrupted');
          throw new AuthError('configure');
        }
        token = undefined;
        configured = true;
        if (signal?.aborted) throw new AuthError('interrupted');
        ackStarted = true;
        // Same receipt/proof, bounded reconciliation retries. An ambiguous ACK
        // never cancels a credential that may already have been delivered.
        for (let attempt = 0; attempt < 3; attempt++) {
          if (!remaining()) break;
          try {
            const ack = await post('ack', { ...proof, delivery_receipt: receipt }, { timeout: Math.min(15000, remaining()) });
            if (ack.status === 200 && ack.value?.delivered === true) {
              stop(); stop = () => {};
              return { expiresAt: checked.expires_at };
            }
            const error = failure(ack);
            if (error.kind === 'failed_revoked' || error.state === 'failed_revoked') throw new AuthError('failed_revoked');
            if (error.kind !== 'server') throw new AuthError('ack_unknown');
          } catch (error) {
            if (signal?.aborted) throw new AuthError('interrupted');
            if (!['network', 'transient', 'server'].includes(error.kind)) throw error;
          }
          if (attempt < 2 && remaining()) await sleep(Math.min(500 * (2 ** attempt), remaining()), undefined, { signal });
        }
        throw new AuthError('ack_unknown');
      }
      const error = failure(response);
      if (error.kind === 'authorization_pending' && response.status === 400) { recoveryStart = undefined; backoff = 0; await pause(interval); }
      else if (error.kind === 'slow_down' && response.status === 400) { interval += 5; await pause(interval); }
      else if (error.kind === 'rate_limited') {
        write(t('rate_wait'));
        if (Math.max(interval, error.retryAfter) * 1000 >= deadline - now()) throw error;
        await pause(Math.max(interval, error.retryAfter));
      } else if (error.kind === 'server') {
        backoff = Math.min(60, backoff ? backoff * 2 : interval * 2);
        await pause(Math.min(60, backoff + Math.max(0.001, jitter())));
      } else throw error;
    }
  } catch (error) {
    if (signal?.aborted || error.code === 130) throw new AuthError('interrupted');
    if (error.kind === 'transient') throw new AuthError('network');
    throw error;
  } finally {
    try { stop(); } catch { /* A closed terminal must not prevent cancellation. */ }
    if (proof && (!configured || !ackStarted || signal?.aborted)) await cancel();
    // JS strings cannot be zeroed in place. Drop every owned reference; no
    // installer file or cache is created. Request body Buffers are zeroed.
    token = undefined; verifier = undefined; receipt = undefined;
    if (proof) { proof.code_verifier = undefined; proof.device_code = undefined; }
    grant = undefined; proof = undefined;
  }
}
