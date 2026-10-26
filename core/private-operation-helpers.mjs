import { randomUUID } from 'node:crypto';
import { fail } from './validation.mjs';

export const privateBoundary = ns => [ns.ownerId, ns.scope, ns.projectId ?? ''];
export const privateWhere = 'owner_id=? AND scope=? AND project_id=?';
export const envelopeBytes = value => Buffer.byteLength(JSON.stringify({ ok: true, value }), 'utf8');

// Table names and purposes are internal constants supplied by the owning feature.
export function createOperationLedger(db, table) {
  return {
    replay(ns, actionId, method, payloadBinding) {
      const old = db.prepare(`SELECT * FROM ${table} WHERE ${privateWhere} AND action_id=?`)
        .get(...privateBoundary(ns), actionId);
      if (!old) return undefined;
      if (old.payload_binding !== payloadBinding || old.method !== method) fail('action_conflict');
      return JSON.parse(old.result);
    },
    record(ns, actionId, method, payloadBinding, target, result, timestamp) {
      db.prepare(`INSERT INTO ${table} VALUES(?,?,?,?,?,?,?,?,?)`)
        .run(...privateBoundary(ns), actionId, method, payloadBinding, target, JSON.stringify(result), timestamp);
    },
  };
}
export function createPrivateEffectWriter(db, table) {
  return (ns, kind, type, id, revision, actionId) => {
    const ordinal = db.prepare(`SELECT coalesce(max(ordinal),0)+1 AS n FROM ${table}`).get().n;
    db.prepare(`INSERT INTO ${table} VALUES(?,?,?,?,?,?,?,?,?,?)`)
      .run(randomUUID(), ...privateBoundary(ns), kind, type, id, revision, actionId, ordinal);
  };
}
export function createPrivateCursor({ binding, purpose, epoch }) {
  return {
    encode(value) {
      const body = Buffer.from(JSON.stringify(value)).toString('base64url');
      return `${body}.${binding(purpose, body)}`;
    },
    decode(cursor, expected, ns) {
      if (cursor === undefined) return null;
      const [body, signature, extra] = cursor.split('.');
      if (extra !== undefined || !body || signature !== binding(purpose, body)) fail('invalid_cursor');
      let value;
      try { value = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); } catch { fail('invalid_cursor'); }
      if (JSON.stringify(value.binding) !== JSON.stringify(expected)) fail('invalid_cursor');
      if (value.epoch !== epoch(ns)) fail('cursor_stale');
      if (!(typeof value.after === 'string' || Number.isSafeInteger(value.after))) fail('invalid_cursor');
      return value;
    },
  };
}
