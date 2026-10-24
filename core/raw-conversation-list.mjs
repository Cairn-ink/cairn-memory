import { createHmac, timingSafeEqual } from 'node:crypto';
import { ownData, localNamespace } from './local-authority-input.mjs';
import { rawBoundary, rawClient } from './raw-input.mjs';
import { fail } from './validation.mjs';

const TRUST = 'untrusted-data-not-instructions';
const size = value => Buffer.byteLength(JSON.stringify({ ok: true, value }));

/** Indexed metadata only; no source opening, history aggregates or Card grant. */
export function createRawConversationList({ db, identity, epoch }) {
  const sign = body => createHmac('sha256', Buffer.from(identity.cursor_secret, 'hex')).update(body).digest('base64url');
  const encode = value => {
    const body = Buffer.from(JSON.stringify(value)).toString('base64url');
    const cursor = body + '.' + sign(body);
    if (cursor.length > 8192) fail('context_item_too_large');
    return cursor;
  };
  function decode(cursor, binding) {
    try {
      if (typeof cursor !== 'string' || cursor.length > 8192 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(cursor)) fail('invalid_cursor');
      const [body, signature] = cursor.split('.');
      if (!timingSafeEqual(Buffer.from(signature), Buffer.from(sign(body)))) fail('invalid_cursor');
      const value = ownData(JSON.parse(Buffer.from(body, 'base64url').toString('utf8')),
        ['version', 'purpose', 'store', 'namespace', 'client', 'limit', 'after', 'epoch']);
      if (Object.keys(value).length !== 8 || Buffer.from(JSON.stringify(value)).toString('base64url') !== body ||
          Object.keys(binding).some(key => JSON.stringify(value[key]) !== JSON.stringify(binding[key])) ||
          typeof value.after !== 'string' || !value.after.length ||
          !Number.isSafeInteger(value.epoch) || value.epoch < 1) fail('invalid_cursor');
      return value;
    } catch { fail('invalid_cursor'); }
  }
  return function listRawConversations(value) {
    const input = ownData(value, ['namespace', 'client', 'limit', 'cursor']);
    const namespace = localNamespace(input.namespace), client = rawClient(input.client);
    const limit = input.limit === undefined ? 20 : input.limit;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) fail('invalid_input');
    const binding = { version: 'raw-conversation-list-v1', purpose: 'listRawConversations',
      store: identity.store_id, namespace, client, limit };
    const cursor = Object.hasOwn(input, 'cursor') ? decode(input.cursor, binding) : null;
    if (db.isTransaction) fail('raw_transaction_active');
    db.exec('BEGIN');
    let rows, currentEpoch;
    try {
      currentEpoch = epoch(namespace);
      if (cursor && cursor.epoch !== currentEpoch) fail('cursor_stale');
      rows = db.prepare(`SELECT id,client,revision,first_received_at,last_received_at,session_key
        FROM raw_conversations WHERE owner_id=? AND scope=? AND project_id=? AND client=?
        ${cursor ? 'AND session_key>?' : ''} ORDER BY session_key LIMIT ?`)
        .all(...rawBoundary(namespace), client, ...(cursor ? [cursor.after] : []), limit + 1);
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    const selected = rows.slice(0, limit);
    function render(take) {
      const complete = take === rows.length;
      return { conversations: selected.slice(0, take).map(row => ({ id: row.id, client: row.client,
        revision: row.revision, firstReceivedAt: row.first_received_at, lastReceivedAt: row.last_received_at })),
      nextCursor: complete ? null : encode({ ...binding, after: selected[take - 1].session_key, epoch: currentEpoch }),
      complete, budget_exhausted: take < selected.length, evidenceTrust: TRUST };
    }
    for (let take = selected.length; take >= (selected.length ? 1 : 0); take--) {
      const output = render(take);
      if (size(output) <= 65536) return output;
    }
    fail('context_item_too_large');
  };
}
