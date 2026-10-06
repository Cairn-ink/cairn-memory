import http from 'node:http';
import https from 'node:https';
import tls from 'node:tls';
import { isIP } from 'node:net';
import { AuthError } from './errors.mjs';

const bareHost = host => host.replace(/^\[|\]$/gu, '').toLowerCase();

// Supported NO_PROXY grammar: *, host, .suffix, host:port, [IPv6]:port.
// No CIDR, PAC, SOCKS or OS proxy discovery. Lowercase aliases are accepted.
export function proxyFor(url, env = process.env) {
  const noProxy = env.NO_PROXY ?? env.no_proxy ?? '';
  const host = bareHost(url.hostname);
  const port = url.port || (url.protocol === 'https:' ? '443' : '80');
  for (const item of noProxy.split(',')) {
    const rule = item.trim().toLowerCase();
    if (rule === '*') return null;
    const match = rule.match(/^(\[[^\]]+\]|[^:]+)(?::(\d+))?$/u);
    if (!match || (match[2] && match[2] !== port)) continue;
    const domain = bareHost(match[1]).replace(/^\./u, '');
    if (host === domain || host.endsWith(`.${domain}`)) return null;
  }
  const value = url.protocol === 'https:' ? (env.HTTPS_PROXY ?? env.https_proxy) :
    (env.HTTP_PROXY ?? env.http_proxy);
  if (!value) return null;
  try {
    const proxy = new URL(value);
    if (!['http:', 'https:'].includes(proxy.protocol) || proxy.search || proxy.hash || proxy.pathname !== '/') throw 0;
    return proxy;
  } catch { throw new AuthError('network'); }
}

function proxyHeaders(proxy) {
  return proxy.username || proxy.password ? {
    'Proxy-Authorization': `Basic ${Buffer.from(`${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`).toString('base64')}`,
  } : {};
}

function proxyTarget(proxy) {
  const target = new URL(proxy);
  target.username = ''; target.password = '';
  return target;
}

// One request, one disposable agent. HTTPS destinations always use a TLS
// tunnel; bearer headers and proof bodies are never sent in a CONNECT request.
export async function requestJSON(url, { body, token, signal, timeout = 15000, env = process.env } = {}) {
  signal?.throwIfAborted();
  const proxy = proxyFor(url, env);
  let payload = body ? Buffer.from(JSON.stringify(body)) : undefined;
  const chunks = [];
  let agent, connectRequest, tunnel, request;
  try {
    return await new Promise((resolve, reject) => {
      let settled = false;
      let size = 0;
      const finish = (error, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        if (error) reject(error); else resolve(value);
      };
      const fail = error => {
        const transient = ['ETIMEDOUT', 'ECONNRESET', 'EPIPE', 'EAI_AGAIN'].includes(error?.code);
        finish(new AuthError(transient ? 'transient' : 'network'));
      };
      const abort = () => finish(new AuthError('interrupted'));
      const timer = setTimeout(() => finish(new AuthError('transient')), timeout);
      signal?.addEventListener('abort', abort, { once: true });
      const headers = { Accept: 'application/json', ...(payload ? {
        'Content-Type': 'application/json', 'Content-Length': payload.length,
      } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) };
      let options = { method: payload ? 'POST' : 'GET', headers, rejectUnauthorized: true };
      let target = url;
      if (proxy && url.protocol === 'http:') {
        target = proxyTarget(proxy);
        options = { ...options, path: url.href, headers: { ...headers, Host: url.host, ...proxyHeaders(proxy) } };
      } else if (proxy) {
        agent = new https.Agent({ keepAlive: false });
        agent.createConnection = (_options, callback) => {
          const authority = `${url.hostname}:${url.port || '443'}`;
          connectRequest = (proxy.protocol === 'https:' ? https : http).request(proxyTarget(proxy), {
            method: 'CONNECT', path: authority, headers: { Host: authority, ...proxyHeaders(proxy) },
            rejectUnauthorized: true, agent: false,
          });
          connectRequest.once('error', fail);
          connectRequest.once('connect', (response, socket, head) => {
            tunnel = socket;
            if (response.statusCode !== 200 || head.length) {
              socket.destroy(); finish(new AuthError('network')); return;
            }
            const host = bareHost(url.hostname);
            const secure = tls.connect({ socket, host, servername: isIP(host) ? undefined : host, rejectUnauthorized: true });
            tunnel = secure;
            secure.once('error', fail);
            secure.once('secureConnect', () => callback(null, secure));
          });
          connectRequest.end();
        };
        options.agent = agent;
      } else options.agent = false;
      request = (target.protocol === 'https:' ? https : http).request(target, options, response => {
        response.on('error', fail);
        const status = response.statusCode;
        // Old servers may send an arbitrarily large HTML 404 page. Only status
        // is relevant for compatibility; never parse or retain that body.
        if ([404, 501].includes(status) || status >= 500) {
          response.resume();
          finish(null, { status, value: undefined, retryAfter: response.headers['retry-after'] });
          return;
        }
        if (status >= 300 && status < 400) {
          response.resume(); finish(new AuthError('protocol')); return;
        }
        response.on('data', chunk => {
          size += chunk.length;
          if (size > 32768) { finish(new AuthError('protocol')); response.destroy(); }
          else chunks.push(chunk);
        });
        response.on('end', () => {
          let value;
          try {
            if (!/^application\/json(?:\s*;|$)/iu.test(response.headers['content-type'] ?? '')) throw 0;
            const buffer = Buffer.concat(chunks);
            try { value = JSON.parse(buffer.toString('utf8')); }
            finally { buffer.fill(0); }
          } catch { finish(new AuthError('protocol')); }
          for (const chunk of chunks) chunk.fill(0);
          finish(null, { status, value, retryAfter: response.headers['retry-after'] });
        });
      });
      request.once('error', fail);
      request.end(payload);
    });
  } finally {
    payload?.fill(0); payload = undefined;
    for (const chunk of chunks) chunk.fill(0);
    request?.destroy(); connectRequest?.destroy(); tunnel?.destroy(); agent?.destroy();
    token = undefined; body = undefined;
  }
}
