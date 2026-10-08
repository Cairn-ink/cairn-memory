import { message, messages } from './messages.mjs';

export class SetupError extends Error {
  constructor(key, code = 1, params = {}) {
    super(message('en', key, params));
    Object.assign(this, { key, code, params });
  }
}

export class AuthError extends SetupError {
  constructor(kind, status = 0, retryAfter = 0, state) {
    const key = Object.hasOwn(messages, `auth_${kind}`) ? `auth_${kind}` : 'auth_protocol';
    super(key, kind === 'interrupted' ? 130 : 1);
    Object.assign(this, { kind, status, retryAfter, state });
  }
}
