import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { fail } from './validation.mjs';

// Fixed-size, digest-only capabilities: no per-issuance registry or plaintext IDs.
export function createTopicTokens({ now = () => performance.now(), key = randomBytes(32),
  incarnation = randomBytes(12) } = {}) {
  const digest = value => createHash('sha256').update(JSON.stringify(value)).digest();
  const purpose = family => family === 'ts1' ? 'topic-snapshot-v1/origin' : 'topic-members-v1/cursor';
  const mac = (family, body) => createHmac('sha256', key).update(purpose(family)).update(body).digest();
  function issue(family, binding) {
    const body = Buffer.alloc(68);
    incarnation.copy(body); randomBytes(16).copy(body, 12);
    body.writeDoubleBE(now(), 28); digest(binding).copy(body, 36);
    return `${family}.${body.toString('base64url')}.${mac(family, body).toString('base64url')}`;
  }
  function verify(token, family, binding) {
    const error = family === 'ts1' ? 'cursor_stale' : 'invalid_cursor';
    if (typeof token !== 'string' || !new RegExp(`^${family}\\.[A-Za-z0-9_-]{91}\\.[A-Za-z0-9_-]{43}$`).test(token)) fail(error);
    const [, encoded, signature] = token.split('.');
    const body = Buffer.from(encoded, 'base64url'), supplied = Buffer.from(signature, 'base64url');
    if (body.toString('base64url') !== encoded || supplied.toString('base64url') !== signature) fail(error);
    if (!timingSafeEqual(body.subarray(0, 12), incarnation)) fail('cursor_stale');
    if (!timingSafeEqual(supplied, mac(family, body))) fail(error);
    if (binding !== undefined && !timingSafeEqual(body.subarray(36), digest(binding))) fail('cursor_stale');
    const age = now() - body.readDoubleBE(28);
    if (!Number.isFinite(age) || age < 0 || (family === 'ts1' && age >= 60000)) fail('cursor_stale');
  }
  return { issueOrigin: binding => issue('ts1', binding), verifyOrigin: (token, binding) => verify(token, 'ts1', binding),
    issueCursor: binding => issue('tm1', binding), verifyCursor: (token, binding) => verify(token, 'tm1', binding) };
}
